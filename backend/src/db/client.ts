import postgres from "postgres";
import { env } from "../config/env.js";

/**
 * Cliente de Postgres contra Supabase.
 *
 * ⚠️ Dos cosas no negociables (spec 01 · Trampas):
 *   1. Conexión por el POOLER, puerto 6543 (PgBouncer en modo transaction).
 *   2. `prepare: false`. PgBouncer en transaction mode no soporta prepared
 *      statements: sin esto falla de forma intermitente y muy difícil de
 *      reproducir, porque depende de qué conexión del pool te toque.
 */
export const sql = postgres(env.DATABASE_URL, {
  prepare: false,
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: env.LOG_LEVEL === "debug" ? console.log : () => {},
});

/** `true` si la base responde. Lo usa /health. */
export async function dbOk(): Promise<boolean> {
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  }
}

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
