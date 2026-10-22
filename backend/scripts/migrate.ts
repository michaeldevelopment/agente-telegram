import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql, closeDb } from "../src/db/client.js";

/**
 * Aplica los .sql de migrations/ en orden alfabético.
 *
 * Doble protección contra re-aplicar:
 *   1. Los propios .sql son idempotentes (if not exists / do blocks).
 *   2. schema_migrations registra lo aplicado y se salta lo ya hecho.
 *
 * Si un .sql cambia después de aplicado, avisa en vez de callarse: un
 * esquema que no coincide con el archivo es una bomba de relojería.
 */

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "migrations");

async function main() {
  await sql`
    create table if not exists schema_migrations (
      name       text primary key,
      hash       text not null,
      applied_at timestamptz not null default now()
    )`;

  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) {
    console.log("no hay migraciones en migrations/");
    return;
  }

  const applied = new Map(
    (await sql<{ name: string; hash: string }[]>`select name, hash from schema_migrations`)
      .map((r) => [r.name, r.hash] as const),
  );

  for (const file of files) {
    const body = await readFile(join(dir, file), "utf8");
    const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
    const prev = applied.get(file);

    if (prev === hash) {
      console.log(`  ${file} ... ya aplicada`);
      continue;
    }
    if (prev && prev !== hash) {
      console.warn(`  ${file} ... ⚠ cambió desde que se aplicó (${prev} → ${hash}), re-aplicando`);
    }

    process.stdout.write(`aplicando ${file} ... `);
    await sql.unsafe(body);
    await sql`
      insert into schema_migrations (name, hash) values (${file}, ${hash})
      on conflict (name) do update set hash = excluded.hash, applied_at = now()`;
    console.log("ok");
  }

  const rows = await sql<{ count: string }[]>`
    select count(*) from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'`;
  console.log(`\n${rows[0]?.count ?? "?"} tablas en public (16 del esquema + schema_migrations)`);
}

main()
  .catch((err) => {
    console.error("\n✖ la migración falló:\n", err);
    process.exitCode = 1;
  })
  .finally(closeDb);
