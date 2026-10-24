#!/usr/bin/env bash
# Spec 08 — verificación. Sale 0 si todo pasa, 1 si algo falla.
#
#   bash scripts/smoke/08.sh
#
# Dos partes:
#   1. OFFLINE — computeSlotsFromBusy. Siempre corre, sin Google.
#   2. EN VIVO — contra el calendario real. Solo si hay GOOGLE_SA_EMAIL,
#      GOOGLE_SA_PRIVATE_KEY y GOOGLE_CALENDAR_ID en .env.

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
[ -f .env ] && set -a && . ./.env && set +a

fail=0
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=1; }
sec() { printf '\n\033[1m%s\033[0m\n' "$1"; }

sec "1 · Motor de slots (offline — esto es lo que la demo necesita para ser confiable)"
out=$(npx tsx scripts/tests/slots.ts 2>&1)
echo "$out" | sed 's/^/  /'
echo "$out" | grep -q '^FAIL' && fail=1

sec "2 · 🚩 Contra el calendario real"
if [ -z "${GOOGLE_SA_EMAIL:-}" ] || [ -z "${GOOGLE_SA_PRIVATE_KEY:-}" ] || [ -z "${GOOGLE_CALENDAR_ID:-}" ]; then
  printf '  \033[33m·\033[0m OMITIDO: faltan GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY / GOOGLE_CALENDAR_ID\n'
  printf '    Ver "Puesta en marcha" en specs/08-google-calendar-y-slots.md.\n'
  printf '    Con las credenciales puestas, corre:\n'
  printf '      npx tsx scripts/slots-demo.ts limpieza-dental\n'
else
  SLUG="${1:-limpieza-dental}"
  out1=$(npx tsx scripts/slots-demo.ts "$SLUG" 2>&1)
  rc1=$?
  echo "$out1" | sed 's/^/  /'
  if [ $rc1 -ne 0 ]; then
    bad "el script falló — revisa que el calendario esté compartido con la SA"
  else
    ok "el script imprimió slots reales"
    n=$(echo "$out1" | grep -oE '^\([0-9]+ slot' | grep -oE '[0-9]+')
    if [ -n "$n" ] && [ "$n" -gt 4 ]; then bad "devolvió más de 4 slots ($n)"; fi

    # Cache: una segunda llamada inmediata NO debería hacer otra petición a
    # Google (ventana de 60s). No hay forma de contarlo desde fuera del
    # proceso sin instrumentar la red, así que medimos LATENCIA como proxy:
    # la segunda corrida debería ser notablemente más rápida.
    t0=$(date +%s%N)
    npx tsx scripts/slots-demo.ts "$SLUG" > /dev/null 2>&1
    t1=$(date +%s%N)
    ms=$(( (t1 - t0) / 1000000 ))
    printf '  \033[33m·\033[0m segunda corrida: %sms (si el cache funciona, debería sentirse instantánea)\n' "$ms"

    echo "$out1" | grep -qE '[+-][0-9]{2}:[0-9]{2}$' \
      && ok "las horas llevan offset (sin el bug de corrimiento de 5h)" \
      || bad "no veo offset en las horas impresas"
  fi

  sec "3 · El error de configuración falla RUIDOSAMENTE"
  out2=$(GOOGLE_CALENDAR_ID="no-existe-${RANDOM}@example.com" npx tsx scripts/slots-demo.ts "$SLUG" 2>&1)
  rc2=$?
  if [ $rc2 -ne 0 ] && echo "$out2" | grep -qiE "no está compartido|notFound|CalendarioNoCompartido"; then
    ok "con un GOOGLE_CALENDAR_ID inválido, aborta con un mensaje claro (no 'todo libre')"
  else
    bad "no abortó como se esperaba: $out2"
  fi
fi

printf '\n'
[ $fail -eq 0 ] && { printf '\033[32mSpec 08 OK\033[0m\n'; exit 0; }
printf '\033[31mSpec 08 con fallos\033[0m\n'; exit 1
