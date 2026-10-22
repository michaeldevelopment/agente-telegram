# Log

Registro cronológico del vault. Lo nuevo arriba. Formato de cabecera: `## [AAAA-MM-DD] tipo | título`.

Tipos: `ingest` · `query` · `lint` · `decision` · `setup`.

`grep "^## \[" log.md | head -10` da lo reciente.

---

## [2026-10-22] setup | Reestructura: backend/ + knowledge/

- **Dos carpetas de primer nivel.** `backend/` (código del agente + su contexto) y `knowledge/` (vault de Obsidian: `raw/`, `wiki/`, `index.md`, `log.md`). `CLAUDE.md` queda en la raíz como router.
- **`.obsidian/` se movió dentro de `knowledge/`**, así que el vault es ahora exactamente esa carpeta: hay que abrir `knowledge/` en Obsidian, no la raíz del proyecto. Si prefieres ver también `backend/memoria/` en el grafo, basta con devolver `.obsidian/` a la raíz.
- **La capa de contexto vive en `backend/`**, no en el vault: `CONTEXTO.md`, `memoria/` (25 archivos) y su propio `CLAUDE.md`. Es lo que Claude Code necesita al escribir código, así que acompaña al código. Queda fuera del grafo de Obsidian a cambio de eso.
- **`info-repo/` ya no existe.** Las entradas anteriores del log que la mencionan quedan como registro histórico: eran ciertas cuando se escribieron.
- **Rutas arregladas:** las referencias de `backend/` al vault pasan a `../knowledge/...` (y `../../knowledge/...` desde `memoria/`); las de `knowledge/index.md` a la capa de contexto pasan a `../backend/...`.
- **`CLAUDE.md` de la raíz reescrito** como router entre las dos carpetas, con una tabla de **ruteo de consultas por nivel de costo** (memoria → index → grep del grafo → raw) y la nota de que los `[[wikilinks]]` son aristas greppables: backlinks por ~80 tokens en vez de leer archivos.
- **Pendiente conocido:** `backend/` tiene copias de `00-BLUEPRINT-agente-telegram.md` y `2026-10-22-datos-cliente-dr-gonzalez.md` que también están en `knowledge/raw/`. Dos copias de una fuente inmutable van a divergir; hay que borrar una cuando se decida cuál manda.

## [2026-10-22] setup | Sistema de contexto y memoria en info-repo/

- **Capa nueva**, pensada para que un agente pueda arrancar en frío sin leerse las 24 páginas del wiki: `info-repo/CONTEXTO.md` (el negocio) + `info-repo/memoria/` (24 archivos atómicos) + `info-repo/memoria/MEMORY.md` (índice).
- **Dos `CLAUDE.md` con trabajos que no se solapan.** El de la raíz gobierna el vault (capas, convenciones de página, flujos ingest/query/lint) y bajó de **172 a 88 líneas**. El de `info-repo/` gobierna la memoria (formato, taxonomía, cuándo crear vs. actualizar) y concentra las **6 reglas duras del dominio**, que antes estaban en la raíz.
- **La regla que sostiene el diseño:** `memoria/` guarda el **hecho atómico y el porqué**; `wiki/` guarda el **detalle**. Sin esa separación, las dos capas se contradicen en semanas. Está escrita en los dos `CLAUDE.md` y en `index.md`.
- **Taxonomía de 4 tipos**, no decorativa: `cliente` (6, confirmados por el Dr. González), `abierta` (2, trabajo pendiente), `regla` (6, no te las puedes saltar aunque parezca razonable), `decision` (10, cada una con su umbral de revisión).
- **Se incluyeron las decisiones técnicas caras de olvidar**, no solo los datos del cliente: thinking apagado (17× en costo), volátiles al final del prompt (10×), sin clasificador LLM, una sola réplica, SA sin attendees. Un agente en frío no se entera de estas leyendo solo el cliente.
- **Lo más valioso que no existía en ningún sitio:** el **vocabulario del cliente** en `CONTEXTO.md` — la tabla de término clínico ↔ cómo lo dice el paciente ("picadura" = caries, "nacido" = absceso, "funda" = carilla *o* corona), y los términos de urgencia en lenguaje real de Cúcuta. Es insumo directo para `isClinicalUrgency()`.
- **Registrado como pregunta de negocio sin responder** en `handoff-dentro-de-telegram`: quién mira el grupo interno a las 7 p. m. en un consultorio de un odontólogo y una auxiliar.
- Los 10 archivos de memoria creados antes del modo plan se movieron de la raíz a `info-repo/memoria/`.

## [2026-10-22] ingest | Datos del cliente Dr. González + autorización de datos ficticios

- **Fuente:** `raw/2026-10-22-datos-cliente-dr-gonzalez.md`, creada desde lo que el usuario pegó en chat.
- **Datos reales cargados:** teléfono/WhatsApp **+57 322 236 3192**, dirección (Av 3A # 24, Santo Domingo, Cúcuta) con coordenadas, horario (L–V 8–18 corrido, sáb 8–12), **valoración gratuita**, manejan sedación, atienden niños. Guardrail validado por el cliente: *"que el bot nunca diagnostique ni dé precios finales"*.
- **Cambio de política del vault.** El usuario autorizó rellenar con datos ficticios aproximados todo lo no entregado, revirtiendo la decisión del ingest anterior. **Se actualizó la regla 2 de `CLAUDE.md`** para que una sesión futura no borre los precios por seguir la regla vieja. Convención nueva: `<<EDITAR>>` (hueco visible) vs. `#dato-ficticio` (valor falso invisible, con rastro obligatorio).
- **Excepción añadida a la regla:** **nunca inventar nombres de personas**, ni con autorización. Un odontólogo inexistente presentado a un paciente real no es comparable a un precio aproximado. El segundo profesional quedó `<<EDITAR>>`.
- **~20 datos ficticios generados:** los 12 precios restantes (mercado de Cúcuta, gama media), duración de `carillas`, medios de pago, financiación, convenios EPS, políticas de cancelación y tardanza, 3 FAQs, especialidad del doctor. Todos con rastro en `_ficticio` (JSON), columna `ficticio` (CSV) y columna "Origen" (tabla markdown).
- **Hallazgo del link de Maps:** el negocio está registrado como **"Fabian Gonzalez Odontología"**, no como "Clínica Odontológica Dr. Fabián González". Ambos quedan en el JSON; **decisión abierta** sobre cuál va en el prompt.
- **Decisión sobre el almuerzo:** el cliente dio 8–18 corrido sin mencionar descanso. Se tomó **literal** (jornada continua) en vez de inventar una restricción. Marcado como decisión abierta porque afecta directamente a los slots que ofrece el agente.
- **Sección nueva en el system prompt:** "La valoración es gratuita". No viene del blueprint; resuelve la tensión entre la regla de no dar precios finales y la frustración del paciente que quiere saber cuánto va a pagar.
- **Páginas tocadas: 9** — `CLAUDE.md`, `index.md`, ficha del cliente, servicios, business-info (md + json), services.csv, system prompt, guion de demo, pendientes.
- **Estado:** 0 páginas bloqueadas (antes 3). La demo ya no depende de datos del cliente.

## [2026-10-22] ingest | Blueprint agente Telegram — base técnica completa

- **Fuente:** `raw/00-BLUEPRINT-agente-telegram.md` (1.972 líneas, 16 secciones). Movido de la raíz a `raw/` al crear la estructura. Nodo raíz del vault.
- **Páginas creadas: 24.** Las 16 secciones del blueprint se explotaron en páginas planas, separando en nota propia tres conceptos que el blueprint tenía anidados pero que se citan desde todas partes: [[Cache-de-Prefijo]] (§5 regla 2), [[Calculo-de-Slots]] (§8.3) y [[Guardrails-Clinicos]] (§9.4).
- **Página derivada, sin sección equivalente:** [[Checklist-de-Onboarding]], construida a partir de §8.1 + §10.1 + §12. El blueprint la mencionaba en su estructura sugerida de vault pero no la desarrollaba.
- **Pendiente de ingestar:** las fuentes adicionales que el usuario anunció.

## [2026-10-22] setup | Estructura del vault y CLAUDE.md

- **Decidido con el usuario** (4 preguntas antes de construir):
  1. **Estructura:** `raw/` (fuentes inmutables) + `wiki/` **plano** + `CLAUDE.md`/`index.md`/`log.md` en la raíz. Se descartó la estructura con subcarpetas de §10.3 a favor de la vista de grafo de Obsidian.
  2. **Alcance:** andamiaje **más** ingest completo del blueprint en la misma pasada.
  3. **Datos del cliente:** mantener `<<EDITAR>>` y construir lista de pendientes. **No inventar** precios, direcciones ni teléfonos.
  4. **Nombre del cliente:** "Clínica Odontológica Dr. Fabián González", slug `clinica-gonzalez`.
- **`CLAUDE.md` creado** con el esquema: tres capas, convenciones de página y frontmatter, 7 reglas duras de dominio, y los flujos de `ingest` / `query` / `lint`.
- **Excepción a la carpeta plana:** los artefactos cargables (`*.json`, `*.csv`) viven en `wiki/` junto a las páginas, no en subcarpeta. Documentado en `CLAUDE.md`.

## [2026-10-22] decision | Cliente piloto: Clínica Odontológica Dr. Fabián González

- **Brief del usuario:** clínica odontológica en **Cúcuta**, Norte de Santander, Colombia. Odontólogo: **Dr. Fabián González**. Servicios mencionados: odontología, limpieza dental, alineamiento de dientes, caries, resinas, carillas.
- **Tipo de agente: `appointment_setter`** (tipo 1 del blueprint §10.2). Objetivo: cita confirmada en Google Calendar.
- **Divergencias registradas respecto al catálogo del blueprint §9.1:**
  - **`carillas` añadido** al catálogo (13 servicios en total). No estaba en el blueprint y el brief lo pide. Duración y buffer quedan `<<EDITAR>>`: no hay fuente para ese dato.
  - **"Caries" no se modeló como servicio.** Es un motivo de consulta, no algo agendable: el paciente que lo menciona debe terminar en `valoracion`, porque el agente no puede diagnosticar. Documentado en [[Clinica-Gonzalez-Servicios]] y respaldado por la regla 1 del prompt.
  - **El horario del blueprint se conservó con su procedencia marcada** (`_origen` en el JSON) en vez de borrarlo a `<<EDITAR>>`: viene de una fuente real, pero **no del cliente**. Alimenta `business_hours` y por tanto los slots que ofrece el agente, así que está marcado como bloqueante en [[Clinica-Gonzalez-Pendientes]].
- **~25 datos pendientes** de confirmar con el cliente. 7 marcados como bloqueantes de la demo, entre ellos el **teléfono de la clínica** (sin él, la ruta de urgencia clínica del paso 10 del guion está rota).
- **Estado:** 3 páginas quedan `bloqueado` a la espera de esos datos. Es el camino crítico de la demo.
