#!/usr/bin/env bash
# Spec 10 — verificación. Sale 0 si todo pasa, 1 si algo falla.
#
#   bash scripts/smoke/10.sh
#
# ⚠️ El servidor NO puede estar corriendo: compite por las mismas filas.

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
  printf '  \033[31m✗\033[0m hay un servidor en el puerto %s — páralo primero\n' "${PORT:-3000}"
  exit 1
fi
ok "sin servidor compitiendo"

sec "1 · agendar_cita — idempotencia, carrera y validaciones (Google simulado, DB real)"
out=$(npx tsx scripts/tests/agendar.ts 2>&1)
echo "$out" | sed 's/^/  /'
echo "$out" | grep -q '^FAIL' && fail=1

sec "2 · Se registró al final del catálogo, sin mover el orden existente"
grep -q "agendarCita," src/tools/registry.ts && ok "agendarCita está en el catálogo" || bad "falta en registry.ts"

sec "3 · 🚩 En vivo: agenda de verdad en el calendario del cliente"
if [ -z "${DEEPSEEK_API_KEY:-}" ] || [ -z "${GOOGLE_SA_EMAIL:-}" ] || \
   [ -z "${GOOGLE_SA_PRIVATE_KEY:-}" ] || [ -z "${GOOGLE_CALENDAR_ID:-}" ]; then
  printf '  \033[33m·\033[0m OMITIDO: faltan DEEPSEEK_API_KEY y/o las 3 variables de Google\n'
  printf '    La lógica ya se verificó simulada (bloque 1). Con las credenciales puestas, la\n'
  printf '    forma más fiel de probarlo es una conversación real por Telegram que termine en\n'
  printf '    "sí, resérvala" — y abrir Google Calendar para comprobar a ojo:\n'
  printf '      - la cita aparece a la hora correcta (NO corrida 5 horas)\n'
  printf '      - el título trae el servicio y el nombre del paciente\n'
  printf '      - no hay invitados (la Service Account no puede invitar sin delegación)\n'
  printf '    Bórrala del calendario después: es una cita de prueba.\n'
else
  printf '  \033[33m·\033[0m Credenciales presentes. Esto YA inserta un evento real — pruébalo\n'
  printf '    a mano por Telegram (no se automatiza aquí para no agendar citas de prueba\n'
  printf '    sin que decidas cuándo). Ver "Cómo probarla" de la spec 10 para el guion exacto.\n'
fi

sec "4 · No quedaron datos de prueba"
n=$(q "select count(*) from contacts where tg_chat_id between 999000000 and 999999999")
[ "${n:-0}" = "0" ] && ok "limpio" || bad "quedaron datos de prueba ($n)"

printf '\n'
[ $fail -eq 0 ] && { printf '\033[32mSpec 10 OK\033[0m\n'; exit 0; }
printf '\033[31mSpec 10 con fallos\033[0m\n'; exit 1
