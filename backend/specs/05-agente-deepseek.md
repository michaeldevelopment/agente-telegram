# Spec 05 · Agente DeepSeek sin tools 🚩

**Depende de:** 04 · **Entorno:** local + Railway 🚩 · **~55 min**

## Qué construye

El bot conversa de verdad. Responde con DeepSeek usando el prompt estático de la clínica, mantiene el historial, y registra cada llamada con sus tokens y su costo.

Sin tools todavía: no puede agendar ni consultar la agenda. Solo hablar.

> ## 🚩 Esta spec tiene una puerta
>
> **Si `cacheHit` es 0 en el segundo turno, no avances.** Hay un dato volátil infiltrado en el prefijo del prompt. Arreglarlo aquí cuesta minutos; con tools, buffer y handoff encima, cuesta horas. El multiplicador si se escapa es **10× en costo**, y no falla nada visiblemente.

## Archivos

| Archivo | | Qué va dentro |
|---|---|---|
| `src/llm/deepseek.ts` | nuevo | Cliente (SDK de OpenAI con `baseURL` de DeepSeek), `callWithRetry` |
| `src/llm/messages.ts` | nuevo | `buildMessages()` y `volatileBlock()` |
| `src/llm/cost.ts` | nuevo | Cálculo del costo desde los tokens |
| `src/agent/run.ts` | nuevo | Un turno: cargar contexto, llamar, sanear, encolar |
| `src/obs/events.ts` | nuevo | `logEvent()` genérico |
| `src/ingress/webhook.ts` | editado | El texto libre ya va al agente |

## Configuración, sin margen

```ts
export const MODEL = "deepseek-flash";   // DeepSeek-V4.1-Flash

const res = await deepseek.chat.completions.create({
  model: MODEL,
  messages,
  reasoning_effort: "none",     // 👈 NO NEGOCIABLE
  temperature: 0.3,
  max_tokens: 400,
});
```

**El thinking mode viene encendido de fábrica con esfuerzo `high`.** Esos tokens se cobran a precio de *output* y en un turno de chat pueden ser 5–10× más largos que la respuesta — para contestar "claro, ¿qué día te queda mejor?". Son **17× en costo** y 5–20 s de latencia.

`deepseek-chat` y `deepseek-reasoner` están **retirados** desde el 24-jul-2026.

## El orden de los mensajes es dinero

```ts
[
  { role: "system", content: ctx.staticSystemPrompt },   // CACHEADO, byte a byte igual
  ...(ctx.summary ? [{ role: "system", content: resumen }] : []),
  ...ctx.recentHistory,                                   // append-only
  { role: "system", content: ctx.volatileBlock },         // 👈 VOLÁTIL AL FINAL
  { role: "user",   content: ctx.turnText },
]
```

El bloque volátil son ~80 tokens y cambia en cada petición: fecha, hora, nombre del paciente, teléfono. **Abajo es barato; arriba invalida todo lo que viene después.**

El match de cache se evalúa **desde el token 0**. Un `{{now}}` dentro del system prompt y no hay hit nunca.

## Reintentos

```ts
if (s === 400 || s === 401 || s === 422) throw e;   // culpa nuestra, no reintentar
if (s === 402) { await alertAdmin("DeepSeek sin saldo"); throw e; }
await sleep(400 * 2 ** i + Math.random() * 200);     // 429, 5xx, timeout
```

**`402` ≠ `429`.** El primero es saldo agotado y no se arregla reintentando.

Si los tres intentos fallan: mensaje de cortesía al paciente, estado a `handoff_pending`, aviso. **Nunca silencio.**

## El evento `llm_call`

**DeepSeek no devuelve `usage.cost`** (a diferencia de OpenRouter). Se calcula de los tokens, con tarifa off-peak:

```
cache hit  $0.003 / M     cache miss  $0.15 / M     output  $0.60 / M
```

```json
{ "model":"deepseek-flash", "steps":1, "cacheHit":1480, "cacheMiss":210,
  "outTokens":95, "costUsd":0.0000897, "latencyMs":1840 }
```

> El horario de la clínica (8–18 Bogotá = 13–23 UTC) cae **íntegramente en off-peak**. Tarifa reducida sin hacer nada.

## Terminada cuando

- [ ] Conversación coherente de **4 o 5 turnos**, con el bot recordando lo anterior
- [ ] El bot responde en 2–4 líneas, sin markdown, sin emojis decorativos
- [ ] 🚩 **`cacheHit > 0` en el segundo turno**
      ```sql
      select payload->>'cacheHit' as hit, payload->>'cacheMiss' as miss
        from events where type='llm_call' order by created_at desc limit 3;
      ```
      Si el segundo turno da `hit = 0`: **para y busca el volátil.**
- [ ] El ratio tras 5 turnos supera el **60%**
- [ ] `costUsd` sale poblado y con sentido (céntimos de céntimo por turno)
- [ ] Preguntar por un precio → responde **"desde"** y menciona la valoración gratuita
- [ ] Preguntar algo que no está cargado → **dice que no lo tiene** y ofrece conectar con la clínica, en vez de inventar
- [ ] Un `402` simulado **no se reintenta** y avisa
- [ ] 🚩 **Desplegado en Railway** y el cache verificado también allí
- [ ] `scripts/smoke/05.sh` sale con código 0

## Cómo depurar un cache hit en 0

Por orden de probabilidad:

1. Algo volátil se coló en `staticSystemPrompt` (fecha, nombre, hora).
2. El `rendered` se está regenerando en cada petición en vez de leerse de la base.
3. El historial se reordena o se recorta por el frente entre turnos.
4. El prompt se construye con interpolación que mete espacios variables.

Imprime el prefijo de los dos primeros turnos y haz `diff`. Lo que difiera es el culpable.

## Trampas

- `max_tokens: 400` como techo de seguridad. El default sin thinking es 8K.
- Con thinking encendido, `temperature` se ignora y `tool_choice: "required"` devuelve `400`.
- No metas el historial completo: ventana de **10 mensajes**. El resumen rodante llega en una spec futura; por ahora corta y ya.
- El texto del paciente entra como `role: "user"`, **nunca concatenado al system prompt**.

## Referencias

- Blueprint §4.4 (agente), §5 (economía completa), §13 Fase 1
- `../../knowledge/wiki/Agente-DeepSeek.md`, `../../knowledge/wiki/Cache-de-Prefijo.md`
- `../../knowledge/wiki/Economia-de-Tokens.md`
- `../memoria/thinking-mode-apagado.md`, `../memoria/volatiles-al-final-del-prompt.md`
