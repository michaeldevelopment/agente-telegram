#!/usr/bin/env bash
# Suite de tests para el pre-commit: SOLO lo determinista y gratis.
#
# A propósito NO incluye las pruebas 🚩 en vivo (agente-vivo.ts,
# agente-con-tools.ts, agendar-vivo.ts) — esas llaman a DeepSeek y/o Google
# de verdad y cuestan dinero o agendan citas reales. Correrlas en cada
# commit sería gastar en cada `git commit`; se siguen corriendo a mano o
# vía `npm run smoke:NN` cuando hay credenciales y se quiere verificar.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
[ -f .env ] && set -a && . ./.env && set +a

if curl -sS --max-time 3 "http://localhost:${PORT:-3000}/health" >/dev/null 2>&1; then
  printf '\033[31m✗\033[0m hay un servidor en el puerto %s — páralo antes de correr los tests\n' "${PORT:-3000}"
  exit 1
fi

fail=0
pruebas=(
  costo decide formato slots
  buffer estado loop outbox prefijo
  agendar reprogramar-cancelar botones handoff recordatorios guardrails
)

for t in "${pruebas[@]}"; do
  printf '\n\033[1m· %s\033[0m\n' "$t"
  out=$(npx tsx "scripts/tests/$t.ts" 2>&1)
  echo "$out" | sed 's/^/  /'
  echo "$out" | grep -q '^FAIL' && fail=1
done

printf '\n'
[ $fail -eq 0 ] && { printf '\033[32mtodos los tests OK\033[0m\n'; exit 0; }
printf '\033[31mhay tests con fallos\033[0m\n'; exit 1
