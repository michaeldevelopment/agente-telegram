import { DateTime } from "luxon";
import { sql } from "../db/client.js";
import type { MensajeLlm } from "./deepseek.js";

/**
 * Armado del prompt. El ORDEN importa más que el contenido.
 *
 * DeepSeek cachea prefijos y el match se evalúa DESDE EL TOKEN 0. Un hit
 * cuesta 50× menos que un miss ($0.003/M contra $0.15/M), así que todo lo
 * que cambia entre peticiones va ABAJO:
 *
 *   [1] system  → prompt estático congelado        ← CACHEADO
 *   [2] system  → resumen rodante                  ← CACHEADO casi siempre
 *   [3] ...     → historial reciente, append-only  ← CACHEADO hasta el último turno
 *   [4] system  → BLOQUE VOLÁTIL (~80 tokens)      ← siempre miss, y da igual
 *   [5] user    → el turno del paciente            ← siempre miss, y da igual
 *
 * Lo volátil abajo es barato porque es pequeño. Arriba invalida todo lo que
 * viene después: es la trampa del blueprint original, que metía {{now}} en el
 * system prompt. Multiplicador medido: 10.6×.
 */

/** Ventana de historial. El resumen rodante llega en una spec futura. */
export const VENTANA_MENSAJES = 10;

export type ContextoTurno = {
  promptEstatico: string;
  resumen: string | null;
  historial: MensajeLlm[];
  bloqueVolatil: string;
  textoTurno: string;
};

// ── Prompt estático ──────────────────────────────────────────

/**
 * Cache del prompt en memoria.
 *
 * No es (solo) por latencia: es para garantizar que el texto sea IDÉNTICO
 * byte a byte entre turnos. Releerlo de la base cada vez abriría la puerta a
 * que una diferencia tonta —un espacio, un orden de columnas— rompa el
 * prefijo sin que nada falle visiblemente.
 */
const cachePrompt = new Map<string, { body: string; hasta: number }>();
const PROMPT_CACHE_MS = 300_000;

export function invalidarCachePrompt(workspaceId?: string): void {
  if (workspaceId) cachePrompt.delete(workspaceId);
  else cachePrompt.clear();
}

export async function getPromptEstatico(workspaceId: string): Promise<string> {
  const c = cachePrompt.get(workspaceId);
  if (c && c.hasta > Date.now()) return c.body;

  const [row] = await sql<{ body: string }[]>`
    select body from agent_prompts
     where workspace_id = ${workspaceId} and is_active limit 1`;
  if (!row) {
    throw new Error(`no hay prompt activo para el workspace. ¿Corriste npm run seed?`);
  }
  cachePrompt.set(workspaceId, { body: row.body, hasta: Date.now() + PROMPT_CACHE_MS });
  return row.body;
}

// ── Bloque volátil ───────────────────────────────────────────

/**
 * Todo lo que cambia entre peticiones, junto y AL FINAL.
 * ~80 tokens: pequeño a propósito, porque siempre se paga como miss.
 */
export function bloqueVolatil(opts: {
  timezone: string;
  nombrePaciente?: string | null;
  telefonoPaciente?: string | null;
  ahora?: DateTime;
}): string {
  const now = (opts.ahora ?? DateTime.now()).setZone(opts.timezone).setLocale("es-CO");
  return [
    `Ahora: ${now.toFormat("cccc d 'de' LLLL yyyy, HH:mm")} (${opts.timezone}).`,
    `Hoy es ${now.toFormat("yyyy-MM-dd")}. Mañana es ${now.plus({ days: 1 }).toFormat("yyyy-MM-dd")}.`,
    opts.nombrePaciente
      ? `Paciente: ${opts.nombrePaciente}.`
      : `Aún no sabes el nombre del paciente.`,
    opts.telefonoPaciente
      ? `Teléfono en archivo: ${opts.telefonoPaciente}.`
      : `No tienes su teléfono.`,
  ].join("\n");
}

// ── Historial ────────────────────────────────────────────────

/**
 * Últimos N mensajes en orden cronológico.
 *
 * ⚠️ Cuando la conversación pasa de la ventana, el frente se recorta y ese
 * turno paga un miss completo. Es sabido y asumido: la alternativa (resumen
 * rodante) llega después. Lo que NO se puede hacer es reordenar, porque
 * entonces el prefijo cambia en CADA turno.
 */
export async function getHistorial(
  conversationId: string,
  limite = VENTANA_MENSAJES,
): Promise<MensajeLlm[]> {
  const filas = await sql<{ direction: string; body: string | null }[]>`
    select direction, body from (
      select direction, body, created_at
        from messages
       where conversation_id = ${conversationId}
         and body is not null and body <> ''
       order by created_at desc, id desc
       limit ${limite}
    ) t order by created_at asc, id asc`;

  return filas.map((f) => ({
    role: f.direction === "in" ? ("user" as const) : ("assistant" as const),
    content: f.body ?? "",
  }));
}

// ── El armado ────────────────────────────────────────────────

export function buildMessages(ctx: ContextoTurno): MensajeLlm[] {
  return [
    // [1] Congelado, byte a byte igual en TODAS las peticiones del workspace.
    { role: "system", content: ctx.promptEstatico },

    // [2] Cambia cada ~10 mensajes, no cada turno.
    ...(ctx.resumen
      ? [{ role: "system" as const, content: `Resumen de la conversación previa:\n${ctx.resumen}` }]
      : []),

    // [3] Append-only y cronológico.
    ...ctx.historial,

    // [4] 👇 VOLÁTIL AL FINAL. Aquí abajo no rompe el prefijo de arriba.
    { role: "system", content: ctx.bloqueVolatil },

    // [5] El texto del paciente entra como `user`, NUNCA concatenado al
    //     system prompt: es la defensa estructural contra prompt injection.
    { role: "user", content: ctx.textoTurno },
  ];
}

/**
 * El prefijo cacheable: todo menos el bloque volátil y el turno.
 * Sirve para comprobar sin gastar una llamada que es idéntico entre turnos.
 */
export function prefijoCacheable(mensajes: MensajeLlm[]): string {
  return mensajes
    .slice(0, -2)
    .map((m) => `${m.role}:${"content" in m ? m.content : ""}`)
    .join("\n---\n");
}
