---
name: ningun-secreto-en-el-vault
description: El vault documenta qué secreto existe y dónde vive, nunca su valor
metadata:
  type: regla
---

**Ningún secreto se escribe en el vault.** Ni tokens, ni API keys, ni claves privadas, ni el `internal_secret`, ni la URL completa del webhook.

**Por qué:** un vault de Obsidian se sincroniza, se respalda y a veces se versiona. Un secreto escrito ahí ya salió de su sitio, aunque se borre después.

**Cómo aplicarlo:** `../../knowledge/wiki/Clinica-Gonzalez-Credenciales.md` documenta **qué variable existe, qué contiene y dónde vive** (Railway / Supabase / Google Cloud). Nunca el valor.

Si el usuario pega un secreto en el chat: no escribirlo a disco y avisarle. Si ya está en un archivo: borrarlo **y rotar ese secreto**, porque estuvo en disco sin cifrar.

Excepción que no lo es: el teléfono de la clínica ([[contacto-clinica]]) es público — el agente lo reparte a pacientes. No es un secreto.

Relacionado: [[contacto-clinica]], [[bot-con-telefono-personal]]
