# Spec 02 · Carga del cliente y prompt

**Depende de:** 01 · **Entorno:** local · **~55 min**

## Qué construye

Mete los datos de la Clínica Dr. Fabián González en la base y genera el **bloque estático del system prompt**. Al terminar, la base sabe todo del negocio y hay un prompt listo para usar.

Lo delicado no es el seed: es el **renderer**, que tiene que producir **los mismos bytes siempre**. Si el texto cambia entre ejecuciones, el cache de prefijo de DeepSeek se pierde y el costo se multiplica por 10 sin que nada falle visiblemente.

## Archivos

| Archivo | | Qué va dentro |
|---|---|---|
| `data/business-info.json` | nuevo | Snapshot de `../../knowledge/wiki/Clinica-Gonzalez-business-info.json` |
| `data/services.csv` | nuevo | Snapshot de `../../knowledge/wiki/Clinica-Gonzalez-services.csv` |
| `data/system-prompt.md` | nuevo | El prompt del §9.3, **con las variables ya resueltas** |
| `src/kb/render.ts` | nuevo | JSON estructurado → texto plano determinista + hash |
| `scripts/seed.ts` | nuevo | Carga workspace, services, business_hours, closures, business_info, agent_prompts |

## Por qué un snapshot en `data/`

El vault vive en `../../knowledge/`, que queda **fuera** del repo cuando hagas `git init` en `backend/`. Railway no lo vería.

Regla: **el vault sigue siendo la fuente de verdad**, y `data/` es una copia versionada que viaja con el deploy. El seed lee de `data/`. Cuando cambie el vault, se re-copia a mano — un solo comando, documentado en el README.

> Borra `backend/2026-10-22-datos-cliente-dr-gonzalez.md`: es un duplicado de `../../knowledge/raw/`. Dos copias de una fuente declarada inmutable van a divergir.

## El renderer: byte-estable o no sirve

`business_info.rendered` es lo que entra al prompt cacheado. Reglas no negociables:

1. **Orden fijo** de secciones y de claves. Nada de iterar un objeto sin ordenar.
2. **Formato de número fijo** para los precios. `120000` → `$120.000` siempre igual.
3. **Saltos de línea `\n`**, nunca `\r\n`. En Windows esto muerde.
4. **Sin fecha, sin hora, sin nada volátil.** Si el render incluye "generado el...", se pierde el cache en cada ejecución.
5. El hash es `sha256` del texto final, guardado en `business_info.rendered_hash`.

**La guarda:** si el texto renderizado contiene `<<EDITAR>>`, el script **aborta con código ≠ 0**. Un placeholder que llegue al prompt lo lee un paciente.

Los `#dato-ficticio` **sí pasan** — son valores plausibles y la demo los necesita — pero el script los cuenta y los reporta al terminar:

```
✓ rendered: 2.847 bytes, hash a3f1c8...
⚠ 20 valores ficticios incluidos (ver ../knowledge/wiki/Clinica-Gonzalez-Pendientes.md)
```

## El prompt se guarda ya resuelto

`data/system-prompt.md` no lleva `{{NOMBRE_CLÍNICA}}` ni `{{CIUDAD}}`. Van sustituidos en el texto.

Solo `{{BUSINESS_INFO_RENDERED}}` se reemplaza en el seed, con la salida del renderer. El resultado va a `agent_prompts.body` con `is_active = true`.

> Resolver variables **al guardar** = cache hit. Resolverlas **en cada petición** = cache miss y 10× de costo. Esa es toda la diferencia.

**Decisión pendiente que te toca:** el nombre del negocio. Google Maps dice "Fabián González Odontología"; el prompt usa el nombre largo. Elige uno antes de correr el seed.

## Horario: sin almuerzo

`business_hours` queda L–V 8:00–18:00 **corrido** (sin `break_from`/`break_to`) y sábado 8:00–12:00. Es lo que dio el cliente, tomado literal.

`weekday`: **0 = domingo**. Luxon numera 1=lunes…7=domingo, así que la conversión es `d.weekday % 7`. Equivocarse desplaza todo el horario un día.

## Terminada cuando

- [ ] Los datos están cargados
      ```sql
      select count(*) from services;        -- 13
      select count(*) from business_hours;  -- 6  (lun-sáb)
      select slug from workspaces;          -- clinica-gonzalez
      ```
- [ ] **El render es determinista**
      ```
      $ npm run seed -- --render-only > /tmp/a.txt
      $ npm run seed -- --render-only > /tmp/b.txt
      $ diff /tmp/a.txt /tmp/b.txt && echo IDENTICOS
      IDENTICOS
      ```
- [ ] El hash guardado coincide con el `sha256` del texto en la base
- [ ] **La guarda funciona**: mete un `<<EDITAR>>` a mano en `data/business-info.json`, corre el seed → **sale con código ≠ 0** y no escribe nada
- [ ] Hay exactamente un prompt activo
      ```sql
      select count(*) from agent_prompts where is_active;  -- 1
      ```
- [ ] El `body` del prompt **no contiene** `{{`
- [ ] El `rendered` pesa menos de ~3.000 tokens (si lo supera, hay que replantear RAG)
- [ ] `scripts/smoke/02.sh` sale con código 0

## Trampas

- Re-ejecutar el seed debe ser **idempotente**: `on conflict do update`, no duplicar servicios.
- El precio de `valoracion` es **0, no null**: es gratis, y eso es un dato, no un hueco.
- Si cambias el `rendered`, el primer turno siguiente paga cache miss completo. Es normal — por eso los cambios se agrupan.

## Referencias

- Blueprint §9.1–9.3 (datos del cliente), §5 regla 2 (cache)
- `../../knowledge/wiki/Clinica-Gonzalez-Servicios.md`, `-Business-Info.md`, `-System-Prompt.md`
- `../../knowledge/wiki/Cache-de-Prefijo.md`
- `../memoria/valoracion-gratuita.md`, `../memoria/datos-ficticios-autorizados.md`, `../memoria/nombre-del-negocio-sin-decidir.md`
