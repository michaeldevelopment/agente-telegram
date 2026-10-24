import { DateTime } from "luxon";
import { sql } from "../db/client.js";
import { call } from "../telegram/api.js";
import { handoffChatId } from "../handoff/group.js";
import { getWorkspaceById, type Workspace } from "../ingress/persist.js";

/**
 * Alertas operativas al grupo interno (spec 15). A diferencia de
 * `handoff/group.ts`, esto NO abre un handoff ni trae botones: es un aviso
 * para que el equipo mire algo, no una conversación que alguien deba tomar.
 *
 * Disparadores: DeepSeek 402 (sin saldo) · 3 fallos de LLM seguidos ·
 * cache hit diario < 40% · cualquier `guardrail` disparado (este último sin
 * umbral: en un cliente de salud, cada bloqueo lo mira alguien).
 */
async function alertarGrupo(ws: Workspace, texto: string): Promise<void> {
  try {
    await call("sendMessage", { chat_id: handoffChatId(ws), text: `⚠️ ${texto}` });
  } catch {
    // Si ni avisar se pudo (falta TELEGRAM_HANDOFF_CHAT_ID, red caída), que
    // no tumbe el flujo que disparó la alerta — ya quedó en `events`.
  }
}

export async function alertarSinSaldo(ws: Workspace): Promise<void> {
  await alertarGrupo(ws,
    "DeepSeek se quedó sin saldo (402). El agente está degradando a handoff en todas las conversaciones hasta que se recargue.");
}

export async function alertarGuardrail(ws: Workspace, rule: string): Promise<void> {
  await alertarGrupo(ws, `Se bloqueó una respuesta del agente por la regla "${rule}". Revisa la conversación.`);
}

export async function alertarFallosLlmSeguidos(ws: Workspace, conversationId: string, n: number): Promise<void> {
  await alertarGrupo(ws, `El agente falló ${n} veces seguidas respondiendo en la conversación ${conversationId}.`);
}

/**
 * Corre una vez al día (deduplicado vía `runtime_config`, no un cron
 * aparte): si el cache hit de HOY está por debajo de 40%, avisa. Se llama
 * desde el tick de recordatorios, que ya despierta cada minuto.
 */
export async function revisarCacheHitDiario(): Promise<void> {
  const [ws] = await sql<{ id: string; timezone: string }[]>`select id, timezone from workspaces limit 1`;
  if (!ws) return;

  const hoy = DateTime.now().setZone(ws.timezone).toISODate();
  const [flag] = await sql<{ value: string }[]>`
    select value from runtime_config where key = 'cache_alert_checked_day'`;
  if (flag?.value === hoy) return; // ya se revisó hoy

  const [fila] = await sql<{ cache_hit_pct: number | null }[]>`
    select cache_hit_pct from v_llm_daily order by dia desc limit 1`;

  await sql`
    insert into runtime_config (key, value) values ('cache_alert_checked_day', ${hoy})
    on conflict (key) do update set value = excluded.value`;

  if (fila?.cache_hit_pct !== null && fila?.cache_hit_pct !== undefined && fila.cache_hit_pct < 40) {
    const wsCompleta = await getWorkspaceById(ws.id);
    if (wsCompleta) {
      await alertarGrupo(wsCompleta,
        `El cache hit de hoy es ${fila.cache_hit_pct}% (<40%). Probablemente hay un dato volátil ` +
          `infiltrado en el prompt — revisa antes de que el costo se dispare.`);
    }
  }
}

/** Para los smoke tests: fuerza a que la próxima llamada vuelva a revisar, sin esperar al día siguiente. */
export async function _soloParaPruebas_resetearRevisionDiaria(): Promise<void> {
  await sql`delete from runtime_config where key = 'cache_alert_checked_day'`;
}
