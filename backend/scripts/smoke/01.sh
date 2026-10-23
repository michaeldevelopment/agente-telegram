#!/usr/bin/env bash
# Spec 01 — verificación. Sale 0 si todo pasa, 1 si algo falla.
#
#   bash scripts/smoke/01.sh              # contra localhost:3000
#   BASE_URL=https://x.up.railway.app bash scripts/smoke/01.sh
#
# Necesita: curl y node. Las consultas van por scripts/q.ts.

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
[ -f .env ] && set -a && . ./.env && set +a

BASE_URL="${BASE_URL:-http://localhost:${PORT:-3000}}"
fail=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=1; }
head() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# psql no está instalado en todas las máquinas; el helper usa el driver del proyecto.
q() { printf '%s' "$1" | npx tsx scripts/q.ts 2>/dev/null | tr -d '[:space:]'; }

head "1 · /health en $BASE_URL"
body=$(curl -sS --max-time 10 "$BASE_URL/health" 2>/dev/null)
if [ -z "$body" ]; then
  bad "no respondió (¿está corriendo? npm run dev)"
else
  echo "$body" | grep -q '"ok":true' && ok "ok:true" || bad "ok no es true: $body"
  echo "$body" | grep -q '"db":true' && ok "db:true"  || bad "db no es true: $body"
fi

head "2 · Las 16 tablas del esquema"
# Una sola consulta: 16 llamadas seguidas agotan el pooler de Supabase y
# devuelven falsos negativos ("falta la tabla X" cuando sí está).
faltantes=$(q "
  select coalesce(string_agg(t, ','), '') from unnest(array[
    'runtime_config','workspaces','contacts','conversations','messages',
    'message_batches','business_info','agent_prompts','services',
    'business_hours','closures','appointments','reminders',
    'outbound_queue','events','handoff_relay'
  ]) as t where to_regclass('public.' || t) is null")
[ -z "$faltantes" ] && ok "las 16 existen" || bad "faltan: $faltantes"

head "3 · Los índices únicos que son garantías"
for i in uq_messages_update uq_batch_open uq_appt_slot; do
  [ "$(q "select count(*) from pg_indexes where indexname='$i'")" = "1" ] \
    && ok "$i" || bad "falta el índice $i"
done
[ "$(q "select count(*) from pg_constraint where conname='uq_reminder'")" = "1" ] \
  && ok "uq_reminder" || bad "falta la constraint uq_reminder"

head "4 · Los 8 enums"
n=$(q "select count(*) from pg_type where typname in
       ('agent_type','conversation_state','msg_direction','msg_kind',
        'batch_status','appt_status','reminder_kind','queue_status')")
[ "$n" = "8" ] && ok "los 8 existen" || bad "hay $n de 8 enums"

head "5 · tg_chat_id es BIGINT, no int"
malos=$(q "
  select coalesce(string_agg(table_name || '=' || data_type, ', '), '')
    from information_schema.columns
   where column_name = 'tg_chat_id' and data_type <> 'bigint'")
[ -z "$malos" ] && ok "todas las columnas tg_chat_id son bigint" || bad "no son bigint: $malos"

head "6 · Conexión por el pooler 6543"
case "${DATABASE_URL:-}" in
  *:6543/*) ok "puerto 6543" ;;
  *:5432/*) bad "estás en el 5432 directo, usa el pooler 6543" ;;
  *)        printf '  \033[33m·\033[0m puerto no reconocido en DATABASE_URL\n' ;;
esac

printf '\n'
[ $fail -eq 0 ] && { printf '\033[32mSpec 01 OK\033[0m\n'; exit 0; }
printf '\033[31mSpec 01 con fallos\033[0m\n'; exit 1
