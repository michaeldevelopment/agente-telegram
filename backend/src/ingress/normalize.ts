import { z } from "zod";

/**
 * Update de Telegram → forma plana y estable.
 *
 * El shape de Telegram está documentado y es predecible (a diferencia del de
 * WhatsApp), así que esto es mucho más corto que su equivalente del blueprint
 * original. Zod se queda igual: lo que entra por la red no se confía.
 *
 * ⚠️ chat.id es int64. En TypeScript cabe en `number` hasta 2^53, que sobra
 * para Telegram, pero en la base es BIGINT, nunca int.
 */

export type MsgKind =
  | "text" | "voice" | "photo" | "document"
  | "sticker" | "callback" | "command" | "system";

export type Inbound = {
  updateId: number;
  chatId: number;
  userId: number;
  kind: MsgKind;
  text?: string;          // texto, caption, o título del botón pulsado
  command?: string;       // "/start" → "start"
  startPayload?: string;  // "/start instagram" → "instagram"
  callbackData?: string;
  callbackQueryId?: string;
  /** Solo en callbacks: el texto del mensaje con los botones (spec 13, para editarlo). */
  callbackMessageText?: string;
  messageId?: number;
  /** A qué mensaje responde. Es como el relay del grupo (spec 13) sabe a qué conversación va. */
  replyToMessageId?: number;
  ts: number;             // epoch ms
  from: { firstName?: string; lastName?: string; username?: string; languageCode?: string };
  /** Salida de un chat: el usuario bloqueó el bot o lo echó del grupo. */
  bloqueado?: boolean;
  raw: unknown;
};

const User = z.object({
  id: z.number(),
  is_bot: z.boolean().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
});

const Message = z.object({
  message_id: z.number(),
  from: User.optional(),
  chat: z.object({ id: z.number(), type: z.string().optional() }),
  date: z.number(),
  text: z.string().optional(),
  caption: z.string().optional(),
  voice: z.object({ file_id: z.string() }).optional(),
  photo: z.array(z.object({ file_id: z.string() })).optional(),
  document: z.object({ file_id: z.string() }).optional(),
  sticker: z.object({ file_id: z.string() }).optional(),
  entities: z.array(z.object({ type: z.string(), offset: z.number(), length: z.number() })).optional(),
  reply_to_message: z.object({ message_id: z.number() }).optional(),
});

const CallbackQuery = z.object({
  id: z.string(),
  from: User,
  data: z.string().optional(),
  message: Message.partial({ date: true }).optional(),
});

const MyChatMember = z.object({
  chat: z.object({ id: z.number(), type: z.string().optional() }),
  from: User,
  date: z.number(),
  new_chat_member: z.object({ status: z.string() }),
});

export const Update = z.object({
  update_id: z.number(),
  message: Message.optional(),
  edited_message: Message.optional(),
  callback_query: CallbackQuery.optional(),
  my_chat_member: MyChatMember.optional(),
});

export type UpdateT = z.infer<typeof Update>;

function tipoDeMensaje(m: z.infer<typeof Message>): MsgKind {
  if (m.voice) return "voice";
  if (m.photo) return "photo";
  if (m.document) return "document";
  if (m.sticker) return "sticker";
  return "text";
}

/**
 * `/start instagram` → { command: "start", startPayload: "instagram" }
 * Solo cuenta como comando si va al principio del mensaje.
 */
function parsearComando(m: z.infer<typeof Message>): { command?: string; payload?: string } {
  const texto = m.text ?? "";
  const esComando =
    m.entities?.some((e) => e.type === "bot_command" && e.offset === 0) ?? /^\//.test(texto);
  if (!esComando) return {};

  const match = texto.match(/^\/([A-Za-z0-9_]+)(?:@\w+)?(?:\s+(.*))?$/s);
  if (!match) return {};
  return { command: match[1]?.toLowerCase(), payload: match[2]?.trim() || undefined };
}

/** Devuelve null si el update no es de un tipo que nos interese. */
export function normalize(raw: unknown): Inbound | null {
  const parsed = Update.safeParse(raw);
  if (!parsed.success) return null;
  const u = parsed.data;

  // ── Botón pulsado ────────────────────────────────────────
  if (u.callback_query) {
    const cq = u.callback_query;
    const chatId = cq.message?.chat.id ?? cq.from.id;
    return {
      updateId: u.update_id,
      chatId,
      userId: cq.from.id,
      kind: "callback",
      callbackData: cq.data,
      callbackQueryId: cq.id,
      callbackMessageText: cq.message?.text,
      text: cq.data,
      messageId: cq.message?.message_id,
      ts: Date.now(),
      from: {
        firstName: cq.from.first_name,
        lastName: cq.from.last_name,
        username: cq.from.username,
        languageCode: cq.from.language_code,
      },
      raw,
    };
  }

  // ── Cambio de estado del bot en un chat ──────────────────
  if (u.my_chat_member) {
    const mcm = u.my_chat_member;
    const salio = ["kicked", "left"].includes(mcm.new_chat_member.status);
    return {
      updateId: u.update_id,
      chatId: mcm.chat.id,
      userId: mcm.from.id,
      kind: "system",
      text: `my_chat_member: ${mcm.new_chat_member.status}`,
      ts: mcm.date * 1000,
      from: {
        firstName: mcm.from.first_name,
        lastName: mcm.from.last_name,
        username: mcm.from.username,
        languageCode: mcm.from.language_code,
      },
      bloqueado: salio,
      raw,
    };
  }

  // ── Mensaje ──────────────────────────────────────────────
  const m = u.message ?? u.edited_message;
  if (!m) return null;

  const { command, payload } = parsearComando(m);
  return {
    updateId: u.update_id,
    chatId: m.chat.id,
    userId: m.from?.id ?? m.chat.id,
    kind: command ? "command" : tipoDeMensaje(m),
    text: m.text ?? m.caption,
    command,
    startPayload: command === "start" ? payload : undefined,
    messageId: m.message_id,
    replyToMessageId: m.reply_to_message?.message_id,
    ts: m.date * 1000,
    from: {
      firstName: m.from?.first_name,
      lastName: m.from?.last_name,
      username: m.from?.username,
      languageCode: m.from?.language_code,
    },
    raw,
  };
}
