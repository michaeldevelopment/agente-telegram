import { answerCallbackQuery } from "../telegram/api.js";
import type { Inbound } from "../ingress/normalize.js";

/**
 * Ruteo de botones (callback_query). El prefijo de `callback_data` decide
 * qué hacer — los handlers reales llegan con sus specs:
 *
 *   bk:  → agendar un horario (spec 12)
 *   take:/back: → tomar/devolver en el handoff (spec 13)
 *   rc:/rx: → confirmar/cancelar un recordatorio (spec 14)
 *
 * Por ahora solo reconoce el prefijo y confirma. Lo que NUNCA puede faltar,
 * sea cual sea la rama que entre: `answerCallbackQuery`. Sin eso el botón
 * se queda girando en el cliente del paciente — es el error número uno con
 * botones, y por eso cada rama del switch lo llama antes de salir.
 */
export async function handleCallback(ev: Inbound): Promise<void> {
  const data = ev.callbackData ?? "";
  const queryId = ev.callbackQueryId;

  try {
    if (!queryId) return; // no debería pasar: normalize.ts siempre lo trae en un callback

    const prefijo = data.split(":")[0];
    switch (prefijo) {
      case "bk":
      case "take":
      case "back":
      case "rc":
      case "rx":
        // Reconocido, pero el handler llega en una spec posterior.
        await answerCallbackQuery({
          callback_query_id: queryId,
          text: "Esta opción todavía no está activa en la demo.",
        });
        return;
      default:
        await answerCallbackQuery({ callback_query_id: queryId });
    }
  } catch {
    // Si el answer falla (red, token), que no tumbe el ingreso: el botón
    // quedará girando esta vez, pero el proceso sigue vivo para el resto.
  }
}
