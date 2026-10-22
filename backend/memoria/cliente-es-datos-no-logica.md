---
name: cliente-es-datos-no-logica
description: Añadir un cliente es cero código; si hace falta programar, el diseño se rompió
metadata:
  type: regla
---

Un cliente nuevo es **una fila en `workspaces`, su `business_info`, sus `services`, su prompt y un bot en @BotFather**. Cero código.

**Por qué:** es lo que separa un producto de una consultoría. El momento en que un precio, un horario o una política se convierte en un `if` dentro del código, deja de ser escalable y cada cliente nuevo cuesta días en vez de horas.

**Cómo aplicarlo:** si algo que estás escribiendo en una página `tipo: cliente` es lógica — una condición, un algoritmo, un flujo — va en una página `tipo: base` y el cliente solo la referencia.

Lo compartido: ingress, buffer, decisión, egress, loop de agente, capa de tools, motor de slots, observabilidad.
Lo del cliente: `workspaces`, `business_info`, `agent_prompts`, `services`, `business_hours`, `closures`, `handoff_chat_id`.

El `agent_type` solo determina tres cosas: paquete de tools, esqueleto de prompt y métricas. Ver `../../knowledge/wiki/Multi-Cliente.md`.

Relacionado: [[tipo-appointment-setter]], [[catalogo-13-servicios]]
