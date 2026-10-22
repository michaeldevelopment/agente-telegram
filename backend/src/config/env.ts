import { z } from "zod";

/**
 * Validación de entorno. Se evalúa UNA vez, al importar el módulo.
 *
 * Si falta algo obligatorio, el proceso muere al arrancar con un mensaje que
 * dice qué falta — nunca a mitad de una petición, con el paciente esperando.
 *
 * Qué es obligatorio depende de la spec que esté construida. Hoy (spec 01)
 * solo hace falta la base de datos; lo demás se declara pero es opcional, y
 * cada spec futura lo vuelve obligatorio con `requireEnv()`.
 */

const schema = z.object({
  // ── Obligatorias hoy ──────────────────────────────────────
  DATABASE_URL: z
    .string()
    .min(1, "falta la cadena de conexión a Postgres")
    .refine((v) => !v.includes(":5432"), {
      message:
        "usa el pooler en el puerto 6543, no el 5432 directo (ver spec 01 · Trampas)",
    }),

  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  TZ: z.string().default("America/Bogota"),
  WORKSPACE_SLUG: z.string().default("clinica-gonzalez"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // ── Declaradas, aún opcionales ────────────────────────────
  // spec 03
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_WEBHOOK_PATH: z.string().optional(),
  // spec 13
  TELEGRAM_HANDOFF_CHAT_ID: z.coerce.number().int().optional(),
  // spec 05
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_MODEL: z.string().default("deepseek-flash"),
  // spec 02
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  // spec 08
  GOOGLE_SA_EMAIL: z.string().optional(),
  GOOGLE_SA_PRIVATE_KEY: z.string().optional(),
  GOOGLE_CALENDAR_ID: z.string().optional(),
  // spec 06
  INTERNAL_SECRET: z.string().optional(),
  APP_BASE_URL: z.string().url().optional(),
  // desde el 2º cliente
  ENCRYPTION_KEY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

/**
 * Una variable presente pero vacía (`APP_BASE_URL=` en el .env) es lo mismo
 * que no tenerla. Sin esto, copiar .env.example tal cual rompe el arranque:
 * "" no pasa un .url() y `coerce.number()` lo convierte en 0 en silencio.
 */
function sinVacias(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (typeof v === "string" && v.trim() !== "") out[k] = v;
  }
  return out;
}

function load(): Env {
  const parsed = schema.safeParse(sinVacias(process.env));

  if (!parsed.success) {
    const detalle = parsed.error.issues
      .map((i) => `  · ${i.path.join(".") || "(raíz)"}: ${i.message}`)
      .join("\n");

    console.error(
      `\n✖ Configuración inválida. Revisa tu .env (plantilla en .env.example):\n\n${detalle}\n`,
    );
    process.exit(1);
  }

  return parsed.data;
}

export const env = load();

/**
 * Para las specs siguientes: exige una variable que hoy es opcional.
 * Falla ruidosamente, nombrando la variable y quién la necesita.
 */
export function requireEnv<K extends keyof Env>(key: K, quienLaNecesita: string): NonNullable<Env[K]> {
  const value = env[key];
  if (value === undefined || value === null || value === "") {
    console.error(`\n✖ Falta la variable ${String(key)}, requerida por ${quienLaNecesita}.\n`);
    process.exit(1);
  }
  return value as NonNullable<Env[K]>;
}
