/**
 * Handoff al grupo interno (spec 13), con Telegram SIMULADO (mismo patrón
 * que outbox.ts). La base de datos es la REAL.
 *
 * Cubre:
 *   - escalar_a_humano: pasa a handoff_pending, avisa al grupo con botones,
 *     registra handoff_relay y el evento `handoff`
 *   - paciente → grupo: un mensaje en human_active/handoff_pending se
 *     relaya como reply al aviso
 *   - take: primero en tocar gana → human_active + assigned_to, se edita
 *     el mensaje del grupo mostrando quién la tomó
 *   - take: una segunda persona tocando DESPUÉS → "ya la tomó alguien más"
 *   - grupo → paciente: responder al aviso llega al chat del paciente
 *   - back: vuelve a ai_active, assigned_to limpio, y el resumen de lo que
 *     dijo el humano queda inyectado en conversations.summary
 *   - el chat_id del grupo se guarda y se usa CON su signo negativo
 */
const CHAT_PACIENTE = 999300001;
const HANDOFF_CHAT_ID = -1009990003001; // negativo: es un grupo

let fallos = 0;
const comprobar = (nombre: string, cond: boolean, detalle = "") => {
  if (cond) console.log(`OK   ${nombre}`);
  else { console.log(`FAIL ${nombre}${detalle ? ` — ${detalle}` : ""}`); fallos++; }
};

process.env.TELEGRAM_BOT_TOKEN ||= "token-simulado";
process.env.DEEPSEEK_API_KEY ||= "clave-simulada";
process.env.TELEGRAM_HANDOFF_CHAT_ID ||= String(HANDOFF_CHAT_ID);

type LlamadaTg = { metodo: string; body: Record<string, unknown> };
const llamadasTg: LlamadaTg[] = [];
let siguienteMessageId = 9000;

global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url instanceof Request ? url.url : url);
  const metodo = u.split("/").pop() ?? "";
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  llamadasTg.push({ metodo, body });

  if (metodo === "sendMessage") {
    return new Response(JSON.stringify({
      ok: true, result: { message_id: siguienteMessageId++, chat: { id: body.chat_id } },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({ ok: true, result: true }), {
    status: 200, headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

const { closeDb, sql } = await import("../../src/db/client.js");
const { escalarAHumano } = await import("../../src/tools/escalar.js");
const { handleCallback } = await import("../../src/handlers/callbacks.js");
const { convCorto } = await import("../../src/handoff/group.js");
const { relayGrupoAPaciente } = await import("../../src/handoff/relay.js");

function evCallback(opts: { queryId: string; data: string; messageId: number; userId: number; username?: string }) {
  return {
    updateId: 1, chatId: HANDOFF_CHAT_ID, userId: opts.userId, kind: "callback" as const,
    callbackData: opts.data, callbackQueryId: opts.queryId, callbackMessageText: "🔔 Handoff · prueba",
    text: opts.data, messageId: opts.messageId, ts: Date.now(),
    from: { firstName: "Asesora", username: opts.username }, raw: {},
  };
}

async function main() {
  const [wsRow] = await sql<{ id: string; slug: string; name: string; timezone: string }[]>`
    select id, slug, name, timezone from workspaces limit 1`;
  if (!wsRow) throw new Error("no hay workspace: corre npm run seed");

  await limpiar();

  const [c] = await sql<{ id: string }[]>`
    insert into contacts (workspace_id, tg_chat_id, first_name)
    values (${wsRow.id}, ${CHAT_PACIENTE}, 'Prueba handoff') returning id`;
  const [conv] = await sql<{ id: string }[]>`
    insert into conversations (workspace_id, contact_id) values (${wsRow.id}, ${c!.id}) returning id`;

  const ws = { ...wsRow, handoffChatId: HANDOFF_CHAT_ID, webhookSecret: null, webhookPath: null,
    bufferMs: 12000, bufferMaxMs: 75000, bufferMaxMsgs: 15 } as never;
  const convCtx = { contactId: c!.id, conversationId: conv!.id, isBlocked: false, state: "ai_active", aiEnabled: true };

  // ── 1 · escalar_a_humano avisa al grupo y pausa la IA ──────────────────
  const r = await escalarAHumano.run({ motivo: "quiere hablar con una persona" }, { workspace: ws, conversation: convCtx as never });
  comprobar("escalar_a_humano responde ok con el mensaje al paciente", r.ok, JSON.stringify(r));

  const [convTrasEscalar] = await sql<{ state: string }[]>`select state from conversations where id = ${conv!.id}`;
  comprobar("la conversación pasa a 'handoff_pending'", convTrasEscalar?.state === "handoff_pending");

  const avisoLlamada = llamadasTg.find((l) => l.metodo === "sendMessage" && l.body.chat_id === HANDOFF_CHAT_ID);
  comprobar("se avisó al grupo, con su chat_id NEGATIVO", !!avisoLlamada, JSON.stringify(avisoLlamada));
  const botonesAviso = (avisoLlamada?.body.reply_markup as { inline_keyboard: { callback_data: string }[][] } | undefined)
    ?.inline_keyboard.flat().map((b) => b.callback_data) ?? [];
  const corto = convCorto(conv!.id);
  comprobar("el aviso trae los botones Tomar y Devolver",
    botonesAviso.includes(`take:${corto}`) && botonesAviso.includes(`back:${corto}`), JSON.stringify(botonesAviso));

  const [relay] = await sql<{ group_message_id: string }[]>`
    select group_message_id from handoff_relay where conversation_id = ${conv!.id}`;
  comprobar("se registró el puente en handoff_relay", !!relay);
  const groupMessageId = Number(relay!.group_message_id);

  const [eventoHandoff] = await sql<{ payload: { reason: string } }[]>`
    select payload from events where conversation_id = ${conv!.id} and type = 'handoff' order by created_at asc limit 1`;
  comprobar("se registró el evento handoff con su motivo",
    eventoHandoff?.payload.reason === "quiere hablar con una persona", JSON.stringify(eventoHandoff));

  // ── 2 · paciente → grupo (se relaya como reply al aviso) ───────────────
  llamadasTg.length = 0;
  const { relayPacienteAGrupo } = await import("../../src/handoff/relay.js");
  await relayPacienteAGrupo(ws, convCtx as never, "¿ya me pueden atender?");
  const relayPaciente = llamadasTg.find((l) => l.metodo === "sendMessage");
  comprobar("el mensaje del paciente llega al hilo del grupo",
    relayPaciente?.body.chat_id === HANDOFF_CHAT_ID && relayPaciente?.body.reply_to_message_id === groupMessageId,
    JSON.stringify(relayPaciente));

  // ── 3 · take: dos personas tocan, solo una gana ────────────────────────
  llamadasTg.length = 0;
  await handleCallback(ws, convCtx as never, evCallback({
    queryId: "take1", data: `take:${corto}`, messageId: groupMessageId, userId: 222, username: "asesora_ana",
  }));
  const [convTomada] = await sql<{ state: string; assigned_to: string }[]>`
    select state, assigned_to from conversations where id = ${conv!.id}`;
  comprobar("'Tomar' pasa a human_active con assigned_to", convTomada?.state === "human_active" && Number(convTomada.assigned_to) === 222);
  comprobar("se edita el mensaje del grupo mostrando quién la tomó",
    llamadasTg.some((l) => l.metodo === "editMessageText" && String(l.body.text).includes("asesora_ana")));

  const [eventoTake] = await sql<{ payload: { reason: string; takenBy: number; waitedMs: number } }[]>`
    select payload from events where conversation_id = ${conv!.id} and type = 'handoff' and payload->>'reason' = 'take'`;
  comprobar("el evento de take trae reason/takenBy/waitedMs",
    eventoTake?.payload.takenBy === 222 && typeof eventoTake?.payload.waitedMs === "number", JSON.stringify(eventoTake));

  llamadasTg.length = 0;
  await handleCallback(ws, convCtx as never, evCallback({
    queryId: "take2", data: `take:${corto}`, messageId: groupMessageId, userId: 333,
  }));
  const yaLaTomo = llamadasTg.find((l) => l.metodo === "answerCallbackQuery" && l.body.callback_query_id === "take2");
  comprobar("una segunda persona tocando 'Tomar' → avisa que ya la tomaron, no la reasigna",
    yaLaTomo?.body.show_alert === true, JSON.stringify(yaLaTomo));
  const [convSigueAna] = await sql<{ assigned_to: string }[]>`select assigned_to from conversations where id = ${conv!.id}`;
  comprobar("sigue asignada a quien la tomó primero", Number(convSigueAna?.assigned_to) === 222);

  // ── 4 · La IA calla en human_active ─────────────────────────────────────
  const llmAntes = (await sql<{ n: number }[]>`
    select count(*)::int as n from events where conversation_id = ${conv!.id} and type = 'llm_call'`)[0]!.n;
  comprobar("cero llm_call en toda la prueba (nunca se llamó al agente)", llmAntes === 0);

  // ── 5 · Grupo → paciente: responder al aviso llega al chat del paciente ─
  const llegó = await relayGrupoAPaciente(ws, groupMessageId, "ya te separo la cita, dame un momento", 222);
  comprobar("responder al aviso en el grupo SÍ relaya al paciente", llegó);
  const [outboundRelay] = await sql<{ n: number }[]>`
    select count(*)::int as n from outbound_queue
     where tg_chat_id = ${CHAT_PACIENTE} and payload->>'text' = 'ya te separo la cita, dame un momento'`;
  comprobar("quedó en la cola de salida del paciente", outboundRelay!.n === 1);
  const [msgHumano] = await sql<{ sender_tg_id: string }[]>`
    select sender_tg_id from messages where conversation_id = ${conv!.id} and direction = 'out' and sender_tg_id is not null`;
  comprobar("el mensaje humano queda con su sender_tg_id (no es la IA)", Number(msgHumano?.sender_tg_id) === 222);

  const noRelay = await relayGrupoAPaciente(ws, 123456789, "respondiendo otra cosa", 222);
  comprobar("responder a OTRO mensaje del grupo (sin handoff) no relaya nada", noRelay === false);

  // ── 6 · back: vuelve a la IA con el resumen del humano inyectado ────────
  llamadasTg.length = 0;
  await handleCallback(ws, convCtx as never, evCallback({
    queryId: "back1", data: `back:${corto}`, messageId: groupMessageId, userId: 222, username: "asesora_ana",
  }));
  const [convDevuelta] = await sql<{ state: string; assigned_to: string | null; summary: string | null }[]>`
    select state, assigned_to, summary from conversations where id = ${conv!.id}`;
  comprobar("'Devolver' pasa a ai_active", convDevuelta?.state === "ai_active");
  comprobar("assigned_to queda limpio", convDevuelta?.assigned_to === null);
  comprobar("el resumen de lo que dijo el humano queda en conversations.summary",
    !!convDevuelta?.summary?.includes("ya te separo la cita"), JSON.stringify(convDevuelta?.summary));
  comprobar("se edita el mensaje del grupo mostrando que se devolvió",
    llamadasTg.some((l) => l.metodo === "editMessageText" && String(l.body.text).includes("Devuelta")));

  await limpiar();
}

async function limpiar() {
  await sql`delete from events where conversation_id in (
              select c.id from conversations c join contacts ct on ct.id=c.contact_id
               where ct.tg_chat_id between 999300000 and 999300999)`;
  await sql`delete from outbound_queue where tg_chat_id between 999300000 and 999300999`;
  await sql`delete from handoff_relay where conversation_id in (
              select c.id from conversations c join contacts ct on ct.id=c.contact_id
               where ct.tg_chat_id between 999300000 and 999300999)`;
  await sql`delete from messages where conversation_id in (
              select c.id from conversations c join contacts ct on ct.id=c.contact_id
               where ct.tg_chat_id between 999300000 and 999300999)`;
  await sql`delete from conversations where contact_id in (
              select id from contacts where tg_chat_id between 999300000 and 999300999)`;
  await sql`delete from contacts where tg_chat_id between 999300000 and 999300999`;
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n— handoff: todo OK" : `\n— handoff: ${fallos} fallo(s)`);
    process.exitCode = fallos === 0 ? 0 : 1;
  })
  .catch((e) => {
    console.log(`FAIL excepción — ${e instanceof Error ? e.stack ?? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(closeDb);
