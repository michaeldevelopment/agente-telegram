---
name: volatiles-al-final-del-prompt
description: Fecha, nombre y disponibilidad van al final de los mensajes, nunca en el system prompt — vale 10x
metadata:
  type: decision
---

**Ningún dato volátil arriba.** Fecha, hora, nombre del paciente y slots van en un bloque al **final** de la cadena de mensajes, nunca dentro del system prompt.

**Por qué:** DeepSeek cachea prefijos y un **cache hit cuesta 50× menos que un miss** ($0.003/M vs $0.15/M). El match se evalúa **desde el token 0**: si lo primero que ve cambia en cada petición, no hay hit nunca y el 100% del prompt se cobra caro.

**Multiplicador medido: 10.6×.** Es la trampa del blueprint original de WhatsApp, que inyectaba `{{now}}` dentro del system prompt.

**La distinción que lo resume:** resolver variables **al guardar** el prompt = cache hit. Resolver **en cada petición** = cache miss.

**Cómo aplicarlo:** el orden es prompt estático congelado → resumen rodante → historial append-only → **bloque volátil (~80 tokens)** → turno del paciente. Lo volátil abajo es barato porque es pequeño; arriba es carísimo porque invalida todo lo que sigue.

Tres cosas más que viven en el prefijo y rompen el cache si se tocan: el **orden del array `tools`**, sus descripciones, y recortar el historial por el frente.

**KPI: cache hit ratio > 60%.** Es un criterio de aceptación de fase: si en el segundo turno el hit es 0, hay un volátil infiltrado y no se avanza.

Relacionado: [[thinking-mode-apagado]], [[catalogo-13-servicios]], [[nombre-del-negocio-sin-decidir]]
