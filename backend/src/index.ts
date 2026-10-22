import Fastify from "fastify";
import { DateTime } from "luxon";
import { env } from "./config/env.js";
import { closeDb, dbOk } from "./db/client.js";

const app = Fastify({
  logger: { level: env.LOG_LEVEL },
  // Telegram manda el update en el body; el ACK va antes de procesarlo (spec 03)
  bodyLimit: 1_048_576,
});

/**
 * Healthcheck de Railway. Verifica la base DE VERDAD, no devuelve true fijo:
 * un /health que miente es peor que no tenerlo.
 */
app.get("/health", async (_req, reply) => {
  const db = await dbOk();
  return reply.code(db ? 200 : 503).send({
    ok: db,
    db,
    ts: DateTime.now().setZone(env.TZ).toISO(),
    workspace: env.WORKSPACE_SLUG,
  });
});

async function main() {
  try {
    // Railway inyecta PORT. 0.0.0.0 o el contenedor no recibe tráfico.
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    app.log.info(`${signal} recibido, cerrando`);
    await app.close();
    await closeDb();
    process.exit(0);
  });
}

void main();
