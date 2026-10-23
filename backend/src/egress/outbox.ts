import { sql } from "../db/client.js";
import type { Json, JsonObjeto } from "../db/json.js";
import { prepararTexto } from "./format.js";

/**
 * Encolar es la ÚNICA forma de hacerle llegar algo al paciente.
 * Nadie llama a sendMessage directo: así hay rate limiting, reintentos,
 * auditoría y la posibilidad de cancelar un envío que ya no aplica.
 */

export type EnqueueOpts = {
  workspaceId: string;
  conversationId?: string | null;
  chatId: number;
  texto: string;
  /** false solo si el HTML lo construimos nosotros y ya es seguro. */
  escapar?: boolean;
  /** Botones inline (spec 12). */
  replyMarkup?: Json;
  /** Para recordatorios programados (spec 14). */
  enviarEn?: Date;
  /** Responder a un mensaje concreto, para el relay del grupo (spec 13). */
  replyTo?: number;
};

/**
 * Mete el texto en la cola, troceado si hace falta.
 * Devuelve los ids de las filas creadas: un texto largo son varias.
 */
export async function enqueue(o: EnqueueOpts): Promise<string[]> {
  const trozos = prepararTexto(o.texto, { escapar: o.escapar });
  if (trozos.length === 0) return [];

  const ids: string[] = [];
  for (const [i, texto] of trozos.entries()) {
    const payload: JsonObjeto = {
      chat_id: o.chatId,
      text: texto,
      parse_mode: "HTML",
    };
    // Los botones y el reply van solo en el último trozo: si no, el paciente
    // ve el teclado a mitad de un mensaje partido.
    if (i === trozos.length - 1) {
      if (o.replyMarkup) payload.reply_markup = o.replyMarkup;
      if (o.replyTo) payload.reply_to_message_id = o.replyTo;
    }

    const [row] = await sql<{ id: string }[]>`
      insert into outbound_queue
        (workspace_id, conversation_id, tg_chat_id, method, payload, next_attempt_at)
      values (${o.workspaceId}, ${o.conversationId ?? null}, ${o.chatId},
              'sendMessage', ${sql.json(payload)},
              ${o.enviarEn ?? new Date()})
      returning id`;
    if (row) ids.push(row.id);
  }
  return ids;
}

/** Cancela envíos pendientes de una conversación. Usado al bloquear o cancelar. */
export async function cancelarPendientes(conversationId: string, motivo: string): Promise<number> {
  const filas = await sql`
    update outbound_queue
       set status = 'skipped', error = ${motivo}
     where conversation_id = ${conversationId} and status = 'pending'
     returning id`;
  return filas.length;
}
