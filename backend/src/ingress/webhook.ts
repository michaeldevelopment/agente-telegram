import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { env, EnvFaltante } from "../config/env.js";
import { normalize, type Inbound } from "./normalize.js";
import {
  getWorkspace, insertInboundOnConflictDoNothing, logEvent,
  marcarBloqueado, upsertContactoYConversacion, type Conversacion, type Workspace,
} from "./persist.js";
import { handleAyuda, handleHumano, handleStart, handleUrgencia } from "../handlers/commands.js";
import { handleCallback } from "../handlers/callbacks.js";
import { relayGrupoAPaciente, relayPacienteAGrupo } from "../handoff/relay.js";
import { appendToBuffer } from "../runtime/buffer.js";
import { decide } from "../runtime/decide.js";
import { TelegramError } from "../telegram/api.js";

/** Comparación en tiempo constante. Longitudes distintas = no coincide. */
function timingSafeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/**
 * El secreto y el path viven en el workspace. Mientras haya un solo cliente
 * se aceptan también los del entorno, que es lo que dice `memoria/` sobre
 * multi-cliente: desde el segundo, la columna manda.
 */
function esperado(ws: Workspace) {
  return {
    secret: ws.webhookSecret ?? env.TELEGRAM_WEBHOOK_SECRET ?? null,
    path: ws.webhookPath ?? env.TELEGRAM_WEBHOOK_PATH ?? null,
  };
}

export function registrarWebhook(app: FastifyInstance) {
  app.post<{ Params: { workspace: string; secretPath: string } }>(
    "/tg/:workspace/:secretPath",
    (req, reply) => {
      // El trabajo real va después del ACK, así que la ruta no es async.
      void (async () => {
        const { workspace, secretPath } = req.params;

        const ws = await getWorkspace(workspace);
        if (!ws) return reply.code(404).send();

        const exp = esperado(ws);
        if (!exp.secret || !exp.path) {
          req.log.error(
            { workspace }, "el workspace no tiene webhook_secret/webhook_path configurados",
          );
          return reply.code(503).send();
        }

        // Capa 1: el segmento aleatorio del path.
        if (!timingSafeEq(secretPath, exp.path)) return reply.code(404).send();

        // Capa 2: el header que manda Telegram.
        const header = req.headers["x-telegram-bot-api-secret-token"];
        if (typeof header !== "string" || !timingSafeEq(header, exp.secret)) {
          // Sin loguear el valor recibido: un secreto fallido es información.
          req.log.warn({ workspace }, "secret_token inválido");
          return reply.code(401).send();
        }

        // ACK INMEDIATO. Telegram reintenta si no recibe 2XX, y aunque el
        // índice único frena el duplicado, reintentar cuesta latencia.
        reply.code(200).send({ ok: true });

        void procesar(ws, req.body).catch((e) =>
          logEvent({
            workspaceId: ws.id,
            type: "ingress_error",
            level: "error",
            payload: { message: e instanceof Error ? e.message : String(e) },
          }).catch(() => {}),
        );
      })();
    },
  );
}

async function procesar(ws: Workspace, body: unknown): Promise<void> {
  const ev = normalize(body);
  if (!ev) return; // update de un tipo que no pedimos

  // El grupo interno de handoff (spec 13) NO es un paciente: sus mensajes
  // se relayan al chat correspondiente, nunca crean contacto ni conversación.
  if (ws.handoffChatId !== null && ev.chatId === ws.handoffChatId) {
    return await procesarMensajeDeGrupo(ws, ev);
  }

  const conv = await upsertContactoYConversacion(ws, ev);

  // Dedupe en base de datos, no en memoria.
  const { isNew, id: messageId } = await insertInboundOnConflictDoNothing(ws, conv, ev);
  if (!isNew) return;

  await rutear(ws, conv, ev, messageId);
}

/**
 * Una respuesta (`reply_to_message`) a un aviso de handoff en el grupo →
 * se reenvía al paciente. Cualquier otro mensaje del grupo (sin reply, o
 * respondiendo a otra cosa) se ignora: este no es un canal de comandos.
 */
async function procesarMensajeDeGrupo(ws: Workspace, ev: Inbound): Promise<void> {
  if (!ev.replyToMessageId || !ev.text) return;
  try {
    await relayGrupoAPaciente(ws, ev.replyToMessageId, ev.text, ev.userId);
  } catch (e) {
    await logEvent({
      workspaceId: ws.id, type: "ingress_error", level: "error",
      payload: { message: e instanceof Error ? e.message : String(e) },
    }).catch(() => {});
  }
}

async function rutear(
  ws: Workspace,
  conv: Conversacion,
  ev: Inbound,
  messageId: string | undefined,
): Promise<void> {
  try {
    // El usuario bloqueó el bot (o lo desbloqueó). Esto es un evento de
    // sistema, no un turno: no pasa por decide().
    if (ev.kind === "system" && ev.bloqueado !== undefined) {
      await marcarBloqueado(ws, ev.chatId, ev.bloqueado);
      await logEvent({
        workspaceId: ws.id, conversationId: conv.conversationId,
        type: "state_change", payload: { blocked: ev.bloqueado },
      });
      return;
    }

    // El motor de decisión: 0 tokens, antes de gastar nada. Ver runtime/decide.ts
    const decision = decide(
      {
        command: ev.command,
        callbackData: ev.kind === "callback" ? ev.callbackData : undefined,
        text: ev.kind === "callback" ? undefined : ev.text,
      },
      { isBlocked: conv.isBlocked, aiEnabled: conv.aiEnabled, state: conv.state },
    );

    // El invariante: en los estados que no son ai_active (menos el turno de
    // transición que cada handler de handoff gestiona por su cuenta), la IA
    // no genera nada. Ni comandos, ni botones, ni texto libre.
    if (decision.kind === "abstain") {
      // human_active y handoff_pending (spec 13): el paciente SIGUE
      // escribiendo, solo que ya no le contesta la IA — eso le llega al
      // grupo, para que quien la tomó (o esté a punto de tomarla) lo vea.
      if (decision.reason === "human_active" && ev.kind !== "callback" && ev.text?.trim()) {
        await relayPacienteAGrupo(ws, conv, ev.text).catch((e) =>
          logEvent({
            workspaceId: ws.id, conversationId: conv.conversationId,
            type: "ingress_error", level: "error",
            payload: { message: e instanceof Error ? e.message : String(e) },
          }).catch(() => {}),
        );
      }
      return;
    }

    if (decision.kind === "deterministic") {
      if (ev.kind === "callback") return await handleCallback(ws, conv, ev);
      switch (decision.handler) {
        case "start":    return await handleStart(ws, conv, ev);
        case "ayuda":
        case "help":     return await handleAyuda(ws, conv, ev);
        case "humano":   return await handleHumano(ws, conv, ev);
        case "urgencia": return await handleUrgencia(ws, conv, ev);
        default:         return; // comando desconocido: se ignora en silencio
      }
    }

    // decision.kind === "run_agent": solo llega texto libre.
    if (!ev.text?.trim()) return; // foto o sticker sin texto, por ahora

    if (!messageId) {
      // No debería pasar: isNew=true siempre trae id. Defensivo nada más.
      await logEvent({
        workspaceId: ws.id, conversationId: conv.conversationId,
        type: "ingress_error", level: "error",
        payload: { motivo: "mensaje sin id tras insertarlo" },
      });
      return;
    }

    // Texto libre → el buffer, no directo al agente. Agrupa por silencio
    // (spec 06); el agente se llama al cerrar el lote, con todo consolidado.
    await appendToBuffer(ws, conv, messageId, ev.chatId);
  } catch (e) {
    if (e instanceof TelegramError && e.esBloqueo) {
      await marcarBloqueado(ws, ev.chatId, true);
      return;
    }
    // Sin token de bot no se puede responder, pero el ingreso ya funcionó:
    // se registra y se sigue, en vez de tumbar el proceso.
    if (e instanceof EnvFaltante) {
      await logEvent({
        workspaceId: ws.id, conversationId: conv.conversationId,
        type: "send_error", level: "warn", payload: { motivo: e.message },
      });
      return;
    }
    throw e;
  }
}
