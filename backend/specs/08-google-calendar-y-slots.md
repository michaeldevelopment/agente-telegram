# Spec 08 · Google Calendar y motor de slots

**Depende de:** 02 · **Entorno:** local · **~55 min**

## Qué construye

El motor que convierte "¿tienen algo esta semana en la tarde?" en horarios reales. Lee la ocupación del calendario de Google y la cruza con el horario de la clínica.

**Código determinista puro:** el modelo no participa en el cálculo. Todavía no hay tool — eso es la spec 09 — pero un script imprime los slots y se puede verificar contra el calendario a ojo.

> **Esta spec solo depende de la 02.** Si te bloqueas con DeepSeek, adelántala.

## Archivos

| Archivo | | Qué va dentro |
|---|---|---|
| `src/gcal/auth.ts` | nuevo | JWT desde la clave en base64 |
| `src/gcal/freebusy.ts` | nuevo | `freeBusy.query` con cache de 60 s |
| `src/gcal/slots.ts` | nuevo | `computeSlots()` |
| `scripts/slots-demo.ts` | nuevo | Imprime los slots de un servicio por consola |

## Puesta en marcha, 5 minutos

1. Google Cloud Console → proyecto → habilitar **Google Calendar API**
2. Crear **Service Account** → clave JSON
3. Copiar el email de la SA (`algo@proyecto.iam.gserviceaccount.com`)
4. **Compartir el calendario con la SA, con permiso de "Hacer cambios en los eventos"** ← el paso que más se olvida
5. Copiar el ID del calendario (para uno personal, es el propio correo)
6. Convertir la clave privada a **base64** y guardarla

```ts
const jwt = new JWT({
  email: process.env.GOOGLE_SA_EMAIL,
  key: Buffer.from(process.env.GOOGLE_SA_PRIVATE_KEY!, "base64").toString("utf8"),
  scopes: ["https://www.googleapis.com/auth/calendar"],
});
```

La clave en **base64** evita toda la clase de bugs de los `\n` literales al pegar el JSON.

## La fórmula

```
slots = horario de atención
      − descanso (la clínica no tiene, de momento)
      − días cerrados (closures)
      − bloques ocupados (freeBusy)
      − anticipación mínima
      alineado a rejilla de 15 min
```

```ts
const grid = 15;
const need = service.duration_min + service.buffer_min;   // limpieza: 45+10 = 55
const earliest = DateTime.now().setZone(zone).plus({ hours: 2 });
```

Copia `computeSlots` del blueprint §8.3.

## Las cinco decisiones que importan

- **Máximo 4 opciones.** Más es peor conversión y más tokens.
- **Anticipación mínima 2 h.** Nadie quiere una cita para dentro de 10 minutos que nadie en la clínica vio.
- **Horizonte 21 días.** Más allá, los `busy` cambian y la oferta envejece.
- **Sin solape entre las opciones ofrecidas.** Si ofreces 10:00 y 10:15 para un servicio de 45 min, al reservar una la otra deja de existir y el paciente siente que lo engañaron. El avance es por `need`, no por `grid`, cuando el slot es válido.
- **Colombia no tiene DST.** Toda la aritmética en `America/Bogota` es estable.

## Salida

```ts
{
  iso: "2026-10-29T10:30:00-05:00",   // para agendar_cita
  epochMin: 29876430,                  // para el callback_data (≤64 bytes)
  label: "jue 29 oct · 10:30 a. m."    // es-CO, para el botón
}
```

Tres representaciones del mismo instante, una por consumidor.

## Terminada cuando

- [ ] El script imprime slots reales
      ```
      $ npx tsx scripts/slots-demo.ts limpieza-dental
      jue 23 oct · 8:00 a. m.   2026-10-23T08:00:00-05:00
      jue 23 oct · 9:00 a. m.   ...
      (4 slots)
      ```
- [ ] **Un evento ocupado se excluye**: crea un evento a las 10:00 en Google, vuelve a correr → ese bloque **no aparece**
- [ ] **Ningún slot antes de ahora + 2 h**
- [ ] **Los slots ofrecidos no se solapan entre sí** (comprueba que van de 55 en 55 min para limpieza, no de 15 en 15)
- [ ] **Respeta el horario**: ninguno antes de las 8:00 ni después de las 18:00; el sábado ninguno después de las 12:00; el domingo **cero**
- [ ] Un `closure` del día siguiente lo elimina entero
- [ ] **El error de configuración falla ruidosamente**: pon mal el `GOOGLE_CALENDAR_ID` → el script **aborta con un mensaje claro**, no devuelve "todo libre"
- [ ] El cache funciona: dos llamadas seguidas → **una sola** petición a Google
- [ ] La hora impresa coincide con la del calendario **sin corrimiento de 5 h**
- [ ] `scripts/smoke/08.sh` sale con código 0

## Trampas

- **Luxon numera 1=lunes…7=domingo**, `business_hours.weekday` usa 0=domingo. La conversión es `d.weekday % 7`. Equivocarse desplaza todo un día.
- **`busy[].end` es exclusivo.** Un `<=` donde va un `<` pierde un slot válido en cada frontera.
- **`calendars.<id>.errors[]`**: un `notFound` ahí significa que el calendario no está compartido con la SA. **La petición devuelve `200`** y el motor cree que no hay nada ocupado — ofrecería horarios sobre citas existentes. Hay que mirarlo a mano y fallar.
- Los **eventos de día completo** traen `date`, no `dateTime`. Un cierre de día completo aparece así en `busy`.
- Para la demo, deja **algo de ocupación** en el calendario: uno vacío no demuestra nada.

## Referencias

- Blueprint §8.1–8.3, §8.5 (gotchas), §13 Fase 3
- `../../knowledge/wiki/Google-Calendar.md`, `../../knowledge/wiki/Calculo-de-Slots.md`
- `../../knowledge/wiki/Clinica-Gonzalez-Servicios.md` (duraciones y buffers)
- `../memoria/service-account-sin-attendees.md`, `../memoria/horario-atencion.md`
