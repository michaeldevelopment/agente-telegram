import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { env, EnvFaltante } from "../config/env.js";
import { normalize, type Inbound } from "./normalize.js";
import {
  getWorkspace, insertInboundOnConflictDoNothing, logEvent,
  marcarBloqueado, upsertContactoYConversacion, type Workspace,
} from "./persist.js";
import { handleAyuda, handleStart } from "../handlers/start.js";
import { appendToBuffer } from "../runtime/buffer.js";
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

  const conv = await upsertContactoYConversacion(ws, ev);

  // Dedupe en base de datos, no en memoria.
  const { isNew, id: messageId } = await insertInboundOnConflictDoNothing(ws, conv, ev);
  if (!isNew) return;

  await rutear(ws, conv, ev, messageId);
}

async function rutear(
  ws: Workspace,
  conv: Awaited<ReturnType<typeof upsertContactoYConversacion>>,
  ev: Inbound,
  messageId: string | undefined,
): Promise<void> {
  try {
    // El usuario bloqueó el bot (o lo desbloqueó).
    if (ev.kind === "system" && ev.bloqueado !== undefined) {
      await marcarBloqueado(ws, ev.chatId, ev.bloqueado);
      await logEvent({
        workspaceId: ws.id, conversationId: conv.conversationId,
        type: "state_change", payload: { blocked: ev.bloqueado },
      });
      return;
    }

    // Contra un chat bloqueado no se envía nada.
    if (conv.isBlocked) return;

    // Comandos: deterministas, SIN LLM y SIN pasar por el buffer. El motor
    // de decisión formal llega en la spec 07; esto ya cumple la regla 6
    // ("botones, comandos y urgencias saltan el buffer") para comandos.
    switch (ev.command) {
      case "start": return await handleStart(ws, conv, ev);
      case "ayuda":
      case "help":  return await handleAyuda(ws, conv, ev);
    }

    if (ev.kind === "callback") return; // los botones, en la spec 12
    if (!ev.text?.trim()) return;       // foto o sticker sin texto, por ahora

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
