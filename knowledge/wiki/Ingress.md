---
titulo: Ingress
tipo: base
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §4.1"
actualizado: 2026-10-22
tags: [webhook, telegram, runtime, dedupe]
---

# Ingress

La puerta de entrada: `POST /tg/:workspace/:secretPath`. Verifica que el update venga de verdad de Telegram, lo deduplica, lo persiste y responde **antes** de procesarlo.

## Dos capas de autenticidad

El path lleva un segmento aleatorio (nadie lo adivina) y el header lo confirma:

```ts
const header = req.headers["x-telegram-bot-api-secret-token"];
if (typeof header !== "string" || !timingSafeEq(header, ws.webhookSecret)) {
  return reply.code(401).send();   // ni un log con el valor recibido
}
```

La comparación es en **tiempo constante** (`crypto.timingSafeEqual`). Y el `401` no registra el valor recibido: loguear un secreto fallido es regalar información.

## ACK inmediato

```ts
reply.code(200).send({ ok: true });            // primero el ACK
void handleUpdate(ws, req.body).catch(...)     // después el trabajo
```

Telegram reintenta si no recibe 2XX. Un reintento con el mismo `update_id` es inofensivo porque lo frena el índice único, pero cuesta latencia y duplica trabajo. Objetivo: **< 100 ms**. Ver [[Performance-y-Limites]].

## Registro del webhook

```bash
curl -sX POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H 'content-type: application/json' \
  -d '{
    "url": "https://<app>.up.railway.app/tg/<workspace>/<path-secreto>",
    "secret_token": "<cadena A-Za-z0-9_- de 64 chars>",
    "allowed_updates": ["message","callback_query","my_chat_member"],
    "max_connections": 20,
    "drop_pending_updates": true
  }'
```

- **`allowed_updates` acotado es ahorro puro.** Lo que no pedimos no llega, no se parsea y no se guarda. `my_chat_member` sirve para detectar bloqueos y arranques.
- **`drop_pending_updates: true` al redeployar** evita que una cola vieja de updates desencadene respuestas fuera de contexto.
- Puertos soportados para webhooks: 443, 80, 88, 8443. Railway sirve por 443.
- **Comprobar con `getWebhookInfo`:** un `pending_update_count` alto o un `last_error_message` poblado significan que algo está fallando en silencio.

## Normalización y dedupe

El update de Telegram se aplana a una forma estable antes de tocar nada:

```ts
type Inbound = {
  updateId: number;
  chatId: number;          // BIGINT en DB
  userId: number;
  kind: MsgKind;
  text?: string;           // texto, caption o título del botón
  callbackData?: string;
  messageId: number;
  ts: number;              // date * 1000
  startPayload?: string;   // de "/start <payload>" → atribución de origen
  raw: unknown;
};
```

**El dedupe es en base de datos, no en memoria:** el proceso puede reiniciar y Telegram puede reintentar en paralelo. Lo garantiza `uq_messages_update` sobre `(workspace_id, tg_update_id)`.

```ts
const { isNew } = await insertInboundOnConflictDoNothing(ev);
if (!isNew) return;        // ya procesado
```

## Ruteo del update

| Entrada | Camino |
|---|---|
| `/start`, `/ayuda`, `/humano` | handler de comandos, **sin LLM** |
| `callback_query` (botón) | `answerCallbackQuery` + acción determinista, **sin LLM** si el botón ya codifica la intención |
| texto / voz / foto | al [[Buffer-y-Batching\|buffer]] |
| `my_chat_member` → `kicked` | `contacts.is_blocked = true`, cancelar recordatorios pendientes |

`/start <payload>` guarda el origen en `contacts.source` (`instagram`, `web`, …). Es atribución gratis que el cliente va a querer.

## Gotchas

- **`chat.id` en BIGINT**, nunca `int`.
- El `secret_token` debe ser `[A-Za-z0-9_-]`, 1–256 chars. 64 es un buen tamaño.
- No hace falta leer el **raw body** (a diferencia de WhatsApp con su HMAC). Ver [[Telegram-vs-WhatsApp]].
- Si cambias el `secretPath`, hay que re-llamar a `setWebhook`. El path viejo empieza a devolver `404`.

## Relacionado

- [[Arquitectura]] — dónde encaja el ingress
- [[Buffer-y-Batching]] — a dónde va el mensaje después
- [[Motor-de-Decision]] — la capa que decide si se gasta el modelo
- [[Seguridad]] — superficie del webhook
- [[Gotchas]] — checklist de Telegram
