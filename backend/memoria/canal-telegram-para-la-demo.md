---
name: canal-telegram-para-la-demo
description: Telegram por velocidad de montaje; WhatsApp es la ruta de producción y la objeción predecible
metadata:
  type: decision
---

El canal es **Telegram Bot API**, no WhatsApp.

**Por qué:** no hay ventana de 24 h, no hay templates que aprobar, no hay cuenta de Meta Business que verificar. Un bot se crea en @BotFather en dos minutos. Para una demo que tiene que estar viva esta semana, la diferencia es de días. Además se eliminan tablas y funciones enteras del diseño original.

**El riesgo que hay que tener presente:** en Colombia los pacientes están en **WhatsApp**, no en Telegram. El Dr. González lo va a decir en la reunión, casi seguro.

**Cómo aplicarlo — la respuesta a esa objeción ya existe:** Telegram es el canal de la *demo*, WhatsApp es el de *producción*, y el blueprint de WhatsApp ya cubre YCloud, la ventana de 24 h y los templates. Lo que se demuestra es la capacidad (agenda real, handoff, costo), no el canal.

Conviene llevar esa respuesta ensayada: hoy está en `../../knowledge/wiki/Fuera-de-Alcance.md`, que no es donde la vas a necesitar.

Relacionado: [[handoff-dentro-de-telegram]], [[bot-con-telefono-personal]]
