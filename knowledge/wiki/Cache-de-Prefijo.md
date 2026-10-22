---
titulo: Cache de prefijo
tipo: base
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §5 regla 2"
actualizado: 2026-10-22
tags: [cache, deepseek, tokens, costo, prompt]
---

# Cache de prefijo

Un cache hit cuesta **50 veces menos** que un miss. Esta página es la disciplina que mantiene el hit ratio por encima del 60%, y es la causa número uno de que el costo se dispare cuando se rompe.

## Los precios

DeepSeek cachea prefijos en disco automáticamente, sin cambios de código y sin coste de almacenamiento.

| Clase de token | `deepseek-flash` off-peak | peak |
|---|---|---|
| Input **cache hit** | **$0.003 / M** | $0.006 / M |
| Input cache miss | $0.15 / M | $0.30 / M |
| Output | $0.60 / M | $1.20 / M |

## Cómo funciona el match

- El match se evalúa **desde el token 0**. Coincidencias a mitad del prompt no sirven de nada.
- La petición debe **coincidir por completo** con una *unidad de prefijo cacheada* ya persistida.
- Si `A+B` se cacheó y mandas `A+C`, no hay hit; pero el sistema detecta el prefijo común `A` y lo persiste, así que el siguiente `A+D` sí pega.

Esa última propiedad es la que hace que el diseño funcione: cada turno nuevo siembra el prefijo del siguiente.

## Las cinco reglas operativas

1. **El system prompt es un bloque congelado.** Mismo texto, byte a byte, en todas las peticiones del workspace. Se renderiza una vez a `business_info.rendered` y se guarda su hash. Si cambia el hash, se asume que el primer turno siguiente paga miss y ya.

2. **Ningún dato volátil arriba.** Fecha, hora, nombre del paciente, slots: todo al final, en el bloque volátil (~80 tokens).

3. **El array `tools` se serializa dentro del prefijo.** Orden fijo, descripciones estables. **Reordenar las tools rompe el cache de todos los clientes a la vez.** Ver [[Capa-de-Tools]].

4. **Historial append-only.** Nunca reordenar ni recortar por el frente a mitad de conversación: cada turno nuevo debe ser `prefijo_anterior + turno_nuevo` para pegarle al cache del turno previo.

5. **Cuando haya que recortar, recortar en bloque grande** y registrar el resumen. Se paga un miss completo **una vez**, no uno por turno.

## El error que cuesta 10×

> El `injectVariables()` del blueprint original mete `{{now}}`, `{{contact.name}}` y `{{business.hours}}` **dentro** del system prompt.

Con modelos sin cache de prefijo era inofensivo. Con DeepSeek es el error más caro posible: `{{now}}` cambia en cada petición, el prefijo **nunca** coincide desde el token 0, y el 100% del prompt se cobra como cache miss.

**Multiplicador medido: 10.6×** sobre el costo por conversación. Ver [[Economia-de-Tokens]].

La distinción es simple y hay que tenerla siempre presente:

- Resolver variables **al guardar** el prompt → cache hit.
- Resolver variables **en cada petición** → cache miss.

`{{NOMBRE_CLÍNICA}}`, `{{CIUDAD}}` y `{{BUSINESS_INFO_RENDERED}}` se resuelven **una vez** al renderizar y se guardan ya resueltos. No son variables de runtime. Ver [[Clinica-Gonzalez-System-Prompt]].

## El orden correcto

```
[1] system  → prompt estático congelado        ← CACHEADO
[2] system  → resumen rodante (cambia c/10 msgs) ← CACHEADO casi siempre
[3] ...     → historial reciente, append-only   ← CACHEADO hasta el último turno
[4] system  → BLOQUE VOLÁTIL (~80 tokens)       ← siempre miss, y da igual
[5] user    → el turno consolidado              ← siempre miss, y da igual
```

Lo volátil abajo es barato porque es pequeño. Lo volátil arriba es carísimo porque invalida todo lo que viene después. El armado concreto está en [[Agente-DeepSeek]].

## Medición obligatoria

`usage.prompt_cache_hit_tokens` y `prompt_cache_miss_tokens` van a `events` en **cada** llamada.

> **KPI: cache hit ratio > 60%.** Si está por debajo, hay un dato volátil infiltrado en el prefijo. Es la alarma número uno de costo.

Se consulta con la vista `v_llm_daily`. Ver [[Observabilidad]].

Y es un **criterio de aceptación de fase**: en la [[Roadmap-por-Fases|Fase 1]], si el cache hit es 0 en el segundo turno, no se avanza.

## Off-peak, gratis

DeepSeek cobra la mitad en off-peak. Las horas **peak** son 01:00–04:00 y 06:00–10:00 **UTC**, de lunes a viernes → en Bogotá (UTC-5): **20:00–23:00** y **01:00–05:00** locales.

El horario de atención de la clínica (8:00–18:00 Bogotá = 13:00–23:00 UTC) cae **íntegramente en off-peak**. Todo el tráfico del cliente paga tarifa reducida sin hacer nada.

## Relacionado

- [[Economia-de-Tokens]] — las ocho reglas y el costo total
- [[Agente-DeepSeek]] — dónde se arma el prefijo
- [[Capa-de-Tools]] — el orden de las tools es parte del prefijo
- [[Clinica-Gonzalez-System-Prompt]] — el bloque congelado del cliente
- [[Observabilidad]] — cómo se vigila
