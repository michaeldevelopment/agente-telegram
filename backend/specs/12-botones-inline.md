# Spec 12 · Botones inline de horario

**Depende de:** 10, 07 · **Entorno:** local · **~40 min**

## Qué construye

Los horarios dejan de ser texto y pasan a ser **botones**. El paciente toca uno y la cita se agenda.

La clave no es la estética: es que **la confirmación no gasta una llamada al LLM**. Es el paso 5 del guion, y la frase que lo acompaña es *"esta confirmación no gastó una llamada al modelo"*.

## Archivos

| Archivo | | Qué va dentro |
|---|---|---|
| `src/egress/keyboards.ts` | nuevo | Construcción del `inline_keyboard` y codificación del `callback_data` |
| `src/handlers/callbacks.ts` | editado | Handler `bk:` — agenda sin pasar por el agente |
| `src/tools/disponibilidad.ts` | editado | Adjunta los botones a la respuesta |

## El teclado

```ts
reply_markup: { inline_keyboard: slots.map(s => [{
  text: formatSlot(s, ws.timezone),                  // "jue 29 oct · 10:30 a. m."
  callback_data: `bk:${service.slug}:${s.epochMin}`, // ≤64 bytes
}]) }
```

Un botón por fila: en móvil se leen mejor y las etiquetas de fecha son largas.

## El `callback_data` codifica la intención

```
bk:limpieza-dental:29876430
│  │                └─ minutos epoch → reconstruye el instante exacto
│  └─ slug del servicio → duración y buffer
└─ acción
```

Con eso, el handler **sabe todo lo que necesita** para agendar sin preguntarle nada al modelo:

```
callback bk: → answerCallbackQuery → reconstruir slot → agendar_cita.run() → confirmar
```

Pasa por el [[motor de decisión]] como `deterministic`, nunca llega al agente.

> **Límite duro de 64 bytes.** `bk:brackets-esteticos:29876430` son 31 — hay margen, pero mídelo. Nunca un uuid completo. Si algún día no cabe, guarda el payload en una tabla y manda su id corto.

## Reutiliza, no reimplementes

El handler llama a **la misma** `agendarCita.run()` de la spec 10, con los args reconstruidos. Nada de una segunda ruta de agendamiento: la revalidación, el índice único y el id determinista valen igual.

## Y siempre `answerCallbackQuery`

Incluso si la acción falla. Si no, el botón se queda girando en el cliente del paciente y parece que el bot murió.

- Éxito → `answerCallbackQuery("Listo, te confirmo")`
- Slot ocupado → `answerCallbackQuery("Ese horario se acaba de ocupar", show_alert: true)` y el bot ofrece alternativas

Tras agendar, **edita el mensaje** para quitar los botones. Si no, el paciente puede tocar otro horario y agendar dos veces.

## Terminada cuando

- [ ] Pedir disponibilidad → llegan **hasta 4 botones** con horarios reales
- [ ] **Tocar un botón agenda la cita**, y aparece en Google Calendar
- [ ] 🔑 **Cero llamadas al LLM entre el toque y la confirmación**
      ```sql
      select count(*) from events where type='llm_call'
       and created_at > '<momento del toque>';   -- 0
      ```
- [ ] El `callback_data` mide **≤64 bytes** para el slug más largo (`brackets-esteticos`)
- [ ] **El botón nunca queda girando**, ni cuando el slot ya se ocupó
- [ ] Tras agendar, **los botones desaparecen** del mensaje
- [ ] Tocar un botón de un slot que se ocupó → aviso claro + alternativas, sin romperse
- [ ] Tocar un botón viejo (de hace rato) → se revalida y responde con sentido
- [ ] La cita agendada por botón es **idéntica** en la base a una agendada por texto
- [ ] `scripts/smoke/12.sh` sale con código 0

## Trampas

- `answerCallbackQuery` **siempre**, es el error número uno con botones.
- Los botones saltan el buffer: un click es un turno completo e intencional, no hay que esperar 12 s.
- Si el mensaje con botones es viejo, Telegram puede rechazar la edición. Captura el error y sigue.
- `epochMin` en minutos, no en segundos ni milisegundos: es lo que hace que quepa en 64 bytes.
- No ofrezcas slots solapados (spec 08): si el paciente ve 10:00 y 10:15 para un servicio de 45 min y al reservar uno desaparece el otro, siente que lo engañaron.

## Referencias

- Blueprint §4.6 (botones inline), §5 regla 4 (reglas duras antes del modelo)
- `../../knowledge/wiki/Salida-y-Outbox.md`, `../../knowledge/wiki/Motor-de-Decision.md`
- `../../knowledge/wiki/Clinica-Gonzalez-Guion-Demo.md` (paso 5)
- `../memoria/sin-clasificador-llm.md`
