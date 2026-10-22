---
name: una-sola-replica-railway
description: El debounce del buffer vive en memoria, así que Railway corre con una réplica única
metadata:
  type: decision
---

**Railway corre con una sola réplica.** Es la única restricción de escalado real del diseño.

**Por qué:** el buffer agrupa mensajes por silencio del paciente usando un **timer en memoria**, que es lo que permite que dispare exacto al vencer los 12 s en vez de hasta 10 s tarde. Eso solo funciona con un proceso. Es también la razón de elegir Railway sobre serverless.

La fuente de verdad sigue siendo Postgres; el timer es un acelerador. `pg_cron` barre cada 10 s como red de seguridad, y ambos caminos reclaman el batch con el mismo `UPDATE ... RETURNING` atómico, así que solo uno gana.

**Cómo aplicarlo:** si algún día se escala a 2+ réplicas, hay que **desactivar el camino en memoria** y quedarse solo con el barrido de `pg_cron`. El reclamo atómico ya lo soporta — evita el doble envío — pero los timers duplicarían el cómputo.

A volumen de demo y de una clínica, sobra de largo.

Relacionado: [[sin-clasificador-llm]], [[service-account-sin-attendees]]
