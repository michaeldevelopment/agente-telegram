/**
 * Preparación del texto antes de enviarlo a Telegram.
 *
 * Tres cosas, en este orden:
 *   1. Limpiar el markdown que el modelo mete por costumbre.
 *   2. Escapar `& < >` — sin esto, un `<` suelto tumba el envío con 400.
 *   3. Cortar a 4096 chars POR PÁRRAFO, nunca a mitad de palabra.
 */

/** Límite duro de Telegram. */
export const MAX_CHARS = 4096;

/**
 * Margen bajo el límite: al trocear dejamos aire para no quedar justo en la
 * frontera, que es donde aparecen los `400 message is too long` raros.
 */
const CORTE = 3900;

/** Escapa lo que rompe `parse_mode: "HTML"`. Solo estos tres, no más. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Quita el markdown que el modelo produce aunque el prompt le diga que no.
 * Telegram con parse_mode HTML no lo interpreta, así que llegaría literal:
 * el paciente vería los asteriscos.
 */
export function limpiarMarkdown(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, "")      // bloques de código: no pintan nada aquí
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")         // encabezados
    .replace(/^\s*[-*+]\s+/gm, "• ")     // viñetas → carácter plano
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Trocea respetando la estructura del texto: primero por párrafo, luego por
 * línea, y solo como último recurso por palabra. Nunca parte una palabra.
 */
export function trocear(texto: string, max = CORTE): string[] {
  // Un texto en blanco no es un mensaje: Telegram lo rechazaría con 400.
  const recortado = texto.trim();
  if (!recortado) return [];
  if (recortado.length <= max) return [recortado];

  const salida: string[] = [];
  let actual = "";

  const empujar = () => {
    if (actual.trim()) salida.push(actual.trim());
    actual = "";
  };

  for (const parrafo of texto.split(/\n\n+/)) {
    const candidato = actual ? `${actual}\n\n${parrafo}` : parrafo;

    if (candidato.length <= max) {
      actual = candidato;
      continue;
    }
    empujar();

    if (parrafo.length <= max) {
      actual = parrafo;
      continue;
    }

    // Un párrafo solo ya pasa del límite: bajar a líneas.
    for (const linea of parrafo.split("\n")) {
      const c2 = actual ? `${actual}\n${linea}` : linea;
      if (c2.length <= max) {
        actual = c2;
        continue;
      }
      empujar();

      if (linea.length <= max) {
        actual = linea;
        continue;
      }

      // Una línea sola pasa del límite: cortar por palabra.
      for (const palabra of linea.split(/\s+/)) {
        const c3 = actual ? `${actual} ${palabra}` : palabra;
        if (c3.length <= max) actual = c3;
        else {
          empujar();
          // Una palabra más larga que el límite (una URL enorme): se parte.
          if (palabra.length > max) {
            for (let i = 0; i < palabra.length; i += max) {
              salida.push(palabra.slice(i, i + max));
            }
          } else actual = palabra;
        }
      }
    }
  }
  empujar();
  return salida;
}

/**
 * Pipeline completo: limpia, escapa y trocea.
 * Devuelve los textos listos para `sendMessage` con `parse_mode: "HTML"`.
 */
export function prepararTexto(texto: string, opts: { escapar?: boolean } = {}): string[] {
  const limpio = limpiarMarkdown(texto);
  // `escapar: false` solo para HTML que construimos nosotros y ya es seguro.
  const seguro = opts.escapar === false ? limpio : escapeHtml(limpio);
  return trocear(seguro);
}
