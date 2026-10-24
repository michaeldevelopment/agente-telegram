import { sql } from "../db/client.js";
import type { Workspace } from "../ingress/persist.js";
import { logEvent } from "../obs/events.js";
import type { EstadoDecision } from "./decide.js";

/** Los 6 valores del enum `conversation_state` (migración 001). */
export type ConversationState =
  | "ai_active" | "awaiting_reply" | "handoff_pending"
  | "human_active" | "paused" | "closed";

/**
 * Cambia el estado y deja registro en `events` como `state_change`.
 *
 * El "from" se captura en la MISMA sentencia que escribe el "to" (vía CTE),
 * no con un SELECT previo por separado: así no hay ventana de carrera en la
 * que otra escritura concurrente cambie el estado entre que lo leemos y lo
 * sobreescribimos.
 */
export async function transitionState(
  ws: Workspace,
  conversationId: string,
  to: ConversationState,
  reason: string,
): Promise<{ from: string; to: string }> {
  const [fila] = await sql<{ from_state: string; to_state: string }[]>`
    with previo as (select state from conversations where id = ${conversationId})
    update conversations c
       set state = ${to}, updated_at = now()
     where c.id = ${conversationId}
    returning (select state from previo) as from_state, c.state as to_state`;
  if (!fila) throw new Error(`conversación ${conversationId} no encontrada`);

  if (fila.from_state !== fila.to_state) {
    await logEvent({
      workspaceId: ws.id,
      conversationId,
      type: "state_change",
      payload: { from: fila.from_state, to: fila.to_state, reason },
    });
  }

  return { from: fila.from_state, to: fila.to_state };
}

/**
 * Lectura fresca del estado, SIN cache. La usa el flush del buffer (spec 06)
 * porque entre que un mensaje se guarda y el lote cierra pueden pasar hasta
 * 75 s: si en ese rato llegó un /humano, el estado de hace 75 s ya miente.
 */
export async function getEstadoConversacion(conversationId: string): Promise<EstadoDecision | null> {
  const [fila] = await sql<{ is_blocked: boolean; ai_enabled: boolean; state: string }[]>`
    select ct.is_blocked, c.ai_enabled, c.state
      from conversations c
      join contacts ct on ct.id = c.contact_id
     where c.id = ${conversationId}`;
  if (!fila) return null;
  return { isBlocked: fila.is_blocked, aiEnabled: fila.ai_enabled, state: fila.state };
}
