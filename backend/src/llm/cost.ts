/**
 * Costo de una llamada a DeepSeek, calculado de los tokens.
 *
 * DeepSeek NO devuelve `usage.cost` (a diferencia de OpenRouter), así que el
 * cálculo es nuestro. Sin esto, `events.llm_call` no sirve para nada y el
 * paso 12 de la demo —enseñarle al cliente lo que cuesta— no existe.
 */

/** USD por millón de tokens. */
const TARIFA = {
  offPeak: { hit: 0.003, miss: 0.15, output: 0.6 },
  peak: { hit: 0.006, miss: 0.3, output: 1.2 },
} as const;

/**
 * Horas peak de DeepSeek: 01:00–04:00 y 06:00–10:00 UTC, de lunes a viernes.
 *
 * En Bogotá (UTC-5) eso cae en 20:00–23:00 y 01:00–05:00 locales, así que el
 * horario de la clínica (8–18) está ÍNTEGRAMENTE en off-peak: tarifa reducida
 * sin hacer nada.
 */
export function esPeak(cuando = new Date()): boolean {
  const diaSemana = cuando.getUTCDay(); // 0 = domingo
  if (diaSemana === 0 || diaSemana === 6) return false;
  const h = cuando.getUTCHours();
  return (h >= 1 && h < 4) || (h >= 6 && h < 10);
}

export type Uso = { hit: number; miss: number; output: number };

export function calcularCosto(u: Uso, cuando = new Date()): number {
  const t = esPeak(cuando) ? TARIFA.peak : TARIFA.offPeak;
  return (u.hit * t.hit + u.miss * t.miss + u.output * t.output) / 1_000_000;
}

/** Porcentaje de acierto del cache. El KPI: tiene que superar el 60%. */
export function ratioCache(u: Uso): number {
  const total = u.hit + u.miss;
  return total === 0 ? 0 : Math.round((u.hit / total) * 1000) / 10;
}
