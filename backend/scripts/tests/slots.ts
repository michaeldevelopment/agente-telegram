import { DateTime } from "luxon";
import { computeSlotsFromBusy, type HorarioDia } from "../../src/gcal/slots.js";

/**
 * computeSlotsFromBusy es 100% determinista: sin Google, sin base. Se
 * prueba directo, con datos inventados que reproducen los casos de la
 * spec 08 — incluidos los que necesitan credenciales reales para probarse
 * en vivo (cerrados, ocupación, solape).
 */

let fallos = 0;
const comprobar = (nombre: string, cond: boolean, detalle = "") => {
  if (cond) console.log(`OK   ${nombre}`);
  else { console.log(`FAIL ${nombre}${detalle ? ` — ${detalle}` : ""}`); fallos++; }
};

const ZONA = "America/Bogota";
// Horario real de la clínica: L-V 8-18 corrido, sábado 8-12, domingo cerrado.
const HORARIO: HorarioDia[] = [
  { weekday: 1, opens_at: "08:00:00", closes_at: "18:00:00", break_from: null, break_to: null },
  { weekday: 2, opens_at: "08:00:00", closes_at: "18:00:00", break_from: null, break_to: null },
  { weekday: 3, opens_at: "08:00:00", closes_at: "18:00:00", break_from: null, break_to: null },
  { weekday: 4, opens_at: "08:00:00", closes_at: "18:00:00", break_from: null, break_to: null },
  { weekday: 5, opens_at: "08:00:00", closes_at: "18:00:00", break_from: null, break_to: null },
  { weekday: 6, opens_at: "08:00:00", closes_at: "12:00:00", break_from: null, break_to: null },
  // domingo (0) deliberadamente AUSENTE: así se modela "cerrado"
];

// Un jueves fijo a las 06:00 (antes de abrir), para que "ahora" no interfiera
// con los resultados de los primeros días del rango.
const AHORA = DateTime.fromISO("2026-10-22T06:00:00", { zone: ZONA }); // jueves

function base(extra: Partial<Parameters<typeof computeSlotsFromBusy>[0]> = {}) {
  return computeSlotsFromBusy({
    zone: ZONA,
    from: "2026-10-22", // jueves
    to: "2026-10-29",   // jueves siguiente
    durationMin: 45,
    bufferMin: 10,       // limpieza-dental real: need = 55
    horario: HORARIO,
    cerrados: new Set(),
    busy: [],
    ahora: AHORA,
    ...extra,
  });
}

// ── 1 · Camino feliz ─────────────────────────────────────────
{
  const slots = base();
  comprobar("devuelve slots", slots.length > 0);
  comprobar("máximo 4 por defecto", slots.length <= 4, `${slots.length}`);
}

// ── 2 · Anticipación mínima: nada antes de ahora+2h ──────────
{
  const slots = base();
  const limite = AHORA.plus({ hours: 2 });
  comprobar("ningún slot antes de ahora+2h",
    slots.every((s) => DateTime.fromISO(s.iso) >= limite),
    slots.map((s) => s.label).join(", "));
}

// ── 3 · Respeta el horario: nada fuera de 8-18, sábado hasta 12, domingo 0 ──
{
  const slots = base({ to: "2026-11-11", limit: 100 }); // dos semanas largas, todos los días
  const fueraDeHorario = slots.filter((s) => {
    const d = DateTime.fromISO(s.iso);
    const h = d.hour + d.minute / 60;
    if (d.weekday === 7) return true;                 // domingo: CUALQUIERA es un fallo
    if (d.weekday === 6) return h < 8 || h >= 12 - 55 / 60; // sábado, cierra a las 12
    return h < 8 || h >= 18 - 55 / 60;                 // entre semana
  });
  comprobar("ninguno cae fuera del horario de atención", fueraDeHorario.length === 0,
    fueraDeHorario.map((s) => s.label).join(", "));
  comprobar("cero slots en domingo",
    slots.every((s) => DateTime.fromISO(s.iso).weekday !== 7));
}

// ── 4 y 5 usan need=15=GRID a propósito ──────────────────────
// Con need=55 (el caso real de limpieza-dental), tomar un slot válido
// salta el cursor +55 min, que NO es múltiplo de la rejilla de 15: el
// "grid" queda desalineado del reloj y una hora como "10:00" puede no
// evaluarse NUNCA como candidata (no es un bug: es la regla "el avance es
// por need, no por la rejilla" en acción). Para probar exclusión y
// frontera de forma legible, se usa un servicio con need=15=GRID, donde
// cada candidato SÍ cae en punto.
const unoAUno = (extra: Partial<Parameters<typeof computeSlotsFromBusy>[0]> = {}) =>
  computeSlotsFromBusy({
    zone: ZONA, from: "2026-10-22", to: "2026-10-22",
    durationMin: 15, bufferMin: 0, horario: HORARIO,
    cerrados: new Set(), busy: [], ahora: AHORA, limit: 100,
    ...extra,
  });

// ── 4 · Un bloque ocupado se excluye ─────────────────────────
{
  const ocupado = [{ start: "2026-10-22T10:00:00-05:00", end: "2026-10-22T11:00:00-05:00" }];
  const sinOcupar = unoAUno();
  const conOcupado = unoAUno({ busy: ocupado });
  comprobar("sin ocupación, 10:00 del jueves 22 SÍ aparecía (precondición del test)",
    sinOcupar.some((s) => s.iso.startsWith("2026-10-22T10:00:00")));
  comprobar("con el bloque ocupado, 10:00–10:45 YA NO aparecen",
    !conOcupado.some((s) => s.iso.startsWith("2026-10-22T10:") && s.iso < "2026-10-22T11:00:00"),
    conOcupado.filter((s) => s.iso.startsWith("2026-10-22T10")).map((s) => s.label).join(", "));
  comprobar("pero 11:00 SÍ sigue libre (el bloque no se come el resto del día)",
    conOcupado.some((s) => s.iso.startsWith("2026-10-22T11:00:00")));
}

// ── 5 · busy[].end es EXCLUSIVO ───────────────────────────────
{
  // Ocupado hasta las 10:00 exacto (exclusivo): el slot que EMPIEZA a las
  // 10:00 debe seguir libre — si end fuera tratado como inclusivo, se
  // perdería un slot válido en la frontera.
  const ocupado = [{ start: "2026-10-22T09:00:00-05:00", end: "2026-10-22T10:00:00-05:00" }];
  const slots = unoAUno({ busy: ocupado });
  comprobar("un slot que empieza justo cuando termina el bloque ocupado SIGUE libre",
    slots.some((s) => s.iso.startsWith("2026-10-22T10:00:00")),
    slots.map((s) => s.label).join(", "));
  comprobar("y el slot justo antes (09:45) SÍ sigue ocupado",
    !slots.some((s) => s.iso.startsWith("2026-10-22T09:45:00")));
}

// ── 6 · Un closure elimina el día entero ─────────────────────
{
  const sinCierre = base();
  const conCierre = base({ cerrados: new Set(["2026-10-22"]) });
  comprobar("sin cierre, el jueves 22 aporta slots (precondición)",
    sinCierre.some((s) => s.iso.startsWith("2026-10-22")));
  comprobar("con closures en esa fecha, el jueves 22 desaparece ENTERO",
    !conCierre.some((s) => s.iso.startsWith("2026-10-22")));
}

// ── 7 · Sin solape: el avance es por NEED, no por la rejilla ──
{
  const slots = base({ to: "2026-10-22", limit: 100 }); // solo el jueves 22, todos los huecos
  for (let i = 1; i < slots.length; i++) {
    const anterior = DateTime.fromISO(slots[i - 1]!.iso);
    const actual = DateTime.fromISO(slots[i]!.iso);
    const minutos = actual.diff(anterior, "minutes").minutes;
    comprobar(`slot ${i}: ${minutos} min desde el anterior (need=55, no 15)`,
      minutos >= 55, `${slots[i - 1]!.label} → ${slots[i]!.label}`);
  }
}

// ── 8 · La hora no se corre (sin el bug de offset) ───────────
{
  const slots = base();
  const primero = slots[0];
  comprobar("el ISO lleva el offset -05:00 (Bogotá), no Z ni otro",
    primero !== undefined && /-05:00$/.test(primero.iso), primero?.iso);
}

console.log(fallos === 0 ? "\n— slots: todo OK" : `\n— slots: ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
