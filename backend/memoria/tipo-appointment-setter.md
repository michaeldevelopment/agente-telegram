---
name: tipo-appointment-setter
description: El agente de la clínica es tipo 1; su objetivo es una cita confirmada en el calendario
metadata:
  type: decision
---

El `agent_type` de `clinica-gonzalez` es **`appointment_setter`** (tipo 1). Objetivo: **cita confirmada en Google Calendar**.

**Por qué:** el tipo determina solo tres cosas — el paquete de tools, el esqueleto de prompt y las métricas de éxito. Todo lo demás es idéntico entre tipos. El tipo 2 (`ecommerce_closer`) existe en el enum pero su diseño se cierra con el primer cliente de e-commerce.

**Cómo aplicarlo:** 7 tools — `consultar_disponibilidad`, `agendar_cita`, `reprogramar_cita`, `cancelar_cita`, `guardar_datos_paciente`, `consultar_mis_citas`, `escalar_a_humano`.

**No hay tool de catálogo**: los servicios y precios van en el prompt estático (~700 tokens que el cache sirve casi gratis). Por debajo de ~3.000 tokens de contenido estable, el prompt gana a RAG.

Dos reglas estructurales del tipo, respaldadas por código y no solo por el prompt: nunca proponer un horario que no venga de `consultar_disponibilidad`, y nunca agendar sin nombre completo y confirmación explícita.

Métrica que le importa al cliente: conversión a cita > 35%, y la tasa de no-show que atacan los recordatorios.

Relacionado: [[cliente-es-datos-no-logica]], [[catalogo-13-servicios]], [[sin-clasificador-llm]]
