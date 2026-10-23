#!/usr/bin/env bash
# Spec 04 — verificación. Sale 0 si todo pasa, 1 si algo falla.
#
#   bash scripts/smoke/04.sh
#
# No necesita Telegram: el formato se comprueba directo y el drenado contra un
# Telegram simulado.
#
# ⚠️ El servidor NO puede estar corriendo: su loop de drenado competiría por
#    las mismas filas.

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
[ -f .env ] && set -a && . ./.env && set +a

fail=0
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=1; }
sec() { printf '\n\033[1m%s\033[0m\n' "$1"; }
# El SQL va por STDIN: npx en Windows destroza las comillas de los argumentos.
q()   { printf '%s' "$1" | npx tsx scripts/q.ts 2>/dev/null | tr -d '[:space:]'; }

sec "0 · El servidor NO puede estar corriendo"
# El loop de drenado del servidor compite por las mismas filas que el test y
# se las lleva. Sin token de bot las marca 'failed', y el test reporta fallos
# que no son suyos. Mejor negarse con un mensaje claro que mentir.
if curl -sS --max-time 3 "http://localhost:${PORT:-3000}/health" >/dev/null 2>&1; then
  printf '  \033[31m✗\033[0m hay un servidor en el puerto %s\n' "${PORT:-3000}"
  printf '    Páralo y vuelve a correr: los dos drenarían la misma cola.\n'
  exit 1
fi
ok "sin servidor compitiendo por la cola"

sec "1 · Formato: escape, markdown y troceo"
out=$(npx tsx scripts/tests/formato.ts 2>&1)
echo "$out" | sed 's/^/  /'
echo "$out" | grep -q '^FAIL' && fail=1

sec "2 · Drenado contra un Telegram simulado"
out=$(npx tsx scripts/tests/outbox.ts 2>&1)
echo "$out" | sed 's/^/  /'
echo "$out" | grep -q '^FAIL' && fail=1

sec "3 · La cola quedó limpia"
n=$(q "select count(*) from outbound_queue where tg_chat_id between 990000000 and 990999999")
[ "${n:-0}" = "0" ] && ok "sin filas de prueba" || bad "quedaron $n filas de prueba"

printf '\n'
[ $fail -eq 0 ] && { printf '\033[32mSpec 04 OK\033[0m\n'; exit 0; }
printf '\033[31mSpec 04 con fallos\033[0m\n'; exit 1
