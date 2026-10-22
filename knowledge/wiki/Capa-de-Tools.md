---
titulo: Capa de tools
tipo: base
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §4.5"
actualizado: 2026-10-22
tags: [tools, zod, agendamiento, idempotencia]
---

# Capa de tools

Interfaz común para todo lo que el modelo puede ejecutar. El modelo solo ve `name`, `description` y `parameters`; el `run` encapsula el cómo y es donde vive toda la validación.

```ts
export interface Tool<A = unknown> {
  name: string;                // snake_case, EN ESPAÑOL
  description: string;         // qué hace Y cuándo usarla
  schema: z.ZodType<A>;        // valida los args del LLM y genera el JSON Schema
  run(args: A, ctx: ToolContext): Promise<ToolResult>;
}

export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };
```

**Los nombres van en español** porque el modelo razona mejor en el idioma del prompt. `consultar_disponibilidad`, no `check_availability`.

## Catálogo del agente de agendamiento

| Tool | Qué hace | Nota de diseño |
|---|---|---|
| `consultar_disponibilidad` | Slots libres para un servicio en un rango | Devuelve **máximo 4** opciones. Más = más tokens y peor conversión |
| `agendar_cita` | Revalida el slot, inserta en DB y en Google Calendar, programa recordatorios | Idempotente. La única tool que escribe en el calendario |
| `reprogramar_cita` | Mueve una cita existente | Revalida disponibilidad y reprograma los recordatorios |
| `cancelar_cita` | Cancela y libera el bloque | Cancela también los recordatorios pendientes |
| `guardar_datos_paciente` | Upsert de nombre / teléfono / email / notas | Se llama en cuanto el paciente los da, sin esperar a agendar |
| `consultar_mis_citas` | Próximas citas del paciente | Evita que el modelo invente lo que ya agendó |
| `escalar_a_humano` | Handoff con motivo y resumen | Sustituye al clasificador de handoff del blueprint original |

El paquete depende del `agent_type`. Ver [[Tipo-Appointment-Setter]] y [[Tipo-Ecommerce-Closer]].

## No hay tool de catálogo de servicios

Decisión deliberada. Los servicios y precios van en el **bloque estático del system prompt**: ~600 tokens que el cache sirve casi gratis, contra una llamada extra al LLM cada vez que alguien pregunta "¿cuánto cuesta una limpieza?".

El blueprint original usaba `search_knowledge_base` con pgvector. A este tamaño de contenido, RAG es más caro y más frágil que meterlo en el prompt. Ver [[Economia-de-Tokens]], regla 7.

## `agendar_cita` — el camino crítico

Tres cosas lo hacen robusto, y **ninguna depende del LLM**:

### 1. Revalidación del slot antes de escribir

Entre que el modelo propone y el paciente confirma pasan segundos o minutos. El slot pudo ocuparse. Si está ocupado, no se falla a secas: se devuelven alternativas para que el modelo siga la conversación.

```ts
if (!(await isSlotFree(ctx.workspace, start, end))) {
  const alt = await computeSlots({ ... limit: 3 });
  return { ok: false, error: "slot_ocupado", data: { alternativas: alt } };
}
```

### 2. El índice único `uq_appt_slot` en Postgres

El candado **real** contra doble reserva, incluso con dos conversaciones simultáneas. La revalidación es cortesía; el índice es la garantía. Ver [[Esquema-de-Datos]].

### 3. Id de evento determinista

```ts
const eventId = appt.id.replace(/-/g, "");   // 32 chars hex ⊂ base32hex ✔
```

Derivado del uuid de la cita. Si la llamada a Google falla y se reintenta, el `409` confirma que ya está creado en vez de duplicar. Ver [[Google-Calendar]].

### Validaciones duras que el modelo no puede saltarse

```ts
if (!start.isValid)  return { ok: false, error: "fecha_invalida" };
if (start < DateTime.now().plus({ hours: 2 }))
  return { ok: false, error: "muy_pronto: minimo 2 horas de anticipacion" };
```

Y el `servicio` se resuelve contra `services` del workspace: un slug inventado devuelve `servicio_desconocido`.

## Por qué los errores se devuelven, no se lanzan

Un `ToolResult` con `ok: false` y un `error` legible entra al contexto del modelo, que **se corrige solo en el siguiente paso** del loop. Una excepción mata el turno y obliga a escalar.

Los códigos de error son cortos y semánticos a propósito: `slot_ocupado`, `muy_pronto`, `servicio_desconocido`, `fecha_invalida`, `argumentos_invalidos`. El modelo los entiende sin que haya que explicárselos.

## Qué fija el servidor y el modelo no toca

Esto es [[Seguridad|superficie de seguridad]], no comodidad:

- El **calendario** sobre el que se escribe.
- El **rango de fechas** válido (horizonte de 21 días).
- El **horario de atención**, los descansos y los cierres.
- La **duración** del servicio y su buffer.
- La **anticipación mínima**.

El modelo propone; el servidor decide. Un slot inventado se rechaza con `slot_ocupado` o `muy_pronto`.

## Gotchas

- `arguments` del tool call es un **string**, hay que parsearlo.
- Validar con Zod **antes** de ejecutar, siempre.
- El orden del array `tools` entra en el prefijo cacheado: **reordenarlas rompe el cache de todos los clientes a la vez**. Ver [[Cache-de-Prefijo]].
- Las descripciones de las tools también están en el prefijo. Editarlas tiene costo: hay que hacerlo en bloque, no de a poco.

## Relacionado

- [[Agente-DeepSeek]] — el loop que las ejecuta
- [[Google-Calendar]] — a dónde escribe `agendar_cita`
- [[Calculo-de-Slots]] — el motor detrás de `consultar_disponibilidad`
- [[State-Machine-y-Handoff]] — qué hace `escalar_a_humano`
- [[Cache-de-Prefijo]] — por qué el orden importa
