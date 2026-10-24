import { decide, type EstadoDecision, type Turn } from "../../src/runtime/decide.js";

/** decide() es pura: sin red, sin base, se prueba directo. */

let fallos = 0;
const comprobar = (nombre: string, cond: boolean, detalle = "") => {
  if (cond) console.log(`OK   ${nombre}`);
  else { console.log(`FAIL ${nombre}${detalle ? ` — ${detalle}` : ""}`); fallos++; }
};

const activa: EstadoDecision = { isBlocked: false, aiEnabled: true, state: "ai_active" };
const T: Turn = {};

// ── Camino feliz ─────────────────────────────────────────────
comprobar("texto libre en ai_active → run_agent", decide(T, activa).kind === "run_agent");

// ── Los cuatro abstain del invariante ────────────────────────
for (const state of ["human_active", "handoff_pending", "paused", "closed"]) {
  const d = decide(T, { ...activa, state });
  comprobar(`state=${state} → abstain`, d.kind === "abstain", JSON.stringify(d));
}

comprobar("isBlocked=true → abstain (blocked)",
  decide(T, { ...activa, isBlocked: true }).kind === "abstain");
comprobar("aiEnabled=false → abstain (ai_disabled)",
  decide(T, { ...activa, aiEnabled: false }).kind === "abstain");

// ── El orden: los abstain ganan incluso sobre un comando ─────
// Un /start con el contacto bloqueado NO debe ejecutarse. Si alguna vez se
// quiere que /start "desbloquee", eso se decide explícitamente en el
// handler — decide() no hace esa excepción por su cuenta.
const dBloqueadoConComando = decide({ command: "start" }, { ...activa, isBlocked: true });
comprobar("un comando NO salta el bloqueo", dBloqueadoConComando.kind === "abstain",
  JSON.stringify(dBloqueadoConComando));

const dPausadoConComando = decide({ command: "humano" }, { ...activa, state: "paused" });
comprobar("otro comando (no /start) NO salta 'paused': /humano sobre pausado sigue abstain",
  dPausadoConComando.kind === "abstain", JSON.stringify(dPausadoConComando));

// ── La excepción angosta: /start SÍ rompe paused y closed ────
for (const state of ["paused", "closed"]) {
  const d = decide({ command: "start" }, { ...activa, state });
  comprobar(`/start SÍ rompe state=${state} (reactiva la conversación)`,
    d.kind === "deterministic" && d.handler === "start", JSON.stringify(d));
}
// ...pero NO rompe human_active ni handoff_pending: ahí hay una persona real.
for (const state of ["human_active", "handoff_pending"]) {
  const d = decide({ command: "start" }, { ...activa, state });
  comprobar(`/start NO rompe state=${state} (no le arrebata la conversación al humano)`,
    d.kind === "abstain", JSON.stringify(d));
}
// La excepción no aplica si el contacto está bloqueado: eso sigue siendo duro.
const dBloqueadoConStart = decide({ command: "start" }, { ...activa, isBlocked: true, state: "paused" });
comprobar("/start NO rompe isBlocked (eso sigue siendo un bloqueo duro)",
  dBloqueadoConStart.kind === "abstain" && dBloqueadoConStart.reason === "blocked");

// ── Comandos y botones, en estado normal ─────────────────────
const dComando = decide({ command: "start" }, activa);
comprobar("comando → deterministic con el handler correcto",
  dComando.kind === "deterministic" && dComando.handler === "start", JSON.stringify(dComando));

const dBoton = decide({ callbackData: "bk:limpieza-dental:12345" }, activa);
comprobar("callback_data → deterministic 'callback'",
  dBoton.kind === "deterministic" && dBoton.handler === "callback", JSON.stringify(dBoton));

// Un comando y un callback no deberían coexistir en la práctica (normalize.ts
// nunca los pone juntos), pero si pasara, el comando gana por ir primero.
const dAmbos = decide({ command: "ayuda", callbackData: "bk:x:1" }, activa);
comprobar("si por error llegan los dos, el comando gana (orden del código)",
  dAmbos.kind === "deterministic" && dAmbos.handler === "ayuda");

console.log(fallos === 0 ? "\n— decide: todo OK" : `\n— decide: ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
