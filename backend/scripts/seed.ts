import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../src/config/env.js";
import { closeDb, sql } from "../src/db/client.js";
import { EDITAR, render, tokensAprox, type Servicio } from "../src/kb/render.js";

/**
 * Carga los datos del cliente y deja el system prompt listo.
 *
 *   npm run seed                  carga todo
 *   npm run seed -- --render-only imprime el rendered y sale (sin tocar la base)
 *
 * Idempotente: re-ejecutarlo no duplica nada.
 */

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "data");
const soloRender = process.argv.includes("--render-only");

// Horario confirmado por el cliente. weekday: 0 = DOMINGO.
// L–V corrido, sin almuerzo (lo dio así, se toma literal). Sábado 8–12.
const HORARIO: { weekday: number; opens: string; closes: string }[] = [
  { weekday: 1, opens: "08:00", closes: "18:00" },
  { weekday: 2, opens: "08:00", closes: "18:00" },
  { weekday: 3, opens: "08:00", closes: "18:00" },
  { weekday: 4, opens: "08:00", closes: "18:00" },
  { weekday: 5, opens: "08:00", closes: "18:00" },
  { weekday: 6, opens: "08:00", closes: "12:00" },
];

/** Parser de CSV con comillas. Los `price_note` llevan comas. */
function parseCsv(texto: string): Record<string, string>[] {
  const lineas = texto.replace(/\r\n/g, "\n").trim().split("\n");
  const cabecera = partirLinea(lineas[0] ?? "");
  return lineas.slice(1).filter((l) => l.trim() !== "").map((l) => {
    const celdas = partirLinea(l);
    return Object.fromEntries(cabecera.map((k, i) => [k, celdas[i] ?? ""]));
  });
}

function partirLinea(linea: string): string[] {
  const out: string[] = [];
  let actual = "";
  let enComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      if (enComillas && linea[i + 1] === '"') { actual += '"'; i++; }
      else enComillas = !enComillas;
    } else if (c === "," && !enComillas) { out.push(actual.trim()); actual = ""; }
    else actual += c;
  }
  out.push(actual.trim());
  return out;
}

function aServicio(r: Record<string, string>): Servicio {
  const num = (v: string | undefined) => (v === undefined || v === "" ? null : Number(v));
  return {
    slug: r.slug ?? "",
    name: r.name ?? "",
    duration_min: num(r.duration_min) ?? 0,
    buffer_min: num(r.buffer_min) ?? 0,
    price_from: num(r.price_from),
    price_note: r.price_note || null,
    requires_eval: r.requires_eval === "true",
    sort_order: num(r.sort_order) ?? 0,
    is_active: r.is_active !== "false",
    ficticio: r.ficticio ?? "no",
  };
}

async function main() {
  // ── 1 · Leer las fuentes ──────────────────────────────────
  const structured = JSON.parse(await readFile(join(dataDir, "business-info.json"), "utf8"));
  const servicios = parseCsv(await readFile(join(dataDir, "services.csv"), "utf8")).map(aServicio);
  const promptPlantilla = await readFile(join(dataDir, "system-prompt.md"), "utf8");

  // Validaciones de los datos antes de tocar nada
  const malos = servicios.filter((s) => !s.slug || !s.name || s.duration_min <= 0);
  if (malos.length) {
    throw new Error(`servicios inválidos: ${malos.map((s) => s.slug || "(sin slug)").join(", ")}`);
  }
  const dup = servicios.map((s) => s.slug).filter((s, i, a) => a.indexOf(s) !== i);
  if (dup.length) throw new Error(`slugs duplicados en services.csv: ${dup.join(", ")}`);

  // ── 2 · Renderizar ────────────────────────────────────────
  const r = render(structured, servicios);

  // Guarda: un placeholder en el prompt lo lee un paciente.
  if (r.text.includes(EDITAR)) {
    throw new Error(
      `el texto renderizado contiene ${EDITAR}. No se escribe nada.\n` +
        `El renderer omite los placeholders conocidos, así que esto es uno nuevo:\n` +
        r.text.split("\n").filter((l) => l.includes(EDITAR)).map((l) => `    ${l}`).join("\n"),
    );
  }

  // Guarda: el nombre del prompt y el del JSON tienen que coincidir.
  const nombre: string = structured?.negocio?.nombre ?? "";
  if (nombre && !promptPlantilla.includes(nombre)) {
    throw new Error(
      `el nombre del negocio no coincide.\n` +
        `  data/business-info.json → negocio.nombre = "${nombre}"\n` +
        `  data/system-prompt.md no lo menciona.\n` +
        `Cámbialo en los dos sitios (ver memoria/nombre-del-negocio-sin-decidir.md).`,
    );
  }

  const prompt = promptPlantilla
    .replace(/<!--[\s\S]*?-->\s*/, "")           // fuera el comentario de cabecera
    .replace("{{BUSINESS_INFO_RENDERED}}", r.text.trimEnd())
    .trim();

  if (prompt.includes("{{")) {
    throw new Error(`quedó un marcador sin resolver en el prompt: ${prompt.match(/\{\{[^}]*\}\}/)?.[0]}`);
  }

  // ── 3 · --render-only: imprimir y salir ───────────────────
  if (soloRender) {
    process.stdout.write(r.text);
    return;
  }

  // ── 4 · Escribir, todo en una transacción ─────────────────
  await sql.begin(async (tx) => {
    const [ws] = await tx<{ id: string }[]>`
      insert into workspaces (slug, name, agent_type, timezone, locale, currency)
      values (${env.WORKSPACE_SLUG}, ${nombre || env.WORKSPACE_SLUG},
              'appointment_setter', 'America/Bogota', 'es-CO', 'COP')
      on conflict (slug) do update set name = excluded.name, updated_at = now()
      returning id`;
    if (!ws) throw new Error("no se pudo crear el workspace");
    const wsId = ws.id;

    await tx`
      insert into business_info (workspace_id, structured, rendered, rendered_hash)
      values (${wsId}, ${sql.json(structured)}, ${r.text}, ${r.hash})
      on conflict (workspace_id) do update set
        structured = excluded.structured,
        rendered = excluded.rendered,
        rendered_hash = excluded.rendered_hash,
        updated_at = now()`;

    for (const s of servicios) {
      await tx`
        insert into services (workspace_id, slug, name, duration_min, buffer_min,
                              price_from, price_note, requires_eval, is_active, sort_order)
        values (${wsId}, ${s.slug}, ${s.name}, ${s.duration_min}, ${s.buffer_min},
                ${s.price_from}, ${s.price_note}, ${s.requires_eval}, ${s.is_active}, ${s.sort_order})
        on conflict (workspace_id, slug) do update set
          name = excluded.name, duration_min = excluded.duration_min,
          buffer_min = excluded.buffer_min, price_from = excluded.price_from,
          price_note = excluded.price_note, requires_eval = excluded.requires_eval,
          is_active = excluded.is_active, sort_order = excluded.sort_order`;
    }

    for (const h of HORARIO) {
      await tx`
        insert into business_hours (workspace_id, weekday, opens_at, closes_at)
        values (${wsId}, ${h.weekday}, ${h.opens}, ${h.closes})
        on conflict (workspace_id, weekday) do update set
          opens_at = excluded.opens_at, closes_at = excluded.closes_at,
          break_from = null, break_to = null`;
    }
    // Domingo cerrado = ausencia de fila, no una fila con 00:00-00:00.
    await tx`delete from business_hours where workspace_id = ${wsId} and weekday = 0`;

    // El prompt se versiona. Solo uno activo (uq_prompt_active lo garantiza).
    const [prev] = await tx<{ body: string; version: number }[]>`
      select body, version from agent_prompts
       where workspace_id = ${wsId} and is_active limit 1`;

    if (prev?.body === prompt) {
      console.log(`  prompt sin cambios (v${prev.version})`);
    } else {
      const [max] = await tx<{ v: number | null }[]>`
        select max(version) as v from agent_prompts where workspace_id = ${wsId}`;
      const version = (max?.v ?? 0) + 1;
      await tx`update agent_prompts set is_active = false
                where workspace_id = ${wsId} and is_active`;
      await tx`
        insert into agent_prompts (workspace_id, version, body, is_active, notes)
        values (${wsId}, ${version}, ${prompt}, true, ${"seed · rendered_hash " + r.hash.slice(0, 12)})`;
      console.log(`  prompt v${version} activo`);
    }
  });

  // ── 5 · Reporte ───────────────────────────────────────────
  const toks = tokensAprox(r.bytes);
  console.log(`\n✓ workspace ${env.WORKSPACE_SLUG}`);
  console.log(`✓ ${servicios.length} servicios · ${HORARIO.length} días de horario`);
  console.log(`✓ rendered: ${r.bytes} bytes (~${toks} tokens), hash ${r.hash.slice(0, 12)}…`);

  if (toks > 3000) {
    console.warn(`⚠ el contenido estable pasa de 3.000 tokens: toca replantear RAG`);
  }
  if (r.omitidos.length) {
    console.warn(`⚠ ${r.omitidos.length} campos con ${EDITAR} omitidos: ${r.omitidos.join(", ")}`);
  }
  if (r.ficticios.length) {
    console.warn(
      `⚠ ${r.ficticios.length} valores ficticios incluidos — PLAUSIBLES PERO FALSOS.\n` +
        `  Sustituir antes de producción: ../knowledge/wiki/Clinica-Gonzalez-Pendientes.md`,
    );
  }
}

main()
  .catch((err) => {
    console.error(`\n✖ el seed falló:\n  ${err instanceof Error ? err.message : err}\n`);
    process.exitCode = 1;
  })
  .finally(closeDb);
