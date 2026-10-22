---
name: horario-atencion
description: Horario confirmado de la clínica, cargado como jornada continua sin almuerzo
metadata:
  type: cliente
---

**Lunes a viernes 8:00 a. m. – 6:00 p. m. Sábado 8:00 a. m. – 12:00 m. Domingo cerrado.**

**Por qué:** alimenta `business_hours`, y de ahí sale directamente qué slots ofrece el agente. Si está mal, el bot ofrece citas con la clínica cerrada.

**Cómo aplicarlo:** cargado como **jornada continua, sin descanso de almuerzo**, porque el cliente dio el horario corrido y no mencionó break. Es una decisión abierta, no un dato confirmado — ver [[almuerzo-sin-confirmar]]. El domingo cerrado también se asumió.

Relacionado: [[almuerzo-sin-confirmar]], [[catalogo-13-servicios]]
