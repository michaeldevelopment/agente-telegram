---
name: thinking-mode-apagado
description: reasoning_effort "none" en todas las llamadas — vale 17x en costo y viene encendido de fábrica
metadata:
  type: decision
---

**`reasoning_effort: "none"` en todas las llamadas a DeepSeek.** No negociable.

**Por qué:** `deepseek-flash` **piensa por defecto con esfuerzo `high`**. Esos tokens se cobran a precio de **output** ($0.60–1.20/M), el más caro de los tres, y en un turno de chat el pensamiento puede ser 5–10× más largo que la respuesta — para contestar *"claro, ¿qué día te queda mejor?"*.

**Multiplicador medido: 17× sobre el costo total.** Es lo que pasa **si no haces nada**, porque viene encendido de fábrica. También añade 5–20 s de latencia.

**Cómo aplicarlo:** en cada petición, sin excepción. Efectos colaterales de dejarlo encendido: `temperature` se ignora y `tool_choice: "required"` devuelve `400`.

Modelo vigente: **`deepseek-flash`**. `deepseek-chat` y `deepseek-reasoner` están **retirados** desde el 24-jul-2026.

Se vigila con `v_llm_daily`: si la latencia p95 sube de 6 s, lo primero que hay que revisar es si el thinking se reactivó.

Relacionado: [[volatiles-al-final-del-prompt]], [[sin-clasificador-llm]]
