import { DateTime } from "luxon";
import { closeDb, sql } from "../src/db/client.js";
import { computeSlots } from "../src/gcal/slots.js";
import { CalendarioNoCompartido } from "../src/gcal/freebusy.js";

/**
 * Imprime los slots reales de un servicio, para verificar a ojo contra el
 * calendario de Google.
 *
 *   npx tsx scripts/slots-demo.ts limpieza-dental
 *   npx tsx scripts/slots-demo.ts limpieza-dental 2026-10-29
 */

async function main() {
  const slug = process.argv[2];
  const desde = process.argv[3];
  if (!slug) {
    console.error("uso: npx tsx scripts/slots-demo.ts <slug-servicio> [YYYY-MM-DD]");
    process.exit(2);
  }

  const [ws] = await sql<{ id: string; timezone: string }[]>`
    select id, timezone from workspaces limit 1`;
  if (!ws) throw new Error("no hay workspace: corre npm run seed");

  const [servicio] = await sql<{ duration_min: number; buffer_min: number; name: string }[]>`
    select duration_min, buffer_min, name from services
     where workspace_id = ${ws.id} and slug = ${slug}`;
  if (!servicio) throw new Error(`servicio desconocido: ${slug}`);

  const from = desde ?? DateTime.now().setZone(ws.timezone).toISODate()!;

  console.log(`${servicio.name} — ${servicio.duration_min}+${servicio.buffer_min} min, desde ${from}\n`);

  const slots = await computeSlots({
    workspaceId: ws.id, zone: ws.timezone, servicio, from,
  });

  if (slots.length === 0) {
    console.log("(sin cupo en el rango)");
  } else {
    for (const s of slots) console.log(`${s.label}\t${s.iso}`);
    console.log(`\n(${slots.length} slot${slots.length === 1 ? "" : "s"})`);
  }
}

main()
  .catch((e) => {
    if (e instanceof CalendarioNoCompartido) {
      console.error(`\n✖ ${e.message}\n`);
    } else {
      console.error(`\n✖ ${e instanceof Error ? e.message : e}\n`);
    }
    process.exitCode = 1;
  })
  .finally(closeDb);
