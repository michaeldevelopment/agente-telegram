# Spec 04 · Outbox de salida

**Depende de:** 03 · **Entorno:** local · **~45 min**

## Qué construye

Toda la salida pasa por `outbound_queue`. Nada vuelve a llamar a `sendMessage` directo.

No cambia nada visible para el paciente — `/start` sigue respondiendo igual — pero a partir de aquí hay rate limiting, reintentos, auditoría y la posibilidad de cancelar un envío programado. Las specs 12, 13 y 14 lo dan por hecho.

## Archivos

| Archivo | | Qué va dentro |
|---|---|---|
| `src/egress/format.ts` | nuevo | Escape de HTML, corte a 4096 por párrafo, limpieza del markdown del modelo |
| `src/egress/outbox.ts` | nuevo | `enqueue()`: una fila en `outbound_queue` |
| `src/egress/drain.ts` | nuevo | Loop de drenado con rate limits y manejo de errores |
| `src/handlers/start.ts` | editado | Encola en vez de enviar directo |
| `src/index.ts` | editado | Arranca el loop de drenado |

## Rate limits

```ts
const PER_CHAT_MIN_GAP_MS = 1100;   // ~1 msg/s por chat
const GLOBAL_MAX_PER_SEC   = 25;    // margen bajo el límite de 30/s
```

En grupos el límite es **~20/minuto**, no 1/segundo. Importa en la spec 13.

## Manejo de errores

Cada código tiene una respuesta distinta, y **todas pasan en producción**:

| Código | Qué hacemos |
|---|---|
| `429` | Respetar `parameters.retry_after` **sin excepción**, +1 s de margen |
| `403 blocked/deactivated` | `contacts.is_blocked = true`, cancelar recordatorios, marcar `skipped`. **Dejar de insistir** |
| `400 can't parse entities` | Reintentar **sin** `parse_mode` |
| `400 message is too long` | Trocear y reencolar |
| otros, `attempts >= 5` | `failed` |
| otros | Backoff exponencial `2 ** attempts` |

El `403` es el **único límite real de proactividad** en Telegram, porque no hay ventana de 24 h.

## Formato

- **4096 chars** máximo. Cortar **por párrafo**, nunca a mitad de palabra.
- **`parse_mode: "HTML"`** con `&`, `<` y `>` escapados. Sin escapar, un `<` suelto tumba el envío con `400`. El fallback a texto plano **no es paranoia, es una ruta que se usa**.
- Quitar el markdown que el modelo mete por costumbre (`**`, `#`, bloques de código).
- **1 o 2 mensajes por respuesta, nunca más.** Trocear en seis burbujas no es "humano", es ruido.

## Terminada cuando

- [ ] `/start` responde y **pasó por la cola**
      ```sql
      select status, attempts, tg_message_id from outbound_queue
       order by created_at desc limit 1;   -- sent, 0, <id>
      ```
- [ ] **Un `<` no rompe el envío.** Encola `"precio < 100.000"` → llega bien
- [ ] **Corte a 4096**: encola 5.000 caracteres → llegan **2** mensajes, cortados por párrafo
- [ ] **`403`**: simúlalo (bloquea el bot desde tu cuenta y manda un mensaje)
      ```sql
      select is_blocked from contacts where tg_chat_id = <tu id>;  -- true
      select status from outbound_queue order by created_at desc limit 1;  -- skipped
      ```
      y verifica que **no sigue reintentando**
- [ ] **`429`**: con el código forzado a 429 y `retry_after: 3`, la fila se reprograma ~3 s, no se reintenta de inmediato
- [ ] Dos mensajes seguidos al mismo chat salen con **≥1.1 s** de separación
- [ ] Un fallo a los 5 intentos queda `failed` con el `error` guardado
- [ ] Se registra `send_error` en `events` cuando falla
- [ ] `scripts/smoke/04.sh` sale con código 0

## Trampas

- El loop de drenado debe sobrevivir a un error de una fila **sin morir**. Un `try/catch` por fila, no por tanda.
- No drenes en paralelo sin control: el límite por chat es secuencial.
- `markSkipped` ≠ `markFailed`. Un bloqueo no es un fallo que haya que reintentar.
- Al reiniciar el proceso, las filas en `pending` se retoman solas. No hace falta estado en memoria.

## Referencias

- Blueprint §4.6 (salida), §6.2 (límites de Telegram), §15 (gotchas)
- `../../knowledge/wiki/Salida-y-Outbox.md`
- `../../knowledge/wiki/Performance-y-Limites.md`
