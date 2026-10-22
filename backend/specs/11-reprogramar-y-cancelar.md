# Spec 11 · Reprogramar y cancelar

**Depende de:** 10 · **Entorno:** local · **~40 min**

## Qué construye

Las dos tools que faltan para cerrar el ciclo de vida de una cita. Son más simples que `agendar_cita` porque reusan todo lo suyo: la revalidación, el cliente de Google, los códigos de error.

Es el paso 8 del guion: *"mejor el jueves"* y el evento **se mueve**, no se duplica.

## Archivos

| Archivo | | Qué va dentro |
|---|---|---|
| `src/tools/reprogramar.ts` | nuevo | `reprogramar_cita` |
| `src/tools/cancelar.ts` | nuevo | `cancelar_cita` |
| `src/gcal/events.ts` | editado | `patch()` y `remove()` |
| `src/tools/registry.ts` | editado | Las registra al final |

## `reprogramar_cita`

```
1. Buscar la cita del paciente (por id, o la próxima si solo hay una)
2. Validar el nuevo horario: fecha válida, ≥2 h
3. Revalidar que el nuevo slot está libre
4. PATCH en Google con el MISMO event id
5. Update en nuestra base: starts_at, ends_at, status = 'rescheduled'
6. Reprogramar los recordatorios (spec 14)
```

> **`PATCH`, no borrar y crear.** El evento mantiene su `id`, así que no se duplica y el historial se conserva. Es lo que se ve en la demo: el bloque se mueve en el calendario proyectado.

El slot viejo queda libre automáticamente: `uq_appt_slot` es sobre `starts_at`, y al cambiarlo el bloque anterior deja de estar ocupado.

## `cancelar_cita`

```
1. Buscar la cita
2. DELETE en Google (o PATCH con status: "cancelled" si se quiere rastro)
3. status = 'cancelled' + cancel_reason en nuestra base
4. Pasar los recordatorios pendientes a 'cancelled'
```

**Cancelar los recordatorios no es opcional.** Un recordatorio de una cita cancelada es peor que ningún recordatorio: el paciente se presenta.

## Qué dice el bot al cerrar

Ambas tools cierran recordando la política de cancelación (*avisar con 24 h*). Es `#dato-ficticio` — está sin confirmar con el Dr. González.

## Terminada cuando

- [ ] **Reprogramar mueve el evento**: agenda, luego di "mejor el jueves"
      - En Google hay **un** evento, no dos
      - El `gcal_event_id` en la base **no cambió**
      ```sql
      select status, starts_at, gcal_event_id from appointments
       order by updated_at desc limit 1;   -- rescheduled, nueva fecha, mismo id
      ```
- [ ] **El slot viejo vuelve a ofrecerse**: pide disponibilidad para el día original → el horario liberado **aparece**
- [ ] Reprogramar a un slot ocupado → `slot_ocupado` con alternativas
- [ ] Reprogramar a menos de 2 h → `muy_pronto`
- [ ] **Cancelar borra de Google**: el evento **desaparece** del calendario
- [ ] La cita queda `cancelled` en la base, con motivo si el paciente lo dio
- [ ] **Los recordatorios quedan cancelados**
      ```sql
      select kind, status from reminders where appointment_id = '<id>';
      -- todos cancelled
      ```
- [ ] El slot cancelado vuelve a ofrecerse
- [ ] Cancelar una cita que no existe → error legible, el bot lo explica sin romperse
- [ ] Un paciente **no puede tocar la cita de otro**: el `contact_id` se verifica en el servidor
- [ ] `scripts/smoke/11.sh` sale con código 0

## Trampas

- Si borras y recreas en vez de hacer `PATCH`, el evento pierde su id y la idempotencia de la spec 10 deja de valer.
- `DELETE` sobre un evento ya borrado devuelve `410 Gone`. No es un error: la cita ya no está, que es lo que queríamos.
- Al reprogramar hay que **recalcular `send_at`** de los recordatorios, no solo mover la cita.
- Si el paciente tiene varias citas, **pregunta cuál** antes de actuar. No asumas la próxima.

## Referencias

- Blueprint §4.5 (catálogo de tools), §8.4 (reprogramar y cancelar)
- `../../knowledge/wiki/Capa-de-Tools.md`, `../../knowledge/wiki/Google-Calendar.md`
- `../../knowledge/wiki/Clinica-Gonzalez-Guion-Demo.md` (paso 8)
