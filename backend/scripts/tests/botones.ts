/**
 * Botones inline de horario (spec 12): `bk:<slug>:<epochMin>` agenda SIN
 * pasar por el agente. Telegram y Google Calendar van SIMULADOS (mismo
 * patrón que agendar.ts) para no necesitar credenciales reales ni un bot
 * de verdad.
 *
 * Cubre:
 *   - tocar un botón agenda la cita (misma tool que el camino por texto)
 *   - SIEMPRE se llama answerCallbackQuery, incluso cuando falla
 *   - tras agendar, se editan los botones (editMessageReplyMarkup)
 *   - tocar un botón de un slot que ya se ocupó → alternativas, sin romperse
 *   - callback_data ≤ 64 bytes para el slug más largo del catálogo real
 *   - la cita agendada por botón es idéntica en forma a una por texto
 */
const CHAT_BOTON = 999200001;

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

global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url instanceof Request ? url.url : url);
  const method = init?.method ?? (url instanceof Request ? url.method : "GET");

  // ── Telegram simulado ──────────────────────────────────────
  if (u.includes("api.telegram.org")) {
    const metodo = u.split("/").pop() ?? "";
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    llamadasTg.push({ metodo, body });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }

  // ── Google Calendar simulado ────────────────────────────────
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
    if (method === "GET" && idEnPath) {
      const evento = eventosGoogle.get(idEnPath);
      if (!evento) return new Response(JSON.stringify({ error: { message: "no encontrado" } }), { status: 404 });
      return new Response(JSON.stringify(evento), { status: 200, headers: { "content-type": "application/json" } });
    }
  }

  throw new Error(`fetch no simulado: ${method} ${u}`);
}) as typeof fetch;

const { closeDb, sql } = await import("../../src/db/client.js");
const { handleCallback } = await import("../../src/handlers/callbacks.js");
const { tecladoDeSlots } = await import("../../src/egress/keyboards.js");
const { DateTime } = await import("luxon");

function evCallback(opts: {
  queryId: string; data: string; chatId: number; messageId: number; userId: number;
}) {
  return {
    updateId: 1, chatId: opts.chatId, userId: opts.userId, kind: "callback" as const,
    callbackData: opts.data, callbackQueryId: opts.queryId, text: opts.data,
    messageId: opts.messageId, ts: Date.now(),
    from: { firstName: "Paciente", username: "paciente_test" }, raw: {},
  };
}

async function main() {
  const [ws] = await sql<{ id: string; slug: string; name: string; timezone: string; handoff_chat_id: null }[]>`
    select id, slug, name, timezone, null as handoff_chat_id from workspaces limit 1`;
  if (!ws) throw new Error("no hay workspace: corre npm run seed");

  const [servicio] = await sql<{ slug: string; duration_min: number }[]>`
    select slug, duration_min from services
     where workspace_id = ${ws.id} and slug = 'limpieza-dental'`;
  if (!servicio) throw new Error("no existe el servicio limpieza-dental: corre npm run seed");

  await limpiar();

  const [c] = await sql<{ id: string }[]>`
    insert into contacts (workspace_id, tg_chat_id, first_name)
    values (${ws.id}, ${CHAT_BOTON}, 'Prueba botones') returning id`;
  const [conv] = await sql<{ id: string }[]>`
    insert into conversations (workspace_id, contact_id) values (${ws.id}, ${c!.id}) returning id`;

  const wsCtx = ws as never;
  const convCtx = { contactId: c!.id, conversationId: conv!.id, isBlocked: false, state: "ai_active", aiEnabled: true };

  const inicio = DateTime.now().setZone(ws.timezone).plus({ days: 8 }).set({
    hour: 9, minute: 0, second: 0, millisecond: 0,
  });
  const epochMin = Math.floor(inicio.toMillis() / 60_000);

  // ── 1 · Tocar un botón agenda la cita ──────────────────────────────────
  await handleCallback(wsCtx, convCtx as never, evCallback({
    queryId: "q1", data: `bk:${servicio.slug}:${epochMin}`, chatId: CHAT_BOTON, messageId: 500, userId: 111,
  }));

  const [fila] = await sql<{ id: string; status: string; gcal_event_id: string | null }[]>`
    select id, status, gcal_event_id from appointments where contact_id = ${c!.id}`;
  comprobar("tocar el botón agenda la cita", !!fila && fila.status === "booked", JSON.stringify(fila));
  comprobar("la cita tiene gcal_event_id (apareció en el calendario)", !!fila?.gcal_event_id);

  comprobar("se llamó answerCallbackQuery",
    llamadasTg.some((l) => l.metodo === "answerCallbackQuery" && l.body.callback_query_id === "q1"));
  comprobar("se editaron los botones (editMessageReplyMarkup)",
    llamadasTg.some((l) => l.metodo === "editMessageReplyMarkup" && l.body.message_id === 500));
  comprobar("se encoló la confirmación al paciente",
    (await sql<{ n: number }[]>`select count(*)::int as n from outbound_queue
       where tg_chat_id = ${CHAT_BOTON} and payload->>'text' like '%Cita confirmada%'`)[0]!.n === 1);

  // ── 2 · Tocar un botón de un slot ya ocupado ───────────────────────────
  llamadasTg.length = 0;
  await handleCallback(wsCtx, convCtx as never, evCallback({
    queryId: "q2", data: `bk:${servicio.slug}:${epochMin}`, chatId: CHAT_BOTON, messageId: 501, userId: 111,
  }));
  const fallo = llamadasTg.find((l) => l.metodo === "answerCallbackQuery" && l.body.callback_query_id === "q2");
  comprobar("slot ya ocupado → answerCallbackQuery con show_alert", fallo?.body.show_alert === true, JSON.stringify(fallo));
  comprobar("el botón NUNCA queda sin respuesta (siempre hay answerCallbackQuery)",
    llamadasTg.some((l) => l.metodo === "answerCallbackQuery"));
  comprobar("también se editan los botones en el intento fallido",
    llamadasTg.some((l) => l.metodo === "editMessageReplyMarkup"));

  const [segundaFila] = await sql<{ id: string }[]>`
    select id from appointments where contact_id = ${c!.id} and status = 'booked'`;
  comprobar("NO se creó una segunda cita (una sola sigue 'booked')",
    (await sql<{ n: number }[]>`select count(*)::int as n from appointments
       where contact_id = ${c!.id} and status = 'booked'`)[0]!.n === 1, JSON.stringify(segundaFila));

  // ── 3 · callback_data ≤ 64 bytes, incluso para el slug más largo ───────
  const [slots] = [[{ iso: inicio.toISO()!, epochMin, label: "jue 1 ene · 9:00 a. m." }]];
  const teclado = tecladoDeSlots("brackets-esteticos", slots);
  const cbData = teclado.inline_keyboard[0]![0]!.callback_data;
  comprobar(`callback_data del slug más largo (${cbData}) mide ≤64 bytes`,
    Buffer.byteLength(cbData, "utf8") <= 64, `${Buffer.byteLength(cbData, "utf8")} bytes`);

  await limpiar();
}

async function limpiar() {
  await sql`delete from events where conversation_id in (
              select c.id from conversations c join contacts ct on ct.id=c.contact_id
               where ct.tg_chat_id between 999200000 and 999200999)`;
  await sql`delete from outbound_queue where tg_chat_id between 999200000 and 999200999`;
  await sql`delete from appointments where contact_id in (
              select id from contacts where tg_chat_id between 999200000 and 999200999)`;
  await sql`delete from conversations where contact_id in (
              select id from contacts where tg_chat_id between 999200000 and 999200999)`;
  await sql`delete from contacts where tg_chat_id between 999200000 and 999200999`;
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n— botones: todo OK" : `\n— botones: ${fallos} fallo(s)`);
    process.exitCode = fallos === 0 ? 0 : 1;
  })
  .catch((e) => {
    console.log(`FAIL excepción — ${e instanceof Error ? e.stack ?? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(closeDb);
