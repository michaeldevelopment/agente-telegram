---
titulo: Clínica González · Pendientes
tipo: cliente
estado: vigente
fuente: Derivado de §9 + raw/2026-10-22-datos-cliente-dr-gonzalez
actualizado: 2026-10-22
tags: [pendientes, cliente, dato-ficticio, checklist]
---

# Clínica González · Pendientes

Estado tras la carga de datos del **2026-10-22**.

> **La demo ya no está bloqueada por datos.** Los 5 bloqueantes críticos están resueltos. Lo que queda son datos ficticios que hay que sustituir **antes de producción**, no antes de la demo.

---

## ✅ Resuelto el 2026-10-22

- [x] Teléfono de la clínica — **+57 322 236 3192**
- [x] WhatsApp — el mismo número
- [x] Dirección — Av 3A # 24, Santo Domingo, Cúcuta
- [x] Horario L–V — 8:00 a. m. – 6:00 p. m.
- [x] Horario sábado — 8:00 a. m. – 12:00 m.
- [x] ¿La valoración tiene costo? — **No, es gratuita**
- [x] ¿Manejan sedación? — Sí
- [x] ¿Atienden niños? — Sí
- [x] Validación del guardrail — *"que el bot nunca diagnostique ni dé precios finales"*

---

## 🔴 Decisiones abiertas — te tocan a ti

- [ ] **¿Qué nombre va en el prompt?** Google Maps registra el negocio como **"Fabian Gonzalez Odontología"**; el vault venía usando "Clínica Odontológica Dr. Fabián González". Es lo primero que lee el paciente en el saludo. El JSON guarda ambos.
- [ ] **¿La clínica cierra a mediodía?** Diste 8–18 corrido y se cargó literal, sin descanso. Si sí cierra, hay que llenar `business_hours.break_from` / `break_to` o el agente ofrecerá citas a la 1 p. m. con la clínica cerrada.
- [ ] **¿Se atiende domingo?** No lo mencionaste; se asumió cerrado.
- [ ] Qué calendario de Google usa la demo.
- [ ] Username, foto y descripción del bot en @BotFather.
- [ ] Grupo de handoff: ¿uno de prueba tuyo, o el real de la clínica?

---

## 🎭 Datos ficticios — sustituir antes de producción

Plausibles pero **falsos**. Autorizados por ti el 2026-10-22. No se ven en la demo, y por eso están listados aquí: es el único rastro para encontrarlos.

### Precios — los 12

Todos en `Clinica-Gonzalez-services.csv`, columna `ficticio`.

- [ ] `limpieza-dental` — $120.000
- [ ] `blanqueamiento` — $550.000
- [ ] `resina` — $160.000 por diente
- [ ] `carillas` — $450.000 resina / $1.200.000 porcelana
- [ ] `ortodoncia-consulta` — $60.000
- [ ] `brackets-metalicos` — $700.000 + $120.000/mes
- [ ] `brackets-esteticos` — $1.100.000 + $140.000/mes
- [ ] `alineadores` — $250.000 escaneo / $7.500.000 tratamiento
- [ ] `endodoncia` — $380.000 por conducto
- [ ] `extraccion` — $130.000
- [ ] `implante` — $2.800.000
- [ ] `urgencia` — $80.000

### Duraciones

- [ ] **`carillas`: 90 min / buffer 15** — ficticio, no venía de ninguna fuente
- [ ] **Confirmar las otras 12 duraciones y buffers** — vienen del blueprint, no del cliente. Determinan cuántos pacientes caben en un día

### Negocio

- [ ] **Convenios con EPS y prepagadas** ← el ficticio más sensible. Actualmente dice "particular, con factura para reembolso de prepagada". Un paciente que pregunte por su EPS y reciba esto se entera al llegar a la clínica
- [ ] Medios de pago — se asumió efectivo, tarjetas, transferencia, Nequi, Daviplata
- [ ] Financiación — cuota inicial + mensualidades en ortodoncia e implantes
- [ ] Política de cancelación — 24 h
- [ ] Tolerancia de llegada tarde — 15 min
- [ ] Primera cita — documento y radiografías previas
- [ ] Especialidad del Dr. González — se puso "Odontología general y estética", inferida

### FAQs ficticias

- [ ] Duración de ortodoncia — 18 a 24 meses
- [ ] ¿Urgencias el mismo día? — "sí, según disponibilidad"
- [ ] ¿Carillas en cuántas citas? — 2 o 3

---

## ⬜ Sin rellenar — quedaron en `<<EDITAR>>`

No se inventaron, a propósito:

- [ ] **¿Hay más profesionales en la clínica?** Nombres y especialidades. **Regla del vault: nunca se inventa un nombre de persona**, ni con autorización de datos ficticios. Un odontólogo inexistente presentado a un paciente real es un problema distinto a un precio aproximado
- [ ] **¿Tienen parqueadero?** Verificable en el sitio
- [ ] Punto de referencia para llegar

---

## 🔧 Infraestructura

No son datos del cliente, pero bloquean la demo igual. Ver [[Checklist-de-Onboarding]].

- [ ] Bot creado en @BotFather (se usará el teléfono personal del usuario, **no** el de la clínica)
- [ ] Grupo interno + `handoff_chat_id` (**negativo**)
- [ ] Proyecto de Supabase creado y migración aplicada
- [ ] Servicio en Railway desplegado
- [ ] Service Account de Google + **calendario compartido con permiso de "Hacer cambios en los eventos"**
- [ ] `GOOGLE_CALENDAR_ID`
- [ ] Saldo en DeepSeek
- [ ] Variables de entorno. Ver [[Clinica-Gonzalez-Credenciales]]

---

## Nota de cache

Cada sustitución de un dato cambia `business_info.rendered` y su hash, y el siguiente turno paga un cache miss completo. **Sustituir en bloque, no de a uno.** Ver [[Cache-de-Prefijo]].

## Relacionado

- [[Cliente-Clinica-Gonzalez]] — la ficha
- [[Clinica-Gonzalez-Servicios]] — los precios con su origen
- [[Clinica-Gonzalez-Business-Info]] — qué es real y qué ficticio
- [[Clinica-Gonzalez-Guion-Demo]] — qué se rompe si falta cada cosa
- [[Checklist-de-Onboarding]] — el procedimiento completo
