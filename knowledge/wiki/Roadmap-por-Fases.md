---
titulo: Roadmap por fases
tipo: operacion
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §13"
actualizado: 2026-10-22
tags: [roadmap, fases, aceptacion, plan]
---

# Roadmap por fases

Seis fases, **5 días de trabajo** estimados para la demo completa. Cada fase se cierra cuando su criterio de aceptación pasa.

> **Nada de avanzar con una fase a medias.** Los criterios están escritos para ser verificables, no opinables.

## Fase 0 — Esqueleto · 0.5 día

Proyecto Supabase, migración completa del esquema, servicio Fastify en Railway, `/health`, bot creado en @BotFather, `setWebhook` con `secret_token`.

**Acepta cuando:** el bot responde "pong" a `/start`, el update queda en `messages`, y un segundo envío del mismo `update_id` **no crea una fila nueva**.

→ [[Esquema-de-Datos]], [[Ingress]]

## Fase 1 — Camino felizmente tonto · 1 día

Ingress → DeepSeek (sin tools, sin buffer) → respuesta por el outbox. Prompt estático cargado desde `agent_prompts`.

**Acepta cuando:** conversación de texto coherente end-to-end, y `events.llm_call` muestra `cacheHit > 0` en el segundo turno.

> ⚠️ **Si el cache hit es 0 en el segundo turno, hay un volátil en el prefijo: NO AVANZAR.**

Este es el criterio más importante del roadmap. Un volátil infiltrado en el prefijo multiplica el costo por 10 y es mucho más barato de arreglar ahora que con tools, buffer y handoff encima. → [[Cache-de-Prefijo]]

## Fase 2 — Buffer · 0.5 día

`buffer_append`, timer en memoria, barrido `pg_cron`, `typing`.

**Acepta cuando:** cuatro mensajes en 8 s producen **una** sola respuesta que atiende los cuatro, y `v_buffer.msgs_por_lote` ≥ 1.8.

→ [[Buffer-y-Batching]]

## Fase 3 — Agendamiento · 1.5 días

Service Account, `freeBusy`, motor de slots, las 7 tools, botones inline de horario.

**Acepta cuando:** una conversación agenda una cita que **aparece en Google Calendar con la hora correcta**, el evento tiene id determinista, y reintentar la inserción devuelve `409` sin duplicar.

Es la fase más larga y la que contiene el momento que vende la demo (paso 7 del guion). → [[Google-Calendar]], [[Calculo-de-Slots]], [[Capa-de-Tools]]

## Fase 4 — Handoff y recordatorios · 1 día

Grupo interno, botones Tomar/Devolver, relay bidireccional, `reminders` + cron, horas de silencio.

**Acepta cuando:** `/humano` silencia a la IA y notifica al grupo; responder en el grupo le llega al paciente; un recordatorio programado a 2 minutos se dispara y sus botones funcionan.

→ [[State-Machine-y-Handoff]], [[Recordatorios-Programados]]

## Fase 5 — Guardrails y observabilidad · 0.5 día

`isClinicalUrgency`, filtro de salida, las tres vistas SQL, alertas al grupo.

**Acepta cuando:** "me duele muchísimo y está sangrando" escala de inmediato **sin pasar por el buffer**; un borrador con diagnóstico se bloquea y queda registrado en `events`; `v_llm_daily` muestra cache hit > 60%.

→ [[Guardrails-Clinicos]], [[Observabilidad]]

---

## Total: 5 días

## Qué bloquea qué

Las fases son secuenciales, pero hay dependencias externas que conviene arrancar **antes**, porque no dependen de nosotros:

| Dependencia | Bloquea | Arrancar en |
|---|---|---|
| Datos del cliente ([[Clinica-Gonzalez-Pendientes]]) | El prompt real y la demo | **Ya** |
| Bot en @BotFather | Fase 0 | Antes de Fase 0 |
| Service Account + calendario compartido | Fase 3 | Durante Fase 1 |
| Grupo interno de la clínica | Fase 4 | Durante Fase 3 |
| Validación de guardrails con el odontólogo | Fase 5 | Durante Fase 3 |

Los datos del cliente son el bloqueante real: las 5 fases se pueden construir con `<<EDITAR>>`, pero **la demo no se puede hacer**.

## Por qué el orden es este

Cada fase añade **una** fuente de complejidad y la verifica antes de añadir la siguiente:

- Fase 1 valida el cache **sin** tools ni buffer de por medio. Si fallara con todo encima, sería mucho más difícil aislar la causa.
- Fase 2 valida el buffer **sin** tools, donde el único efecto observable es "una respuesta en vez de cuatro".
- Fase 3 añade estado externo (Google) sobre una base ya verificada.
- Fase 5 va al final a propósito: los guardrails se prueban contra un agente que ya funciona, no contra uno a medias.

## Relacionado

- [[Clinica-Gonzalez-Guion-Demo]] — a dónde se llega
- [[Clinica-Gonzalez-Pendientes]] — lo que bloquea desde fuera
- [[Gotchas]] — checklist antes de cada deploy
- [[Checklist-de-Onboarding]] — las dependencias externas
