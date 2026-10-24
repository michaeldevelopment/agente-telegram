import crypto from "node:crypto";

/**
 * Capa 3 de guardrail clínico (spec 15): filtro sobre el BORRADOR del
 * modelo, antes de encolar. Es la capa que convierte una regla de prompt en
 * una garantía — un prompt se puede sortear, un filtro de salida no.
 *
 * Dos familias de patrón:
 *   - diagnóstico ("tienes una caries", "es una gingivitis")
 *   - medicación / dosificación ("toma ibuprofeno", "400 mg cada 8 horas")
 *
 * Al disparar, el llamador (`agent/run.ts`) debe:
 *   1. Descartar el borrador COMPLETO. No se parchea: uno parcheado puede
 *      quedar peor que el original.
 *   2. Registrar `guardrail` con `{rule, snippetHash}` — el HASH, nunca el
 *      texto: es PII clínica.
 *   3. Mandar una respuesta segura con oferta de valoración (gratis).
 *   4. Alertar al grupo interno. Sin umbral: cada bloqueo lo mira alguien.
 */

const PATRONES_DIAGNOSTICO: { rule: string; patron: RegExp }[] = [
  { rule: "diagnostico:tienes", patron: /\btienes?\s+(una?\s+)?(caries|gingivitis|pulpitis|absceso|infecci[oó]n)/i },
  { rule: "diagnostico:es-una", patron: /\bes\s+(una?\s+)?(caries|gingivitis|pulpitis|absceso|infecci[oó]n)\b/i },
  { rule: "diagnostico:lo-que-tienes", patron: /\blo\s+que\s+tienes\s+es\b/i },
  { rule: "diagnostico:tu-diagnostico", patron: /\btu\s+diagn[oó]stico\s+es\b/i },
  { rule: "diagnostico:eso-se-llama", patron: /\beso\s+se\s+llama\b/i },
];

const PATRONES_MEDICACION: { rule: string; patron: RegExp }[] = [
  {
    rule: "medicacion:toma",
    patron: /\btoma(te)?\s+(ibuprofeno|acetaminof[eé]n|paracetamol|amoxicilina|dexametasona|naproxeno|aspirina)/i,
  },
  { rule: "medicacion:mg", patron: /\d+\s*mg\b/i },
  { rule: "medicacion:cada-horas", patron: /\bcada\s+\d+\s*horas?\b/i },
  { rule: "medicacion:dosis", patron: /\b(dosis|dosificaci[oó]n)\s+(de|recomendada)\b/i },
];

export type HallazgoGuardrail = { rule: string; snippetHash: string };

/** Solo el hash: el texto que lo disparó es PII clínica, nunca se guarda. */
function hashSnippet(texto: string): string {
  return crypto.createHash("sha256").update(texto).digest("hex").slice(0, 16);
}

/** `null` si el borrador pasa limpio. */
export function filtrarBorrador(texto: string): HallazgoGuardrail | null {
  for (const { rule, patron } of [...PATRONES_DIAGNOSTICO, ...PATRONES_MEDICACION]) {
    if (patron.test(texto)) return { rule, snippetHash: hashSnippet(texto) };
  }
  return null;
}

/** La respuesta segura que reemplaza TODO borrador bloqueado. */
export const RESPUESTA_SEGURA =
  "Eso es algo que te puede confirmar el doctor en consulta — no te lo puedo decir yo. " +
  "¿Quieres que te agende una valoración? Es gratuita.";
