import { randomBytes } from "node:crypto";
import { env, requireEnv } from "../src/config/env.js";
import { closeDb, sql } from "../src/db/client.js";
import { invalidarCacheWorkspace } from "../src/ingress/persist.js";
import { getMe, getWebhookInfo, setWebhook } from "../src/telegram/api.js";

/**
 * Registra el webhook en Telegram y guarda secreto y path en el workspace.
 *
 *   npm run webhook:gen                      imprime valores nuevos para el .env
 *   npm run webhook -- https://xxx.ngrok.app registra contra esa URL base
 *   npm run webhook:info                     qué tiene Telegram configurado ahora
 *
 * Telegram solo acepta los puertos 443, 80, 88 y 8443, así que en local hace
 * falta un túnel HTTPS. Y el túnel cambia de URL al reiniciarlo: hay que
 * volver a correr esto.
 */

const modo = process.argv[2] ?? "";

function aleatorio(n: number): string {
  return randomBytes(n * 2).toString("base64url").slice(0, n);
}

async function generar() {
  console.log("Pega esto en tu .env:\n");
  console.log(`TELEGRAM_WEBHOOK_SECRET=${aleatorio(64)}`);
  console.log(`TELEGRAM_WEBHOOK_PATH=${aleatorio(32)}`);
  console.log("\nDespués: npm run webhook -- https://<tu-tunel>");
}

async function info() {
  const i = await getWebhookInfo();
  console.log(`url:                  ${i.url || "(sin webhook)"}`);
  console.log(`pending_update_count: ${i.pending_update_count}`);
  console.log(`max_connections:      ${i.max_connections ?? "-"}`);
  console.log(`allowed_updates:      ${(i.allowed_updates ?? []).join(", ") || "(todos)"}`);
  if (i.last_error_message) {
    console.log(`\n⚠ último error: ${i.last_error_message}`);
    if (i.last_error_date) console.log(`  el ${new Date(i.last_error_date * 1000).toISOString()}`);
  } else {
    console.log(`\n✓ sin errores`);
  }
  if (i.pending_update_count > 0) {
    console.log(`⚠ hay ${i.pending_update_count} updates en cola: algo está fallando`);
  }
}

async function registrar(base: string) {
  const secret = requireEnv("TELEGRAM_WEBHOOK_SECRET", "el registro del webhook");
  const path = requireEnv("TELEGRAM_WEBHOOK_PATH", "el registro del webhook");

  if (!/^https:\/\//.test(base)) throw new Error(`la URL base debe ser https: ${base}`);
  if (secret.length < 16) throw new Error("TELEGRAM_WEBHOOK_SECRET demasiado corto (usa 64)");
  if (!/^[A-Za-z0-9_-]+$/.test(secret)) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET solo admite [A-Za-z0-9_-]");
  }

  const me = await getMe();
  const url = `${base.replace(/\/+$/, "")}/tg/${env.WORKSPACE_SLUG}/${path}`;

  await setWebhook({
    url,
    secret_token: secret,
    // Acotado = ahorro puro: lo que no pedimos no llega, no se parsea, no se guarda.
    allowed_updates: ["message", "callback_query", "my_chat_member"],
    max_connections: 20,
    // Evita que una cola vieja dispare respuestas fuera de contexto.
    drop_pending_updates: true,
  });

  // El workspace es la fuente de verdad desde el segundo cliente.
  const res = await sql`
    update workspaces
       set webhook_secret = ${secret}, webhook_path = ${path},
           bot_username = ${me.username ?? null}, updated_at = now()
     where slug = ${env.WORKSPACE_SLUG}
     returning id`;
  if (res.length === 0) {
    throw new Error(`no existe el workspace ${env.WORKSPACE_SLUG}. ¿Corriste npm run seed?`);
  }
  invalidarCacheWorkspace(env.WORKSPACE_SLUG);

  console.log(`✓ webhook registrado para @${me.username ?? me.first_name}`);
  console.log(`  ${url.replace(path, path.slice(0, 6) + "…")}`);
  console.log(`✓ secreto y path guardados en el workspace\n`);
  await info();
}

async function main() {
  if (modo === "--generate" || modo === "gen") return generar();
  if (modo === "--info" || modo === "info") return info();
  if (!modo) {
    throw new Error(
      "falta la URL base.\n" +
        "  npm run webhook -- https://<tu-tunel>\n" +
        "  npm run webhook:gen    (genera secreto y path)\n" +
        "  npm run webhook:info   (qué hay configurado)",
    );
  }
  return registrar(modo);
}

main()
  .catch((e) => {
    console.error(`\n✖ ${e instanceof Error ? e.message : e}\n`);
    process.exitCode = 1;
  })
  .finally(closeDb);
