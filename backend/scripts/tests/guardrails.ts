/**
 * Guardrails clínicos y observabilidad (spec 15), con DeepSeek y Telegram
 * SIMULADOS (mismo patrón de loop.ts/outbox.ts). La base de datos es la
 * REAL.
 *
 * Cubre:
 *   - filtrarBorrador(): dispara con diagnóstico y con medicación/dosis;
 *     no dispara con una respuesta normal
 *   - el snippetHash NO es el texto (ni lo contiene)
 *   - runAgent(): un borrador con diagnóstico se DESCARTA por completo,
 *     se manda la respuesta segura, se registra `guardrail` con
 *     {rule, snippetHash} (nunca el texto), y se alerta al grupo
 *   - 402 (SinSaldo) alerta al grupo
 *   - 3 fallos de LLM seguidos alertan al grupo (y el contador se reinicia)
 *   - isClinicalUrgency(): la escalada por /humano y por la capa 1 llega
 *     al grupo y da el teléfono (handleUrgencia)
 *   - las tres vistas devuelven datos
 */
const CHAT_GR = 999500001;
const HANDOFF_CHAT_ID = -1009990005001;

let fallos = 0;
const comprobar = (nombre: string, cond: boolean, detalle = "") => {
  if (cond) console.log(`OK   ${nombre}`);
  else { console.log(`FAIL ${nombre}${detalle ? ` — ${detalle}` : ""}`); fallos++; }
};

process.env.TELEGRAM_BOT_TOKEN ||= "token-simulado";
process.env.DEEPSEEK_API_KEY ||= "clave-simulada";
process.env.TELEGRAM_HANDOFF_CHAT_ID ||= String(HANDOFF_CHAT_ID);

// ── DeepSeek simulado: un guion de respuestas, una por llamada ───────────
type Guion = (() => { content: string | null })[];
let guion: Guion = [];
let llamadaDs = 0;
let respuesta402 = false;
let fallaSiempre = false;

type LlamadaTg = { metodo: string; body: Record<string, unknown> };
const llamadasTg: LlamadaTg[] = [];

global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url instanceof Request ? url.url : url);

  if (u.includes("api.deepseek.com")) {
    if (respuesta402) {
      return new Response(JSON.stringify({ error: { message: "Insufficient Balance" } }),
        { status: 402, headers: { "content-type": "application/json" } });
    }
    if (fallaSiempre) {
      // 500: transitorio, sin `.status` discriminante especial — callWithRetry
      // reintenta y al final agota los 3 intentos y lanza.
      return new Response(JSON.stringify({ error: { message: "internal error" } }),
        { status: 500, headers: { "content-type": "application/json" } });
    }
    const paso = guion[llamadaDs++];
    if (!paso) throw new Error(`el guion de DeepSeek se quedó corto en la llamada ${llamadaDs}`);
    const msg = paso();
    return new Response(JSON.stringify({
      id: `sim-${llamadaDs}`,
      choices: [{ index: 0, message: { role: "assistant", ...msg }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }

  if (u.includes("api.telegram.org")) {
    const metodo = u.split("/").pop() ?? "";
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    llamadasTg.push({ metodo, body });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1, chat: { id: body.chat_id } } }),
      { status: 200, headers: { "content-type": "application/json" } });
  }

  throw new Error(`fetch no simulado: ${u}`);
}) as typeof fetch;

const { closeDb, sql } = await import("../../src/db/client.js");
const { runAgent } = await import("../../src/agent/run.js");
const { handleUrgencia } = await import("../../src/handlers/commands.js");
const { filtrarBorrador } = await import("../../src/guardrails/output.js");
const { isClinicalUrgency } = await import("../../src/guardrails/urgency.js");

async function main() {
  // ── 0 · filtrarBorrador() es pura ──────────────────────────────────────
  const diagnostico = filtrarBorrador("Tienes una caries en esa muela, por eso duele.");
  comprobar("un diagnóstico explícito dispara el filtro", diagnostico?.rule?.startsWith("diagnostico") === true, JSON.stringify(diagnostico));

  const medicacion = filtrarBorrador("Toma ibuprofeno 400 mg cada 8 horas por 3 días.");
  comprobar("medicación con dosis dispara el filtro", medicacion?.rule?.startsWith("medicacion") === true, JSON.stringify(medicacion));

  const limpio = filtrarBorrador("Claro, te puedo agendar la valoración gratuita para el jueves a las 10.");
  comprobar("una respuesta normal NO dispara el filtro", limpio === null, JSON.stringify(limpio));

  comprobar("el snippetHash no es ni contiene el texto original",
    !!diagnostico && !diagnostico.snippetHash.includes("caries") && diagnostico.snippetHash.length === 16,
    diagnostico?.snippetHash);

  comprobar("isClinicalUrgency: coloquial de Cúcuta", isClinicalUrgency("se me cayó la calza"));
  comprobar("isClinicalUrgency: texto normal no dispara", !isClinicalUrgency("quiero saber el precio de blanqueamiento"));

  // ── Setup DB ────────────────────────────────────────────────────────────
  const [wsRow] = await sql<{ id: string; slug: string; name: string; timezone: string;
    buffer_ms: number; buffer_max_ms: number; buffer_max_msgs: number }[]>`
    select id, slug, name, timezone, buffer_ms, buffer_max_ms, buffer_max_msgs from workspaces limit 1`;
  if (!wsRow) throw new Error("no hay workspace: corre npm run seed");

  await limpiar();

  const [c] = await sql<{ id: string }[]>`
    insert into contacts (workspace_id, tg_chat_id, first_name) values (${wsRow.id}, ${CHAT_GR}, 'Prueba guardrails') returning id`;
  const [conv] = await sql<{ id: string }[]>`insert into conversations (workspace_id, contact_id) values (${wsRow.id}, ${c!.id}) returning id`;
  await sql`insert into messages (workspace_id, conversation_id, direction, kind, body)
            values (${wsRow.id}, ${conv!.id}, 'in', 'text', 'hola')`;

  const ws = {
    ...wsRow, webhookSecret: null, handoffChatId: null as number | null, webhookPath: null,
    bufferMs: wsRow.buffer_ms, bufferMaxMs: wsRow.buffer_max_ms, bufferMaxMsgs: wsRow.buffer_max_msgs,
  };
  const convCtx = { contactId: c!.id, conversationId: conv!.id, isBlocked: false, state: "ai_active", aiEnabled: true };

  // ── 1 · Capa 3: un borrador con diagnóstico se bloquea ─────────────────
  guion = [() => ({ content: "Sí, lo que tienes es una caries. Debes tratarla pronto." })];
  llamadaDs = 0;
  llamadasTg.length = 0;

  const r1 = await runAgent(ws as never, convCtx as never, "¿tengo caries?");
  comprobar("runAgent responde ok (la capa 3 reemplaza, no rompe el turno)", r1.ok, JSON.stringify(r1));
  comprobar("el paciente recibe la RESPUESTA SEGURA, no el borrador",
    r1.ok && r1.texto.includes("valoración") && !r1.texto.toLowerCase().includes("caries"), JSON.stringify(r1));

  const [guardrailEv] = await sql<{ payload: { rule: string; snippetHash: string } }[]>`
    select payload from events where conversation_id = ${conv!.id} and type = 'guardrail' order by created_at desc limit 1`;
  comprobar("se registró el evento guardrail con rule+snippetHash", !!guardrailEv?.payload.rule && !!guardrailEv?.payload.snippetHash,
    JSON.stringify(guardrailEv));
  comprobar("el payload NO guarda el texto que lo disparó (solo el hash)",
    JSON.stringify(guardrailEv?.payload ?? {}).toLowerCase().includes("caries") === false);

  comprobar("se alertó al grupo interno por el guardrail",
    llamadasTg.some((l) => l.metodo === "sendMessage" && l.body.chat_id === HANDOFF_CHAT_ID
      && String(l.body.text).includes("regla")), JSON.stringify(llamadasTg));

  // ── 2 · No receta: "¿tengo que tomar algo antes?" ──────────────────────
  guion = [() => ({ content: "Toma ibuprofeno 400 mg cada 8 horas antes de venir." })];
  llamadaDs = 0;
  llamadasTg.length = 0;
  const r2 = await runAgent(ws as never, convCtx as never, "¿tengo que tomar algo antes de la cita?");
  comprobar("un borrador que receta también se bloquea", r2.ok && r2.texto.includes("valoración"), JSON.stringify(r2));

  // ── 3 · 402 (SinSaldo) alerta al grupo ─────────────────────────────────
  // El SDK de OpenAI construye su APIError (con `.status`) a partir de la
  // Response real, no de una excepción cruda del fetch — por eso aquí se
  // simula devolviendo un 402, no lanzando.
  respuesta402 = true;
  llamadasTg.length = 0;
  const r3 = await runAgent(ws as never, convCtx as never, "hola de nuevo");
  respuesta402 = false;
  comprobar("ante un 402, runAgent degrada (ok:false) sin tumbarse", r3.ok === false, JSON.stringify(r3));
  comprobar("se alertó al grupo por falta de saldo",
    llamadasTg.some((l) => l.metodo === "sendMessage" && l.body.chat_id === HANDOFF_CHAT_ID
      && String(l.body.text).toLowerCase().includes("saldo")), JSON.stringify(llamadasTg));

  // ── 4 · 3 fallos de LLM seguidos alertan al grupo ──────────────────────
  // Reinicia el contador: los pasos 1-3 de arriba pudieron incrementarlo o
  // resetearlo según si hubo éxito. Fuerza un estado conocido.
  await sql`update conversations set meta = meta - 'llmFails' where id = ${conv!.id}`;
  fallaSiempre = true;
  llamadasTg.length = 0;
  for (let i = 0; i < 3; i++) {
    await runAgent(ws as never, convCtx as never, `fallo ${i}`);
  }
  fallaSiempre = false;
  comprobar("tras 3 fallos seguidos, se alertó al grupo",
    llamadasTg.some((l) => l.metodo === "sendMessage" && l.body.chat_id === HANDOFF_CHAT_ID
      && String(l.body.text).includes("3 veces")), JSON.stringify(llamadasTg));
  const [convMeta] = await sql<{ meta: { llmFails?: number } }[]>`select meta from conversations where id = ${conv!.id}`;
  comprobar("el contador se reinicia tras avisar (no alerta cada vez después)",
    (convMeta?.meta.llmFails ?? 0) === 0, JSON.stringify(convMeta?.meta));

  // ── 5 · Urgencia clínica: handleUrgencia da el teléfono y avisa ────────
  llamadasTg.length = 0;
  const evUrgencia = {
    updateId: 1, chatId: CHAT_GR, userId: 1, kind: "text" as const,
    text: "me está matando la muela", ts: Date.now(), from: { firstName: "Paciente" }, raw: {},
  };
  await handleUrgencia(ws as never, convCtx as never, evUrgencia);

  const [convTrasUrgencia] = await sql<{ state: string }[]>`select state from conversations where id = ${conv!.id}`;
  comprobar("la urgencia deja la conversación en handoff_pending", convTrasUrgencia?.state === "handoff_pending");

  const [mensajePaciente] = await sql<{ payload: { text: string } }[]>`
    select payload from outbound_queue where tg_chat_id = ${CHAT_GR} order by created_at desc limit 1`;
  comprobar("al paciente se le da el teléfono de la clínica",
    /\+?57\s*3\d{2}\s*\d{3}\s*\d{4}/.test(mensajePaciente?.payload.text ?? ""), mensajePaciente?.payload.text);

  comprobar("se avisó al grupo de la urgencia",
    llamadasTg.some((l) => l.metodo === "sendMessage" && l.body.chat_id === HANDOFF_CHAT_ID
      && JSON.stringify(l.body).includes("Handoff")), JSON.stringify(llamadasTg));

  // ── 6 · Las tres vistas devuelven datos ─────────────────────────────────
  const v1 = await sql`select * from v_llm_daily limit 1`;
  const v2 = await sql`select * from v_buffer limit 1`;
  const v3 = await sql`select * from v_funnel`;
  comprobar("v_llm_daily devuelve filas", v1.length > 0);
  comprobar("v_buffer existe y es consultable (puede no tener lotes en esta prueba)", Array.isArray(v2));
  comprobar("v_funnel devuelve exactamente 1 fila (es un agregado global)", v3.length === 1);

  await limpiar();
}

async function limpiar() {
  await sql`delete from events where conversation_id in (
              select c.id from conversations c join contacts ct on ct.id=c.contact_id
               where ct.tg_chat_id between 999500000 and 999500999)`;
  await sql`delete from outbound_queue where tg_chat_id between 999500000 and 999500999`;
  await sql`delete from messages where conversation_id in (
              select c.id from conversations c join contacts ct on ct.id=c.contact_id
               where ct.tg_chat_id between 999500000 and 999500999)`;
  await sql`delete from conversations where contact_id in (
              select id from contacts where tg_chat_id between 999500000 and 999500999)`;
  await sql`delete from contacts where tg_chat_id between 999500000 and 999500999`;
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n— guardrails: todo OK" : `\n— guardrails: ${fallos} fallo(s)`);
    process.exitCode = fallos === 0 ? 0 : 1;
  })
  .catch((e) => {
    console.log(`FAIL excepción — ${e instanceof Error ? e.stack ?? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(closeDb);
