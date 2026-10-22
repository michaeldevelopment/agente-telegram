---
titulo: Cliente · Clínica Odontológica Dr. Fabián González
tipo: cliente
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §9 + raw/2026-10-22-datos-cliente-dr-gonzalez"
actualizado: 2026-10-22
tags: [cliente, clinica, cucuta, odontologia, demo, dato-ficticio]
---

# Cliente · Clínica Odontológica Dr. Fabián González

Ficha del cliente piloto. **Todo lo que hay aquí son datos, nunca lógica** — la lógica vive en las páginas `tipo: base`. Ver [[Multi-Cliente]].

> **Datos cargados el 2026-10-22.** Los de contacto, dirección, horario y valoración son **reales**. Los precios y varios campos de negocio son **`#dato-ficticio`**: plausibles pero falsos, autorizados para la demo y a sustituir antes de producción. El rastro completo está en [[Clinica-Gonzalez-Pendientes]].

## Identidad

| Campo | Valor |
|---|---|
| Nombre en Google Maps | **Fabián González Odontología** |
| Nombre alterno | Clínica Odontológica Dr. Fabián González |
| Slug / `workspaces.slug` | `clinica-gonzalez` |
| Tipo de negocio | Clínica odontológica |
| Odontólogo principal | **Dr. Fabián González** |
| Ciudad | **Cúcuta**, Norte de Santander, Colombia |
| Zona horaria | `America/Bogota` (UTC-5, sin DST) |
| Moneda | COP |
| Locale | `es-CO` |
| `agent_type` | **`appointment_setter`** (tipo 1) |

> ⚠️ **Los dos nombres no coinciden.** Hay que decidir cuál va en el prompt: es lo primero que el paciente lee. Ver [[Clinica-Gonzalez-Pendientes]].

Ver [[Tipo-Appointment-Setter]].

## Contacto y ubicación

| Campo | Valor |
|---|---|
| **Teléfono / WhatsApp** | **+57 322 236 3192** |
| **Dirección** | Av 3A # 24, Santo Domingo, Cúcuta, Norte de Santander |
| Coordenadas | `7.8737193, -72.5015457` |

El teléfono es el dato más crítico del cliente: es lo que el agente entrega cuando detecta una urgencia clínica. Ver [[Guardrails-Clinicos]].

> El número de la clínica **no es** el del bot de Telegram. El bot se registra con el teléfono personal del usuario.

## Horario de atención

| Día | Horario |
|---|---|
| Lunes a viernes | 8:00 a. m. – 6:00 p. m. **corrido** |
| Sábado | 8:00 a. m. – 12:00 m. |
| Domingo | Cerrado |

**Sin descanso de almuerzo**, tomado literal de lo que dio el cliente. Si la clínica sí cierra a mediodía, el agente ofrecerá citas con la clínica cerrada. Ver [[Calculo-de-Slots]].

## Servicios ofrecidos

13 servicios: odontología general, limpieza dental, ortodoncia (consulta, brackets metálicos y estéticos, alineadores), resinas, carillas, blanqueamiento, endodoncia, extracción, implante y urgencias.

**La valoración es gratuita** — confirmado por el cliente. Es la mejor herramienta de conversión del agente: cualquier conversación atascada en el precio se redirige ahí.

**Sí manejan sedación** y **sí atienden niños**.

El catálogo completo con duraciones, buffers y precios está en [[Clinica-Gonzalez-Servicios]].

> ⚠️ **Las carillas no estaban en el catálogo base del blueprint** y el brief las menciona explícitamente. Se añadieron, con duración y precio ficticios.

## Objetivo de la demo

Vender el agente. No es producción. Lo que tiene que quedar demostrado, en orden de peso comercial:

1. **Agenda de verdad** — la cita aparece en Google Calendar, delante del cliente.
2. **Tu equipo no pierde el control** — el handoff llega al grupo interno y se puede tomar la conversación.
3. **Cuesta casi nada** — se le enseña `v_llm_daily` con el costo real en centavos.

El guion minuto a minuto está en [[Clinica-Gonzalez-Guion-Demo]].

## Configuración del workspace

| Parámetro | Valor | Nota |
|---|---|---|
| `buffer_ms` | 12000 | 12 s de silencio |
| `buffer_max_ms` | 75000 | Techo absoluto |
| `buffer_max_msgs` | 15 | |
| `quiet_from` / `quiet_to` | 21:00 / 08:00 | Hora local, para proactivos |
| `timezone` | `America/Bogota` | |
| `handoff_chat_id` | `<<EDITAR>>` | Grupo interno. **Negativo** |
| `bot_username` | `<<EDITAR>>` | Se crea en @BotFather, con el teléfono personal del usuario |

Ver [[Buffer-y-Batching]] y [[State-Machine-y-Handoff]].

## Lo delicado de este cliente

**Es salud.** El agente no diagnostica, no receta, no promete resultados ni precios finales, y escala de inmediato ante una urgencia. Tres capas de protección, solo una depende del modelo.

Esto no es un detalle de implementación: es lo que le quita el miedo al odontólogo para poner el bot a hablar con sus pacientes. Ver [[Guardrails-Clinicos]].

## Artefactos del cliente

| Página / archivo | Qué contiene |
|---|---|
| [[Clinica-Gonzalez-Servicios]] | Catálogo con duraciones, buffers y precios |
| [[Clinica-Gonzalez-Business-Info]] | Sedes, horarios, equipo, pagos, políticas, FAQs |
| [[Clinica-Gonzalez-System-Prompt]] | El bloque estático que va al cache |
| [[Clinica-Gonzalez-Guion-Demo]] | Los 12 pasos de la demo |
| [[Clinica-Gonzalez-Credenciales]] | Inventario de secretos — **qué existe y dónde, nunca el valor** |
| [[Clinica-Gonzalez-Pendientes]] | Los ~25 `<<EDITAR>>` a confirmar con el cliente |
| `Clinica-Gonzalez-business-info.json` | Listo para cargar a `business_info.structured` |
| `Clinica-Gonzalez-services.csv` | Listo para cargar a `services` |

## Qué falta para poder hacer la demo

**Ya no faltan datos.** Lo que queda es infraestructura y dos decisiones:

1. Decidir **qué nombre** va en el prompt y si la clínica **cierra a mediodía**. Ver [[Clinica-Gonzalez-Pendientes]].
2. Crear el bot en @BotFather y el grupo interno.
3. Seguir [[Checklist-de-Onboarding]].
4. Ejecutar el [[Roadmap-por-Fases|roadmap]] — 5 días estimados.

Antes de **producción** (no de la demo) hay que sustituir los ~20 datos ficticios, empezando por los convenios con EPS.

## Relacionado

- [[Tipo-Appointment-Setter]] — el tipo de agente
- [[Multi-Cliente]] — datos vs. código
- [[Checklist-de-Onboarding]] — cómo se da de alta
- [[Guardrails-Clinicos]] — lo crítico del sector
