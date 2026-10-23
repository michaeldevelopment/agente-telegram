import { sql } from "../db/client.js";
import { enqueue } from "../egress/outbox.js";
import { prepararTexto } from "../egress/format.js";
import { callWithRetry, MODEL, SinSaldo } from "../llm/deepseek.js";
import {
  bloqueVolatil, buildMessages, getHistorial, getPromptEstatico,
} from "../llm/messages.js";
import { logEvent, logLlmCall } from "../obs/events.js";
import type { Conversacion, Workspace } from "../ingress/persist.js";

/**
 * Un turno del agente: cargar contexto, llamar al modelo, sanear, encolar.
 *
 * Todavía sin tools: solo conversa. El loop de tool-calling llega en la
 * spec 09.
 */

export type ResultadoTurno = { ok: true; texto: string } | { ok: false; motivo: string };

export async function runAgent(
  ws: Workspace,
  conv: Conversacion,
  textoTurno: string,
): Promise<ResultadoTurno> {
  try {
    const [promptEstatico, datos] = await Promise.all([
      getPromptEstatico(ws.id),
      datosDelPaciente(conv.contactId),
      // El historial se pide después: tiene que incluir el turno actual, que
      // el ingress ya guardó, así que se excluye explícitamente abajo.
    ]);

    // El turno actual ya está en `messages`; no puede ir dos veces.
    const historial = (await getHistorial(conv.conversationId)).slice(0, -1);

    const mensajes = buildMessages({
      promptEstatico,
      resumen: datos.resumen,
      historial,
      bloqueVolatil: bloqueVolatil({
        timezone: ws.timezone,
        nombrePaciente: datos.nombre,
        telefonoPaciente: datos.telefono,
      }),
      textoTurno,
    });

    const res = await callWithRetry(mensajes);

    await logLlmCall({
      workspaceId: ws.id,
      conversationId: conv.conversationId,
      model: MODEL,
      steps: 1,
      uso: res.uso,
      latencyMs: res.latenciaMs,
      finish: res.finish,
    });

    const texto = res.texto.trim();
    if (!texto) return await degradar(ws, conv, "el modelo devolvió vacío");

    // El saneado real (escape, troceo, limpieza de markdown) lo hace el
    // outbox; aquí solo se comprueba que quede algo que enviar.
    const trozos = prepararTexto(texto);
    if (trozos.length === 0) return await degradar(ws, conv, "no quedó texto tras sanear");

    await enqueue({
      workspaceId: ws.id,
      conversationId: conv.conversationId,
      chatId: Number(datos.chatId),
      texto,
    });
    await guardarSalida(ws, conv, texto);

    return { ok: true, texto };
  } catch (e) {
    if (e instanceof SinSaldo) {
      await logEvent({
        workspaceId: ws.id, conversationId: conv.conversationId,
        type: "llm_error", level: "error",
        payload: { code: 402, motivo: "sin saldo", accion: "alerta al equipo" },
      });
      return await degradar(ws, conv, "DeepSeek sin saldo");
    }
    await logEvent({
      workspaceId: ws.id, conversationId: conv.conversationId,
      type: "llm_error", level: "error",
      payload: { motivo: e instanceof Error ? e.message : String(e) },
    });
    return await degradar(ws, conv, e instanceof Error ? e.message : String(e));
  }
}

/**
 * Cuando el modelo no responde: mensaje de cortesía y la conversación pasa a
 * `handoff_pending`. NUNCA silencio: un paciente que escribe y no recibe nada
 * asume que el negocio no funciona.
 */
async function degradar(ws: Workspace, conv: Conversacion, motivo: string): Promise<ResultadoTurno> {
  const datos = await datosDelPaciente(conv.contactId);
  const texto =
    "Estoy teniendo un problema técnico en este momento. " +
    "Un asesor de la clínica te escribe en breve.";

  await enqueue({
    workspaceId: ws.id,
    conversationId: conv.conversationId,
    chatId: Number(datos.chatId),
    texto,
  });
  await guardarSalida(ws, conv, texto);

  await sql`update conversations set state = 'handoff_pending', updated_at = now()
             where id = ${conv.conversationId}`;
  await logEvent({
    workspaceId: ws.id, conversationId: conv.conversationId,
    type: "state_change", level: "warn",
    payload: { from: conv.state, to: "handoff_pending", reason: motivo },
  });

  return { ok: false, motivo };
}

async function datosDelPaciente(contactId: string) {
  const [c] = await sql<
    { tg_chat_id: string; full_name: string | null; first_name: string | null;
      phone: string | null; resumen: string | null }[]
  >`select c.tg_chat_id, c.full_name, c.first_name, c.phone,
           (select summary from conversations where contact_id = c.id limit 1) as resumen
      from contacts c where c.id = ${contactId}`;
  return {
    chatId: c?.tg_chat_id ?? "0",
    nombre: c?.full_name ?? c?.first_name ?? null,
    telefono: c?.phone ?? null,
    resumen: c?.resumen ?? null,
  };
}

async function guardarSalida(ws: Workspace, conv: Conversacion, texto: string) {
  await sql`
    insert into messages (workspace_id, conversation_id, direction, kind, body)
    values (${ws.id}, ${conv.conversationId}, 'out', 'text', ${texto})`;
  await sql`update conversations set last_ai_at = now(), state = 'awaiting_reply'
             where id = ${conv.conversationId}`;
}
