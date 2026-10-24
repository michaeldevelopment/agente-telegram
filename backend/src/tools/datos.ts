import { z } from "zod";
import { sql } from "../db/client.js";
import type { Tool, ToolContext } from "./types.js";

const Args = z.object({
  nombre: z.string().min(3).optional().describe("nombre completo del paciente"),
  telefono: z.string().optional(),
  email: z.string().email().optional(),
  notas: z.string().max(300).optional()
    .describe("preferencias logísticas (horario preferido, con quién viene), NUNCA historia médica"),
});

/**
 * Upsert de los datos que el paciente va dando. Se llama EN CUANTO los
 * entrega, sin esperar a que agende — es lo que hace que `agendar_cita`
 * (spec 10) ya tenga el nombre listo en vez de tener que pedirlo dos veces.
 *
 * `notas` es para preferencias logísticas. Nunca para alergias, antecedentes
 * ni medicación: eso lo toma el profesional en consulta (regla 9 del prompt,
 * ver memoria/nunca-diagnosticar-ni-recetar.md).
 */
export const guardarDatosPaciente: Tool<z.infer<typeof Args>> = {
  name: "guardar_datos_paciente",
  description:
    "Guarda el nombre, teléfono, email o notas logísticas que el paciente entregue. " +
    "Llámala EN CUANTO el paciente dé un dato, no esperes a que termine de agendar. " +
    "NUNCA uses 'notas' para alergias, antecedentes o medicación — eso no se registra aquí.",
  schema: Args,

  async run(a, ctx: ToolContext) {
    if (!a.nombre && !a.telefono && !a.email && !a.notas) {
      return { ok: false, error: "argumentos_invalidos: no se dio ningún dato para guardar" };
    }

    const sets: string[] = [];
    if (a.nombre) sets.push("nombre");
    if (a.telefono) sets.push("teléfono");
    if (a.email) sets.push("email");
    if (a.notas) sets.push("notas");

    await sql`
      update contacts set
        full_name = coalesce(${a.nombre ?? null}, full_name),
        phone     = coalesce(${a.telefono ?? null}, phone),
        email     = coalesce(${a.email ?? null}, email),
        notes     = coalesce(${a.notas ?? null}, notes),
        updated_at = now()
      where id = ${ctx.conversation.contactId}`;

    return { ok: true, data: { guardado: sets } };
  },
};
