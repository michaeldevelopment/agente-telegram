---
titulo: Cálculo de slots
tipo: base
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §8.3"
actualizado: 2026-10-22
tags: [slots, disponibilidad, luxon, timezone, agendamiento]
---

# Cálculo de slots

El motor que convierte "¿tienen algo esta semana en la tarde?" en tres botones con horarios reales. Es **código determinista puro**: el modelo no participa en el cálculo, solo lo invoca y presenta el resultado.

## La fórmula

```
slots libres = horario de atención
             − descanso (almuerzo)
             − días cerrados (festivos, closures)
             − bloques ocupados (freeBusy de Google)
             − anticipación mínima
             todo alineado a una rejilla de 15 min
```

## Parámetros fijos

```ts
const zone = ws.timezone;                       // 'America/Bogota' — sin DST
const grid = 15;                                // rejilla en minutos
const need = service.duration_min + service.buffer_min;
const earliest = DateTime.now().setZone(zone).plus({ hours: 2 });
```

El `need` incluye el **buffer del servicio**: una limpieza de 45 min con 10 de buffer ocupa 55. El buffer es la holgura real de la clínica entre pacientes, y por eso vive en `services`, no en el código. Ver [[Esquema-de-Datos]].

## Las cinco decisiones que importan

### Máximo 4 opciones

Más es **peor conversión y más tokens**. Es una decisión de producto tanto como de costo. La tool `consultar_disponibilidad` lo impone, no el prompt. Ver [[Capa-de-Tools]].

### Anticipación mínima de 2 h

Nadie quiere una cita para "dentro de 10 minutos" que nadie en la clínica vio. Se valida dos veces: al calcular slots y otra vez dentro de `agendar_cita`.

### Horizonte de 21 días

Más allá, los `busy` cambian y la oferta envejece.

### Sin solape entre las opciones ofrecidas

```ts
t = t.plus({ minutes: Math.max(need, grid) });   // no ofrecer slots solapados
```

Si se ofrecen 10:00 y 10:15 para un servicio de 45 min, al reservar una **la otra deja de existir** y el paciente siente que lo engañaron. El avance es por `need`, no por `grid`, cuando un slot es válido.

### Colombia no tiene DST

Toda la aritmética en `America/Bogota` es estable. En un cliente futuro con DST hay que calcular siempre **en zona local con Luxon** y **nunca** sumando milisegundos a un UTC.

## Tramos del día

El descanso de almuerzo parte la jornada en dos:

```ts
const spans = h.break_from
  ? [[h.opens_at, h.break_from], [h.break_to!, h.closes_at]]
  : [[h.opens_at, h.closes_at]];
```

Un servicio de 90 min que no cabe antes del almuerzo simplemente no genera slot en ese tramo. El `while (t.plus({minutes: need}) <= end)` lo resuelve solo.

## Formato de salida

```ts
{
  iso: "2026-10-29T10:30:00-05:00",   // ISO con offset, para agendar_cita
  epochMin: 29876430,                  // para el callback_data (≤64 bytes)
  label: "jue 29 oct · 10:30 a. m."    // es-CO, para el botón
}
```

Tres representaciones del mismo instante, cada una para su consumidor: el modelo usa `iso`, el botón usa `epochMin`, el paciente lee `label`. Ver [[Salida-y-Outbox]].

## Gotchas

- **Luxon numera 1=lunes … 7=domingo**, pero `business_hours.weekday` usa 0=domingo. La conversión es `d.weekday % 7`. Equivocarse desplaza todo el horario un día.
- **`busy[].end` es exclusivo.** Un `<=` donde va un `<` pierde un slot válido en cada frontera.
- Los **eventos de día completo** de Google traen `date`, no `dateTime`. Un cierre de día completo aparece así en `busy`.
- El cache de `busy[]` es de **60 s**. Suficiente para una conversación, corto para que no se sirva ocupación obsoleta.
- La revalidación en `agendar_cita` **no es opcional**: entre proponer y confirmar pasan minutos y el slot pudo ocuparse.

## Relacionado

- [[Google-Calendar]] — de dónde salen los `busy[]`
- [[Capa-de-Tools]] — `consultar_disponibilidad` y `agendar_cita`
- [[Esquema-de-Datos]] — `services`, `business_hours`, `closures`
- [[Clinica-Gonzalez-Servicios]] — las duraciones y buffers reales del cliente
- [[Seguridad]] — por qué el servidor fija el rango y el modelo no
