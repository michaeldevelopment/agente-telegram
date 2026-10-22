---
titulo: Tipo · ecommerce_closer
tipo: tipo-agente
estado: borrador
fuente: "[[00-BLUEPRINT-agente-telegram]] §10.2"
actualizado: 2026-10-22
tags: [agent-type, ecommerce, ventas, tipo-2, pendiente]
---

# Tipo · `ecommerce_closer`

**Agente de cierre de ventas / e-commerce.** El tipo 2. Existe en el enum `agent_type` y está previsto en la arquitectura, pero **su diseño se completa al tomar el primer cliente de e-commerce**.

> `estado: borrador` — esta página documenta lo decidido, no un diseño cerrado. Todo lo marcado como pendiente abajo se resuelve con un cliente real delante, no antes.

## Definición

| | |
|---|---|
| **Objetivo** | Lead calificado o venta cerrada |
| **Tools** | catálogo, stock, precio, carrito, link de pago, calificar lead, escalar |
| **Estado extra** | `lead_score`, respuestas de calificación |
| **Prompt** | Consultivo con manejo de objeciones y cierre |
| **Métrica** | % calificados + % con link de pago enviado + ticket medio |

## Qué cambia respecto al tipo 1

Solo tres cosas, por diseño. Ver [[Multi-Cliente]]:

1. **El paquete de tools.** Desaparecen disponibilidad / agendar / reprogramar / cancelar; aparecen catálogo / stock / precio / carrito / link de pago / calificar lead. `escalar_a_humano` y `guardar_datos` se mantienen.
2. **El esqueleto de prompt.** La sección "Cómo agendas" se sustituye por una de calificación y manejo de objeciones.
3. **Las métricas.** El embudo deja de terminar en "cita" y termina en "link de pago enviado".

## Qué NO cambia

Todo lo caro de construir, que ya está hecho:

- [[Ingress]], [[Buffer-y-Batching]], [[Motor-de-Decision]], [[Salida-y-Outbox]].
- El loop de tool-calling y la validación Zod. Ver [[Agente-DeepSeek]].
- La [[State-Machine-y-Handoff|state machine]] y el handoff por grupo de Telegram.
- Toda la [[Economia-de-Tokens|economía de tokens]] y la disciplina de [[Cache-de-Prefijo|cache]].
- La [[Observabilidad|observabilidad]], cambiando solo la vista de embudo.

## Estado extra: `lead_score`

Es la única adición al modelo de datos que este tipo necesita. Las respuestas de calificación y la puntuación viven asociadas a la conversación.

**Pendiente de diseñar:** si va como columnas en `conversations`, como una tabla propia, o dentro de `conversations.meta`. No se decide hasta tener los criterios de calificación de un cliente real.

## Fuera de alcance hasta tener cliente

Tres piezas, explícitamente aplazadas:

| Pieza | Por qué espera |
|---|---|
| **Catálogo de productos** | El modelo de datos depende de si hay variantes, stock por bodega, combos. Diseñarlo en abstracto garantiza rehacerlo |
| **Pasarela de pagos** | El agendador no cobra. La pasarela depende del país y del cliente (Wompi, Mercado Pago, PayU en Colombia) |
| **Criterios de calificación** | Son del negocio, no del software |

Ver [[Fuera-de-Alcance]].

## El umbral de RAG, que aquí sí puede importar

En el tipo 1 el contenido estable son ~700 tokens y va entero en el prompt. **Un catálogo de e-commerce con cientos de SKUs supera fácilmente los ~3.000 tokens**, que es el umbral a partir del cual RAG con pgvector gana.

Es la primera decisión de arquitectura que este tipo probablemente obligue a revisar. Ver [[Economia-de-Tokens]], regla 7.

## Relacionado

- [[Tipo-Appointment-Setter]] — el tipo 1, ya implementado
- [[Multi-Cliente]] — cómo se añade un tipo
- [[Fuera-de-Alcance]] — pagos, catálogo y CRM
- [[Capa-de-Tools]] — la interfaz común que reusará
