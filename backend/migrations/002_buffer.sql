-- ============================================================
-- 002_buffer — buffer por silencio
-- Fuente: ../knowledge/raw/00-BLUEPRINT-agente-telegram.md §4.2.2
--
-- La tabla message_batches ya existe (001_init.sql). Esto añade las dos
-- funciones y el job de pg_cron que la hacen funcionar como red de
-- seguridad. Idempotente: re-aplicarla no falla.
-- ============================================================

-- ============================================================
-- buffer_append — reinicia el timer con cada mensaje, el techo gana sobre
-- el silencio. Es la pieza que hace el buffer EXACTO en vez de hasta 10 s
-- tarde: la fuente de verdad es esta fila, el setTimeout de Node es solo
-- un acelerador.
-- ============================================================
create or replace function buffer_append(
  p_ws uuid, p_conv uuid, p_msg uuid,
  p_delay_ms int, p_max_ms int, p_max_msgs int
) returns table (batch_id uuid, fire_at timestamptz, should_flush boolean)
language plpgsql as $$
declare v_id uuid; v_first timestamptz; v_count int; v_fire timestamptz;
begin
  select id, first_msg_at, msg_count into v_id, v_first, v_count
    from message_batches
   where conversation_id = p_conv and status = 'open'
     for update;

  if v_id is null then
    insert into message_batches (workspace_id, conversation_id, fire_at, msg_count)
    values (p_ws, p_conv, now() + (p_delay_ms || ' ms')::interval, 1)
    returning id, message_batches.fire_at into v_id, v_fire;
    v_count := 1;
  else
    -- el techo gana sobre el silencio: fire_at se REESCRIBE, no se extiende
    v_fire := least(now() + (p_delay_ms || ' ms')::interval,
                    v_first + (p_max_ms || ' ms')::interval);
    v_count := v_count + 1;
    update message_batches
       set last_msg_at = now(), fire_at = v_fire, msg_count = v_count
     where id = v_id;
  end if;

  update messages set batch_id = v_id where id = p_msg;
  return query select v_id, v_fire, (v_count >= p_max_msgs);
end $$;

-- ============================================================
-- buffer_claim — reclamo atómico. Lo usan igual el timer en memoria y el
-- cron: solo uno de los dos caminos gana, porque el UPDATE con el WHERE
-- de estado es la carrera resuelta por el propio motor de Postgres.
-- ============================================================
create or replace function buffer_claim(p_batch uuid, p_by text)
returns boolean language sql as $$
  update message_batches
     set status = 'processing', claimed_by = p_by
   where id = p_batch and status in ('open','ready')
  returning true;
$$;

-- ============================================================
-- buffer-sweeper — red de seguridad. Si el proceso de Node muere con un
-- lote abierto, esto lo recoge en ≤10 s y lo empuja al worker.
--
-- ⚠️ Lee worker_url e internal_secret de runtime_config, NO del entorno:
-- pg_cron corre dentro de Postgres y no ve las env vars de Railway. Si esta
-- tabla se desincroniza de las env vars, el barrido falla EN SILENCIO — no
-- aparece ningún error en los logs de la aplicación porque el fallo ocurre
-- aquí dentro. Ver scripts/sync-runtime-config.ts.
-- ============================================================
select cron.unschedule(jobid)
  from cron.job where jobname = 'buffer-sweeper';

select cron.schedule('buffer-sweeper', '10 seconds', $$
  with claimed as (
    update message_batches set status = 'ready'
     where id in (
       select id from message_batches
        where status = 'open' and fire_at <= now()
        order by fire_at
        for update skip locked
        limit 50
     )
    returning id
  )
  select net.http_post(
    url := (select value from runtime_config where key='worker_url')
           || '/internal/batch/process',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-secret', (select value from runtime_config where key='internal_secret')),
    body := jsonb_build_object('batchId', c.id),
    timeout_milliseconds := 3000
  ) from claimed c;
$$);
