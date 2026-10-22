---
name: bot-con-telefono-personal
description: El bot de Telegram se registra con el teléfono del usuario, no con el de la clínica
metadata:
  type: decision
---

El bot de @BotFather se crea con el **teléfono personal del usuario**, no con el +57 322 236 3192 de la clínica.

**Por qué:** es una demo, y el número de la clínica es de WhatsApp, no de Telegram. Registrar el bot no requiere el número del cliente, y pedírselo antes de cerrar la venta es fricción innecesaria.

**Cómo aplicarlo:** no confundir los dos números. El de la clínica ([[contacto-clinica]]) es lo que el **agente reparte a los pacientes** ante una urgencia; el personal es solo el dueño de la cuenta del bot y **no aparece en ninguna conversación**.

Si el cliente firma, la cuenta del bot se puede transferir o recrear a su nombre. Conviene decirlo en la reunión antes de que lo pregunte: a un dueño de negocio le importa de quién es el activo.

Relacionado: [[contacto-clinica]], [[ningun-secreto-en-el-vault]], [[canal-telegram-para-la-demo]]
