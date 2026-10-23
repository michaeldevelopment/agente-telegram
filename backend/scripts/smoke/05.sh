#!/usr/bin/env bash
# Spec 05 — verificación. Sale 0 si todo pasa, 1 si algo falla.
#
#   bash scripts/smoke/05.sh
#
# Dos partes:
#   1. OFFLINE — estabilidad del prefijo. Siempre corre, sin clave de API.
#      Es lo que la puerta "cacheHit > 0" protege de verdad.
#   2. EN VIVO — 5 turnos contra DeepSeek. Solo si hay DEEPSEEK_API_KEY.
#      Gasta llamadas reales (céntimos de céntimo).

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
[ -f .env ] && set -a && . ./.env && set +a

fail=0
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=1; }
sec() { printf '\n\033[1m%s\033[0m\n' "$1"; }
q()   { printf '%s' "$1" | npx tsx scripts/q.ts 2>/dev/null | tr -d '[:space:]'; }

sec "1 · Prefijo estable (offline — esto es lo que protege la puerta)"
out=$(npx tsx scripts/tests/prefijo.ts 2>&1)
echo "$out" | sed 's/^/  /'
echo "$out" | grep -q '^FAIL' && fail=1

sec "2 · Configuración del modelo"
grep -q 'reasoning_effort: "none"' src/llm/deepseek.ts \
  && ok 'reasoning_effort: "none" (thinking apagado — 17× en costo)' \
  || bad 'FALTA reasoning_effort: "none"'
grep -qE 'max_tokens: opts.maxTokens \?\? 400' src/llm/deepseek.ts \
  && ok "max_tokens 400 como techo" || bad "max_tokens sin techo"
case "${DEEPSEEK_MODEL:-deepseek-flash}" in
  deepseek-chat|deepseek-reasoner) bad "modelo RETIRADO: ${DEEPSEEK_MODEL}" ;;
  *) ok "modelo ${DEEPSEEK_MODEL:-deepseek-flash}" ;;
esac
grep -q 'status === 402' src/llm/deepseek.ts \
  && ok "402 (sin saldo) no se reintenta" || bad "402 no está diferenciado del 429"

sec "3 · Cálculo de costo"
out=$(npx tsx scripts/tests/costo.ts 2>&1)
echo "$out" | sed 's/^/  /'
echo "$out" | grep -q '^FAIL' && fail=1

sec "4 · 🚩 La puerta, en vivo"
if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
  printf '  \033[33m·\033[0m OMITIDO: falta DEEPSEEK_API_KEY en .env\n'
  printf '    El prefijo ya se verificó offline (bloque 1), que es la causa\n'
  printf '    raíz de un cache hit en 0. Con la clave puesta, corre:\n'
  printf '      npx tsx scripts/tests/agente-vivo.ts\n'
else
  out=$(npx tsx scripts/tests/agente-vivo.ts 2>&1)
  echo "$out" | sed 's/^/  /'
  echo "$out" | grep -q '^FAIL' && fail=1
fi

sec "5 · No quedaron datos de prueba"
n=$(q "select count(*) from contacts where tg_chat_id between 991000000 and 991999999")
[ "${n:-0}" = "0" ] && ok "limpio" || bad "quedaron $n contactos de prueba"

printf '\n'
[ $fail -eq 0 ] && { printf '\033[32mSpec 05 OK\033[0m\n'; exit 0; }
printf '\033[31mSpec 05 con fallos\033[0m\n'; exit 1
