---
titulo: Esquema de datos
tipo: base
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §3"
actualizado: 2026-10-22
tags: [supabase, postgres, schema, tablas]
---

# Esquema de datos

12 tablas en Supabase/Postgres. **Sin RLS en esta fase**: no hay frontend, nadie se conecta con la `anon` key, el único cliente es el worker con `service_role`. Cuando llegue un panel se aplica el patrón RLS del blueprint original tal cual.

El SQL completo está en [[00-BLUEPRINT-agente-telegram]] §3. Aquí va el mapa y las decisiones que importan.

## Extensiones

`pgcrypto` (uuid + cifrado de secretos), `pg_cron` (barridos periódicos), `pg_net` (HTTP saliente desde Postgres).

## Las 12 tablas

| Tabla | Para qué | Clave de diseño |
|---|---|---|
| `runtime_config` | `worker_url` e `internal_secret` para que `pg_cron` sepa a dónde llamar | Dos filas, key/value |
| `workspaces` | Un cliente = un workspace = un bot | Lleva el `agent_type`, la zona horaria, los parámetros del buffer y las horas de silencio |
| `contacts` | El paciente | `tg_chat_id` es **BIGINT**, nunca `int`. `is_blocked` se marca al recibir `403` |
| `conversations` | State machine + resumen rodante | `summary` + `summary_upto` son el ahorro de tokens de la [[Economia-de-Tokens\|regla 5]] |
| `messages` | Entrada y salida | Dedupe por índice único parcial sobre `(workspace_id, tg_update_id)` |
| `message_batches` | El buffer por silencio | `fire_at` se **reescribe** con cada mensaje nuevo |
| `business_info` | Todo el conocimiento del negocio en una fila | `rendered` + `rendered_hash` — es lo que entra al cache del prompt |
| `agent_prompts` | Persona y reglas, versionado | `body` **sin datos volátiles**. Un solo activo por workspace |
| `services` | Catálogo odontológico | `duration_min` + `buffer_min` son la base del cálculo de slots |
| `business_hours` + `closures` | Disponibilidad teórica | `weekday` 0 = domingo. `closures` son festivos y cierres puntuales |
| `appointments` | Las citas | `gcal_event_id` determinista. Índice único contra doble reserva |
| `reminders` | Outbox programado | Único por `(appointment_id, kind)` |
| `outbound_queue` | **Toda** salida pasa por aquí | Rate limit, reintentos, auditoría |
| `events` | Observabilidad | Es el panel de control, no hay frontend |
| `handoff_relay` | Puente grupo interno ⇄ chat del paciente | Responder al mensaje del grupo = escribirle al paciente |

## Enums

```sql
agent_type         : appointment_setter | ecommerce_closer
conversation_state : ai_active | awaiting_reply | handoff_pending | human_active | paused | closed
msg_direction      : in | out
msg_kind           : text | voice | photo | document | sticker | callback | command | system
batch_status       : open | ready | processing | done | cancelled
appt_status        : booked | confirmed | rescheduled | cancelled | completed | no_show
reminder_kind      : confirm_24h | remind_2h | followup_no_show
queue_status       : pending | sent | failed | skipped
```

`msg_kind = 'voice'` ya existe aunque la transcripción esté [[Fuera-de-Alcance|fuera de alcance]]: es el hook para enchufarla sin migración.

## Los cuatro índices que son el diseño

No son optimización. Son **garantías de corrección** que evitan tener que confiar en lógica de aplicación:

```sql
-- 1. Dedupe de reintentos de Telegram
create unique index uq_messages_update
  on messages(workspace_id, tg_update_id) where tg_update_id is not null;

-- 2. Un solo batch abierto por conversación
create unique index uq_batch_open
  on message_batches(conversation_id) where status = 'open';

-- 3. El candado real contra doble reserva
create unique index uq_appt_slot
  on appointments(workspace_id, starts_at)
  where status in ('booked','confirmed','rescheduled');

-- 4. Un recordatorio de cada tipo por cita
constraint uq_reminder unique (appointment_id, kind)
```

Los cuatro son **índices únicos parciales**. El patrón viene del blueprint original y es el que hace que la idempotencia sea una propiedad de la base de datos y no una esperanza. Ver [[Seguridad]].

## Secretos cifrados

`workspaces.bot_token_enc` se guarda con `pgp_sym_encrypt` usando una clave que vive en el entorno del worker, **nunca** en la base:

```sql
update workspaces set bot_token_enc = pgp_sym_encrypt($1, $2) where id = $3;
select pgp_sym_decrypt(bot_token_enc, $1)::text from workspaces where id = $2;
```

**Para esta demo de un solo cliente**, el token va en `TELEGRAM_BOT_TOKEN` del entorno de Railway y la columna queda nula. La columna cifrada se vuelve obligatoria cuando entre el segundo cliente. Ver [[Clinica-Gonzalez-Credenciales]].

## Gotchas

- **`tg_chat_id` en BIGINT.** Un `int` desborda con ids reales de Telegram. Es el bug más fácil de cometer y el más difícil de ver en desarrollo.
- **Conexión por el pooler 6543** (PgBouncer en modo transaction), no por el `5432` directo. Con `postgres.js` o `node-postgres` hay que desactivar prepared statements (`prepare: false`) o falla de forma intermitente.
- **`cron.job_run_details` crece sin freno.** Hay que purgarlo periódicamente.
- Sin RLS, **la `anon` key no debe usarse en ninguna parte**. Si aparece en algún sitio, es un error.

## Relacionado

- [[Arquitectura]] — qué etapa toca cada tabla
- [[Buffer-y-Batching]] — `message_batches` y la función `buffer_append`
- [[Observabilidad]] — las vistas sobre `events`
- [[Performance-y-Limites]] — límites de Supabase free
- [[Seguridad]] — idempotencia y PII
