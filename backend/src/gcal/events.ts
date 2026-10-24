import type { DateTime } from "luxon";
import { accessToken, calendarId } from "./auth.js";

/**
 * Creación de eventos. Id DETERMINISTA: si la petición se reintenta, Google
 * responde `409` en vez de duplicar. Eso es lo que vuelve `agendar_cita`
 * (spec 10) segura ante reintentos — ver memoria/service-account-sin-attendees.md.
 */

export type EventoGcal = { id: string; htmlLink?: string };

function url(path: string): string {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId())}${path}`;
}

/** 409 → el evento ya existe (es la idempotencia funcionando): se lee y se devuelve. */
async function leerEvento(eventId: string): Promise<EventoGcal> {
  const token = await accessToken();
  const res = await fetch(url(`/events/${eventId}`), {
    headers: { authorization: `Bearer ${token}` },
  });
  const data = (await res.json()) as { id?: string; htmlLink?: string; error?: { message: string } };
  if (!res.ok) {
    throw new Error(`no se pudo leer el evento ${eventId} tras un 409: ${data.error?.message ?? res.status}`);
  }
  return { id: data.id!, htmlLink: data.htmlLink };
}

/**
 * Inserta el evento de una cita.
 *
 * - `dateTime` con offset Y `timeZone`: sin offset, se interpreta en la
 *   zona del calendario y la cita aparece corrida 5 horas.
 * - SIN `attendees`: las Service Accounts no pueden invitar sin delegación
 *   de dominio. El paciente recibe su confirmación por Telegram.
 * - `sendUpdates=none`: no hay a quién notificar.
 * - `extendedProperties.private.apptId`: permite reconciliar si alguien
 *   mueve la cita a mano en Google — que es exactamente lo que va a pasar.
 */
export async function gcalInsertarEvento(opts: {
  eventId: string;         // determinista: el uuid de la cita sin guiones
  summary: string;
  description: string;
  start: DateTime;
  end: DateTime;
  timeZone: string;
  apptId: string;
}): Promise<EventoGcal> {
  const token = await accessToken();

  const body = {
    id: opts.eventId,
    summary: opts.summary,
    description: opts.description,
    start: { dateTime: opts.start.toISO(), timeZone: opts.timeZone },
    end: { dateTime: opts.end.toISO(), timeZone: opts.timeZone },
    reminders: { useDefault: true },
    extendedProperties: { private: { apptId: opts.apptId, source: "telegram-agent" } },
  };

  const res = await fetch(url("/events?sendUpdates=none"), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.status === 409) return leerEvento(opts.eventId);

  const data = (await res.json()) as { id?: string; htmlLink?: string; error?: { message: string } };
  if (!res.ok) {
    throw new Error(`Google events.insert falló (${res.status}): ${data.error?.message ?? "sin detalle"}`);
  }
  return { id: data.id!, htmlLink: data.htmlLink };
}
