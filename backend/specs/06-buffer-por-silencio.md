# Spec 06 · Buffer por silencio

**Depende de:** 05 · **Entorno:** local · **~55 min**

## Qué construye

**El diferenciador del producto.** El paciente escribe "hola" → "quiero una cita" → "para limpieza" → "el jueves si se puede", y el bot responde **una vez**, atendiendo las cuatro cosas.

Un bot ingenuo respondería cuatro veces, con cuatro llamadas al LLM y cuatro historiales crecientes. Es el paso 2 del guion de la demo.

## Archivos

| Archivo | | Qué va dentro |
|---|---|---|
| `migrations/002_buffer.sql` | nuevo | Funciones `buffer_append` y `buffer_claim`, job `buffer-sweeper` |
| `src/runtime/buffer.ts` | nuevo | Append, timer en memoria, flush |
| `src/http/internal.ts` | nuevo | `/internal/batch/process` con `x-internal-secret` |
| `src/telegram/typing.ts` | nuevo | `sendChatAction` reenviado cada 4 s |
| `src/ingress/webhook.ts` | editado | El texto va al buffer, no al agente |

## Las siete reglas

1. **Agrupa por SILENCIO, no por el primer mensaje.** El timer arranca con el primero y **se reinicia con cada mensaje nuevo**.
2. **`buffer_ms` = 12 s.** Por debajo de 8 s se pierde el efecto; por encima de 20 s el paciente siente abandono.
3. **Techos:** `buffer_max_ms` 75 s y `buffer_max_msgs` 15. Quien escribe sin parar también merece respuesta.
4. **Un solo lote abierto por conversación**, garantizado por `uq_batch_open`.
5. **Consolidación ordenada por timestamp**, unida con `\n`.
6. **Bypass:** botones, comandos y urgencias clínicas saltan el buffer (specs 07 y 15).
7. **`typing` al primer mensaje del lote.** Es lo que hace el buffer invisible: sin esto, 12 s de silencio parecen un bot caído.

## Mecanismo híbrido

```
mensaje entra
  └─ UPSERT: fire_at = now + delay          (REESCRIBE, no extiende)
  └─ en memoria: clearTimeout; setTimeout   ← camino rápido, exacto
pg_cron cada 10 s
  └─ reclama lo vencido que nadie procesó   ← red de seguridad
```

**La fuente de verdad es Postgres**; el timer es un acelerador. Ambos caminos reclaman con el mismo `UPDATE ... WHERE status='open' RETURNING`, que es atómico: solo uno gana.

Copia `buffer_append` y `buffer_claim` del blueprint §4.2.2. El `least()` del `fire_at` es lo que hace que el techo absoluto gane sobre el silencio.

## `runtime_config`

`pg_cron` no lee el entorno de Railway. Necesita su propia copia:

```sql
insert into runtime_config (key, value) values
  ('worker_url',      '<APP_BASE_URL>'),
  ('internal_secret', '<el mismo INTERNAL_SECRET>')
on conflict (key) do update set value = excluded.value;
```

> ⚠️ **Si se desincronizan, los barridos fallan en silencio.** No aparece ningún error en los logs de la aplicación, porque el fallo ocurre dentro de Postgres. Es el fallo más difícil de diagnosticar del sistema.

## Terminada cuando

- [ ] **Cuatro mensajes en 8 s → UNA respuesta** que atiende los cuatro
      ```sql
      select payload->>'msgCount', payload->>'triggerReason'
        from events where type='batch_flush' order by created_at desc limit 1;
      -- 4, silence
      ```
- [ ] **Una sola llamada al LLM** para esos cuatro mensajes
      ```sql
      select count(*) from events where type='llm_call'
       and created_at > now() - interval '1 minute';   -- 1
      ```
- [ ] **"Escribiendo…" aparece <300 ms** tras el primer mensaje, y se mantiene mientras el modelo trabaja
- [ ] El lote cierra **a los ~12 s** del último mensaje, no del primero
- [ ] **Techo por mensajes**: 15 mensajes seguidos cierran el lote sin esperar silencio (`triggerReason: max_msgs`)
- [ ] **Techo por tiempo**: escribiendo cada 10 s, el lote cierra a los 75 s (`max_ms`)
- [ ] 🔧 **La red de seguridad funciona**: manda 2 mensajes, **mata el proceso** antes de los 12 s, reinícialo → el cron recoge el lote en ≤10 s y responde
- [ ] `runtime_config` poblada y coincidiendo con las env vars
- [ ] Tamaño medio de lote **≥ 1.8** tras unas cuantas conversaciones
- [ ] `scripts/smoke/06.sh` sale con código 0

## Trampas

- **`fire_at` se reescribe**, no se extiende con un `+`. Confundirlo rompe el techo absoluto.
- **Una sola réplica** en Railway mientras el debounce viva en memoria. Con dos, los timers duplican cómputo.
- Un lote en `processing` que falle hay que devolverlo a `ready`, o se queda colgado: el barrido solo mira `open`.
- `sendChatAction` **dura ≤5 s**: reenviar cada 4 s mientras se genera.
- `cron.job_run_details` crece sin freno. Purgarlo.
- Si `msgs_por_lote` baja a ~1.0, el `buffer_ms` está demasiado corto y el buffer no sirve de nada.

## Referencias

- Blueprint §4.2 (completo, con el SQL), §13 Fase 2
- `../../knowledge/wiki/Buffer-y-Batching.md`
- `../../knowledge/wiki/Economia-de-Tokens.md` (regla 3)
- `../memoria/una-sola-replica-railway.md`
