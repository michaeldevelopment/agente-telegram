---
titulo: Salida y outbox
tipo: base
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §4.6"
actualizado: 2026-10-22
tags: [egress, telegram, rate-limit, outbox, botones]
---

# Salida y outbox

**Toda** salida pasa por `outbound_queue`. Nada llama a `sendMessage` directo. Eso da rate limiting, reintentos, auditoría y la posibilidad de cancelar un envío programado.

```ts
const PER_CHAT_MIN_GAP_MS = 1100;   // ~1 msg/s por chat
const GLOBAL_MAX_PER_SEC   = 25;    // margen bajo el límite de 30/s
```

## Manejo de errores de Telegram

Cada código tiene una respuesta distinta, y todas pasan en producción:

| Código | Qué significa | Qué hacemos |
|---|---|---|
| `429` | Flood control | Respetar `parameters.retry_after` **sin excepción**, +1 s de margen |
| `403 blocked/deactivated` | El usuario bloqueó el bot | `contacts.is_blocked = true`, cancelar recordatorios pendientes, `skipped`. **Dejar de insistir** |
| `400 can't parse entities` | El texto rompió el HTML | Reintentar sin `parse_mode` |
| `400 message is too long` | Pasó de 4096 | Trocear y reencolar |
| otros, `attempts >= 5` | — | `failed` |
| otros | — | Backoff exponencial `2 ** attempts` |

El `403` es el único límite real de proactividad en Telegram, ya que no hay ventana de 24 h. Ver [[Telegram-vs-WhatsApp]].

## Reglas de salida

- **4096 chars** máximo por mensaje. Cortar **por párrafo**, nunca a mitad de palabra.
- **`parse_mode: "HTML"`** con el texto del modelo **escapado** (`&` `<` `>`). Sin escapar, un `<` suelto tumba el envío con `400`. El fallback a texto plano no es paranoia, es una ruta que se usa.
- **`sendChatAction("typing")`** antes de generar, re-enviado **cada 4 s** mientras el modelo trabaja: el indicador dura ≤5 s.
- **Respuesta en 1 o 2 mensajes, nunca más.** Trocear en seis burbujas no es "humano", es ruido.

## Botones inline — la pieza que ahorra dinero

Las opciones de horario se mandan como botones, no como texto:

```ts
reply_markup: { inline_keyboard: slots.map(s => [{
  text: formatSlot(s, ws.timezone),                  // "jue 29 oct · 10:30 a. m."
  callback_data: `bk:${service.slug}:${s.epochMin}`, // ≤64 bytes, obligatorio
}]) }
```

Tres ventajas, en orden de importancia:

1. **El `callback_data` codifica la intención**, así que la confirmación la resuelve el [[Motor-de-Decision|motor de decisión]] sin gastar una llamada al LLM. En una conversación de agendamiento, los botones absorben el 100% de las confirmaciones.
2. Cero ambigüedad al parsear. No hay que interpretar "el segundo" ni "el del jueves".
3. Menos fricción para el paciente.

> **`callback_data` tiene un límite duro de 64 bytes.** Nunca metas un uuid completo ahí. Usa slugs cortos y minutos-epoch, o guarda el payload en una tabla y manda su id corto.

Y **siempre** hay que responder `answerCallbackQuery`, o el botón se queda girando en el cliente del paciente.

## Horas de silencio

Los proactivos (recordatorios) respetan `quiet_from` / `quiet_to` del workspace (21:00–08:00 por defecto, hora local). Un recordatorio que caiga en esa franja se desplaza a las 08:00. Ver [[Recordatorios-Programados]].

Telegram no tiene ventana de 24 h, lo cual **no** significa que todo valga. Dos reglas: respetar las horas de silencio y parar al primer bloqueo.

## Gotchas

- `answerCallbackQuery` **siempre**, incluso si la acción falla.
- `429` con `retry_after`: no reintentar antes. Ignorarlo escala el problema.
- `403` creciente es una señal de producto, no de infraestructura: los pacientes están bloqueando el bot porque los proactivos molestan. Es un KPI en [[Observabilidad]].
- En grupos (el de handoff) el límite es ~20 mensajes/minuto, no 1/segundo.

## Relacionado

- [[Arquitectura]] — etapa 6 del flujo
- [[Agente-DeepSeek]] — de dónde viene el texto
- [[Recordatorios-Programados]] — el otro productor del outbox
- [[State-Machine-y-Handoff]] — el relay con el grupo interno
- [[Performance-y-Limites]] — los números de Telegram
- [[Gotchas]] — checklist antes de deploy
