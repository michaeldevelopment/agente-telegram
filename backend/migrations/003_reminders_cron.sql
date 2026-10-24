-- ============================================================
-- 003_reminders_cron — barrido de recordatorios programados
-- Fuente: ../knowledge/raw/00-BLUEPRINT-agente-telegram.md §4.8
--
-- La tabla `reminders` ya existe (001_init.sql). Esto añade el job de
-- pg_cron que la hace funcionar: cada minuto, SOLO si hay algo vencido,
-- despierta al worker en /internal/reminders/tick.
--
-- Mismo patrón que `buffer-sweeper` (002_buffer.sql): runtime_config, no el
-- entorno — pg_cron corre dentro de Postgres y no ve las env vars de
-- Railway. Idempotente: re-aplicarla no falla.
-- ============================================================

select cron.unschedule(jobid)
  from cron.job where jobname = 'reminders-tick';

-- El `where exists` es la pieza inteligente: sin recordatorios pendientes
-- vencidos, el worker no recibe NINGUNA petición — no 1.440 veces al día
-- para nada.
--
-- ⚠️ pg_cron (gestionado en Supabase) solo acepta formato cron de 5 campos
-- o intervalos '[1-59] seconds' — '1 minute' falla con 22023. '* * * * *'
-- es "cada minuto".
select cron.schedule('reminders-tick', '* * * * *', $$
  select net.http_post(
    url := (select value from runtime_config where key='worker_url')
           || '/internal/reminders/tick',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-secret', (select value from runtime_config where key='internal_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  )
  where exists (select 1 from reminders where status='pending' and send_at <= now());
$$);

-- `cron.job_run_details` crece sin freno (spec 15 · Trampas): purgar lo
-- viejo. Se re-agenda cada noche, barato y sin intervención manual.
select cron.unschedule(jobid)
  from cron.job where jobname = 'cron-purgar-historial';

select cron.schedule('cron-purgar-historial', '17 3 * * *', $$
  delete from cron.job_run_details where end_time < now() - interval '7 days';
$$);
