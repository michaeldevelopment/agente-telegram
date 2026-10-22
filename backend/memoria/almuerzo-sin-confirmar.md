---
name: almuerzo-sin-confirmar
description: ABIERTA — no se sabe si la clínica cierra a mediodía; el horario se cargó corrido
metadata:
  type: abierta
---

**No se sabe si la clínica cierra para almorzar.** El cliente dio "L–V 8am–6pm" sin mencionar descanso, y se cargó **literal**: jornada continua.

**Por qué se decidió así:** inventar una restricción que el cliente no dijo es peor que tomarlo al pie de la letra. Pero la consecuencia es visible: si la clínica sí cierra a mediodía, **el agente va a ofrecer una cita a la 1 p. m. delante del dueño** durante la demo.

**Cómo aplicarlo:** si se confirma el almuerzo, llenar `business_hours.break_from` y `break_to`. El motor de slots ya parte la jornada en dos tramos automáticamente; reduce los slots disponibles sin tocar código.

Relacionado: [[horario-atencion]], [[nombre-del-negocio-sin-decidir]]
