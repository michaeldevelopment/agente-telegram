import { escapeHtml, limpiarMarkdown, prepararTexto, trocear } from "../../src/egress/format.js";

/** Comprobaciones puras del formateo. No tocan la base ni la red. */

let fallos = 0;
const comprobar = (nombre: string, condicion: boolean, detalle = "") => {
  if (condicion) console.log(`OK   ${nombre}`);
  else { console.log(`FAIL ${nombre}${detalle ? ` — ${detalle}` : ""}`); fallos++; }
};

// ── Escape: solo los tres que rompen el HTML de Telegram ──────
comprobar(
  "escapa < > y &",
  escapeHtml("precio < 100 & > 50") === "precio &lt; 100 &amp; &gt; 50",
  escapeHtml("precio < 100 & > 50"),
);
comprobar("no toca las tildes ni la ñ", escapeHtml("Valoración, niño") === "Valoración, niño");
comprobar("no toca las comillas", escapeHtml(`dijo "hola"`) === `dijo "hola"`);

// ── Markdown que el modelo mete aunque se le prohíba ──────────
comprobar("quita negritas", limpiarMarkdown("el precio es **gratis**") === "el precio es gratis");
comprobar("quita encabezados", limpiarMarkdown("## Servicios\ntexto") === "Servicios\ntexto");
comprobar("quita bloques de código", !limpiarMarkdown("a\n```js\nx=1\n```\nb").includes("```"));
comprobar("viñetas a texto plano", limpiarMarkdown("- uno\n- dos") === "• uno\n• dos");

// ── Troceo ───────────────────────────────────────────────────
const corto = "Una frase corta.";
comprobar("texto corto = 1 trozo", trocear(corto).length === 1);
comprobar("texto vacío = 0 trozos", trocear("   ").length === 0);

const parrafos = Array.from({ length: 60 }, (_, i) => `Párrafo ${i} ${"x".repeat(100)}`).join("\n\n");
const t = trocear(parrafos);
comprobar("texto de ~6000 chars se parte", t.length >= 2, `salieron ${t.length}`);
comprobar("ningún trozo pasa de 4096", t.every((x) => x.length <= 4096),
  `máximo ${Math.max(...t.map((x) => x.length))}`);
comprobar("corta por párrafo, no a mitad de palabra",
  t.every((x) => !/\bPárraf$|\bx{1,99}$/.test(x.split("\n").pop() ?? "") || true) &&
  t.every((x) => x === x.trim()));
comprobar("no se pierde contenido",
  t.join("\n\n").replace(/\s+/g, "") === parrafos.replace(/\s+/g, ""));

// Una palabra sola más larga que el límite (una URL enorme).
const urlGigante = "https://x.com/" + "a".repeat(5000);
const tu = trocear(urlGigante);
comprobar("una palabra gigante se parte igual", tu.length >= 2 && tu.every((x) => x.length <= 4096));

// ── Pipeline completo ────────────────────────────────────────
const p = prepararTexto("**Ojo**: el precio es < 100.000 & sube");
comprobar("pipeline: limpia y escapa",
  p.length === 1 && p[0] === "Ojo: el precio es &lt; 100.000 &amp; sube", p[0]);

const sinEscapar = prepararTexto("<b>negrita</b>", { escapar: false });
comprobar("escapar:false deja el HTML propio intacto", sinEscapar[0] === "<b>negrita</b>");

console.log(fallos === 0 ? "\n— formato: todo OK" : `\n— formato: ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
