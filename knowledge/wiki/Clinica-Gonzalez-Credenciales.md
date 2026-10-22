---
titulo: Clínica González · Credenciales
tipo: cliente
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §12 + §10.3"
actualizado: 2026-10-22
tags: [credenciales, secretos, inventario, seguridad]
---

# Clínica González · Credenciales

> # ⛔ NINGÚN VALOR EN ESTA PÁGINA
>
> Esta página documenta **qué secreto existe, qué contiene y dónde vive**. El valor, **nunca**. Es una regla dura del vault, en `CLAUDE.md`.
>
> Si alguien pega un valor aquí, hay que borrarlo **y rotar ese secreto**, porque ya estuvo en disco sin cifrar y posiblemente en un historial de sincronización.

## Inventario

| Variable | Qué contiene | Dónde vive | Quién la emite | Estado |
|---|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Token del bot de la clínica | Railway → env | @BotFather | ⬜ pendiente |
| `TELEGRAM_WEBHOOK_SECRET` | 64 chars `[A-Za-z0-9_-]`, el `secret_token` de `setWebhook` | Railway → env | Generado por nosotros | ⬜ pendiente |
| `TELEGRAM_WEBHOOK_PATH` | Segmento aleatorio del path público | Railway → env | Generado por nosotros | ⬜ pendiente |
| `TELEGRAM_HANDOFF_CHAT_ID` | Id del grupo interno. **Negativo** | Railway → env | Telegram, al crear el grupo | ⬜ pendiente |
| `DEEPSEEK_API_KEY` | Clave de la API | Railway → env | platform.deepseek.com | ⬜ pendiente |
| `SUPABASE_URL` | URL del proyecto | Railway → env | Supabase | ⬜ pendiente |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave `service_role`. **Acceso total a la base** | Railway → env | Supabase | ⬜ pendiente |
| `DATABASE_URL` | Conexión Postgres, **pooler 6543** | Railway → env | Supabase | ⬜ pendiente |
| `GOOGLE_SA_EMAIL` | Email de la Service Account | Railway → env | Google Cloud | ⬜ pendiente |
| `GOOGLE_SA_PRIVATE_KEY` | Clave privada del JSON, **en base64** | Railway → env | Google Cloud | ⬜ pendiente |
| `GOOGLE_CALENDAR_ID` | Calendario compartido con la SA | Railway → env | Google Calendar | ⬜ pendiente |
| `INTERNAL_SECRET` | Header `x-internal-secret` para `pg_cron` → worker | Railway → env **y** `runtime_config` en Supabase | Generado por nosotros | ⬜ pendiente |
| `APP_BASE_URL` | `https://<app>.up.railway.app` | Railway → env **y** `runtime_config` | Railway | ⬜ pendiente |
| `ENCRYPTION_KEY` | Clave de `pgp_sym_encrypt` | Railway → env | Generado por nosotros | ⬜ no aplica en la demo |

No secretas pero de configuración: `DEEPSEEK_MODEL=deepseek-flash`, `WORKSPACE_SLUG=clinica-gonzalez`, `TZ=America/Bogota`, `LOG_LEVEL=info`. Ver [[Variables-de-Entorno]].

## Los tres que aparecen en dos sitios

`INTERNAL_SECRET` y `APP_BASE_URL` van **tanto en Railway como en la tabla `runtime_config` de Supabase**, porque `pg_cron` necesita saber a dónde llamar y con qué header:

```sql
insert into runtime_config (key, value) values
  ('worker_url',      '<APP_BASE_URL>'),
  ('internal_secret', '<el mismo INTERNAL_SECRET>')
on conflict (key) do update set value = excluded.value;
```

**Si se desincronizan, los barridos de `pg_cron` fallan en silencio**: el buffer deja de tener red de seguridad y los recordatorios no se envían. No hay error visible en ningún log de aplicación, porque el fallo ocurre en Postgres. Ver [[Buffer-y-Batching]] y [[Recordatorios-Programados]].

## Los dos más peligrosos

- **`SUPABASE_SERVICE_ROLE_KEY`** — salta todo el RLS (que además no está activo). Es acceso total a la base. Solo en el worker, nunca en nada que llegue a un navegador.
- **`GOOGLE_SA_PRIVATE_KEY`** — permite escribir en el calendario del propietario del proyecto. En base64 para evitar los bugs de los `\n` literales, pero sigue siendo una clave privada.

## Notas por secreto

**`TELEGRAM_BOT_TOKEN`** — en esta demo de un solo cliente va en la env var y `workspaces.bot_token_enc` queda nula. **Con el segundo cliente** pasa a la columna cifrada con `pgp_sym_encrypt`, y ahí sí hace falta `ENCRYPTION_KEY`. Ver [[Multi-Cliente]].

**`TELEGRAM_WEBHOOK_PATH`** — no es un secreto de alta entropía pero **la URL completa del webhook sí lo es**, porque combina path y dominio. No pegarla en ningún sitio. Si se cambia, hay que re-llamar a `setWebhook`.

**`GOOGLE_CALENDAR_ID`** — para un calendario personal es el propio correo. No es secreto, pero es PII.

## Si se filtra algo

1. **Rotar inmediatamente** en el emisor (@BotFather para el bot, Google Cloud para la SA, Supabase para las keys).
2. Actualizar Railway y, si aplica, `runtime_config`.
3. Re-llamar a `setWebhook` si cambió el token o el secret.
4. Anotarlo en `log.md` como entrada `decision`.

## Relacionado

- [[Variables-de-Entorno]] — la lista completa con su propósito
- [[Seguridad]] — superficie por superficie
- [[Checklist-de-Onboarding]] — en qué orden se obtienen
- [[Google-Calendar]] — cómo se genera la SA
- [[Clinica-Gonzalez-Pendientes]] — qué falta
