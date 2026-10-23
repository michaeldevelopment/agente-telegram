/**
 * Buffer por silencio: mecánica SQL + comportamiento del proceso, con
 * Telegram y DeepSeek SIMULADOS (igual que outbox.ts en la spec 04 y con
 * la misma comprobación que agente-vivo.ts en la spec 05: el SDK de OpenAI
 * resuelve `fetch` en cada petición, así que pisar `global.fetch` antes de
 * crear el cliente basta para interceptar también a DeepSeek).
 *
 * Nada de esto gasta dinero ni depende de que haya saldo en DeepSeek.
 */

const CHAT_BASE = 992000000; // 992xxxxxx reservado para esta spec

let fallos = 0;
const comprobar = (nombre: string, cond: boolean, detalle = "") => {
  if (cond) console.log(`OK   ${nombre}`);
  else { console.log(`FAIL ${nombre}${detalle ? ` — ${detalle}` : ""}`); fallos++; }
};

// ── Telegram y DeepSeek simulados ────────────────────────────
const llamadasDeepSeek: unknown[] = [];
const llamadasTelegram: { metodo: string; body: Record<string, unknown> }[] = [];

const jsonRes = (obj: unknown) =>
  new Response(JSON.stringify(obj), { status: 200, headers: { "content-type": "application/json" } });

global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;

  if (u.includes("api.deepseek.com")) {
    llamadasDeepSeek.push(body);
    return jsonRes({
      id: "sim", choices: [{ index: 0, message: { role: "assistant", content: "Respuesta simulada." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 10, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20 },
    });
  }
  if (u.includes("api.telegram.org")) {
    const metodo = u.split("/").pop() ?? "";
    llamadasTelegram.push({ metodo, body });
    if (metodo === "sendMessage") {
      return jsonRes({ ok: true, result: { message_id: 1, chat: { id: body.chat_id } } });
    }
    return jsonRes({ ok: true, result: true });
  }
  throw new Error(`fetch no simulado para: ${u}`);
}) as typeof fetch;

process.env.TELEGRAM_BOT_TOKEN ||= "token-simulado";
process.env.DEEPSEEK_API_KEY ||= "clave-simulada";

// Imports dinámicos: TODOS, después de pisar fetch y los tokens — ver
// outbox.ts (spec 04) para el porqué (env.ts congela process.env al import).
const { closeDb, sql } = await import("../../src/db/client.js");
const { appendToBuffer, processBatchFromCron, tieneTimerActivo,
        _soloParaPruebas_simularCaidaDelProceso } = await import("../../src/runtime/buffer.js");
const { drenarAhora } = await import("../../src/egress/drain.js");

type WorkspaceBase = {
  id: string; slug: string; name: string; timezone: string;
  webhookSecret: null; webhookPath: null;
};
type Conversacion = {
  contactId: string; conversationId: string;
  isBlocked: boolean; state: string; aiEnabled: boolean;
};

async function nuevaConversacion(wsId: string, chatId: number) {
  const [c] = await sql<{ id: string }[]>`
    insert into contacts (workspace_id, tg_chat_id, first_name)
    values (${wsId}, ${chatId}, 'Prueba buffer') returning id`;
  const [conv] = await sql<{ id: string }[]>`
    insert into conversations (workspace_id, contact_id) values (${wsId}, ${c!.id}) returning id`;
  const conversacion: Conversacion = {
    contactId: c!.id, conversationId: conv!.id,
    isBlocked: false, state: "ai_active", aiEnabled: true,
  };
  return conversacion;
}

async function insertarMensajeIn(wsId: string, conversationId: string, texto: string): Promise<string> {
  const [m] = await sql<{ id: string }[]>`
    insert into messages (workspace_id, conversation_id, direction, kind, body)
    values (${wsId}, ${conversationId}, 'in', 'text', ${texto}) returning id`;
  return m!.id;
}

async function ultimoBatchFlush(conversationId: string) {
  const [e] = await sql<{ p: { msgCount: number; triggerReason: string; mergedLength: number; waitedMs: number } }[]>`
    select payload as p from events
     where type = 'batch_flush' and conversation_id = ${conversationId}
     order by created_at desc limit 1`;
  return e?.p;
}

async function llmCallsDe(conversationId: string): Promise<number> {
  const [r] = await sql<{ n: number }[]>`
    select count(*)::int as n from events
     where type = 'llm_call' and conversation_id = ${conversationId}`;
  return r?.n ?? 0;
}

async function esperarBatchFlush(conversationId: string, msMaximo: number) {
  const limite = Date.now() + msMaximo;
  while (Date.now() < limite) {
    const f = await ultimoBatchFlush(conversationId);
    if (f) return f;
    await new Promise((r) => setTimeout(r, 100));
  }
  return undefined;
}

/**
 * `batch_flush` se registra ANTES de llamar al agente (procesarLoteReclamado
 * lo loguea y luego recién invoca runAgent), así que ver ese evento no
 * garantiza que `llm_call` ya exista. Hay que esperarlo aparte.
 */
async function esperarLlmCalls(conversationId: string, msMaximo: number): Promise<number> {
  const limite = Date.now() + msMaximo;
  let n = await llmCallsDe(conversationId);
  while (n === 0 && Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 150));
    n = await llmCallsDe(conversationId);
  }
  return n;
}

async function main() {
  const [wsRow] = await sql<{
    id: string; slug: string; name: string; timezone: string;
  }[]>`select id, slug, name, timezone from workspaces limit 1`;
  if (!wsRow) throw new Error("no hay workspace: corre npm run seed");

  await limpiar();

  const base: WorkspaceBase = {
    id: wsRow.id, slug: wsRow.slug, name: wsRow.name, timezone: wsRow.timezone,
    webhookSecret: null, webhookPath: null,
  };

  // ════════════════════════════════════════════════════════
  // 1 · Mecánica SQL pura — sin timers, sin red
  // ════════════════════════════════════════════════════════
  console.log("\n── SQL: buffer_append / buffer_claim ──");
  {
    const conv = await nuevaConversacion(base.id, CHAT_BASE + 1);
    const m1 = await insertarMensajeIn(base.id, conv.conversationId, "hola");

    const [a1] = await sql<{ batch_id: string; fire_at: Date; should_flush: boolean }[]>`
      select * from buffer_append(${base.id}, ${conv.conversationId}, ${m1}, 1000, 5000, 3)`;
    comprobar("primer append crea un lote con should_flush=false", a1?.should_flush === false);

    const [abierto] = await sql<{ msg_count: number; status: string }[]>`
      select msg_count, status from message_batches where id = ${a1!.batch_id}`;
    comprobar("el lote queda 'open' con msg_count=1", abierto?.status === "open" && abierto.msg_count === 1);

    const m2 = await insertarMensajeIn(base.id, conv.conversationId, "otra cosa");
    const [a2] = await sql<{ batch_id: string; fire_at: Date; should_flush: boolean }[]>`
      select * from buffer_append(${base.id}, ${conv.conversationId}, ${m2}, 1000, 5000, 3)`;
    comprobar("el segundo append REUSA el mismo lote (un solo lote abierto)",
      a2?.batch_id === a1!.batch_id);
    comprobar("fire_at se reescribió hacia adelante", a2!.fire_at.getTime() >= a1!.fire_at.getTime());

    const m3 = await insertarMensajeIn(base.id, conv.conversationId, "tercera");
    const [a3] = await sql<{ should_flush: boolean }[]>`
      select * from buffer_append(${base.id}, ${conv.conversationId}, ${m3}, 1000, 5000, 3)`;
    comprobar("al llegar al techo de mensajes, should_flush=true", a3?.should_flush === true);

    const [c1] = await sql<{ buffer_claim: boolean | null }[]>`select buffer_claim(${a1!.batch_id}, 'inproc')`;
    comprobar("buffer_claim gana la primera vez", c1?.buffer_claim === true);
    const [c2] = await sql<{ buffer_claim: boolean | null }[]>`select buffer_claim(${a1!.batch_id}, 'cron')`;
    comprobar("buffer_claim NO gana la segunda vez (atómico)", c2?.buffer_claim !== true);

    await sql`update message_batches set status = 'done' where id = ${a1!.batch_id}`;
  }

  // ════════════════════════════════════════════════════════
  // 2 · Silencio — el caso normal
  // ════════════════════════════════════════════════════════
  console.log("\n── Silencio: 3 mensajes rápidos → 1 respuesta ──");
  {
    const conv = await nuevaConversacion(base.id, CHAT_BASE + 2);
    const ws = { ...base, bufferMs: 700, bufferMaxMs: 60_000, bufferMaxMsgs: 50 };

    for (const texto of ["hola", "quiero una cita", "para limpieza"]) {
      const id = await insertarMensajeIn(base.id, conv.conversationId, texto);
      await appendToBuffer(ws, conv, id, CHAT_BASE + 2);
      await new Promise((r) => setTimeout(r, 150));
    }
    comprobar("hay un timer en memoria para la conversación", tieneTimerActivo(conv.conversationId));

    const flush = await esperarBatchFlush(conv.conversationId, 4000);
    comprobar("cierra por silencio con los 3 mensajes", flush?.msgCount === 3 && flush?.triggerReason === "silence",
      JSON.stringify(flush));

    const nLlm = await esperarLlmCalls(conv.conversationId, 8000);
    comprobar("UNA sola llamada al LLM para los 3 mensajes", nLlm === 1, `${nLlm}`);

    await drenarAhora(8000);
  }

  // ════════════════════════════════════════════════════════
  // 3 · Techo por mensajes — no espera el silencio
  // ════════════════════════════════════════════════════════
  console.log("\n── Techo por mensajes: cierra sin esperar ──");
  {
    const conv = await nuevaConversacion(base.id, CHAT_BASE + 3);
    const ws = { ...base, bufferMs: 8000, bufferMaxMs: 60_000, bufferMaxMsgs: 4 };

    const t0 = Date.now();
    for (let i = 0; i < 4; i++) {
      const id = await insertarMensajeIn(base.id, conv.conversationId, `mensaje ${i}`);
      await appendToBuffer(ws, conv, id, CHAT_BASE + 3);
    }
    const flush = await esperarBatchFlush(conv.conversationId, 4000);
    const tardo = Date.now() - t0;
    comprobar("cierra por 'max_msgs', mucho antes de los 8 s de silencio",
      flush?.triggerReason === "max_msgs" && tardo < 4000, `${tardo} ms — ${JSON.stringify(flush)}`);
  }

  // ════════════════════════════════════════════════════════
  // 4 · Techo absoluto de tiempo — gana sobre el silencio
  // ════════════════════════════════════════════════════════
  console.log("\n── Techo de tiempo: el paciente no para de escribir (SQL determinista) ──");
  {
    // Esto se prueba contra buffer_append directo, no contra el timer en
    // memoria: con Supabase remoto, los propios round-trips de red del test
    // compiten con el timer y la medición por reloj de pared sale ruidosa.
    // `pg_sleep` simula el paso del tiempo sin esa variable.
    const conv = await nuevaConversacion(base.id, CHAT_BASE + 4);
    const delayMs = 1000, maxMs = 2000; // bufferMs > espaciado: el silencio NUNCA cerraría solo

    const m1 = await insertarMensajeIn(base.id, conv.conversationId, "hola");
    const [a1] = await sql<{ batch_id: string; fire_at: Date }[]>`
      select * from buffer_append(${base.id}, ${conv.conversationId}, ${m1}, ${delayMs}, ${maxMs}, 100)`;
    comprobar("antes del techo, el silencio manda (fire_at ≈ ahora + delay)",
      a1!.fire_at.getTime() - Date.now() > delayMs - 300);

    const [filaInicial] = await sql<{ first_msg_at: Date }[]>`
      select first_msg_at from message_batches where id = ${a1!.batch_id}`;
    const techoEsperado = filaInicial!.first_msg_at.getTime() + maxMs;

    // Avanza el reloj de la BASE 1.3s (pasado el punto en que el techo debe
    // ganar: now > first_msg_at + delay), sin mover el reloj de Node.
    await sql`select pg_sleep(1.3)`;

    const m2 = await insertarMensajeIn(base.id, conv.conversationId, "sigo escribiendo");
    const [a2] = await sql<{ fire_at: Date }[]>`
      select * from buffer_append(${base.id}, ${conv.conversationId}, ${m2}, ${delayMs}, ${maxMs}, 100)`;
    comprobar("tras el techo, fire_at = first_msg_at + max_ms (el techo, no el silencio)",
      Math.abs(a2!.fire_at.getTime() - techoEsperado) < 50,
      `esperado=${new Date(techoEsperado).toISOString()} obtenido=${a2!.fire_at.toISOString()}`);

    await sql`select pg_sleep(0.8)`; // ahora ya pasó el fire_at capeado

    const m3 = await insertarMensajeIn(base.id, conv.conversationId, "y sigo");
    const [a3] = await sql<{ fire_at: Date; should_flush: boolean }[]>`
      select * from buffer_append(${base.id}, ${conv.conversationId}, ${m3}, ${delayMs}, ${maxMs}, 100)`;
    comprobar("el techo NO sigue avanzando con cada mensaje: a3 = a2, fijo",
      a3!.fire_at.getTime() === a2!.fire_at.getTime());
    comprobar("y ya quedó en el pasado: listo para que cualquiera lo reclame",
      a3!.fire_at.getTime() <= Date.now() + 200);

    const [claim] = await sql<{ buffer_claim: boolean | null }[]>`
      select buffer_claim((select id from message_batches where conversation_id=${conv.conversationId} and status='open'), 'cron')`;
    comprobar("y se puede reclamar aunque el paciente siguiera escribiendo", claim?.buffer_claim === true);

    await sql`update message_batches set status='done' where conversation_id=${conv.conversationId}`;
  }

  // ════════════════════════════════════════════════════════
  // 5 · La red de seguridad: el proceso "muere" con el lote abierto
  // ════════════════════════════════════════════════════════
  console.log("\n── Red de seguridad: simula que el proceso murió ──");
  {
    const conv = await nuevaConversacion(base.id, CHAT_BASE + 5);
    const ws = { ...base, bufferMs: 60_000, bufferMaxMs: 120_000, bufferMaxMsgs: 50 };

    const m1 = await insertarMensajeIn(base.id, conv.conversationId, "hola");
    await appendToBuffer(ws, conv, m1, CHAT_BASE + 5);
    const m2 = await insertarMensajeIn(base.id, conv.conversationId, "sigo aquí");
    await appendToBuffer(ws, conv, m2, CHAT_BASE + 5);

    const [lote] = await sql<{ id: string; status: string }[]>`
      select id, status from message_batches where conversation_id = ${conv.conversationId} and status = 'open'`;
    comprobar("el lote sigue 'open' (nadie lo cerró todavía)", lote?.status === "open");

    // "Muere" el proceso: se pierden los timers en memoria, el lote sigue
    // abierto en la base — exactamente lo que pasaría con un redeploy.
    _soloParaPruebas_simularCaidaDelProceso();
    comprobar("tras la caída, ya no hay timer en memoria", !tieneTimerActivo(conv.conversationId));

    // Esto es lo que haría el barrido de pg_cron al encontrar el lote vencido
    // (en la base real el fire_at es a 60s; aquí forzamos que ya venció,
    // que es justo lo que simula "nadie lo procesó a tiempo").
    await sql`update message_batches set fire_at = now() - interval '1 second' where id = ${lote!.id}`;
    await processBatchFromCron(lote!.id);

    const flush = await esperarBatchFlush(conv.conversationId, 3000);
    comprobar("el camino del cron también lo cierra, con los 2 mensajes",
      flush?.msgCount === 2, JSON.stringify(flush));

    const [final] = await sql<{ status: string }[]>`select status from message_batches where id = ${lote!.id}`;
    comprobar("el lote queda 'done', no colgado en 'processing'", final?.status === "done");
  }

  // ════════════════════════════════════════════════════════
  // 6 · runtime_config — la trampa que falla en silencio si se olvida
  // ════════════════════════════════════════════════════════
  console.log("\n── runtime_config poblada ──");
  {
    const filas = await sql<{ key: string; value: string }[]>`select key, value from runtime_config`;
    const cfg = Object.fromEntries(filas.map((f) => [f.key, f.value]));
    comprobar("worker_url está poblada", !!cfg.worker_url, cfg.worker_url);
    comprobar("internal_secret está poblada", !!cfg.internal_secret);
  }

  console.log(`\nDeepSeek simulado recibió ${llamadasDeepSeek.length} llamada(s).`);
  console.log(`Telegram simulado recibió ${llamadasTelegram.length} llamada(s).`);

  await limpiar();
}

async function limpiar() {
  await sql`delete from messages where conversation_id in (
              select c.id from conversations c join contacts ct on ct.id = c.contact_id
               where ct.tg_chat_id between ${CHAT_BASE} and ${CHAT_BASE + 999})`;
  await sql`delete from message_batches where conversation_id in (
              select c.id from conversations c join contacts ct on ct.id = c.contact_id
               where ct.tg_chat_id between ${CHAT_BASE} and ${CHAT_BASE + 999})`;
  await sql`delete from outbound_queue where tg_chat_id between ${CHAT_BASE} and ${CHAT_BASE + 999}`;
  await sql`delete from events where conversation_id in (
              select c.id from conversations c join contacts ct on ct.id = c.contact_id
               where ct.tg_chat_id between ${CHAT_BASE} and ${CHAT_BASE + 999})`;
  await sql`delete from conversations where contact_id in (
              select id from contacts where tg_chat_id between ${CHAT_BASE} and ${CHAT_BASE + 999})`;
  await sql`delete from contacts where tg_chat_id between ${CHAT_BASE} and ${CHAT_BASE + 999}`;
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n— buffer: todo OK" : `\n— buffer: ${fallos} fallo(s)`);
    process.exitCode = fallos === 0 ? 0 : 1;
  })
  .catch((e) => {
    console.log(`FAIL excepción — ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(closeDb);
