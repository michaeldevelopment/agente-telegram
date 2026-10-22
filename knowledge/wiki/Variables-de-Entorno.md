---
titulo: Variables de entorno
tipo: operacion
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §12"
actualizado: 2026-10-22
tags: [configuracion, env, railway, operacion]
---

# Variables de entorno

La configuración completa del worker. **Los valores no están aquí ni en ninguna página del vault** — ver [[Clinica-Gonzalez-Credenciales]] para el inventario de dónde vive cada uno.

```bash
# ── Telegram
TELEGRAM_BOT_TOKEN=            # de @BotFather
TELEGRAM_WEBHOOK_SECRET=       # 64 chars [A-Za-z0-9_-] → secret_token de setWebhook
TELEGRAM_WEBHOOK_PATH=         # segmento aleatorio del path público
TELEGRAM_HANDOFF_CHAT_ID=      # id del grupo interno (NEGATIVO para grupos)

# ── DeepSeek
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-flash  # NO deepseek-chat (retirado el 24-jul-2026)

# ── Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=                  # pooler puerto 6543, con prepare:false en el cliente

# ── Google Calendar
GOOGLE_SA_EMAIL=
GOOGLE_SA_PRIVATE_KEY=         # clave privada del JSON, en BASE64
GOOGLE_CALENDAR_ID=            # el correo del calendario compartido con la SA

# ── Interno
INTERNAL_SECRET=               # header x-internal-secret para pg_cron → worker
APP_BASE_URL=                  # https://<app>.up.railway.app
ENCRYPTION_KEY=                # clave de pgp_sym_encrypt (solo si se cifran tokens en DB)

# ── Runtime
WORKSPACE_SLUG=clinica-gonzalez
TZ=America/Bogota
LOG_LEVEL=info
```

## La parte que vive en Supabase

`pg_cron` no lee el entorno de Railway. Necesita su propia copia en `runtime_config`:

```sql
insert into runtime_config (key, value) values
  ('worker_url',      'https://<app>.up.railway.app'),
  ('internal_secret', '<el mismo INTERNAL_SECRET>')
on conflict (key) do update set value = excluded.value;
```

> ⚠️ **Estas dos tienen que coincidir con las env vars de Railway.** Si se desincronizan, los barridos fallan en silencio: el buffer pierde su red de seguridad y los recordatorios no se envían. No aparece ningún error en los logs de la aplicación, porque el fallo ocurre dentro de Postgres.

Es el fallo más difícil de diagnosticar del sistema, y por eso está repetido en varias páginas.

## Las que tienen trampa

| Variable | Trampa |
|---|---|
| `DEEPSEEK_MODEL` | `deepseek-chat` y `deepseek-reasoner` están **retirados** desde el 24-jul-2026 |
| `GOOGLE_SA_PRIVATE_KEY` | **En base64.** Pegada directa del JSON trae `\n` literales que rompen el parseo |
| `TELEGRAM_HANDOFF_CHAT_ID` | Los ids de grupo son **negativos**. Guardarlo sin el signo rompe el handoff en silencio |
| `DATABASE_URL` | Puerto **6543** (pooler), no 5432. Y `prepare: false` en el cliente |
| `TZ` | `America/Bogota`, no `UTC`. Luxon usa `workspaces.timezone`, pero el proceso también debe estar en hora local para los logs |
| `ENCRYPTION_KEY` | No aplica en la demo de un cliente. Obligatoria desde el segundo |

## Valores que NO son env vars

Configuración de comportamiento que vive en la **base de datos**, por workspace, porque es dato del cliente y no del despliegue:

`buffer_ms`, `buffer_max_ms`, `buffer_max_msgs`, `quiet_from`, `quiet_to`, `timezone`, `locale`, `currency`, `agent_type`, `handoff_chat_id`.

Es la separación de [[Multi-Cliente]]: añadir un cliente no debe tocar el entorno del worker.

> `TELEGRAM_HANDOFF_CHAT_ID` aparece en las dos listas a propósito: en la demo de un solo cliente va por env var, y pasa a `workspaces.handoff_chat_id` con el segundo.

## Relacionado

- [[Clinica-Gonzalez-Credenciales]] — dónde vive cada valor
- [[Checklist-de-Onboarding]] — en qué orden se obtienen
- [[Seguridad]] — cómo se protegen
- [[Gotchas]] — el checklist antes de deploy
- [[Esquema-de-Datos]] — `runtime_config`
