---
titulo: Observabilidad
tipo: base
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §11"
actualizado: 2026-10-22
tags: [observabilidad, events, kpi, sql, metricas]
---

# Observabilidad

Sin frontend, **`events` es el panel de control**. Todo se consulta con SQL desde el editor de Supabase. Tres vistas y ocho KPIs con umbral.

## Qué se registra

| `type` | Cuándo | `payload` |
|---|---|---|
| `batch_flush` | Al cerrar un lote | `{batchId, msgCount, waitedMs, triggerReason, mergedLength}` |
| `llm_call` | Cada llamada a DeepSeek | `{model, steps, cacheHit, cacheMiss, outTokens, costUsd, latencyMs}` |
| `tool_call` | Cada tool ejecutada | `{name, ok, error, latencyMs}` — argumentos resumidos, **sin PII** |
| `state_change` | Transición de la máquina | `{from, to, reason}` |
| `handoff` | Escalada | `{reason, takenBy, waitedMs}` |
| `appointment` | Reserva / cambio / cancelación | `{apptId, service, action, leadTimeHours}` |
| `guardrail` | Filtro de salida disparado | `{rule, snippetHash}` |
| `send_error` | Fallo de envío | `{code, description, attempts}` |

El `costUsd` de `llm_call` lo calculamos nosotros: **DeepSeek no devuelve `usage.cost`** (a diferencia de OpenRouter). Ver [[Telegram-vs-WhatsApp]].

## Las tres vistas

### `v_llm_daily` — costo y eficiencia de cache

Agrupa por día en `America/Bogota`. Devuelve `llamadas`, `tok_cache_hit`, `tok_cache_miss`, `tok_out`, **`cache_hit_pct`**, `costo_usd` y `latencia_ms_prom`.

Es la vista que se le enseña al cliente en el paso 12 de la demo: *"el costo real de todo lo anterior: centavos"*.

### `v_buffer` — eficacia del buffer

`lotes`, **`msgs_por_lote`**, `espera_ms_prom`, y cuántos cerraron por techo de tiempo vs. techo de mensajes.

> Si `msgs_por_lote` se acerca a 1.0, el `buffer_ms` es demasiado corto y el buffer no está sirviendo de nada.

### `v_funnel` — embudo del agendador

`conversaciones`, `con_cita`, **`conversion_pct`**, `escaladas`.

Es la única vista que le importa al cliente en términos de negocio.

El SQL completo de las tres está en [[00-BLUEPRINT-agente-telegram]] §11.2.

## KPIs y umbrales

| KPI | Objetivo | Qué significa si falla |
|---|---|---|
| **Cache hit ratio** | **> 60%** | Hay un dato volátil infiltrado en el prefijo. **Alarma #1 de costo** |
| Mensajes por lote | 1.8 – 2.5 | < 1.3: `buffer_ms` demasiado corto |
| Llamadas LLM por conversación | < 12 | Más: el modelo da vueltas; revisar prompt y descripciones de tools |
| Latencia p95 del turno | < 6 s | Revisar si el thinking mode se reactivó o si Google está lento |
| Tasa de escalada | 10 – 25% | **< 5%: sospechoso**, el agente puede estar inventando en vez de escalar |
| Conversión a cita | > 35% | La métrica que le importa al cliente |
| Errores de envío | < 1% | `403` creciente = pacientes bloqueando el bot: revisar frecuencia de proactivos |
| Costo por conversación | < $0.003 | Por encima: ir directo al cache hit ratio |

El de la tasa de escalada es el más sutil: **una escalada demasiado baja es mala señal**, no buena. Significa que el agente está respondiendo cosas que debería derivar.

## Alertas al grupo interno

Al mismo grupo del handoff:

- DeepSeek `402` (sin saldo).
- 3 fallos de LLM seguidos.
- Cache hit ratio diario < 40%.
- **Cualquier `guardrail` disparado.**

El último no tiene umbral: en un cliente de salud, cada vez que el filtro de salida bloquea algo, alguien debe mirarlo. Ver [[Guardrails-Clinicos]].

## Gotchas

- `events.payload` guarda **ids, no cuerpos**. Teléfono y email enmascarados. Ver [[Seguridad]].
- El `snippetHash` del guardrail, nunca el texto: es PII clínica.
- La tabla crece rápido. A volumen de demo da igual, pero con varios clientes hay que pensar en retención.
- Las vistas agrupan en `America/Bogota`, no en UTC. Un día de `v_llm_daily` es un día de la clínica.

## Relacionado

- [[Economia-de-Tokens]] — los umbrales de costo
- [[Cache-de-Prefijo]] — el KPI número uno
- [[Buffer-y-Batching]] — el KPI de msgs por lote
- [[Esquema-de-Datos]] — la tabla `events`
- [[Clinica-Gonzalez-Guion-Demo]] — paso 12
