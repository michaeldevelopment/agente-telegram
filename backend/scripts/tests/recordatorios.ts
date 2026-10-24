/**
 * Recordatorios programados (spec 14), con Telegram y Google Calendar
 * SIMULADOS (mismo patrón que agendar.ts/botones.ts). La base de datos es
 * la REAL. `tickReminders()` se llama directo, sin esperar al cron real.
 *
 * Cubre:
 *   - agendar inserta 2 recordatorios (confirm_24h, remind_2h), pending
 *   - una cita a <24h solo programa remind_2h (confirm_24h ya pasó, se omite)
 *   - shiftOutOfQuietHours: 23:00 se mueve a 08:00 del día siguiente;
 *     fuera de la ventana de silencio, no se toca
 *   - un recordatorio vencido se dispara con tickReminders()
 *   - confirm_24h trae los 3 botones (Confirmar/Reprogramar/Cancelar) y
 *     remind_2h trae la dirección
 *   - rc: confirma (status='confirmed')
 *   - rp: → rb: reprograma la MISMA cita (mismo gcal_event_id, sin duplicar)
 *     y recalcula los recordatorios restantes
 *   - rx: cancela (borra de Google, recordatorios pendientes quedan 'skipped')
 *   - cero llm_call en toda la prueba
 */
const CHAT_REC = 999400001;

let fallos = 0;
const comprobar = (nombre: string, cond: boolean, detalle = "") => {
  if (cond) console.log(`OK   ${nombre}`);
  else { console.log(`FAIL ${nombre}${detalle ? ` — ${detalle}` : ""}`); fallos++; }
};

process.env.GOOGLE_SA_EMAIL ||= "prueba@cuenta-de-servicio.iam.gserviceaccount.com";
process.env.GOOGLE_SA_PRIVATE_KEY ||= Buffer.from(
  "-----BEGIN PRIVATE KEY-----\nno-se-firma-de-verdad\n-----END PRIVATE KEY-----\n",
).toString("base64");
process.env.GOOGLE_CALENDAR_ID ||= "calendario-de-prueba@group.calendar.google.com";
process.env.TELEGRAM_BOT_TOKEN ||= "token-simulado";
process.env.DEEPSEEK_API_KEY ||= "clave-simulada";

const { JWT } = await import("google-auth-library");
JWT.prototype.getAccessToken = (async () => ({ token: "token-simulado-gcal" })) as never;

const eventosGoogle = new Map<string, { id: string; htmlLink: string }>();
type LlamadaTg = { metodo: string; body: Record<string, unknown> };
const llamadasTg: LlamadaTg[] = [];
let siguienteMessageId = 7000;

global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url instanceof Request ? url.url : url);
  const method = init?.method ?? (url instanceof Request ? url.method : "GET");

  if (u.includes("api.telegram.org")) {
    const metodo = u.split("/").pop() ?? "";
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    llamadasTg.push({ metodo, body });
    if (metodo === "sendMessage") {
      return new Response(JSON.stringify({ ok: true, result: { message_id: siguienteMessageId++, chat: { id: body.chat_id } } }),
        { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true, result: true }), { status: 200, headers: { "content-type": "application/json" } });
  }

  if (u.includes("calendar/v3/freeBusy")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { items: { id: string }[] };
    const calendars = Object.fromEntries(body.items.map((it) => [it.id, { busy: [] }]));
    return new Response(JSON.stringify({ calendars }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (u.includes("calendar/v3/calendars/")) {
    const idEnPath = u.match(/\/events\/([^/?]+)/)?.[1];
    if (method === "POST" && u.includes("/events?")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { id: string };
      if (eventosGoogle.has(body.id)) return new Response(JSON.stringify({ error: { message: "ya existe" } }), { status: 409 });
      const evento = { id: body.id, htmlLink: `https://calendar.google.com/event?eid=${body.id}` };
      eventosGoogle.set(body.id, evento);
      return new Response(JSON.stringify(evento), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (method === "PATCH" && idEnPath) {
      const evento = eventosGoogle.get(idEnPath);
      if (!evento) return new Response(JSON.stringify({ error: { message: "no encontrado" } }), { status: 404 });
      return new Response(JSON.stringify(evento), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (method === "DELETE" && idEnPath) {
      if (!eventosGoogle.has(idEnPath)) return new Response(null, { status: 410 });
      eventosGoogle.delete(idEnPath);
      return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (method === "GET" && idEnPath) {
      const evento = eventosGoogle.get(idEnPath);
      if (!evento) return new Response(JSON.stringify({ error: { message: "no encontrado" } }), { status: 404 });
      return new Response(JSON.stringify(evento), { status: 200, headers: { "content-type": "application/json" } });
    }
  }

  throw new Error(`fetch no simulado: ${method} ${u}`);
}) as typeof fetch;

const { closeDb, sql } = await import("../../src/db/client.js");
const { agendarCita } = await import("../../src/tools/agendar.js");
const { shiftOutOfQuietHours } = await import("../../src/reminders/schedule.js");
const { tickReminders, apptCorto } = await import("../../src/reminders/send.js");
const { handleCallback } = await import("../../src/handlers/callbacks.js");
const { DateTime } = await import("luxon");

function evCallback(opts: { queryId: string; data: string; chatId: number; messageId: number; userId: number }) {
  return {
    updateId: 1, chatId: opts.chatId, userId: opts.userId, kind: "callback" as const,
    callbackData: opts.data, callbackQueryId: opts.queryId, text: opts.data,
    messageId: opts.messageId, ts: Date.now(), from: { firstName: "Paciente" }, raw: {},
  };
}

async function main() {
  const [ws] = await sql<{ id: string; slug: string; name: string; timezone: string }[]>`
    select id, slug, name, timezone from workspaces limit 1`;
  if (!ws) throw new Error("no hay workspace: corre npm run seed");

  const [servicio] = await sql<{ slug: string; duration_min: number }[]>`
    select slug, duration_min from services where workspace_id = ${ws.id} and slug = 'limpieza-dental'`;
  if (!servicio) throw new Error("no existe el servicio limpieza-dental: corre npm run seed");

  await limpiar();

  // ── 0 · shiftOutOfQuietHours: función pura, sin DB ─────────────────────
  const zona = "America/Bogota";
  const a23 = DateTime.fromISO("2026-11-05T23:00:00", { zone: zona });
  const movida = shiftOutOfQuietHours(a23, "21:00:00", "08:00:00");
  comprobar("23:00 (en silencio) se mueve al día siguiente a las 08:00",
    movida.toFormat("yyyy-LL-dd HH:mm") === "2026-11-06 08:00", movida.toISO()!);

  const a14 = DateTime.fromISO("2026-11-05T14:00:00", { zone: zona });
  const sinTocar = shiftOutOfQuietHours(a14, "21:00:00", "08:00:00");
  comprobar("14:00 (fuera de silencio) se respeta sin cambios", sinTocar.toMillis() === a14.toMillis());

  const a07 = DateTime.fromISO("2026-11-05T07:00:00", { zone: zona });
  const madrugada = shiftOutOfQuietHours(a07, "21:00:00", "08:00:00");
  comprobar("07:00, dentro de 21:00–08:00, se mueve a las 08:00 del MISMO día",
    madrugada.toFormat("yyyy-LL-dd HH:mm") === "2026-11-05 08:00", madrugada.toISO()!);

  const ws1: never = ws as never;

  // ── 1 · Agendar inserta 2 recordatorios ────────────────────────────────
  const inicio = DateTime.now().setZone(ws.timezone).plus({ days: 10 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  const [c] = await sql<{ id: string }[]>`
    insert into contacts (workspace_id, tg_chat_id, first_name) values (${ws.id}, ${CHAT_REC}, 'Prueba recordatorios') returning id`;
  const [conv] = await sql<{ id: string }[]>`insert into conversations (workspace_id, contact_id) values (${ws.id}, ${c!.id}) returning id`;
  const convCtx = { contactId: c!.id, conversationId: conv!.id, isBlocked: false, state: "ai_active", aiEnabled: true };

  const agendada = await agendarCita.run(
    { servicio: servicio.slug, inicio: inicio.toISO()!, nombre_paciente: "Prueba Recordatorios" },
    { workspace: ws1, conversation: convCtx as never },
  );
  if (!agendada.ok) throw new Error(`setup falló: ${JSON.stringify(agendada)}`);
  const citaId = (agendada.data as { cita_id: string }).cita_id;

  const recs = await sql<{ kind: string; status: string; send_at: Date }[]>`
    select kind, status, send_at from reminders where appointment_id = ${citaId} order by kind`;
  comprobar("se insertaron 2 recordatorios, pending", recs.length === 2 && recs.every((r) => r.status === "pending"),
    JSON.stringify(recs));
  comprobar("son confirm_24h y remind_2h", recs.map((r) => r.kind).sort().join(",") === "confirm_24h,remind_2h");

  // ── 2 · Una cita a <24h solo programa remind_2h ────────────────────────
  const [c2] = await sql<{ id: string }[]>`
    insert into contacts (workspace_id, tg_chat_id, first_name) values (${ws.id}, ${CHAT_REC + 1}, 'Prueba <24h') returning id`;
  const [conv2] = await sql<{ id: string }[]>`insert into conversations (workspace_id, contact_id) values (${ws.id}, ${c2!.id}) returning id`;
  const convCtx2 = { contactId: c2!.id, conversationId: conv2!.id, isBlocked: false, state: "ai_active", aiEnabled: true };
  const inicioPronto = DateTime.now().setZone(ws.timezone).plus({ hours: 5 });
  const agendada2 = await agendarCita.run(
    { servicio: servicio.slug, inicio: inicioPronto.toISO()!, nombre_paciente: "Cita Pronta" },
    { workspace: ws1, conversation: convCtx2 as never },
  );
  comprobar("setup: cita a <24h agendada", agendada2.ok, JSON.stringify(agendada2));
  if (agendada2.ok) {
    const citaId2 = (agendada2.data as { cita_id: string }).cita_id;
    const recs2 = await sql<{ kind: string }[]>`select kind from reminders where appointment_id = ${citaId2}`;
    comprobar("solo se programó remind_2h (confirm_24h ya hubiera pasado, se omite)",
      recs2.length === 1 && recs2[0]!.kind === "remind_2h", JSON.stringify(recs2));
  }

  // ── 3 · Un recordatorio vencido se dispara con tickReminders() ─────────
  // `tickReminders()` manda por `enqueue()` (igual que todo lo demás en el
  // proyecto): queda en `outbound_queue`, no sale por fetch directo — por
  // eso se verifica ahí, no en `llamadasTg` (esa es para lo que SÍ pega a
  // la API directo: answerCallbackQuery, editMessage*).
  await sql`update reminders set send_at = now() - interval '1 second' where appointment_id = ${citaId} and kind = 'confirm_24h'`;
  const nEnviados = await tickReminders();
  comprobar("tickReminders() procesó al menos 1 recordatorio vencido", nEnviados >= 1, `${nEnviados}`);

  const [encolado] = await sql<{ payload: { text: string; reply_markup?: { inline_keyboard: { callback_data: string }[][] } } }[]>`
    select payload from outbound_queue where tg_chat_id = ${CHAT_REC} order by created_at desc limit 1`;
  const botonesConfirm = JSON.stringify(encolado?.payload.reply_markup ?? "");
  comprobar("confirm_24h se encoló con los 3 botones Confirmar/Reprogramar/Cancelar",
    botonesConfirm.includes("rc:") && botonesConfirm.includes("rp:") && botonesConfirm.includes("rx:"), botonesConfirm);

  const [recTrasEnvio] = await sql<{ status: string }[]>`
    select status from reminders where appointment_id = ${citaId} and kind = 'confirm_24h'`;
  comprobar("el recordatorio queda 'sent'", recTrasEnvio?.status === "sent");

  // ── 4 · remind_2h trae la dirección ─────────────────────────────────────
  await sql`update reminders set send_at = now() - interval '1 second', status = 'pending' where appointment_id = ${citaId} and kind = 'remind_2h'`;
  await tickReminders();
  const [encolado2h] = await sql<{ payload: { text: string } }[]>`
    select payload from outbound_queue where tg_chat_id = ${CHAT_REC} order by created_at desc limit 1`;
  comprobar("remind_2h trae la dirección de la sede", /Av 3A/.test(encolado2h?.payload.text ?? ""), encolado2h?.payload.text);

  // ── 5 · rc: confirma la cita ────────────────────────────────────────────
  const corto = apptCorto(citaId);
  await handleCallback(ws1, convCtx as never, evCallback({ queryId: "q1", data: `rc:${corto}`, chatId: CHAT_REC, messageId: 1, userId: 1 }));
  const [citaConfirmada] = await sql<{ status: string }[]>`select status from appointments where id = ${citaId}`;
  comprobar("'Confirmar' deja la cita en 'confirmed'", citaConfirmada?.status === "confirmed");

  // ── 6 · rp: → rb: reprograma (misma cita, mismo evento) ─────────────────
  const [eventoAntes] = await sql<{ gcal_event_id: string }[]>`select gcal_event_id from appointments where id = ${citaId}`;
  await handleCallback(ws1, convCtx as never, evCallback({ queryId: "q2", data: `rp:${corto}`, chatId: CHAT_REC, messageId: 2, userId: 1 }));

  const [avisoRp] = await sql<{ payload: { reply_markup?: { inline_keyboard: { callback_data: string }[][] } } }[]>`
    select payload from outbound_queue where tg_chat_id = ${CHAT_REC} order by created_at desc limit 1`;
  const botonesRp = JSON.stringify(avisoRp?.payload.reply_markup ?? "");
  comprobar("'Reprogramar' NO agenda: ofrece botones rb: con horarios reales", botonesRp.includes("rb:"), botonesRp);

  const primerRb = avisoRp!.payload.reply_markup!.inline_keyboard[0]![0]!.callback_data;
  llamadasTg.length = 0;
  await handleCallback(ws1, convCtx as never, evCallback({ queryId: "q3", data: primerRb, chatId: CHAT_REC, messageId: 3, userId: 1 }));

  const [citaMovida] = await sql<{ status: string; gcal_event_id: string }[]>`select status, gcal_event_id from appointments where id = ${citaId}`;
  comprobar("'Reprogramar' mueve la MISMA cita (status rescheduled)", citaMovida?.status === "rescheduled");
  comprobar("el gcal_event_id NO cambió (no se duplicó el evento)", citaMovida?.gcal_event_id === eventoAntes?.gcal_event_id);
  comprobar("sigue habiendo exactamente UN evento en el calendario simulado", eventosGoogle.size === 1 + 1); // + la cita <24h del paso 2

  // confirm_24h ya se mandó (paso 3) y no se reescribe: ese mensaje ya lo
  // tiene el paciente, no hay nada que "recalcular" de un envío pasado.
  // remind_2h SÍ estaba 'pending→sent' y, al moverse la cita, se recalcula
  // sobre la NUEVA hora — eso es lo que prueba que reprogramar no deja
  // recordatorios apuntando a un horario que ya no es.
  const recsTrasMover = await sql<{ kind: string; status: string }[]>`
    select kind, status from reminders where appointment_id = ${citaId}`;
  comprobar("siguen siendo exactamente 2 filas (upsert, no duplicado)", recsTrasMover.length === 2, JSON.stringify(recsTrasMover));
  comprobar("remind_2h se recalculó a 'pending' sobre la nueva hora",
    recsTrasMover.find((r) => r.kind === "remind_2h")?.status === "pending", JSON.stringify(recsTrasMover));

  // ── 7 · rx: cancela ───────────────────────────────────────────────────
  llamadasTg.length = 0;
  await handleCallback(ws1, convCtx as never, evCallback({ queryId: "q4", data: `rx:${corto}`, chatId: CHAT_REC, messageId: 4, userId: 1 }));
  const [citaCancelada] = await sql<{ status: string; gcal_event_id: string }[]>`select status, gcal_event_id from appointments where id = ${citaId}`;
  comprobar("'Cancelar' deja la cita en 'cancelled'", citaCancelada?.status === "cancelled");
  comprobar("el evento desaparece del calendario simulado", !eventosGoogle.has(citaCancelada!.gcal_event_id!));

  // Lo que importa es que nada quede 'pending': un recordatorio PENDIENTE
  // de una cita cancelada es peor que ninguno (el paciente se presenta). Lo
  // ya 'sent' (confirm_24h, del paso 3) es historia y no se toca; lo que
  // estaba 'pending' (remind_2h, recalculado en el paso 6) pasa a 'skipped'
  // — el enum `queue_status` no tiene valor 'cancelled'.
  const recsTrasCancelar = await sql<{ kind: string; status: string }[]>`
    select kind, status from reminders where appointment_id = ${citaId}`;
  comprobar("ningún recordatorio queda 'pending' tras cancelar",
    recsTrasCancelar.every((r) => r.status !== "pending"), JSON.stringify(recsTrasCancelar));
  comprobar("el que estaba pendiente (remind_2h) quedó 'skipped'",
    recsTrasCancelar.find((r) => r.kind === "remind_2h")?.status === "skipped", JSON.stringify(recsTrasCancelar));

  // ── 8 · Cero LLM en toda la prueba ──────────────────────────────────────
  const llm = (await sql<{ n: number }[]>`
    select count(*)::int as n from events where conversation_id = ${conv!.id} and type = 'llm_call'`)[0]!.n;
  comprobar("cero llm_call en toda la prueba", llm === 0);

  await limpiar();
}

async function limpiar() {
  await sql`delete from events where conversation_id in (
              select c.id from conversations c join contacts ct on ct.id=c.contact_id
               where ct.tg_chat_id between 999400000 and 999400999)`;
  await sql`delete from reminders where appointment_id in (
              select id from appointments where contact_id in (
                select id from contacts where tg_chat_id between 999400000 and 999400999))`;
  await sql`delete from appointments where contact_id in (
              select id from contacts where tg_chat_id between 999400000 and 999400999)`;
  await sql`delete from conversations where contact_id in (
              select id from contacts where tg_chat_id between 999400000 and 999400999)`;
  await sql`delete from contacts where tg_chat_id between 999400000 and 999400999`;
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n— recordatorios: todo OK" : `\n— recordatorios: ${fallos} fallo(s)`);
    process.exitCode = fallos === 0 ? 0 : 1;
  })
  .catch((e) => {
    console.log(`FAIL excepción — ${e instanceof Error ? e.stack ?? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(closeDb);
