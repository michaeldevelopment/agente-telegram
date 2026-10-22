# CLAUDE.md

Agente conversacional en Telegram para clínicas odontológicas. Multi-cliente, dos tipos de agente (`appointment_setter`, `ecommerce_closer`).

Cliente piloto: **Clínica Odontológica Dr. Fabián González**, Cúcuta, Colombia. Tipo 1. Es una **demo para vender**, no producción.

---

## Las dos carpetas

| | `backend/` | `knowledge/` |
|---|---|---|
| Qué es | El código del agente + su contexto | Vault de Obsidian: el diseño |
| Contiene | `src/`, `CONTEXTO.md`, `memoria/` | `raw/` (fuentes), `wiki/` (síntesis), `index.md`, `log.md` |
| Quién lo lee | Claude Code al programar · Railway al desplegar | Tú en Obsidian · Claude Code al consultar el diseño |
| Su propio `CLAUDE.md` | **Sí** → `backend/CLAUDE.md` | No, este |

**Si vas a escribir código**, el que manda es `backend/CLAUDE.md`. Lee primero `backend/CONTEXTO.md` y `backend/memoria/MEMORY.md`: son cortos y contienen lo que no se deduce leyendo el repo.

**Si vas a consultar o mantener el diseño**, sigue este archivo.

Las **reglas duras del dominio** (secretos, datos ficticios, salud, cliente = datos) están en `backend/CLAUDE.md`. No las repito aquí.

## Ruteo de consultas — de más barato a más caro

No subas de nivel si el anterior responde:

| Nivel | Dónde | Responde |
|---|---|---|
| 1 | `backend/memoria/MEMORY.md` | Hechos y decisiones. "¿Por qué Telegram?" "¿El teléfono?" |
| 2 | `knowledge/index.md` → 1-2 páginas | "¿Cómo funciona el buffer?" |
| 3 | Grep del grafo de wikilinks | "¿Qué se rompe si cambio el prompt?" |
| 4 | `knowledge/raw/` | Solo si el wiki no tiene el detalle |

Leer `knowledge/wiki/` entero son ~42.000 tokens y casi nunca hace falta. Los `[[wikilinks]]` son aristas de texto plano: `grep -l "\[\[X\]\]" knowledge/wiki/*.md` da los backlinks por ~80 tokens.

## El vault: tres capas

**`knowledge/raw/` — fuentes crudas. INMUTABLE.** Tal como llegaron. **Nunca edites un archivo de `raw/`**, ni para un typo: la corrección va en la página de `wiki/` que lo sintetiza, señalada como tal. Si el usuario pega contenido en el chat, **guárdalo primero** con nombre fechado: `raw/2026-10-22-llamada-dr-gonzalez.md`.

**`knowledge/wiki/` — síntesis. La escribes tú, entera.** Carpeta **plana**, sin subcarpetas. Los artefactos cargables a Supabase (`*.json`, `*.csv`) viven aquí también.

**`knowledge/index.md` y `log.md` — control.** Catálogo por contenido y registro cronológico.

## Convenciones de página

`Nombres-Con-Guion.md`, sin acentos en el nombre de archivo (sí en el `titulo` y los H1). Las del cliente llevan prefijo: `Clinica-Gonzalez-*.md`.

Frontmatter obligatorio en toda página de `wiki/`:

```yaml
---
titulo: Buffer y Batching
tipo: base          # base | tipo-agente | cliente | operacion | sintesis
estado: vigente     # vigente | borrador | obsoleto | bloqueado
fuente: "[[00-BLUEPRINT-agente-telegram]] §4.2"
actualizado: 2026-10-22
tags: [buffer, tokens]
---
```

Cuerpo: H1, un párrafo de **qué es y por qué importa** (nada de "esta página describe"), el contenido con la decisión primero, `## Gotchas` si los hay, `## Relacionado` con wikilinks.

Enlaza **generosamente**. Un `[[X]]` que no existe marca una página por escribir. Toda página necesita al menos un enlace entrante. La fuente cruda se cita con `§`.

## Flujos

**Ingest.** Lee la fuente completa → **conversa los hallazgos** antes de editar, sobre todo lo que **contradice** lo que ya hay → guarda la fuente en `raw/` si vino por chat → escribe las páginas afectadas (**una fuente toca 10–15**) → resuelve `<<EDITAR>>` y datos ficticios que aclare → **marca las contradicciones**, no las resuelvas en silencio → actualiza `backend/memoria/` si aparece un hecho o decisión nuevo → `index.md` → `log.md`.

**Query.** `index.md` primero, luego las páginas, y solo entonces `raw/`. Responde **con citas**. Si la respuesta vale más allá del chat, **ofrece archivarla** como `tipo: sintesis`. Si el vault no lo tiene, **dilo**.

**Lint.** Contradicciones · obsoletas · huérfanas · `[[X]]` citado desde 3+ páginas sin existir · `<<EDITAR>>` o `#dato-ficticio` sin rastro en pendientes · secretos filtrados · `estado: bloqueado` ya resuelto · memoria duplicando wiki. **Reporta primero, edita cuando el usuario confirme.**

## `index.md` y `log.md`

`index.md`: una línea por página con enlace y resumen, por categoría. Se actualiza **en el mismo turno** en que creas una página.

`log.md`: append-only, lo nuevo arriba, cabecera parseable `## [2026-10-22] ingest | Título`. Tipos: `ingest`, `query`, `lint`, `decision`, `setup`.

## Idioma y estilo

Todo en **español**. Los identificadores técnicos (`appointment_setter`, `buffer_ms`, `consultar_disponibilidad`) **tal cual**, nunca traducidos.

Escribe denso: decisión primero, justificación después, gotchas al final. Sin relleno.
