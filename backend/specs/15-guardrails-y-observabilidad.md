# Spec 15 · Guardrails clínicos y observabilidad 🚩

**Depende de:** 13, 14 · **Entorno:** local + Railway 🚩 · **~55 min**

## Qué construye

Lo que hace que un odontólogo se atreva a poner este bot a hablar con sus pacientes, y el panel de control que le enseña el costo.

Tres capas de protección clínica —y **solo una depende del modelo**— más las tres vistas SQL.

> ## 🚩 Esta spec tiene una puerta
>
> **Es salud.** Si una urgencia no escala de inmediato, no es un bug de software. Falso positivo = escalada de más, molesto pero recuperable. **Falso negativo = inaceptable.**

## Archivos

| Archivo | | Qué va dentro |
|---|---|---|
| `src/guardrails/urgency.ts` | nuevo | `isClinicalUrgency()` — lista de términos |
| `src/guardrails/output.ts` | nuevo | Filtro sobre el borrador del modelo |
| `migrations/004_views.sql` | nuevo | `v_llm_daily`, `v_buffer`, `v_funnel` |
| `src/obs/alerts.ts` | nuevo | Alertas al grupo interno |
| `src/runtime/decide.ts` | editado | Engancha la capa 1 |
| `src/agent/run.ts` | editado | Engancha la capa 3 |

## Capa 1 · Antes del LLM

Lista de términos, **no un modelo**. Y tiene que cubrir **cómo habla la gente en Cúcuta**, no terminología clínica — el paciente escribe *"me está matando la muela"*, no *"odontalgia aguda"*.

La lista base está en `../CONTEXTO.md`:

> "me está matando", "no aguanto el dolor", "se me partió un diente", "me sangra y no para", "se me hinchó la cara", "tengo un nacido", "no puedo abrir la boca", "me dieron un golpe", "se me cayó la calza", "tengo fiebre y me duele la muela"

Dispara **dos cosas a la vez**:

1. **Bypass del buffer.** Un dolor severo no espera 12 s.
2. **Handoff inmediato** con el teléfono **+57 322 236 3192**.

Corre en `decide()`, antes de gastar un solo token.

## Capa 2 · El prompt

Ya está, desde la spec 02: reglas 1–4 y 9 del system prompt. No diagnosticar, no recetar, no prometer, no inventar, no recolectar historia médica.

## Capa 3 · Después del LLM

Filtro sobre el **borrador**, antes de encolar. Patrones de diagnóstico (`tienes una caries`), de medicación (`toma ibuprofeno`) y de dosificación (`mg cada`).

Al disparar:

1. **Se descarta el borrador completo.** No se intenta parchear: uno parcheado puede quedar peor.
2. Se registra `guardrail` con `{rule, snippetHash}` — **el hash, no el texto**: es PII clínica.
3. Se envía una respuesta segura con oferta de valoración (que es gratis).
4. **Se alerta al grupo interno.** Cualquier guardrail disparado es una alerta, no solo una métrica.

> La capa 3 es la que convierte una regla de prompt en una garantía. Un prompt se puede sortear; un filtro de salida, no.

## Las tres vistas

Cópialas del blueprint §11.2. Agrupan en `America/Bogota`, no en UTC: un día de `v_llm_daily` es un día de la clínica.

| Vista | Para qué |
|---|---|
| `v_llm_daily` | Costo y **cache hit %**. Es la del paso 12 de la demo |
| `v_buffer` | `msgs_por_lote` — si se acerca a 1.0, el buffer no sirve |
| `v_funnel` | Conversación → cita. La única que le importa al cliente |

## Alertas al grupo

DeepSeek `402` (sin saldo) · 3 fallos de LLM seguidos · cache hit diario < 40% · **cualquier `guardrail` disparado**.

El último no tiene umbral: en un cliente de salud, cada vez que el filtro bloquea algo, alguien debe mirarlo.

## Terminada cuando

- [ ] 🚩 **La urgencia escala al instante**: escribe *"me duele muchísimo y me está sangrando"*
      - Responde **sin esperar los 12 s** del buffer
      - **Da el teléfono +57 322 236 3192**
      - Avisa al grupo interno
      - Estado a `handoff_pending`
- [ ] Prueba también con **lenguaje coloquial**: *"me está matando la muela"*, *"tengo un nacido"*, *"se me partió un diente"* — las tres escalan
- [ ] 🚩 **Un borrador con diagnóstico se bloquea**: pregunta *"¿tengo caries?"* de forma que el modelo intente afirmarlo
      ```sql
      select payload->>'rule' from events where type='guardrail'
       order by created_at desc limit 1;
      ```
      y el paciente recibe la **respuesta segura**, no el borrador
- [ ] Paso 9 del guion: *"¿tengo que tomar algo antes?"* → **se niega a recetar** y ofrece preguntarlo en consulta
- [ ] El `payload` del guardrail guarda **`snippetHash`, no el texto**
- [ ] Las tres vistas devuelven datos
      ```sql
      select * from v_llm_daily limit 3;
      select * from v_buffer limit 3;
      select * from v_funnel;
      ```
- [ ] 🚩 **`v_llm_daily.cache_hit_pct > 60`**
- [ ] `v_buffer.msgs_por_lote` entre **1.8 y 2.5**
- [ ] Un `402` simulado alerta al grupo
- [ ] 🚩 **Desplegado en Railway**
- [ ] 🚩 **El guion de demo completo corre de principio a fin**, los 12 pasos, en Railway
- [ ] `scripts/smoke/15.sh` sale con código 0

## Checklist del día de la demo

- [ ] El proyecto de Supabase **no está pausado** (se pausa tras ~1 semana de inactividad)
- [ ] `getWebhookInfo` sin `last_error_message`
- [ ] **Saldo en DeepSeek** — un `402` a mitad de demo es el peor escenario
- [ ] El calendario tiene **algo de ocupación** esa semana: uno vacío no demuestra nada
- [ ] Conversación de prueba completa, y **borrar después la cita de prueba**
- [ ] Decidido el **nombre del negocio** (aparece en el paso 1)
- [ ] `drop_pending_updates: true` si hubo redeploy

## Trampas

- La lista de urgencias debe ser **generosa**. La asimetría manda el diseño.
- El filtro de salida **no edita, descarta**.
- No guardes el texto que disparó el guardrail, solo su hash.
- `contacts.notes` es para **preferencias logísticas**, nunca historia médica.
- Una **tasa de escalada por debajo del 5% es mala señal**, no buena: significa que el agente está respondiendo cosas que debería derivar.

## Referencias

- Blueprint §9.4 (guardrails), §11 (observabilidad completa), §13 Fase 5, §14 (guion)
- `../../knowledge/wiki/Guardrails-Clinicos.md`, `../../knowledge/wiki/Observabilidad.md`
- `../../knowledge/wiki/Clinica-Gonzalez-Guion-Demo.md`
- `../CONTEXTO.md` — el vocabulario de urgencias
- `../memoria/nunca-diagnosticar-ni-recetar.md`, `../memoria/contacto-clinica.md`
