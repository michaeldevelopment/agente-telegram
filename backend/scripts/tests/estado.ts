/**
 * Integración real contra la base: transitionState, getEstadoConversacion,
 * y el motor de decisión enganchado al cierre del buffer (spec 06 + 07
 * juntas). Telegram y DeepSeek SIMULADOS, igual que en buffer.ts (spec 06).
 */

const CHAT_BASE = 994000000;

let fallos = 0;
const comprobar = (nombre: string, cond: boolean, detalle = "") => {
  if (cond) console.log(`OK   ${nombre}`);
  else { console.log(`FAIL ${nombre}${detalle ? ` — ${detalle}` : ""}`); fallos++; }
};

// ── Telegram y DeepSeek simulados ────────────────────────────
const llamadasDeepSeek: unknown[] = [];
const jsonRes = (obj: unknown) =>
  new Response(JSON.stringify(obj), { status: 200, headers: { "content-type": "application/json" } });

global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  if (u.includes("api.deepseek.com")) {
    llamadasDeepSeek.push(JSON.parse(String(init?.body ?? "{}")));
    return jsonRes({
      id: "sim", choices: [{ index: 0, message: { role: "assistant", content: "Respuesta simulada." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 50, completion_tokens: 5, prompt_cache_hit_tokens: 40, prompt_cache_miss_tokens: 10 },
    });
  }
  if (u.includes("api.telegram.org")) {
    return jsonRes({ ok: true, result: { message_id: 1, chat: { id: 0 } } });
  }
  throw new Error(`fetch no simulado para: ${u}`);
}) as typeof fetch;

process.env.TELEGRAM_BOT_TOKEN ||= "token-simulado";
process.env.DEEPSEEK_API_KEY ||= "clave-simulada";

const { closeDb, sql } = await import("../../src/db/client.js");
const { transitionState, getEstadoConversacion } = await import("../../src/runtime/state.js");
const { appendToBuffer } = await import("../../src/runtime/buffer.js");

async function nuevaConversacion(wsId: string, chatId: number) {
  const [c] = await sql<{ id: string }[]>`
    insert into contacts (workspace_id, tg_chat_id, first_name)
    values (${wsId}, ${chatId}, 'Prueba estado') returning id`;
  const [conv] = await sql<{ id: string }[]>`
    insert into conversations (workspace_id, contact_id) values (${wsId}, ${c!.id}) returning id`;
  return { contactId: c!.id, conversationId: conv!.id };
}

async function insertarMensajeIn(wsId: string, conversationId: string, texto: string): Promise<string> {
  const [m] = await sql<{ id: string }[]>`
    insert into messages (workspace_id, conversation_id, direction, kind, body)
    values (${wsId}, ${conversationId}, 'in', 'text', ${texto}) returning id`;
  return m!.id;
}

async function esperar<T>(fn: () => Promise<T | undefined>, msMaximo: number): Promise<T | undefined> {
  const limite = Date.now() + msMaximo;
  while (Date.now() < limite) {
    const r = await fn();
    if (r !== undefined) return r;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return undefined;
}

async function main() {
  const [wsRow] = await sql<{
    id: string; slug: string; name: string; timezone: string;
  }[]>`select id, slug, name, timezone from workspaces limit 1`;
  if (!wsRow) throw new Error("no hay workspace: corre npm run seed");

  await limpiar();

  const ws = { ...wsRow, webhookSecret: null, handoffChatId: null, webhookPath: null, bufferMs: 500, bufferMaxMs: 60_000, bufferMaxMsgs: 50 };

  // ════════════════════════════════════════════════════════
  // 1 · transitionState: registra el from/to correcto
  // ════════════════════════════════════════════════════════
  console.log("\n── transitionState ──");
  {
    const conv = await nuevaConversacion(ws.id, CHAT_BASE + 1);
    const { from, to } = await transitionState(ws, conv.conversationId, "paused", "command:/humano");
    comprobar("from=ai_active (el default), to=paused", from === "ai_active" && to === "paused",
      `${from} → ${to}`);

    const [ev] = await sql<{ p: { from: string; to: string; reason: string } }[]>`
      select payload as p from events where type='state_change' and conversation_id=${conv.conversationId}
       order by created_at desc limit 1`;
    comprobar("queda registrado en events con from/to/reason",
      ev?.p?.from === "ai_active" && ev?.p?.to === "paused" && ev?.p?.reason === "command:/humano",
      JSON.stringify(ev?.p));

    const n0 = (await sql<{ n: number }[]>`select count(*)::int as n from events where type='state_change'
                 and conversation_id=${conv.conversationId}`)[0]!.n;
    await transitionState(ws, conv.conversationId, "paused", "otra vez lo mismo");
    const n1 = (await sql<{ n: number }[]>`select count(*)::int as n from events where type='state_change'
                 and conversation_id=${conv.conversationId}`)[0]!.n;
    comprobar("una transición SIN CAMBIO REAL (paused→paused) no duplica el evento", n1 === n0, `${n0} → ${n1}`);
  }

  // ════════════════════════════════════════════════════════
  // 2 · getEstadoConversacion: lectura fresca
  // ════════════════════════════════════════════════════════
  console.log("\n── getEstadoConversacion ──");
  {
    const conv = await nuevaConversacion(ws.id, CHAT_BASE + 2);
    const antes = await getEstadoConversacion(conv.conversationId);
    comprobar("arranca en ai_active, sin bloquear, con la IA activa",
      antes?.state === "ai_active" && antes.isBlocked === false && antes.aiEnabled === true,
      JSON.stringify(antes));

    await transitionState(ws, conv.conversationId, "human_active", "prueba");
    const despues = await getEstadoConversacion(conv.conversationId);
    comprobar("refleja el cambio de inmediato (sin cache)", despues?.state === "human_active");

    const nula = await getEstadoConversacion("00000000-0000-0000-0000-000000000000");
    comprobar("conversación inexistente → null, no explota", nula === null);
  }

  // ════════════════════════════════════════════════════════
  // 3 · El buffer respeta el estado FRESCO al cerrar (la pieza central
  //     de esta spec: cierra la ventana de carrera de hasta 75 s)
  // ════════════════════════════════════════════════════════
  console.log("\n── El cierre del lote respeta /humano llegado a mitad de camino ──");
  {
    const conv = await nuevaConversacion(ws.id, CHAT_BASE + 3);

    // Dos mensajes libres entran al buffer...
    const m1 = await insertarMensajeIn(ws.id, conv.conversationId, "hola");
    await appendToBuffer(ws, { contactId: conv.contactId, conversationId: conv.conversationId,
                               isBlocked: false, state: "ai_active", aiEnabled: true },
                         m1, CHAT_BASE + 3);

    // ...y ANTES de que cierre el lote (bufferMs=500ms da margen), el
    // paciente pide humano. En producción esto llega por un comando aparte
    // que NO pasa por el buffer; aquí se simula tal cual: la transición de
    // estado ocurre a mitad del silencio del lote que ya estaba abierto.
    await transitionState(ws, conv.conversationId, "paused", "command:/humano");

    const llamadasAntes = llamadasDeepSeek.length;
    const skip = await esperar(async () => {
      const [e] = await sql<{ id: string }[]>`
        select id from events where type='agent_skipped' and conversation_id=${conv.conversationId} limit 1`;
      return e;
    }, 4000);

    comprobar("el lote se marca 'agent_skipped' en vez de llamar al agente",
      skip !== undefined);
    comprobar("y de verdad NO se llamó a DeepSeek para este lote",
      llamadasDeepSeek.length === llamadasAntes, `antes=${llamadasAntes} despues=${llamadasDeepSeek.length}`);

    const [lote] = await sql<{ status: string }[]>`
      select status from message_batches where conversation_id=${conv.conversationId}`;
    comprobar("el lote igual queda 'done' (no se reintenta infinitamente)", lote?.status === "done");
  }

  console.log(`\nDeepSeek simulado recibió ${llamadasDeepSeek.length} llamada(s) en total.`);
  await limpiar();
}

async function limpiar() {
  await sql`delete from messages where conversation_id in (
              select c.id from conversations c join contacts ct on ct.id=c.contact_id
               where ct.tg_chat_id between ${CHAT_BASE} and ${CHAT_BASE + 999})`;
  await sql`delete from message_batches where conversation_id in (
              select c.id from conversations c join contacts ct on ct.id=c.contact_id
               where ct.tg_chat_id between ${CHAT_BASE} and ${CHAT_BASE + 999})`;
  await sql`delete from events where conversation_id in (
              select c.id from conversations c join contacts ct on ct.id=c.contact_id
               where ct.tg_chat_id between ${CHAT_BASE} and ${CHAT_BASE + 999})`;
  await sql`delete from outbound_queue where tg_chat_id between ${CHAT_BASE} and ${CHAT_BASE + 999}`;
  await sql`delete from conversations where contact_id in (
              select id from contacts where tg_chat_id between ${CHAT_BASE} and ${CHAT_BASE + 999})`;
  await sql`delete from contacts where tg_chat_id between ${CHAT_BASE} and ${CHAT_BASE + 999}`;
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n— estado: todo OK" : `\n— estado: ${fallos} fallo(s)`);
    process.exitCode = fallos === 0 ? 0 : 1;
  })
  .catch((e) => {
    console.log(`FAIL excepción — ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(closeDb);
