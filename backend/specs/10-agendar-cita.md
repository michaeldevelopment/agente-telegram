# Spec 10 · `agendar_cita` 🔑

**Depende de:** 09 · **Entorno:** local · **~55 min**

## Qué construye

El camino crítico. Una conversación termina con **una cita real en el Google Calendar del cliente**.

> ## 🔑 Esta es la spec que vende la demo
>
> El paso 7 del guion es *"mirar Google Calendar"* y que el evento esté ahí, con el nombre del paciente y la hora correcta. Si esto funciona, el cliente deja de ver una maqueta y ve un producto.

## Archivos

| Archivo | | Qué va dentro |
|---|---|---|
| `src/gcal/events.ts` | nuevo | `insert`, con id determinista y manejo de `409` |
| `src/tools/agendar.ts` | nuevo | La tool completa |
| `src/tools/registry.ts` | editado | La registra (al final, para no mover el orden) |

## Los cuatro pasos de `run()`

```
1. Validar     → servicio existe, fecha válida, ≥2 h de anticipación
2. Revalidar   → ¿sigue libre el slot? (pasaron minutos desde que se propuso)
3. Insertar    → primero en NUESTRA base (uq_appt_slot es el candado real)
4. Google      → evento con id determinista + programar recordatorios (spec 14)
```

## Tres cosas lo hacen robusto, y ninguna depende del LLM

### 1 · Revalidación antes de escribir

Entre que el modelo propone y el paciente confirma pasan segundos o minutos. Si el slot se ocupó, **no falles a secas**: devuelve alternativas para que la conversación siga.

```ts
if (!(await isSlotFree(ctx.workspace, start, end))) {
  const alt = await computeSlots({ ...  limit: 3 });
  return { ok: false, error: "slot_ocupado", data: { alternativas: alt } };
}
```

### 2 · El índice único es el candado

`uq_appt_slot` en Postgres es la garantía real contra doble reserva, incluso con dos conversaciones simultáneas. La revalidación es cortesía; **el índice es lo que no se puede saltar**.

### 3 · Id determinista

```ts
const eventId = appt.id.replace(/-/g, "");   // 32 chars hex ⊂ base32hex ✔
```

Si la llamada a Google falla y se reintenta, devuelve **`409 The requested identifier already exists`** en lugar de duplicar. **Eso es lo que vuelve la tool segura ante reintentos.** Un `409` no es un error: es la idempotencia funcionando. Lee el evento y sigue.

## El evento

```json
{
  "id": "a3f1c89d4b2e4f7a9c0d1e2f3a4b5c6d",
  "summary": "Limpieza dental — María González",
  "description": "Agendado por el agente de Telegram.\nPaciente: …\nTel: …\nCita #a3f1c89d",
  "start": { "dateTime": "2026-10-29T10:30:00-05:00", "timeZone": "America/Bogota" },
  "end":   { "dateTime": "2026-10-29T11:15:00-05:00", "timeZone": "America/Bogota" },
  "reminders": { "useDefault": true },
  "extendedProperties": { "private": { "apptId": "<uuid>", "source": "telegram-agent" } }
}
```

- **`dateTime` con offset Y `timeZone`.** Sin offset, se interpreta en la zona del calendario y **la cita aparece corrida 5 horas**. Es el bug clásico.
- **Sin `attendees`.** Las Service Accounts creadas desde mar-2020 no pueden invitar sin delegación de dominio; intentarlo da `403 forbiddenForServiceAccounts`. El paciente recibe su confirmación por Telegram, que es lo que queremos.
- `sendUpdates=none`: no hay a quién notificar.
- **`extendedProperties.private`** guarda el `apptId`, para reconciliar si alguien mueve la cita a mano en Google — que es exactamente lo que va a pasar en una clínica real.

## Validaciones duras

```ts
if (!start.isValid) return { ok:false, error:"fecha_invalida" };
if (start < DateTime.now().plus({ hours: 2 }))
  return { ok:false, error:"muy_pronto: minimo 2 horas de anticipacion" };
```

Y `nombre_paciente: z.string().min(3)` — es lo que respalda la regla 6 del prompt: *nunca agendes sin el nombre completo*. No es una instrucción al modelo, es un esquema.

## Terminada cuando

- [ ] 🔑 **Una conversación completa agenda**, y el evento **aparece en Google Calendar**
- [ ] 🔑 **La hora es la correcta**, no corrida 5 h. Compara a ojo: lo que dijo el bot y lo que muestra el calendario
- [ ] El `summary` trae servicio y nombre del paciente
- [ ] La cita quedó en la base
      ```sql
      select status, starts_at, patient_name, gcal_event_id from appointments
       order by created_at desc limit 1;
      ```
- [ ] **Idempotencia**: vuelve a llamar a `gcalInsert` con el mismo id → **`409` manejado, sin duplicar**. En el calendario hay **un** evento
- [ ] **Doble reserva**: lanza dos `agendar_cita` del mismo slot a la vez → una gana, la otra recibe `slot_ocupado` con alternativas. En la base, **una fila**
- [ ] Agendar a menos de 2 h → `muy_pronto`
- [ ] Agendar sin nombre → el esquema lo rechaza y el bot lo pide
- [ ] Un slot que se ocupó entre proponer y confirmar → `slot_ocupado` **con 3 alternativas**, y el bot sigue la conversación
- [ ] Se registró el evento
      ```sql
      select payload from events where type='appointment' order by created_at desc limit 1;
      ```
- [ ] **Borra la cita de prueba del calendario** al terminar
- [ ] `scripts/smoke/10.sh` sale con código 0

## Trampas

- `409` **no es un error**. Si lo tratas como fallo, el reintento parecerá roto.
- El id debe ser **base32hex** (`0-9`, `a-v`), 5–1024 chars. El uuid sin guiones cumple; un uuid **con** guiones no.
- Insertar primero en nuestra base y después en Google: si Google falla, tenemos el registro y el id para reintentar. Al revés, no.
- No metas `attendees` "por si acaso": rompe el insert entero.

## Referencias

- Blueprint §4.5 (`agendar_cita` completo), §8.4 (crear el evento), §8.5, §13 Fase 3
- `../../knowledge/wiki/Capa-de-Tools.md`, `../../knowledge/wiki/Google-Calendar.md`
- `../../knowledge/wiki/Clinica-Gonzalez-Guion-Demo.md` (pasos 6 y 7)
- `../memoria/service-account-sin-attendees.md`
