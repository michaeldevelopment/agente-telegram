# Spec 07 · Motor de decisión y comandos

**Depende de:** 06 · **Entorno:** local · **~45 min**

## Qué construye

La capa barata que corre **antes** de gastar el modelo. Decide, con 0 tokens, si el turno lo atiende el agente, un handler determinista, o nadie.

Al terminar, `/humano` silencia a la IA de verdad: el invariante que le vende el producto al cliente — *tu equipo no pierde el control*.

## Archivos

| Archivo | | Qué va dentro |
|---|---|---|
| `src/runtime/decide.ts` | nuevo | `decide()`: solo SQL y lógica |
| `src/runtime/state.ts` | nuevo | Transiciones + evento `state_change` |
| `src/handlers/commands.ts` | nuevo | `/start`, `/ayuda`, `/humano` |
| `src/handlers/callbacks.ts` | nuevo | Ruteo de `callback_query` + `answerCallbackQuery` |
| `src/runtime/buffer.ts` | editado | Al cerrar el lote, pasa por `decide()` |

## La decisión

```ts
export function decide(turn: ConsolidatedTurn, conv: Conversation): Decision {
  if (conv.contact.isBlocked)            return { kind:"abstain", reason:"blocked" };
  if (!conv.aiEnabled)                   return { kind:"abstain", reason:"ai_disabled" };
  if (conv.state === "human_active")     return { kind:"abstain", reason:"human_active" };
  if (conv.state === "handoff_pending")  return { kind:"abstain", reason:"human_active" };
  if (conv.state === "paused")           return { kind:"abstain", reason:"paused" };
  if (turn.command)                      return { kind:"deterministic", handler: turn.command };
  if (turn.callbackData)                 return { kind:"deterministic", handler:"callback" };
  // isClinicalUrgency llega en la spec 15
  return { kind:"run_agent" };
}
```

**El orden es deliberado.** Los `abstain` van primero porque son la garantía de la state machine. Después los caminos gratis. El agente es el último recurso.

## El invariante

> En `human_active`, `handoff_pending`, `paused` y `closed`, **la IA no genera nada**.

Única excepción: en `handoff_pending` se permite **un** mensaje de transición. Si la IA sigue hablando ahí, contradice al humano que está a punto de entrar.

Toda transición se escribe en `events` como `state_change` con `{from, to, reason}`.

## Comandos

| Comando | Qué hace |
|---|---|
| `/start` | Saludo con el nombre de la clínica. Guarda `source` del payload |
| `/ayuda` | Qué puede hacer el bot, en 3 líneas. Teléfono de la clínica |
| `/humano` | Estado a `paused` y avisa al paciente. **El grupo interno llega en la spec 13** |

Registrar los tres en @BotFather con `/setcommands`.

## Botones

**Siempre** hay que responder `answerCallbackQuery`, incluso si la acción falla, o el botón se queda girando en el cliente del paciente.

Por ahora el ruteo reconoce el prefijo y responde; los handlers reales llegan en las specs 12, 13 y 14.

## Terminada cuando

- [ ] **`/humano` pausa de verdad**: después de mandarlo, escribe dos mensajes más
      ```sql
      select count(*) from events where type='llm_call'
       and created_at > '<momento del /humano>';   -- 0
      ```
- [ ] El estado cambió y quedó registrado
      ```sql
      select payload->>'from', payload->>'to', payload->>'reason'
        from events where type='state_change' order by created_at desc limit 1;
      -- ai_active, paused, command
      ```
- [ ] `/ayuda` responde con el teléfono **+57 322 236 3192**
- [ ] `/start` tras `/humano` reactiva la conversación
- [ ] Un `callback_query` cualquiera recibe `answerCallbackQuery`: **el botón no queda girando**
- [ ] Un contacto con `is_blocked = true` → `abstain`, sin llamada al LLM ni intento de envío
- [ ] Los comandos **saltan el buffer**: `/humano` responde al instante, no a los 12 s
- [ ] `scripts/smoke/07.sh` sale con código 0

## Trampas

- `handoff_pending` **también** abstiene. Es la ventana en que la escalada ya se detectó pero nadie la tomó.
- Si un comando llega dentro de un lote con texto libre, **gana el comando**; el texto se conserva en el historial.
- `callback_data` ≤ **64 bytes**. Nunca un uuid completo.
- No borres el clasificador que no existe: **no hay clasificador LLM**. Una llamada por turno, no dos. Si te ves añadiendo una llamada "para decidir", relee `../memoria/sin-clasificador-llm.md`.

## Referencias

- Blueprint §4.3 (motor de decisión), §4.7 (state machine)
- `../../knowledge/wiki/Motor-de-Decision.md`, `../../knowledge/wiki/State-Machine-y-Handoff.md`
- `../memoria/sin-clasificador-llm.md`
