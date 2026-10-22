---
titulo: Recordatorios programados
tipo: base
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §4.8"
actualizado: 2026-10-22
tags: [recordatorios, pg_cron, no-show, proactivos]
---

# Recordatorios programados

Telegram no tiene ventana de 24 h, así que los proactivos son libres — lo cual **no** significa que todo valga. Dos reglas: respetar horas de silencio y parar al primer bloqueo.

Es la funcionalidad que ataca el **no-show**, que para una clínica es dinero directo.

## Los dos recordatorios

Al confirmar una cita se insertan dos filas en `reminders`:

| Tipo | Cuándo | Contenido |
|---|---|---|
| `confirm_24h` | 24 h antes | Recuerda la cita + botones `Confirmar` / `Reprogramar` / `Cancelar` |
| `remind_2h` | 2 h antes | Recordatorio corto con la dirección de la sede |

Existe un tercer tipo en el enum, `followup_no_show`, todavía sin usar.

## Programación

```ts
async function scheduleReminders(appt: Appointment) {
  for (const [kind, hours] of [["confirm_24h", 24], ["remind_2h", 2]] as const) {
    const raw = DateTime.fromJSDate(appt.starts_at).minus({ hours });
    const at  = shiftOutOfQuietHours(raw, ws);   // si cae 21:00–08:00, se mueve a las 08:00
    if (at < DateTime.now()) continue;           // cita en <24 h: se omite ese recordatorio
    await insertReminder({ appointmentId: appt.id, kind, sendAt: at.toJSDate() });
  }
}
```

Dos detalles que importan:

- **`shiftOutOfQuietHours`**: un recordatorio de las 3 de la madrugada es una forma eficaz de que te bloqueen el bot.
- **El `continue`**: si la cita es dentro de menos de 24 h, el `confirm_24h` ya pasó. No se manda con retraso, se omite.

El constraint `uq_reminder unique (appointment_id, kind)` impide duplicados si `scheduleReminders` se ejecuta dos veces.

## El barrido

```sql
select cron.schedule('reminders-tick', '1 minute', $$
  select net.http_post(
    url := (select value from runtime_config where key='worker_url') || '/internal/reminders/tick',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-secret', (select value from runtime_config where key='internal_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  )
  where exists (select 1 from reminders where status='pending' and send_at <= now());
$$);
```

**El `where exists` es la pieza inteligente:** evita despertar al worker 1.440 veces al día para nada.

## Costo en tokens: cero

Los recordatorios **no pasan por el LLM**. Son plantillas con datos.

Las respuestas a sus botones (`Confirmar` / `Cancelar`) también son **deterministas**: actualizan la cita, parchean Google Calendar y responden con texto fijo. Solo si el paciente contesta con texto libre ("¿puedo llevarlo a otro día?") entra el agente.

Es la [[Economia-de-Tokens|regla 4]] aplicada al caso más repetitivo que existe.

## Interacción con el bloqueo

Cuando el envío devuelve `403 bot was blocked`:

1. `contacts.is_blocked = true`.
2. **Se cancelan los recordatorios pendientes** de esa conversación.

Seguir intentando contra un chat bloqueado quema cuota y sube la tasa de error sin ningún beneficio. Ver [[Salida-y-Outbox]].

## Gotchas

- Los recordatorios pendientes hay que cancelarlos también al **cancelar o reprogramar** la cita. Un recordatorio de una cita cancelada es peor que ningún recordatorio.
- Al reprogramar hay que **recalcular** `send_at`, no solo mover la cita.
- `pg_cron` corre en UTC. Las horas de silencio son **locales**: la conversión es responsabilidad del worker, no del cron.
- Programar los recordatorios a las 19:00 locales (00:00 UTC) los deja en horario **off-peak** de DeepSeek, aunque al no usar el LLM el ahorro ahí es simbólico. Ver [[Economia-de-Tokens]], regla 8.

## Relacionado

- [[Capa-de-Tools]] — `agendar_cita` los programa
- [[Salida-y-Outbox]] — por dónde salen
- [[Google-Calendar]] — el `PATCH` al confirmar o cancelar
- [[Esquema-de-Datos]] — tabla `reminders`
- [[Motor-de-Decision]] — por qué sus botones no gastan LLM
