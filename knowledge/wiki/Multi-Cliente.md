---
titulo: Multi-cliente
tipo: base
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §10.1"
actualizado: 2026-10-22
tags: [multi-tenant, workspace, producto, escalado]
---

# Multi-cliente

La separación entre lo que es código y lo que es dato. **Es el producto**: si añadir un cliente requiere escribir código, no hay producto, hay consultoría.

## Qué es compartido y qué es del cliente

```
COMPARTIDO (código y el blueprint)          POR CLIENTE (solo datos)
├── ingress, buffer, decisión, egress       ├── workspaces (bot, zona horaria, buffer_ms)
├── loop de agente + capa de tools          ├── business_info (structured + rendered)
├── catálogo de tools por agent_type        ├── agent_prompts (persona + reglas)
├── motor de slots + cliente de Google      ├── services, business_hours, closures
└── observabilidad                          └── handoff_chat_id
```

> **Añadir un cliente = una fila en `workspaces`, su `business_info`, sus `services`, su prompt y un bot nuevo en @BotFather. Cero código.**

El procedimiento paso a paso está en [[Checklist-de-Onboarding]].

## La regla que lo sostiene

Esta es también una **regla del vault**, en `CLAUDE.md`:

> Si algo que estás escribiendo en una página `tipo: cliente` es lógica — una condición, un algoritmo, un flujo — va en una página `tipo: base` y el cliente solo la referencia.

El momento en que un precio, un horario o una política se convierte en un `if` dentro del código, el producto se rompe. Todo eso vive en `services`, `business_hours`, `closures` y `business_info.structured`.

## Un bot por cliente

Decisión de [[Decisiones-Fijas]]: cada cliente tiene su propio token, su propio @usuario, su foto y su descripción. El webhook lleva el workspace en el path: `POST /tg/:workspace/:secretPath`.

Es mejor para la demo (el cliente ve *su* bot, no uno genérico) y más limpio operativamente: revocar un token afecta a un solo cliente.

El token va cifrado en `workspaces.bot_token_enc` con `pgp_sym_encrypt`. **En la demo de un solo cliente** va en la env var `TELEGRAM_BOT_TOKEN` y la columna queda nula; la columna cifrada se vuelve obligatoria **cuando entre el segundo cliente**. Ver [[Seguridad]].

## Qué determina el `agent_type`

Tres cosas, y nada más:

1. El **paquete de tools**.
2. El **esqueleto de prompt**.
3. Las **métricas de éxito**.

Todo lo demás —ingress, buffer, decisión, egress, observabilidad— es idéntico.

| | [[Tipo-Appointment-Setter]] | [[Tipo-Ecommerce-Closer]] |
|---|---|---|
| Cliente actual | Clínica Dr. Fabián González | — (siguiente) |
| Objetivo | Cita confirmada en el calendario | Lead calificado o venta cerrada |
| Estado extra | — | `lead_score`, respuestas de calificación |

## Un tercer tipo

Soporte, cobranza, reactivación: se agrega con un **valor nuevo del enum `agent_type`**, su paquete de tools y su esqueleto de prompt.

**La arquitectura no se toca.** Esa es la prueba de que la separación está bien hecha.

## Cuándo se rompe este diseño

Dos momentos previstos, ambos con el camino ya pensado:

- **Segundo cliente** → el token deja de ir en env var y pasa a la columna cifrada.
- **Tercer cliente + necesidad de ver varias conversaciones a la vez** → entra un panel web, y con él **RLS**, siguiendo el patrón del blueprint original. Ver [[Fuera-de-Alcance]].

## Relacionado

- [[Decisiones-Fijas]] — multi-tenancy por workspace
- [[Checklist-de-Onboarding]] — cómo se añade un cliente
- [[Esquema-de-Datos]] — `workspaces` y las tablas por cliente
- [[Cliente-Clinica-Gonzalez]] — el primer cliente
- [[Seguridad]] — secretos por cliente
