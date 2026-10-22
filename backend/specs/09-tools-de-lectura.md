# Spec 09 · Tools de lectura

**Depende de:** 05, 08 · **Entorno:** local · **~55 min**

## Qué construye

El agente deja de ser un conversador y empieza a tener manos. Se añade la interfaz común de tools, el loop de tool-calling y las tres tools que **solo leen**: disponibilidad, citas del paciente y guardado de datos.

Al terminar, el bot ofrece horarios **reales del calendario**. Es el paso 4 del guion de la demo, sin los botones todavía.

## Archivos

| Archivo | | Qué va dentro |
|---|---|---|
| `src/tools/types.ts` | nuevo | Interfaz `Tool`, `ToolResult`, `ToolContext` |
| `src/tools/registry.ts` | nuevo | Catálogo por `agent_type`, **en orden fijo** |
| `src/tools/disponibilidad.ts` | nuevo | `consultar_disponibilidad` |
| `src/tools/mis-citas.ts` | nuevo | `consultar_mis_citas` |
| `src/tools/datos.ts` | nuevo | `guardar_datos_paciente` |
| `src/agent/loop.ts` | nuevo | Loop de tool-calling con techo |
| `src/agent/run.ts` | editado | Pasa el array `tools` |

## La interfaz

```ts
export interface Tool<A = unknown> {
  name: string;                // snake_case, EN ESPAÑOL
  description: string;         // qué hace Y cuándo usarla
  schema: z.ZodType<A>;        // valida los args del LLM
  run(args: A, ctx: ToolContext): Promise<ToolResult>;
}

export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };
```

**Los nombres van en español** porque el modelo razona mejor en el idioma del prompt.

## El loop

```ts
const MAX_STEPS = 4;   // techo anti-loop
```

Cuatro cosas que no se pueden saltar:

1. `tool_calls[].function.arguments` es un **string JSON** → `JSON.parse()`.
2. **Re-anexar el mensaje `assistant` con sus `tool_calls` ANTES** de los resultados. Omitirlo rompe el contexto y el modelo repite la llamada.
3. Un mensaje `{role:"tool", tool_call_id, content}` **por cada** call, con su id correcto.
4. **Validar con Zod antes de ejecutar.** El LLM alucina fechas, ids y enums.

Si se agota el techo sin respuesta de texto: **no insistir, escalar.**

## Los errores se devuelven, no se lanzan

Un `ToolResult` con `ok: false` entra al contexto y **el modelo se corrige solo** en el paso siguiente. Una excepción mata el turno.

Códigos cortos y semánticos a propósito: `slot_ocupado`, `muy_pronto`, `servicio_desconocido`, `fecha_invalida`, `argumentos_invalidos`. El modelo los entiende sin explicación.

## Las tres tools

**`consultar_disponibilidad`** — envuelve `computeSlots` de la spec 08. Máximo 4 opciones. El `description` debe decir explícitamente *"úsala SIEMPRE antes de proponer un horario; nunca inventes disponibilidad"*.

**`consultar_mis_citas`** — próximas citas del paciente. Evita que el modelo invente lo que ya agendó.

**`guardar_datos_paciente`** — upsert de nombre, teléfono, email, notas. Se llama **en cuanto el paciente los da**, sin esperar a agendar. `notes` es para preferencias logísticas, **nunca historia médica**.

## No hay tool de catálogo de servicios

Decisión deliberada. Los servicios y precios van en el prompt estático: ~600 tokens que el cache sirve casi gratis, contra una llamada extra al LLM cada vez que alguien pregunta "¿cuánto cuesta una limpieza?".

Si te ves creando `consultar_servicios`, relee `../../knowledge/wiki/Economia-de-Tokens.md` regla 7.

## El orden del array es parte del cache

> El array `tools` se serializa **dentro del prefijo cacheado**. Reordenarlo rompe el cache de todos los clientes a la vez.

Fija el orden en `registry.ts` con un comentario que lo diga. Lo mismo con las descripciones: editarlas tiene costo, hazlo en bloque.

## Terminada cuando

- [ ] **El bot ofrece 3 horarios reales**: pide una limpieza para esta semana → los horarios que da **existen en el calendario** y respetan el horario de la clínica
- [ ] Se registró la tool call
      ```sql
      select payload->>'name', payload->>'ok', payload->>'latencyMs'
        from events where type='tool_call' order by created_at desc limit 3;
      ```
- [ ] **El modelo se corrige solo**: provoca un `servicio_desconocido` (pide "ortodoncia invisible para mañana") → devuelve el error y el bot **reformula** en el paso siguiente, sin romperse
- [ ] Dar tu nombre en el chat → queda en `contacts.full_name` sin que haya que agendar
- [ ] Preguntar "¿qué citas tengo?" sin tener ninguna → responde que no hay, **sin inventar**
- [ ] 🚩 **El cache sigue sano**: hit ratio **> 60%** tras una conversación con tools
- [ ] El loop se corta a los 4 pasos sin quedarse colgado
- [ ] El orden de `tools` está fijado y comentado en `registry.ts`
- [ ] `scripts/smoke/09.sh` sale con código 0

## Trampas

- Validar con Zod **antes** de ejecutar, siempre.
- El `description` de cada tool es lo que el modelo usa para decidir: escribe *cuándo* usarla, no solo *qué* hace.
- Si el cache hit cae al añadir las tools, es que el array se está construyendo en orden variable (p. ej. iterando un objeto).
- No metas PII en el `payload` de `tool_call`: argumentos resumidos, no cuerpos completos.

## Referencias

- Blueprint §4.5 (capa de tools), §4.4.4 (el loop)
- `../../knowledge/wiki/Capa-de-Tools.md`, `../../knowledge/wiki/Cache-de-Prefijo.md`
- `../memoria/tipo-appointment-setter.md`
