---
titulo: Clínica González · Guion de la demo
tipo: cliente
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §14"
actualizado: 2026-10-22
tags: [demo, guion, venta, cliente]
---

# Clínica González · Guion de la demo

Doce minutos, en orden, **con el calendario de Google proyectado al lado del chat**. Cada paso demuestra una capacidad concreta.

## Los doce pasos

| # | Lo que escribes | Lo que el cliente ve |
|---|---|---|
| 1 | `/start` | Saludo con el nombre de la clínica, sin sonar a robot |
| 2 | "hola" · "tengo una duda" · "sobre limpieza dental" *(tres mensajes seguidos, rápido)* | "Escribiendo…" aparece de una, y llega **una** respuesta que atiende las tres cosas. **Aquí se explica el buffer** |
| 3 | "¿cuánto cuesta?" | Precio "desde", con la aclaración de que el final se define en valoración. Nada inventado |
| 4 | "¿tienen algo esta semana en la tarde?" | Tres botones con horarios reales, sacados del calendario de verdad |
| 5 | *(toca un botón)* | Confirmación inmediata. **Esta confirmación no gastó una llamada al LLM** |
| 6 | "María González" | Cita agendada, confirmación con día, hora, servicio y duración |
| 7 | *(mirar Google Calendar)* | **El evento está ahí**, con el nombre del paciente y la hora correcta |
| 8 | "mejor el jueves" | Reprograma: mueve el evento en Google, **sin crear uno nuevo** |
| 9 | "¿tengo que tomar algo antes?" | Se niega a recetar y ofrece preguntarlo en consulta. **Aquí se explican los guardrails clínicos** |
| 10 | "me duele muchísimo y me está sangrando" | Escala al instante, **sin esperar el buffer**, y da el teléfono de la clínica |
| 11 | *(mostrar el grupo interno)* | La alerta llegó con el resumen y los botones. Se toca "Tomar conversación" y se le responde al paciente desde el grupo |
| 12 | *(abrir Supabase → `v_llm_daily`)* | El costo real de todo lo anterior: centavos. **Aquí se explica la economía de tokens** |

## Los tres pasos que cierran la venta

> **7, 11 y 12.**

- **Paso 7 — agenda de verdad.** No es una maqueta. La cita está en su Google Calendar.
- **Paso 11 — tu equipo no pierde el control.** El handoff funciona y se opera desde Telegram, sin aprender ninguna herramienta nueva.
- **Paso 12 — cuesta casi nada.** Centavos, con el número en pantalla.

Todo lo demás es soporte para esos tres momentos.

## Qué se está demostrando técnicamente en cada paso

| Paso | Capacidad | Página |
|---|---|---|
| 2 | Buffer por silencio + `typing` | [[Buffer-y-Batching]] |
| 3 | Prompt estático con precios "desde", regla de no inventar | [[Clinica-Gonzalez-System-Prompt]] |
| 4 | `freeBusy` + motor de slots + botones inline | [[Calculo-de-Slots]], [[Salida-y-Outbox]] |
| 5 | Camino determinista: `callback_data` codifica la intención | [[Motor-de-Decision]] |
| 6–7 | `agendar_cita` con id determinista | [[Capa-de-Tools]], [[Google-Calendar]] |
| 8 | `PATCH` del evento, mismo `id` | [[Google-Calendar]] |
| 9 | Guardrail clínico, capas 2 y 3 | [[Guardrails-Clinicos]] |
| 10 | `isClinicalUrgency` — bypass del buffer | [[Motor-de-Decision]] |
| 11 | State machine + relay bidireccional | [[State-Machine-y-Handoff]] |
| 12 | `v_llm_daily` | [[Observabilidad]], [[Economia-de-Tokens]] |

## Preparación antes de la demo

Checklist de lo que hay que verificar **el mismo día**:

- [ ] El proyecto de Supabase **no está pausado** (se pausa tras ~1 semana de inactividad). Ver [[Performance-y-Limites]].
- [ ] `getWebhookInfo` sin `last_error_message` y con `pending_update_count` en 0.
- [ ] El calendario de Google tiene **algo de ocupación** en la semana, para que los slots ofrecidos no sean todos. Un calendario vacío no demuestra nada.
- [ ] El grupo interno existe, el bot está dentro y `handoff_chat_id` está configurado.
- [ ] Saldo en DeepSeek (un `402` a mitad de demo es el peor escenario posible).
- [x] ~~Teléfono de la clínica~~ — **+57 322 236 3192**, cargado el 2026-10-22.
- [ ] Nombre del negocio decidido ("Fabián González Odontología" vs. el largo). Aparece en el paso 1.
- [ ] Una conversación de prueba completa, de principio a fin, y después **borrar la cita de prueba** del calendario.
- [ ] `drop_pending_updates: true` si hubo redeploy.

## Riesgos del guion

- **Paso 3 — el precio es ficticio.** La limpieza dice "desde $120.000", un valor aproximado de mercado, no el del Dr. González. Si él está presente en la demo y lo oye, **va a corregirlo en voz alta**. Dos salidas: pedirle el precio real antes, o convertirlo en una virtud (*"estos son valores de referencia, los suyos los cargamos en cinco minutos"*). Ver [[Clinica-Gonzalez-Servicios]].
- **Paso 4** depende de que haya slots disponibles esa semana. Si el calendario está lleno o vacío, el paso se ve mal. Verificar antes.
- **Paso 4 y el almuerzo.** El horario está cargado **corrido** de 8 a 18. Si la clínica cierra a mediodía, el agente va a ofrecer una cita a la 1 p. m. delante del dueño.
- **Paso 10 — resuelto.** El teléfono ya está cargado.
- **Paso 12** necesita tráfico previo en `events`. Los pasos 1–11 lo generan, pero conviene que no sea la primerísima conversación: el primer turno siempre paga cache miss y el ratio se ve mal.

## Un paso 13 opcional

Si el Dr. González pregunta por su EPS o por algo que no esté cargado, el agente responde *"no tengo ese dato a mano, ¿quieres que te comunique con la clínica?"*.

**Eso se ve bien, no mal.** Demuestra la regla 4 en vivo: el bot no inventa. Vale la pena provocarlo a propósito si la conversación lo permite.

## Relacionado

- [[Cliente-Clinica-Gonzalez]] — la ficha
- [[Clinica-Gonzalez-Pendientes]] — lo que hay que cerrar antes
- [[Roadmap-por-Fases]] — qué hay que construir para llegar aquí
- [[Gotchas]] — checklist técnico antes de deploy
