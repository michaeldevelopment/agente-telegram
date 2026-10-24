import { DateTime } from "luxon";
import { z } from "zod";
import { sql } from "../db/client.js";
import { gcalPatchEvento } from "../gcal/events.js";
import { computeSlots } from "../gcal/slots.js";
import { logEvent } from "../obs/events.js";
import { scheduleReminders } from "../reminders/schedule.js";
import { buscarCitaDelPaciente } from "./buscar-cita.js";
import type { Tool, ToolContext } from "./types.js";

/**
 * Mueve una cita al nuevo horario. Reusa la revalidación, el índice único y
 * el id determinista de `agendar_cita` (spec 10) — por eso es mucho más
 * corta: lo único nuevo es el `PATCH` en vez del `insert`.
 */

const Args = z.object({
  cita_id: z.string().uuid().optional()
    .describe("id de la cita a mover. Si el paciente solo tiene una, se puede omitir"),
  nuevo_inicio: z.string().describe("nuevo horario exacto en ISO 8601 con offset"),
});

const SQLSTATE_VIOLACION_UNICIDAD = "23505";

async function alternativas(
  ctx: ToolContext,
  servicio: { duration_min: number; buffer_min: number },
  desde: string,
) {
  return computeSlots({
    workspaceId: ctx.workspace.id, zone: ctx.workspace.timezone,
    servicio, from: desde, limit: 3,
  });
}

export const reprogramarCita: Tool<z.infer<typeof Args>> = {
  name: "reprogramar_cita",
  description:
    "Mueve una cita existente a un nuevo horario. Usa consultar_disponibilidad para " +
    "ofrecer horarios reales y espera la confirmación explícita del paciente antes de " +
    "llamarla. Si no sabes cuál cita es, usa consultar_mis_citas primero.",
  schema: Args,

  async run(a, ctx: ToolContext) {
    const encontrada = await buscarCitaDelPaciente(ctx, a.cita_id);
    if (!encontrada.ok) return encontrada.result;
    const cita = encontrada.cita;

    if (!cita.durationMin) {
      return { ok: false, error: "servicio_sin_duracion: contacta al equipo de la clínica" };
    }

    const start = DateTime.fromISO(a.nuevo_inicio, { setZone: true });
    if (!start.isValid) return { ok: false, error: "fecha_invalida" };
    if (start < DateTime.now().plus({ hours: 2 })) {
      return { ok: false, error: "muy_pronto: minimo 2 horas de anticipacion" };
    }
    const end = start.plus({ minutes: cita.durationMin });

    // El `uq_appt_slot` (spec 10) es el candado real: esta misma fila, al
    // cambiar `starts_at`, pasa por el índice único igual que un insert.
    // El slot viejo queda libre solo, porque el índice es sobre el valor
    // ACTUAL de `starts_at` — al moverlo, deja de ocuparlo.
    let fila: { id: string } | undefined;
    try {
      [fila] = await sql<{ id: string }[]>`
        update appointments
           set starts_at = ${start.toJSDate()}, ends_at = ${end.toJSDate()}, status = 'rescheduled'
         where id = ${cita.id}
        returning id`;
    } catch (e) {
      if ((e as { code?: string })?.code === SQLSTATE_VIOLACION_UNICIDAD) {
        const alt = await alternativas(
          ctx, { duration_min: cita.durationMin, buffer_min: cita.bufferMin ?? 10 }, start.toISODate()!,
        );
        return { ok: false, error: "slot_ocupado", data: { alternativas: alt } };
      }
      throw e;
    }
    if (!fila) throw new Error("el update de appointments no devolvió fila");

    // Mismo event id: PATCH, nunca borrar y recrear (ver gcal/events.ts).
    if (cita.gcalEventId) {
      await gcalPatchEvento({
        eventId: cita.gcalEventId, start, end, timeZone: ctx.workspace.timezone,
      });
    }

    // Recalcular, NO solo mover la cita: `scheduleReminders` hace upsert por
    // (appointment_id, kind) — reescribe `send_at` sobre la nueva hora en
    // vez de duplicar o dejar los recordatorios viejos apuntando al horario
    // que ya no es.
    await scheduleReminders(ctx.workspace, { id: cita.id, startsAt: start.toJSDate() });

    await logEvent({
      workspaceId: ctx.workspace.id, conversationId: ctx.conversation.conversationId,
      type: "appointment",
      payload: { apptId: cita.id, action: "rescheduled", service: cita.serviceName },
    });

    return {
      ok: true,
      data: {
        cita_id: cita.id,
        cuando: start.setLocale("es-CO").toFormat("cccc d 'de' LLLL 'a las' h:mm a"),
        servicio: cita.serviceName,
      },
    };
  },
};
