import { EnvFaltante } from "../config/env.js";
import { sql } from "../db/client.js";
import type { JsonObjeto } from "../db/json.js";
import { logEvent } from "../ingress/persist.js";
import { call, TelegramError, type TgMessage } from "../telegram/api.js";
import { trocear } from "./format.js";

/**
 * Drenado de `outbound_queue`.
 *
 * Límites de Telegram (§6.2): 30 msg/s globales y ~1 msg/s por chat. Nos
 * quedamos por debajo a propósito: un 429 cuesta más que ir despacio.
 */
const PER_CHAT_MIN_GAP_MS = 1100;   // ~1 msg/s por chat
const GLOBAL_MAX_PER_SEC = 25;      // margen bajo el límite de 30/s
const TICK_MS = 250;
const MAX_ATTEMPTS = 5;

/**
 * Lease: al reclamar una fila se empuja su `next_attempt_at` al futuro.
 * Si el proceso muere a mitad de envío, nadie la toca hasta que expire y
 * entonces se reintenta sola. No hace falta estado en memoria ni un
 * estado 'sending' en el enum.
 */
const LEASE_MS = 30_000;

type Fila = {
  id: string;
  workspace_id: string;
  conversation_id: string | null;
  tg_chat_id: string;          // bigint llega como string
  method: string;
  payload: JsonObjeto;
  attempts: number;
};

const ultimoEnvioPorChat = new Map<string, number>();
let ventanaGlobal: number[] = [];
let corriendo = false;
let timer: NodeJS.Timeout | null = null;

// ── Gobierno del ritmo ───────────────────────────────────────

function puedeEnviar(chatId: string): boolean {
  const ahora = Date.now();
  ventanaGlobal = ventanaGlobal.filter((t) => ahora - t < 1000);
  if (ventanaGlobal.length >= GLOBAL_MAX_PER_SEC) return false;
  const ultimo = ultimoEnvioPorChat.get(chatId) ?? 0;
  return ahora - ultimo >= PER_CHAT_MIN_GAP_MS;
}

function registrarEnvio(chatId: string): void {
  const ahora = Date.now();
  ultimoEnvioPorChat.set(chatId, ahora);
  ventanaGlobal.push(ahora);
  // Sin esto el Map crece sin freno en un proceso de larga vida.
  if (ultimoEnvioPorChat.size > 5000) {
    for (const [k, t] of ultimoEnvioPorChat) {
      if (ahora - t > 60_000) ultimoEnvioPorChat.delete(k);
    }
  }
}

// ── Transiciones de la fila ──────────────────────────────────

async function marcarEnviado(id: string, messageId: number | null) {
  await sql`update outbound_queue set status = 'sent', tg_message_id = ${messageId}, error = null
             where id = ${id}`;
}

/** Un bloqueo NO es un fallo que haya que reintentar. */
async function marcarOmitido(id: string, motivo: string) {
  await sql`update outbound_queue set status = 'skipped', error = ${motivo} where id = ${id}`;
}

async function marcarFallido(id: string, motivo: string) {
  await sql`update outbound_queue set status = 'failed', error = ${motivo} where id = ${id}`;
}

/** Reprograma. `sinContarIntento` para los 429: la culpa no es de la fila. */
async function reprogramar(id: string, segundos: number, motivo: string, sinContarIntento = false) {
  await sql`
    update outbound_queue
       set next_attempt_at = now() + (${segundos} || ' seconds')::interval,
           error = ${motivo},
           attempts = attempts - ${sinContarIntento ? 1 : 0}
     where id = ${id}`;
}

/** Reclama una fila vencida y le pone el lease, todo en un UPDATE atómico. */
async function reclamar(): Promise<Fila | null> {
  const [fila] = await sql<Fila[]>`
    update outbound_queue o
       set attempts = o.attempts + 1,
           next_attempt_at = now() + (${Math.round(LEASE_MS / 1000)} || ' seconds')::interval
      from (
        select id from outbound_queue
         where status = 'pending' and next_attempt_at <= now()
         order by next_attempt_at
         for update skip locked
         limit 1
      ) s
     where o.id = s.id
    returning o.id, o.workspace_id, o.conversation_id, o.tg_chat_id,
              o.method, o.payload, o.attempts`;
  return fila ?? null;
}

// ── El envío de una fila ─────────────────────────────────────

async function enviarUna(fila: Fila): Promise<void> {
  const chatId = fila.tg_chat_id;
  try {
    const res = await call<TgMessage>(fila.method, fila.payload);
    registrarEnvio(chatId);
    await marcarEnviado(fila.id, (res as TgMessage)?.message_id ?? null);
    return;
  } catch (e) {
    // Falta una variable de entorno: reintentar no la va a poner. Es un
    // problema de configuración, no un fallo transitorio, así que se marca
    // de una en vez de quemar 5 intentos con backoff.
    if (e instanceof EnvFaltante) {
      await logEvent({
        workspaceId: fila.workspace_id, conversationId: fila.conversation_id ?? undefined,
        type: "send_error", level: "error",
        payload: { motivo: e.message, accion: "no se reintenta: es configuración" },
      });
      return marcarFallido(fila.id, e.message);
    }

    if (!(e instanceof TelegramError)) {
      // Red caída, DNS, timeout: transitorio, backoff.
      const motivo = e instanceof Error ? e.message : String(e);
      if (fila.attempts >= MAX_ATTEMPTS) return marcarFallido(fila.id, motivo);
      return reprogramar(fila.id, 2 ** fila.attempts, motivo);
    }

    // 429 — flood control. Respetar retry_after SIN excepción.
    const espera = e.reintentarEn;
    if (espera !== null) {
      await logEvent({
        workspaceId: fila.workspace_id, conversationId: fila.conversation_id ?? undefined,
        type: "send_error", level: "warn",
        payload: { code: 429, retryAfter: espera, attempts: fila.attempts },
      });
      // No cuenta como intento: la culpa es del ritmo, no del mensaje.
      return reprogramar(fila.id, espera, `429 flood control`, true);
    }

    // 403 — el usuario bloqueó el bot. Dejar de insistir, aquí y en el futuro.
    if (e.esBloqueo) {
      await sql`update contacts set is_blocked = true, updated_at = now()
                 where workspace_id = ${fila.workspace_id} and tg_chat_id = ${chatId}`;
      if (fila.conversation_id) {
        await sql`update outbound_queue set status = 'skipped', error = 'contacto bloqueado'
                   where conversation_id = ${fila.conversation_id} and status = 'pending'`;
        await sql`update reminders set status = 'cancelled'
                   where status = 'pending' and appointment_id in (
                     select id from appointments where conversation_id = ${fila.conversation_id})`;
      }
      await logEvent({
        workspaceId: fila.workspace_id, conversationId: fila.conversation_id ?? undefined,
        type: "send_error", level: "warn",
        payload: { code: 403, description: e.description, accion: "contacto bloqueado" },
      });
      return marcarOmitido(fila.id, e.description);
    }

    // 400 can't parse entities — el HTML venía roto. Reintentar en plano.
    if (e.esHtmlRoto && fila.payload.parse_mode) {
      const sinModo: JsonObjeto = { ...fila.payload };
      delete sinModo.parse_mode;
      await sql`update outbound_queue
                   set payload = ${sql.json(sinModo)}, next_attempt_at = now(),
                       error = 'reintento sin parse_mode', attempts = attempts - 1
                 where id = ${fila.id}`;
      return;
    }

    // 400 message is too long — red de seguridad: el troceo es al encolar.
    if (e.status === 400 && /message is too long/i.test(e.description)) {
      return trocearYReencolar(fila);
    }

    await logEvent({
      workspaceId: fila.workspace_id, conversationId: fila.conversation_id ?? undefined,
      type: "send_error", level: "error",
      payload: { code: e.status, description: e.description, attempts: fila.attempts },
    });

    if (fila.attempts >= MAX_ATTEMPTS) return marcarFallido(fila.id, e.description);
    return reprogramar(fila.id, 2 ** fila.attempts, e.description);
  }
}

async function trocearYReencolar(fila: Fila): Promise<void> {
  const texto = String(fila.payload.text ?? "");
  const trozos = trocear(texto, 3500);
  if (trozos.length <= 1) return marcarFallido(fila.id, "demasiado largo y no se pudo trocear");

  await sql.begin(async (tx) => {
    await tx`update outbound_queue set status = 'skipped', error = 'troceado' where id = ${fila.id}`;
    for (const t of trozos) {
      await tx`
        insert into outbound_queue (workspace_id, conversation_id, tg_chat_id, method, payload)
        values (${fila.workspace_id}, ${fila.conversation_id}, ${fila.tg_chat_id},
                ${fila.method}, ${sql.json({ ...fila.payload, text: t })})`;
    }
  });
}

// ── El loop ──────────────────────────────────────────────────

async function tick(): Promise<void> {
  // Una fila por tick: el límite por chat es secuencial, no se drena en paralelo.
  const fila = await reclamar();
  if (!fila) return;

  if (!puedeEnviar(fila.tg_chat_id)) {
    // Devolver al ruedo enseguida: el ritmo lo marca `puedeEnviar`.
    await sql`update outbound_queue set next_attempt_at = now(), attempts = attempts - 1
               where id = ${fila.id}`;
    return;
  }

  // try/catch POR FILA: un error aquí no puede matar el loop.
  try {
    await enviarUna(fila);
  } catch (e) {
    await marcarFallido(fila.id, e instanceof Error ? e.message : String(e)).catch(() => {});
  }
}

export function arrancarDrenado(log: (msg: string) => void): void {
  if (corriendo) return;
  corriendo = true;
  log(`outbox: drenando cada ${TICK_MS} ms`);

  const bucle = async () => {
    if (!corriendo) return;
    try {
      await tick();
    } catch (e) {
      log(`outbox: error en el tick — ${e instanceof Error ? e.message : String(e)}`);
    }
    if (corriendo) timer = setTimeout(() => void bucle(), TICK_MS);
  };
  void bucle();
}

export function pararDrenado(): void {
  corriendo = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

/**
 * Para los scripts de prueba: drena hasta que no quede nada VENCIDO.
 *
 * El presupuesto es en milisegundos, no en número de ticks: con el límite de
 * 1,1 s por chat, tres mensajes al mismo chat tardan más de 3 s por diseño, y
 * contar ticks hacía que la prueba fallara de forma intermitente cuando el
 * rate limiter estaba haciendo justo su trabajo.
 *
 * Las filas reprogramadas al futuro (un 429, por ejemplo) no cuentan como
 * vencidas, así que la espera termina enseguida en vez de agotar el tiempo.
 */
export async function drenarAhora(msMaximo = 15_000): Promise<void> {
  const limite = Date.now() + msMaximo;
  while (Date.now() < limite) {
    const [pend] = await sql<{ n: number }[]>`
      select count(*)::int as n from outbound_queue
       where status = 'pending' and next_attempt_at <= now()`;
    if (!pend || pend.n === 0) return;
    await tick();
    await new Promise((r) => setTimeout(r, 120));
  }
}
