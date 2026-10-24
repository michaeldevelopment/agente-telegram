/**
 * El motor de decisión. Corre ANTES de gastar el modelo: 0 tokens, pura
 * lógica sobre el estado ya cargado. Decide si el turno lo atiende el
 * agente, un handler determinista, o nadie.
 *
 * La gran diferencia con el blueprint original: aquí NO hay clasificador
 * LLM. El original hacía dos llamadas por turno (clasificar con un modelo
 * barato, responder con uno fuerte); con deepseek-flash el modelo de
 * respuesta YA es el barato, así que un clasificador aparte solo duplica
 * las llamadas y el prefijo cacheado. Si te ves tentado a añadir una
 * llamada "para decidir", para: relee ../../memoria/sin-clasificador-llm.md
 */
import { isClinicalUrgency } from "../guardrails/urgency.js";

export type Turn = {
  /** "/start" → "start". Viene normalizado desde ingress/normalize.ts. */
  command?: string;
  /** Presente si el update es un callback_query (botón pulsado). */
  callbackData?: string;
  /** Texto libre del turno — solo para la capa 1 de guardrail (spec 15). */
  text?: string;
};

/** Lo mínimo del estado de la conversación que decide() necesita ver. */
export type EstadoDecision = {
  isBlocked: boolean;
  aiEnabled: boolean;
  state: string;
};

export type AbstainReason =
  | "blocked" | "ai_disabled" | "human_active" | "paused" | "closed";

export type Decision =
  | { kind: "run_agent" }
  | { kind: "deterministic"; handler: string }
  | { kind: "abstain"; reason: AbstainReason };

/**
 * El orden es deliberado: los `abstain` van primero porque son la garantía
 * de la state machine (../../knowledge/wiki/State-Machine-y-Handoff.md).
 * Después los caminos gratis (comandos, botones). El agente es el último
 * recurso, nunca el primer intento.
 *
 * ⚠️ `handoff_pending` TAMBIÉN abstiene, igual que `human_active`: es la
 * ventana en que la escalada ya se detectó pero nadie la tomó todavía. Si
 * la IA sigue hablando ahí, contradice al humano que está a punto de entrar.
 *
 * ⚠️ Excepción deliberada: `/start` SÍ rompe `paused` y `closed`.
 *
 * El blueprint original no distingue esto — su pseudocódigo bloquea
 * cualquier comando mientras el estado no sea `ai_active`. Pero eso
 * contradice el propio diagrama de la state machine
 * (`paused <──> ai_active`, `closed ──nuevo mensaje──> ai_active`) y el
 * criterio de aceptación de esta spec: el paciente siempre puede retomar
 * con el bot escribiendo /start de nuevo.
 *
 * La excepción es ANGOSTA a propósito: solo el comando `start`, y solo
 * desde los dos estados "en reposo" (`paused`, `closed`), donde no hay
 * nadie más interactuando. `human_active` y `handoff_pending` NO se saltan
 * con /start — ahí hay, o está a punto de haber, una persona real
 * atendiendo, y un /start del paciente no le arrebata la conversación.
 * Esa salida es del humano (el botón "Devolver", en la spec 13).
 */
export function decide(turn: Turn, conv: EstadoDecision): Decision {
  if (conv.isBlocked) return { kind: "abstain", reason: "blocked" };
  if (!conv.aiEnabled) return { kind: "abstain", reason: "ai_disabled" };

  if (turn.command === "start" && (conv.state === "paused" || conv.state === "closed")) {
    return { kind: "deterministic", handler: "start" };
  }

  if (conv.state === "human_active") return { kind: "abstain", reason: "human_active" };
  if (conv.state === "handoff_pending") return { kind: "abstain", reason: "human_active" };
  if (conv.state === "paused") return { kind: "abstain", reason: "paused" };
  if (conv.state === "closed") return { kind: "abstain", reason: "closed" };

  if (turn.command) return { kind: "deterministic", handler: turn.command };
  if (turn.callbackData) return { kind: "deterministic", handler: "callback" };

  // Capa 1 de guardrail clínico (spec 15): 0 tokens, lista de términos, no
  // un modelo. Determinista y, al devolverse ANTES del run_agent, también
  // salta el buffer — un dolor severo no espera 12 s de silencio.
  if (turn.text && isClinicalUrgency(turn.text)) {
    return { kind: "deterministic", handler: "urgencia" };
  }

  return { kind: "run_agent" };
}
