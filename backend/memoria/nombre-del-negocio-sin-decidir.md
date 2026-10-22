---
name: nombre-del-negocio-sin-decidir
description: ABIERTA — Google Maps y el vault usan nombres distintos para la clínica
metadata:
  type: abierta
---

**Hay dos nombres y no se ha decidido cuál usar:**

- **"Fabian Gonzalez Odontología"** — como está registrado el negocio en Google Maps.
- **"Clínica Odontológica Dr. Fabián González"** — el que venía usando el vault.

**Por qué importa:** es la primera palabra que lee el paciente en el saludo del bot, y va dentro del bloque estático del system prompt. El de Maps es el que el cliente eligió para su negocio, lo que le da ventaja.

**Cómo aplicarlo:** el JSON guarda los dos (`nombre` y `nombre_alterno`). Hasta que se decida, el prompt usa el largo. Cambiarlo después es trivial, solo invalida el cache de prefijo una vez — ver [[volatiles-al-final-del-prompt]].

Relacionado: [[direccion-clinica]], [[almuerzo-sin-confirmar]]
