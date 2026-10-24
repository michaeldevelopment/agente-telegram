import { DateTime } from "luxon";
import { accessToken, calendarId } from "./auth.js";

/**
 * `freeBusy.query` — la ocupación real del calendario.
 *
 * ⚠️ `busy[].start` es INCLUSIVO y `busy[].end` es EXCLUSIVO. Un `<=` donde
 * va un `<` pierde un slot válido en cada frontera (ver slots.ts).
 *
 * ⚠️ `calendars.<id>.errors[]`: un `notFound` ahí significa que el
 * calendario NO está compartido con la Service Account. La petición
 * devuelve `200` igual — si no se revisa esto a mano, el motor cree que no
 * hay nada ocupado y ofrece horarios sobre citas existentes. Es el error de
 * configuración número uno (ver memoria/service-account-sin-attendees.md).
 */

export type Ocupado = { start: string; end: string };

export class CalendarioNoCompartido extends Error {
  constructor(id: string, detalle: string) {
    super(
      `El calendario '${id}' no está compartido con la Service Account ` +
        `(o el GOOGLE_CALENDAR_ID está mal): ${detalle}`,
    );
    this.name = "CalendarioNoCompartido";
  }
}

async function freeBusyRaw(timeMin: string, timeMax: string, timeZone: string): Promise<Ocupado[]> {
  const token = await accessToken();
  const id = calendarId();

  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ timeMin, timeMax, timeZone, items: [{ id }] }),
  });

  const body = (await res.json()) as {
    calendars?: Record<string, { busy?: Ocupado[]; errors?: { reason: string }[] }>;
    error?: { message: string };
  };

  if (!res.ok) {
    throw new Error(`freeBusy.query falló (${res.status}): ${body.error?.message ?? "sin detalle"}`);
  }

  const cal = body.calendars?.[id];
  // Falla RUIDOSAMENTE. La alternativa (devolver [] y seguir) es el bug
  // silencioso que ofrece horarios sobre citas que ya existen.
  if (cal?.errors?.length) {
    throw new CalendarioNoCompartido(id, cal.errors.map((e) => e.reason).join(", "));
  }

  return cal?.busy ?? [];
}

/**
 * Cache de 60 s por (calendario, día). Durante una conversación el modelo
 * suele consultar disponibilidad 2-3 veces; sin cache son 2-3 llamadas a
 * Google por lo mismo.
 */
const CACHE_MS = 60_000;
const cache = new Map<string, { data: Ocupado[]; hasta: number }>();

/** Ocupación entre `from` y `to` (YYYY-MM-DD), en la zona del workspace. */
export async function getBusyCached(zone: string, from: string, to: string): Promise<Ocupado[]> {
  const id = calendarId();
  const clave = `${id}|${from}|${to}`;
  const c = cache.get(clave);
  if (c && c.hasta > Date.now()) return c.data;

  const timeMin = DateTime.fromISO(from, { zone }).startOf("day").toISO()!;
  const timeMax = DateTime.fromISO(to, { zone }).endOf("day").toISO()!;

  const data = await freeBusyRaw(timeMin, timeMax, zone);
  cache.set(clave, { data, hasta: Date.now() + CACHE_MS });
  return data;
}

export function _soloParaPruebas_limpiarCache(): void {
  cache.clear();
}
