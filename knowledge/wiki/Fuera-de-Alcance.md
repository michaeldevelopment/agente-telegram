---
titulo: Fuera de alcance
tipo: operacion
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §16"
actualizado: 2026-10-22
tags: [alcance, decisiones, roadmap-futuro]
---

# Fuera de alcance

Decidido explícitamente. **Documentado para que no se cuele por la puerta de atrás.**

Cada fila dice también **cuándo entraría** y con qué hook, para que aplazar no signifique cerrar la puerta.

| Qué | Por qué | Cuándo entraría |
|---|---|---|
| **Transcripción de notas de voz** | DeepSeek no transcribe; sumar Groq u OpenAI añade una API y un costo a una demo que no lo necesita | Cuando un cliente real lo pida. **El hook está**: `msg_kind = 'voice'` ya existe, y `getFile` + STT se enchufa antes del buffer devolviendo texto. Groq `whisper-large-v3-turbo` (~$0.04/hora) es la opción por precio y latencia |
| **Imágenes y documentos** | No es necesario para agendar, y `deepseek-flash` ya tiene **visión nativa** cuando se quiera activar | Cuando el cliente quiera recibir radiografías o fotos |
| **Panel web / inbox** | El handoff dentro de Telegram cubre la operación con **cero frontend** | Cuando haya 3+ clientes y el equipo necesite ver varias conversaciones a la vez. Ahí se activa **RLS** y se reusa el inbox del otro proyecto |
| **RAG con pgvector** | El contenido de la clínica son ~700 tokens: el prompt estático con cache es más barato y más fiable | Cuando el contenido estable de un cliente pase de **~3.000 tokens** |
| **Pagos / pasarela** | El agendador no cobra | Con el primer cliente de e-commerce. Ver [[Tipo-Ecommerce-Closer]] |
| **Sincronización con CRM (HighLevel)** | Nadie lo pidió y añade OAuth con tokens rotativos | Cuando un cliente ya use HighLevel. El blueprint original tiene los shapes listos |
| **WhatsApp** | Este producto es Telegram. El canal de WhatsApp es el otro proyecto | Cuando el cliente valide la demo y quiera producción. El blueprint de WhatsApp ya cubre YCloud, la ventana de 24 h y los templates |
| **Multi-idioma** | El cliente es colombiano | Si llega un cliente que lo necesite. **`contacts.language_code` ya se guarda** |

## Los hooks que ya están puestos

Lo que diferencia "fuera de alcance" de "no previsto". Cuatro cosas ya existen en el esquema y no requieren migración para activarse:

1. **`msg_kind = 'voice'`** en el enum — la transcripción se enchufa antes del buffer.
2. **`contacts.language_code`** — el multi-idioma no empieza de cero.
3. **Visión nativa de `deepseek-flash`** — imágenes sin cambiar de modelo.
4. **El patrón RLS del blueprint original** — el panel web tiene el camino escrito.

## Decisiones que NO están fuera de alcance, están descartadas

Distinto caso: estas no van a volver.

- **Clasificador LLM separado.** Tenía sentido con un modelo de respuesta caro. Con `deepseek-flash` duplica llamadas y prefijo para nada. Volvería solo con decenas de miles de turnos/mes **y** >30% de chitchat medido. Ver [[Motor-de-Decision]].
- **OpenRouter como gateway.** Con un modelo y un cliente, añade un salto de red y un margen sin aportar. Ver [[Decisiones-Fijas]].
- **Templates y ventana de 24 h.** No existen en Telegram. Se eliminaron tablas y funciones enteras. Ver [[Telegram-vs-WhatsApp]].

## Por qué esta página importa

El riesgo de una demo no es que falte funcionalidad, es que se añada. Cada una de las filas de arriba suena razonable por separado, y cualquiera de ellas convierte 5 días de trabajo en tres semanas.

Si alguien propone algo de esta lista, la respuesta es la columna **"cuándo entraría"**, no un no.

## Relacionado

- [[Decisiones-Fijas]] — lo que sí está decidido
- [[Roadmap-por-Fases]] — los 5 días que sí
- [[Tipo-Ecommerce-Closer]] — a dónde van pagos y catálogo
- [[Economia-de-Tokens]] — el umbral de RAG
