#!/usr/bin/env bash
# Spec 09 — verificación. Sale 0 si todo pasa, 1 si algo falla.
#
#   bash scripts/smoke/09.sh
#
# ⚠️ El servidor NO puede estar corriendo (igual que 04/06): su loop de
#    drenado competiría por las mismas filas de prueba.

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

sec "1 · El loop de tool-calling, con DeepSeek simulado"
out=$(npx tsx scripts/tests/loop.ts 2>&1)
echo "$out" | sed 's/^/  /'
echo "$out" | grep -q '^FAIL' && fail=1

sec "2 · Orden del catálogo, fijado y documentado en registry.ts"
grep -q "EL ORDEN ES FIJO" src/tools/registry.ts \
  && ok "el comentario de advertencia está" || bad "falta la advertencia del orden fijo"

sec "3 · 🚩 En vivo: conversación real con tools (gasta céntimos)"
if [ -z "${DEEPSEEK_API_KEY:-}" ] || [ -z "${GOOGLE_SA_EMAIL:-}" ] || \
   [ -z "${GOOGLE_SA_PRIVATE_KEY:-}" ] || [ -z "${GOOGLE_CALENDAR_ID:-}" ]; then
  printf '  \033[33m·\033[0m OMITIDO: faltan DEEPSEEK_API_KEY y/o las 3 variables de Google\n'
  printf '    El loop ya se verificó simulado (bloque 1). Con las credenciales puestas:\n'
  printf '      npx tsx scripts/tests/agente-con-tools.ts\n'
else
  out2=$(npx tsx scripts/tests/agente-con-tools.ts 2>&1)
  echo "$out2" | sed 's/^/  /'
  echo "$out2" | grep -q '^FAIL' && fail=1
fi

sec "4 · No quedaron datos de prueba"
n=$(q "select count(*) from contacts where tg_chat_id between 997000000 and 997999999")
m=$(q "select count(*) from contacts where tg_chat_id between 998000000 and 998999999")
[ "${n:-0}" = "0" ] && [ "${m:-0}" = "0" ] && ok "limpio" || bad "quedaron datos de prueba ($n + $m)"

printf '\n'
[ $fail -eq 0 ] && { printf '\033[32mSpec 09 OK\033[0m\n'; exit 0; }
printf '\033[31mSpec 09 con fallos\033[0m\n'; exit 1
