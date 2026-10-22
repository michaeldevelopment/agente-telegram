# Índice

Catálogo del **wiki**: 24 páginas + 2 archivos de datos. Las fuentes crudas y la capa de contexto están al final.

Proyecto: agentes conversacionales en Telegram, multi-cliente.
Cliente piloto: [[Cliente-Clinica-Gonzalez|Clínica Odontológica Dr. Fabián González]] — Cúcuta, Colombia. Tipo `appointment_setter`.

Las convenciones del vault están en `CLAUDE.md`. El historial, en `log.md`.

> **El vault tiene dos capas de conocimiento y no se solapan.** `../backend/memoria/` guarda el **hecho atómico y su porqué**, para cargar en frío. `wiki/` guarda el **detalle**. Si escribes algo en una y cabe en la otra, va en una sola.

---

## 🧭 Empezar por aquí

**Antes que nada, la capa de contexto** — es corta y se lee entera:

- `../backend/CONTEXTO.md` — el negocio: qué es, para quién, qué NO hará, y el **vocabulario del cliente** (cómo dice "caries" un paciente de Cúcuta).
- `../backend/memoria/MEMORY.md` — 24 hechos y decisiones atómicos, cada uno con su porqué.

Después, el wiki:

- [[Decisiones-Fijas]] — el stack y el porqué de cada elección. No se re-discuten.
- [[Arquitectura]] — las 6 etapas del flujo y los 3 roles del proceso.
- [[Cliente-Clinica-Gonzalez]] — ficha del cliente piloto.
- [[Roadmap-por-Fases]] — 5 días, 6 fases, con criterios de aceptación.

---

## ⚙️ Base — runtime

El camino de un mensaje, etapa por etapa.

- [[Ingress]] — webhook, autenticidad en dos capas, dedupe por `update_id`, ACK <100 ms.
- [[Buffer-y-Batching]] — agrupar por silencio del paciente. El diferenciador del producto.
- [[Motor-de-Decision]] — reglas duras a 0 tokens; por qué se eliminó el clasificador LLM.
- [[Agente-DeepSeek]] — modelo, thinking apagado, armado de mensajes, loop de tool-calling.
- [[Capa-de-Tools]] — las 7 tools del agendador y por qué `agendar_cita` es idempotente.
- [[Salida-y-Outbox]] — rate limits, reintentos, botones inline que ahorran llamadas.
- [[State-Machine-y-Handoff]] — los 6 estados y el inbox dentro de Telegram.
- [[Recordatorios-Programados]] — 24 h y 2 h antes, a coste cero de tokens.

## 🏗️ Base — fundamentos

- [[Esquema-de-Datos]] — 12 tablas y los 4 índices únicos que son garantías, no optimización.
- [[Telegram-vs-WhatsApp]] — tabla de traducción desde el blueprint original.
- [[Seguridad]] — superficie por superficie, prompt injection, PII, idempotencia.
- [[Guardrails-Clinicos]] — las 3 capas, y por qué solo una depende del modelo.

## 💰 Base — costo y límites

- [[Economia-de-Tokens]] — las 8 reglas. $1.70 vs. $140 por mil conversaciones.
- [[Cache-de-Prefijo]] — un hit cuesta 50× menos que un miss. La alarma #1 de costo.
- [[Performance-y-Limites]] — presupuesto de latencia y los techos de cada proveedor.
- [[Observabilidad]] — `events` es el panel. 3 vistas SQL y 8 KPIs con umbral.

## 📅 Base — agendamiento

- [[Google-Calendar]] — Service Account, `freeBusy`, evento con id determinista.
- [[Calculo-de-Slots]] — el motor que convierte horarios y ocupación en 4 opciones.

## 🤖 Tipos de agente

- [[Tipo-Appointment-Setter]] — tipo 1. Cita confirmada. **El del cliente actual.**
- [[Tipo-Ecommerce-Closer]] — tipo 2. Lead o venta. `borrador`, se cierra con el primer cliente.
- [[Multi-Cliente]] — qué es código compartido y qué es dato del cliente.

## 🦷 Cliente · Clínica Dr. Fabián González

- [[Cliente-Clinica-Gonzalez]] — la ficha. Contacto, dirección y horario **reales**.
- [[Clinica-Gonzalez-Servicios]] — 13 servicios. Valoración gratis; los 12 precios restantes son ficticios.
- [[Clinica-Gonzalez-Business-Info]] — sede, horarios, equipo, pagos, políticas, FAQs.
- [[Clinica-Gonzalez-System-Prompt]] — el bloque estático que va al cache.
- [[Clinica-Gonzalez-Guion-Demo]] — los 12 pasos, y los 3 que cierran la venta.
- [[Clinica-Gonzalez-Pendientes]] — **2 decisiones abiertas + ~20 datos ficticios a sustituir.**
- [[Clinica-Gonzalez-Credenciales]] — inventario de secretos. Qué y dónde, nunca el valor.

**Datos cargables:**

- `Clinica-Gonzalez-services.csv` → tabla `services`
- `Clinica-Gonzalez-business-info.json` → `business_info.structured`

## 🔧 Operación

- [[Roadmap-por-Fases]] — 6 fases con criterios de aceptación verificables.
- [[Checklist-de-Onboarding]] — dar de alta un cliente. Cero código.
- [[Variables-de-Entorno]] — la configuración completa, sin valores.
- [[Gotchas]] — checklist antes de cualquier deploy. Cada línea es un bug ya pagado.
- [[Fuera-de-Alcance]] — lo que se decidió **no** hacer, y cuándo entraría.

---

## 🧠 Capa de contexto · vive en `../backend/`

**Fuera del vault**, en el repo del backend, porque es lo que Claude Code necesita al escribir código. No aparece en el grafo de Obsidian — pero es lo primero que hay que leer.

- `../backend/CONTEXTO.md` — el negocio en una lectura: actores, problema, límites, **vocabulario clínico ↔ coloquial**.
- `../backend/memoria/MEMORY.md` — índice de los 24 archivos de memoria, agrupados en `cliente`, `abierta`, `regla` y `decision`.
- `../backend/CLAUDE.md` — cómo se mantiene la memoria y las 6 reglas duras del dominio.

---

## 📄 Fuentes crudas

- `raw/00-BLUEPRINT-agente-telegram.md` — base técnica, 16 secciones, 1.972 líneas. **Inmutable.** Nodo raíz del que deriva casi todo `wiki/`.
- `raw/2026-10-22-datos-cliente-dr-gonzalez.md` — datos entregados por el cliente: contacto, dirección, horario, valoración gratuita, sedación, niños.

---

## 🚦 Estado del vault

| Estado | Páginas |
|---|---|
| `vigente` | 23 |
| `borrador` | 1 — [[Tipo-Ecommerce-Closer]] |
| `bloqueado` | 0 |

**La demo ya no está bloqueada por datos.** Quedan 2 decisiones abiertas (el nombre del negocio y si la clínica cierra a mediodía) y ~20 datos ficticios marcados `#dato-ficticio`, que hay que sustituir antes de **producción**, no antes de la demo. Ver [[Clinica-Gonzalez-Pendientes]].
