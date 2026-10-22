---
name: service-account-sin-attendees
description: Las Service Accounts no pueden invitar asistentes; el evento se crea sin attendees
metadata:
  type: decision
---

El evento de Google Calendar se crea **sin `attendees`**. Los datos del paciente van en el `summary` y la `description`.

**Por qué:** las Service Accounts creadas **desde el 2-mar-2020 no pueden invitar asistentes** sin delegación a nivel de dominio, que requiere Google Workspace y no un Gmail personal. Intentarlo devuelve `403 forbiddenForServiceAccounts`.

No es una pérdida: el paciente recibe su confirmación **por Telegram**, que es justo lo que queremos. Si algún día el cliente quiere invitaciones por correo, hay que pasar a OAuth con su cuenta o a Workspace con delegación.

**Cómo aplicarlo:** `sendUpdates=none` (no hay a quién notificar). El `id` del evento es **determinista** — el uuid de la cita sin guiones, que es base32hex válido — así que reintentar devuelve `409` en vez de duplicar. Eso es lo que vuelve `agendar_cita` seguro.

**Los dos errores de configuración más comunes:** no compartir el calendario con la SA con permiso de *"Hacer cambios en los eventos"* (el freeBusy devuelve `200` con `notFound` dentro de `errors[]`, y el motor cree que no hay nada ocupado), y pegar la clave privada sin convertirla a base64.

Relacionado: [[una-sola-replica-railway]], [[tipo-appointment-setter]], [[horario-atencion]]
