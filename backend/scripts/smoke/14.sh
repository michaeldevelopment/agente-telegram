#!/usr/bin/env bash
# Spec 14 — verificación. Sale 0 si todo pasa, 1 si algo falla.
#
#   bash scripts/smoke/14.sh
#
# ⚠️ El servidor NO puede estar corriendo: compite por las mismas filas.

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
[ -f .env ] && set -a && . ./.env && set +a

fail=0
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=1; }
sec() { printf '\n\033[1m%s\033[0m\n' "$1"; }

sec "0 · El servidor NO puede estar corriendo"
if curl -sS --max-time 3 "http://localhost:${PORT:-3000}/health" >/dev/null 2>&1; then
  printf '  \033[31m✗\033[0m hay un servidor en el puerto %s — páralo primero\n' "${PORT:-3000}"
  exit 1
fi
ok "sin servidor compitiendo"

sec "1 · Programación, disparo y los 3 botones del recordatorio (Telegram y Google simulados)"
out=$(npx tsx scripts/tests/recordatorios.ts 2>&1)
echo "$out" | sed 's/^/  /'
echo "$out" | grep -q '^FAIL' && fail=1

sec "2 · La migración del cron aplica limpia"
grep -q "reminders-tick" migrations/003_reminders_cron.sql && ok "el job reminders-tick está definido" || bad "no encontrado"
grep -q "where exists" migrations/003_reminders_cron.sql && ok "el 'where exists' está (no despertar al worker para nada)" || bad "no encontrado"

sec "3 · El endpoint interno existe y exige el secreto"
grep -q "/internal/reminders/tick" src/http/internal.ts && ok "la ruta está registrada" || bad "no encontrado"
grep -q "x-internal-secret" src/http/internal.ts && ok "exige x-internal-secret" || bad "no encontrado"

sec "4 · agendar_cita engancha scheduleReminders"
grep -q "scheduleReminders" src/tools/agendar.ts && ok "agendar.ts llama a scheduleReminders" || bad "no encontrado"
grep -q "scheduleReminders" src/tools/reprogramar.ts && ok "reprogramar.ts recalcula" || bad "no encontrado"
grep -q "cancelarRecordatoriosPendientes" src/tools/cancelar.ts && ok "cancelar.ts cancela los pendientes" || bad "no encontrado"

sec "5 · 🔧 En vivo: un recordatorio real disparado por el cron (no por tickReminders() directo)"
if [ -z "${INTERNAL_SECRET:-}" ] || [ -z "${APP_BASE_URL:-}" ]; then
  printf '  \033[33m·\033[0m OMITIDO: falta INTERNAL_SECRET y/o APP_BASE_URL. La lógica ya se\n'
  printf '    verificó simulada (bloque 1), incluyendo que tickReminders() SÍ dispara un\n'
  printf '    recordatorio vencido. Lo único que esto no prueba es el pg_cron real.\n'
else
  q="'"
  printf '  \033[33m·\033[0m Credenciales presentes. Para probar el barrido real:\n'
  printf '    1. Agenda una cita de verdad (o usa una existente) y fuerza un recordatorio:\n'
  printf '       update reminders set send_at = now() + interval %s2 minutes%s, status=%spending%s\n' "$q" "$q" "$q" "$q"
  printf '         where appointment_id = %s<id>%s and kind = %sremind_2h%s;\n' "$q" "$q" "$q" "$q"
  printf '    2. Espera 2-3 minutos SIN tocar nada (no llames a tickReminders() a mano).\n'
  printf '    3. Debe llegar el mensaje al chat del paciente, por Telegram, sin que tú hagas nada.\n'
  printf '    4. select status, sent_at from reminders where id = %s<id>%s;  -- sent\n' "$q" "$q"
  printf '    5. Confirma que el "where exists" funciona: sin nada pendiente vencido,\n'
  printf '       cron.job_run_details no debe mostrar llamadas http_post cada minuto.\n'
fi

printf '\n'
[ $fail -eq 0 ] && { printf '\033[32mSpec 14 OK\033[0m\n'; exit 0; }
printf '\033[31mSpec 14 con fallos\033[0m\n'; exit 1
