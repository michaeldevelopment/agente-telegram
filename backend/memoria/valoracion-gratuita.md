---
name: valoracion-gratuita
description: La valoración no tiene costo, y es la principal herramienta de conversión del agente
metadata:
  type: cliente
---

**La valoración y diagnóstico es gratuita.** Confirmado por el cliente el 2026-10-22.

**Por qué:** no es un dato más del catálogo, es lo que resuelve la tensión central del agente. La regla 3 prohíbe dar precios finales; el paciente quiere saber cuánto va a pagar; sin una salida, el bot queda repitiendo "depende de la valoración" hasta que la conversación se enfría. Con la valoración gratis, esa negativa se convierte en una oferta.

**Cómo aplicarlo:** el system prompt tiene una sección propia, **"La valoración es gratuita"**, que no viene del blueprint. Se usa cuando el paciente insiste en el precio, describe un síntoma, no sabe qué necesita, o pide un servicio con `requires_eval = true` (9 de los 13). Es también la cita por defecto de cualquier paciente nuevo.

Relacionado: [[precios-siempre-desde]], [[caries-no-es-servicio-agendable]], [[catalogo-13-servicios]]
