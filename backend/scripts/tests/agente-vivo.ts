/**
 * 🚩 LA PUERTA DE LA SPEC 05, en vivo contra DeepSeek.
 *
 * Mantiene una conversación de 5 turnos y comprueba que `cacheHit > 0` en el
 * segundo. Si da 0, hay un volátil infiltrado en el prefijo: PARA Y ARRÉGLALO.
 * Cuesta minutos ahora y horas con tools, buffer y handoff encima.
 *
 * Gasta llamadas reales (céntimos de céntimo). Solo corre si hay clave.
 */

const CHAT = 991000001;

let fallos = 0;
const comprobar = (nombre: string, cond: boolean, detalle = "") => {
  if (cond) console.log(`OK   ${nombre}`);
  else { console.log(`FAIL ${nombre}${detalle ? ` — ${detalle}` : ""}`); fallos++; }
};

const { closeDb, sql } = await import("../../src/db/client.js");
const { runAgent } = await import("../../src/agent/run.js");
const { ratioCache } = await import("../../src/llm/cost.js");

type LlamadaLlm = { cacheHit: number; cacheMiss: number; outTokens: number; costUsd: number };

async function ultimasLlamadas(n: number): Promise<LlamadaLlm[]> {
  const filas = await sql<{ p: LlamadaLlm }[]>`
    select payload as p from events
     where type = 'llm_call' order by created_at desc limit ${n}`;
  return filas.map((f) => f.p).reverse();
}

async function main() {
  const [ws] = await sql<{ id: string; slug: string; name: string; timezone: string }[]>`
    select id, slug, name, timezone from workspaces limit 1`;
  if (!ws) throw new Error("no hay workspace: corre npm run seed");

  await limpiar();

  // Conversación de prueba
  const [c] = await sql<{ id: string }[]>`
    insert into contacts (workspace_id, tg_chat_id, first_name)
    values (${ws.id}, ${CHAT}, 'Prueba') returning id`;
  const [conv] = await sql<{ id: string }[]>`
    insert into conversations (workspace_id, contact_id) values (${ws.id}, ${c!.id}) returning id`;

  const contexto = {
    id: ws.id, slug: ws.slug, name: ws.name, timezone: ws.timezone,
    webhookSecret: null, webhookPath: null,
  };
  const conversacion = {
    contactId: c!.id, conversationId: conv!.id,
    isBlocked: false, state: "ai_active", aiEnabled: true,
  };

  const turnos = [
    "hola",
    "¿cuánto vale una limpieza dental?",
    "¿y tienen parqueadero?",
    "me llamo Ana Restrepo",
    "¿cómo me llamo?",
  ];

  const respuestas: string[] = [];
  for (const [i, texto] of turnos.entries()) {
    // El ingress normalmente guarda el entrante; aquí se simula.
    await sql`insert into messages (workspace_id, conversation_id, direction, kind, body)
              values (${ws.id}, ${conv!.id}, 'in', 'text', ${texto})`;
    const r = await runAgent(contexto, conversacion, texto);
    if (!r.ok) { comprobar(`turno ${i + 1} responde`, false, r.motivo); break; }
    respuestas.push(r.texto);
    console.log(`\n  [${i + 1}] tú: ${texto}\n      bot: ${r.texto.replace(/\n/g, "\n           ")}\n`);
  }

  comprobar("los 5 turnos responden", respuestas.length === 5, `${respuestas.length}/5`);

  const llamadas = await ultimasLlamadas(respuestas.length);

  // ── 🚩 LA PUERTA ───────────────────────────────────────────
  const segundo = llamadas[1];
  comprobar("🚩 cacheHit > 0 en el SEGUNDO turno", (segundo?.cacheHit ?? 0) > 0,
    segundo ? `hit=${segundo.cacheHit} miss=${segundo.cacheMiss}` : "no hubo segundo turno");

  const total = llamadas.reduce(
    (a, l) => ({ hit: a.hit + (l.cacheHit ?? 0), miss: a.miss + (l.cacheMiss ?? 0), output: 0 }),
    { hit: 0, miss: 0, output: 0 },
  );
  const ratio = ratioCache(total);
  comprobar("🚩 el ratio de cache supera el 60%", ratio > 60, `${ratio}%`);

  // ── Costo ──────────────────────────────────────────────────
  const costo = llamadas.reduce((a, l) => a + (l.costUsd ?? 0), 0);
  comprobar("el costo sale poblado y es céntimos de céntimo",
    costo > 0 && costo < 0.01, `$${costo.toFixed(6)} por ${llamadas.length} turnos`);

  // ── Comportamiento del prompt ──────────────────────────────
  const rPrecio = (respuestas[1] ?? "").toLowerCase();
  comprobar("el precio se da como 'desde'", /desde/.test(rPrecio), rPrecio.slice(0, 80));
  comprobar("menciona la valoración gratuita",
    /valoraci[óo]n/.test(rPrecio) && /(gratis|gratuita|sin costo)/.test(rPrecio),
    rPrecio.slice(0, 120));

  const rParqueadero = (respuestas[2] ?? "").toLowerCase();
  comprobar("un dato que no tiene: lo dice en vez de inventar",
    /(no tengo|no cuento|no dispongo|no estoy segur|comunic|cl[íi]nica)/.test(rParqueadero),
    rParqueadero.slice(0, 120));

  const rMemoria = (respuestas[4] ?? "").toLowerCase();
  comprobar("recuerda el nombre dicho dos turnos antes", /ana/.test(rMemoria),
    rMemoria.slice(0, 80));

  // ── Formato ────────────────────────────────────────────────
  comprobar("responde corto (2–4 líneas)",
    respuestas.every((r) => r.split("\n").filter((l) => l.trim()).length <= 5),
    respuestas.map((r) => r.split("\n").filter((l) => l.trim()).length).join(","));
  comprobar("sin markdown", respuestas.every((r) => !/\*\*|^#{1,6}\s|```/m.test(r)));

  console.log(`\n  resumen: ${llamadas.length} llamadas · cache ${ratio}% · $${costo.toFixed(6)}`);
  await limpiar();
}

async function limpiar() {
  await sql`delete from messages where conversation_id in (
              select c.id from conversations c join contacts ct on ct.id = c.contact_id
               where ct.tg_chat_id = ${CHAT})`;
  await sql`delete from outbound_queue where tg_chat_id = ${CHAT}`;
  await sql`delete from conversations where contact_id in (
              select id from contacts where tg_chat_id = ${CHAT})`;
  await sql`delete from contacts where tg_chat_id = ${CHAT}`;
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n— agente: todo OK" : `\n— agente: ${fallos} fallo(s)`);
    process.exitCode = fallos === 0 ? 0 : 1;
  })
  .catch((e) => {
    console.log(`FAIL excepción — ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(closeDb);
