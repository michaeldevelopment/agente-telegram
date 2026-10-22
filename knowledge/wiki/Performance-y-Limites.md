---
titulo: Performance y límites
tipo: base
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §6"
actualizado: 2026-10-22
tags: [latencia, limites, telegram, supabase, railway]
---

# Performance y límites

Los números con los que hay que diseñar. Si algo se sale de aquí, hay un problema concreto que buscar.

## Presupuesto de latencia

| Tramo | Objetivo |
|---|---|
| ACK del webhook | **< 100 ms** (se responde antes de procesar) |
| `sendChatAction(typing)` | < 300 ms desde el primer mensaje del lote |
| Espera del buffer | 12 s de silencio (configurable) |
| Llamada a DeepSeek (sin thinking, 400 tokens) | 1.5–3 s |
| Tool de disponibilidad (freeBusy + cálculo) | 300–800 ms |
| Turno con 1 tool call | 3–5 s desde el flush |
| **Percibido por el paciente** | **~15 s después de su último mensaje** |

Los 12 s del buffer dominan el presupuesto, y es intencional: el paciente ve "escribiendo…" desde el primer mensaje, así que la espera no se siente como abandono. Ver [[Buffer-y-Batching]].

**El thinking mode, si se deja encendido, añade 5–20 s.** Otra razón para apagarlo. Ver [[Agente-DeepSeek]].

## Telegram

- **30 mensajes/segundo** globales en el plan gratuito (1.000/s con Paid Broadcasts, que no necesitamos).
- **~1 mensaje/segundo por chat**; en grupos, **~20/minuto**.
- `429` devuelve `parameters.retry_after` en segundos: **respetarlo**, no reintentar antes.
- Mensaje: **4096 chars**. `callback_data`: **64 bytes**. Descarga de archivos: **20 MB**.
- `max_connections: 20` en el webhook es suficiente y protege al contenedor de Railway.

Ver [[Salida-y-Outbox]].

## Supabase free

- **500 MB** de base. A este modelo de datos, años de holgura.
- ⚠️ **El proyecto se pausa tras ~1 semana de inactividad.** `pg_cron` corriendo cada 10 s mantiene actividad, así que no debería pasar — pero **conviene verificarlo antes de una demo con el cliente delante**.
- **Conectarse por el pooler** (puerto `6543`, PgBouncer en modo transaction), no por el `5432` directo. Con `postgres.js` o `node-postgres` hay que **desactivar prepared statements** (`prepare: false`), o falla de forma intermitente.
- `pg_cron` admite intervalos sub-minuto (`'10 seconds'`). Los jobs viven en `cron.job` y su historial en `cron.job_run_details`: **conviene purgarlo, crece sin freno**.

## Railway $5

- Proceso persistente, **sin cold starts**: bueno para webhooks y para los timers en memoria.
- ⚠️ **Una sola réplica.** Es lo que permite el debounce en memoria. Si algún día se escala a 2+, el camino en memoria debe desactivarse y quedarse solo con el barrido de `pg_cron` (el reclamo atómico ya lo soporta, pero los timers duplicarían trabajo).
- Memoria: ~150–250 MB para Node + el cliente de Google. Holgado.
- `healthcheck` en `/health` que verifique **DB y validez del token de Google**.

## Google Calendar

- Cuota por defecto: **1.000.000 de peticiones/día**, y un límite por usuario por segundo. Irrelevante a esta escala.
- `freeBusy.query`: máximo 50 calendarios por consulta. Usamos 1.
- **Cachear los `busy[]`** por `(calendario, día)` durante **60 s**. Durante una conversación el modelo suele consultar disponibilidad 2–3 veces; sin cache son 3 llamadas a Google por lo mismo.

Ver [[Google-Calendar]] y [[Calculo-de-Slots]].

## La restricción estructural

> **Una sola réplica en Railway mientras el debounce viva en memoria.**

Es la única restricción de escalado real del diseño, y está puesta a cambio de una mejora concreta: el buffer dispara exacto en vez de hasta 10 s tarde. A volumen de demo y de una clínica, sobra. Ver [[Arquitectura]].

## Relacionado

- [[Buffer-y-Batching]] — de dónde salen los 12 s
- [[Salida-y-Outbox]] — cómo se respetan los rate limits
- [[Observabilidad]] — latencia p95 como KPI
- [[Gotchas]] — el checklist de Supabase/Railway antes de deploy
