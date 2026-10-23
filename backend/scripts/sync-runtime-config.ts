import { env, requireEnv } from "../src/config/env.js";
import { closeDb, sql } from "../src/db/client.js";

/**
 * Sincroniza `runtime_config` con las env vars del worker.
 *
 * ⚠️ `pg_cron` corre DENTRO de Postgres y no ve las variables de Railway.
 * El `buffer-sweeper` de la migración 002 lee `worker_url` e
 * `internal_secret` de esta tabla, no del entorno. Si se desincronizan, el
 * barrido falla EN SILENCIO: no hay ningún error en los logs de la
 * aplicación porque el fallo ocurre dentro de Postgres, al llamar a una URL
 * vieja o con un secreto que ya no coincide.
 *
 * Correr esto cada vez que cambie INTERNAL_SECRET o APP_BASE_URL.
 *
 *   npm run runtime-config
 */

async function main() {
  const workerUrl = requireEnv("APP_BASE_URL", "runtime_config.worker_url");
  const internalSecret = requireEnv("INTERNAL_SECRET", "runtime_config.internal_secret");

  if (!/^https?:\/\//.test(workerUrl)) {
    throw new Error(`APP_BASE_URL no parece una URL: ${workerUrl}`);
  }

  await sql`
    insert into runtime_config (key, value) values
      ('worker_url', ${workerUrl.replace(/\/+$/, "")}),
      ('internal_secret', ${internalSecret})
    on conflict (key) do update set value = excluded.value`;

  const filas = await sql<{ key: string; value: string }[]>`
    select key, value from runtime_config order by key`;

  console.log(`✓ runtime_config sincronizada (workspace: ${env.WORKSPACE_SLUG})`);
  for (const f of filas) {
    const mostrado = f.key === "internal_secret" ? `${f.value.slice(0, 6)}…` : f.value;
    console.log(`  ${f.key} = ${mostrado}`);
  }
}

main()
  .catch((e) => {
    console.error(`\n✖ ${e instanceof Error ? e.message : e}\n`);
    process.exitCode = 1;
  })
  .finally(closeDb);
