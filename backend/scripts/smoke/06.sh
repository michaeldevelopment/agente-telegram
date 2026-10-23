#!/usr/bin/env bash
# Spec 06 — verificación. Sale 0 si todo pasa, 1 si algo falla.
#
#   bash scripts/smoke/06.sh
#
# ⚠️ El servidor NO puede estar corriendo: su propio loop de drenado y
#    (si estuviera levantado) cualquier timer de buffer en memoria
#    competirían por las mismas filas que este test.

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
[ -f .env ] && set -a && . ./.env && set +a

fail=0
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=1; }
sec() { printf '\n\033[1m%s\033[0m\n' "$1"; }
q()   { printf '%s' "$1" | npx tsx scripts/q.ts 2>/dev/null | tr -d '[:space:]'; }

sec "0 · El servidor NO puede estar corriendo"
if curl -sS --max-time 3 "http://localhost:${PORT:-3000}/health" >/dev/null 2>&1; then
  printf '  \033[31m✗\033[0m hay un servidor en el puerto %s\n' "${PORT:-3000}"
  printf '    Páralo: su loop de drenado y sus timers competirían con el test.\n'
  exit 1
fi
ok "sin servidor compitiendo por la cola ni por los timers"

sec "1 · La migración se aplicó"
n=$(q "select count(*) from pg_proc where proname in ('buffer_append','buffer_claim')")
[ "$n" = "2" ] && ok "buffer_append y buffer_claim existen" || bad "faltan funciones ($n/2)"

sec "2 · El cron está programado"
# scripts/q.ts imprime los booleanos como "true"/"false" (String() sobre el
# valor JS), no como el "t"/"f" de psql -- no son lo mismo.
estado=$(q "select active from cron.job where jobname='buffer-sweeper'")
[ "$estado" = "true" ] && ok "buffer-sweeper activo cada 10 s" || bad "buffer-sweeper no está programado o inactivo ('$estado')"

sec "3 · runtime_config sincronizada con las env vars"
# Esta es LA trampa de la spec: si se desincroniza, el barrido falla EN
# SILENCIO — sin esto, nada en los logs de la app avisaría del problema.
cfg_worker=$(q "select value from runtime_config where key='worker_url'")
cfg_secret=$(q "select value from runtime_config where key='internal_secret'")
if [ -z "${APP_BASE_URL:-}" ] || [ -z "${INTERNAL_SECRET:-}" ]; then
  printf '  \033[33m·\033[0m APP_BASE_URL/INTERNAL_SECRET no están en .env: omitido\n'
  printf '    Corre: npm run runtime-config (después de ponerlas)\n'
else
  [ "$cfg_worker" = "${APP_BASE_URL%/}" ] && ok "worker_url coincide con APP_BASE_URL" \
    || bad "worker_url ('$cfg_worker') ≠ APP_BASE_URL ('$APP_BASE_URL') — corre npm run runtime-config"
  [ "$cfg_secret" = "$INTERNAL_SECRET" ] && ok "internal_secret coincide con INTERNAL_SECRET" \
    || bad "internal_secret desincronizado — corre npm run runtime-config"
fi

sec "4 · Configuración no negociable"
grep -q 'reasoning_effort: "none"' src/llm/deepseek.ts \
  && ok "el agente del buffer sigue con thinking apagado" || bad "falta reasoning_effort none"
grep -q "status = 'open'" migrations/002_buffer.sql \
  && ok "buffer-sweeper solo reclama lotes 'open'" || bad "el sweeper no filtra por status"
grep -q "for update skip locked" migrations/002_buffer.sql \
  && ok "el barrido usa SKIP LOCKED (no se pisa con una corrida concurrente)" || bad "falta SKIP LOCKED"

sec "5 · Mecánica del buffer (SQL + timers + agente simulado)"
out=$(npx tsx scripts/tests/buffer.ts 2>&1)
echo "$out" | sed 's/^/  /'
echo "$out" | grep -q '^FAIL' && fail=1

sec "6 · No quedaron datos de prueba"
n=$(q "select count(*) from contacts where tg_chat_id between 992000000 and 992999999")
[ "${n:-0}" = "0" ] && ok "limpio" || bad "quedaron $n contactos de prueba"

printf '\n'
[ $fail -eq 0 ] && { printf '\033[32mSpec 06 OK\033[0m\n'; exit 0; }
printf '\033[31mSpec 06 con fallos\033[0m\n'; exit 1
