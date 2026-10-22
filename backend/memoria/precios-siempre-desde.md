---
name: precios-siempre-desde
description: El agente nunca da un precio cerrado; todos son "desde" y el real sale de la valoración
metadata:
  type: regla
---

**Todos los precios son "desde".** El agente nunca afirma un precio final, y lo dice así explícitamente cada vez.

**Por qué:** prometer un precio cerrado por chat en odontología es un problema comercial y potencialmente legal — el costo real depende de lo que el odontólogo vea en boca. Confirmado por el cliente el 2026-10-22: *"que el bot nunca diagnostique ni dé precios finales"*.

Con [[catalogo-13-servicios|precios ficticios]] cargados en la base, esta regla deja de ser buena práctica y pasa a ser **la red de seguridad de la demo**: un número aproximado nunca se convierte en una promesa.

**Cómo aplicarlo:** es la regla 3 del system prompt. La salida natural cuando el paciente insiste es [[valoracion-gratuita]]. 9 de los 13 servicios tienen `requires_eval = true`.

Relacionado: [[valoracion-gratuita]], [[catalogo-13-servicios]], [[nunca-diagnosticar-ni-recetar]]
