// Carga el .env ANTES de leer process.env. Node no lo hace solo.
// En Railway no hay .env y no pasa nada: dotenv no pisa las variables que ya
// existen, así que las del panel siempre ganan.
import "dotenv/config";
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

export class EnvFaltante extends Error {
  constructor(readonly key: string, quienLaNecesita: string) {
    super(`falta la variable ${key}, requerida por ${quienLaNecesita}`);
    this.name = "EnvFaltante";
  }
}

/**
 * Exige una variable que hoy es opcional. LANZA, no mata el proceso:
 * esto se llama en caliente, atendiendo una petición, y un `process.exit`
 * ahí tumbaría el servidor por un chat que no se pudo responder.
 *
 * Para fallar al arrancar está `exigirAlArrancar()`.
 */
export function requireEnv<K extends keyof Env>(key: K, quienLaNecesita: string): NonNullable<Env[K]> {
  const value = env[key];
  if (value === undefined || value === null || value === "") {
    throw new EnvFaltante(String(key), quienLaNecesita);
  }
  return value as NonNullable<Env[K]>;
}

/** `true` si la variable está puesta. Para decidir qué capacidades hay. */
export function tieneEnv<K extends keyof Env>(key: K): boolean {
  const v = env[key];
  return v !== undefined && v !== null && v !== "";
}

/**
 * Comprueba al arrancar qué capacidades están disponibles y lo dice una vez.
 * Nada aquí es fatal: el servicio arranca igual y /health responde, para que
 * se pueda trabajar en una spec sin tener las credenciales de las siguientes.
 */
export function reportarCapacidades(log: (msg: string) => void): void {
  const capacidades: [boolean, string][] = [
    [tieneEnv("TELEGRAM_BOT_TOKEN"), "Telegram: enviar mensajes"],
    [tieneEnv("TELEGRAM_WEBHOOK_SECRET") && tieneEnv("TELEGRAM_WEBHOOK_PATH"), "Telegram: recibir webhooks"],
    [tieneEnv("DEEPSEEK_API_KEY"), "DeepSeek: responder (spec 05)"],
    [tieneEnv("GOOGLE_SA_EMAIL") && tieneEnv("GOOGLE_CALENDAR_ID"), "Google Calendar (spec 08)"],
    [tieneEnv("INTERNAL_SECRET"), "endpoints internos para pg_cron (spec 06)"],
  ];
  const faltan = capacidades.filter(([ok]) => !ok).map(([, n]) => n);
  if (faltan.length) log(`capacidades no disponibles: ${faltan.join(" · ")}`);
}
