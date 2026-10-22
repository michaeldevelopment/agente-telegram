-- ============================================================
-- 001_init — esquema completo
-- Fuente: ../knowledge/raw/00-BLUEPRINT-agente-telegram.md §3
--
-- 16 tablas, 8 enums. Escrito para ser IDEMPOTENTE: re-aplicarlo no falla.
-- Postgres no tiene "create type if not exists" ni "create trigger if not
-- exists", así que esos dos van envueltos en bloques DO.
-- ============================================================

-- ── Extensiones ─────────────────────────────────────────────
-- pg_cron y pg_net hay que habilitarlas además en el panel de Supabase
-- (Database → Extensions). Aquí solo se declaran.
create extension if not exists pgcrypto;   -- gen_random_uuid + cifrado de secretos
create extension if not exists pg_cron;    -- barridos periódicos (spec 06)
create extension if not exists pg_net;     -- HTTP saliente desde Postgres (spec 06)

-- ── Helper updated_at ───────────────────────────────────────
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- Helper para crear triggers sin duplicarlos al re-aplicar
create or replace function ensure_updated_at_trigger(p_table text) returns void
language plpgsql as $$
declare v_name text := 't_' || p_table || '_upd';
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = v_name and tgrelid = p_table::regclass
  ) then
    execute format(
      'create trigger %I before update on %I
         for each row execute function set_updated_at()', v_name, p_table);
  end if;
end $$;

-- ── Enums ───────────────────────────────────────────────────
do $$ begin
  create type agent_type as enum ('appointment_setter', 'ecommerce_closer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type conversation_state as enum (
    'ai_active',        -- la IA responde
    'awaiting_reply',   -- la IA respondió, espera al paciente
    'handoff_pending',  -- escalada detectada, nadie la tomó aún
    'human_active',     -- un humano la tomó; la IA calla
    'paused',           -- pausada manualmente
    'closed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type msg_direction as enum ('in', 'out');
exception when duplicate_object then null; end $$;

do $$ begin
  create type msg_kind as enum
    ('text','voice','photo','document','sticker','callback','command','system');
exception when duplicate_object then null; end $$;

do $$ begin
  create type batch_status as enum ('open','ready','processing','done','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type appt_status as enum
    ('booked','confirmed','rescheduled','cancelled','completed','no_show');
exception when duplicate_object then null; end $$;

do $$ begin
  create type reminder_kind as enum ('confirm_24h','remind_2h','followup_no_show');
exception when duplicate_object then null; end $$;

do $$ begin
  create type queue_status as enum ('pending','sent','failed','skipped');
exception when duplicate_object then null; end $$;

-- ============================================================
-- runtime_config — para que pg_cron sepa a dónde llamar (spec 06)
-- ============================================================
create table if not exists runtime_config (
  key   text primary key,
  value text not null
);

-- ============================================================
-- workspaces — un cliente = un workspace = un bot
-- ============================================================
create table if not exists workspaces (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,            -- 'clinica-gonzalez'
  name          text not null,
  agent_type    agent_type not null default 'appointment_setter',
  timezone      text not null default 'America/Bogota',
  locale        text not null default 'es-CO',
  currency      text not null default 'COP',
  -- Telegram
  bot_username      text,
  bot_token_enc     bytea,                       -- pgp_sym_encrypt; en la demo va por env
  webhook_secret    text,                        -- el secret_token de setWebhook
  webhook_path      text unique,                 -- segmento aleatorio del path
  handoff_chat_id   bigint,                      -- grupo interno (NEGATIVO)
  -- comportamiento
  buffer_ms       int  not null default 12000,   -- silencio para cerrar el lote
  buffer_max_ms   int  not null default 75000,   -- techo absoluto del lote
  buffer_max_msgs int  not null default 15,
  quiet_from      time not null default '21:00', -- no enviar proactivos (hora local)
  quiet_to        time not null default '08:00',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
select ensure_updated_at_trigger('workspaces');

-- ============================================================
-- contacts — el paciente
-- ============================================================
create table if not exists contacts (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  tg_chat_id      bigint not null,               -- int64: SIEMPRE bigint, nunca int
  tg_user_id      bigint,
  tg_username     text,
  first_name      text,
  last_name       text,
  full_name       text,                          -- el que declara el paciente
  phone           text,                          -- E.164 si lo entrega
  email           text,
  language_code   text,
  source          text,                          -- de /start <payload>
  tags            text[] not null default '{}',
  notes           text,                          -- logística, NUNCA historia médica
  is_blocked      boolean not null default false, -- true cuando la API devuelve 403
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint uq_contacts_chat unique (workspace_id, tg_chat_id)
);
select ensure_updated_at_trigger('contacts');

-- ============================================================
-- conversations — state machine + resumen rodante
-- ============================================================
create table if not exists conversations (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  contact_id      uuid not null references contacts(id) on delete cascade,
  state           conversation_state not null default 'ai_active',
  ai_enabled      boolean not null default true,
  assigned_to     bigint,                        -- tg_user_id del humano que la tomó
  -- ahorro de tokens: resumen de lo viejo + hasta dónde resume
  summary         text,
  summary_upto    timestamptz,
  msg_count       int not null default 0,
  last_message_at timestamptz,
  last_ai_at      timestamptz,
  meta            jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint uq_conv_contact unique (workspace_id, contact_id)
);
create index if not exists idx_conv_state on conversations(workspace_id, state);
select ensure_updated_at_trigger('conversations');

-- ============================================================
-- messages — dedupe por update_id
-- ============================================================
create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  direction       msg_direction not null,
  kind            msg_kind not null default 'text',
  body            text,
  tg_update_id    bigint,                        -- solo inbound
  tg_message_id   bigint,
  batch_id        uuid,
  sender_tg_id    bigint,                        -- humano que envió (null = IA o paciente)
  meta            jsonb not null default '{}',
  created_at      timestamptz not null default now()
);
-- 🔒 Dedupe de reintentos de Telegram. Garantía, no optimización.
create unique index if not exists uq_messages_update
  on messages(workspace_id, tg_update_id) where tg_update_id is not null;
create index if not exists idx_messages_conv  on messages(conversation_id, created_at desc);
create index if not exists idx_messages_batch on messages(batch_id) where batch_id is not null;

-- ============================================================
-- message_batches — el buffer por silencio (spec 06)
-- ============================================================
create table if not exists message_batches (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  status          batch_status not null default 'open',
  first_msg_at    timestamptz not null default now(),
  last_msg_at     timestamptz not null default now(),
  fire_at         timestamptz not null,          -- se REESCRIBE con cada mensaje nuevo
  msg_count       int not null default 0,
  merged_text     text,
  trigger_reason  text,                          -- silence | max_ms | max_msgs | bypass
  claimed_by      text,                          -- inproc | cron
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- 🔒 Un solo lote abierto por conversación.
create unique index if not exists uq_batch_open
  on message_batches(conversation_id) where status = 'open';
create index if not exists idx_batch_fire
  on message_batches(status, fire_at) where status = 'open';
select ensure_updated_at_trigger('message_batches');

do $$ begin
  alter table messages
    add constraint fk_messages_batch
    foreign key (batch_id) references message_batches(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ============================================================
-- business_info — el conocimiento del negocio, en una fila
-- `rendered` es lo que entra al prompt → al cache de DeepSeek
-- ============================================================
create table if not exists business_info (
  workspace_id  uuid primary key references workspaces(id) on delete cascade,
  structured    jsonb not null default '{}',     -- servicios, precios, sedes, FAQs
  free_text     text,
  rendered      text,                            -- el bloque ya renderizado
  rendered_hash text,                            -- cambia => se invalida el cache
  updated_at    timestamptz not null default now()
);
select ensure_updated_at_trigger('business_info');

-- ============================================================
-- agent_prompts — versionado simple
-- ============================================================
create table if not exists agent_prompts (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  version      int not null,
  body         text not null,                    -- persona y reglas. SIN datos volátiles
  is_active    boolean not null default false,
  notes        text,
  created_at   timestamptz not null default now(),
  constraint uq_prompt_version unique (workspace_id, version)
);
create unique index if not exists uq_prompt_active
  on agent_prompts(workspace_id) where is_active;

-- ============================================================
-- services — catálogo (duración = base del cálculo de slots)
-- ============================================================
create table if not exists services (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  slug            text not null,                 -- 'limpieza-dental'
  name            text not null,
  duration_min    int  not null,                 -- duración del bloque
  buffer_min      int  not null default 10,      -- holgura después de la cita
  price_from      numeric(12,2),
  price_note      text,                          -- 'desde; por diente'
  requires_eval   boolean not null default false,
  description     text,
  is_active       boolean not null default true,
  sort_order      int not null default 0,
  constraint uq_service_slug unique (workspace_id, slug)
);

-- ============================================================
-- business_hours + closures — la disponibilidad teórica
-- ============================================================
create table if not exists business_hours (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  weekday      int  not null check (weekday between 0 and 6),  -- 0 = DOMINGO
  opens_at     time not null,
  closes_at    time not null,
  break_from   time,
  break_to     time,
  constraint uq_hours unique (workspace_id, weekday)
);

create table if not exists closures (            -- festivos y cierres puntuales
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  day          date not null,
  reason       text,
  constraint uq_closure unique (workspace_id, day)
);

-- ============================================================
-- appointments
-- ============================================================
create table if not exists appointments (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  contact_id      uuid not null references contacts(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  service_id      uuid references services(id) on delete set null,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  status          appt_status not null default 'booked',
  patient_name    text not null,
  patient_phone   text,
  reason          text,
  gcal_event_id   text,                          -- determinista: uuid sin guiones
  gcal_html_link  text,
  cancel_reason   text,
  meta            jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_appt_when    on appointments(workspace_id, starts_at);
create index if not exists idx_appt_contact on appointments(contact_id, starts_at desc);
-- 🔒 El candado real contra doble reserva, incluso con dos conversaciones a la vez.
create unique index if not exists uq_appt_slot
  on appointments(workspace_id, starts_at)
  where status in ('booked','confirmed','rescheduled');
select ensure_updated_at_trigger('appointments');

-- ============================================================
-- reminders — outbox programado (spec 14)
-- ============================================================
create table if not exists reminders (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  appointment_id uuid not null references appointments(id) on delete cascade,
  kind           reminder_kind not null,
  send_at        timestamptz not null,
  status         queue_status not null default 'pending',
  sent_at        timestamptz,
  error          text,
  -- 🔒 Un recordatorio de cada tipo por cita.
  constraint uq_reminder unique (appointment_id, kind)
);
create index if not exists idx_reminders_due
  on reminders(status, send_at) where status = 'pending';

-- ============================================================
-- outbound_queue — TODA salida pasa por aquí (spec 04)
-- ============================================================
create table if not exists outbound_queue (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  tg_chat_id      bigint not null,
  method          text not null default 'sendMessage',
  payload         jsonb not null,
  status          queue_status not null default 'pending',
  attempts        int not null default 0,
  next_attempt_at timestamptz not null default now(),
  tg_message_id   bigint,
  error           text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_outbox_due
  on outbound_queue(status, next_attempt_at) where status = 'pending';

-- ============================================================
-- events — observabilidad. SIN frontend, esto ES el panel de control.
-- ============================================================
create table if not exists events (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid references workspaces(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  type            text not null,     -- llm_call | tool_call | batch_flush | state_change
                                     -- | send_error | handoff | appointment | guardrail
  level           text not null default 'info' check (level in ('debug','info','warn','error')),
  payload         jsonb not null default '{}',   -- ids, NO cuerpos. PII enmascarada.
  created_at      timestamptz not null default now()
);
create index if not exists idx_events_ws   on events(workspace_id, created_at desc);
create index if not exists idx_events_type on events(workspace_id, type, created_at desc);
create index if not exists idx_events_conv on events(conversation_id, created_at desc);

-- ============================================================
-- handoff_relay — puente grupo interno <=> chat del paciente (spec 13)
-- ============================================================
create table if not exists handoff_relay (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  conversation_id  uuid not null references conversations(id) on delete cascade,
  group_message_id bigint not null,   -- responderlo = escribirle al paciente
  created_at       timestamptz not null default now(),
  constraint uq_relay unique (workspace_id, group_message_id)
);
