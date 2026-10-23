import { sql } from "../db/client.js";
import type { Inbound } from "./normalize.js";

export type Workspace = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  webhookSecret: string | null;
  webhookPath: string | null;
};

export type Conversacion = {
  contactId: string;
  conversationId: string;
  isBlocked: boolean;
  state: string;
  aiEnabled: boolean;
};

/**
 * Cache del workspace en memoria.
 *
 * El webhook consulta el workspace ANTES de responder el ACK, y el objetivo
 * son <100 ms. Un viaje a Supabase desde aquí ya cuesta ~150 ms, así que sin
 * cache el ACK nunca baja del objetivo.
 *
 * 60 s es suficiente: los datos que se leen aquí (secreto, path, nombre) solo
 * cambian al correr `npm run webhook` o `npm run seed`, y ambos invalidan.
 */
const CACHE_MS = 60_000;
const cacheWs = new Map<string, { ws: Workspace | null; hasta: number }>();

export function invalidarCacheWorkspace(slug?: string): void {
  if (slug) cacheWs.delete(slug);
  else cacheWs.clear();
}

/** Busca el workspace por slug. El path se compara en la ruta, no aquí. */
export async function getWorkspace(slug: string): Promise<Workspace | null> {
  const cached = cacheWs.get(slug);
  if (cached && cached.hasta > Date.now()) return cached.ws;

  const [w] = await sql<
    { id: string; slug: string; name: string; timezone: string;
      webhook_secret: string | null; webhook_path: string | null }[]
  >`select id, slug, name, timezone, webhook_secret, webhook_path
      from workspaces where slug = ${slug} and is_active limit 1`;

  const ws: Workspace | null = w
    ? {
        id: w.id,
        slug: w.slug,
        name: w.name,
        timezone: w.timezone,
        webhookSecret: w.webhook_secret,
        webhookPath: w.webhook_path,
      }
    : null;

  // Los negativos se cachean menos: un slug mal escrito no debe quedar fijo un minuto.
  cacheWs.set(slug, { ws, hasta: Date.now() + (ws ? CACHE_MS : 5_000) });
  return ws;
}

/**
 * Asegura contacto y conversación para el chat. Idempotente.
 *
 * Los datos de Telegram (nombre, username) se refrescan en cada mensaje
 * porque el usuario puede cambiarlos. `full_name` NO se toca aquí: ese lo
 * declara el paciente y lo escribe `guardar_datos_paciente` (spec 09).
 */
export async function upsertContactoYConversacion(
  ws: Workspace,
  ev: Inbound,
): Promise<Conversacion> {
  const [c] = await sql<{ id: string; is_blocked: boolean }[]>`
    insert into contacts (workspace_id, tg_chat_id, tg_user_id, tg_username,
                          first_name, last_name, language_code, source)
    values (${ws.id}, ${ev.chatId}, ${ev.userId}, ${ev.from.username ?? null},
            ${ev.from.firstName ?? null}, ${ev.from.lastName ?? null},
            ${ev.from.languageCode ?? null}, ${ev.startPayload ?? null})
    on conflict (workspace_id, tg_chat_id) do update set
      tg_user_id    = excluded.tg_user_id,
      tg_username   = excluded.tg_username,
      first_name    = excluded.first_name,
      last_name     = excluded.last_name,
      language_code = excluded.language_code,
      -- el origen se conserva: solo se escribe la primera vez
      source        = coalesce(contacts.source, excluded.source),
      updated_at    = now()
    returning id, is_blocked`;
  if (!c) throw new Error("no se pudo crear el contacto");

  const [conv] = await sql<{ id: string; state: string; ai_enabled: boolean }[]>`
    insert into conversations (workspace_id, contact_id, last_message_at, msg_count)
    values (${ws.id}, ${c.id}, now(), 1)
    on conflict (workspace_id, contact_id) do update set
      last_message_at = now(),
      msg_count       = conversations.msg_count + 1,
      updated_at      = now()
    returning id, state, ai_enabled`;
  if (!conv) throw new Error("no se pudo crear la conversación");

  return {
    contactId: c.id,
    conversationId: conv.id,
    isBlocked: c.is_blocked,
    state: conv.state,
    aiEnabled: conv.ai_enabled,
  };
}

/**
 * Guarda el mensaje entrante. `isNew: false` significa que Telegram reintentó
 * y ya lo habíamos procesado: lo frena `uq_messages_update`, no la memoria,
 * porque el proceso puede reiniciar y los reintentos pueden ser paralelos.
 */
export async function insertInboundOnConflictDoNothing(
  ws: Workspace,
  conv: Conversacion,
  ev: Inbound,
): Promise<{ isNew: boolean; id?: string }> {
  const [row] = await sql<{ id: string }[]>`
    insert into messages (workspace_id, conversation_id, direction, kind, body,
                          tg_update_id, tg_message_id, meta)
    values (${ws.id}, ${conv.conversationId}, 'in', ${ev.kind}, ${ev.text ?? null},
            ${ev.updateId}, ${ev.messageId ?? null},
            ${sql.json({ command: ev.command ?? null, callbackData: ev.callbackData ?? null })})
    on conflict (workspace_id, tg_update_id) where tg_update_id is not null
    do nothing
    returning id`;
  return row ? { isNew: true, id: row.id } : { isNew: false };
}

/** Deja constancia de lo que el bot envía. La spec 04 lo mueve al outbox. */
export async function insertOutbound(
  ws: Workspace,
  conv: Conversacion,
  texto: string,
  tgMessageId?: number,
): Promise<void> {
  await sql`
    insert into messages (workspace_id, conversation_id, direction, kind, body, tg_message_id)
    values (${ws.id}, ${conv.conversationId}, 'out', 'text', ${texto}, ${tgMessageId ?? null})`;
  await sql`update conversations set last_ai_at = now() where id = ${conv.conversationId}`;
}

/** El usuario bloqueó el bot: dejar de insistir. */
export async function marcarBloqueado(ws: Workspace, chatId: number, bloqueado: boolean) {
  await sql`update contacts set is_blocked = ${bloqueado}, updated_at = now()
             where workspace_id = ${ws.id} and tg_chat_id = ${chatId}`;
}

// `logEvent` vive en src/obs/events.ts desde la spec 05.
export { logEvent } from "../obs/events.js";
