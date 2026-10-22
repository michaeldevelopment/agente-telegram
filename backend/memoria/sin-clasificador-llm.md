---
name: sin-clasificador-llm
description: Una llamada al modelo por turno, no dos; el clasificador del blueprint original se eliminó
metadata:
  type: decision
---

**Se eliminó el clasificador LLM.** Una llamada por turno, no dos.

**Por qué:** el blueprint original clasificaba con un modelo barato y respondía con uno caro. Eso tenía sentido cuando el modelo de respuesta era caro. Con `deepseek-flash`, **el modelo de respuesta ya es el barato**, así que un clasificador aparte duplica las llamadas y duplica el prefijo del prompt para decidir algo que el propio agente puede expresar llamando a `escalar_a_humano`.

**Cómo aplicarlo:** lo que antes clasificaba el modelo ahora lo resuelve el motor de decisión con **0 tokens**: estados de la conversación, comandos, botones y urgencias clínicas. Solo lo que sobrevive a esas reglas duras llega al agente.

**Cuándo reconsiderarlo:** si el volumen llega a decenas de miles de turnos/mes **y** se mide que >30% de los turnos son chitchat que no necesita el catálogo completo de tools. Hasta entonces es complejidad sin retorno.

Relacionado: [[thinking-mode-apagado]], [[tipo-appointment-setter]], [[handoff-dentro-de-telegram]]
