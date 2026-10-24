#!/usr/bin/env bash
# Spec 07 — verificación. Sale 0 si todo pasa, 1 si algo falla.
#
#   npm run dev              # en otra terminal
#   bash scripts/smoke/07.sh
#
# A diferencia de 04/06, esta SÍ necesita el servidor corriendo: /humano,
# /start y los botones se prueban de punta a punta por HTTP.

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
[ -f .env ] && set -a && . ./.env && set +a

BASE_URL="${BASE_URL:-http://localhost:${PORT:-3000}}"
WS="${WORKSPACE_SLUG:-clinica-gonzalez}"
fail=0

ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=1; }
sec() { printf '\n\033[1m%s\033[0m\n' "$1"; }
q()    { printf '%s' "$1" | npx tsx scripts/q.ts 2>/dev/null | tr -d '[:space:]'; }
qraw() { printf '%s' "$1" | npx tsx scripts/q.ts 2>/dev/null; }

sec "0 · El servidor responde"
curl -sS --max-time 5 "$BASE_URL/health" | grep -q '"db":true' \
  && ok "/health ok" || { bad "no responde (¿npm run dev?)"; exit 1; }

sec "1 · decide() — pura, sin red ni base"
out=$(npx tsx scripts/tests/decide.ts 2>&1)
echo "$out" | sed 's/^/  /'
echo "$out" | grep -q '^FAIL' && fail=1

sec "2 · transitionState / getEstadoConversacion / buffer+decide integrados"
out=$(npx tsx scripts/tests/estado.ts 2>&1)
echo "$out" | sed 's/^/  /'
echo "$out" | grep -q '^FAIL' && fail=1

# ── Credenciales reales del workspace, para hablar con el webhook por HTTP ──
WPATH=$(q "select coalesce(webhook_path,'') from workspaces where slug='$WS'")
WSECRET=$(q "select coalesce(webhook_secret,'') from workspaces where slug='$WS'")
[ -z "$WPATH" ]   && WPATH="${TELEGRAM_WEBHOOK_PATH:-}"
[ -z "$WSECRET" ] && WSECRET="${TELEGRAM_WEBHOOK_SECRET:-}"
if [ -z "$WPATH" ] || [ -z "$WSECRET" ]; then
  printf '\033[31m✗ falta TELEGRAM_WEBHOOK_PATH/SECRET\033[0m\n'; exit 1
fi
HOOK="$BASE_URL/tg/$WS/$WPATH"
CHAT=995000001
H=(-H "content-type: application/json" -H "x-telegram-bot-api-secret-token: $WSECRET")

upd() { # $1=update_id $2=comando-o-texto (si empieza por / se marca bot_command)
  local cmd_json=""
  [ "${2:0:1}" = "/" ] && cmd_json=',"entities":[{"type":"bot_command","offset":0,"length":'"${#2}"'}]'
  cat <<EOF
{"update_id":$1,"message":{"message_id":$1,"date":$(date +%s),
 "chat":{"id":$CHAT,"type":"private"},
 "from":{"id":$CHAT,"first_name":"Decision"},
 "text":"$2"$cmd_json}}
EOF
}

limpiar_chat() {
  qraw "delete from outbound_queue where tg_chat_id=$CHAT;
        delete from messages where conversation_id in (select c.id from conversations c join contacts ct on ct.id=c.contact_id where ct.tg_chat_id=$CHAT);
        delete from message_batches where conversation_id in (select c.id from conversations c join contacts ct on ct.id=c.contact_id where ct.tg_chat_id=$CHAT);
        delete from events where conversation_id in (select c.id from conversations c join contacts ct on ct.id=c.contact_id where ct.tg_chat_id=$CHAT);
        delete from conversations where contact_id in (select id from contacts where tg_chat_id=$CHAT);
        delete from contacts where tg_chat_id=$CHAT" > /dev/null
}
limpiar_chat
UID_BASE=95100000

sec "3 · /start saluda, estado queda ai_active"
curl -s -o /dev/null -X POST "$HOOK" "${H[@]}" -d "$(upd $((UID_BASE+1)) '/start')"
sleep 1
estado0=$(q "select state from conversations c join contacts ct on ct.id=c.contact_id where ct.tg_chat_id=$CHAT")
[ "$estado0" = "ai_active" ] && ok "state = ai_active" || bad "state = '$estado0', esperaba ai_active"

sec "4 · /ayuda responde con el teléfono (todavía en ai_active)"
curl -s -o /dev/null -X POST "$HOOK" "${H[@]}" -d "$(upd $((UID_BASE+2)) '/ayuda')"
sleep 2
body=$(qraw "select payload->>'text' from outbound_queue where tg_chat_id=$CHAT order by created_at desc limit 1")
echo "$body" | grep -q "322 236 3192" && ok "el teléfono de la clínica aparece en /ayuda" \
  || bad "no encontré el teléfono en la respuesta de /ayuda: $body"

sec "5 · /humano pausa DE VERDAD, por HTTP"
curl -s -o /dev/null -X POST "$HOOK" "${H[@]}" -d "$(upd $((UID_BASE+3)) '/humano')"
sleep 1
estado=$(q "select state from conversations c join contacts ct on ct.id=c.contact_id where ct.tg_chat_id=$CHAT")
[ "$estado" = "paused" ] && ok "state = paused" || bad "state = '$estado', esperaba paused"

# ⚠️ Los tres alias son obligatorios: sin "as", Postgres nombra las tres
# columnas igual ("?column?") y postgres.js colapsa el objeto de la fila a
# UNA sola clave — te quedas solo con el último valor, silenciosamente.
fromto=$(qraw "select payload->>'from' as de, payload->>'to' as a, payload->>'reason' as motivo
                 from events
                 where type='state_change' and conversation_id in
                   (select c.id from conversations c join contacts ct on ct.id=c.contact_id where ct.tg_chat_id=$CHAT)
                 order by created_at desc limit 1")
echo "$fromto" | grep -q "ai_active" && echo "$fromto" | grep -q "paused" \
  && ok "el evento state_change quedó from=ai_active to=paused" || bad "no se registró bien: $fromto"

momentoHumano=$(q "select extract(epoch from now())::bigint")
curl -s -o /dev/null -X POST "$HOOK" "${H[@]}" -d "$(upd $((UID_BASE+4)) 'mensaje 1 tras pausar')"
sleep 1
curl -s -o /dev/null -X POST "$HOOK" "${H[@]}" -d "$(upd $((UID_BASE+5)) 'mensaje 2 tras pausar')"
sleep 14   # el buffer_ms real del workspace (12s) + margen

llm=$(q "select count(*) from events e join conversations c on c.id=e.conversation_id
          join contacts ct on ct.id=c.contact_id
         where e.type='llm_call' and ct.tg_chat_id=$CHAT
           and extract(epoch from e.created_at) > $momentoHumano")
[ "${llm:-0}" = "0" ] && ok "cero llm_call tras pausar, aunque siguió escribiendo" \
  || bad "hubo $llm llm_call tras /humano — la IA siguió respondiendo"

sec "6 · /start reactiva tras /humano"
curl -s -o /dev/null -X POST "$HOOK" "${H[@]}" -d "$(upd $((UID_BASE+6)) '/start')"
sleep 1
estado2=$(q "select state from conversations c join contacts ct on ct.id=c.contact_id where ct.tg_chat_id=$CHAT")
[ "$estado2" = "ai_active" ] && ok "state volvió a ai_active" || bad "state = '$estado2', esperaba ai_active"

sec "7 · Un callback_query recibe answerCallbackQuery (no queda girando)"
cbq=$(cat <<EOF
{"update_id":$((UID_BASE+7)),"callback_query":{"id":"cbq-test-1",
 "from":{"id":$CHAT,"first_name":"Decision"},
 "message":{"message_id":1,"date":$(date +%s),"chat":{"id":$CHAT,"type":"private"}},
 "data":"bk:limpieza-dental:12345"}}
EOF
)
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$HOOK" "${H[@]}" -d "$cbq")
[ "$c" = "200" ] && ok "ACK 200 al callback (el answer real ya se mandó a Telegram)" || bad "callback → $c"

sec "8 · Contacto bloqueado → abstain total, ni comandos"
qraw "update contacts set is_blocked=true where tg_chat_id=$CHAT" > /dev/null
outAntes=$(q "select count(*) from outbound_queue where tg_chat_id=$CHAT")
curl -s -o /dev/null -X POST "$HOOK" "${H[@]}" -d "$(upd $((UID_BASE+8)) '/start')"
sleep 2
outDespues=$(q "select count(*) from outbound_queue where tg_chat_id=$CHAT")
[ "$outAntes" = "$outDespues" ] && ok "un /start bloqueado no genera ninguna respuesta nueva" \
  || bad "generó una respuesta pese a estar bloqueado ($outAntes → $outDespues)"
qraw "update contacts set is_blocked=false where tg_chat_id=$CHAT" > /dev/null

sec "9 · Limpieza"
limpiar_chat
ok "datos de prueba borrados"

printf '\n'
[ $fail -eq 0 ] && { printf '\033[32mSpec 07 OK\033[0m\n'; exit 0; }
printf '\033[31mSpec 07 con fallos\033[0m\n'; exit 1
