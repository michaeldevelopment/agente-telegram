import type { z } from "zod";
import type { Conversacion, Workspace } from "../ingress/persist.js";

/**
 * La interfaz común de toda tool. El modelo solo ve `name`, `description` y
 * el JSON Schema derivado de `schema` — el `run` encapsula el cómo.
 */

/**
 * `data` en la rama de error es deliberado: `agendar_cita` (spec 10) devuelve
 * alternativas de horario junto con `slot_ocupado`, para que el modelo las
 * ofrezca sin una segunda llamada a `consultar_disponibilidad`.
 */
export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; data?: unknown };

export type ToolContext = {
  workspace: Workspace;
  conversation: Conversacion;
};

export interface Tool<A = unknown> {
  /** snake_case, EN ESPAÑOL: el modelo razona mejor en el idioma del prompt. */
  name: string;
  /** Qué hace Y CUÁNDO usarla. Es lo que el modelo usa para decidir. */
  description: string;
  /**
   * Valida los args del LLM. El JSON Schema para la API se deriva de aquí.
   *
   * El tercer genérico (`any`) es deliberado: un esquema con `.default()`
   * tiene un tipo de ENTRADA distinto al de SALIDA (la entrada admite el
   * campo ausente; la salida ya lo trae puesto), y `z.infer` da el de
   * salida. `z.ZodType<A>` a secas exige que ambos coincidan, lo cual
   * rompe con cualquier tool que use `.default()` — como `disponibilidad.ts`.
   */
  schema: z.ZodType<A, z.ZodTypeDef, any>;
  run(args: A, ctx: ToolContext): Promise<ToolResult>;
}

/** Para registry.ts: una tool con su tipo de args borrado, lista para el loop. */
export type ToolAny = Tool<unknown>;
