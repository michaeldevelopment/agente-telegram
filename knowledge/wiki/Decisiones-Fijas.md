---
titulo: Decisiones fijas
tipo: base
estado: vigente
fuente: "[[00-BLUEPRINT-agente-telegram]] §0"
actualizado: 2026-10-22
tags: [decisiones, stack, arquitectura]
---

# Decisiones fijas

El conjunto de decisiones que **no se re-discuten**. Son el suelo sobre el que se apoya todo el resto del vault: si una cambia, se actualiza esta página primero, se anota en `log.md` con el motivo, y después se propagan las páginas afectadas.

| Tema | Decisión |
|---|---|
| Canal | **Telegram Bot API** (webhook, no polling) |
| Base de datos | **Supabase free** — Postgres + `pg_cron` + `pg_net`. Sin Realtime, sin Storage, sin pgvector |
| Runtime | **Un solo servicio Node/TypeScript en Railway** ($5 Hobby). Sin frontend |
| LLM | **DeepSeek API**, modelo `deepseek-flash`, **thinking mode desactivado** |
| Agenda | **Google Calendar API v3** con Service Account sobre calendario compartido |
| Transcripción de voz | **Fuera de alcance**, hook preparado |
| Handoff humano | **Dentro de Telegram** — grupo interno con botones inline. Sin panel web |
| Recordatorios | **Sí** — confirmación 24 h antes y recordatorio 2 h antes, vía `pg_cron` |
| Multi-tenancy | Por `workspace`. **Un bot (token) por cliente** |
| Zona horaria piloto | `America/Bogota` (UTC-5, **sin DST**) |
| Moneda piloto | COP |

## Por qué cada una

**Telegram y no WhatsApp.** No hay ventana de 24 h, no hay templates que aprobar, no hay cuenta de Meta Business que verificar. Un bot se crea en @BotFather en dos minutos. Para una demo que tiene que estar viva esta semana, la diferencia es de días. El canal de WhatsApp es otro proyecto. Ver [[Telegram-vs-WhatsApp]].

**Railway y no serverless.** Un proceso persistente permite timers reales en memoria, y eso hace que el [[Buffer-y-Batching|buffer]] dispare exacto al vencer el silencio en vez de hasta 10 s tarde. `pg_cron` queda como red de seguridad, no como mecanismo principal.

**DeepSeek directo y no OpenRouter.** Con un solo modelo y un solo cliente, el gateway añade un salto de red y un margen sin aportar nada. El fallback se resuelve en código. Ver [[Agente-DeepSeek]].

**Service Account y no OAuth.** Cinco minutos de configuración, sin pantalla de consentimiento, sin verificación de Google, sin `refresh_token` que rote. El precio es que no puede invitar asistentes — y no los necesitamos, porque el paciente recibe su confirmación por Telegram. Ver [[Google-Calendar]].

**Sin RLS en esta fase.** No hay frontend, nadie se conecta con la `anon` key: el único cliente de la base es el worker con `service_role`. Cuando llegue un panel, se aplica el patrón RLS del blueprint original tal cual. Ver [[Seguridad]].

**`America/Bogota` sin DST.** Colombia no cambia la hora. Toda la aritmética de slots es estable y no hay que pelear con transiciones. Un cliente futuro con DST obliga a calcular siempre en zona local con Luxon. Ver [[Calculo-de-Slots]].

## Costo de la demo

$5/mes de Railway + $0 de Supabase free + ~$1–2/mes de DeepSeek a volumen de demo. El cuello de botella del costo es Railway, no la IA. El desglose por conversación está en [[Economia-de-Tokens]].

## Relacionado

- [[Arquitectura]] — cómo encajan las piezas
- [[Variables-de-Entorno]] — la traducción de estas decisiones a configuración
- [[Fuera-de-Alcance]] — lo que se decidió explícitamente **no** hacer
- [[Roadmap-por-Fases]] — en qué orden se construye
