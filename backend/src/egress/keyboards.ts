import type { SlotDTO } from "../gcal/slots.js";

/**
 * Teclado de horarios (spec 12). Un botón por fila: en móvil se leen mejor,
 * y las etiquetas de fecha ("jue 29 oct · 10:30 a. m.") son largas.
 *
 * `callback_data` codifica TODO lo que el handler necesita para agendar sin
 * preguntarle nada al modelo: `bk:<slug del servicio>:<epochMin>`.
 *
 * ⚠️ Límite duro de Telegram: 64 bytes. `epochMin` (minutos, no segundos ni
 * milisegundos) es lo que lo hace caber — y nunca un uuid completo.
 */
export function tecladoDeSlots(servicioSlug: string, slots: SlotDTO[]): {
  inline_keyboard: { text: string; callback_data: string }[][];
} {
  return {
    inline_keyboard: slots.map((s) => [{
      text: s.label,
      callback_data: `bk:${servicioSlug}:${s.epochMin}`,
    }]),
  };
}

/**
 * Igual que `tecladoDeSlots`, pero para MOVER una cita existente (spec 14:
 * botón "Reprogramar" del recordatorio) en vez de crear una nueva. El
 * prefijo `rb:` le dice al handler que llame a `reprogramar_cita`, no a
 * `agendar_cita` — si no, el paciente terminaría con dos citas.
 */
export function tecladoReprogramar(apptCorto: string, slots: SlotDTO[]): {
  inline_keyboard: { text: string; callback_data: string }[][];
} {
  return {
    inline_keyboard: slots.map((s) => [{
      text: s.label,
      callback_data: `rb:${apptCorto}:${s.epochMin}`,
    }]),
  };
}
