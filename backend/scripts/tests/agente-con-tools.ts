/**
 * 🚩 Conversación REAL: DeepSeek real + Google Calendar real.
 * Gasta céntimos de céntimo y hace peticiones reales a Google. Solo corre
 * si hay DEEPSEEK_API_KEY y las 3 variables de Google en el entorno
 * (scripts/smoke/09.sh lo omite si faltan).
 */

const CHAT = 998000001;

let fallos = 0;
const comprobar = (nombre: string, cond: boolean, detalle = "") => {
  if (cond) console.log(`OK   ${nombre}`);
  else { console.log(`FAIL ${nombre}${detalle ? ` — ${detalle}` : ""}`); fallos++; }
};

const { closeDb, sql } = await import("../../src/db/client.js");
const { runAgent } = await import("../../src/agent/run.js");

async function ultimasLlamadas(n: number) {
  const filas = await sql<{ p: { cacheHit: number; cacheMiss: number; steps: number } }[]>`
    select payload as p from events where type='llm_call' order by created_at desc limit ${n}`;
  return filas.map((f) => f.p).reverse();
}

async function main() {
  const [ws] = await sql<{ id: string; slug: string; name: string; timezone: string;
    buffer_ms: number; buffer_max_ms: number; buffer_max_msgs: number }[]>`
    select id, slug, name, timezone, buffer_ms, buffer_max_ms, buffer_max_msgs
      from workspaces limit 1`;
  if (!ws) throw new Error("no hay workspace: corre npm run seed");

  await limpiar();

  const [c] = await sql<{ id: string }[]>`
    insert into contacts (workspace_id, tg_chat_id, first_name)
    values (${ws.id}, ${CHAT}, 'Prueba tools') returning id`;
  const [conv] = await sql<{ id: string }[]>`
    insert into conversations (workspace_id, contact_id) values (${ws.id}, ${c!.id}) returning id`;

  const wsCtx = {
    ...ws, webhookSecret: null, handoffChatId: null, webhookPath: null,
    bufferMs: ws.buffer_ms, bufferMaxMs: ws.buffer_max_ms, bufferMaxMsgs: ws.buffer_max_msgs,
  };
  const conversacion = { contactId: c!.id, conversationId: conv!.id,
    isBlocked: false, state: "ai_active", aiEnabled: true };

  const turno1 = "¿tienen algo esta semana para una limpieza dental?";
  await sql`insert into messages (workspace_id, conversation_id, direction, kind, body)
            values (${ws.id}, ${conv!.id}, 'in', 'text', ${turno1})`;
  const r1 = await runAgent(wsCtx, conversacion, turno1);
  comprobar("responde al pedir disponibilidad", r1.ok, JSON.stringify(r1));
  if (r1.ok) console.log(`  bot: ${r1.texto.replace(/\n/g, "\n       ")}`);

  const turno2 = "me llamo Carlos Ramírez";
  await sql`insert into messages (workspace_id, conversation_id, direction, kind, body)
            values (${ws.id}, ${conv!.id}, 'in', 'text', ${turno2})`;
  const r2 = await runAgent(wsCtx, conversacion, turno2);
  comprobar("responde tras dar el nombre", r2.ok);

  const [contacto] = await sql<{ full_name: string | null }[]>`
    select full_name from contacts where id = ${c!.id}`;
  comprobar("guardar_datos_paciente escribió el nombre real", contacto?.full_name === "Carlos Ramírez",
    contacto?.full_name ?? "(null)");

  const llamadas = await ultimasLlamadas(2);
  const [, segundo] = llamadas;
  comprobar("🚩 cacheHit > 0 en el segundo turno (las tools no rompieron el cache)",
    (segundo?.cacheHit ?? 0) > 0, JSON.stringify(segundo));

  const toolCalls = await sql<{ p: { name: string; ok: boolean } }[]>`
    select payload as p from events where type='tool_call' and conversation_id=${conv!.id}
     order by created_at asc`;
  comprobar("se llamó a consultar_disponibilidad con éxito",
    toolCalls.some((t) => t.p.name === "consultar_disponibilidad" && t.p.ok));
  comprobar("se llamó a guardar_datos_paciente con éxito",
    toolCalls.some((t) => t.p.name === "guardar_datos_paciente" && t.p.ok));

  await limpiar();
}

async function limpiar() {
  await sql`delete from messages where conversation_id in (
              select c.id from conversations c join contacts ct on ct.id=c.contact_id
               where ct.tg_chat_id=${CHAT})`;
  await sql`delete from outbound_queue where tg_chat_id=${CHAT}`;
  await sql`delete from events where conversation_id in (
              select c.id from conversations c join contacts ct on ct.id=c.contact_id
               where ct.tg_chat_id=${CHAT})`;
  await sql`delete from conversations where contact_id in (
              select id from contacts where tg_chat_id=${CHAT})`;
  await sql`delete from contacts where tg_chat_id=${CHAT}`;
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n— agente-con-tools: todo OK" : `\n— agente-con-tools: ${fallos} fallo(s)`);
    process.exitCode = fallos === 0 ? 0 : 1;
  })
  .catch((e) => {
    console.log(`FAIL excepción — ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(closeDb);
