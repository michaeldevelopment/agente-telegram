# Spec 03 · Webhook, dedupe y `/start`

**Depende de:** 02 · **Entorno:** local (con túnel) · **~50 min**

## Qué construye

El bot empieza a existir. Recibe updates de Telegram, verifica que vienen de verdad de Telegram, los deduplica, los persiste, y responde a `/start`.

Es el criterio de aceptación de la Fase 0 del blueprint.

## Archivos

| Archivo | | Qué va dentro |
|---|---|---|
| `src/telegram/api.ts` | nuevo | Cliente del Bot API: `sendMessage`, `getFile`, `answerCallbackQuery`, errores tipados |
| `src/ingress/normalize.ts` | nuevo | `Update` de Telegram → tipo `Inbound` plano, validado con Zod |
| `src/ingress/webhook.ts` | nuevo | La ruta, la verificación, el ACK, el ruteo |
| `src/ingress/persist.ts` | nuevo | Upsert de `contacts`/`conversations`, insert de `messages` con dedupe |
| `src/handlers/start.ts` | nuevo | Respuesta a `/start`, sin LLM |
| `scripts/set-webhook.ts` | nuevo | `setWebhook` con los parámetros correctos |
| `src/index.ts` | editado | Registra la ruta |

## Dos capas de autenticidad

El path lleva un segmento aleatorio que nadie adivina, y el header lo confirma:

```ts
const header = req.headers["x-telegram-bot-api-secret-token"];
if (typeof header !== "string" || !timingSafeEq(header, ws.webhookSecret)) {
  return reply.code(401).send();   // sin loguear el valor recibido
}
```

**Comparación en tiempo constante** con `crypto.timingSafeEqual`. Y el `401` **no registra el valor recibido**: loguear un secreto fallido es regalar información.

## ACK primero, trabajo después

```ts
reply.code(200).send({ ok: true });            // primero
void handleUpdate(ws, req.body).catch(...)     // después
```

Objetivo: **< 100 ms**. Telegram reintenta si no recibe 2XX, y aunque el reintento es inofensivo (lo frena el índice único), cuesta latencia.

## El dedupe va en la base, no en memoria

El proceso puede reiniciar y Telegram puede reintentar en paralelo. Lo garantiza `uq_messages_update`:

```ts
const { isNew } = await insertInboundOnConflictDoNothing(ev);
if (!isNew) return;
```

## Registro del webhook

```bash
curl -sX POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H 'content-type: application/json' \
  -d '{
    "url": "https://<tunel>/tg/clinica-gonzalez/<path-secreto>",
    "secret_token": "<64 chars A-Za-z0-9_->",
    "allowed_updates": ["message","callback_query","my_chat_member"],
    "max_connections": 20,
    "drop_pending_updates": true
  }'
```

`allowed_updates` acotado es ahorro puro: lo que no pedimos no llega, no se parsea y no se guarda.

Para local necesitas un túnel HTTPS. Telegram solo acepta los puertos **443, 80, 88, 8443**.

## Ruteo

| Entrada | Camino |
|---|---|
| `/start` | handler, **sin LLM** |
| `my_chat_member` → `kicked` | `contacts.is_blocked = true` |
| cualquier otra cosa | por ahora, solo persistir |

`/start <payload>` guarda el origen en `contacts.source` (`instagram`, `web`…). Es atribución gratis que el cliente va a querer.

## Terminada cuando

- [ ] **`/start` responde** con el nombre de la clínica, sin sonar a robot
- [ ] El update queda persistido
      ```sql
      select direction, kind, body from messages order by created_at desc limit 1;
      ```
- [ ] **Dedupe**: reenvía el mismo `update_id` con curl directo al webhook
      ```
      $ curl -X POST localhost:3000/tg/... -d @update.json   # dos veces
      $ psql -c "select count(*) from messages where tg_update_id = 12345"
      1
      ```
- [ ] **Secret inválido → `401`**, y el log **no contiene** el valor recibido
- [ ] Path inexistente → `404`
- [ ] El ACK tarda **< 100 ms** (mídelo: `curl -w '%{time_total}'`)
- [ ] `getWebhookInfo` sin `last_error_message` y con `pending_update_count` en 0
- [ ] Se creó un `contacts` y una `conversations` para el chat
- [ ] `scripts/smoke/03.sh` sale con código 0

## Trampas

- **`chat.id` en `BIGINT`.** Es el bug más fácil de cometer y el más difícil de ver en desarrollo.
- A diferencia de WhatsApp, **no hace falta leer el raw body**: Telegram usa un header, no un HMAC sobre el cuerpo.
- Si cambias el `secretPath`, hay que re-llamar a `setWebhook`. El path viejo devuelve `404`.
- `drop_pending_updates: true` al redeployar, o una cola vieja dispara respuestas fuera de contexto.
- El túnel cambia de URL cada vez que lo reinicias: re-registrar el webhook.

## Referencias

- Blueprint §4.1 (ingress), §2 (qué cambia respecto a WhatsApp), §13 Fase 0
- `../../knowledge/wiki/Ingress.md`, `../../knowledge/wiki/Telegram-vs-WhatsApp.md`
- `../../knowledge/wiki/Seguridad.md`
- `../memoria/bot-con-telefono-personal.md`
