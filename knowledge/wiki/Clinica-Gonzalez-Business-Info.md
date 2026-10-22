---
titulo: Clínica González · Business info
tipo: cliente
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §9.2 + raw/2026-10-22-datos-cliente-dr-gonzalez"
actualizado: 2026-10-22
tags: [cliente, business-info, prompt, cache, dato-ficticio]
---

# Clínica González · Business info

Todo el conocimiento del negocio que no son servicios: sede, horarios, equipo, medios de pago, políticas y FAQs. Se carga a `business_info.structured`.

El archivo cargable es `Clinica-Gonzalez-business-info.json`.

## ✅ Confirmado por el cliente

| Campo | Valor |
|---|---|
| **Teléfono / WhatsApp** | **+57 322 236 3192** (el mismo para ambos) |
| **Dirección** | Av 3A # 24, Santo Domingo, Cúcuta, Norte de Santander |
| Coordenadas | `7.8737193, -72.5015457` |
| **Horario L–V** | 8:00 a. m. – 6:00 p. m. |
| **Horario sábado** | 8:00 a. m. – 12:00 m. |
| Domingo | Cerrado (no mencionado; se asume) |
| **Valoración** | **Gratuita** |
| **Sedación** | Sí la manejan |
| **Niños** | Sí los atienden |
| Ciudad / zona horaria / moneda | Cúcuta · `America/Bogota` · COP |

El teléfono desbloquea la ruta crítica: es lo que el agente entrega ante una urgencia clínica. Ver [[Guardrails-Clinicos]].

## ⚠️ El nombre del negocio no coincide

El link de Google Maps que aportaste registra el negocio como **"Fabian Gonzalez Odontología"**, no como "Clínica Odontológica Dr. Fabián González", que es el nombre que veníamos usando.

El JSON guarda los dos: `nombre` con el de Maps y `nombre_alterno` con el nuestro. **Hay que decidir cuál va en el prompt**, porque es lo primero que el paciente lee en el saludo. Ver [[Clinica-Gonzalez-System-Prompt]].

## ⚠️ El almuerzo: se tomó el horario literal

Diste **8:00–18:00 corrido** de lunes a viernes, sin mencionar descanso. Se cargó así: **jornada continua, sin break**.

Es una decisión con consecuencia visible: si la clínica sí cierra a mediodía, el agente va a ofrecer citas a la 1 de la tarde con la clínica cerrada. Rellenar `business_hours.break_from` / `break_to` lo corrige y reduce los slots disponibles.

Preferí tomarlo literal antes que inventar una restricción que no dijiste. Ver [[Calculo-de-Slots]].

## 🎭 Datos ficticios

Plausibles pero **falsos**. Autorizados el 2026-10-22. Todos llevan rastro en el JSON (`_ficticio`).

**Pagos:** efectivo, tarjeta débito y crédito, transferencia, Nequi, Daviplata. Financiación con cuota inicial más mensualidades en ortodoncia e implantes.

**Convenios:** atención particular; para prepagada se entrega factura para reembolso. **Es el más sensible de los ficticios** — un paciente que pregunte por su EPS y reciba una respuesta inventada se va a enterar al llegar a la clínica.

**Políticas:** cancelar con 24 h de anticipación, tolerancia de 15 minutos, primera cita con documento y radiografías previas.

**FAQs ficticias:** duración de ortodoncia (18–24 meses), urgencias el mismo día según disponibilidad, carillas en 2–3 citas.

**Especialidad del Dr. González:** "Odontología general y estética". Inferida, no confirmada.

## 🚫 Lo que NO se inventó

**Nombres de personas.** El JSON lista solo al Dr. Fabián González; si hay más profesionales en la clínica, queda `<<EDITAR>>`.

Un precio aproximado que resulta estar un 20% desviado es un error recuperable. Un odontólogo que no existe, presentado a un paciente real como parte del equipo, es un problema de otra naturaleza. Es ahora una regla del vault, en `CLAUDE.md`.

Tampoco se inventó si hay parqueadero: es verificable en el sitio y queda `<<EDITAR>>`.

## `rendered` y `rendered_hash` — la parte que cuesta dinero

`business_info.rendered` es la versión en **texto plano** de este JSON, generada una vez y guardada con su hash.

> **Es lo que entra al system prompt y al cache de prefijo**, así que su estabilidad byte a byte es lo que mantiene el costo bajo.

Consecuencias operativas:

1. Se renderiza **una vez**, no en cada petición.
2. Cada vez que se sustituye un dato ficticio por el real, cambia el `rendered_hash` y **el primer turno siguiente paga un cache miss completo**. Es asumible, pero conviene hacerlo **en bloque**.
3. Nada de este contenido puede llevar datos volátiles (fecha, nombre del paciente). Eso va en el bloque volátil al final.

Ver [[Cache-de-Prefijo]].

## Tamaño y la decisión de no usar RAG

El contenido estable completo —13 servicios con precios, horarios, sede, 7 FAQs— son **~700 tokens**. En el prompt estático, con cache, cuestan **$0.0000021 por turno**.

Por debajo del umbral de ~3.000 tokens, el prompt gana a RAG por costo, latencia y fiabilidad. Por eso pgvector está [[Fuera-de-Alcance|fuera de alcance]]. Ver [[Economia-de-Tokens]], regla 7.

## Relacionado

- [[Cliente-Clinica-Gonzalez]] — la ficha
- [[Clinica-Gonzalez-Servicios]] — el catálogo y los precios
- [[Clinica-Gonzalez-System-Prompt]] — dónde se inyecta el `rendered`
- [[Clinica-Gonzalez-Pendientes]] — qué queda por confirmar
- [[Cache-de-Prefijo]] — por qué la estabilidad importa
