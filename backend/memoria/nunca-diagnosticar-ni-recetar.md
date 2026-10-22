---
name: nunca-diagnosticar-ni-recetar
description: Tres capas de guardrail clínico, y solo una depende del modelo
metadata:
  type: regla
---

El agente **no diagnostica, no receta y no promete resultados**. Es el punto más delicado del cliente, porque es salud.

**Por qué tres capas y no solo el prompt:** un prompt se puede sortear; un filtro de salida no. Las tres fallan de formas distintas:

1. **Antes del LLM** — `isClinicalUrgency()`, lista de términos. No entiende contexto pero **nunca falla** en lo que cubre. Dispara bypass del buffer + handoff + teléfono.
2. **En el prompt** — reglas 1–4 y 9. Entiende matiz pero es **probabilística**.
3. **Después del LLM** — filtro sobre el borrador. Patrones de diagnóstico (`tienes una caries`) o medicación (`toma ibuprofeno`, `mg cada`) → se descarta, se registra como `guardrail` y se manda respuesta segura.

**Cómo aplicarlo:** la lista de urgencias debe cubrir **lenguaje coloquial de Cúcuta**, no terminología clínica — el vocabulario está en `CONTEXTO.md`. Falso positivo = escalada de más, recuperable. Falso negativo = inaceptable. Por eso es generosa.

Cualquier `guardrail` disparado es **alerta al grupo interno**, no solo una métrica. Detalle en `../../knowledge/wiki/Guardrails-Clinicos.md`.

Relacionado: [[precios-siempre-desde]], [[caries-no-es-servicio-agendable]], [[contacto-clinica]]
