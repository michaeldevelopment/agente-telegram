import { DateTime } from "luxon";
import { sql } from "../db/client.js";
import type { Workspace } from "../ingress/persist.js";

/**
 * Programación de recordatorios (spec 14). Telegram no tiene ventana de
 * 24 h, así que los proactivos son libres — lo cual NO significa que todo
 * valga. Dos reglas: respetar horas de silencio y parar al primer bloqueo
 * (esto último ya lo hace `cancelarPendientes`/el 403 del outbox).
 */

const TIPOS: readonly { kind: "confirm_24h" | "remind_2h"; horasAntes: number }[] = [
  { kind: "confirm_24h", horasAntes: 24 },
  { kind: "remind_2h", horasAntes: 2 },
];

/**
 * Si `dt` cae dentro de `[quiet_from, quiet_to)` (hora LOCAL del workspace),
 * se mueve a las `quiet_to` del mismo día. Un recordatorio a las 3 a. m. es
 * una forma eficaz de que te bloqueen el bot.
 *
 * `quiet_from` > `quiet_to` (p. ej. 21:00 → 08:00): el tramo de silencio
 * cruza la medianoche, así que hay dos casos: cae en la noche de HOY, o cae
 * en la madrugada de HOY (después de medianoche, antes de `quiet_to`).
 */
export function shiftOutOfQuietHours(
  dt: DateTime,
  quietFrom: string,  // "21:00:00"
  quietTo: string,    // "08:00:00"
): DateTime {
  const [hFrom, mFrom] = quietFrom.split(":").map(Number);
  const [hTo, mTo] = quietTo.split(":").map(Number);
  const inicioNoche = dt.set({ hour: hFrom, minute: mFrom, second: 0, millisecond: 0 });
  const finManana = dt.set({ hour: hTo, minute: mTo, second: 0, millisecond: 0 });

  const enSilencio = dt >= inicioNoche || dt < finManana;
  if (!enSilencio) return dt;

  // Si ya pasó la medianoche (dt < finManana), el "mañana a las quiet_to" es
  // HOY mismo; si todavía es de noche (dt >= inicioNoche), es el día siguiente.
  return dt < finManana ? finManana : finManana.plus({ days: 1 });
}

async function insertarRecordatorio(
  workspaceId: string, appointmentId: string, kind: "confirm_24h" | "remind_2h", sendAt: Date,
): Promise<void> {
  await sql`
    insert into reminders (workspace_id, appointment_id, kind, send_at)
    values (${workspaceId}, ${appointmentId}, ${kind}, ${sendAt})
    on conflict (appointment_id, kind) do update set
      send_at = excluded.send_at, status = 'pending', sent_at = null, error = null`;
}

/**
 * Programa (o REPROGRAMA) los dos recordatorios de una cita. `on conflict`
 * en `insertarRecordatorio` es lo que permite llamarla de nuevo tras un
 * `reprogramar_cita` sin pelear con `uq_reminder`: recalcula `send_at` en
 * vez de duplicar.
 *
 * Si el recordatorio recalculado cae en el pasado (p. ej. `confirm_24h`
 * para una cita a menos de 24 h), se omite — no se manda tarde.
 */
export async function scheduleReminders(
  ws: Workspace,
  appt: { id: string; startsAt: Date },
): Promise<void> {
  const [horario] = await sql<{ quiet_from: string; quiet_to: string }[]>`
    select quiet_from::text, quiet_to::text from workspaces where id = ${ws.id}`;
  if (!horario) throw new Error(`workspace ${ws.id} sin horario de silencio`);

  const ahora = DateTime.now();

  for (const { kind, horasAntes } of TIPOS) {
    const raw = DateTime.fromJSDate(appt.startsAt).setZone(ws.timezone).minus({ hours: horasAntes });
    const at = shiftOutOfQuietHours(raw, horario.quiet_from, horario.quiet_to);
    if (at < ahora) continue; // la cita es en <horasAntes: se omite ESTE recordatorio, no los demás
    await insertarRecordatorio(ws.id, appt.id, kind, at.toJSDate());
  }
}

/** Recordatorios pendientes de una cita cancelada/reprogramada-a-otro-id: 'skipped', no 'cancelled' (el enum no lo tiene). */
export async function cancelarRecordatoriosPendientes(appointmentId: string, motivo: string): Promise<void> {
  await sql`
    update reminders set status = 'skipped', error = ${motivo}
     where appointment_id = ${appointmentId} and status = 'pending'`;
}
