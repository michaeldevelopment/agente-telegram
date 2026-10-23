import { sql } from "../db/client.js";
import { enqueue } from "../egress/outbox.js";
import { insertOutbound, type Conversacion, type Workspace } from "../ingress/persist.js";
import type { Inbound } from "../ingress/normalize.js";

/**
 * Respuestas deterministas a /start y /ayuda. CERO tokens.
 *
 * Desde la spec 04 nada llama a sendMessage directo: todo pasa por la cola,
 * que es la que gobierna rate limits, reintentos y auditoría.
 */

async function telefono(ws: Workspace): Promise<string | null> {
  const [row] = await sql<{ tel: string | null }[]>`
    select structured #>> '{sedes,0,telefono}' as tel
      from business_info where workspace_id = ${ws.id}`;
  return row?.tel ?? null;
}

/** Encola y deja constancia en `messages`, que es el historial del agente. */
async function responder(ws: Workspace, conv: Conversacion, chatId: number, texto: string) {
  await enqueue({
    workspaceId: ws.id,
    conversationId: conv.conversationId,
    chatId,
    texto,
  });
  await insertOutbound(ws, conv, texto);
}

export async function handleStart(ws: Workspace, conv: Conversacion, ev: Inbound) {
  const nombre = ev.from.firstName ? `, ${ev.from.firstName}` : "";
  await responder(
    ws, conv, ev.chatId,
    `Hola${nombre} 👋 Soy la asistente de ${ws.name}.\n\n` +
      `Te ayudo a agendar una cita, resolver dudas sobre los tratamientos o conectarte ` +
      `con el equipo. ¿En qué te puedo ayudar?`,
  );
}

export async function handleAyuda(ws: Workspace, conv: Conversacion, ev: Inbound) {
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
 * Acuse mientras el agente no existe (llega en la spec 05).
 * Sin esto, el paciente escribe y no pasa nada.
 */
export async function handleSinAgente(ws: Workspace, conv: Conversacion, ev: Inbound) {
  await responder(
    ws, conv, ev.chatId,
    `Recibí tu mensaje. Todavía estoy aprendiendo a responder por mi cuenta; ` +
      `mientras tanto, escribe /ayuda para ver qué puedo hacer.`,
  );
}
