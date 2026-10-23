#!/usr/bin/env bash
# Spec 02 — verificación. Sale 0 si todo pasa, 1 si algo falla.
#
#   bash scripts/smoke/02.sh
#
# Necesita: node. Corre el seed, así que escribe en la base.

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
[ -f .env ] && set -a && . ./.env && set +a

fail=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=1; }
sec()  { printf '\n\033[1m%s\033[0m\n' "$1"; }

# psql no está instalado en todas las máquinas; el helper usa el driver del proyecto.
q() { printf '%s' "$1" | npx tsx scripts/q.ts 2>/dev/null | tr -d '[:space:]'; }

sec "1 · El seed corre"
if npx tsx scripts/seed.ts > /tmp/seed.log 2>&1; then
  ok "seed ok"
  grep -E '^(⚠|✓)' /tmp/seed.log | sed 's/^/      /'
else
  bad "el seed falló:"; sed 's/^/      /' /tmp/seed.log; exit 1
fi

sec "2 · Los datos están cargados"
[ "$(q "select count(*) from services")" = "13" ] \
  && ok "13 servicios" || bad "hay $(q "select count(*) from services") servicios, esperaba 13"
[ "$(q "select count(*) from business_hours")" = "6" ] \
  && ok "6 días de horario" || bad "hay $(q "select count(*) from business_hours") días, esperaba 6"
[ "$(q "select slug from workspaces")" = "clinica-gonzalez" ] \
  && ok "workspace clinica-gonzalez" || bad "slug inesperado"
[ "$(q "select count(*) from business_hours where weekday=0")" = "0" ] \
  && ok "domingo sin fila (cerrado)" || bad "hay una fila para el domingo"

sec "3 · El render es DETERMINISTA"
npx tsx scripts/seed.ts --render-only > /tmp/r1.txt 2>/dev/null
npx tsx scripts/seed.ts --render-only > /tmp/r2.txt 2>/dev/null
if diff -q /tmp/r1.txt /tmp/r2.txt > /dev/null; then
  ok "dos ejecuciones = bytes idénticos"
else
  bad "el render CAMBIA entre ejecuciones (esto rompe el cache)"
  diff /tmp/r1.txt /tmp/r2.txt | head -10 | sed 's/^/      /'
fi

sec "4 · El hash guardado coincide con el texto"
h_db=$(q "select rendered_hash from business_info")
h_calc=$(node -e "
  const{createHash}=require('crypto');const{execSync}=require('child_process');
  const t=execSync('npx tsx scripts/seed.ts --render-only',{encoding:'utf8',maxBuffer:1e7});
  process.stdout.write(createHash('sha256').update(t,'utf8').digest('hex'));
" 2>/dev/null)
[ -n "$h_db" ] && [ "$h_db" = "$h_calc" ] \
  && ok "sha256 coincide (${h_db:0:12}…)" \
  || bad "el hash de la base (${h_db:0:12}…) ≠ el del texto (${h_calc:0:12}…)"

sec "5 · Ningún placeholder llegó al prompt"
n=$(q "select count(*) from agent_prompts where is_active and body like '%<<EDITAR>>%'")
[ "$n" = "0" ] && ok "sin <<EDITAR>> en el prompt" || bad "¡hay <<EDITAR>> en el prompt activo!"
n=$(q "select count(*) from agent_prompts where is_active and body like '%{{%'")
[ "$n" = "0" ] && ok "sin marcadores {{ }} sin resolver" || bad "quedó un {{ }} en el prompt"
n=$(q "select count(*) from business_info where rendered ilike '%dato-ficticio%'")
[ "$n" = "0" ] && ok "sin marcadores #dato-ficticio en el texto" || bad "el marcador #dato-ficticio llegó al prompt"

sec "6 · Exactamente un prompt activo"
[ "$(q "select count(*) from agent_prompts where is_active")" = "1" ] \
  && ok "1 activo" || bad "hay $(q "select count(*) from agent_prompts where is_active") activos"

sec "7 · Las guardas abortan el seed"
cp data/business-info.json /tmp/bi.bak

# 7a · placeholder SUELTO: el renderer lo omite, el seed sigue.
node -e "
  const fs=require('fs');const p='data/business-info.json';
  const d=JSON.parse(fs.readFileSync(p,'utf8'));
  d.negocio.tipo='<<EDITAR>>';
  fs.writeFileSync(p,JSON.stringify(d,null,2));
"
if npx tsx scripts/seed.ts --render-only 2>/dev/null | grep -q "EDITAR"; then
  bad "un placeholder suelto llegó al texto en vez de omitirse"
else
  ok "placeholder suelto: omitido"
fi
cp /tmp/bi.bak data/business-info.json

# 7b · placeholder EMBEBIDO: esto es lo que la guarda tiene que atrapar.
node -e "
  const fs=require('fs');const p='data/business-info.json';
  const d=JSON.parse(fs.readFileSync(p,'utf8'));
  d.sedes[0].direccion='Av 3A # 24, <<EDITAR>>, Cucuta';
  fs.writeFileSync(p,JSON.stringify(d,null,2));
"
if npx tsx scripts/seed.ts > /tmp/guard.log 2>&1; then
  bad "el seed NO abortó con un <<EDITAR>> embebido"
else
  grep -q "EDITAR" /tmp/guard.log \
    && ok "placeholder embebido: aborta y lo nombra" || bad "abortó sin explicar por qué"
fi
cp /tmp/bi.bak data/business-info.json

# 7c · el nombre del prompt y el del JSON tienen que coincidir.
node -e "
  const fs=require('fs');const p='data/business-info.json';
  const d=JSON.parse(fs.readFileSync(p,'utf8'));
  d.negocio.nombre='Otra Clinica S.A.';
  fs.writeFileSync(p,JSON.stringify(d,null,2));
"
if npx tsx scripts/seed.ts > /tmp/guard2.log 2>&1; then
  bad "el seed NO abortó con el nombre desincronizado"
else
  grep -q "nombre del negocio" /tmp/guard2.log \
    && ok "nombre desincronizado: aborta" || bad "abortó sin explicar por qué"
fi
cp /tmp/bi.bak data/business-info.json
npx tsx scripts/seed.ts > /dev/null 2>&1   # restaurar estado bueno

sec "8 · El contenido estable cabe en el prompt"
bytes=$(q "select length(rendered) from business_info")
toks=$(( bytes * 10 / 35 ))
if [ "$toks" -lt 3000 ]; then ok "~$toks tokens (umbral de RAG: 3.000)"
else bad "~$toks tokens: pasa el umbral, replantear RAG"; fi

sec "9 · El snapshot no divergió del vault"
if diff -q ../knowledge/wiki/Clinica-Gonzalez-business-info.json data/business-info.json >/dev/null 2>&1 \
&& diff -q ../knowledge/wiki/Clinica-Gonzalez-services.csv data/services.csv >/dev/null 2>&1; then
  ok "data/ == vault"
else
  printf '  \033[33m·\033[0m data/ difiere del vault — corre: npm run kb:sync\n'
fi

printf '\n'
[ $fail -eq 0 ] && { printf '\033[32mSpec 02 OK\033[0m\n'; exit 0; }
printf '\033[31mSpec 02 con fallos\033[0m\n'; exit 1
