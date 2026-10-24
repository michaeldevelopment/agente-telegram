import { sql } from "../db/client.js";
import { call } from "../telegram/api.js";
import { enqueue } from "../egress/outbox.js";
import { insertOutbound, type Conversacion, type Workspace } from "../ingress/persist.js";
import { handoffChatId } from "./group.js";

/**
 * El puente bidireccional (spec 13). El mensaje del grupo se registra en
 * `handoff_relay` con su `group_message_id`; a partir de ahí:
 *   - alguien RESPONDE a ese mensaje en el grupo → le llega al paciente
 *   - el paciente escribe → aparece en el hilo del grupo
 */

/** Paciente → grupo. Se manda como reply al último aviso de esa conversación. */
export async function relayPacienteAGrupo(ws: Workspace, conv: Conversacion, texto: string): Promise<void> {
  const [relay] = await sql<{ group_message_id: string }[]>`
    select group_message_id from handoff_relay
     where workspace_id = ${ws.id} and conversation_id = ${conv.conversationId}
     order by created_at desc limit 1`;
  if (!relay) return; // no hay hilo abierto todavía: no hay a qué responder

  await call("sendMessage", {
    chat_id: handoffChatId(ws),
    text: `💬 ${texto}`,
    reply_to_message_id: Number(relay.group_message_id),
  });
}

/**
 * Grupo → paciente. `groupMessageId` es el mensaje al que alguien respondió.
 * Devuelve `false` si ese mensaje no corresponde a ningún handoff conocido
 * (alguien respondiendo a otra cosa en el mismo grupo).
 */
export async function relayGrupoAPaciente(
  ws: Workspace,
  groupMessageId: number,
  texto: string,
  senderTgId: number,
): Promise<boolean> {
  const [fila] = await sql<{ conversation_id: string; tg_chat_id: string }[]>`
    select hr.conversation_id, ct.tg_chat_id
      from handoff_relay hr
      join conversations c on c.id = hr.conversation_id
      join contacts ct on ct.id = c.contact_id
     where hr.workspace_id = ${ws.id} and hr.group_message_id = ${groupMessageId}
     limit 1`;
  if (!fila) return false;

  const chatId = Number(fila.tg_chat_id);
  const conv: Conversacion = {
    contactId: "", conversationId: fila.conversation_id,
    isBlocked: false, state: "human_active", aiEnabled: true,
  };

  await enqueue({ workspaceId: ws.id, conversationId: fila.conversation_id, chatId, texto });
  await insertOutbound(ws, conv, texto, undefined, senderTgId);
  return true;
}
