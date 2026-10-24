import { sql } from "../db/client.js";
import type { ToolContext, ToolResult } from "./types.js";

/**
 * Localizar la cita del paciente — compartido por `reprogramar_cita` y
 * `cancelar_cita` (spec 11).
 *
 * Dos invariantes, los dos deliberados:
 *   - SIEMPRE filtra por `contact_id`: un paciente no puede tocar la cita
 *     de otro, sin importar qué `cita_id` le pase al modelo.
 *   - Si no se da `cita_id` y hay MÁS de una cita activa, no se asume la
 *     próxima: se devuelve la lista para que el modelo pregunte cuál.
 */

export type CitaEncontrada = {
  id: string;
  serviceId: string | null;
  serviceName: string | null;
  durationMin: number | null;
  bufferMin: number | null;
  startsAt: Date;
  gcalEventId: string | null;
};

type FilaCita = {
  id: string; service_id: string | null; service_name: string | null;
  duration_min: number | null; buffer_min: number | null;
  starts_at: Date; gcal_event_id: string | null;
};

function aplanar(f: FilaCita): CitaEncontrada {
  return {
    id: f.id,
    serviceId: f.service_id,
    serviceName: f.service_name,
    durationMin: f.duration_min,
    bufferMin: f.buffer_min,
    startsAt: f.starts_at,
    gcalEventId: f.gcal_event_id,
  };
}

export async function buscarCitaDelPaciente(
  ctx: ToolContext,
  citaId?: string,
): Promise<{ ok: true; cita: CitaEncontrada } | { ok: false; result: ToolResult }> {
  if (citaId) {
    const [fila] = await sql<FilaCita[]>`
      select a.id, a.service_id, s.name as service_name, s.duration_min, s.buffer_min,
             a.starts_at, a.gcal_event_id
        from appointments a left join services s on s.id = a.service_id
       where a.id = ${citaId}
         and a.contact_id = ${ctx.conversation.contactId}
         and a.workspace_id = ${ctx.workspace.id}
         and a.status in ('booked','confirmed','rescheduled')`;
    if (!fila) return { ok: false, result: { ok: false, error: "cita_no_encontrada" } };
    return { ok: true, cita: aplanar(fila) };
  }

  const filas = await sql<FilaCita[]>`
    select a.id, a.service_id, s.name as service_name, s.duration_min, s.buffer_min,
           a.starts_at, a.gcal_event_id
      from appointments a left join services s on s.id = a.service_id
     where a.contact_id = ${ctx.conversation.contactId}
       and a.workspace_id = ${ctx.workspace.id}
       and a.status in ('booked','confirmed','rescheduled')
       and a.starts_at >= now()
     order by a.starts_at asc`;

  if (filas.length === 0) {
    return { ok: false, result: { ok: false, error: "sin_citas_proximas" } };
  }
  if (filas.length > 1) {
    return {
      ok: false,
      result: {
        ok: false,
        error: "cual_cita",
        data: {
          citas: filas.map((f) => ({
            id: f.id, servicio: f.service_name, cuando: f.starts_at.toISOString(),
          })),
        },
      },
    };
  }
  return { ok: true, cita: aplanar(filas[0]!) };
}
