---
titulo: Checklist de onboarding
tipo: operacion
estado: vigente
fuente: Derivado de "[[00-BLUEPRINT-agente-telegram]] §8.1, §10.1, §12"
actualizado: 2026-10-22
tags: [onboarding, checklist, cliente, operacion]
---

# Checklist de onboarding

Procedimiento para dar de alta un cliente nuevo. **Cero código** — si en algún paso hace falta escribir código, el diseño se rompió. Ver [[Multi-Cliente]].

## 1 · Recoger los datos del cliente

- [ ] Nombre comercial, tipo de negocio, ciudad, zona horaria, moneda
- [ ] Catálogo de servicios: slug, nombre, **duración**, **buffer**, precio desde, si requiere valoración
- [ ] Horario de atención por día de la semana, con descanso
- [ ] Festivos y cierres previstos
- [ ] Sedes: dirección, indicaciones, teléfono, WhatsApp
- [ ] Equipo: nombres y especialidades
- [ ] Medios de pago, financiación, convenios
- [ ] Políticas de cancelación y llegada tarde
- [ ] FAQs

Lo que no esté confirmado se escribe `<<EDITAR>>` y entra en la página de pendientes del cliente. **No se inventa.** Ver [[Clinica-Gonzalez-Pendientes]] como modelo.

### Si es un cliente de salud

- [ ] Validar con el profesional la **lista de términos de urgencia**, en lenguaje coloquial local
- [ ] Confirmar las reglas de no diagnosticar / no recetar / precios "desde"

Ver [[Guardrails-Clinicos]].

## 2 · Crear el bot

- [ ] @BotFather → `/newbot` → nombre y username
- [ ] Foto de perfil y descripción (el cliente las ve: vale la pena)
- [ ] `/setcommands`: `start`, `ayuda`, `humano`
- [ ] Guardar el token en Railway (demo) o en `workspaces.bot_token_enc` (desde el 2º cliente)
- [ ] Desactivar el modo privacidad si el bot debe leer todos los mensajes del grupo de handoff

## 3 · Grupo interno de handoff

- [ ] Crear el grupo con el equipo del cliente
- [ ] Añadir el bot y darle permisos
- [ ] Obtener el `chat_id` → **es negativo**
- [ ] Guardarlo en `workspaces.handoff_chat_id`

Ver [[State-Machine-y-Handoff]].

## 4 · Google Calendar · 5 minutos

- [ ] Google Cloud Console → proyecto → habilitar **Google Calendar API**
- [ ] Crear **Service Account** → clave JSON
- [ ] Copiar el email de la SA (`algo@proyecto.iam.gserviceaccount.com`)
- [ ] **Compartir el calendario con la SA, con permiso de "Hacer cambios en los eventos"** ← el paso que más se olvida
- [ ] Copiar el ID del calendario
- [ ] Convertir la clave privada a **base64**
- [ ] Guardar `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, `GOOGLE_CALENDAR_ID`

**Verificación inmediata:** un `freeBusy.query` de prueba. Si `calendars.<id>.errors[]` trae `notFound`, el compartido no quedó bien. La petición devuelve `200` igual, así que hay que mirarlo a mano.

Ver [[Google-Calendar]].

## 5 · Cargar los datos a Supabase

En este orden, por las claves foráneas:

- [ ] Fila en `workspaces`: slug, nombre, `agent_type`, timezone, locale, currency, parámetros de buffer, horas de silencio, `handoff_chat_id`
- [ ] `business_info.structured` ← el JSON del cliente
- [ ] Generar `business_info.rendered` y su `rendered_hash`
- [ ] `services` ← el CSV del cliente
- [ ] `business_hours` (recordar: **0 = domingo**)
- [ ] `closures` con los festivos
- [ ] `agent_prompts`: el prompt **con las variables ya resueltas**, `is_active = true`

> ⚠️ El prompt se guarda **ya resuelto**. Resolver variables en cada petición es el error de 10× de [[Cache-de-Prefijo]].

## 6 · Configurar el worker

- [ ] Variables de entorno en Railway. Ver [[Variables-de-Entorno]]
- [ ] `runtime_config` en Supabase con `worker_url` e `internal_secret` — **idénticos** a las env vars
- [ ] `setWebhook` con el `secret_token`, `allowed_updates` acotado y `drop_pending_updates: true`
- [ ] Verificar con `getWebhookInfo`: sin `last_error_message`, `pending_update_count` en 0

## 7 · Verificación end-to-end

Los criterios de aceptación del [[Roadmap-por-Fases|roadmap]], en corto:

- [ ] `/start` responde con el nombre del negocio
- [ ] Reenviar el mismo `update_id` no duplica la fila en `messages`
- [ ] Cuatro mensajes rápidos → **una** respuesta
- [ ] `events.llm_call` con `cacheHit > 0` en el segundo turno
- [ ] Una cita de prueba aparece en Google Calendar **con la hora correcta**
- [ ] Reintentar la inserción devuelve `409`, no duplica
- [ ] `/humano` silencia la IA y avisa al grupo
- [ ] Responder desde el grupo le llega al paciente
- [ ] Un término de urgencia escala de inmediato, sin esperar el buffer
- [ ] **Borrar la cita de prueba del calendario**

## 8 · Documentar en el vault

- [ ] Página `Cliente-<Slug>.md` con la ficha
- [ ] `<Slug>-Servicios.md`, `<Slug>-Business-Info.md`, `<Slug>-System-Prompt.md`
- [ ] `<Slug>-Credenciales.md` — **qué existe y dónde, nunca el valor**
- [ ] `<Slug>-Pendientes.md` con los `<<EDITAR>>` restantes
- [ ] `<Slug>-Guion-Demo.md` si hay demo
- [ ] Actualizar `index.md`
- [ ] Entrada en `log.md`

## Relacionado

- [[Multi-Cliente]] — por qué esto es cero código
- [[Roadmap-por-Fases]] — construcción inicial
- [[Variables-de-Entorno]] — la configuración
- [[Gotchas]] — lo que suele romperse
- [[Cliente-Clinica-Gonzalez]] — el primero
