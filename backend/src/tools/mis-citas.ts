import { DateTime } from "luxon";
import { z } from "zod";
import { sql } from "../db/client.js";
import type { Tool, ToolContext } from "./types.js";

const Args = z.object({});

/**
 * Próximas citas del paciente. Existe para que el modelo NUNCA tenga que
 * inventar lo que el paciente ya agendó — "¿qué citas tengo?" se responde
 * con datos reales, no con lo que haya quedado en el historial reciente.
 */
export const consultarMisCitas: Tool<z.infer<typeof Args>> = {
  name: "consultar_mis_citas",
  description:
    "Devuelve las próximas citas agendadas del paciente. Úsala cuando pregunte " +
    "qué citas tiene, cuándo es su próxima cita, o antes de reprogramar/cancelar " +
    "para confirmar cuál. Nunca asumas que sabes sus citas sin consultarla.",
  schema: Args,

  async run(_a, ctx: ToolContext) {
    const filas = await sql<{
      id: string; starts_at: Date; status: string; service_name: string | null;
    }[]>`
      select a.id, a.starts_at, a.status, s.name as service_name
        from appointments a
        left join services s on s.id = a.service_id
       where a.contact_id = (select contact_id from conversations where id = ${ctx.conversation.conversationId})
         and a.status in ('booked', 'confirmed', 'rescheduled')
         and a.starts_at >= now()
       order by a.starts_at asc
       limit 5`;

    if (filas.length === 0) {
      return { ok: true, data: { citas: [], mensaje: "sin_citas_proximas" } };
    }

    const citas = filas.map((f) => ({
      id: f.id,
      servicio: f.service_name ?? "(servicio no especificado)",
      cuando: DateTime.fromJSDate(f.starts_at).setZone(ctx.workspace.timezone)
        .setLocale("es-CO").toFormat("cccc d 'de' LLLL 'a las' h:mm a"),
      estado: f.status,
    }));

    return { ok: true, data: { citas } };
  },
};
