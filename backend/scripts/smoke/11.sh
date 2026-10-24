#!/usr/bin/env bash
# Spec 11 — verificación. Sale 0 si todo pasa, 1 si algo falla.
#
#   bash scripts/smoke/11.sh
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

sec "1 · reprogramar_cita y cancelar_cita (Google simulado, DB real)"
out=$(npx tsx scripts/tests/reprogramar-cancelar.ts 2>&1)
echo "$out" | sed 's/^/  /'
echo "$out" | grep -q '^FAIL' && fail=1

sec "2 · Se registraron al final del catálogo, sin mover el orden existente"
grep -q "reprogramarCita," src/tools/registry.ts && ok "reprogramarCita está en el catálogo" || bad "falta en registry.ts"
grep -q "cancelarCita," src/tools/registry.ts && ok "cancelarCita está en el catálogo" || bad "falta en registry.ts"

sec "3 · PATCH y DELETE existen en gcal/events.ts (no borrar-y-crear)"
grep -q "gcalPatchEvento" src/gcal/events.ts && ok "gcalPatchEvento existe" || bad "falta gcalPatchEvento"
grep -q "gcalEliminarEvento" src/gcal/events.ts && ok "gcalEliminarEvento existe" || bad "falta gcalEliminarEvento"

sec "4 · 🔑 En vivo: por Telegram, con el bot corriendo y credenciales reales"
if [ -z "${DEEPSEEK_API_KEY:-}" ] || [ -z "${GOOGLE_SA_EMAIL:-}" ] || \
   [ -z "${GOOGLE_SA_PRIVATE_KEY:-}" ] || [ -z "${GOOGLE_CALENDAR_ID:-}" ]; then
  printf '  \033[33m·\033[0m OMITIDO: faltan credenciales. La lógica ya se verificó simulada (bloque 1).\n'
else
  printf '  \033[33m·\033[0m Credenciales presentes. Guion manual:\n'
  printf '    1. Agenda una cita por Telegram (o reusa una existente).\n'
  printf '    2. Escribe "mejor cámbiala para el jueves a las 3pm" (o un horario real).\n'
  printf '       → En Google Calendar debe haber UN evento, a la hora nueva, mismo título.\n'
  printf '    3. Pide disponibilidad para el día ORIGINAL → el horario liberado debe aparecer.\n'
  printf '    4. Escribe "cancela mi cita" y confirma.\n'
  printf '       → El evento debe DESAPARECER de Google Calendar.\n'
  printf '    Revisa en la base: select status, starts_at, gcal_event_id from appointments\n'
  printf '    order by updated_at desc limit 3;\n'
fi

sec "5 · No quedaron datos de prueba"
printf '  \033[33m·\033[0m el test de arriba limpia tras de sí; si falló a mitad, revisa:\n'
printf "    delete from contacts where tg_chat_id between 999100000 and 999100999;\n"

printf '\n'
[ $fail -eq 0 ] && { printf '\033[32mSpec 11 OK\033[0m\n'; exit 0; }
printf '\033[31mSpec 11 con fallos\033[0m\n'; exit 1
