# Spec 14 · Recordatorios programados

**Depende de:** 10, 12 · **Entorno:** local · **~50 min**

## Qué construye

El bot escribe **por iniciativa propia**: recuerda la cita 24 h antes con botones de confirmar/reprogramar/cancelar, y 2 h antes con la dirección.

Es la funcionalidad que ataca el **no-show**, y para una clínica eso es dinero directo. Telegram no tiene ventana de 24 h, así que los proactivos son libres — lo cual **no** significa que todo valga.

## Archivos

| Archivo | | Qué va dentro |
|---|---|---|
| `migrations/003_reminders_cron.sql` | nuevo | Job `reminders-tick` |
| `src/reminders/schedule.ts` | nuevo | `scheduleReminders`, horas de silencio |
| `src/reminders/send.ts` | nuevo | Plantillas y envío |
| `src/http/internal.ts` | editado | `/internal/reminders/tick` |
| `src/handlers/callbacks.ts` | editado | Handlers `rc:` (confirmar) y `rx:` (cancelar) |
| `src/tools/agendar.ts` | editado | Llama a `scheduleReminders` |

## Los dos recordatorios

| Tipo | Cuándo | Contenido |
|---|---|---|
| `confirm_24h` | 24 h antes | Recuerda la cita + botones `Confirmar` / `Reprogramar` / `Cancelar` |
| `remind_2h` | 2 h antes | Corto, con la **dirección de la sede** |

## Programación

```ts
for (const [kind, hours] of [["confirm_24h", 24], ["remind_2h", 2]] as const) {
  const raw = DateTime.fromJSDate(appt.starts_at).minus({ hours });
  const at  = shiftOutOfQuietHours(raw, ws);   // 21:00–08:00 → se mueve a las 08:00
  if (at < DateTime.now()) continue;           // cita en <24 h: se omite ese recordatorio
  await insertReminder({ appointmentId: appt.id, kind, sendAt: at.toJSDate() });
}
```

- **`shiftOutOfQuietHours`**: un recordatorio a las 3 de la madrugada es una forma eficaz de que te bloqueen el bot.
- **El `continue`**: si la cita es dentro de menos de 24 h, el `confirm_24h` ya pasó. No se manda tarde, se omite.
- `uq_reminder (appointment_id, kind)` impide duplicados si se ejecuta dos veces.

## El barrido

```sql
select cron.schedule('reminders-tick', '1 minute', $$
  select net.http_post(...)
  where exists (select 1 from reminders where status='pending' and send_at <= now());
$$);
```

**El `where exists` es la pieza inteligente:** evita despertar al worker 1.440 veces al día para nada.

## Coste en tokens: cero

Los recordatorios **no pasan por el LLM**. Son plantillas con datos.

Las respuestas a sus botones también son **deterministas**: actualizan la cita, parchean Google y responden con texto fijo. Solo si el paciente contesta con texto libre ("¿puedo llevarlo a otro día?") entra el agente.

`Reprogramar` no agenda: pide disponibilidad y devuelve los botones de la spec 12.

## Al bloquear, parar

Cuando un envío devuelve `403`: `contacts.is_blocked = true` **y se cancelan los recordatorios pendientes** de esa conversación. Seguir insistiendo contra un chat bloqueado quema cuota y sube la tasa de error sin ningún beneficio.

## Terminada cuando

- [ ] Agendar inserta **2 recordatorios**
      ```sql
      select kind, send_at, status from reminders
       where appointment_id = '<id>';   -- confirm_24h y remind_2h, pending
      ```
- [ ] 🔧 **Uno programado a +2 min se dispara.** Inserta a mano `send_at = now() + 2 min` y espera
- [ ] El de 2 h **trae la dirección**: Av 3A # 24, Santo Domingo
- [ ] **`Confirmar`** → `appointments.status = 'confirmed'`, respuesta de texto fijo
- [ ] **`Cancelar`** → la cita se cancela, **el evento desaparece de Google**, los recordatorios restantes quedan `cancelled`
- [ ] **`Reprogramar`** → ofrece los botones de horario de la spec 12
- [ ] 🔑 **Cero tokens**
      ```sql
      select count(*) from events where type='llm_call'
       and created_at > '<momento del recordatorio>';   -- 0
      ```
- [ ] **Horas de silencio**: una cita a las 9:00 a. m. deja su `remind_2h` a las 7:00 — fuera de silencio, se respeta. Una cita cuyo recordatorio caiga a las 23:00 se **mueve a las 08:00**
- [ ] Una cita a menos de 24 h **solo** programa el `remind_2h`
- [ ] Cancelar o reprogramar la cita **cancela o recalcula** los recordatorios
- [ ] El `where exists` funciona: sin recordatorios pendientes, el worker **no recibe peticiones**
- [ ] `scripts/smoke/14.sh` sale con código 0

## Trampas

- Los recordatorios hay que cancelarlos **también** al cancelar o reprogramar. Uno de una cita cancelada es peor que ninguno: el paciente se presenta.
- Al reprogramar, **recalcular `send_at`**, no solo mover la cita.
- `pg_cron` corre en **UTC**. Las horas de silencio son **locales**: la conversión es del worker, no del cron.
- `cron.job_run_details` crece sin freno. Purgarlo.
- `callback_data` ≤64 bytes también aquí: `rc:<appt_corto>`.

## Referencias

- Blueprint §4.8 (recordatorios), §13 Fase 4
- `../../knowledge/wiki/Recordatorios-Programados.md`, `../../knowledge/wiki/Salida-y-Outbox.md`
- `../memoria/direccion-clinica.md`
