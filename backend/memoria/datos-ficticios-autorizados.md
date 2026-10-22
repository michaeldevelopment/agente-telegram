---
name: datos-ficticios-autorizados
description: El usuario autorizó inventar datos aproximados para este cliente, con rastro obligatorio
metadata:
  type: regla
---

El 2026-10-22 el usuario autorizó **rellenar con datos ficticios aproximados** todos los campos que el cliente no entregó: *"que sean muy cercanos a datos reales. Precios, etc."*

**Por qué importa el rastro:** un `<<EDITAR>>` **se ve** si se cuela en la demo. Un dato ficticio **no se ve** — parece real. Por eso necesita marca explícita, o nadie lo encuentra para sustituirlo antes de producción.

**Cómo aplicarlo — dos marcas que no se mezclan:**

- `<<EDITAR>>` — hueco sin rellenar. Estado por defecto para cualquier cliente nuevo.
- `#dato-ficticio` — valor inventado con autorización. En JSON: campo `_ficticio`. En CSV: columna `ficticio`. En markdown: columna "Origen" o el tag al lado.

Esta autorización es **solo para `clinica-gonzalez`**. No se extiende a otros clientes. Y tiene una excepción que no se negocia: [[nunca-inventar-nombres-de-personas]].

~20 datos ficticios vigentes, listados en `../../knowledge/wiki/Clinica-Gonzalez-Pendientes.md`. El más sensible: los convenios con EPS.

Relacionado: [[nunca-inventar-nombres-de-personas]], [[catalogo-13-servicios]], [[precios-siempre-desde]]
