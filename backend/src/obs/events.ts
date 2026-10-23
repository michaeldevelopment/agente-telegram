import { sql } from "../db/client.js";
import type { JsonObjeto } from "../db/json.js";
import { calcularCosto, ratioCache, type Uso } from "../llm/cost.js";

/**
 * `events` es el panel de control. Sin frontend, esta tabla ES la
 * observabilidad: lo que no se registre aquí no existe.
 *
 * Regla de PII: el payload guarda ids y números, nunca cuerpos de mensaje.
 */

export async function logEvent(opts: {
  workspaceId?: string;
  conversationId?: string;
  type: string;
  level?: "debug" | "info" | "warn" | "error";
  payload?: JsonObjeto;
}): Promise<void> {
  await sql`
    insert into events (workspace_id, conversation_id, type, level, payload)
    values (${opts.workspaceId ?? null}, ${opts.conversationId ?? null},
            ${opts.type}, ${opts.level ?? "info"}, ${sql.json(opts.payload ?? {})})`;
}

/**
 * El evento más importante del sistema: de aquí salen `v_llm_daily`, el
 * costo que se le enseña al cliente en el paso 12 de la demo, y el KPI de
 * cache hit, que es la alarma número uno de costo.
 */
export async function logLlmCall(opts: {
  workspaceId: string;
  conversationId: string;
  model: string;
  steps: number;
  uso: Uso;
  latencyMs: number;
  finish?: string | null;
}): Promise<void> {
  await logEvent({
    workspaceId: opts.workspaceId,
    conversationId: opts.conversationId,
    type: "llm_call",
    payload: {
      model: opts.model,
      steps: opts.steps,
      cacheHit: opts.uso.hit,
      cacheMiss: opts.uso.miss,
      outTokens: opts.uso.output,
      cacheHitPct: ratioCache(opts.uso),
      costUsd: calcularCosto(opts.uso),
      latencyMs: opts.latencyMs,
      finish: opts.finish ?? null,
    },
  });
}
