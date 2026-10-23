import { sendChatAction } from "./api.js";

/**
 * Indicador de "escribiendo…" reenviado cada 4 s mientras el lote sigue
 * abierto o el modelo trabaja.
 *
 * Es lo que hace el buffer invisible (regla 7 de la spec): sin esto, los
 * 12 s de silencio antes de la respuesta se sienten como un bot caído. El
 * indicador de Telegram dura ≤5 s por sí solo, así que hay que reenviarlo
 * antes de que expire.
 *
 * Nunca lanza: un fallo de red aquí no puede tumbar el flujo del buffer.
 */
const INTERVALO_MS = 4_000;

export function iniciarTyping(chatId: number): { detener: () => void } {
  let activo = true;

  const enviar = () => {
    if (!activo) return;
    void sendChatAction(chatId, "typing").catch(() => {
      // Silencioso a propósito: si el bot está bloqueado o sin token, el
      // flujo principal (outbox) ya lo va a detectar y registrar.
    });
  };

  enviar();
  const intervalo = setInterval(enviar, INTERVALO_MS);

  return {
    detener: () => {
      if (!activo) return;
      activo = false;
      clearInterval(intervalo);
    },
  };
}
