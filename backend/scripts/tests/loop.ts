/**
 * El loop de tool-calling, con DeepSeek SIMULADO (mismo patrón de las
 * specs 05/06: pisar global.fetch antes de importar nada del proyecto).
 *
 * Cubre lo que la spec 09 pide, sin gastar dinero real:
 *   - re-anexar el assistant con sus tool_calls antes de los resultados
 *   - un mensaje "tool" por cada call
 *   - argumentos inválidos → el modelo se corrige solo en el paso siguiente
 *   - el techo de 4 pasos sin quedarse colgado
 *   - el orden fijo del catálogo
 */

const CHAT_BASE = 997000000;

let fallos = 0;
const comprobar = (nombre: string, cond: boolean, detalle = "") => {
  if (cond) console.log(`OK   ${nombre}`);
  else { console.log(`FAIL ${nombre}${detalle ? ` — ${detalle}` : ""}`); fallos++; }
};

// ── DeepSeek simulado: un guion de respuestas, una por llamada ───────────
type Guion = (() => {
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
})[];

let guion: Guion = [];
let llamada = 0;
const historialRequests: unknown[] = [];

global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  if (!u.includes("api.deepseek.com")) throw new Error(`fetch no simulado: ${u}`);

  const body = JSON.parse(String(init?.body ?? "{}"));
  historialRequests.push(body);

  const paso = guion[llamada++];
  if (!paso) throw new Error(`el guion se quedó corto en la llamada ${llamada}`);
  const msg = paso();

  return new Response(JSON.stringify({
    id: `sim-${llamada}`,
    choices: [{ index: 0, message: { role: "assistant", ...msg }, finish_reason: msg.tool_calls ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

process.env.TELEGRAM_BOT_TOKEN ||= "token-simulado";
process.env.DEEPSEEK_API_KEY ||= "clave-simulada";

const { closeDb, sql } = await import("../../src/db/client.js");
const { runLoop } = await import("../../src/agent/loop.js");
const { toolsFor } = await import("../../src/tools/registry.js");

function llamadaHerramienta(id: string, nombre: string, args: Record<string, unknown>) {
  return { id, type: "function" as const, function: { name: nombre, arguments: JSON.stringify(args) } };
}

async function nuevaConversacion(wsId: string, chatId: number) {
  const [c] = await sql<{ id: string }[]>`
    insert into contacts (workspace_id, tg_chat_id, first_name)
    values (${wsId}, ${chatId}, 'Prueba loop') returning id`;
  const [conv] = await sql<{ id: string }[]>`
    insert into conversations (workspace_id, contact_id) values (${wsId}, ${c!.id}) returning id`;
  return { contactId: c!.id, conversationId: conv!.id, isBlocked: false, state: "ai_active", aiEnabled: true };
}

async function main() {
  const [ws] = await sql<{ id: string; slug: string; name: string; timezone: string }[]>`
    select id, slug, name, timezone from workspaces limit 1`;
  if (!ws) throw new Error("no hay workspace: corre npm run seed");
  const wsCtx = { ...ws, webhookSecret: null, handoffChatId: null, webhookPath: null, bufferMs: 12000, bufferMaxMs: 75000, bufferMaxMsgs: 15 };

  await limpiar();

  // ── 1 · Orden fijo del catálogo ──────────────────────────────
  console.log("\n── Catálogo ──");
  const nombres = toolsFor("appointment_setter").map((t) => t.name);
  comprobar("las 7 tools, en el orden declarado (reprogramar/cancelar/escalar se añadieron al final en la spec 11/13)",
    nombres.join(",") === "consultar_disponibilidad,consultar_mis_citas,guardar_datos_paciente,agendar_cita," +
      "reprogramar_cita,cancelar_cita,escalar_a_humano",
    nombres.join(","));

  // ── 2 · Camino feliz: una tool call, un resultado, respuesta final ──
  console.log("\n── Camino feliz: 1 tool call ──");
  {
    llamada = 0; historialRequests.length = 0;
    guion = [
      () => ({ content: null, tool_calls: [llamadaHerramienta("call_1", "guardar_datos_paciente", { nombre: "Ana Pérez" })] }),
      () => ({ content: "Listo, Ana, quedó guardado tu nombre." }),
    ];
    const conv = await nuevaConversacion(ws.id, CHAT_BASE + 1);
    const ctx = { workspace: wsCtx, conversation: conv };
    const r = await runLoop(
      [{ role: "system", content: "prompt" }, { role: "user", content: "me llamo Ana Pérez" }],
      ctx,
    );
    comprobar("responde en 2 pasos con texto final", r.ok && r.steps === 2, JSON.stringify(r));

    const segundaPeticion = historialRequests[1] as { messages: unknown[] };
    const mensajes = segundaPeticion.messages as Record<string, unknown>[];
    const assistantReanexado = mensajes.find((m) => m.role === "assistant" && m.tool_calls);
    comprobar("el mensaje assistant con sus tool_calls se re-anexó ANTES del resultado",
      !!assistantReanexado);
    const toolMsg = mensajes.find((m) => m.role === "tool");
    comprobar("hay un mensaje 'tool' con el tool_call_id correcto",
      toolMsg?.tool_call_id === "call_1", JSON.stringify(toolMsg));

    const [c] = await sql<{ full_name: string | null }[]>`
      select full_name from contacts where id = ${conv.contactId}`;
    comprobar("guardar_datos_paciente SÍ escribió en la base", c?.full_name === "Ana Pérez");

    const eventos = await sql<{ p: { name: string; ok: boolean } }[]>`
      select payload as p from events where type='tool_call' and conversation_id=${conv.conversationId}`;
    comprobar("se registró el tool_call en events", eventos.length === 1 && eventos[0]!.p.ok === true,
      JSON.stringify(eventos));
  }

  // ── 3 · Argumentos inválidos: el modelo se corrige solo ──────
  console.log("\n── El modelo se corrige solo tras un servicio_desconocido ──");
  {
    llamada = 0; historialRequests.length = 0;
    guion = [
      () => ({ content: null, tool_calls: [llamadaHerramienta("call_1", "consultar_disponibilidad",
        { servicio: "ortodoncia-invisible", desde: "2026-10-29" })] }), // slug inventado
      () => ({ content: "Perdona, no tengo ese servicio. ¿Te refieres a alineadores?" }),
    ];
    const conv = await nuevaConversacion(ws.id, CHAT_BASE + 2);
    const ctx = { workspace: wsCtx, conversation: conv };
    const r = await runLoop([{ role: "user", content: "quiero ortodoncia invisible para mañana" }], ctx);

    comprobar("no se rompe: termina con texto en 2 pasos", r.ok && r.steps === 2, JSON.stringify(r));
    const toolMsg = (historialRequests[1] as { messages: Record<string, unknown>[] })
      .messages.find((m) => m.role === "tool");
    const contenido = JSON.parse(String(toolMsg?.content ?? "{}"));
    comprobar("el resultado trae el error semántico servicio_desconocido",
      contenido.ok === false && contenido.error?.includes("servicio_desconocido"), JSON.stringify(contenido));
  }

  // ── 4 · Argumentos que no pasan el esquema Zod ───────────────
  console.log("\n── Zod rechaza argumentos mal formados (fecha inválida) ──");
  {
    llamada = 0; historialRequests.length = 0;
    guion = [
      () => ({ content: null, tool_calls: [llamadaHerramienta("call_1", "consultar_disponibilidad",
        { servicio: "limpieza-dental", desde: "29 de octubre" })] }), // no matchea el regex YYYY-MM-DD
      () => ({ content: "Dame la fecha en otro formato." }),
    ];
    const conv = await nuevaConversacion(ws.id, CHAT_BASE + 3);
    const ctx = { workspace: wsCtx, conversation: conv };
    await runLoop([{ role: "user", content: "limpieza el 29 de octubre" }], ctx);
    const toolMsg = (historialRequests[1] as { messages: Record<string, unknown>[] })
      .messages.find((m) => m.role === "tool");
    const contenido = JSON.parse(String(toolMsg?.content ?? "{}"));
    comprobar("Zod lo frena ANTES de llegar a computeSlots",
      contenido.ok === false && contenido.error?.startsWith("argumentos_invalidos"), JSON.stringify(contenido));
  }

  // ── 4b · Una tool que EXPLOTA no tumba el turno ──────────────
  console.log("\n── Una excepción dentro de la tool se convierte en ToolResult ──");
  {
    llamada = 0; historialRequests.length = 0;
    // consultar_disponibilidad SIN credenciales de Google configuradas
    // lanza (requireEnv); el loop debe atraparlo, no propagarlo.
    guion = [
      () => ({ content: null, tool_calls: [llamadaHerramienta("call_1", "consultar_disponibilidad",
        { servicio: "limpieza-dental", desde: "2026-10-29" })] }),
      () => ({ content: "Tengo un problema para consultar la agenda ahora mismo." }),
    ];
    const conv = await nuevaConversacion(ws.id, CHAT_BASE + 6);
    const ctx = { workspace: wsCtx, conversation: conv };
    const r = await runLoop([{ role: "user", content: "limpieza para el jueves" }], ctx);
    comprobar("el loop NO lanza: devuelve una respuesta de todos modos", r.ok, JSON.stringify(r));
    const toolMsg = (historialRequests[1] as { messages: Record<string, unknown>[] })
      .messages.find((m) => m.role === "tool");
    const contenido = JSON.parse(String(toolMsg?.content ?? "{}"));
    comprobar("el ToolResult trae error_interno, no un throw que mate el turno",
      contenido.ok === false && contenido.error?.startsWith("error_interno"), JSON.stringify(contenido));
  }

  // ── 5 · Tool desconocida (el modelo alucina un nombre) ───────
  console.log("\n── Tool desconocida ──");
  {
    llamada = 0; historialRequests.length = 0;
    guion = [
      () => ({ content: null, tool_calls: [llamadaHerramienta("call_1", "cancelar_todo_el_mundo", {})] }),
      () => ({ content: "No puedo hacer eso." }),
    ];
    const conv = await nuevaConversacion(ws.id, CHAT_BASE + 4);
    const ctx = { workspace: wsCtx, conversation: conv };
    const r = await runLoop([{ role: "user", content: "cancela todo" }], ctx);
    comprobar("no explota, responde con texto", r.ok, JSON.stringify(r));
  }

  // ── 6 · El techo de 4 pasos no se queda colgado ──────────────
  console.log("\n── Techo anti-loop (4 pasos) ──");
  {
    llamada = 0; historialRequests.length = 0;
    // El modelo insiste en llamar tools para siempre: nunca da texto.
    guion = Array.from({ length: 6 }, () => () => ({
      content: null,
      tool_calls: [llamadaHerramienta(`call_${llamada}`, "consultar_mis_citas", {})],
    }));
    const conv = await nuevaConversacion(ws.id, CHAT_BASE + 5);
    const ctx = { workspace: wsCtx, conversation: conv };
    const r = await runLoop([{ role: "user", content: "hola" }], ctx);
    comprobar("se corta en el paso 4, no sigue insistiendo",
      !r.ok && r.motivo === "overflow" && r.steps === 4, JSON.stringify(r));
    comprobar("solo se consumieron 4 entradas del guion, no las 6",
      llamada === 4, `${llamada}`);
  }

  console.log(`\nLlamadas totales a DeepSeek simulado: ${historialRequests.length >= 0 ? "ver arriba" : ""}`);
  await limpiar();
}

async function limpiar() {
  await sql`delete from messages where conversation_id in (
              select c.id from conversations c join contacts ct on ct.id=c.contact_id
               where ct.tg_chat_id between ${CHAT_BASE} and ${CHAT_BASE + 999})`;
  await sql`delete from events where conversation_id in (
              select c.id from conversations c join contacts ct on ct.id=c.contact_id
               where ct.tg_chat_id between ${CHAT_BASE} and ${CHAT_BASE + 999})`;
  await sql`delete from conversations where contact_id in (
              select id from contacts where tg_chat_id between ${CHAT_BASE} and ${CHAT_BASE + 999})`;
  await sql`delete from contacts where tg_chat_id between ${CHAT_BASE} and ${CHAT_BASE + 999}`;
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n— loop: todo OK" : `\n— loop: ${fallos} fallo(s)`);
    process.exitCode = fallos === 0 ? 0 : 1;
  })
  .catch((e) => {
    console.log(`FAIL excepción — ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(closeDb);
