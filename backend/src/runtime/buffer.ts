import { sql } from "../db/client.js";
import { runAgent } from "../agent/run.js";
import { getWorkspaceById, type Conversacion, type Workspace } from "../ingress/persist.js";
import { logEvent } from "../obs/events.js";
import { iniciarTyping } from "../telegram/typing.js";
import { decide } from "./decide.js";
import { getEstadoConversacion } from "./state.js";

/**
 * El buffer por silencio. Diferenciador del producto: cuatro mensajes
 * seguidos del paciente producen UNA respuesta, no cuatro.
 *
 * Mecanismo híbrido (blueprint §4.2.2): la fuente de verdad es la fila en
 * `message_batches`; el timer en memoria de aquí es solo un ACELERADOR para
 * que el lote cierre exacto en vez de hasta 10 s tarde. Si el proceso muere,
 * `pg_cron` recoge el lote vencido en ≤10 s por el otro camino
 * (`src/http/internal.ts`), reclamando con el mismo `buffer_claim` atómico:
 * solo uno de los dos caminos gana.
 */

type EntradaTimer = {
  timer: NodeJS.Timeout;
  detenerTyping: () => void;
  batchId: string;
};

/** Una entrada por conversación: es la garantía de "un timer a la vez". */
const timers = new Map<string, EntradaTimer>();

function cancelarTimer(conversationId: string): void {
  const e = timers.get(conversationId);
  if (!e) return;
  clearTimeout(e.timer);
  e.detenerTyping();
  timers.delete(conversationId);
}

/**
 * Entra un mensaje del paciente. Reescribe `fire_at` (nunca lo extiende) y
 * reprograma el timer en memoria al nuevo instante — que puede ser antes
 * del anterior, si el techo absoluto ya lo está limitando.
 */
export async function appendToBuffer(
  ws: Workspace,
  conv: Conversacion,
  messageId: string,
  chatId: number,
): Promise<void> {
  const [fila] = await sql<{ batch_id: string; fire_at: Date; should_flush: boolean }[]>`
    select * from buffer_append(
      ${ws.id}, ${conv.conversationId}, ${messageId},
      ${ws.bufferMs}, ${ws.bufferMaxMs}, ${ws.bufferMaxMsgs}
    )`;
  if (!fila) throw new Error("buffer_append no devolvió fila");

  const existente = timers.get(conv.conversationId);
  if (existente) clearTimeout(existente.timer);

  const detenerTyping = existente?.detenerTyping ?? iniciarTyping(chatId).detener;

  const demoraMs = Math.max(0, fila.fire_at.getTime() - Date.now());
  const timer = setTimeout(() => {
    void flush(ws, conv.conversationId, fila.batch_id, "inproc").catch((e) =>
      logEvent({
        workspaceId: ws.id, conversationId: conv.conversationId,
        type: "batch_error", level: "error",
        payload: { motivo: e instanceof Error ? e.message : String(e) },
      }).catch(() => {}),
    );
  }, demoraMs);

  timers.set(conv.conversationId, { timer, detenerTyping, batchId: fila.batch_id });

  // Techo de mensajes alcanzado: no esperar el timer, intentar ya.
  // Si el timer también dispara después, buffer_claim ya habrá marcado el
  // lote y el segundo intento no hace nada — la atomicidad es la que decide.
  if (fila.should_flush) {
    void flush(ws, conv.conversationId, fila.batch_id, "inproc").catch((e) =>
      logEvent({
        workspaceId: ws.id, conversationId: conv.conversationId,
        type: "batch_error", level: "error",
        payload: { motivo: e instanceof Error ? e.message : String(e) },
      }).catch(() => {}),
    );
  }
}

/** Reclamo atómico. Lo usan igual el timer en memoria y el cron. */
async function reclamar(batchId: string, claimedBy: "inproc" | "cron"): Promise<boolean> {
  const [fila] = await sql<{ buffer_claim: boolean | null }[]>`
    select buffer_claim(${batchId}, ${claimedBy})`;
  return fila?.buffer_claim === true;
}

async function flush(
  ws: Workspace,
  conversationId: string,
  batchId: string,
  claimedBy: "inproc" | "cron",
): Promise<void> {
  const ganado = await reclamar(batchId, claimedBy);

  // Si este proceso tenía el timer de ese mismo lote, ya no hace falta:
  // alguien (este mismo flujo, o el cron) lo está atendiendo.
  const activo = timers.get(conversationId);
  if (activo?.batchId === batchId) cancelarTimer(conversationId);

  if (!ganado) return; // el otro camino llegó primero

  try {
    await procesarLoteReclamado(ws, conversationId, batchId);
    await sql`update message_batches set status = 'done' where id = ${batchId}`;
  } catch (e) {
    // No dejarlo colgado en 'processing': vuelve a 'ready' para que el
    // barrido de pg_cron lo reintente en la próxima pasada.
    await sql`update message_batches set status = 'ready' where id = ${batchId}`;
    await logEvent({
      workspaceId: ws.id, conversationId,
      type: "batch_error", level: "error",
      payload: { batchId, motivo: e instanceof Error ? e.message : String(e) },
    });
  }
}

/** Para qué cerró el lote. Ayuda a diagnosticar: si `silence` nunca aparece
 *  y todo es `max_ms`/`max_msgs`, el `buffer_ms` quedó demasiado corto. */
function inferirTriggerReason(
  ws: Workspace,
  msgCount: number,
  firstMsgAt: Date,
  fireAt: Date,
): "silence" | "max_ms" | "max_msgs" {
  if (msgCount >= ws.bufferMaxMsgs) return "max_msgs";
  const techoAbsoluto = firstMsgAt.getTime() + ws.bufferMaxMs;
  if (Math.abs(fireAt.getTime() - techoAbsoluto) < 500) return "max_ms";
  return "silence";
}

async function procesarLoteReclamado(
  ws: Workspace,
  conversationId: string,
  batchId: string,
): Promise<void> {
  const [batch] = await sql<{
    msg_count: number; first_msg_at: Date; fire_at: Date; contact_id: string;
  }[]>`
    select b.msg_count, b.first_msg_at, b.fire_at, c.contact_id
      from message_batches b
      join conversations c on c.id = b.conversation_id
     where b.id = ${batchId}`;
  if (!batch) throw new Error(`lote ${batchId} no encontrado`);

  // Consolidación ordenada por timestamp, unida con \n (regla 5).
  const mensajes = await sql<{ body: string | null }[]>`
    select body from messages
     where batch_id = ${batchId} and direction = 'in'
     order by created_at asc, id asc`;
  const mergedText = mensajes.map((m) => m.body).filter((b): b is string => !!b?.trim()).join("\n");

  const triggerReason = inferirTriggerReason(ws, batch.msg_count, batch.first_msg_at, batch.fire_at);
  const waitedMs = Date.now() - batch.first_msg_at.getTime();

  await logEvent({
    workspaceId: ws.id, conversationId,
    type: "batch_flush",
    payload: {
      batchId, msgCount: batch.msg_count, waitedMs, triggerReason,
      mergedLength: mergedText.length,
    },
  });

  if (!mergedText) return; // lote de solo mensajes vacíos (stickers, etc.)

  // Lectura FRESCA del estado, no la de cuando entró el primer mensaje: entre
  // el primer mensaje del lote y este cierre pueden pasar hasta 75 s (el
  // techo absoluto del buffer), y en ese rato pudo llegar un /humano. Correr
  // decide() aquí es lo que cierra esa ventana de carrera — sin esto, un
  // paciente que pide hablar con alguien a mitad de una ráfaga de mensajes
  // seguiría recibiendo respuestas del agente hasta el próximo turno.
  const estado = await getEstadoConversacion(conversationId);
  if (!estado) throw new Error(`conversación ${conversationId} no encontrada`);

  const decision = decide({}, estado);
  if (decision.kind !== "run_agent") {
    await logEvent({
      workspaceId: ws.id, conversationId,
      type: "agent_skipped",
      payload: { reason: decision.kind === "abstain" ? decision.reason : decision.kind },
    });
    return;
  }

  const conv: Conversacion = {
    contactId: batch.contact_id,
    conversationId,
    isBlocked: estado.isBlocked,
    state: estado.state,
    aiEnabled: estado.aiEnabled,
  };

  await runAgent(ws, conv, mergedText, { excluirUltimos: batch.msg_count });
}

/**
 * Entrada del camino del cron: solo tenemos el `batchId`, hay que recuperar
 * workspace y conversación. Volumen bajo (una vez cada 10 s a lo sumo) así
 * que una lectura sin cache está bien.
 */
export async function processBatchFromCron(batchId: string): Promise<void> {
  const [batch] = await sql<{ workspace_id: string; conversation_id: string }[]>`
    select workspace_id, conversation_id from message_batches where id = ${batchId}`;
  if (!batch) return; // ya no existe: otra pasada lo procesó y limpió

  const ws = await getWorkspaceById(batch.workspace_id);
  if (!ws) return;

  await flush(ws, batch.conversation_id, batchId, "cron");
}

/** Para los scripts de prueba: ¿hay un timer en memoria para esta conversación? */
export function tieneTimerActivo(conversationId: string): boolean {
  return timers.has(conversationId);
}

/**
 * Simula la muerte del proceso: borra TODO el estado en memoria (timer de
 * flush y el intervalo de "escribiendo…") sin tocar la base. Un proceso real
 * que muere se lleva ambos con él; dejar el intervalo de typing vivo aquí
 * sería mentir sobre lo que se está simulando — y de paso un setInterval
 * huérfano nunca deja terminar al script de prueba.
 */
export function _soloParaPruebas_simularCaidaDelProceso(): void {
  for (const e of timers.values()) {
    clearTimeout(e.timer);
    e.detenerTyping();
  }
  timers.clear();
}

export function _soloParaPruebas_limpiarTimers(): void {
  for (const e of timers.values()) {
    clearTimeout(e.timer);
    e.detenerTyping();
  }
  timers.clear();
}
