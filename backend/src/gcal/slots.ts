import { DateTime, Interval } from "luxon";
import { sql } from "../db/client.js";
import { getBusyCached, type Ocupado } from "./freebusy.js";

/**
 * El motor de slots. CÓDIGO DETERMINISTA PURO: el modelo no participa.
 *
 *   slots = horario de atención
 *         − descanso
 *         − días cerrados (closures)
 *         − bloques ocupados (freeBusy)
 *         − anticipación mínima
 *         alineado a una rejilla de 15 min
 *
 * `computeSlotsFromBusy` no toca ni la base ni la red: recibe todo como
 * datos y es 100% determinista, así que se puede probar sin credenciales
 * de Google. `computeSlots` es el envoltorio que sí los trae.
 */

export type HorarioDia = {
  weekday: number;              // 0 = domingo (igual que business_hours, NO como Luxon)
  opens_at: string;             // "08:00:00"
  closes_at: string;
  break_from: string | null;
  break_to: string | null;
};

export type SlotDTO = {
  iso: string;         // "2026-10-29T10:30:00-05:00" — para agendar_cita
  epochMin: number;    // minutos desde epoch — para el callback_data (≤64 bytes)
  label: string;       // "jue 29 oct · 10:30 a. m." — para el botón, es-CO
};

const GRID_MIN = 15;
const ANTICIPACION_MIN_HORAS = 2;
const HORIZONTE_DIAS = 21;
const MAX_SLOTS_DEFECTO = 4;

function aHora(dia: DateTime, hhmmss: string): DateTime {
  const [h, m] = hhmmss.split(":").map(Number);
  return dia.set({ hour: h, minute: m, second: 0, millisecond: 0 });
}

export function computeSlotsFromBusy(opts: {
  zone: string;
  from: string;                     // YYYY-MM-DD
  to: string;                       // YYYY-MM-DD
  durationMin: number;
  bufferMin: number;
  horario: HorarioDia[];
  cerrados: ReadonlySet<string>;     // YYYY-MM-DD
  busy: Ocupado[];
  limit?: number;
  ahora?: DateTime;                  // inyectable para pruebas deterministas
}): SlotDTO[] {
  const { zone } = opts;
  const limit = opts.limit ?? MAX_SLOTS_DEFECTO;
  const need = opts.durationMin + opts.bufferMin;
  const ahora = (opts.ahora ?? DateTime.now()).setZone(zone);
  // Anticipación mínima: nadie quiere una cita para dentro de 10 minutos
  // que nadie en la clínica vio.
  const earliest = ahora.plus({ hours: ANTICIPACION_MIN_HORAS });

  const porWeekday = new Map(opts.horario.map((h) => [h.weekday, h]));
  const busyIv = opts.busy.map((b) =>
    // end EXCLUSIVO: así lo define freeBusy. Interval.fromDateTimes ya trata
    // el extremo final como exclusivo, así que esto es coherente sin más.
    Interval.fromDateTimes(
      DateTime.fromISO(b.start, { zone }),
      DateTime.fromISO(b.end, { zone }),
    ),
  );

  const out: SlotDTO[] = [];
  const hastaLuxon = DateTime.fromISO(opts.to, { zone }).plus({ days: HORIZONTE_DIAS }); // tope duro, por si acaso
  const tope = DateTime.fromISO(opts.to, { zone }) < hastaLuxon
    ? DateTime.fromISO(opts.to, { zone })
    : hastaLuxon;

  for (
    let dia = DateTime.fromISO(opts.from, { zone });
    dia <= tope && out.length < limit;
    dia = dia.plus({ days: 1 })
  ) {
    const fechaISO = dia.toISODate()!;
    if (opts.cerrados.has(fechaISO)) continue;

    // ⚠️ Luxon numera 1=lunes…7=domingo; business_hours usa 0=domingo.
    // Equivocar esta conversión desplaza todo el horario un día.
    const horarioDelDia = porWeekday.get(dia.weekday % 7);
    if (!horarioDelDia) continue; // día sin atención

    const tramos: [string, string][] = horarioDelDia.break_from && horarioDelDia.break_to
      ? [[horarioDelDia.opens_at, horarioDelDia.break_from], [horarioDelDia.break_to, horarioDelDia.closes_at]]
      : [[horarioDelDia.opens_at, horarioDelDia.closes_at]];

    for (const [abre, cierra] of tramos) {
      let t = aHora(dia, abre);
      const fin = aHora(dia, cierra);

      while (t.plus({ minutes: need }) <= fin && out.length < limit) {
        const candidato = Interval.fromDateTimes(t, t.plus({ minutes: need }));
        const libre = t >= earliest && !busyIv.some((b) => b.overlaps(candidato));

        if (libre) {
          out.push({
            iso: t.toISO()!,
            epochMin: Math.floor(t.toMillis() / 60_000),
            label: t.setLocale("es-CO").toFormat("ccc d LLL '·' h:mm a"),
          });
          // Sin solape entre las opciones ofrecidas: el avance es por NEED,
          // no por la rejilla, cuando el slot es válido. Si se ofrecen
          // 10:00 y 10:15 para un servicio de 45 min, al reservar una la
          // otra deja de existir y el paciente siente que lo engañaron.
          t = t.plus({ minutes: Math.max(need, GRID_MIN) });
        } else {
          t = t.plus({ minutes: GRID_MIN });
        }
      }
    }
  }

  return out;
}

// ── El envoltorio con I/O real ───────────────────────────────

export type ServicioParaSlots = { duration_min: number; buffer_min: number };

export async function computeSlots(opts: {
  workspaceId: string;
  zone: string;
  servicio: ServicioParaSlots;
  from: string;
  to?: string;
  limit?: number;
}): Promise<SlotDTO[]> {
  const to = opts.to ?? DateTime.fromISO(opts.from, { zone: opts.zone })
    .plus({ days: 7 }).toISODate()!;

  const [horario, cierres, busy] = await Promise.all([
    sql<HorarioDia[]>`
      select weekday, opens_at::text, closes_at::text, break_from::text, break_to::text
        from business_hours where workspace_id = ${opts.workspaceId}`,
    sql<{ day: string }[]>`
      select day::text from closures
       where workspace_id = ${opts.workspaceId} and day between ${opts.from} and ${to}`,
    getBusyCached(opts.zone, opts.from, to),
  ]);

  return computeSlotsFromBusy({
    zone: opts.zone,
    from: opts.from,
    to,
    durationMin: opts.servicio.duration_min,
    bufferMin: opts.servicio.buffer_min,
    horario,
    cerrados: new Set(cierres.map((c) => c.day)),
    busy,
    limit: opts.limit,
  });
}
