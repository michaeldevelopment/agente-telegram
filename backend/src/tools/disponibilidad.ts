import { z } from "zod";
import { sql } from "../db/client.js";
import { computeSlots } from "../gcal/slots.js";
import type { Tool, ToolContext } from "./types.js";

const Args = z.object({
  servicio: z.string().describe("slug del servicio, ej. 'limpieza-dental'"),
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("primer día a considerar, YYYY-MM-DD"),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe("último día a considerar, YYYY-MM-DD. Si no se da, se usa desde+7 días"),
  preferencia: z.enum(["mañana", "tarde", "cualquiera"]).default("cualquiera"),
});

/**
 * Devuelve máximo 4 slots reales del calendario. NUNCA inventa disponibilidad
 * — por eso el `description` se lo dice al modelo explícitamente, y por eso
 * `agendar_cita` (spec 10) revalida de todos modos antes de escribir.
 */
export const consultarDisponibilidad: Tool<z.infer<typeof Args>> = {
  name: "consultar_disponibilidad",
  description:
    "Devuelve horarios libres para un servicio. Úsala SIEMPRE antes de proponer un " +
    "horario; nunca inventes disponibilidad. Devuelve como máximo 4 opciones.",
  schema: Args,

  async run(a, ctx: ToolContext) {
    const [servicio] = await sql<
      { duration_min: number; buffer_min: number; name: string }[]
    >`select duration_min, buffer_min, name from services
       where workspace_id = ${ctx.workspace.id} and slug = ${a.servicio} and is_active`;

    if (!servicio) return { ok: false, error: `servicio_desconocido: ${a.servicio}` };

    const slots = await computeSlots({
      workspaceId: ctx.workspace.id,
      zone: ctx.workspace.timezone,
      servicio,
      from: a.desde,
      to: a.hasta,
    });

    // El filtro de preferencia (mañana/tarde) es cortesía sobre el resultado
    // ya calculado; no cambia la fórmula determinista de computeSlots.
    const filtrados = a.preferencia === "cualquiera"
      ? slots
      : slots.filter((s) => {
          const hora = Number(s.iso.slice(11, 13));
          return a.preferencia === "mañana" ? hora < 12 : hora >= 12;
        });

    if (filtrados.length === 0) {
      return { ok: true, data: { slots: [], sugerencia: "sin_cupo_en_rango" } };
    }
    return { ok: true, data: { slots: filtrados.slice(0, 4), servicio: servicio.name } };
  },
};
