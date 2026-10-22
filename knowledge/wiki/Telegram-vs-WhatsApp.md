---
titulo: Telegram vs WhatsApp
tipo: base
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §2"
actualizado: 2026-10-22
tags: [telegram, whatsapp, migracion, canal]
---

# Telegram vs WhatsApp

Tabla de traducción desde el blueprint original de WhatsApp/YCloud. **Lee esto antes de reusar cualquier código de aquel proyecto**: hay piezas enteras que desaparecen y otras que cambian de columna.

## Lo que cambia

| Concepto | WhatsApp / YCloud | Telegram |
|---|---|---|
| **Ventana de 24 h** | Guardrail duro: fuera de ventana solo templates aprobados | **No existe.** El bot escribe cuando quiera a cualquier chat que haya iniciado conversación. Se elimina `window_expires_at`, `evaluateWindow()` y `dispatchOutbound()` |
| **Templates Meta** | Tabla `templates` + estados de aprobación | **No existen.** Se elimina la tabla y el enum `template_status` |
| **Límite real de proactividad** | La ventana de 24 h | El usuario puede **bloquear el bot** → `403 Forbidden: bot was blocked by the user`. Hay que detectarlo y dejar de insistir |
| **Identidad del contacto** | `phone` E.164 normalizado | `chat.id` (**BIGINT**, int64). El teléfono es opcional |
| **Dedupe de entrada** | `wamid` + índice único parcial | `update_id` + índice único `(workspace_id, update_id)`. Mismo patrón, otra columna |
| **Autenticidad del webhook** | HMAC-SHA256 sobre `timestamp.rawBody`, hay que leer el raw body | **Mucho más simple:** `setWebhook(secret_token)` y Telegram manda `X-Telegram-Bot-Api-Secret-Token`. Comparación en tiempo constante |
| **Normalización de entrada** | Zod sobre shapes heterogéneos | Zod sobre `Update`. Shape estable y documentado |
| **Indicador de escritura** | No disponible | `sendChatAction(typing)` — **dura ≤5 s**, re-enviar cada ~4 s |
| **Botones** | `interactive` button/list reply | `InlineKeyboardMarkup` → llega como `callback_query`. **Obligatorio** responder `answerCallbackQuery` |
| **Formato de texto** | Texto plano | `parse_mode: "HTML"`. Hay que **escapar `& < >`** o el envío falla con `400` |
| **Límite de mensaje** | ~4096 chars | **4096 chars exactos** |
| **Rate limit de salida** | Por WABA/número | **30 msg/s global** y ~**1 msg/s por chat**. `429` trae `parameters.retry_after` |
| **Media entrante** | Link firmado de YCloud | `file_id` → `getFile` → URL de descarga. Máx. 20 MB |
| **Proveedor de LLM** | OpenRouter (`usage.cost` en USD) | DeepSeek directo. **No hay `usage.cost`**: el costo se calcula de los tokens. Sí hay `prompt_cache_hit_tokens` |
| **Multi-cliente** | Un número de WhatsApp por workspace | Un **bot** por cliente: token, @usuario, foto y descripción propias. Mejor para demo |

## Lo que SÍ se reusa casi intacto

- El patrón de **dedupe por índice único parcial** en base de datos, no en memoria.
- El **buffer por silencio** con reinicio de timer en cada mensaje. Es el diferenciador y se mantiene. Ver [[Buffer-y-Batching]].
- La **state machine** de conversación, menos los estados ligados a la ventana. Ver [[State-Machine-y-Handoff]].
- La **capa de tools** con interfaz común `{name, description, schema, run}` y validación Zod. Ver [[Capa-de-Tools]].
- El **loop de tool-calling** con techo de iteraciones.
- La tabla **`events`** como columna vertebral de observabilidad. Ver [[Observabilidad]].
- El principio de **auto-blindaje**: las reglas duras se implementan como código determinista, **nunca** como instrucciones al LLM.

## Lo que mejora respecto al original

Dos cosas que el cambio de canal y de proveedor permiten:

1. **Timers reales.** Railway es un proceso persistente, no serverless. El buffer dispara exacto. Ver [[Arquitectura]].
2. **Una llamada al LLM por turno en vez de dos.** El original clasificaba con un modelo barato y respondía con uno caro. Con `deepseek-flash` el modelo de respuesta ya es el barato, así que el clasificador se elimina. Ver [[Motor-de-Decision]].

## Cuándo vuelve WhatsApp

Cuando el cliente valide la demo y quiera producción en WhatsApp. El blueprint original ya cubre YCloud, la ventana de 24 h y los templates. Ver [[Fuera-de-Alcance]].

## Relacionado

- [[Decisiones-Fijas]] — por qué Telegram para la demo
- [[Ingress]] — el webhook concreto
- [[Salida-y-Outbox]] — los límites de salida en la práctica
- [[Gotchas]] — el checklist de Telegram antes de cada deploy
