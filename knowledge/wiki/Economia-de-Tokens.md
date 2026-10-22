---
titulo: Economía de tokens
tipo: base
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §5"
actualizado: 2026-10-22
tags: [tokens, costo, deepseek, cache, optimizacion]
---

# Economía de tokens

La sección que decide si esto cuesta **$1 o $50 al mes**. Ocho reglas, ordenadas de mayor a menor impacto. Las tres primeras valen 82× juntas.

## Las ocho reglas

### Regla 1 — Apagar el thinking mode · **60–80% del gasto**

`deepseek-flash` piensa por defecto con esfuerzo `high`. Esos tokens se cobran a **precio de output**, el más caro de los tres. En un turno de chat el pensamiento puede ser 5–10× más largo que la respuesta.

`reasoning_effort: "none"`, siempre. Ver [[Agente-DeepSeek]].

### Regla 2 — Disciplina de prefijo para el cache · **hasta 10×**

Un hit cuesta 50× menos que un miss. El system prompt congelado, los datos volátiles al final, las tools en orden fijo, el historial append-only. Tiene página propia: [[Cache-de-Prefijo]].

### Regla 3 — Batching · **~2.2×**

Cuatro mensajes consolidados en un turno = una llamada en vez de cuatro, y cada llamada evitada se ahorra **con todo su historial incluido**. Es la segunda palanca más grande después del thinking mode. Ver [[Buffer-y-Batching]].

### Regla 4 — Reglas duras antes del modelo

Comandos, botones, confirmaciones de recordatorio, urgencias y conversaciones en manos de un humano se resuelven con **0 tokens**.

En una demo de agendamiento, los botones de horario absorben el **100% de las confirmaciones** — justo el momento donde un bot mal hecho gastaría dos o tres turnos de ida y vuelta. Ver [[Motor-de-Decision]].

### Regla 5 — Ventana deslizante + resumen rodante

```
historial efectivo = resumen(todo lo anterior) + últimos 10 mensajes verbatim
```

El resumen se regenera cada 10 mensajes nuevos, en **una** llamada barata (`max_tokens: 150`, sin tools), y se guarda en `conversations.summary`.

Sin esto, una conversación de 40 mensajes manda ~6.000 tokens de prompt por turno; con esto se estabiliza en ~1.800.

### Regla 6 — Output corto por diseño

El output es 4–200× más caro que el input según cache. `max_tokens: 400` como techo, y la instrucción de brevedad en el prompt (*"2 a 4 líneas, esto es un chat"*).

Es simultáneamente más barato y mejor UX: nadie quiere tres párrafos de un bot de citas.

### Regla 7 — Prompt estático en lugar de RAG

El catálogo completo de la clínica (12 servicios con precios, horarios, sedes, FAQs) son **~700 tokens**. En el prompt estático, con cache, cuestan **$0.0000021 por turno**.

Vía RAG costarían una llamada de embedding, una query a pgvector, latencia, y la posibilidad de recuperar el chunk equivocado.

> **Umbral de decisión: por debajo de ~3.000 tokens de contenido estable, va en el prompt. Por encima, RAG.**

La clínica está muy por debajo, así que pgvector queda [[Fuera-de-Alcance|fuera de alcance]].

### Regla 8 — Aprovechar el off-peak · **gratis en este caso**

Peak = 01:00–04:00 y 06:00–10:00 **UTC**, L–V → en Bogotá: 20:00–23:00 y 01:00–05:00 locales.

El horario de atención de la clínica (8:00–18:00 Bogotá) cae **íntegramente en off-peak**. Tarifa reducida sin hacer nada.

## Costo real por conversación

Conversación completa de agendamiento: 15 turnos, 22 mensajes del paciente, 10 llamadas al LLM gracias al batching, 2 tool calls, 1 regeneración de resumen.

| Componente | Tokens | Precio off-peak | Costo |
|---|---|---|---|
| Input cache **hit** (prompt estático + tools + historial visto) | 10 × ~1.500 = 15.000 | $0.003 / M | $0.000045 |
| Input cache **miss** (bloque volátil + turno nuevo + resultados de tools) | 10 × ~450 = 4.500 | $0.15 / M | $0.000675 |
| Output (respuestas + argumentos de tool calls) | ~1.400 | $0.60 / M | $0.000840 |
| Resumen rodante | 1.200 in / 140 out | mixto | $0.000120 |
| **Total por conversación** | | | **≈ $0.0017** |

**≈ $1.70 por cada 1.000 conversaciones de agendamiento.**

Para dimensionar: una clínica con **300 conversaciones al mes gasta ~$0.51/mes** de LLM. El cuello de botella del costo es Railway ($5), no la IA.

## El contrafactual

De dónde sale el ahorro, para que se vea que no es micro-optimización:

| Escenario | Costo | Multiplicador |
|---|---|---|
| Esta arquitectura | $0.0017 | **1×** |
| Sin batching (1 llamada por mensaje) | $0.0038 | 2.2× |
| Sin disciplina de cache (volátiles en el system prompt) | $0.0180 | 10.6× |
| Con thinking mode activado (**el default**) | $0.0290 | 17× |
| Las tres cosas mal a la vez | $0.1400 | **82×** |

$1.70 contra $140 por cada mil conversaciones. Lo más importante de la tabla: **la columna de 17× es lo que pasa si no haces nada**, porque el thinking viene encendido de fábrica.

## Cómo se vigila

Todo en `events.llm_call` → vista `v_llm_daily`. Los dos KPIs que importan:

- **Cache hit ratio > 60%** — si falla, hay un volátil en el prefijo.
- **Costo por conversación < $0.003** — si falla, ir directo al cache hit ratio.

Ver [[Observabilidad]].

## Relacionado

- [[Cache-de-Prefijo]] — la regla 2 en detalle
- [[Buffer-y-Batching]] — la regla 3 en detalle
- [[Agente-DeepSeek]] — la regla 1 en detalle
- [[Motor-de-Decision]] — la regla 4 en detalle
- [[Clinica-Gonzalez-Guion-Demo]] — paso 12, donde se le enseña el costo al cliente
