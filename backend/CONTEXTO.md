# CONTEXTO

El negocio, en una lectura. Si solo vas a leer un archivo antes de trabajar, lee este.

---

## Qué es

Un **agente conversacional en Telegram** que atiende pacientes de una clínica odontológica: responde dudas sobre servicios y precios, consulta la agenda real, y **agenda, reprograma o cancela citas** en Google Calendar. Cuando hace falta una persona, escala a un grupo interno de Telegram donde el equipo de la clínica toma la conversación.

Es **multi-cliente por diseño**: añadir una clínica nueva es una fila en `workspaces` y sus datos. Cero código.

**Estado actual:** demo para vender. No es producción.

## Para quién

Hay tres actores y conviene no confundirlos:

| Actor | Quién es | Qué quiere |
|---|---|---|
| **El cliente** | Dr. Fabián González, odontólogo, Cúcuta | Más citas, menos no-shows, no perder pacientes que escriben fuera de horario |
| **El usuario** | El paciente que escribe al bot | Saber cuánto cuesta y conseguir una cita sin llamar por teléfono |
| **El operador** | El equipo de la clínica | Enterarse cuando el bot escala, y poder responder sin aprender una herramienta nueva |

**El usuario real es el paciente, no el doctor.** Casi todo el vault habla del cliente; el paciente es quien decide si esto funciona.

## Qué problema resuelve

1. **El teléfono que nadie contesta.** Un consultorio pequeño no tiene recepcionista dedicada. Las llamadas se pierden mientras se atiende en el box.
2. **El paciente que escribe a las 9 p. m.** Nadie responde hasta el día siguiente, y para entonces ya llamó a otra clínica.
3. **El no-show.** Una silla vacía es dinero perdido. Los recordatorios a 24 h y 2 h lo atacan directamente.
4. **La pregunta del precio, mil veces.** "¿Cuánto vale una limpieza?" consume el día de alguien. El bot la responde con el catálogo cargado y redirige a la **valoración gratuita**.

## Qué NO va a hacer

Explícito para que no se cuele por la puerta de atrás:

- **No diagnostica.** Nunca dice qué tiene el paciente ni si algo es grave.
- **No receta.** Ni medicamentos, ni dosis, ni remedios caseros.
- **No da precios finales.** Todo es "desde"; el real se define en la valoración.
- **No inventa.** Si un dato no está cargado, lo dice y ofrece conectar con la clínica.
- **No registra historia clínica.** Alergias, antecedentes y medicación los toma el profesional.
- **No atiende urgencias.** Las detecta y escala de inmediato con el teléfono de la clínica.
- **No transcribe notas de voz**, no procesa imágenes, no cobra, no tiene panel web, y **no está en WhatsApp**. Ver `../knowledge/wiki/Fuera-de-Alcance.md`.

## Vocabulario del cliente

Lo que dice un odontólogo colombiano y lo que dice su paciente **no es lo mismo**. El bot tiene que entender las dos columnas y responder en la primera.

### Servicios: término clínico ↔ cómo lo pide el paciente

| Clínico | El paciente dice |
|---|---|
| Valoración | "una revisión", "que me miren", "una cita de una vez" |
| Profilaxis / limpieza dental | "limpieza", "lavado de dientes", "destartraje" |
| Resina / obturación | "calza", "tapar la muela", "arreglar una picadura" |
| Caries | **"picadura"**, "diente picado", "me salió un hueco" |
| Carilla | "carilla", "funda" (⚠️ *funda* también significa corona) |
| Corona | "funda", "muñón" |
| Ortodoncia | "brackets", "frenos", "aparatos", "enderezar los dientes" |
| Alineadores | "ortodoncia invisible", "los transparentes" |
| Endodoncia | **"tratamiento de conducto"**, "matar el nervio" |
| Exodoncia | "sacar la muela", "que me la saquen" |
| Cordales | **"muelas del juicio"**, "las del juicio" |
| Blanqueamiento | "blanqueamiento", "aclarar los dientes" |
| Absceso | **"nacido"**, "un bulto", "se me hinchó" |
| Gingivitis | "me sangran las encías" |

### Términos de urgencia — lenguaje real, no clínico

La lista de `isClinicalUrgency()` tiene que cubrir **cómo habla la gente en Cúcuta**, no terminología:

> "me está matando", "no aguanto el dolor", "se me partió un diente", "me sangra y no para", "se me hinchó la cara", "tengo un nacido", "no puedo abrir la boca", "me dieron un golpe", "se me cayó la calza", "tengo fiebre y me duele la muela"

Falso positivo = escalada de más, molesto pero recuperable. **Falso negativo en salud = inaceptable.** Por eso la lista es generosa.

### Administrativo y de pago

| Término | Qué es |
|---|---|
| **EPS** | Entidad Promotora de Salud. El seguro público. Esta clínica es **particular** |
| **Prepagada** | Medicina prepagada privada (Colsanitas, Sura, Colmédica) |
| **Particular** | Paga el paciente de su bolsillo. Es el caso de esta clínica |
| **Nequi / Daviplata** | Billeteras móviles. En Colombia son medio de pago cotidiano, no exóticas |
| **Cuota moderadora / copago** | Lo que cobra la EPS. **No aplica aquí** |
| "Cita" | El paciente dice "cita", no "turno" ni "reserva" |

### Tono

Español colombiano, cálido y profesional. **Tuteo** salvo que el paciente use "usted" — en Cúcuta el "usted" es frecuente incluso en confianza, así que hay que seguirle. Sin emojis decorativos, 2 a 4 líneas, **una sola pregunta por mensaje**.

---

## Dónde está todo

| Qué buscas | Dónde |
|---|---|
| Decisiones atómicas y su porqué | `memoria/MEMORY.md` |
| Cómo se mantiene la memoria | `CLAUDE.md` (de esta carpeta) |
| Diseño técnico completo | `../knowledge/raw/00-BLUEPRINT-agente-telegram.md` |
| Síntesis navegable | `../knowledge/index.md` → `../knowledge/wiki/` |
| Historial del proyecto | `../knowledge/log.md` |
| Cómo trabajar en el vault | `../CLAUDE.md` (raíz) |
