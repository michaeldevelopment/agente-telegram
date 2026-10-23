import { env, requireEnv } from "../config/env.js";

/**
 * Cliente del Bot API de Telegram.
 *
 * Los errores se tipan porque cada código pide una reacción distinta y la
 * spec 04 va a ramificar sobre ellos:
 *   429 → respetar parameters.retry_after
 *   403 → el usuario bloqueó el bot: marcar y dejar de enviar
 *   400 can't parse entities → reintentar sin parse_mode
 */

const API = "https://api.telegram.org";

export class TelegramError extends Error {
  constructor(
    readonly status: number,
    readonly description: string,
    readonly parameters?: { retry_after?: number; migrate_to_chat_id?: number },
  ) {
    super(`Telegram ${status}: ${description}`);
    this.name = "TelegramError";
  }

  /** El usuario bloqueó el bot o la cuenta ya no existe. */
  get esBloqueo(): boolean {
    return this.status === 403 && /blocked|deactivated|kicked/i.test(this.description);
  }

  /** El HTML del mensaje venía mal formado. */
  get esHtmlRoto(): boolean {
    return this.status === 400 && /can't parse entities/i.test(this.description);
  }

  get reintentarEn(): number | null {
    return this.status === 429 ? (this.parameters?.retry_after ?? 5) + 1 : null;
  }
}

export async function call<T = unknown>(
  method: string,
  payload: Record<string, unknown> = {},
  token = requireEnv("TELEGRAM_BOT_TOKEN", "el cliente de Telegram"),
): Promise<T> {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = (await res.json()) as {
    ok: boolean;
    result?: T;
    description?: string;
    error_code?: number;
    parameters?: { retry_after?: number };
  };

  if (!body.ok) {
    throw new TelegramError(
      body.error_code ?? res.status,
      body.description ?? "sin descripción",
      body.parameters,
    );
  }
  return body.result as T;
}

// ── Métodos que se usan ──────────────────────────────────────

export type TgMessage = { message_id: number; chat: { id: number } };

export function sendMessage(opts: {
  chat_id: number;
  text: string;
  parse_mode?: "HTML";
  reply_markup?: unknown;
  reply_to_message_id?: number;
}): Promise<TgMessage> {
  return call<TgMessage>("sendMessage", { ...opts });
}

/** Obligatorio tras un callback_query, o el botón se queda girando. */
export function answerCallbackQuery(opts: {
  callback_query_id: string;
  text?: string;
  show_alert?: boolean;
}): Promise<boolean> {
  return call<boolean>("answerCallbackQuery", { ...opts });
}

export function getFile(file_id: string): Promise<{ file_path?: string }> {
  return call("getFile", { file_id });
}

export function getMe(): Promise<{ id: number; username?: string; first_name: string }> {
  return call("getMe");
}

export function setWebhook(opts: {
  url: string;
  secret_token: string;
  allowed_updates: string[];
  max_connections?: number;
  drop_pending_updates?: boolean;
}): Promise<boolean> {
  return call<boolean>("setWebhook", { ...opts });
}

export function getWebhookInfo(): Promise<{
  url: string;
  pending_update_count: number;
  last_error_message?: string;
  last_error_date?: number;
  max_connections?: number;
  allowed_updates?: string[];
}> {
  return call("getWebhookInfo");
}

/** URL de descarga de un archivo. Máx. 20 MB. */
export function fileUrl(filePath: string): string {
  return `${API}/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;
}
