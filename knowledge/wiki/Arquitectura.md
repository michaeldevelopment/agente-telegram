---
titulo: Arquitectura
tipo: base
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §1"
actualizado: 2026-10-22
tags: [arquitectura, runtime, flujo]
---

# Arquitectura

Seis etapas entre el mensaje del paciente y la respuesta, más dos capas transversales que gobiernan si el agente puede hablar y qué puede decir. Todo corre en **un solo proceso** de Railway.

## Flujo canónico

```
Telegram
   │  POST /tg/<workspace>/<path-secreto>
   ▼
[1] Ingress ──── verifica secret_token · deduplica update_id · persiste · ACK <100 ms
   │
   ▼
[2] Buffer ───── agrupa por SILENCIO del paciente (timer en proceso + barrido pg_cron)
   │
   ▼
[3] Decisión ─── reglas duras, 0 tokens (¿hay humano? ¿está pausada? ¿es botón? ¿es /comando?)
   │
   ▼
[4] Agente ───── DeepSeek `deepseek-flash` · prompt estático cacheado · loop de tool-calling
   │
   ▼
[5] Tools ────── Google Calendar · Supabase · handoff
   │
   ▼
[6] Salida ───── outbox con rate-limit por chat · corte a 4096 chars · reintentos
   │
   ▼
Telegram  +  events (observabilidad: tokens, cache hit, costo, latencia)
```

Cada etapa tiene su página: [[Ingress]] · [[Buffer-y-Batching]] · [[Motor-de-Decision]] · [[Agente-DeepSeek]] · [[Capa-de-Tools]] · [[Salida-y-Outbox]].

**Transversales:** la [[State-Machine-y-Handoff|state machine]] gobierna **si** la IA puede hablar; los [[Guardrails-Clinicos|guardrails clínicos]] gobiernan **qué** puede decir.

## Un solo proceso, tres roles

El servicio de Railway expone tres superficies en el mismo proceso. Es deliberado: un solo deploy, un solo log, un solo costo.

| Rol | Superficie | Quién lo llama |
|---|---|---|
| Webhook público | `POST /tg/:workspace/:secret` | Telegram |
| Endpoints internos | `POST /internal/batch/process`, `/internal/reminders/tick`, `/internal/outbox/drain` | `pg_cron` vía `pg_net`, con header `x-internal-secret` |
| Loops en memoria | debounce de batches, drenado del outbox | el propio proceso |

Los endpoints internos no están expuestos en ninguna ruta pública y verifican `x-internal-secret` en tiempo constante. Ver [[Seguridad]].

## Por qué este stack y no el del blueprint original

El blueprint de WhatsApp asume Next.js serverless, lo que **obliga** a que todo el estado de tiempo viva en Postgres: sin timers en memoria, porque no sobreviven a una función serverless.

Railway corre un **proceso persistente**, así que usamos timers reales y dejamos Postgres como fuente de verdad durable. El resultado práctico: el buffer dispara exacto al vencer el silencio en vez de hasta 10 s tarde, y `pg_cron` queda como red de seguridad en vez de mecanismo principal. El detalle del mecanismo híbrido está en [[Buffer-y-Batching]].

También se cae OpenRouter: con un solo modelo y un solo cliente, el gateway añade un salto de red y un margen sin aportar nada. El fallback se escribe a mano en [[Agente-DeepSeek]].

## La restricción que sostiene el diseño

**Una sola réplica en Railway.** El debounce en memoria asume que solo hay un proceso. Si algún día se escala a dos o más, el camino en memoria debe desactivarse y quedarse solo con el barrido de `pg_cron`. El reclamo atómico del batch ya lo soporta, pero los timers duplicarían trabajo. Ver [[Performance-y-Limites]].

## Relacionado

- [[Decisiones-Fijas]] — por qué este stack
- [[Esquema-de-Datos]] — las 12 tablas que sostienen el flujo
- [[Observabilidad]] — `events` como columna vertebral
- [[Multi-Cliente]] — qué es compartido y qué es del cliente
