---
titulo: Motor de decisión
tipo: base
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §4.3"
actualizado: 2026-10-22
tags: [runtime, decision, tokens, handoff]
---

# Motor de decisión

Capa barata **antes** de gastar el modelo. Cero tokens: solo SQL y lógica. Decide si el turno lo atiende el agente, un handler determinista, o nadie.

## La decisión

```ts
export type Decision =
  | { kind: "run_agent" }
  | { kind: "deterministic"; handler: string }   // comando, botón o urgencia
  | { kind: "abstain"; reason: AbstainReason };

export function decide(turn: ConsolidatedTurn, conv: Conversation): Decision {
  if (conv.contact.isBlocked)            return { kind: "abstain", reason: "blocked" };
  if (!conv.aiEnabled)                   return { kind: "abstain", reason: "ai_disabled" };
  if (conv.state === "human_active")     return { kind: "abstain", reason: "human_active" };
  if (conv.state === "handoff_pending")  return { kind: "abstain", reason: "human_active" };
  if (conv.state === "paused")           return { kind: "abstain", reason: "paused" };
  if (turn.command)                      return { kind: "deterministic", handler: turn.command };
  if (turn.callbackData)                 return { kind: "deterministic", handler: "callback" };
  if (isClinicalUrgency(turn.text))      return { kind: "deterministic", handler: "urgency" };
  return { kind: "run_agent" };
}
```

**El orden es deliberado.** Los `abstain` van primero porque son la garantía de la [[State-Machine-y-Handoff|state machine]]: si un humano tomó la conversación, la IA no genera nada, punto. Después los caminos deterministas, que son gratis. El agente es el último recurso.

## La gran diferencia con el blueprint original: se elimina el clasificador LLM

El original hace **dos llamadas por turno**: clasificar con un modelo barato, responder con uno fuerte. Eso tenía sentido con un modelo de respuesta caro.

Con `deepseek-flash` el modelo de respuesta **ya es** el barato. Un clasificador separado duplica las llamadas y duplica el prefijo del prompt, para decidir algo que el propio agente puede expresar llamando a una tool (`escalar_a_humano`).

**Resultado: una llamada por turno en vez de dos.** Ver [[Economia-de-Tokens]].

### Cuándo volver a añadirlo

Si el volumen llega a decenas de miles de turnos/mes **y** se mide que >30% de los turnos son chitchat que no necesita el catálogo completo de tools. Hasta entonces es complejidad sin retorno.

## `isClinicalUrgency` — determinista y generosa

Es una **lista de términos, no un modelo**: *dolor insoportable, se me rompió un diente, sangra, golpe, absceso, inflamación con fiebre, no puedo abrir la boca*.

La asimetría manda el diseño:

- Falso positivo = una escalada innecesaria. Molesto.
- Falso negativo en salud = **inaceptable**.

Por eso es determinista y por eso peca de generosa. Nunca se le consulta al modelo. Ver [[Guardrails-Clinicos]].

Una urgencia además **salta el buffer**: no se esperan los 12 s de silencio. Ver [[Buffer-y-Batching]], regla 6.

## Lo que esto absorbe gratis

En una demo de agendamiento, los botones de horario absorben el **100% de las confirmaciones** — justo el momento en que un bot mal hecho gastaría dos o tres turnos de ida y vuelta. Es la [[Economia-de-Tokens|regla 4]] en acción.

Son deterministas: comandos (`/start`, `/ayuda`, `/humano`), botones de horario, botones de los recordatorios (`Confirmar`/`Reprogramar`/`Cancelar`), botones del grupo de handoff (`Tomar`/`Devolver`) y urgencias clínicas.

## Gotchas

- `handoff_pending` también abstiene. Es la ventana en que la escalada ya se detectó pero nadie la tomó: si la IA sigue hablando ahí, contradice al humano que está a punto de entrar. Se permite **un único** mensaje de transición.
- `isBlocked` abstiene antes que nada: seguir generando para un chat que nos bloqueó es quemar tokens contra un `403`.
- Si un comando llega dentro de un lote con texto libre, gana el comando. El texto se conserva en el historial.

## Relacionado

- [[Arquitectura]] — etapa 3 del flujo
- [[State-Machine-y-Handoff]] — los estados que producen `abstain`
- [[Guardrails-Clinicos]] — la primera capa, determinista
- [[Agente-DeepSeek]] — qué pasa en `run_agent`
- [[Economia-de-Tokens]] — regla 4
