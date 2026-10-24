import { DateTime } from "luxon";
import { sql } from "../db/client.js";
import { enqueue } from "../egress/outbox.js";
import { getWorkspaceById, type Workspace } from "../ingress/persist.js";
import { logEvent } from "../obs/events.js";

/**
 * Envío de recordatorios (spec 14). Plantillas con datos, CERO tokens: esto
 * nunca pasa por el LLM.
 */

type FilaDebida = {
  id: string; workspace_id: string; appointment_id: string; kind: "confirm_24h" | "remind_2h";
  starts_at: Date; patient_name: string; tg_chat_id: string; conversation_id: string;
  service_name: string | null;
};

/** Primeros 8 hex del uuid de la cita: cabe sobrado en el límite de 64 bytes de callback_data. */
export function apptCorto(appointmentId: string): string {
  return appointmentId.replace(/-/g, "").slice(0, 8);
}

export async function resolverPorApptCorto(workspaceId: string, corto: string): Promise<string | null> {
  const [fila] = await sql<{ id: string }[]>`
    select id from appointments
     where workspace_id = ${workspaceId} and left(replace(id::text, '-', ''), 8) = ${corto}
     limit 1`;
  return fila?.id ?? null;
}

async function direccionSede(workspaceId: string): Promise<string> {
  const [row] = await sql<{ dir: string | null }[]>`
    select structured #>> '{sedes,0,direccion}' as dir from business_info where workspace_id = ${workspaceId}`;
  return row?.dir ?? "la dirección de la clínica";
}

function plantillaConfirm24h(f: FilaDebida, ws: Workspace): string {
  const cuando = DateTime.fromJSDate(f.starts_at).setZone(ws.timezone)
    .setLocale("es-CO").toFormat("cccc d 'de' LLLL 'a las' h:mm a");
  const servicio = f.service_name ?? "tu cita";
  return `Hola ${f.patient_name.split(" ")[0]}, te recordamos tu cita de ${servicio} ` +
    `${cuando}. ¿Nos confirmas?`;
}

async function plantillaRemind2h(f: FilaDebida, ws: Workspace): Promise<string> {
  const dir = await direccionSede(f.workspace_id);
  const cuando = DateTime.fromJSDate(f.starts_at).setZone(ws.timezone).toFormat("h:mm a");
  return `Te esperamos en ${ws.name} a las ${cuando} (en 2 horas). Dirección: ${dir}.`;
}

/** Procesa TODOS los recordatorios vencidos. Lo llama `/internal/reminders/tick`. */
export async function tickReminders(): Promise<number> {
  const filas = await sql<FilaDebida[]>`
    select r.id, r.workspace_id, r.appointment_id, r.kind,
           a.starts_at, a.patient_name, a.conversation_id,
           c.tg_chat_id, s.name as service_name
      from reminders r
      join appointments a on a.id = r.appointment_id
      join contacts c on c.id = a.contact_id
      left join services s on s.id = a.service_id
     where r.status = 'pending' and r.send_at <= now()
       and a.status in ('booked','confirmed','rescheduled')
     order by r.send_at asc
     limit 200`;

  for (const f of filas) {
    try {
      await enviarUno(f);
    } catch (e) {
      await sql`update reminders set status = 'failed', error = ${e instanceof Error ? e.message : String(e)}
                 where id = ${f.id}`;
    }
  }
  return filas.length;
}

async function enviarUno(f: FilaDebida): Promise<void> {
  const ws = await getWorkspaceById(f.workspace_id);
  if (!ws) throw new Error(`workspace ${f.workspace_id} no encontrado`);

  const texto = f.kind === "confirm_24h" ? plantillaConfirm24h(f, ws) : await plantillaRemind2h(f, ws);
  const corto = apptCorto(f.appointment_id);

  const replyMarkup = f.kind === "confirm_24h"
    ? {
        inline_keyboard: [[
          { text: "Confirmar", callback_data: `rc:${corto}` },
          { text: "Reprogramar", callback_data: `rp:${corto}` },
          { text: "Cancelar", callback_data: `rx:${corto}` },
        ]],
      }
    : undefined;

  const chatId = Number(f.tg_chat_id);
  await enqueue({
    workspaceId: f.workspace_id, conversationId: f.conversation_id, chatId, texto, replyMarkup,
  });
  await sql`
    insert into messages (workspace_id, conversation_id, direction, kind, body)
    values (${f.workspace_id}, ${f.conversation_id}, 'out', 'text', ${texto})`;

  await sql`update reminders set status = 'sent', sent_at = now() where id = ${f.id}`;

  await logEvent({
    workspaceId: f.workspace_id, conversationId: f.conversation_id,
    type: "reminder_sent", payload: { reminderId: f.id, appointmentId: f.appointment_id, kind: f.kind },
  });
}
