#!/usr/bin/env bash
# Spec 13 — verificación. Sale 0 si todo pasa, 1 si algo falla.
#
#   bash scripts/smoke/13.sh
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

sec "1 · escalar_a_humano, take/back y el relay bidireccional (Telegram simulado, DB real)"
out=$(npx tsx scripts/tests/handoff.ts 2>&1)
echo "$out" | sed 's/^/  /'
echo "$out" | grep -q '^FAIL' && fail=1

sec "2 · Se registró al final del catálogo"
grep -q "escalarAHumano," src/tools/registry.ts && ok "escalarAHumano está en el catálogo" || bad "falta en registry.ts"

sec "3 · /humano escala de verdad (handoff_pending + aviso al grupo, no solo 'paused')"
grep -q "enviarAvisoGrupo" src/handlers/commands.ts && ok "handleHumano llama a enviarAvisoGrupo" || bad "no encontrado"
grep -q '"handoff_pending"' src/handlers/commands.ts && ok "handleHumano transiciona a handoff_pending" || bad "sigue en 'paused'"

sec "4 · El grupo interno NO crea contactos ni conversaciones"
grep -q "procesarMensajeDeGrupo" src/ingress/webhook.ts && ok "el webhook desvía el chat del grupo antes del upsert de contacto" || bad "no encontrado"

sec "5 · 🔑 En vivo: con el bot en un grupo real y TELEGRAM_HANDOFF_CHAT_ID puesto"
if [ -z "${TELEGRAM_HANDOFF_CHAT_ID:-}" ]; then
  printf '  \033[33m·\033[0m OMITIDO: falta TELEGRAM_HANDOFF_CHAT_ID. La lógica ya se verificó simulada (bloque 1).\n'
  printf '    Para ponerlo: crea un grupo, añade el bot, desactiva el modo privacidad en\n'
  printf '    @BotFather (o trabaja solo con respuestas directas al aviso), y obtén el\n'
  printf '    chat_id (negativo) con getUpdates o reenviando un mensaje a @userinfobot.\n'
else
  printf '  \033[33m·\033[0m TELEGRAM_HANDOFF_CHAT_ID presente. Guion manual:\n'
  printf '    1. Por Telegram (como paciente), escribe /humano, o pide hablar con una persona.\n'
  printf '       → Debe llegar un aviso al grupo con motivo, resumen y botones.\n'
  printf '    2. Toca "Tomar conversación" → el mensaje del grupo debe EDITARSE mostrando quién la tomó.\n'
  printf '    3. RESPONDE (reply) a ese mensaje en el grupo → el texto debe llegarle al paciente.\n'
  printf '    4. Escribe algo como paciente → debe aparecer en el hilo del grupo.\n'
  printf '    5. Toca "Devolver a la IA" y escribe algo como paciente → la IA debe responder\n'
  printf '       sin contradecir lo que dijo el humano.\n'
  printf '    Revisa en la base:\n'
  printf '      select state, assigned_to, handoff_chat_id from conversations c\n'
  printf '        join workspaces w on w.id = c.workspace_id order by c.updated_at desc limit 1;\n'
fi

printf '\n'
[ $fail -eq 0 ] && { printf '\033[32mSpec 13 OK\033[0m\n'; exit 0; }
printf '\033[31mSpec 13 con fallos\033[0m\n'; exit 1
