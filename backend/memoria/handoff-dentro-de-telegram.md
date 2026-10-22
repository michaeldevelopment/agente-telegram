---
name: handoff-dentro-de-telegram
description: El equipo opera desde un grupo interno de Telegram; no hay panel web
metadata:
  type: decision
---

El handoff se opera **dentro de Telegram**, en un grupo interno donde está el bot (`workspaces.handoff_chat_id`). **Sin panel web.**

**Por qué:** es el inbox completo con cero frontend, y el equipo de la clínica no tiene que aprender ninguna herramienta nueva. Es también lo que mantiene el panel web fuera de alcance hasta que haya 3+ clientes.

**Cómo aplicarlo:** el aviso llega con motivo, resumen y botones `Tomar conversación` / `Devolver a la IA`. **Relay bidireccional**: responder al mensaje del grupo le escribe al paciente, y los mensajes del paciente se reenvían al hilo.

**El invariante:** en `human_active`, `handoff_pending`, `paused` y `closed`, la IA **no genera nada**. Es lo que le vende el producto al cliente: *tu equipo no pierde el control*.

Dos trampas: el `chat_id` de un grupo es **negativo** (guardarlo sin signo rompe el handoff en silencio), y al devolver a la IA hay que inyectarle qué dijo el humano o se contradice.

**Pregunta de negocio sin responder:** quién mira ese grupo a las 7 p. m. en un consultorio de un odontólogo y una auxiliar. Si nadie lo atiende, la escalada es un agujero, no una red.

Relacionado: [[canal-telegram-para-la-demo]], [[nunca-diagnosticar-ni-recetar]]
