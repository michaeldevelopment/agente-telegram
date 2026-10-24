import { callWithRetry, type MensajeLlm } from "../llm/deepseek.js";
import type { SlotDTO } from "../gcal/slots.js";
import { logEvent } from "../obs/events.js";
import { toolByName, toolDefsFor } from "../tools/registry.js";
import type { ToolContext } from "../tools/types.js";

/** Techo anti-loop. Si se agota sin texto, NO se insiste: se escala. */
const MAX_STEPS = 4;

/** Último `consultar_disponibilidad` con resultados, para los botones (spec 12). */
export type OfrecimientoSlots = { servicio: string; slots: SlotDTO[] };

export type ResultadoLoop =
  | {
      ok: true; texto: string; steps: number;
      uso: { hit: number; miss: number; output: number };
      teclado?: OfrecimientoSlots;
    }
  | { ok: false; motivo: "overflow" | "vacio"; steps: number; uso: { hit: number; miss: number; output: number } };

/**
 * El loop de tool-calling. Mismo formato que la API de OpenAI porque
 * DeepSeek es compatible:
 *
 *   1. tool_calls[].function.arguments es un STRING JSON → JSON.parse().
 *   2. Re-anexar el mensaje `assistant` con sus tool_calls ANTES de los
 *      resultados. Omitirlo rompe el contexto y el modelo repite la llamada.
 *   3. Un mensaje {role:"tool", tool_call_id, content} POR CADA call.
 *   4. Validar con Zod ANTES de ejecutar — el LLM alucina fechas, ids, enums.
 */
export async function runLoop(
  mensajesIniciales: MensajeLlm[],
  ctx: ToolContext,
  opts: { maxTokens?: number } = {},
): Promise<ResultadoLoop> {
  const mensajes = [...mensajesIniciales];
  // Único agent_type implementado hasta ahora. Cuando llegue ecommerce_closer,
  // esto se vuelve ctx.workspace.agentType (requiere traerlo a Workspace).
  const agentType = "appointment_setter";
  const toolDefs = toolDefsFor(agentType);

  const usoTotal = { hit: 0, miss: 0, output: 0 };
  let teclado: OfrecimientoSlots | undefined;

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await callWithRetry(mensajes, { maxTokens: opts.maxTokens, tools: toolDefs });

    usoTotal.hit += res.uso.hit;
    usoTotal.miss += res.uso.miss;
    usoTotal.output += res.uso.output;

    if (res.toolCalls.length === 0) {
      const texto = res.texto.trim();
      if (!texto) return { ok: false, motivo: "vacio", steps: step + 1, uso: usoTotal };
      return { ok: true, texto, steps: step + 1, uso: usoTotal, teclado };
    }

    // PASO 1: re-anexar el assistant con sus tool_calls ANTES de los resultados.
    mensajes.push(res.mensajeAssistant);

    for (const call of res.toolCalls) {
      const t0 = Date.now();
      const tool = toolByName(agentType, call.function.name);
      let resultado: { ok: boolean; data?: unknown; error?: string };

      if (!tool) {
        resultado = { ok: false, error: `tool_desconocida: ${call.function.name}` };
      } else {
        let args: unknown;
        try {
          args = JSON.parse(call.function.arguments); // arguments es un STRING
        } catch {
          resultado = { ok: false, error: "argumentos_invalidos: JSON malformado" };
          args = undefined;
        }

        if (args !== undefined) {
          const parsed = tool.schema.safeParse(args);
          if (!parsed.success) {
            resultado = { ok: false, error: `argumentos_invalidos: ${parsed.error.message}` };
          } else {
            try {
              resultado = await tool.run(parsed.data, ctx);
              // Botones (spec 12): el último ofrecimiento de horarios con
              // resultados gana. `disponibilidad.ts` ya los limita a 4.
              if (tool.name === "consultar_disponibilidad" && resultado.ok) {
                const data = resultado.data as { slots?: SlotDTO[] } | undefined;
                if (data?.slots && data.slots.length > 0) {
                  teclado = { servicio: (parsed.data as { servicio: string }).servicio, slots: data.slots };
                }
              }
            } catch (e) {
              // Una excepción inesperada (DB caída, Google sin credenciales,
              // lo que sea) se convierte en un ToolResult, no en un fallo
              // de todo el turno: es la misma filosofía que los errores de
              // validación, aplicada a los de ejecución. El modelo ve un
              // error legible y puede ofrecer conectar con el equipo; el
              // paciente no se queda sin respuesta por un detalle interno.
              resultado = { ok: false, error: `error_interno: ${e instanceof Error ? e.message : String(e)}` };
            }
          }
        }
      }

      await logEvent({
        workspaceId: ctx.workspace.id,
        conversationId: ctx.conversation.conversationId,
        type: "tool_call",
        level: resultado!.ok ? "info" : "warn",
        // Argumentos resumidos, NUNCA el cuerpo completo: puede traer PII.
        payload: {
          name: call.function.name,
          ok: resultado!.ok,
          error: resultado!.ok ? null : (resultado!.error ?? null),
          latencyMs: Date.now() - t0,
        },
      });

      // PASO 2: un mensaje "tool" por cada call, con su id correcto.
      mensajes.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(resultado!),
      });
    }
  }

  // Techo alcanzado: no insistir, escalar.
  return { ok: false, motivo: "overflow", steps: MAX_STEPS, uso: usoTotal };
}
