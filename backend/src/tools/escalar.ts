import { z } from "zod";
import { enviarAvisoGrupo } from "../handoff/group.js";
import { transitionState } from "../runtime/state.js";
import type { Tool, ToolContext } from "./types.js";

const Args = z.object({
  motivo: z.string().min(3).max(200).describe("por qué se escala, en pocas palabras"),
  resumen: z.string().max(500).optional()
    .describe("resumen breve de lo que el paciente necesita, para quien lo atienda"),
});

/**
 * Escala la conversación a una persona del equipo (spec 13). El aviso al
 * grupo y la pausa de la IA son deterministas — lo único que depende del
 * modelo es REDACTAR el motivo y decidir CUÁNDO llamarla.
 *
 * `human_active`/`handoff_pending` abstienen en `runtime/decide.ts`: en
 * cuanto esta tool corre, la IA deja de hablar en los turnos siguientes,
 * hasta que alguien del equipo "Devuelva" la conversación.
 */
export const escalarAHumano: Tool<z.infer<typeof Args>> = {
  name: "escalar_a_humano",
  description:
    "Conecta al paciente con una persona del equipo de la clínica. Úsala cuando el " +
    "paciente lo pida explícitamente, cuando no puedas resolver lo que necesita, o " +
    "ante cualquier duda clínica que no debas responder tú. Tras llamarla, responde " +
    "EXACTAMENTE el texto de data.mensaje_paciente, sin añadir nada más.",
  schema: Args,

  async run(a, ctx: ToolContext) {
    await transitionState(
      ctx.workspace, ctx.conversation.conversationId, "handoff_pending", `tool:escalar_a_humano (${a.motivo})`,
    );
    await enviarAvisoGrupo(ctx.workspace, ctx.conversation, { motivo: a.motivo, resumen: a.resumen });

    return {
      ok: true,
      data: {
        mensaje_paciente: "Te conecto con una asesora de la clínica, te escribe en unos minutos.",
      },
    };
  },
};
