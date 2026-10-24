import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolDefLlm } from "../llm/deepseek.js";
import { consultarDisponibilidad } from "./disponibilidad.js";
import { consultarMisCitas } from "./mis-citas.js";
import { guardarDatosPaciente } from "./datos.js";
import { agendarCita } from "./agendar.js";
import { reprogramarCita } from "./reprogramar.js";
import { cancelarCita } from "./cancelar.js";
import { escalarAHumano } from "./escalar.js";
import type { ToolAny } from "./types.js";

/**
 * Catálogo por `agent_type`.
 *
 * ⚠️ EL ORDEN ES FIJO. El array `tools` se serializa DENTRO del prefijo
 * cacheado de DeepSeek: reordenarlo —o construirlo iterando un objeto, cuyo
 * orden de iteración no está garantizado— rompe el cache de TODOS los
 * clientes a la vez. Lo mismo con las descripciones: editarlas tiene costo,
 * se hace en bloque, no de a una.
 *
 * Nuevas tools se AÑADEN AL FINAL (ver spec 10: agendar_cita se registra
 * aquí mismo, al final, precisamente para no mover este orden).
 */
const CATALOGO: Record<string, ToolAny[]> = {
  appointment_setter: [
    consultarDisponibilidad,
    consultarMisCitas,
    guardarDatosPaciente,
    agendarCita,
    reprogramarCita,
    cancelarCita,
    escalarAHumano,
  ],
};

export function toolsFor(agentType: string): ToolAny[] {
  return CATALOGO[agentType] ?? [];
}

export function toolByName(agentType: string, name: string): ToolAny | undefined {
  return toolsFor(agentType).find((t) => t.name === name);
}

/** El array en el formato que espera la API, en el MISMO orden que toolsFor(). */
export function toolDefsFor(agentType: string): ToolDefLlm[] {
  return toolsFor(agentType).map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      // target "openApi3" evita $ref/$schema que algunos proveedores rechazan.
      parameters: zodToJsonSchema(t.schema as never, { target: "openApi3" }),
    },
  }));
}
