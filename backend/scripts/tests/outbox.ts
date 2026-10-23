/**
 * Drenado contra un Telegram SIMULADO.
 *
 * `global.fetch` se sustituye antes de importar nada del egress, así que el
 * código bajo prueba es el real: mismas transiciones, mismo manejo de errores.
 * Así se pueden provocar 429, 403 y HTML roto, que de otro modo solo pasan
 * en producción y a destiempo.
 *
 * ⚠️ TODOS los imports del proyecto son DINÁMICOS y van al final. `env.ts`
 * congela `process.env` al importarse, y los imports estáticos se izan por
 * encima de cualquier asignación: con un `import` normal, el token simulado
 * de abajo llegaría tarde y el cliente de Telegram lo vería vacío.
 */

const CHAT_OK = 990000001;
const CHAT_BLOQUEADO = 990000002;
const CHAT_FLOOD = 990000003;
const CHAT_HTML = 990000004;

let fallos = 0;
const comprobar = (nombre: string, cond: boolean, detalle = "") => {
  if (cond) console.log(`OK   ${nombre}`);
  else { console.log(`FAIL ${nombre}${detalle ? ` — ${detalle}` : ""}`); fallos++; }
};

// ── El Telegram simulado ─────────────────────────────────────
type Llamada = { metodo: string; body: Record<string, unknown> };
const llamadas: Llamada[] = [];
let floodYaFallo = false;
let htmlYaFallo = false;

const respuesta = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  const metodo = u.split("/").pop() ?? "";
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  llamadas.push({ metodo, body });

  const chat = Number(body.chat_id);

  if (chat === CHAT_BLOQUEADO) {
    return respuesta({ ok: false, error_code: 403,
      description: "Forbidden: bot was blocked by the user" }, 403);
  }
  if (chat === CHAT_FLOOD && !floodYaFallo) {
    floodYaFallo = true;   // falla una vez, luego pasa
    return respuesta({ ok: false, error_code: 429,
      description: "Too Many Requests: retry later", parameters: { retry_after: 2 } }, 429);
  }
  if (chat === CHAT_HTML && !htmlYaFallo && body.parse_mode) {
    htmlYaFallo = true;    // falla mientras lleve parse_mode
    return respuesta({ ok: false, error_code: 400,
      description: "Bad Request: can't parse entities" }, 400);
  }
  return respuesta({ ok: true, result: { message_id: 1000 + llamadas.length, chat: { id: chat } } });
}) as typeof fetch;

// El token tiene que estar ANTES de que env.ts congele process.env.
process.env.TELEGRAM_BOT_TOKEN ||= "token-simulado-para-pruebas";

// Ahora sí: imports dinámicos, con fetch ya pisado y el token puesto.
const { closeDb, sql } = await import("../../src/db/client.js");
const { enqueue } = await import("../../src/egress/outbox.js");
const { drenarAhora } = await import("../../src/egress/drain.js");

type EstadoFila = {
  status: string; attempts: number; error: string | null; tg_message_id: string | null;
};

const estado = async (id: string): Promise<EstadoFila | undefined> => {
  const [r] = await sql<EstadoFila[]>`
    select status, attempts, error, tg_message_id from outbound_queue where id = ${id}`;
  return r;
};

/** `enqueue` devuelve un array; aquí siempre esperamos al menos una fila. */
const unaFila = (ids: string[], contexto: string): string => {
  const id = ids[0];
  if (!id) throw new Error(`${contexto}: enqueue no creó ninguna fila`);
  return id;
};

async function main() {
  const [ws] = await sql<{ id: string }[]>`select id from workspaces limit 1`;
  if (!ws) throw new Error("no hay workspace: corre npm run seed");

  await limpiar();

  // ── 1 · Camino feliz ───────────────────────────────────────
  const idOk = unaFila(await enqueue({ workspaceId: ws.id, chatId: CHAT_OK, texto: "Hola, ¿cómo estás?" }), "feliz");
  await drenarAhora(8000);
  const rOk = await estado(idOk);
  comprobar("camino feliz: queda 'sent' con tg_message_id",
    rOk?.status === "sent" && !!rOk.tg_message_id, JSON.stringify(rOk));

  // ── 2 · El escape va en el payload, no en el texto original ─
  const idLt = unaFila(await enqueue({ workspaceId: ws.id, chatId: CHAT_OK,
    texto: "el precio es < 100.000 & sube" }), "escape");
  await drenarAhora(8000);
  const enviado = llamadas.filter((l) => Number(l.body.chat_id) === CHAT_OK).pop();
  comprobar("un '<' sale escapado y el envío no falla",
    (await estado(idLt))?.status === "sent" &&
      String(enviado?.body.text).includes("&lt;"),
    String(enviado?.body.text));

  // ── 3 · Troceo al encolar ──────────────────────────────────
  const largo = Array.from({ length: 70 }, (_, i) => `Párrafo ${i}. ${"y".repeat(100)}`).join("\n\n");
  const ids = await enqueue({ workspaceId: ws.id, chatId: CHAT_OK, texto: largo });
  comprobar("un texto de ~7000 chars se encola en 2+ filas", ids.length >= 2, `${ids.length} filas`);
  await drenarAhora(20000);
  const estados = await Promise.all(ids.map(estado));
  comprobar("todos los trozos salen", estados.every((e) => e?.status === "sent"));
  comprobar("ningún trozo pasa de 4096",
    llamadas.slice(-ids.length).every((l) => String(l.body.text).length <= 4096));

  // ── 4 · 403: bloquear y NO insistir ────────────────────────
  const idBloq = unaFila(await enqueue({ workspaceId: ws.id, chatId: CHAT_BLOQUEADO, texto: "hola" }), "403");
  await sql`insert into contacts (workspace_id, tg_chat_id) values (${ws.id}, ${CHAT_BLOQUEADO})
            on conflict do nothing`;
  await drenarAhora(8000);
  const rBloq = await estado(idBloq);
  comprobar("403 → la fila queda 'skipped', no 'failed'", rBloq?.status === "skipped",
    JSON.stringify(rBloq));
  const [cBloq] = await sql<{ is_blocked: boolean }[]>`
    select is_blocked from contacts where workspace_id = ${ws.id} and tg_chat_id = ${CHAT_BLOQUEADO}`;
  comprobar("403 → el contacto queda marcado como bloqueado", cBloq?.is_blocked === true);

  const antes = llamadas.filter((l) => Number(l.body.chat_id) === CHAT_BLOQUEADO).length;
  await drenarAhora(2000);
  const despues = llamadas.filter((l) => Number(l.body.chat_id) === CHAT_BLOQUEADO).length;
  comprobar("403 → deja de insistir", antes === despues, `${antes} → ${despues}`);

  // ── 5 · 429: respetar retry_after, sin gastar intento ───────
  const idFlood = unaFila(await enqueue({ workspaceId: ws.id, chatId: CHAT_FLOOD, texto: "hola" }), "429");
  await drenarAhora(2000);
  const rFlood = await estado(idFlood);
  comprobar("429 → sigue 'pending', no se quema", rFlood?.status === "pending",
    JSON.stringify(rFlood));
  comprobar("429 → no cuenta como intento", (rFlood?.attempts ?? 9) === 0,
    `attempts=${rFlood?.attempts}`);
  const [prog] = await sql<{ faltan: number }[]>`
    select extract(epoch from (next_attempt_at - now()))::int as faltan
      from outbound_queue where id = ${idFlood}`;
  comprobar("429 → reprogramada ~3 s (retry_after 2 + 1)",
    (prog?.faltan ?? 0) >= 1 && (prog?.faltan ?? 0) <= 4, `faltan ${prog?.faltan}s`);

  // ── 6 · 400 can't parse entities → reintento en plano ───────
  const idHtml = unaFila(await enqueue({ workspaceId: ws.id, chatId: CHAT_HTML, texto: "texto normal" }), "html");
  await drenarAhora(8000);
  const rHtml = await estado(idHtml);
  const ultimaHtml = llamadas.filter((l) => Number(l.body.chat_id) === CHAT_HTML).pop();
  comprobar("HTML roto → reintenta sin parse_mode y acaba enviado",
    rHtml?.status === "sent" && ultimaHtml?.body.parse_mode === undefined,
    JSON.stringify({ status: rHtml?.status, parse_mode: ultimaHtml?.body.parse_mode }));

  // ── 7 · Rate limit por chat ────────────────────────────────
  const t0 = Date.now();
  const dos = await enqueue({ workspaceId: ws.id, chatId: CHAT_OK, texto: "uno" });
  const dos2 = await enqueue({ workspaceId: ws.id, chatId: CHAT_OK, texto: "dos" });
  await drenarAhora(20000);
  const transcurrido = Date.now() - t0;
  const res = await Promise.all([...dos, ...dos2].map((id) => estado(id)));
  comprobar("dos mensajes al mismo chat salen con ≥1.1 s de separación",
    res.every((r) => r?.status === "sent") && transcurrido >= 1100,
    `${transcurrido} ms`);

  // ── 8 · Los errores quedan en events ───────────────────────
  const [ev] = await sql<{ n: number }[]>`
    select count(*)::int as n from events
     where type = 'send_error' and created_at > now() - interval '2 minutes'`;
  comprobar("los fallos se registran en events", (ev?.n ?? 0) >= 2, `${ev?.n} eventos`);

  await limpiar();
}

async function limpiar() {
  await sql`delete from outbound_queue where tg_chat_id between 990000000 and 990999999`;
  await sql`delete from contacts where tg_chat_id between 990000000 and 990999999`;
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\n— outbox: todo OK" : `\n— outbox: ${fallos} fallo(s)`);
    process.exitCode = fallos === 0 ? 0 : 1;
  })
  .catch((e) => {
    console.log(`FAIL excepción — ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(closeDb);
