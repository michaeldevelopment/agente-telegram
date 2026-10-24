import { sql } from "../db/client.js";
import { enqueue } from "../egress/outbox.js";
import { prepararTexto } from "../egress/format.js";
import { tecladoDeSlots } from "../egress/keyboards.js";
import { filtrarBorrador, RESPUESTA_SEGURA } from "../guardrails/output.js";
import { MODEL, SinSaldo } from "../llm/deepseek.js";
import {
  bloqueVolatil, buildMessages, getHistorial, getPromptEstatico, VENTANA_MENSAJES,
} from "../llm/messages.js";
import { logEvent, logLlmCall } from "../obs/events.js";
import { alertarFallosLlmSeguidos, alertarGuardrail, alertarSinSaldo } from "../obs/alerts.js";
import { runLoop } from "./loop.js";
import type { Conversacion, Workspace } from "../ingress/persist.js";

const UMBRAL_FALLOS_SEGUIDOS = 3;

/**
 * Un turno del agente: cargar contexto, correr el loop de tool-calling,
 * sanear, encolar. Desde la spec 09, el agente tiene manos: puede consultar
 * disponibilidad real, las citas del paciente, y guardar sus datos.
 */

export type ResultadoTurno = { ok: true; texto: string } | { ok: false; motivo: string };

export async function runAgent(
  ws: Workspace,
  conv: Conversacion,
  textoTurno: string,
  opts: {
    /**
     * Cuántos de los mensajes más recientes de `messages` son el turno
     * actual y hay que EXCLUIR del historial, porque ya van en `textoTurno`.
     *
     * Con un mensaje suelto es 1 (el default, de siempre). Desde el buffer
     * (spec 06) un turno consolida varios mensajes del paciente en uno solo:
     * ahí hay que excluir tantos como `msg_count` tenga el lote, o esos
     * mismos mensajes aparecerían DOS veces — una en el historial, otra
     * dentro del texto consolidado.
     */
    excluirUltimos?: number;
  } = {},
): Promise<ResultadoTurno> {
  const excluir = Math.max(0, opts.excluirUltimos ?? 1);
  try {
    const [promptEstatico, datos] = await Promise.all([
      getPromptEstatico(ws.id),
      datosDelPaciente(conv.contactId),
      // El historial se pide después: tiene que incluir el/los turno(s)
      // actuales, que el ingress ya guardó, así que se excluyen abajo.
    ]);

    // Se piden VENTANA_MENSAJES + excluir para que, tras recortar los del
    // turno actual, sigan quedando hasta VENTANA_MENSAJES de historial real.
    const crudo = await getHistorial(conv.conversationId, VENTANA_MENSAJES + excluir);
    const historial = excluir > 0 ? crudo.slice(0, -excluir) : crudo;

    const mensajes = buildMessages({
      promptEstatico,
      resumen: datos.resumen,
      historial,
      bloqueVolatil: bloqueVolatil({
        timezone: ws.timezone,
        nombrePaciente: datos.nombre,
        telefonoPaciente: datos.telefono,
      }),
      textoTurno,
    });

    const t0 = Date.now();
    const res = await runLoop(mensajes, { workspace: ws, conversation: conv });

    await logLlmCall({
      workspaceId: ws.id,
      conversationId: conv.conversationId,
      model: MODEL,
      steps: res.steps,
      uso: res.uso,
      latencyMs: Date.now() - t0,
      finish: res.ok ? "stop" : res.motivo,
    });

    if (!res.ok) {
      // 'overflow' (se agotó el techo de pasos) o 'vacio' (el modelo no dio
      // texto): en ambos casos NO se insiste, se escala. Nunca silencio.
      return await degradar(ws, conv, `loop:${res.motivo}`);
    }

    let texto = res.texto.trim();

    // Capa 3 de guardrail clínico (spec 15): filtro sobre el BORRADOR, antes
    // de encolar. Si dispara, el borrador se DESCARTA ENTERO — no se
    // parchea, uno parcheado puede quedar peor — y se reemplaza por la
    // respuesta segura. Nunca se guarda el texto que lo disparó, solo su hash.
    const hallazgo = filtrarBorrador(texto);
    if (hallazgo) {
      await logEvent({
        workspaceId: ws.id, conversationId: conv.conversationId,
        type: "guardrail", level: "warn",
        payload: { rule: hallazgo.rule, snippetHash: hallazgo.snippetHash },
      });
      await alertarGuardrail(ws, hallazgo.rule); // sin umbral: cada bloqueo lo mira alguien
      texto = RESPUESTA_SEGURA;
    }

    // El saneado real (escape, troceo, limpieza de markdown) lo hace el
    // outbox; aquí solo se comprueba que quede algo que enviar.
    const trozos = prepararTexto(texto);
    if (trozos.length === 0) return await degradar(ws, conv, "no quedó texto tras sanear");

    // Botones de horario (spec 12): si el turno ofreció slots reales, van
    // pegados a este mensaje — así el paciente puede tocar en vez de escribir.
    // Si la capa 3 reemplazó el texto, no tiene sentido ofrecer los botones
    // de ESE borrador descartado.
    const replyMarkup = (!hallazgo && res.teclado) ? tecladoDeSlots(res.teclado.servicio, res.teclado.slots) : undefined;

    await enqueue({
      workspaceId: ws.id,
      conversationId: conv.conversationId,
      chatId: Number(datos.chatId),
      texto,
      replyMarkup,
    });
    await guardarSalida(ws, conv, texto);
    await registrarResultadoLlm(conv.conversationId, true);

    return { ok: true, texto };
  } catch (e) {
    if (e instanceof SinSaldo) {
      await logEvent({
        workspaceId: ws.id, conversationId: conv.conversationId,
        type: "llm_error", level: "error",
        payload: { code: 402, motivo: "sin saldo", accion: "alerta al equipo" },
      });
      await alertarSinSaldo(ws);
      return await degradar(ws, conv, "DeepSeek sin saldo");
    }
    await logEvent({
      workspaceId: ws.id, conversationId: conv.conversationId,
      type: "llm_error", level: "error",
      payload: { motivo: e instanceof Error ? e.message : String(e) },
    });
    return await degradar(ws, conv, e instanceof Error ? e.message : String(e));
  }
}

/**
 * Cuando el modelo no responde: mensaje de cortesía y la conversación pasa a
 * `handoff_pending`. NUNCA silencio: un paciente que escribe y no recibe nada
 * asume que el negocio no funciona.
 */
async function degradar(ws: Workspace, conv: Conversacion, motivo: string): Promise<ResultadoTurno> {
  const datos = await datosDelPaciente(conv.contactId);
  const texto =
    "Estoy teniendo un problema técnico en este momento. " +
    "Un asesor de la clínica te escribe en breve.";

  await enqueue({
    workspaceId: ws.id,
    conversationId: conv.conversationId,
    chatId: Number(datos.chatId),
    texto,
  });
  await guardarSalida(ws, conv, texto);

  await sql`update conversations set state = 'handoff_pending', updated_at = now()
             where id = ${conv.conversationId}`;
  await logEvent({
    workspaceId: ws.id, conversationId: conv.conversationId,
    type: "state_change", level: "warn",
    payload: { from: conv.state, to: "handoff_pending", reason: motivo },
  });

  const fails = await registrarResultadoLlm(conv.conversationId, false);
  if (fails >= UMBRAL_FALLOS_SEGUIDOS) {
    await alertarFallosLlmSeguidos(ws, conv.conversationId, fails);
    await registrarResultadoLlm(conv.conversationId, true); // reinicia el contador: ya se avisó
  }

  return { ok: false, motivo };
}

/**
 * Contador de fallos SEGUIDOS en `conversations.meta` (spec 15: alerta al
 * grupo tras 3 fallos de LLM seguidos). `exito: true` lo resetea a 0;
 * `exito: false` lo incrementa y devuelve el nuevo valor.
 */
async function registrarResultadoLlm(conversationId: string, exito: boolean): Promise<number> {
  if (exito) {
    await sql`update conversations set meta = meta - 'llmFails' where id = ${conversationId}`;
    return 0;
  }
  const [fila] = await sql<{ fails: number }[]>`
    update conversations
       set meta = jsonb_set(meta, '{llmFails}', to_jsonb(coalesce((meta->>'llmFails')::int, 0) + 1))
     where id = ${conversationId}
    returning (meta->>'llmFails')::int as fails`;
  return fila?.fails ?? 0;
}

async function datosDelPaciente(contactId: string) {
  const [c] = await sql<
    { tg_chat_id: string; full_name: string | null; first_name: string | null;
      phone: string | null; resumen: string | null }[]
  >`select c.tg_chat_id, c.full_name, c.first_name, c.phone,
           (select summary from conversations where contact_id = c.id limit 1) as resumen
      from contacts c where c.id = ${contactId}`;
  return {
    chatId: c?.tg_chat_id ?? "0",
    nombre: c?.full_name ?? c?.first_name ?? null,
    telefono: c?.phone ?? null,
    resumen: c?.resumen ?? null,
  };
}

async function guardarSalida(ws: Workspace, conv: Conversacion, texto: string) {
  await sql`
    insert into messages (workspace_id, conversation_id, direction, kind, body)
    values (${ws.id}, ${conv.conversationId}, 'out', 'text', ${texto})`;
  await sql`update conversations set last_ai_at = now(), state = 'awaiting_reply'
             where id = ${conv.conversationId}`;
}
