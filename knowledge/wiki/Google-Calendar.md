---
titulo: Google Calendar
tipo: base
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §8"
actualizado: 2026-10-22
tags: [google-calendar, service-account, agendamiento, idempotencia]
---

# Google Calendar

Autenticación, consulta de ocupación y creación de eventos. El cálculo de slots tiene página propia: [[Calculo-de-Slots]].

## Autenticación: Service Account sobre calendario compartido

Para la demo se agenda en **el calendario de Google del propietario del proyecto**, así se demuestra en vivo que la cita aparece de verdad.

### Puesta en marcha — 5 minutos, una sola vez

1. Google Cloud Console → nuevo proyecto → habilitar **Google Calendar API**.
2. Crear una **Service Account** → generar una clave JSON.
3. Copiar el email de la SA (`algo@proyecto.iam.gserviceaccount.com`).
4. En Google Calendar → *Configuración del calendario* → **Compartir con determinadas personas** → agregar el email de la SA con permiso **"Hacer cambios en los eventos"**.
5. Copiar el **ID del calendario** (para un calendario personal es el propio correo).
6. Guardar en Railway: `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY` (base64), `GOOGLE_CALENDAR_ID`.

Sin pantalla de consentimiento, sin verificación de Google, sin `refresh_token` que rote. Scope: `https://www.googleapis.com/auth/calendar`.

El paso 4 es el que más se olvida y produce el error de configuración número uno. Ver [[Checklist-de-Onboarding]].

### El límite que define el diseño

> ⚠️ Las Service Accounts creadas desde el **2-mar-2020 no pueden invitar asistentes** sin delegación a nivel de dominio (que requiere Google Workspace, no un Gmail personal).

Consecuencia práctica: el evento se crea **sin `attendees`**, y los datos del paciente van en el `summary` y la `description`. El paciente recibe su confirmación **por Telegram**, que es justamente lo que queremos.

Si en el futuro el cliente quiere invitaciones por correo al paciente, hay que pasar a OAuth con la cuenta del cliente, o a Workspace con delegación.

```ts
const jwt = new JWT({
  email: process.env.GOOGLE_SA_EMAIL,
  key: Buffer.from(process.env.GOOGLE_SA_PRIVATE_KEY!, "base64").toString("utf8"),
  scopes: ["https://www.googleapis.com/auth/calendar"],
});
// google-auth-library cachea y renueva el access token (~1 h) por su cuenta
```

**La clave en base64** evita toda la clase de bugs de los `\n` literales al pegar el JSON.

## Disponibilidad: `freeBusy.query`

```json
POST https://www.googleapis.com/calendar/v3/freeBusy
{
  "timeMin": "2026-10-29T00:00:00-05:00",
  "timeMax": "2026-11-05T00:00:00-05:00",
  "timeZone": "America/Bogota",
  "items": [{ "id": "midireccion@gmail.com" }]
}
```

Respuesta: `calendars.<id>.busy[]` con `{start, end}`.

Dos cosas que hay que tener presentes siempre:

- **`busy[].start` es inclusivo y `busy[].end` es exclusivo.** Usar `>=`/`<` correctamente o se pierde un slot válido en cada frontera.
- **Hay que revisar `calendars.<id>.errors[]`.** Un `notFound` ahí significa que el calendario no está compartido con la SA. No falla la petición: falla en silencio devolviendo cero ocupación, que es peor.

Los `busy[]` se **cachean 60 s** por `(calendario, día)`. Durante una conversación el modelo consulta disponibilidad 2–3 veces. Ver [[Performance-y-Limites]].

## Crear el evento

```json
POST /calendar/v3/calendars/{calendarId}/events?sendUpdates=none
{
  "id": "a3f1c89d4b2e4f7a9c0d1e2f3a4b5c6d",
  "summary": "Limpieza dental — María González",
  "description": "Agendado por el agente de Telegram.\nPaciente: …\nTel: …\nCita #a3f1c89d",
  "start": { "dateTime": "2026-10-29T10:30:00-05:00", "timeZone": "America/Bogota" },
  "end":   { "dateTime": "2026-10-29T11:15:00-05:00", "timeZone": "America/Bogota" },
  "reminders": { "useDefault": true },
  "extendedProperties": {
    "private": { "apptId": "a3f1c89d-4b2e-…", "source": "telegram-agent" }
  }
}
```

### `id` propio y determinista — la idempotencia

Requisito de formato: 5–1024 caracteres en **base32hex** (`0-9`, `a-v`). El uuid de la cita sin guiones son 32 caracteres hex, subconjunto válido.

Si la petición se reintenta, Google responde **`409 The requested identifier already exists`** en lugar de duplicar la cita. **Esto es lo que vuelve `agendar_cita` seguro ante reintentos.** Ver [[Capa-de-Tools]].

### `dateTime` con offset **y** `timeZone`

Mandar la hora sin offset es el bug clásico: se interpreta en la zona del calendario y **la cita aparece corrida 5 horas**.

### `extendedProperties.private`

Guarda nuestro `apptId`. Permite reconciliar en ambos sentidos si alguien mueve la cita a mano en Google — que es exactamente lo que va a pasar en una clínica real.

## Reprogramar y cancelar

- **Reprogramar:** `PATCH /calendars/{calId}/events/{eventId}` con el nuevo `start`/`end`, **manteniendo el mismo `id`**. No se crea uno nuevo.
- **Cancelar:** `DELETE` el evento (o `PATCH` con `status: "cancelled"` si se quiere conservar el rastro) y pasar los recordatorios pendientes a `cancelled`.

## Gotchas

- `notFound` en `calendars.<id>.errors[]` del freeBusy → el calendario **no está compartido con la SA**, o el `GOOGLE_CALENDAR_ID` está mal. Error número uno.
- `403 forbiddenForServiceAccounts` al insertar con `attendees` → es el límite de arriba. Quitar los asistentes.
- `409` al insertar → el id ya existe: **no es un error**, es la idempotencia funcionando. Leer el evento y seguir.
- `busy[].end` es **exclusivo**.
- Los **eventos de día completo** no traen `dateTime` sino `date`. Un cierre de día completo en el calendario de la clínica aparece así en `busy` y hay que tratarlo.
- La clave privada trae `\n` literales si se pega desde el JSON. **Base64 siempre.**

## Relacionado

- [[Calculo-de-Slots]] — qué se hace con los `busy[]`
- [[Capa-de-Tools]] — `agendar_cita`, `reprogramar_cita`, `cancelar_cita`
- [[Checklist-de-Onboarding]] — los 6 pasos de puesta en marcha
- [[Clinica-Gonzalez-Credenciales]] — qué variables hacen falta
- [[Gotchas]] — checklist consolidado
