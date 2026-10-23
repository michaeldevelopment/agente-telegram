import { calcularCosto, esPeak, ratioCache } from "../../src/llm/cost.js";

/** Cálculo de costo: puro, sin red ni base. */

let fallos = 0;
const comprobar = (nombre: string, cond: boolean, detalle = "") => {
  if (cond) console.log(`OK   ${nombre}`);
  else { console.log(`FAIL ${nombre}${detalle ? ` — ${detalle}` : ""}`); fallos++; }
};

// Peak: 01:00–04:00 y 06:00–10:00 UTC, de lunes a viernes.
const utc = (iso: string) => new Date(iso);
comprobar("miércoles 02:00 UTC es peak", esPeak(utc("2026-10-21T02:00:00Z")));
comprobar("miércoles 07:00 UTC es peak", esPeak(utc("2026-10-21T07:00:00Z")));
comprobar("miércoles 15:00 UTC NO es peak", !esPeak(utc("2026-10-21T15:00:00Z")));
comprobar("sábado 02:00 UTC NO es peak (fin de semana)", !esPeak(utc("2026-10-24T02:00:00Z")));

// El horario de la clínica: 8–18 Bogotá = 13–23 UTC. Todo off-peak.
const horarioClinica = [13, 15, 18, 20, 22].map((h) =>
  esPeak(utc(`2026-10-21T${String(h).padStart(2, "0")}:00:00Z`)));
comprobar("el horario de la clínica cae ÍNTEGRAMENTE en off-peak",
  horarioClinica.every((p) => !p));

// Tarifas off-peak: hit $0.003/M, miss $0.15/M, output $0.60/M.
const unTurno = { hit: 1_500_000, miss: 0, output: 0 };
comprobar("1M de hits off-peak cuesta $0.003",
  Math.abs(calcularCosto({ hit: 1e6, miss: 0, output: 0 }, utc("2026-10-21T15:00:00Z")) - 0.003) < 1e-9);
comprobar("1M de misses off-peak cuesta $0.15",
  Math.abs(calcularCosto({ hit: 0, miss: 1e6, output: 0 }, utc("2026-10-21T15:00:00Z")) - 0.15) < 1e-9);
comprobar("1M de output off-peak cuesta $0.60",
  Math.abs(calcularCosto({ hit: 0, miss: 0, output: 1e6 }, utc("2026-10-21T15:00:00Z")) - 0.6) < 1e-9);
comprobar("en peak cuesta el doble",
  Math.abs(
    calcularCosto(unTurno, utc("2026-10-21T02:00:00Z")) -
      2 * calcularCosto(unTurno, utc("2026-10-21T15:00:00Z")),
  ) < 1e-9);

// Un hit cuesta 50× menos que un miss: la razón de toda la disciplina.
const costeHit = calcularCosto({ hit: 1e6, miss: 0, output: 0 }, utc("2026-10-21T15:00:00Z"));
const costeMiss = calcularCosto({ hit: 0, miss: 1e6, output: 0 }, utc("2026-10-21T15:00:00Z"));
comprobar("un hit cuesta 50× menos que un miss", Math.round(costeMiss / costeHit) === 50);

// Un turno realista: ~1500 hit, ~450 miss, ~95 output.
const turnoReal = calcularCosto({ hit: 1500, miss: 450, output: 95 }, utc("2026-10-21T15:00:00Z"));
comprobar("un turno realista cuesta céntimos de céntimo",
  turnoReal > 0 && turnoReal < 0.0005, `$${turnoReal.toFixed(8)}`);

comprobar("ratio de cache", ratioCache({ hit: 80, miss: 20, output: 0 }) === 80);
comprobar("ratio sin tokens no divide por cero", ratioCache({ hit: 0, miss: 0, output: 0 }) === 0);

console.log(fallos === 0 ? "\n— costo: todo OK" : `\n— costo: ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
