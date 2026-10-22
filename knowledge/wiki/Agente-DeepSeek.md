---
titulo: Agente DeepSeek
tipo: base
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §4.4"
actualizado: 2026-10-22
tags: [deepseek, llm, tool-calling, cache, tokens]
---

# Agente DeepSeek

El modelo, su configuración, el armado de mensajes y el loop de tool-calling. Es donde se gasta el dinero, así que cada decisión de aquí tiene una justificación de costo.

## Configuración del modelo

```ts
import OpenAI from "openai";   // DeepSeek es OpenAI-compatible

export const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY!,
  baseURL: "https://api.deepseek.com",
});

export const MODEL = "deepseek-flash";   // DeepSeek-V4.1-Flash
```

> ⚠️ **`deepseek-chat` y `deepseek-reasoner` se retiraron el 24-jul-2026.** No usarlos. El modelo vigente es `deepseek-flash`. `deepseek-v4-pro` existe pero es más caro y más lento, y desde el 14-sep-2026 sus peticiones se enrutan igualmente a V4.1-Flash.

`deepseek-flash` trae 1M de contexto, 384K de salida máxima, tool calling, JSON output y visión nativa. Para un agente conversacional es la elección correcta.

## Apagar el thinking mode — la regla más cara de olvidar

> ⚠️ **El thinking mode viene ACTIVADO por defecto, con esfuerzo `high`.**

Si no se desactiva, cada turno genera tokens de razonamiento que se cobran **a precio de output** ($0.60–1.20/M) y añaden segundos de latencia, para contestar *"claro, ¿qué día te queda mejor?"*. En un turno de chat el pensamiento puede ser 5–10× más largo que la respuesta.

```ts
const res = await deepseek.chat.completions.create({
  model: MODEL,
  messages,
  tools,
  tool_choice: "auto",
  reasoning_effort: "none",     // 👈 apaga el thinking. NO NEGOCIABLE aquí
  temperature: 0.3,
  max_tokens: 400,              // una respuesta de chat, no un ensayo
});
```

Detalles del parámetro:

- `reasoning_effort: "none"` apaga el pensamiento; `low | high | max` lo encienden. Equivale a `thinking: {type: "disabled"}`.
- Con thinking **encendido**, `temperature` **no tiene efecto** y `tool_choice: "required"` o con nombre devuelven **400**. Otra razón para apagarlo.
- Con thinking apagado, `top_p` queda fijo en 1.0 y `temperature` sí funciona (0–2).
- `max_tokens` por defecto es 8K sin thinking. Bajarlo a 400 es un tope de seguridad contra respuestas desbocadas, que en Telegram además se cortarían a 4096 chars.

**Impacto: 17× en el costo total.** Ver [[Economia-de-Tokens]], regla 1.

## Fallback sin gateway

Sin OpenRouter, el fallback se escribe a mano. Reintento con backoff para lo transitorio, y nada de reintentar lo que es culpa nuestra:

```ts
if (s === 400 || s === 401 || s === 422) throw e;      // error nuestro, no reintentar
if (s === 402) { await alertAdmin("DeepSeek sin saldo"); throw e; }
await sleep(400 * 2 ** i + Math.random() * 200);        // 429, 5xx, timeout
```

**`402` ≠ `429`.** El primero es saldo agotado y no se arregla reintentando: se avisa al grupo interno y se escala.

Si los tres intentos fallan: mensaje de cortesía al paciente (*"estoy teniendo un problema técnico, un asesor te escribe en breve"*), estado a `handoff_pending`, aviso al grupo. **Nunca silencio.**

## Armado de mensajes — crítico para el cache

El orden importa más que el contenido:

```ts
function buildMessages(ctx: TurnContext): ChatMessage[] {
  return [
    // ── BLOQUE ESTÁTICO: idéntico byte a byte en TODAS las peticiones del workspace
    { role: "system", content: ctx.staticSystemPrompt },

    // ── Resumen de lo viejo (cambia cada ~10 mensajes, no cada turno)
    ...(ctx.summary ? [{ role: "system", content: `Resumen previo:\n${ctx.summary}` }] : []),

    // ── Historial reciente, APPEND-ONLY y cronológico
    ...ctx.recentHistory,

    // ── BLOQUE VOLÁTIL AL FINAL: fecha/hora, datos del paciente, disponibilidad
    { role: "system", content: ctx.volatileBlock },

    // ── El turno consolidado del paciente
    { role: "user", content: ctx.turnText },
  ];
}
```

El bloque volátil son ~80 tokens y cambia en cada petición. Por eso va **último**: ahí abajo no rompe el prefijo cacheado de arriba.

```ts
function volatileBlock(ws: Workspace, c: Contact): string {
  const now = DateTime.now().setZone(ws.timezone);
  return [
    `Ahora: ${now.toFormat("cccc d 'de' LLLL yyyy, HH:mm")} (${ws.timezone}).`,
    `Hoy es ${now.toFormat("yyyy-MM-dd")}. Mañana es ${now.plus({days:1}).toFormat("yyyy-MM-dd")}.`,
    c.fullName ? `Paciente: ${c.fullName}.` : `Aún no sabes el nombre del paciente.`,
    c.phone ? `Teléfono en archivo: ${c.phone}.` : `No tienes su teléfono.`,
  ].join("\n");
}
```

> **La trampa del blueprint original.** Su `injectVariables()` mete `{{now}}`, `{{contact.name}}` y `{{business.hours}}` **dentro** del system prompt. Con modelos sin cache de prefijo era inofensivo. Con DeepSeek es el error más caro posible: `{{now}}` cambia en cada petición, el prefijo nunca coincide desde el token 0, y **el 100% del prompt se cobra como cache miss** — 50 veces más caro. Ver [[Cache-de-Prefijo]].

## Loop de tool-calling

```ts
const MAX_STEPS = 4;   // techo anti-loop
```

Por cada iteración: llamar, acumular `usage`, y si hay `tool_calls`, ejecutarlas y reinyectar los resultados. Si se agota el techo sin respuesta de texto, **no se insiste: se escala**.

Gotchas del loop, idénticos a los de OpenAI porque el formato es el mismo:

- `tool_calls[].function.arguments` es un **string JSON** → `JSON.parse()`.
- **Siempre** re-anexar el mensaje `assistant` con sus `tool_calls` *antes* de los resultados. Omitirlo rompe el contexto y el modelo repite la llamada.
- Un mensaje `{role:"tool", tool_call_id, content}` **por cada** call, con su id correcto.
- **Validar los argumentos con Zod antes de ejecutar.** El LLM alucina fechas, ids y enums. Un error devuelto como `ToolResult` hace que se corrija solo en el siguiente paso, y es mucho más barato que una excepción.

El `usage` acumulado (`prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`, `completion_tokens`) va a `events` como `llm_call`. **No hay `usage.cost`**: el costo se calcula en nuestro lado. Ver [[Observabilidad]].

## Guardrails de salida

Antes de encolar, el borrador pasa por `sanitize()`:

- Quita bloques de código y markdown que el modelo mete por costumbre (`**`, `#`).
- `redactSecrets()` — nunca ids internos, uuids, urls de API.
- Corta a ~900 chars por palabra completa.
- Escapa `& < >` y trocea a 4096 para Telegram.

Encima de eso corre el **filtro clínico**, que es el que convierte una regla de prompt en una garantía. Ver [[Guardrails-Clinicos]].

## Relacionado

- [[Cache-de-Prefijo]] — por qué el orden de los mensajes es dinero
- [[Economia-de-Tokens]] — las ocho reglas completas
- [[Capa-de-Tools]] — qué puede llamar el modelo
- [[Motor-de-Decision]] — cuándo se llega hasta aquí
- [[Salida-y-Outbox]] — qué pasa con el texto después
- [[Gotchas]] — checklist de DeepSeek
