/**
 * 🚩 agendar_cita contra Google Calendar REAL (sin simular nada). Crea una
 * fila real en `appointments` y un evento real en el calendario. Imprime el
 * link para verificar a ojo — hay que BORRARLO a mano cuando termines.
 *
 *   npx tsx scripts/tests/agendar-vivo.ts
 */
process.env.TELEGRAM_BOT_TOKEN ||= "token-no-usado-aqui";
process.env.DEEPSEEK_API_KEY ||= "clave-no-usada-aqui";

const CHAT = 999100001;

const { closeDb, sql } = await import("../../src/db/client.js");
const { agendarCita } = await import("../../src/tools/agendar.js");
const { computeSlots } = await import("../../src/gcal/slots.js");

async function main() {
  const [ws] = await sql<{ id: string; slug: string; name: string; timezone: string }[]>`
    select id, slug, name, timezone from workspaces limit 1`;
  if (!ws) throw new Error("no hay workspace: corre npm run seed");

  const [servicio] = await sql<{ slug: string; duration_min: number; buffer_min: number }[]>`
    select slug, duration_min, buffer_min from services
     where workspace_id = ${ws.id} and slug = 'limpieza-dental'`;
  if (!servicio) throw new Error("no existe el servicio limpieza-dental: corre npm run seed");

  await limpiar(ws.id);

  const [c] = await sql<{ id: string }[]>`
    insert into contacts (workspace_id, tg_chat_id, first_name)
    values (${ws.id}, ${CHAT}, 'Prueba en vivo') returning id`;
  const [conv] = await sql<{ id: string }[]>`
    insert into conversations (workspace_id, contact_id) values (${ws.id}, ${c!.id}) returning id`;

  // Un slot REAL y libre, tal como lo vería el bot.
  const [slot] = await computeSlots({
    workspaceId: ws.id, zone: ws.timezone, servicio, from: new Date().toISOString().slice(0, 10), limit: 1,
  });
  if (!slot) throw new Error("no hay ningún slot libre en los próximos 21 días — raro, revisa el calendario");

  console.log(`Agendando en: ${slot.iso}\n`);

  const ctx = {
    workspace: { id: ws.id, slug: ws.slug, name: ws.name, timezone: ws.timezone } as never,
    conversation: { contactId: c!.id, conversationId: conv!.id } as never,
  };

  const r = await agendarCita.run({
    servicio: servicio.slug, inicio: slot.iso, nombre_paciente: "Paciente de Prueba",
  }, ctx);

  console.log(JSON.stringify(r, null, 2));

  if (r.ok) {
    const [fila] = await sql<{ gcal_html_link: string | null; starts_at: Date }[]>`
      select gcal_html_link, starts_at from appointments where contact_id = ${c!.id}`;
    console.log(`\n✓ Agendada. Ábrela aquí y revisa a ojo:\n  ${fila?.gcal_html_link}`);
    console.log(`\n  Hora guardada en DB: ${fila?.starts_at}`);
    console.log(`\nCuando la verifiques, BÓRRALA del calendario a mano, y corre esto para limpiar la DB:`);
    console.log(`  npx tsx scripts/tests/agendar-vivo.ts --limpiar`);
  } else {
    console.log("\n✗ No se agendó — revisa el error de arriba.");
  }
}

async function limpiar(workspaceId: string) {
  await sql`delete from events where conversation_id in (
              select c.id from conversations c join contacts ct on ct.id=c.contact_id
               where ct.tg_chat_id=${CHAT})`;
  await sql`delete from appointments where contact_id in (
              select id from contacts where tg_chat_id=${CHAT})`;
  await sql`delete from conversations where contact_id in (
              select id from contacts where tg_chat_id=${CHAT})`;
  await sql`delete from contacts where tg_chat_id=${CHAT} and workspace_id=${workspaceId}`;
}

if (process.argv.includes("--limpiar")) {
  const [ws] = await sql<{ id: string }[]>`select id from workspaces limit 1`;
  await limpiar(ws!.id);
  console.log("DB limpia. No olvides borrar el evento del calendario si no lo has hecho.");
  await closeDb();
} else {
  main().finally(closeDb);
}
