---
titulo: Clínica González · Servicios
tipo: cliente
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §9.1 + raw/2026-10-22-datos-cliente-dr-gonzalez"
actualizado: 2026-10-22
tags: [cliente, servicios, catalogo, precios, dato-ficticio]
---

# Clínica González · Servicios

Catálogo que se carga a la tabla `services`. Alimenta dos cosas: el **cálculo de slots** (vía `duration_min` + `buffer_min`) y el **bloque estático del system prompt** (vía los precios "desde").

> ⚠️ **Todos los precios menos uno son `#dato-ficticio`.** Son valores aproximados de mercado para Cúcuta, plausibles pero **falsos**. Sirven para la demo; hay que sustituirlos antes de producción. Autorizado por el usuario el 2026-10-22. Ver [[Clinica-Gonzalez-Pendientes]].

## Catálogo

| slug | Nombre | Duración | Buffer | Precio desde (COP) | Req. valoración | Origen |
|---|---|---|---|---|---|---|
| `valoracion` | Valoración y diagnóstico | 30 min | 10 | **Gratuita** | No | ✅ real |
| `limpieza-dental` | Limpieza dental (profilaxis) | 45 min | 10 | $120.000 | No | 🎭 ficticio |
| `blanqueamiento` | Blanqueamiento dental | 60 min | 15 | $550.000 | Sí | 🎭 ficticio |
| `resina` | Resina / calza estética | 45 min | 10 | $160.000 por diente | Sí | 🎭 ficticio |
| `carillas` | Carillas dentales | 90 min | 15 | $450.000 por diente (resina)<br>$1.200.000 (porcelana) | Sí | 🎭 ficticio |
| `ortodoncia-consulta` | Consulta de ortodoncia | 45 min | 15 | $60.000 | No | 🎭 ficticio |
| `brackets-metalicos` | Brackets metálicos (inicio) | 90 min | 15 | $700.000 + $120.000/mes | Sí | 🎭 ficticio |
| `brackets-esteticos` | Brackets estéticos (inicio) | 90 min | 15 | $1.100.000 + $140.000/mes | Sí | 🎭 ficticio |
| `alineadores` | Alineadores invisibles (escaneo) | 60 min | 15 | $250.000 escaneo<br>$7.500.000 tratamiento | Sí | 🎭 ficticio |
| `endodoncia` | Endodoncia | 90 min | 20 | $380.000 por conducto | Sí | 🎭 ficticio |
| `extraccion` | Extracción simple | 45 min | 15 | $130.000 | Sí | 🎭 ficticio |
| `implante` | Implante dental | 45 min | 15 | $2.800.000 | Sí | 🎭 ficticio |
| `urgencia` | Urgencia odontológica | 30 min | 15 | $80.000 | No | 🎭 ficticio |

13 servicios. El archivo cargable es `Clinica-Gonzalez-services.csv`, que lleva una columna `ficticio` con el rastro.

## La valoración gratuita cambia el discurso comercial

**Confirmado por el cliente: la valoración no tiene costo.** Esto no es un dato más, es la mejor herramienta de conversión que tiene el agente:

- Cualquier conversación que se atasque en el precio se puede redirigir a *"la valoración es gratis, ahí el doctor te dice exactamente qué necesitas y cuánto cuesta"*.
- Resuelve el conflicto entre la regla 3 del prompt (nunca dar precios finales) y la frustración del paciente que quiere saber cuánto va a pagar.
- Es la cita por defecto para cualquier paciente nuevo, y para los 9 servicios con `requires_eval = true`.

Ver [[Clinica-Gonzalez-System-Prompt]].

## Cómo el brief mapea al catálogo

| Lo que dijo el cliente | Slug(s) |
|---|---|
| Odontología (general) | `valoracion`, `urgencia` |
| Limpieza dental | `limpieza-dental` |
| Alineamiento de dientes | `ortodoncia-consulta`, `brackets-metalicos`, `brackets-esteticos`, `alineadores` |
| Caries | `resina` — el tratamiento de una caries es la calza/resina |
| Resinas | `resina` |
| Carillas | `carillas` |

**"Caries" no es un servicio agendable, es un motivo de consulta.** El paciente que escribe "creo que tengo una caries" debe terminar en una `valoracion` — que además es gratis — no en una `resina` directa: el agente **no puede diagnosticar**. Ver [[Guardrails-Clinicos]].

## Notas sobre los precios ficticios

Criterios con los que se construyeron, por si quieres ajustarlos:

- **Mercado de Cúcuta**, no Bogotá ni Medellín. Es una ciudad de frontera con precios por debajo de las capitales.
- **Clínica de gama media**, consultorio con odontólogo propietario.
- Los tratamientos largos (ortodoncia, alineadores, implantes) se expresan como **inicio + mensualidad** o **escaneo + tratamiento**, que es como se cotizan de verdad y evita que el agente suelte una cifra de millones sin contexto.
- `carillas` distingue **resina y porcelana**, que es la primera pregunta real del paciente y tienen precios muy distintos.
- **La duración y el buffer de `carillas` también son ficticios** (90/15): no venían del blueprint ni del cliente.

Las otras 12 duraciones vienen del blueprint, no del cliente. **Siguen sin confirmar.** Determinan cuántos pacientes caben en un día, así que un error se nota en la agenda real.

## Por qué `duration_min` y `buffer_min` importan tanto

El motor de slots reserva `duration_min + buffer_min`. Una limpieza de 45 con buffer 10 ocupa **55 minutos** en la agenda.

El buffer es la holgura real entre pacientes: limpiar el box, el paciente que se demora en salir, las notas del odontólogo. Si se pone a 0, la agenda se ve bonita y en la práctica todo se atrasa desde la tercera cita de la mañana.

Ver [[Calculo-de-Slots]].

## Precios: la regla

> Todos los precios son **"desde"**. El precio final lo define el odontólogo en la valoración, y el agente lo dice así **siempre**.

Confirmada por el cliente el 2026-10-22: *"que el bot nunca diagnostique ni dé precios finales"*. Es la regla 3 del system prompt.

Con precios ficticios en la base, esta regla pasa de ser una buena práctica a ser **la red de seguridad de la demo**: el agente nunca afirma un precio cerrado, así que un número aproximado no se convierte en una promesa.

## Relacionado

- [[Cliente-Clinica-Gonzalez]] — la ficha
- [[Clinica-Gonzalez-Pendientes]] — qué sustituir antes de producción
- [[Clinica-Gonzalez-Business-Info]] — el resto de la información del negocio
- [[Calculo-de-Slots]] — cómo se usan duración y buffer
- [[Guardrails-Clinicos]] — por qué "caries" no se agenda directo
