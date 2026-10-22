---
titulo: Tipo · appointment_setter
tipo: tipo-agente
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §10.2"
actualizado: 2026-10-22
tags: [agent-type, agendamiento, citas, tipo-1]
---

# Tipo · `appointment_setter`

**Agente de agendamiento de citas.** El tipo 1, y el que usa el cliente piloto. Su objetivo es una **cita confirmada en el calendario**, y todo en él está orientado a llegar ahí en el menor número de turnos posible.

Cliente actual: [[Cliente-Clinica-Gonzalez]].

## Definición

| | |
|---|---|
| **Objetivo** | Cita confirmada en el calendario |
| **Tools** | disponibilidad, agendar, reprogramar, cancelar, mis citas, datos, escalar |
| **Estado extra** | — (ninguno sobre el modelo base) |
| **Prompt** | Consultivo, guía al cierre de la cita |
| **Métrica** | % de conversaciones con cita + % de no-show |

## Paquete de tools

Las siete de [[Capa-de-Tools]]:

| Tool | Rol en el flujo |
|---|---|
| `consultar_disponibilidad` | Siempre antes de proponer un horario. Máximo 4 opciones |
| `agendar_cita` | El cierre. Revalida, escribe en DB y Google, programa recordatorios |
| `reprogramar_cita` | Mueve el evento existente, no crea uno nuevo |
| `cancelar_cita` | Libera el bloque y cancela recordatorios |
| `guardar_datos_paciente` | En cuanto el paciente da un dato, sin esperar al cierre |
| `consultar_mis_citas` | Evita que el modelo invente lo que ya agendó |
| `escalar_a_humano` | Handoff con motivo y resumen |

**Sin tool de catálogo de servicios**: van en el prompt estático. Ver [[Economia-de-Tokens]], regla 7.

## Esqueleto de prompt

La estructura que comparten todos los clientes de este tipo. Lo que cambia por cliente son los datos, no las secciones:

```
Eres la asistente virtual de {{NEGOCIO}}, {{DESCRIPCION}} en {{CIUDAD}}.
Tu único trabajo es atender por Telegram y ayudar a agendar, reprogramar o
cancelar citas, y responder dudas con la información que tienes aquí.

## Cómo hablas          → persona, tono, longitud, una pregunta por mensaje
## Qué puedes hacer     → el alcance declarado
## Reglas que no puedes romper  → las prohibiciones duras del sector
## Cómo agendas         → la secuencia de 6 pasos
## Información del negocio  → {{BUSINESS_INFO_RENDERED}}
```

La sección **"Cómo agendas"** es la que define el tipo:

1. Entender qué servicio quiere. Si no está claro, preguntarlo.
2. Preguntar qué día o franja le sirve.
3. Llamar `consultar_disponibilidad` y ofrecer **máximo 3** opciones concretas.
4. Cuando elija, confirmar el horario exacto con palabras y pedir el nombre completo.
5. Llamar `agendar_cita`. Confirmar con día, hora, servicio y duración.
6. Cerrar recordando la política de cancelación.

El prompt concreto del cliente está en [[Clinica-Gonzalez-System-Prompt]].

## Dos reglas estructurales del tipo

Independientes del sector, válidas para cualquier `appointment_setter`:

- **NUNCA proponer un horario que no venga de `consultar_disponibilidad`.** Nada de "¿te sirve el martes a las 10?" sacado de la nada.
- **NUNCA agendar sin nombre completo y confirmación explícita del horario exacto.**

Las dos están respaldadas por código: el slot se revalida y el nombre es un campo requerido con `min(3)` en el esquema Zod. Ver [[Capa-de-Tools]].

## Métricas de éxito

| Métrica | Umbral | Dónde |
|---|---|---|
| Conversión a cita | > 35% | `v_funnel` |
| Tasa de no-show | — (la ataca el recordatorio) | `appointments.status = 'no_show'` |
| Tasa de escalada | 10–25% | `v_funnel.escaladas` |

El **no-show** es lo que diferencia este tipo comercialmente: los [[Recordatorios-Programados|recordatorios]] a 24 h y 2 h son la funcionalidad que lo ataca, y para una clínica eso es dinero directo.

Ver [[Observabilidad]].

## Lo que varía por sector

El mismo tipo sirve para una clínica, una peluquería, un taller o un estudio de tatuajes. Lo que cambia:

- El **catálogo de servicios** con sus duraciones y buffers.
- Las **reglas duras del sector**. En salud son los [[Guardrails-Clinicos|guardrails clínicos]], y son la parte más pesada. En una peluquería no hay equivalente.
- La **anticipación mínima** y el horizonte.

La lógica de slots, el buffer, el handoff y la economía de tokens son idénticos.

## Relacionado

- [[Tipo-Ecommerce-Closer]] — el tipo 2
- [[Multi-Cliente]] — qué determina el `agent_type`
- [[Cliente-Clinica-Gonzalez]] — la instancia actual
- [[Capa-de-Tools]] — las siete tools
- [[Calculo-de-Slots]] — el motor que lo sostiene
