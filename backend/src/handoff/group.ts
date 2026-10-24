import { sql } from "../db/client.js";
import { env, EnvFaltante } from "../config/env.js";
import { call, type TgMessage } from "../telegram/api.js";
import { logEvent } from "../obs/events.js";
import type { Conversacion, Workspace } from "../ingress/persist.js";

/**
 * El aviso al grupo interno (spec 13). Es el inbox del equipo de la
 * clínica, dentro de Telegram, con cero frontend.
 */

/**
 * El `chat_id` de un grupo es NEGATIVO. Guardarlo sin signo rompe el
 * handoff en silencio — nadie se entera de que los avisos se pierden.
 *
 * Mientras haya un solo cliente se acepta también la variable de entorno,
 * igual que `webhook_secret`/`webhook_path` en `ingress/webhook.ts`.
 */
export function handoffChatId(ws: Workspace): number {
  const v = ws.handoffChatId ?? env.TELEGRAM_HANDOFF_CHAT_ID ?? null;
  if (v === null) throw new EnvFaltante("TELEGRAM_HANDOFF_CHAT_ID", "el aviso de handoff");
  return v;
}

/** Los primeros 8 hex del uuid: entra sobrado en el límite de 64 bytes de callback_data. */
export function convCorto(conversationId: string): string {
  return conversationId.replace(/-/g, "").slice(0, 8);
}

/** El inverso: de `conv_corto` a la conversación real, para los botones take:/back:. */
export async function resolverPorConvCorto(workspaceId: string, convCortoVal: string): Promise<string | null> {
  const [fila] = await sql<{ id: string }[]>`
    select id from conversations
     where workspace_id = ${workspaceId}
       and left(replace(id::text, '-', ''), 8) = ${convCortoVal}
     limit 1`;
  return fila?.id ?? null;
}

async function ultimosMensajes(conversationId: string, n: number): Promise<string> {
  const filas = await sql<{ direction: string; body: string | null }[]>`
    select direction, body from messages
     where conversation_id = ${conversationId} and body is not null
     order by created_at desc limit ${n}`;
  if (filas.length === 0) return "(sin mensajes)";
  return filas.reverse()
    .map((f) => `${f.direction === "in" ? "Paciente" : "Bot"}: ${f.body}`)
    .join("\n");
}

/**
 * Envía el aviso con los botones Tomar/Devolver y registra el puente en
 * `handoff_relay`, para que el relay bidireccional sepa a qué conversación
 * corresponde una respuesta en el grupo.
 */
export async function enviarAvisoGrupo(
  ws: Workspace,
  conv: Conversacion,
  opts: { motivo: string; resumen?: string },
): Promise<void> {
  const chatId = handoffChatId(ws);

  const [contacto] = await sql<{ full_name: string | null; first_name: string | null; username: string | null }[]>`
    select full_name, first_name, tg_username as username from contacts where id = ${conv.contactId}`;
  const nombre = contacto?.full_name ?? contacto?.first_name ?? "paciente sin nombre";
  const ultimos = await ultimosMensajes(conv.conversationId, 6);

  const texto =
    `🔔 Handoff · ${ws.name}\n` +
    `Paciente: ${nombre}${contacto?.username ? ` (@${contacto.username})` : ""}\n` +
    `Motivo: ${opts.motivo}\n` +
    (opts.resumen ? `Resumen: ${opts.resumen}\n` : "") +
    `Últimos mensajes:\n${ultimos}`;

  const corto = convCorto(conv.conversationId);
  const msg = await call<TgMessage>("sendMessage", {
    chat_id: chatId,
    text: texto,
    reply_markup: {
      inline_keyboard: [[
        { text: "Tomar conversación", callback_data: `take:${corto}` },
        { text: "Devolver a la IA", callback_data: `back:${corto}` },
      ]],
    },
  });

  await sql`
    insert into handoff_relay (workspace_id, conversation_id, group_message_id)
    values (${ws.id}, ${conv.conversationId}, ${msg.message_id})
    on conflict (workspace_id, group_message_id) do nothing`;

  await logEvent({
    workspaceId: ws.id, conversationId: conv.conversationId, type: "handoff",
    payload: { reason: opts.motivo },
  });
}
