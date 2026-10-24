#!/usr/bin/env bash
# Spec 12 — verificación. Sale 0 si todo pasa, 1 si algo falla.
#
#   bash scripts/smoke/12.sh
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

sec "1 · Botón bk: agenda sin pasar por el agente (Telegram y Google simulados)"
out=$(npx tsx scripts/tests/botones.ts 2>&1)
echo "$out" | sed 's/^/  /'
echo "$out" | grep -q '^FAIL' && fail=1

sec "2 · Reusa agendarCita.run(), no hay una segunda ruta de agendamiento"
grep -q 'agendarCita.run(' src/handlers/callbacks.ts && ok "handleBk llama a agendarCita.run()" || bad "no encontrado"

sec "3 · answerCallbackQuery en TODAS las ramas del switch"
# Cuenta las ramas (case) contra las llamadas a answerCallbackQuery; es una
# señal, no una prueba formal — lo que de verdad lo prueba es el test 1.
ramas=$(grep -c '^\s*case "' src/handlers/callbacks.ts)
llamadas=$(grep -c 'answerCallbackQuery(' src/handlers/callbacks.ts)
[ "$llamadas" -ge "$ramas" ] && ok "hay al menos tantas llamadas a answerCallbackQuery como ramas ($llamadas ≥ $ramas)" \
  || bad "revisa manualmente: $llamadas llamadas, $ramas ramas"

sec "4 · 🔑 En vivo: 0 llamadas al LLM entre el toque y la confirmación"
if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${GOOGLE_SA_EMAIL:-}" ]; then
  printf '  \033[33m·\033[0m OMITIDO: faltan credenciales. La lógica ya se verificó simulada (bloque 1).\n'
else
  printf '  \033[33m·\033[0m Credenciales presentes. Guion manual:\n'
  printf '    1. Por Telegram, pide disponibilidad → deben llegar botones (hasta 4), uno por fila.\n'
  printf '    2. Anota la hora exacta: select now();\n'
  printf '    3. Toca un botón.\n'
  printf '       → Debe confirmar casi al instante y los botones deben desaparecer del mensaje.\n'
  printf '    4. Verifica CERO llamadas al modelo desde el paso 2:\n'
  printf '       select count(*) from events where type=%sllm_call%s\n' "'" "'"
  printf '         and created_at > %s<momento del paso 2>%s;   -- debe ser 0\n' "'" "'"
  printf '    5. Repite el paso de disponibilidad, toca un botón, y antes de que confirme\n'
  printf '       agenda ESE MISMO horario desde otra conversación (o espera a que alguien más\n'
  printf '       lo tome) → debe avisar "se acaba de ocupar" con alternativas, sin romperse.\n'
fi

printf '\n'
[ $fail -eq 0 ] && { printf '\033[32mSpec 12 OK\033[0m\n'; exit 0; }
printf '\033[31mSpec 12 con fallos\033[0m\n'; exit 1
