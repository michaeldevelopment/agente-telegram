---
titulo: Buffer y Batching
tipo: base
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §4.2"
actualizado: 2026-10-22
tags: [buffer, batching, tokens, runtime, diferenciador]
---

# Buffer y Batching

**El diferenciador del producto y la segunda palanca de costo más grande.** El paciente escribe *"hola"* → *"quiero una cita"* → *"para limpieza"* → *"el jueves si se puede"*. Un bot ingenuo responde cuatro veces, con cuatro llamadas al LLM y cuatro historiales crecientes. El nuestro espera a que el paciente **calle** y procesa un turno.

## Las siete reglas

1. **Agrupa por SILENCIO, no por el primer mensaje.** El timer arranca con el primer mensaje y **se reinicia con cada mensaje nuevo**. Dispara cuando pasan `buffer_ms` sin actividad.
2. **`buffer_ms` = 12 s** por defecto (rango útil 10–60 s). Por debajo de 8 s se pierde el efecto; por encima de 20 s el paciente siente abandono.
3. **Techos absolutos:** `buffer_max_ms` (75 s) y `buffer_max_msgs` (15). Quien escribe sin parar también merece respuesta.
4. **Un solo batch abierto por conversación**, garantizado por el índice único parcial `uq_batch_open`.
5. **Consolidación ordenada por timestamp**, unida con `\n`. Captions y títulos de botón cuentan como texto.
6. **Bypass:** botones, comandos y **urgencias clínicas** saltan el buffer. Un click es un turno completo e intencional; un dolor severo no espera 12 s. Ver [[Guardrails-Clinicos]].
7. **Feedback inmediato aunque el lote siga abierto:** al primer mensaje del lote se manda `sendChatAction(typing)`. El paciente ve "escribiendo…" mientras sigue escribiendo, así que el silencio no se siente como abandono.

La regla 7 es la que hace que el buffer sea invisible para el usuario. Sin ella, 12 s de silencio parecen un bot caído.

## Mecanismo híbrido — la mejora sobre el blueprint original

El blueprint original depende de `pg_cron` cada 5 s porque corre en serverless. Nosotros tenemos proceso persistente:

```
mensaje entra
  └─ UPSERT batch: last_msg_at = now, fire_at = now + delay   (REINICIA el timer)
  └─ en memoria: clearTimeout(prev); setTimeout(flush, delay)  ← camino rápido, exacto
pg_cron cada 10 s
  └─ reclama batches con fire_at <= now() que nadie procesó    ← red de seguridad
```

**La fuente de verdad es Postgres**; el timer en memoria es solo un acelerador. Ambos caminos reclaman el batch con el mismo `UPDATE ... WHERE status='open' RETURNING`, que es atómico: solo uno gana. Si el proceso reinicia con lotes abiertos, el cron los recoge ≤10 s después.

### `buffer_append` — append con reinicio de timer y techo

La pieza central. El `least()` es lo que hace que el techo absoluto gane sobre el silencio:

```sql
v_fire := least(now() + (p_delay_ms || ' ms')::interval,
                v_first + (p_max_ms || ' ms')::interval);
```

El `select ... for update` al principio serializa los appends concurrentes del mismo chat. El SQL completo está en [[00-BLUEPRINT-agente-telegram]] §4.2.2.

### `buffer_claim` — reclamo atómico

```sql
create or replace function buffer_claim(p_batch uuid, p_by text)
returns boolean language sql as $$
  update message_batches
     set status = 'processing', claimed_by = p_by
   where id = p_batch and status in ('open','ready')
  returning true;
$$;
```

Lo llaman igual el timer en memoria (`p_by = 'inproc'`) y el cron (`p_by = 'cron'`). El `where status in ('open','ready')` es la condición de carrera resuelta: el segundo en llegar no devuelve fila.

### El barrido

`cron.schedule('buffer-sweeper', '10 seconds', ...)` marca como `ready` lo vencido con `for update skip locked limit 50` y lo empuja al worker por `pg_net` contra `/internal/batch/process`, con el header `x-internal-secret`.

## Lo que esto ahorra

Un paciente que agenda escribe ~22 mensajes en 15 turnos conversacionales. Sin buffer eso son 22 llamadas al LLM; con buffer (promedio 2.2 mensajes por lote) son 10.

Y como cada llamada arrastra el historial, **el ahorro no es del 55% lineal sino superior**: el coste de N llamadas sobre un historial creciente escala cuadráticamente. El cálculo está en [[Economia-de-Tokens]].

## Medición

Al cerrar el lote se registra en `events`:

```
{batchId, msgCount, waitedMs, triggerReason, mergedLength}
```

`triggerReason` ∈ `silence | max_ms | max_msgs | bypass`.

**El tamaño medio de lote es un KPI.** Objetivo 1.8–2.5. Si baja a ~1.0, el `buffer_ms` está demasiado corto y el buffer no está sirviendo de nada. Se consulta con la vista `v_buffer`. Ver [[Observabilidad]].

## Gotchas

- **Una sola réplica en Railway** mientras el debounce viva en memoria. Con dos procesos, los timers duplican trabajo (el reclamo atómico evita el doble envío, pero no el doble cómputo).
- El `fire_at` se **reescribe**, no se extiende con un `+`. Confundirlo rompe el techo absoluto.
- Un batch en `processing` que falle hay que devolverlo a `ready` o se queda colgado. El barrido solo mira `open`.
- `pg_cron` admite intervalos sub-minuto (`'10 seconds'`), pero su historial en `cron.job_run_details` crece sin freno: purgarlo.

## Relacionado

- [[Arquitectura]] — etapa 2 del flujo
- [[Motor-de-Decision]] — qué pasa cuando el lote se cierra
- [[Economia-de-Tokens]] — regla 3, el impacto en costo
- [[Esquema-de-Datos]] — `message_batches` y `uq_batch_open`
- [[Clinica-Gonzalez-Guion-Demo]] — paso 2, donde se demuestra en vivo
