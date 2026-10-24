import { z } from "zod";
import { sql } from "../db/client.js";
import { gcalEliminarEvento } from "../gcal/events.js";
import { logEvent } from "../obs/events.js";
import { cancelarRecordatoriosPendientes } from "../reminders/schedule.js";
import { buscarCitaDelPaciente } from "./buscar-cita.js";
import type { Tool, ToolContext } from "./types.js";

const Args = z.object({
  cita_id: z.string().uuid().optional()
    .describe("id de la cita a cancelar. Si el paciente solo tiene una, se puede omitir"),
  motivo: z.string().max(200).optional(),
});

export const cancelarCita: Tool<z.infer<typeof Args>> = {
  name: "cancelar_cita",
  description:
    "Cancela una cita existente. La acción NO se deshace: confirma con el paciente " +
    "antes de llamarla. Si no sabes cuál cita es, usa consultar_mis_citas primero.",
  schema: Args,

  async run(a, ctx: ToolContext) {
    const encontrada = await buscarCitaDelPaciente(ctx, a.cita_id);
    if (!encontrada.ok) return encontrada.result;
    const cita = encontrada.cita;

    // DELETE en Google antes que en la base: si falla, la cita sigue
    // reservada en nuestro lado y no hay nada que limpiar a medias.
    if (cita.gcalEventId) await gcalEliminarEvento(cita.gcalEventId);

    await sql`
      update appointments set status = 'cancelled', cancel_reason = ${a.motivo ?? null}
       where id = ${cita.id}`;

    await cancelarRecordatoriosPendientes(cita.id, "cita_cancelada");

    await logEvent({
      workspaceId: ctx.workspace.id, conversationId: ctx.conversation.conversationId,
      type: "appointment",
      payload: { apptId: cita.id, action: "cancelled", motivo: a.motivo ?? null },
    });

    return {
      ok: true,
      data: { cita_id: cita.id, servicio: cita.serviceName, estado: "cancelled" },
    };
  },
};
