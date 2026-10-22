# Spec 13 · Handoff al grupo interno

**Depende de:** 07, 09 · **Entorno:** local · **~55 min**

## Qué construye

El inbox del equipo de la clínica, **dentro de Telegram, con cero frontend**. Cuando el agente escala, llega un aviso a un grupo interno con botones; alguien toca "Tomar conversación" y responde al paciente desde ahí.

Es el paso 11 del guion y uno de los tres que cierran la venta: *tu equipo no pierde el control*.

## Archivos

| Archivo | | Qué va dentro |
|---|---|---|
| `src/tools/escalar.ts` | nuevo | `escalar_a_humano` |
| `src/handoff/group.ts` | nuevo | Aviso al grupo, botones, edición del mensaje |
| `src/handoff/relay.ts` | nuevo | Puente bidireccional vía `handoff_relay` |
| `src/handlers/callbacks.ts` | editado | Handlers `take:` y `back:` |
| `src/handlers/commands.ts` | editado | `/humano` ahora avisa al grupo |
| `src/ingress/webhook.ts` | editado | Mensajes del grupo → relay |

## El aviso

```
🔔 Handoff · Clínica
Paciente: María G. (@maria_g)
Motivo: pregunta por cobertura de su EPS
Resumen: quiere ortodoncia, preguntó precios, pide factura a nombre de empresa
Últimos mensajes: …
[ Tomar conversación ]  [ Devolver a la IA ]
```

Al paciente, en paralelo: *"Te conecto con una asesora de la clínica, te escribe en unos minutos."* — es el único mensaje permitido en `handoff_pending`.

## Los dos botones

- **`take:<conv_corto>`** → `human_active`, `assigned_to = from.id`, `answerCallbackQuery("La tienes tú")`, y **se edita el mensaje del grupo** para que conste quién la tomó. Sin eso, dos personas la toman a la vez.
- **`back:<conv_corto>`** → vuelve a `ai_active` y **se le inyecta a la IA un resumen de lo que dijo el humano**. Sin eso, la IA retoma como si nada y se contradice.

## El relay bidireccional

El mensaje del grupo se registra en `handoff_relay` con su `group_message_id`. A partir de ahí:

- Alguien **responde a ese mensaje** en el grupo → el texto se reenvía al chat del paciente, como mensaje de la clínica
- El paciente escribe → se reenvía al hilo del grupo

**Es el inbox completo.** Por eso el panel web está fuera de alcance hasta que haya 3+ clientes.

## Disparadores de escalada

| Disparador | Tipo |
|---|---|
| El modelo llama `escalar_a_humano` | Decisión del agente |
| `/humano` o "quiero hablar con alguien" | Determinista |
| El loop de tools se desborda (`MAX_STEPS`) | Fallo controlado |
| DeepSeek falla 3 veces | Fallo de proveedor |
| 3 turnos sin avanzar | Contador en `conversations.meta` |

La urgencia clínica llega en la spec 15.

## Terminada cuando

- [ ] **`/humano` avisa al grupo** y pausa la IA
- [ ] **La tool escala**: di "quiero hablar con una persona" → el bot usa `escalar_a_humano` sin discutir
- [ ] El aviso trae motivo, resumen y los últimos mensajes
- [ ] **"Tomar" funciona**: estado a `human_active`, y el mensaje del grupo **se edita** mostrando quién la tomó
- [ ] 🔑 **Responder en el grupo le llega al paciente**: responde al mensaje del aviso → el texto aparece en el chat del paciente
- [ ] 🔑 **El paciente llega al grupo**: escribe algo → aparece en el hilo
- [ ] **La IA calla en `human_active`**
      ```sql
      select count(*) from events where type='llm_call'
       and created_at > '<momento del take>';   -- 0
      ```
- [ ] **"Devolver" reactiva la IA** y el primer mensaje siguiente **no contradice** lo que dijo el humano
- [ ] El `handoff_chat_id` está guardado **con su signo negativo**
- [ ] Se registró el evento
      ```sql
      select payload->>'reason', payload->>'takenBy', payload->>'waitedMs'
        from events where type='handoff' order by created_at desc limit 1;
      ```
- [ ] `scripts/smoke/13.sh` sale con código 0

## Trampas

- **El `chat_id` de un grupo es negativo.** Guardarlo sin signo rompe el handoff **en silencio**: nadie se entera de que los avisos se pierden.
- El bot necesita **estar en el grupo**, y según la configuración de privacidad de @BotFather puede no ver los mensajes que no lo mencionan. Desactiva el modo privacidad o trabaja solo con respuestas directas al mensaje.
- En grupos el límite es **~20 mensajes/minuto**, no 1/segundo.
- `callback_data` ≤64 bytes: por eso `<conv_corto>`, no el uuid.
- Al devolver a la IA, **inyecta el resumen** de lo que dijo el humano. Es el detalle que separa un handoff útil de uno que deja al paciente confundido.

## Pregunta de negocio que esta spec no resuelve

Quién mira ese grupo a las 7 p. m. en un consultorio de un odontólogo y una auxiliar. **Si nadie lo atiende, la escalada es un agujero, no una red.** Vale la pena preguntárselo al Dr. González antes de la demo.

## Referencias

- Blueprint §4.7 (state machine y handoff), §13 Fase 4
- `../../knowledge/wiki/State-Machine-y-Handoff.md`
- `../../knowledge/wiki/Clinica-Gonzalez-Guion-Demo.md` (paso 11)
- `../memoria/handoff-dentro-de-telegram.md`
