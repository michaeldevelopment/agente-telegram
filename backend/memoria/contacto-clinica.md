---
name: contacto-clinica
description: Teléfono y WhatsApp de la clínica, y por qué es el dato más crítico del cliente
metadata:
  type: cliente
---

El teléfono de la Clínica Dr. Fabián González es **+57 322 236 3192**, y es **el mismo número de WhatsApp**.

**Por qué:** es el dato más crítico de todo el cliente. Es lo que el agente entrega cuando `isClinicalUrgency()` detecta una urgencia y escala. Sin él, la ruta de urgencia está rota y el paso 10 de la demo se cae.

**Cómo aplicarlo:** va en `business_info.structured.sedes[0].telefono` y `.whatsapp`. No confundir con el número del bot de Telegram, que es otro — ver [[bot-con-telefono-personal]]. Detalle en `../../knowledge/wiki/Clinica-Gonzalez-Business-Info.md`.

Relacionado: [[direccion-clinica]], [[nunca-diagnosticar-ni-recetar]]
