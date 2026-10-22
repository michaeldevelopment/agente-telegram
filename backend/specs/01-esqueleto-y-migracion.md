# Spec 01 · Esqueleto y migración

**Depende de:** — · **Entorno:** local + Railway 🚩 · **~50 min**

## Qué construye

El servicio Fastify en TypeScript con `/health`, la validación de variables de entorno, el cliente de Postgres y **el esquema completo de la base de datos**. Al terminar hay una app desplegada en Railway que responde y sabe hablar con Supabase.

Todavía no hay bot: eso es la spec 03.

## Archivos

| Archivo | | Qué va dentro |
|---|---|---|
| `package.json` | nuevo | `fastify`, `postgres`, `zod`, `luxon`, `tsx`, `typescript`. Scripts: `dev`, `build`, `start`, `migrate` |
| `tsconfig.json` | nuevo | `target: ES2022`, `module: node16`, `strict: true` |
| `.env.example` | nuevo | Todas las variables del §12, **sin valores** |
| `.gitignore` | nuevo | `node_modules`, `.env`, `dist` |
| `src/config/env.ts` | nuevo | Esquema Zod de las env vars. **Falla al arrancar** si falta una, no a mitad de una petición |
| `src/db/client.ts` | nuevo | `postgres.js` contra el pooler. `prepare: false` |
| `src/index.ts` | nuevo | Servidor Fastify, `/health`, apagado limpio |
| `migrations/001_init.sql` | nuevo | El §3 completo: extensiones, 8 enums, 16 tablas, índices, triggers |
| `scripts/migrate.ts` | nuevo | Aplica los `.sql` de `migrations/` en orden |

## Qué poner en la migración

**Cópiala del blueprint §3** (líneas 131–480). Está escrita y probada: extensiones, `set_updated_at()`, los 8 enums, `runtime_config`, `workspaces`, `contacts`, `conversations`, `messages`, `message_batches`, `business_info`, `agent_prompts`, `services`, `business_hours`, `closures`, `appointments`, `reminders`, `outbound_queue`, `events`, `handoff_relay`.

**No la reescribas ni la "mejores".** Los cuatro índices únicos parciales son garantías de corrección, no optimización:

```sql
uq_messages_update   -- dedupe de reintentos de Telegram
uq_batch_open        -- un solo lote abierto por conversación
uq_appt_slot         -- el candado real contra doble reserva
uq_reminder          -- un recordatorio de cada tipo por cita
```

Usa `create ... if not exists` y `create or replace` en todo lo que se pueda, para que re-aplicarla no falle.

## `/health`

```json
{ "ok": true, "db": true, "ts": "2026-10-22T18:00:00-05:00" }
```

Que verifique la base de verdad (`select 1`), no que devuelva `true` fijo. Es el healthcheck de Railway.

## Terminada cuando

- [ ] **La migración aplica limpia** sobre una base vacía
      ```
      $ npm run migrate
      aplicando 001_init.sql ... ok
      ```
- [ ] **Re-aplicarla no falla**
      ```
      $ npm run migrate   # otra vez
      aplicando 001_init.sql ... ok
      ```
- [ ] Las 16 tablas existen
      ```sql
      select count(*) from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE';  -- 17 (16 + schema_migrations)
      ```
- [ ] Los 4 índices únicos existen
      ```sql
      select indexname from pg_indexes
       where indexname in ('uq_messages_update','uq_batch_open','uq_appt_slot');
      ```
- [ ] **`/health` en local**
      ```
      $ curl -s localhost:3000/health
      {"ok":true,"db":true,...}
      ```
- [ ] **`/health` en Railway** 🚩 — desplegado y respondiendo en la URL pública
- [ ] Arrancar sin una env var obligatoria **falla de inmediato** con un mensaje que dice cuál falta
- [ ] `scripts/smoke/01.sh` sale con código 0

## Trampas

- **Pooler 6543, no 5432.** Y `prepare: false` en el cliente, o falla de forma intermitente y difícil de reproducir.
- **`tg_chat_id` en `BIGINT`**, nunca `int`. Un `int` desborda con ids reales de Telegram y el bug no aparece en desarrollo.
- `pg_cron` y `pg_net` hay que **habilitarlas en el panel de Supabase**, no solo con `create extension`.
- Railway necesita que el proceso escuche en `process.env.PORT`.
- **Una sola réplica** en Railway. Está configurado así desde el principio por el buffer de la spec 06.

## Referencias

- Blueprint §3 (esquema completo), §6.3 (límites de Supabase), §12 (variables)
- `../../knowledge/wiki/Esquema-de-Datos.md` — por qué cada índice
- `../../knowledge/wiki/Variables-de-Entorno.md`
- `../memoria/una-sola-replica-railway.md`
