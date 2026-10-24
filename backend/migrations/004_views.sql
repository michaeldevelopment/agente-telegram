-- ============================================================
-- 004_views — observabilidad (spec 15)
-- Fuente: ../knowledge/raw/00-BLUEPRINT-agente-telegram.md §11.2
--
-- `create or replace view` es naturalmente idempotente: re-aplicar este
-- archivo no falla. Agrupan en America/Bogota, no en UTC — un día de
-- v_llm_daily es un día de la clínica, no un día partido en dos por UTC-5.
-- ============================================================

-- Costo y eficiencia de cache por día. Es la vista del paso 12 de la demo:
-- "el costo real de todo lo anterior, en centavos".
create or replace view v_llm_daily as
select
  date_trunc('day', created_at at time zone 'America/Bogota')      as dia,
  count(*)                                                         as llamadas,
  sum((payload->>'cacheHit')::bigint)                              as tok_cache_hit,
  sum((payload->>'cacheMiss')::bigint)                             as tok_cache_miss,
  sum((payload->>'outTokens')::bigint)                             as tok_out,
  round(100.0 * sum((payload->>'cacheHit')::numeric)
        / nullif(sum((payload->>'cacheHit')::numeric
                   + (payload->>'cacheMiss')::numeric), 0), 1)     as cache_hit_pct,
  round(sum((payload->>'costUsd')::numeric), 4)                    as costo_usd,
  round(avg((payload->>'latencyMs')::numeric))                     as latencia_ms_prom
from events
where type = 'llm_call'
group by 1 order by 1 desc;

-- Eficacia del buffer: si msgs_por_lote se acerca a 1.0, buffer_ms quedó
-- demasiado corto y el buffer no está consolidando nada.
create or replace view v_buffer as
select
  date_trunc('day', created_at at time zone 'America/Bogota') as dia,
  count(*)                                               as lotes,
  round(avg((payload->>'msgCount')::numeric), 2)         as msgs_por_lote,
  round(avg((payload->>'waitedMs')::numeric))            as espera_ms_prom,
  count(*) filter (where payload->>'triggerReason' = 'max_ms')   as por_techo_tiempo,
  count(*) filter (where payload->>'triggerReason' = 'max_msgs') as por_techo_msgs
from events where type = 'batch_flush'
group by 1 order by 1 desc;

-- Embudo del agendador: conversación → cita. La única vista que le importa
-- directamente al cliente (no es un KPI técnico).
create or replace view v_funnel as
with conv as (select id, workspace_id, created_at from conversations),
     ag   as (select distinct conversation_id from appointments
               where status in ('booked','confirmed','rescheduled','completed')),
     ho   as (select distinct conversation_id from events where type = 'handoff')
select
  count(*)                                                        as conversaciones,
  count(*) filter (where c.id in (select conversation_id from ag)) as con_cita,
  round(100.0 * count(*) filter (where c.id in (select conversation_id from ag))
        / nullif(count(*), 0), 1)                                 as conversion_pct,
  count(*) filter (where c.id in (select conversation_id from ho)) as escaladas
from conv c;
