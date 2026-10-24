/**
 * `reprogramar_cita` y `cancelar_cita` (spec 11), con Google Calendar
 * SIMULADO (mismo patrón que scripts/tests/agendar.ts). La base de datos es
 * la REAL: el índice único `uq_appt_slot` sigue siendo el candado real
 * contra doble reserva, también al reprogramar.
 *
 * Cubre:
 *   - reprogramar MUEVE el evento (mismo gcal_event_id, nueva hora)
 *   - el slot viejo queda libre (uq_appt_slot es sobre starts_at)
 *   - reprogramar a un slot ocupado → slot_ocupado con alternativas
 *   - reprogramar a <2h → muy_pronto
 *   - cancelar borra de Google (DELETE) y deja status='cancelled'
 *   - cancelar dos veces (evento ya borrado) → 410/404 tratado como éxito
 *   - un paciente no puede tocar la cita de otro (contact_id en el WHERE)
 *   - varias citas activas sin cita_id → cual_cita, no se asume la próxima
 */
const CHAT_A = 999100001;
const CHAT_B = 999100002;

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

global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url instanceof Request ? url.url : url);
  const method = init?.method ?? (url instanceof Request ? url.method : "GET");

  if (u.includes("calendar/v3/freeBusy")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { items: { id: string }[] };
    const calendars = Object.fromEntries(body.items.map((it) => [it.id, { busy: [] }]));
    return new Response(JSON.stringify({ calendars }), { status: 200, headers: { "content-type": "application/json" } });
  }

  if (u.includes("calendar/v3/calendars/")) {
    const idEnPath = u.match(/\/events\/([^/?]+)/)?.[1];

    if (method === "POST" && u.includes("/events?")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { id: string };
      if (eventosGoogle.has(body.id)) {
        return new Response(JSON.stringify({ error: { message: "ya existe" } }), { status: 409 });
      }
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
      if (!eventosGoogle.has(idEnPath)) return new Response(null, { status: 410 }); // ya borrado: éxito
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
const { reprogramarCita } = await import("../../src/tools/reprogramar.js");
const { cancelarCita } = await import("../../src/tools/cancelar.js");
const { DateTime } = await import("luxon");

async function nuevaConversacion(wsId: string, chatId: number, nombre: string) {
  const [c] = await sql<{ id: string }[]>`
    insert into contacts (workspace_id, tg_chat_id, first_name)
    values (${wsId}, ${chatId}, ${nombre}) returning id`;
  const [conv] = await sql<{ id: string }[]>`
    insert into conversations (workspace_id, contact_id) values (${wsId}, ${c!.id}) returning id`;
  return { contactId: c!.id, conversationId: conv!.id };
}

async function main() {
  const [ws] = await sql<{ id: string; slug: string; name: string; timezone: string }[]>`
    select id, slug, name, timezone from workspaces limit 1`;
  if (!ws) throw new Error("no hay workspace: corre npm run seed");

  const [servicio] = await sql<{ slug: string; duration_min: number }[]>`
    select slug, duration_min from services
     where workspace_id = ${ws.id} and slug = 'limpieza-dental'`;
  if (!servicio) throw new Error("no existe el servicio limpieza-dental: corre npm run seed");

  await limpiar();

  const wsCtx = { id: ws.id, slug: ws.slug, name: ws.name, timezone: ws.timezone } as never;
  const convA = await nuevaConversacion(ws.id, CHAT_A, "Paciente A");
  const convB = await nuevaConversacion(ws.id, CHAT_B, "Paciente B");
  const ctxA = { workspace: wsCtx, conversation: convA as never };
  const ctxB = { workspace: wsCtx, conversation: convB as never };

  const inicio = DateTime.now().setZone(ws.timezone).plus({ days: 12 }).set({
    hour: 9, minute: 0, second: 0, millisecond: 0,
  });

  // ── Preparar: agendar una cita para A ──────────────────────────────────
  const agendada = await agendarCita.run(
    { servicio: servicio.slug, inicio: inicio.toISO()!, nombre_paciente: "Paciente A" }, ctxA,
  );
  if (!agendada.ok) throw new Error(`setup falló: ${JSON.stringify(agendada)}`);
  const citaId = (agendada.data as { cita_id: string }).cita_id;
  const [filaInicial] = await sql<{ gcal_event_id: string }[]>`
    select gcal_event_id from appointments where id = ${citaId}`;
  const eventIdOriginal = filaInicial!.gcal_event_id;

  // ── 1 · Un paciente no puede tocar la cita de otro ─────────────────────
  const ajena = await reprogramarCita.run(
    { cita_id: citaId, nuevo_inicio: inicio.plus({ days: 1 }).toISO()! }, ctxB,
  );
  comprobar("B no puede reprogramar la cita de A", !ajena.ok && ajena.error === "cita_no_encontrada", JSON.stringify(ajena));

  // ── 2 · Reprogramar a <2h → muy_pronto ─────────────────────────────────
  const pronto = await reprogramarCita.run(
    { cita_id: citaId, nuevo_inicio: DateTime.now().setZone(ws.timezone).plus({ hours: 1 }).toISO()! }, ctxA,
  );
  comprobar("reprogramar a <2h → muy_pronto", !pronto.ok && pronto.error.startsWith("muy_pronto"), JSON.stringify(pronto));

  // ── 3 · Reprogramar mueve el evento: mismo id, nueva hora ──────────────
  const nuevoInicio = inicio.plus({ days: 2 }).set({ hour: 11 });
  const movida = await reprogramarCita.run(
    { cita_id: citaId, nuevo_inicio: nuevoInicio.toISO()! }, ctxA,
  );
  comprobar("reprogramar OK", movida.ok, JSON.stringify(movida));

  const [filaMovida] = await sql<{ status: string; starts_at: Date; gcal_event_id: string }[]>`
    select status, starts_at, gcal_event_id from appointments where id = ${citaId}`;
  comprobar("status pasa a 'rescheduled'", filaMovida?.status === "rescheduled");
  comprobar("el gcal_event_id NO cambió (PATCH, no recrear)", filaMovida?.gcal_event_id === eventIdOriginal);
  comprobar("la nueva hora quedó guardada",
    filaMovida !== undefined && DateTime.fromJSDate(filaMovida.starts_at).toMillis() === nuevoInicio.toMillis());
  comprobar("sigue habiendo exactamente UN evento en el calendario simulado (no se duplicó)",
    eventosGoogle.size === 1);

  // ── 4 · El slot viejo queda libre: otro paciente puede tomarlo ─────────
  const otroEnSlotViejo = await agendarCita.run(
    { servicio: servicio.slug, inicio: inicio.toISO()!, nombre_paciente: "Paciente B" }, ctxB,
  );
  comprobar("el slot original liberado se puede volver a reservar", otroEnSlotViejo.ok, JSON.stringify(otroEnSlotViejo));

  // ── 5 · Reprogramar a un slot ocupado → slot_ocupado con alternativas ──
  // B ya está en `inicio` (paso 4). A intenta moverse justo ahí.
  const chocada = await reprogramarCita.run({ cita_id: citaId, nuevo_inicio: inicio.toISO()! }, ctxA);
  comprobar("reprogramar a un slot ocupado → slot_ocupado", !chocada.ok && chocada.error === "slot_ocupado", JSON.stringify(chocada));
  comprobar("slot_ocupado trae alternativas",
    !chocada.ok && Array.isArray((chocada.data as { alternativas?: unknown[] } | undefined)?.alternativas));

  // ── 6 · Varias citas activas sin cita_id → cual_cita ───────────────────
  const segundaCitaA = await agendarCita.run(
    { servicio: servicio.slug, inicio: inicio.plus({ days: 5 }).toISO()!, nombre_paciente: "Paciente A" }, ctxA,
  );
  comprobar("setup: segunda cita de A agendada", segundaCitaA.ok, JSON.stringify(segundaCitaA));

  const ambigua = await cancelarCita.run({}, ctxA);
  comprobar("sin cita_id y con 2 citas activas → cual_cita (no asume la próxima)",
    !ambigua.ok && ambigua.error === "cual_cita", JSON.stringify(ambigua));
  comprobar("cual_cita trae la lista de citas",
    !ambigua.ok && Array.isArray((ambigua.data as { citas?: unknown[] } | undefined)?.citas)
      && (ambigua.data as { citas: unknown[] }).citas.length === 2);

  // ── 7 · Cancelar borra de Google y deja 'cancelled' ────────────────────
  const cancelada = await cancelarCita.run({ cita_id: citaId, motivo: "cambio de planes" }, ctxA);
  comprobar("cancelar OK", cancelada.ok, JSON.stringify(cancelada));
  comprobar("ya no está en el calendario simulado", !eventosGoogle.has(eventIdOriginal!));

  const [filaCancelada] = await sql<{ status: string; cancel_reason: string | null }[]>`
    select status, cancel_reason from appointments where id = ${citaId}`;
  comprobar("status pasa a 'cancelled'", filaCancelada?.status === "cancelled");
  comprobar("se guardó el motivo", filaCancelada?.cancel_reason === "cambio de planes");

  // ── 8 · Cancelar un evento YA borrado (410/404) no es un error ─────────
  const [filaSegundaA] = await sql<{ id: string; gcal_event_id: string }[]>`
    select id, gcal_event_id from appointments
     where contact_id = ${convA.contactId} and status != 'cancelled' limit 1`;
  eventosGoogle.delete(filaSegundaA!.gcal_event_id); // simula que alguien ya lo borró a mano en Google
  const segundaCancelacion = await cancelarCita.run({ cita_id: filaSegundaA!.id }, ctxA);
  comprobar("cancelar con el evento ya borrado en Google (410/404) no falla", segundaCancelacion.ok, JSON.stringify(segundaCancelacion));

  // ── 9 · Cancelar una cita que no existe → error legible ────────────────
  const inexistente = await cancelarCita.run({ cita_id: "00000000-0000-0000-0000-000000000000" }, ctxA);
  comprobar("cancelar cita inexistente → error legible, no explota",
    !inexistente.ok && inexistente.error === "cita_no_encontrada", JSON.stringify(inexistente));

  await limpiar();
}

async function limpiar() {
  await sql`delete from events where conversation_id in (
              select c.id from conversations c join contacts ct on ct.id=c.contact_id
               where ct.tg_chat_id between 999100000 and 999100999)`;
  await sql`delete from reminders where appointment_id in (
              select id from appointments where contact_id in (
                select id from contacts where tg_chat_id between 999100000 and 999100999))`;
  await sql`delete from appointments where contact_id in (
              select id from contacts where tg_chat_id between 999100000 and 999100999)`;
  await sql`delete from conversations where contact_id in (
              select id from contacts where tg_chat_id between 999100000 and 999100999)`;
  await sql`delete from contacts where tg_chat_id between 999100000 and 999100999`;
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n— reprogramar-cancelar: todo OK" : `\n— reprogramar-cancelar: ${fallos} fallo(s)`);
    process.exitCode = fallos === 0 ? 0 : 1;
  })
  .catch((e) => {
    console.log(`FAIL excepción — ${e instanceof Error ? e.stack ?? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(closeDb);
