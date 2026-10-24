import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { tieneEnv, requireEnv } from "../config/env.js";
import { processBatchFromCron } from "../runtime/buffer.js";
import { tickReminders } from "../reminders/send.js";
import { revisarCacheHitDiario } from "../obs/alerts.js";

/**
 * Endpoints que solo llama `pg_cron` vía `pg_net`, nunca el público.
 *
 * El `buffer-sweeper` de la migración 002 llama aquí cuando encuentra un
 * lote vencido que nadie procesó — la red de seguridad del buffer híbrido.
 */
function timingSafeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function registrarInternal(app: FastifyInstance): void {
  app.post<{ Body: { batchId?: string } }>("/internal/batch/process", (req, reply) => {
    if (!tieneEnv("INTERNAL_SECRET")) {
      req.log.error("INTERNAL_SECRET no configurado: el endpoint interno está deshabilitado");
      return reply.code(503).send();
    }
    const secret = requireEnv("INTERNAL_SECRET", "el endpoint interno de batches");

    const header = req.headers["x-internal-secret"];
    if (typeof header !== "string" || !timingSafeEq(header, secret)) {
      return reply.code(401).send();
    }

    // Mismo patrón que el webhook de Telegram: ACK rápido, trabajo después.
    // pg_net tiene un timeout_milliseconds := 3000 en la migración 002.
    reply.code(200).send({ ok: true });

    const { batchId } = req.body ?? {};
    if (!batchId) return;

    void processBatchFromCron(batchId).catch((e) =>
      req.log.error({ batchId, err: e }, "fallo procesando batch desde el cron"),
    );
  });

  // El `reminders-tick` de la migración 003 llama aquí cada minuto, pero
  // SOLO si `where exists (... send_at <= now())` encontró algo vencido.
  app.post("/internal/reminders/tick", (req, reply) => {
    if (!tieneEnv("INTERNAL_SECRET")) {
      req.log.error("INTERNAL_SECRET no configurado: el endpoint interno está deshabilitado");
      return reply.code(503).send();
    }
    const secret = requireEnv("INTERNAL_SECRET", "el endpoint interno de recordatorios");

    const header = req.headers["x-internal-secret"];
    if (typeof header !== "string" || !timingSafeEq(header, secret)) {
      return reply.code(401).send();
    }

    reply.code(200).send({ ok: true });

    void tickReminders()
      .then((n) => { if (n > 0) req.log.info({ n }, "recordatorios enviados"); })
      .catch((e) => req.log.error({ err: e }, "fallo enviando recordatorios"));

    // Barato (una fila en runtime_config) y ya estamos despiertos cada
    // minuto para los recordatorios: aprovechar el tick para la alerta de
    // cache hit diario < 40%, en vez de un cron aparte.
    void revisarCacheHitDiario().catch((e) =>
      req.log.error({ err: e }, "fallo revisando el cache hit diario"),
    );
  });
}
