/**
 * `agendar_cita` (spec 10), con Google Calendar SIMULADO vía global.fetch
 * (mismo patrón de 04/05/06/09) — incluyendo el intercambio de token OAuth,
 * para no necesitar credenciales reales. La base de datos es la REAL: el
 * índice único `uq_appt_slot` es el candado que se está probando, y un
 * mock no lo reemplaza.
 *
 * Cubre:
 *   - camino feliz: inserta en DB y en "Google", con hora correcta
 *   - reintento del insert a Google con el MISMO event id → 409 → sin duplicar
 *   - doble reserva CONCURRENTE del mismo slot → gana una, 23505 en la otra
 *   - slot_ocupado secuencial, con alternativas
 *   - muy_pronto (<2h) y fecha_invalida
 *   - el esquema Zod rechaza nombre_paciente corto (regla 6: nunca sin nombre)
 *   - se registra el evento `appointment`
 */
const CHAT_BASE = 999000000;

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

// `google-auth-library`/`gaxios` NO usan global.fetch (usan su propio
// `node-fetch` interno) — pisar global.fetch no las alcanza. Se simula un
// nivel más arriba: el intercambio OAuth2 se parchea en el prototipo de
// JWT, así que ni siquiera hace falta una clave RSA real para firmar.
const { JWT } = await import("google-auth-library");
JWT.prototype.getAccessToken = (async () => ({ token: "token-simulado-gcal" })) as never;

// ── Google Calendar simulado: el calendario vive en este Map mientras
// dure el proceso. Esto SÍ pasa por global.fetch porque src/gcal/events.ts
// usa fetch directo, sin gaxios de por medio.
const eventosGoogle = new Map<string, { id: string; htmlLink: string }>();

global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url instanceof Request ? url.url : url);
  const method = init?.method ?? (url instanceof Request ? url.method : "GET");

  // Alternativas de horario tras un slot_ocupado: no hay eventos ocupados
  // simulados, basta con responder "nada ocupado" para que el motor de
  // slots calcule sobre horario comercial limpio.
  if (u.includes("calendar/v3/freeBusy")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { items: { id: string }[] };
    const calendars = Object.fromEntries(body.items.map((it) => [it.id, { busy: [] }]));
    return new Response(JSON.stringify({ calendars }), { status: 200, headers: { "content-type": "application/json" } });
  }

  if (u.includes("calendar/v3/calendars/")) {
    const idEnPath = u.match(/\/events\/([^/?]+)/)?.[1];

    if (method === "POST" && u.includes("/events?")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { id: string; summary: string };
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
const { agendarCita } = await import("../../src/tools/agendar.js");
const { gcalInsertarEvento } = await import("../../src/gcal/events.js");
const { DateTime } = await import("luxon");

async function main() {
  const [ws] = await sql<{ id: string; slug: string; name: string; timezone: string }[]>`
    select id, slug, name, timezone from workspaces limit 1`;
  if (!ws) throw new Error("no hay workspace: corre npm run seed");

  const [servicio] = await sql<{ slug: string; duration_min: number }[]>`
    select slug, duration_min from services
     where workspace_id = ${ws.id} and slug = 'limpieza-dental'`;
  if (!servicio) throw new Error("no existe el servicio limpieza-dental: corre npm run seed");

  await limpiar(ws.id);

  const [c] = await sql<{ id: string }[]>`
    insert into contacts (workspace_id, tg_chat_id, first_name)
    values (${ws.id}, ${CHAT_BASE}, 'Prueba agendar') returning id`;
  const [conv] = await sql<{ id: string }[]>`
    insert into conversations (workspace_id, contact_id) values (${ws.id}, ${c!.id}) returning id`;

  const ctx = {
    workspace: { id: ws.id, slug: ws.slug, name: ws.name, timezone: ws.timezone } as never,
    conversation: { contactId: c!.id, conversationId: conv!.id } as never,
  };

  // Un horario sobradamente futuro: evita pelear con horario comercial/cierres.
  const inicio = DateTime.now().setZone(ws.timezone).plus({ days: 10 }).set({
    hour: 10, minute: 0, second: 0, millisecond: 0,
  });

  // ── 1 · Esquema: sin nombre completo, ni se intenta ───────────────────
  const rechazo = agendarCita.schema.safeParse({
    servicio: servicio.slug, inicio: inicio.toISO(), nombre_paciente: "Al",
  });
  comprobar("el esquema rechaza nombre_paciente < 3 caracteres (regla 6)", !rechazo.success);

  // ── 2 · fecha_invalida y muy_pronto ────────────────────────────────────
  const rFecha = await agendarCita.run(
    { servicio: servicio.slug, inicio: "no-es-una-fecha", nombre_paciente: "Carlos Ramírez" }, ctx);
  comprobar("fecha_invalida con un inicio no parseable", !rFecha.ok && rFecha.error === "fecha_invalida", JSON.stringify(rFecha));

  const rPronto = await agendarCita.run({
    servicio: servicio.slug,
    inicio: DateTime.now().setZone(ws.timezone).plus({ hours: 1 }).toISO()!,
    nombre_paciente: "Carlos Ramírez",
  }, ctx);
  comprobar("muy_pronto con <2h de anticipación", !rPronto.ok && rPronto.error.startsWith("muy_pronto"), JSON.stringify(rPronto));

  // ── 3 · Camino feliz ───────────────────────────────────────────────────
  const r1 = await agendarCita.run({
    servicio: servicio.slug, inicio: inicio.toISO()!, nombre_paciente: "Carlos Ramírez",
  }, ctx);
  comprobar("agenda la cita", r1.ok, JSON.stringify(r1));

  const [fila] = await sql<{
    id: string; starts_at: Date; gcal_event_id: string | null; patient_name: string;
  }[]>`select id, starts_at, gcal_event_id, patient_name from appointments where contact_id = ${c!.id}`;
  comprobar("la fila en DB existe con el nombre correcto", fila?.patient_name === "Carlos Ramírez");
  comprobar("la fila en DB tiene gcal_event_id", !!fila?.gcal_event_id);
  comprobar("la hora guardada es la correcta (sin corrimiento de 5h)",
    fila !== undefined && DateTime.fromJSDate(fila.starts_at).toMillis() === inicio.toMillis(),
    `esperado ${inicio.toISO()}, guardado ${fila ? DateTime.fromJSDate(fila.starts_at).toISO() : "(nada)"}`);
  comprobar("el evento quedó en el calendario simulado", eventosGoogle.has(fila!.gcal_event_id!));

  const eventoAppt = await sql<{ id: string }[]>`
    select id from events where conversation_id = ${conv!.id} and type = 'appointment'`;
  comprobar("se registró el evento appointment", eventoAppt.length === 1);

  // ── 4 · slot_ocupado secuencial, con alternativas ──────────────────────
  const r2 = await agendarCita.run({
    servicio: servicio.slug, inicio: inicio.toISO()!, nombre_paciente: "Otra Paciente",
  }, ctx);
  comprobar("un segundo intento al mismo horario → slot_ocupado", !r2.ok && r2.error === "slot_ocupado", JSON.stringify(r2));
  comprobar("slot_ocupado trae alternativas",
    !r2.ok && Array.isArray((r2.data as { alternativas?: unknown[] } | undefined)?.alternativas));

  // ── 5 · Reintento del insert en Google con el MISMO event id → 409 ─────
  const eventId = fila!.gcal_event_id!;
  const antesDeReintentar = eventosGoogle.size;
  const reintento = await gcalInsertarEvento({
    eventId, summary: "reintento", description: "reintento",
    start: inicio, end: inicio.plus({ minutes: servicio.duration_min }),
    timeZone: ws.timezone, apptId: fila!.id,
  });
  comprobar("el reintento con el mismo id devuelve el MISMO evento (409 manejado)", reintento.id === eventId);
  comprobar("no se duplicó el evento en el calendario", eventosGoogle.size === antesDeReintentar);

  // ── 6 · Doble reserva CONCURRENTE del mismo slot → gana una ────────────
  const inicio2 = inicio.plus({ days: 1 });
  const [resA, resB] = await Promise.all([
    agendarCita.run({ servicio: servicio.slug, inicio: inicio2.toISO()!, nombre_paciente: "Paciente Uno" }, ctx),
    agendarCita.run({ servicio: servicio.slug, inicio: inicio2.toISO()!, nombre_paciente: "Paciente Dos" }, ctx),
  ]);
  const ganadores = [resA, resB].filter((r) => r.ok).length;
  const ocupados = [resA, resB].filter((r) => !r.ok && (r as { error: string }).error === "slot_ocupado").length;
  comprobar("la concurrencia deja EXACTAMENTE un ganador", ganadores === 1, `ganadores=${ganadores}`);
  comprobar("y exactamente un slot_ocupado (23505 atrapado)", ocupados === 1, `ocupados=${ocupados}`);

  await limpiar(ws.id);
}

async function limpiar(workspaceId: string) {
  await sql`delete from events where conversation_id in (
              select c.id from conversations c join contacts ct on ct.id=c.contact_id
               where ct.tg_chat_id between ${CHAT_BASE} and ${CHAT_BASE + 999})`;
  await sql`delete from appointments where contact_id in (
              select id from contacts where tg_chat_id between ${CHAT_BASE} and ${CHAT_BASE + 999})`;
  await sql`delete from conversations where contact_id in (
              select id from contacts where tg_chat_id between ${CHAT_BASE} and ${CHAT_BASE + 999})`;
  await sql`delete from contacts where tg_chat_id between ${CHAT_BASE} and ${CHAT_BASE + 999} and workspace_id = ${workspaceId}`;
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n— agendar: todo OK" : `\n— agendar: ${fallos} fallo(s)`);
    process.exitCode = fallos === 0 ? 0 : 1;
  })
  .catch((e) => {
    console.log(`FAIL excepción — ${e instanceof Error ? e.stack ?? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(closeDb);
