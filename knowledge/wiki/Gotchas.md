---
titulo: Gotchas
tipo: operacion
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §15"
actualizado: 2026-10-22
tags: [gotchas, checklist, deploy, operacion]
---

# Gotchas

**Checklist antes de cualquier deploy.** Cada línea es un bug que ya se pagó una vez.

> Si aparece un gotcha nuevo en producción, va aquí **el mismo día**, y también a la página del subsistema donde ocurrió.

## DeepSeek

- [ ] `model: "deepseek-flash"`. `deepseek-chat` y `deepseek-reasoner` están retirados desde el 24-jul-2026.
- [ ] `reasoning_effort: "none"` en **todas** las llamadas. Es la diferencia de **17×** en costo.
- [ ] Con thinking encendido, `temperature` se ignora y `tool_choice: "required"` devuelve 400.
- [ ] `tool_calls[].function.arguments` es un **string**: `JSON.parse()`.
- [ ] Re-anexar el mensaje `assistant` con sus `tool_calls` **antes** de los resultados.
- [ ] No hay `usage.cost`: el costo se calcula en nuestro lado desde los tokens.
- [ ] `response_format: {type:"json_object"}` exige que el prompt mencione JSON, o devuelve 400.
- [ ] **`402` ≠ `429`**: el primero es saldo agotado y no se arregla reintentando.

Ver [[Agente-DeepSeek]].

## Telegram

- [ ] `secret_token` en `setWebhook` + verificación del header en **tiempo constante**.
- [ ] `allowed_updates` acotado.
- [ ] **ACK 2XX inmediato**; el trabajo pesado va después de responder.
- [ ] `chat.id` en **BIGINT**, nunca `int`.
- [ ] Escapar `& < >` antes de enviar con `parse_mode: "HTML"`, con fallback a texto plano si llega `400 can't parse entities`.
- [ ] Cortar a 4096 chars **por párrafo**.
- [ ] `callback_data` ≤ **64 bytes**.
- [ ] `answerCallbackQuery` **siempre**, o el botón queda girando.
- [ ] `429` → respetar `parameters.retry_after`.
- [ ] `403 bot was blocked` → marcar el contacto y **dejar de enviar**.
- [ ] `sendChatAction` dura ≤5 s: **re-enviar cada 4 s**.

Ver [[Ingress]] y [[Salida-y-Outbox]].

## Google Calendar

- [ ] Calendario compartido con la SA con permiso de **"Hacer cambios en los eventos"**.
- [ ] **Sin `attendees`**: la SA no puede invitar sin delegación de dominio.
- [ ] `dateTime` con offset **y** `timeZone`.
- [ ] `id` propio en base32hex (el uuid sin guiones sirve) → `409` en vez de duplicado.
- [ ] **`busy[].end` es exclusivo.**
- [ ] Revisar `calendars.<id>.errors[]` en la respuesta del freeBusy.
- [ ] Clave privada **en base64** para no pelear con los `\n`.

Ver [[Google-Calendar]] y [[Calculo-de-Slots]].

## Supabase / Railway

- [ ] Conexión por el **pooler 6543** con `prepare: false`.
- [ ] `pg_cron` + `pg_net` habilitadas; **`runtime_config` poblada**.
- [ ] Purgar `cron.job_run_details` periódicamente.
- [ ] **Una sola réplica** en Railway mientras el debounce viva en memoria.
- [ ] Verificar que el proyecto free **no esté pausado** antes de la demo.
- [ ] `drop_pending_updates: true` al redeployar.

Ver [[Performance-y-Limites]] y [[Esquema-de-Datos]].

## Los tres que fallan en silencio

Vale la pena destacarlos, porque no producen ningún error visible:

1. **`runtime_config` desincronizada** con las env vars → los barridos de `pg_cron` no llegan al worker. El buffer pierde su red de seguridad y los recordatorios no salen. El error ocurre dentro de Postgres, no en la aplicación.
2. **Calendario no compartido con la SA** → `freeBusy` devuelve `notFound` dentro de `calendars.<id>.errors[]`, la petición es un `200`, y el motor de slots cree que **no hay nada ocupado**. Ofrece horarios sobre citas existentes.
3. **`handoff_chat_id` sin el signo negativo** → los avisos de escalada se pierden. El paciente queda esperando a un humano que nunca se entera.

## El que cuesta dinero sin avisar

**Cache hit ratio por debajo del 60%.** No rompe nada, no genera ningún error, y multiplica el costo por 10. La única forma de detectarlo es mirando `v_llm_daily`.

Por eso es un **criterio de aceptación de fase**: en la [[Roadmap-por-Fases|Fase 1]], si el cache hit es 0 en el segundo turno, no se avanza. Ver [[Cache-de-Prefijo]].

## Relacionado

- [[Roadmap-por-Fases]] — los criterios de aceptación
- [[Clinica-Gonzalez-Guion-Demo]] — el checklist del día de la demo
- [[Checklist-de-Onboarding]] — alta de un cliente
- [[Observabilidad]] — cómo se detecta lo que falla en silencio
