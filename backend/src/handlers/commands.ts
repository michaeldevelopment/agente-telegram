import { sql } from "../db/client.js";
import { enqueue } from "../egress/outbox.js";
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
 * /humano — pausa la IA de verdad: `state = 'paused'` hace que `decide()`
 * abstenga en TODOS los turnos siguientes, sin excepción, hasta que el
 * paciente escriba /start. El aviso al grupo interno llega en la spec 13;
 * por ahora el paciente queda pausado y avisado, que es lo que esta spec
 * puede prometer sin ese canal todavía.
 */
export async function handleHumano(ws: Workspace, conv: Conversacion, ev: Inbound): Promise<void> {
  await transitionState(ws, conv.conversationId, "paused", "command:/humano");
  await responder(
    ws, conv, ev.chatId,
    `Listo, dejo de responder por ahora. Alguien del equipo de ${ws.name} va a escribirte ` +
      `por aquí.\n\nSi quieres que vuelva a atenderte, escribe /start.`,
  );
}
