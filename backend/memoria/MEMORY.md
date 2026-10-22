# MEMORY

Índice de la memoria del proyecto. **24 archivos.** Un archivo, un dato o una decisión, con su porqué.

Se lee entero antes de trabajar: es corto a propósito. Para el detalle de cualquier entrada, sigue el enlace al wiki que lleva dentro.

Cómo se mantiene: `../CLAUDE.md`. El negocio y el vocabulario del cliente: `../CONTEXTO.md`.

---

## 🦷 `cliente` — hechos confirmados por el Dr. González

- [Contacto de la clínica](contacto-clinica.md) — +57 322 236 3192, el mismo WhatsApp. El dato más crítico: es lo que el agente entrega ante una urgencia.
- [Dirección de la clínica](direccion-clinica.md) — Av 3A # 24, Santo Domingo, Cúcuta, con coordenadas.
- [Horario de atención](horario-atencion.md) — L–V 8–18 corrido, sábado 8–12. Alimenta `business_hours` y por tanto los slots.
- [Valoración gratuita](valoracion-gratuita.md) — no tiene costo, y es la principal herramienta de conversión del agente.
- [Sedación y niños](sedacion-y-ninos.md) — sí a ambos. Dos de las preguntas más frecuentes de un paciente nuevo.
- [Catálogo de 13 servicios](catalogo-13-servicios.md) — de todos los precios, solo el de la valoración es real.

## ⏳ `abierta` — decisiones sin cerrar

- [Nombre del negocio sin decidir](nombre-del-negocio-sin-decidir.md) — Google Maps dice "Fabian Gonzalez Odontología"; el vault usa el nombre largo. Es lo primero que lee el paciente.
- [Almuerzo sin confirmar](almuerzo-sin-confirmar.md) — el horario se cargó corrido. Si la clínica cierra a mediodía, el bot ofrecerá una cita a la 1 p. m. delante del dueño.

## 🚫 `regla` — restricciones que no se negocian

- [Datos ficticios autorizados](datos-ficticios-autorizados.md) — el usuario autorizó inventar para este cliente. Las dos marcas: `<<EDITAR>>` vs `#dato-ficticio`.
- [Nunca inventar nombres de personas](nunca-inventar-nombres-de-personas.md) — la excepción permanente a lo anterior.
- [Ningún secreto en el vault](ningun-secreto-en-el-vault.md) — qué existe y dónde vive, nunca el valor.
- [Precios siempre "desde"](precios-siempre-desde.md) — nunca un precio cerrado. Con precios ficticios cargados, es la red de seguridad de la demo.
- [Nunca diagnosticar ni recetar](nunca-diagnosticar-ni-recetar.md) — tres capas de guardrail, y solo una depende del modelo.
- [Cliente es datos, no lógica](cliente-es-datos-no-logica.md) — añadir un cliente es cero código.

## ⚖️ `decision` — producto

- [Canal Telegram para la demo](canal-telegram-para-la-demo.md) — por velocidad de montaje. WhatsApp es producción, y **la objeción predecible en la reunión**.
- [Tipo appointment_setter](tipo-appointment-setter.md) — tipo 1, 7 tools, objetivo cita confirmada.
- [Caries no es servicio agendable](caries-no-es-servicio-agendable.md) — es motivo de consulta; va a valoración.
- [Bot con teléfono personal](bot-con-telefono-personal.md) — el bot no se registra con el número de la clínica.
- [Handoff dentro de Telegram](handoff-dentro-de-telegram.md) — grupo interno, relay bidireccional, cero frontend.

## 💸 `decision` — técnicas caras de equivocar

- [Thinking mode apagado](thinking-mode-apagado.md) — **17× en costo**, y viene encendido de fábrica.
- [Volátiles al final del prompt](volatiles-al-final-del-prompt.md) — **10× en costo**. Un cache hit vale 50 veces menos que un miss.
- [Sin clasificador LLM](sin-clasificador-llm.md) — una llamada por turno, no dos.
- [Una sola réplica en Railway](una-sola-replica-railway.md) — el debounce en memoria lo exige.
- [Service Account sin attendees](service-account-sin-attendees.md) — límite de las SA desde mar-2020, y los dos errores de configuración más comunes.

---

## Taxonomía

| `type` | Qué guarda | Cuándo cambia |
|---|---|---|
| `cliente` | Hecho confirmado por el Dr. González | Si el cliente lo corrige |
| `abierta` | Decisión pendiente que bloquea algo | Al cerrarse pasa a `decision` o `cliente` |
| `regla` | Restricción sobre cómo se trabaja | Solo si el usuario la revoca explícitamente |
| `decision` | Elección hecha, con su porqué y su umbral de revisión | Si cambia el supuesto que la sostenía |

**Los 4 tipos no son decorativos.** Un `abierta` es trabajo pendiente; un `regla` es algo que no puedes saltarte aunque parezca razonable; un `decision` lleva dentro cuándo reconsiderarlo.
