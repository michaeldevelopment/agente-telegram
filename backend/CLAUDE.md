# CLAUDE.md — `backend/`

Gobierna esta carpeta: **el código del agente**, el contexto del negocio y el sistema de memoria. El `CLAUDE.md` de la raíz gobierna el vault de diseño en `../knowledge/`.

**Lee siempre `CONTEXTO.md` y `memoria/MEMORY.md` antes de escribir código aquí.** Juntos son cortos a propósito, y contienen lo que no se deduce leyendo el repo.

El diseño técnico completo (esquema de datos, runtime, tools, slots) está en `../knowledge/raw/00-BLUEPRINT-agente-telegram.md` y explotado por tema en `../knowledge/wiki/`. **No lo repitas aquí: enlázalo.**

---

## Qué hay aquí

| Archivo | Qué es |
|---|---|
| `CONTEXTO.md` | El negocio: qué es, para quién, qué problema resuelve, qué NO hará, y el vocabulario del cliente |
| `memoria/MEMORY.md` | Índice de la memoria. Una línea por archivo |
| `memoria/*.md` | Un archivo, un dato o una decisión, con su porqué |

## La regla anti-duplicación

Esta capa **no repite** `../knowledge/wiki/`. Si lo hace, las dos se contradicen en semanas y nadie sabe cuál manda.

> **`memoria/` guarda el hecho atómico y el porqué. `../knowledge/wiki/` guarda el detalle.**

Un archivo de memoria dice *"la valoración es gratis, y por eso es la salida de cualquier conversación atascada en el precio"*, y enlaza a `../knowledge/wiki/Clinica-Gonzalez-Servicios.md` para la tabla completa. No copia la tabla.

Si lo que vas a escribir solo se entiende leyendo tres párrafos, no es memoria: es una página de wiki.

## Formato de un archivo de memoria

```markdown
---
name: <slug-kebab, igual que el nombre del archivo sin .md>
description: <una línea; es lo que se lee para decidir si abrirlo>
metadata:
  type: cliente | abierta | regla | decision
---

<El hecho o la decisión, en una o dos frases. Primero y en negrita lo que importa.>

**Por qué:** <la razón. Es lo único que no se puede re-derivar leyendo el código o el wiki>
**Cómo aplicarlo:** <dónde aterriza, con la ruta al wiki para el detalle>

Relacionado: [[otro-archivo]]
```

Los 4 tipos y su semántica están en `memoria/MEMORY.md`. No inventes tipos nuevos sin actualizar esa tabla.

## Cuándo crear, actualizar o borrar

- **Crear** cuando aparece un hecho o una decisión que un agente en frío necesitaría y no puede deducir. Antes de crear, busca si ya hay un archivo que lo cubre.
- **Actualizar** el archivo existente en vez de crear uno parecido. Dos archivos sobre lo mismo es el fallo más común de este sistema.
- **Borrar** lo que resulte falso. Una memoria equivocada es peor que ninguna.
- Un `abierta` que se cierra **se reescribe** como `decision` o `cliente`, conservando el nombre si sigue describiéndolo.
- **Actualiza `memoria/MEMORY.md` en el mismo turno.** Un archivo que no está en el índice no existe.

Enlaza con `[[nombre]]` generosamente. Un enlace a algo que aún no existe no es un error: marca algo que vale la pena escribir.

## Reglas duras del dominio

Siempre cargadas. Cada una tiene su archivo con el porqué completo.

1. **Ningún secreto aquí.** Qué variable existe y dónde vive, nunca el valor. Si el usuario pega uno en el chat, no lo escribas a disco y avísale. → `memoria/ningun-secreto-en-el-vault.md`
2. **Dos marcas para lo no confirmado, y no se mezclan.** `<<EDITAR>>` = hueco sin rellenar, se ve si se cuela. `#dato-ficticio` = valor inventado con autorización, **no se ve**, y por eso el rastro es obligatorio. Autorización vigente solo para `clinica-gonzalez`. → `memoria/datos-ficticios-autorizados.md`
3. **Nunca inventes el nombre de una persona**, ni con esa autorización. → `memoria/nunca-inventar-nombres-de-personas.md`
4. **Es salud.** No diagnosticar, no recetar, no prometer, no dar precios finales. → `memoria/nunca-diagnosticar-ni-recetar.md`
5. **Cliente = datos, no lógica.** Si estás escribiendo una condición en algo del cliente, va al código compartido. → `memoria/cliente-es-datos-no-logica.md`
6. **Antes de tocar el prompt**, revisa qué le hace al cache de prefijo. → `memoria/volatiles-al-final-del-prompt.md`

## Idioma

Todo en español. Los identificadores técnicos (`appointment_setter`, `buffer_ms`, `consultar_disponibilidad`) se dejan tal cual, nunca se traducen.
