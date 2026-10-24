import { DateTime } from "luxon";
import { z } from "zod";
import { sql } from "../db/client.js";
import { gcalInsertarEvento } from "../gcal/events.js";
import { computeSlots } from "../gcal/slots.js";
import { logEvent } from "../obs/events.js";
import { scheduleReminders } from "../reminders/schedule.js";
import type { Tool, ToolContext } from "./types.js";

/**
 * 🔑 El camino crítico. Una conversación termina con una cita REAL en el
 * Google Calendar del cliente. Tres cosas lo hacen robusto, y ninguna
 * depende del LLM: revalidación del slot, el índice único como candado
 * real, y el id determinista del evento.
 */

const Args = z.object({
  servicio: z.string(),
  inicio: z.string().describe("inicio exacto en ISO 8601 con offset, ej. 2026-10-29T10:30:00-05:00"),
  nombre_paciente: z.string().min(3),
  telefono: z.string().optional(),
  motivo: z.string().max(200).optional(),
});

const SQLSTATE_VIOLACION_UNICIDAD = "23505";

async function slotLibre(workspaceId: string, start: DateTime): Promise<boolean> {
  const [fila] = await sql<{ ocupado: boolean }[]>`
    select exists(
      select 1 from appointments
       where workspace_id = ${workspaceId}
         and starts_at = ${start.toJSDate()}
         and status in ('booked','confirmed','rescheduled')
    ) as ocupado`;
  return !fila?.ocupado;
}

async function alternativas(ctx: ToolContext, servicio: { duration_min: number; buffer_min: number }, desde: string) {
  return computeSlots({
    workspaceId: ctx.workspace.id, zone: ctx.workspace.timezone,
    servicio, from: desde, limit: 3,
  });
}

export const agendarCita: Tool<z.infer<typeof Args>> = {
  name: "agendar_cita",
  description:
    "Reserva la cita. Solo con un horario que consultar_disponibilidad haya devuelto y " +
    "que el paciente haya confirmado explícitamente. Requiere el nombre completo del paciente.",
  schema: Args,

  async run(a, ctx: ToolContext) {
    // 1 · Validar
    const [servicio] = await sql<
      { id: string; duration_min: number; buffer_min: number; name: string }[]
    >`select id, duration_min, buffer_min, name from services
       where workspace_id = ${ctx.workspace.id} and slug = ${a.servicio} and is_active`;
    if (!servicio) return { ok: false, error: `servicio_desconocido: ${a.servicio}` };

    const start = DateTime.fromISO(a.inicio, { setZone: true });
    if (!start.isValid) return { ok: false, error: "fecha_invalida" };
    if (start < DateTime.now().plus({ hours: 2 })) {
      return { ok: false, error: "muy_pronto: minimo 2 horas de anticipacion" };
    }
    const end = start.plus({ minutes: servicio.duration_min });

    // 2 · Revalidar — cortesía. Entre que el modelo propone y el paciente
    // confirma pasan segundos o minutos; el slot pudo ocuparse.
    if (!(await slotLibre(ctx.workspace.id, start))) {
      const alt = await alternativas(ctx, servicio, start.toISODate()!);
      return { ok: false, error: "slot_ocupado", data: { alternativas: alt } };
    }

    // Datos del contacto, para la descripción del evento.
    const [contacto] = await sql<{ phone: string | null }[]>`
      select phone from contacts where id = ${ctx.conversation.contactId}`;
    const telefono = a.telefono ?? contacto?.phone ?? null;

    // 3 · Insertar PRIMERO en nuestra base. uq_appt_slot es el candado REAL
    // contra doble reserva, incluso con dos conversaciones simultáneas — la
    // revalidación de arriba es cortesía, esto es lo que no se puede saltar.
    let appt: { id: string } | undefined;
    try {
      [appt] = await sql<{ id: string }[]>`
        insert into appointments
          (workspace_id, contact_id, conversation_id, service_id,
           starts_at, ends_at, patient_name, patient_phone, reason)
        values
          (${ctx.workspace.id}, ${ctx.conversation.contactId}, ${ctx.conversation.conversationId},
           ${servicio.id}, ${start.toJSDate()}, ${end.toJSDate()},
           ${a.nombre_paciente}, ${telefono}, ${a.motivo ?? null})
        returning id`;
    } catch (e) {
      // Carrera ganada por otra conversación entre la revalidación y el
      // insert: el índice único es quien de verdad lo impide.
      if ((e as { code?: string })?.code === SQLSTATE_VIOLACION_UNICIDAD) {
        const alt = await alternativas(ctx, servicio, start.toISODate()!);
        return { ok: false, error: "slot_ocupado", data: { alternativas: alt } };
      }
      throw e;
    }
    if (!appt) throw new Error("el insert de appointments no devolvió fila");

    // 4 · Google, con id DETERMINISTA. Si la llamada falla y se reintenta,
    // un 409 confirma que ya existe en vez de duplicar.
    const eventId = appt.id.replace(/-/g, ""); // 32 chars hex ⊂ base32hex ✔
    const evento = await gcalInsertarEvento({
      eventId,
      summary: `${servicio.name} — ${a.nombre_paciente}`,
      description:
        `Agendado por el agente de Telegram.\n` +
        `Paciente: ${a.nombre_paciente}\n` +
        `Tel: ${telefono ?? "no registrado"}\n` +
        (a.motivo ? `Motivo: ${a.motivo}\n` : "") +
        `Cita #${appt.id}`,
      start,
      end,
      timeZone: ctx.workspace.timezone,
      apptId: appt.id,
    });

    await sql`update appointments set gcal_event_id = ${eventId}, gcal_html_link = ${evento.htmlLink ?? null}
               where id = ${appt.id}`;

    await scheduleReminders(ctx.workspace, { id: appt.id, startsAt: start.toJSDate() });

    await logEvent({
      workspaceId: ctx.workspace.id, conversationId: ctx.conversation.conversationId,
      type: "appointment",
      payload: {
        apptId: appt.id, service: a.servicio, action: "booked",
        leadTimeHours: Math.round(start.diff(DateTime.now(), "hours").hours),
      },
    });

    return {
      ok: true,
      data: {
        cita_id: appt.id,
        cuando: start.setLocale("es-CO").toFormat("cccc d 'de' LLLL 'a las' h:mm a"),
        servicio: servicio.name,
        duracion_min: servicio.duration_min,
      },
    };
  },
};
