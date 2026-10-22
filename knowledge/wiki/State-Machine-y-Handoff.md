---
titulo: State machine y handoff
tipo: base
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §4.7"
actualizado: 2026-10-22
tags: [state-machine, handoff, telegram, operacion]
---

# State machine y handoff

La state machine gobierna **si** la IA puede hablar. El handoff es cómo el equipo de la clínica toma el control — y se opera **íntegramente dentro de Telegram**, sin panel web.

## Estados

```
ai_active ──responde──> awaiting_reply ──llega mensaje──> ai_active
    │                         │
    └──── escalada ───────────┘
              ▼
      handoff_pending ──un humano la toma──> human_active
              │                                   │
              │                       devuelve a la IA
              ▼                                   ▼
            paused <──────────────────────────> ai_active
              │
              ▼
            closed ──nuevo mensaje──> ai_active
```

Son los del blueprint original **menos los ligados a la ventana de 24 h**, que en Telegram no existe. Ver [[Telegram-vs-WhatsApp]].

## El invariante

> En `human_active`, `handoff_pending`, `paused` y `closed`, el [[Motor-de-Decision|motor de decisión]] devuelve `abstain` y **la IA no genera nada**.

Única excepción: en `handoff_pending` se permite **un** mensaje de transición ("te conecto con una asesora de la clínica"). Toda transición se escribe en `events` como `state_change` con `{from, to, reason}`.

Este invariante es lo que le vende el producto al cliente: *tu equipo no pierde el control*.

## Handoff operado desde Telegram

Sin panel web, el equipo trabaja desde un **grupo interno** donde está el bot (`workspaces.handoff_chat_id`).

```
escalar_a_humano(motivo, resumen)
  ├─ conversación → handoff_pending
  ├─ al paciente: "Te conecto con una asesora de la clínica, te escribe en unos minutos."
  └─ al grupo interno:
       🔔 Handoff · Clínica
       Paciente: María G. (@maria_g)
       Motivo: pregunta por cobertura de su EPS
       Resumen: quiere ortodoncia, preguntó precios, pide factura a nombre de empresa
       Últimos mensajes: …
       [ Tomar conversación ]  [ Devolver a la IA ]
```

- **`take:<conv_corto>`** → `human_active`, `assigned_to = from.id`, `answerCallbackQuery("La tienes tú")`, y se **edita el mensaje del grupo** para que conste quién la tomó.
- **`back:<conv_corto>`** → vuelve a `ai_active`, y se le pasa a la IA un resumen de lo que dijo el humano **para que no contradiga**.

### Relay bidireccional

El mensaje publicado en el grupo se registra en `handoff_relay` con su `group_message_id`. A partir de ahí:

- Alguien **responde a ese mensaje** en el grupo → el bot reenvía el texto al chat del paciente como mensaje de la clínica.
- El paciente escribe → se reenvía al hilo del grupo.

**Es el inbox completo, en Telegram, con cero frontend.** Es la razón por la que el panel web está [[Fuera-de-Alcance|fuera de alcance]].

## Disparadores de escalada

| Disparador | Origen |
|---|---|
| El modelo llama `escalar_a_humano` | Decisión del agente |
| El paciente escribe `/humano` o pide hablar con una persona | Determinista |
| `isClinicalUrgency` dispara | Determinista, **salta el buffer** |
| El loop de tools se desborda (`MAX_STEPS`) | Fallo controlado |
| DeepSeek falla tres veces | Fallo de proveedor |
| El paciente lleva 3 turnos sin avanzar | Contador en `conversations.meta` |

Los dos deterministas son los importantes: no dependen de que el modelo "se dé cuenta". Ver [[Guardrails-Clinicos]] y [[Motor-de-Decision]].

## Gotchas

- Si la IA sigue hablando en `handoff_pending`, contradice al humano que está a punto de entrar. El `abstain` ahí no es opcional.
- Al devolver a la IA (`back:`), **hay que inyectarle qué dijo el humano**. Sin eso, la IA retoma como si nada hubiera pasado y se contradice.
- El `handoff_chat_id` de un grupo es **negativo**. Si se guarda mal, los avisos se pierden en silencio.
- `callback_data` ≤ 64 bytes: por eso `<conv_corto>`, no el uuid completo. Ver [[Salida-y-Outbox]].
- El bot necesita estar en el grupo y, según la configuración de privacidad de @BotFather, puede que no vea los mensajes que no le mencionan. Hay que desactivar el modo privacidad o usar respuestas directas al mensaje.

## Relacionado

- [[Motor-de-Decision]] — quién hace cumplir el invariante
- [[Capa-de-Tools]] — `escalar_a_humano`
- [[Guardrails-Clinicos]] — la urgencia como disparador
- [[Observabilidad]] — el evento `handoff` y la tasa de escalada
- [[Clinica-Gonzalez-Guion-Demo]] — paso 11, donde se demuestra
