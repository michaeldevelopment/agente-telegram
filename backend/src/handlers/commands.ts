import { sql } from "../db/client.js";
import { enqueue } from "../egress/outbox.js";
import { enviarAvisoGrupo } from "../handoff/group.js";
import { insertOutbound, type Conversacion, type Workspace } from "../ingress/persist.js";
import type { Inbound } from "../ingress/normalize.js";
import { transitionState } from "../runtime/state.js";

/**
 * Comandos deterministas. CERO tokens, SIN pasar por el buffer: el webhook
 * los rutea directo aquí antes de que el texto libre vaya a appendToBuffer.
 *
 * Registrar los tres en @BotFather (o con `npm run set-commands`) para que
 * aparezcan en el menú "/" del cliente de Telegram.
 */

async function telefono(ws: Workspace): Promise<string | null> {
  const [row] = await sql<{ tel: string | null }[]>`
    select structured #>> '{sedes,0,telefono}' as tel
      from business_info where workspace_id = ${ws.id}`;
  return row?.tel ?? null;
}

/** Encola y deja constancia en `messages`, que es el historial del agente. */
async function responder(ws: Workspace, conv: Conversacion, chatId: number, texto: string) {
  await enqueue({ workspaceId: ws.id, conversationId: conv.conversationId, chatId, texto });
  await insertOutbound(ws, conv, texto);
}

/**
 * /start — saludo, y REACTIVA la conversación si venía de /humano (paused)
 * o de cualquier otro estado que no sea ai_active. Es el invariante inverso
 * al de /humano: tu equipo puede pausar, pero el paciente siempre puede
 * retomar con el bot escribiendo /start de nuevo.
 */
export async function handleStart(ws: Workspace, conv: Conversacion, ev: Inbound): Promise<void> {
  if (conv.state !== "ai_active") {
    await transitionState(ws, conv.conversationId, "ai_active", "command:/start");
  }

  const nombre = ev.from.firstName ? `, ${ev.from.firstName}` : "";
  await responder(
    ws, conv, ev.chatId,
    `Hola${nombre} 👋 Soy la asistente de ${ws.name}.\n\n` +
      `Te ayudo a agendar una cita, resolver dudas sobre los tratamientos o conectarte ` +
      `con el equipo. ¿En qué te puedo ayudar?`,
  );
}

/** /ayuda — qué puede hacer el bot, en 3 líneas, con el teléfono de la clínica. */
export async function handleAyuda(ws: Workspace, conv: Conversacion, ev: Inbound): Promise<void> {
  const tel = await telefono(ws);
  await responder(
    ws, conv, ev.chatId,
    `Puedo agendar, reprogramar o cancelar tu cita, contarte sobre los servicios y sus ` +
      `precios desde, y pasarte con alguien del equipo si lo necesitas.\n\n` +
      `Escribe /humano cuando quieras hablar con una persona.` +
      (tel ? `\nY si es urgente, llámanos al ${tel}.` : ""),
  );
}

/**
 * /humano — escala de verdad (spec 13): pasa a `handoff_pending` (no
 * `paused`) y avisa al grupo interno con botones Tomar/Devolver, igual que
 * la tool `escalar_a_humano`. `decide()` abstiene en `handoff_pending` y
 * `human_active` sin excepción — a diferencia de `paused`, la salida de ahí
 * es del humano que "Devuelve", NO un /start del paciente.
 */
export async function handleHumano(ws: Workspace, conv: Conversacion, ev: Inbound): Promise<void> {
  await transitionState(ws, conv.conversationId, "handoff_pending", "command:/humano");
  await enviarAvisoGrupo(ws, conv, { motivo: "el paciente pidió hablar con una persona (/humano)" });
  await responder(
    ws, conv, ev.chatId,
    `Listo, dejo de responder por ahora. Alguien del equipo de ${ws.name} va a escribirte por aquí.`,
  );
}

/**
 * Capa 1 de guardrail clínico (spec 15): `isClinicalUrgency()` ya disparó en
 * `decide()`, 0 tokens. Esto es lo determinista que sigue: escala YA (sin
 * esperar el buffer, que `decide()` ya saltó al devolver `deterministic`
 * antes de llegar a `appendToBuffer`) y da el teléfono de la clínica.
 *
 * El teléfono sale de `business_info` (regla "cliente = datos, no lógica"),
 * con el número real como último respaldo si el negocio aún no lo tiene
 * cargado — nunca se deja sin número, es el dato más crítico del handoff.
 */
export async function handleUrgencia(ws: Workspace, conv: Conversacion, ev: Inbound): Promise<void> {
  await transitionState(ws, conv.conversationId, "handoff_pending", "guardrail:urgencia_clinica");

  const tel = (await telefono(ws)) ?? "+57 322 236 3192";
  await responder(
    ws, conv, ev.chatId,
    `Esto suena a algo que no puede esperar. Por favor llama ya a la clínica al ${tel} ` +
      `— ahí te atienden directo. Mientras tanto, también aviso a nuestro equipo.`,
  );

  await enviarAvisoGrupo(ws, conv, { motivo: "posible urgencia clínica detectada automáticamente" });
}
