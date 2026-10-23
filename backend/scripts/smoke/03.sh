#!/usr/bin/env bash
# Spec 03 — verificación. Sale 0 si todo pasa, 1 si algo falla.
#
#   npm run dev                 # en otra terminal
#   bash scripts/smoke/03.sh
#
# No necesita Telegram ni túnel: simula los updates con curl contra el webhook.

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
[ -f .env ] && set -a && . ./.env && set +a

BASE_URL="${BASE_URL:-http://localhost:${PORT:-3000}}"
WS="${WORKSPACE_SLUG:-clinica-gonzalez}"
fail=0

ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=1; }
sec() { printf '\n\033[1m%s\033[0m\n' "$1"; }
# El SQL va por STDIN: npx en Windows destroza las comillas de los argumentos.
q()    { printf '%s' "$1" | npx tsx scripts/q.ts 2>/dev/null | tr -d '[:space:]'; }
qraw() { printf '%s' "$1" | npx tsx scripts/q.ts 2>/dev/null; }

# El path y el secreto salen del workspace; si están vacíos, del entorno.
WPATH=$(q "select coalesce(webhook_path,'') from workspaces where slug='$WS'")
WSECRET=$(q "select coalesce(webhook_secret,'') from workspaces where slug='$WS'")
[ -z "$WPATH" ]   && WPATH="${TELEGRAM_WEBHOOK_PATH:-}"
[ -z "$WSECRET" ] && WSECRET="${TELEGRAM_WEBHOOK_SECRET:-}"

if [ -z "$WPATH" ] || [ -z "$WSECRET" ]; then
  printf '\033[31m✗ falta TELEGRAM_WEBHOOK_PATH/SECRET\033[0m\n'
  printf '  córrelo: npm run webhook:gen, pega los valores en .env\n'
  exit 1
fi

HOOK="$BASE_URL/tg/$WS/$WPATH"
CHAT=999000111          # chat de prueba, no colisiona con uno real
UID_=$CHAT
H_OK=(-H "content-type: application/json" -H "x-telegram-bot-api-secret-token: $WSECRET")

update() { # $1=update_id $2=texto
  cat <<EOF
{"update_id":$1,"message":{"message_id":$1,"date":$(date +%s),
 "chat":{"id":$CHAT,"type":"private"},
 "from":{"id":$UID_,"first_name":"Prueba","username":"prueba_smoke"},
 "text":"$2"$([ "${2:0:1}" = "/" ] && echo ',"entities":[{"type":"bot_command","offset":0,"length":'"${#2}"'}]')}}
EOF
}

sec "0 · El servidor responde"
curl -sS --max-time 5 "$BASE_URL/health" | grep -q '"db":true' \
  && ok "/health ok" || { bad "no responde (¿npm run dev?)"; exit 1; }

sec "1 · Rechaza lo que no viene de Telegram"
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/tg/$WS/path-inventado" \
     -H "content-type: application/json" -d '{"update_id":1}')
[ "$c" = "404" ] && ok "path inválido → 404" || bad "path inválido → $c, esperaba 404"

c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$HOOK" \
     -H "content-type: application/json" \
     -H "x-telegram-bot-api-secret-token: secreto-equivocado" -d '{"update_id":1}')
[ "$c" = "401" ] && ok "secret inválido → 401" || bad "secret inválido → $c, esperaba 401"

c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$HOOK" \
     -H "content-type: application/json" -d '{"update_id":1}')
[ "$c" = "401" ] && ok "sin header → 401" || bad "sin header → $c, esperaba 401"

c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/tg/no-existe/$WPATH" \
     "${H_OK[@]}" -d '{"update_id":1}')
[ "$c" = "404" ] && ok "workspace inexistente → 404" || bad "workspace inexistente → $c"

sec "2 · El ACK es rápido"
UID1=$(( (RANDOM * 32768 + RANDOM) % 90000000 + 10000000 ))
t=$(curl -s -o /dev/null -w '%{time_total}' -X POST "$HOOK" "${H_OK[@]}" \
      -d "$(update $UID1 '/start')")
ms=$(awk "BEGIN{printf \"%.0f\", $t*1000}")
[ "$ms" -lt 100 ] && ok "ACK en ${ms} ms (< 100)" \
  || printf '  \033[33m·\033[0m ACK en %s ms — por encima de 100, revisa latencia a la base\n' "$ms"

sleep 2

sec "3 · Persistió el mensaje, el contacto y la conversación"
[ "$(q "select count(*) from messages where tg_update_id=$UID1")" = "1" ] \
  && ok "mensaje guardado" || bad "no se guardó el mensaje"
[ "$(q "select kind from messages where tg_update_id=$UID1")" = "command" ] \
  && ok "kind = command" || bad "kind inesperado: $(q "select kind from messages where tg_update_id=$UID1")"
[ "$(q "select count(*) from contacts where tg_chat_id=$CHAT")" = "1" ] \
  && ok "contacto creado" || bad "no se creó el contacto"
[ "$(q "select count(*) from conversations c join contacts ct on ct.id=c.contact_id where ct.tg_chat_id=$CHAT")" = "1" ] \
  && ok "conversación creada" || bad "no se creó la conversación"

sec "4 · DEDUPE: el mismo update_id dos veces"
curl -s -o /dev/null -X POST "$HOOK" "${H_OK[@]}" -d "$(update $UID1 '/start')"
sleep 2
n=$(q "select count(*) from messages where tg_update_id=$UID1")
[ "$n" = "1" ] && ok "sigue habiendo 1 fila (no 2)" || bad "hay $n filas: el dedupe no frenó"

sec "5 · /start respondió"
n=$(q "select count(*) from messages m join conversations c on c.id=m.conversation_id
        join contacts ct on ct.id=c.contact_id
       where ct.tg_chat_id=$CHAT and m.direction='out'")
if [ "${n:-0}" -ge 1 ]; then
  ok "hay $n respuesta(s) registrada(s)"
  qraw "select body from messages m join conversations c on c.id=m.conversation_id
      join contacts ct on ct.id=c.contact_id
     where ct.tg_chat_id=$CHAT and m.direction='out'
     order by m.created_at desc limit 1" | head -c 90 | sed 's/^/      /'
  printf '\n'
else
  printf '  \033[33m·\033[0m sin respuesta: normal si TELEGRAM_BOT_TOKEN está vacío\n'
  printf '    (el chat %s no existe en Telegram; el envío falla pero el ingreso sí se probó)\n' "$CHAT"
fi

sec "6 · /start con payload guarda el origen"
UID2=$(( UID1 + 1 ))
curl -s -o /dev/null -X POST "$HOOK" "${H_OK[@]}" -d "$(update $UID2 '/start instagram')"
sleep 2
src=$(q "select coalesce(source,'') from contacts where tg_chat_id=$CHAT")
[ "$src" = "instagram" ] && ok "source = instagram" || bad "source = '$src', esperaba instagram"

sec "7 · Un update que no pedimos no rompe nada"
UID3=$(( UID1 + 2 ))
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$HOOK" "${H_OK[@]}" \
     -d "{\"update_id\":$UID3,\"poll\":{\"id\":\"1\",\"question\":\"x\"}}")
[ "$c" = "200" ] && ok "ACK 200 y se ignora" || bad "devolvió $c"

sec "8 · Limpieza"
q "delete from messages where conversation_id in (
     select c.id from conversations c join contacts ct on ct.id=c.contact_id
      where ct.tg_chat_id=$CHAT)" > /dev/null
q "delete from conversations where contact_id in (
     select id from contacts where tg_chat_id=$CHAT)" > /dev/null
q "delete from contacts where tg_chat_id=$CHAT" > /dev/null
ok "datos de prueba borrados"

printf '\n'
[ $fail -eq 0 ] && { printf '\033[32mSpec 03 OK\033[0m\n'; exit 0; }
printf '\033[31mSpec 03 con fallos\033[0m\n'; exit 1
