/**
 * Capa 1 de guardrail clínico (spec 15): lista de términos, NO un modelo.
 * Corre en `decide()`, ANTES de gastar un solo token. No entiende contexto,
 * pero nunca falla en lo que cubre — y por eso dispara dos cosas a la vez:
 * bypass del buffer (un dolor severo no espera 12 s) y handoff inmediato
 * con el teléfono de la clínica.
 *
 * La lista cubre CÓMO HABLA LA GENTE EN CÚCUTA (`../../CONTEXTO.md`), no
 * terminología clínica: el paciente escribe "me está matando la muela", no
 * "odontalgia aguda".
 *
 * 🔑 La asimetría manda el diseño: falso positivo = escalada de más,
 * molesto pero recuperable. Falso negativo = inaceptable. Por eso la lista
 * es GENEROSA — prefiere frases cortas y variantes a una sola frase larga
 * y exacta que el paciente nunca escribirá tal cual.
 */
const TERMINOS_URGENCIA = [
  // dolor severo
  "me esta matando",
  "no aguanto el dolor",
  "no aguanto mas el dolor",
  "no aguanto mas",
  "duele muchisimo",
  "dolor insoportable",
  "dolor fuertisimo",
  // sangrado que no para
  "me sangra y no para",
  "no para de sangrar",
  "esta sangrando",
  // trauma / golpe
  "se me partio un diente",
  "se me partio una muela",
  "se me partio",
  "me dieron un golpe",
  "un golpe fuerte",
  "se me cayo la calza",
  "se me cayo un diente",
  "se me cayo una muela",
  // hinchazón / infección
  "se me hincho la cara",
  "la cara hinchada",
  "tengo un nacido",
  "un nacido",
  // otros, del vocabulario del cliente
  "no puedo abrir la boca",
  "tengo fiebre y me duele",
  "fiebre y me duele la muela",
];

/** Quita acentos y pasa a minúsculas, para no depender de cómo escriba el paciente. */
function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function isClinicalUrgency(texto: string): boolean {
  const n = normalizar(texto);
  return TERMINOS_URGENCIA.some((t) => n.includes(t));
}
