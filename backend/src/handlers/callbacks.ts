import { DateTime } from "luxon";
import { sql } from "../db/client.js";
import { enqueue } from "../egress/outbox.js";
import { tecladoDeSlots, tecladoReprogramar } from "../egress/keyboards.js";
import { computeSlots } from "../gcal/slots.js";
import { resolverPorConvCorto } from "../handoff/group.js";
import type { SlotDTO } from "../gcal/slots.js";
import { insertOutbound, type Conversacion, type Workspace } from "../ingress/persist.js";
import type { Inbound } from "../ingress/normalize.js";
import { logEvent } from "../obs/events.js";
import { agendarCita } from "../tools/agendar.js";
import { cancelarCita } from "../tools/cancelar.js";
import { reprogramarCita } from "../tools/reprogramar.js";
import { resolverPorApptCorto } from "../reminders/send.js";
import { answerCallbackQuery, editMessageReplyMarkup, editMessageText } from "../telegram/api.js";

/**
 * Ruteo de botones (callback_query). El prefijo de `callback_data` decide
 * qué hacer:
 *
 *   bk:   → agendar un horario (spec 12) — reusa agendarCita.run(), sin pasar
 *          por el agente: CERO llamadas al LLM entre el toque y la confirmación.
 *   take: / back: → tomar/devolver un handoff (spec 13)
 *   rc:/rx:/rp: → confirmar/cancelar/reprogramar desde un recordatorio (spec 14)
 *   rb:   → el horario elegido tras tocar "Reprogramar" — mueve la cita
 *          existente (reprogramar_cita), nunca crea una nueva
 *
 * Lo que NUNCA puede faltar, sea cual sea la rama: `answerCallbackQuery`. Sin
 * eso el botón se queda girando en el cliente — es el error número uno con
 * botones, y por eso cada rama lo garantiza incluso si algo más falla.
 */
export async function handleCallback(ws: Workspace, conv: Conversacion, ev: Inbound): Promise<void> {
  const data = ev.callbackData ?? "";
  const queryId = ev.callbackQueryId;
  if (!queryId) return; // no debería pasar: normalize.ts siempre lo trae en un callback

  const partes = data.split(":");
  const prefijo = partes[0];

  try {
    switch (prefijo) {
      case "bk":
        return await handleBk(ws, conv, ev, queryId, partes);
      case "take":
        return await handleTake(ws, ev, queryId, partes[1] ?? "");
      case "back":
        return await handleBack(ws, ev, queryId, partes[1] ?? "");
      case "rc":
        return await handleRc(ws, conv, queryId, partes[1] ?? "", ev);
      case "rx":
        return await handleRx(ws, conv, queryId, partes[1] ?? "", ev);
      case "rp":
        return await handleRp(ws, conv, queryId, partes[1] ?? "", ev);
      case "rb":
        return await handleRb(ws, conv, ev, queryId, partes);
      default:
        await answerCallbackQuery({ callback_query_id: queryId });
    }
  } catch {
    // Si incluso el answer falla (red, token), que no tumbe el ingreso: el
    // botón quedará girando esta vez, pero el proceso sigue vivo para el resto.
    await answerCallbackQuery({ callback_query_id: queryId }).catch(() => {});
  }
}

// ── bk: agendar por botón (spec 12) ──────────────────────────

async function handleBk(
  ws: Workspace, conv: Conversacion, ev: Inbound, queryId: string, partes: string[],
): Promise<void> {
  const slug = partes[1];
  const epochMin = Number(partes[2]);

  if (!slug || !Number.isFinite(epochMin)) {
    await answerCallbackQuery({ callback_query_id: queryId, text: "Horario inválido, intenta de nuevo.", show_alert: true });
    return;
  }

  const inicio = DateTime.fromMillis(epochMin * 60_000).setZone(ws.timezone);

  const [contacto] = await sql<{ full_name: string | null; first_name: string | null }[]>`
    select full_name, first_name from contacts where id = ${conv.contactId}`;
  const nombre = contacto?.full_name ?? contacto?.first_name ?? "Paciente sin nombre";

  const resultado = await agendarCita.run(
    { servicio: slug, inicio: inicio.toISO()!, nombre_paciente: nombre },
    { workspace: ws, conversation: conv },
  );

  // Quitar los botones apenas se intenta la acción, sin importar el
  // resultado: si no, el paciente puede tocar otro horario y agendar dos
  // veces. Si la edición falla (mensaje viejo), no es fatal.
  if (ev.messageId) {
    await editMessageReplyMarkup({ chat_id: ev.chatId, message_id: ev.messageId, reply_markup: { inline_keyboard: [] } })
      .catch(() => {});
  }

  if (resultado.ok) {
    const d = resultado.data as { cita_id: string; cuando: string; servicio: string };
    await answerCallbackQuery({ callback_query_id: queryId, text: "Listo, te confirmo" });
    const texto = `✅ Cita confirmada: ${d.servicio}, ${d.cuando}.`;
    await enqueue({ workspaceId: ws.id, conversationId: conv.conversationId, chatId: ev.chatId, texto });
    await insertOutbound(ws, conv, texto);
    return;
  }

  if (resultado.error === "slot_ocupado") {
    await answerCallbackQuery({
      callback_query_id: queryId, text: "Ese horario se acaba de ocupar", show_alert: true,
    });
    const alt = (resultado.data as { alternativas?: SlotDTO[] } | undefined)?.alternativas ?? [];
    if (alt.length > 0) {
      await enqueue({
        workspaceId: ws.id, conversationId: conv.conversationId, chatId: ev.chatId,
        texto: "Ese horario ya se ocupó. Elige otro:",
        replyMarkup: tecladoDeSlots(slug, alt),
      });
    } else {
      await enqueue({
        workspaceId: ws.id, conversationId: conv.conversationId, chatId: ev.chatId,
        texto: "Ese horario ya se ocupó y no tengo más opciones cercanas. Escríbeme y busco otro.",
      });
    }
    return;
  }

  // muy_pronto, servicio_desconocido, error_interno, etc.
  await answerCallbackQuery({ callback_query_id: queryId, text: "No se pudo agendar, intenta de nuevo.", show_alert: true });
  await enqueue({
    workspaceId: ws.id, conversationId: conv.conversationId, chatId: ev.chatId,
    texto: "No pude agendar ese horario. Escríbeme y te ayudo a buscar otro.",
  });
}

// ── take:/back: handoff (spec 13) ────────────────────────────

async function reclamarConversacion(conversationId: string, tgUserId: number): Promise<boolean> {
  const [fila] = await sql<{ id: string }[]>`
    update conversations set state = 'human_active', assigned_to = ${tgUserId}, updated_at = now()
     where id = ${conversationId} and state = 'handoff_pending'
    returning id`;
  return !!fila;
}

function nombreDeQuienToca(ev: Inbound): string {
  return ev.from.username ? `@${ev.from.username}`
    : ev.from.firstName ? ev.from.firstName
    : `usuario ${ev.userId}`;
}

async function handleTake(ws: Workspace, ev: Inbound, queryId: string, convCortoVal: string): Promise<void> {
  const conversationId = await resolverPorConvCorto(ws.id, convCortoVal);
  if (!conversationId) {
    await answerCallbackQuery({ callback_query_id: queryId, text: "No encontré esa conversación.", show_alert: true });
    return;
  }

  const tomada = await reclamarConversacion(conversationId, ev.userId);
  if (!tomada) {
    await answerCallbackQuery({ callback_query_id: queryId, text: "Ya la tomó alguien más.", show_alert: true });
    return;
  }

  const [relay] = await sql<{ created_at: Date }[]>`
    select created_at from handoff_relay
     where workspace_id = ${ws.id} and conversation_id = ${conversationId}
     order by created_at desc limit 1`;
  const waitedMs = relay ? Date.now() - relay.created_at.getTime() : null;

  await logEvent({
    workspaceId: ws.id, conversationId, type: "handoff",
    payload: { reason: "take", takenBy: ev.userId, waitedMs },
  });

  await answerCallbackQuery({ callback_query_id: queryId, text: "La tienes tú" });

  if (ev.messageId) {
    const base = ev.callbackMessageText ?? "🔔 Handoff";
    await editMessageText({
      chat_id: ev.chatId, message_id: ev.messageId,
      text: `${base}\n\n👤 Tomada por ${nombreDeQuienToca(ev)}`,
      reply_markup: { inline_keyboard: [[{ text: "Devolver a la IA", callback_data: `back:${convCortoVal}` }]] },
    }).catch(() => {});
  }
}

/** Lo que el humano escribió mientras tuvo la conversación, para inyectárselo a la IA al devolverla. */
async function resumenDelHumano(conversationId: string): Promise<string | null> {
  const filas = await sql<{ body: string | null }[]>`
    select body from messages
     where conversation_id = ${conversationId} and direction = 'out' and sender_tg_id is not null
     order by created_at asc`;
  const texto = filas.map((f) => f.body).filter(Boolean).join(" ");
  return texto || null;
}

async function handleBack(ws: Workspace, ev: Inbound, queryId: string, convCortoVal: string): Promise<void> {
  const conversationId = await resolverPorConvCorto(ws.id, convCortoVal);
  if (!conversationId) {
    await answerCallbackQuery({ callback_query_id: queryId, text: "No encontré esa conversación.", show_alert: true });
    return;
  }

  const resumen = await resumenDelHumano(conversationId);

  await sql`
    update conversations
       set state = 'ai_active', assigned_to = null, updated_at = now(),
           summary = case when ${resumen}::text is not null
                       then coalesce(summary, '') || E'\n[Resumen del handoff]: ' || ${resumen}
                       else summary end,
           summary_upto = now()
     where id = ${conversationId}`;

  await logEvent({
    workspaceId: ws.id, conversationId, type: "handoff",
    payload: { reason: "back", returnedBy: ev.userId },
  });

  await answerCallbackQuery({ callback_query_id: queryId, text: "Devuelta a la IA" });

  if (ev.messageId) {
    const base = ev.callbackMessageText ?? "🔔 Handoff";
    await editMessageText({
      chat_id: ev.chatId, message_id: ev.messageId,
      text: `${base}\n\n↩️ Devuelta a la IA por ${nombreDeQuienToca(ev)}`,
      reply_markup: { inline_keyboard: [] },
    }).catch(() => {});
  }
}

// ── rc:/rx:/rp:/rb: botones del recordatorio (spec 14) ───────

/** Quita los botones del recordatorio, sin importar qué se tocó. Mismo motivo que en bk:. */
async function quitarBotonesRecordatorio(ev: Inbound): Promise<void> {
  if (!ev.messageId) return;
  await editMessageReplyMarkup({ chat_id: ev.chatId, message_id: ev.messageId, reply_markup: { inline_keyboard: [] } })
    .catch(() => {});
}

async function handleRc(ws: Workspace, conv: Conversacion, queryId: string, corto: string, ev: Inbound): Promise<void> {
  const appointmentId = await resolverPorApptCorto(ws.id, corto);
  await quitarBotonesRecordatorio(ev);

  if (!appointmentId) {
    await answerCallbackQuery({ callback_query_id: queryId, text: "No encontré esa cita.", show_alert: true });
    return;
  }

  const [fila] = await sql<{ id: string }[]>`
    update appointments set status = 'confirmed', updated_at = now()
     where id = ${appointmentId} and contact_id = ${conv.contactId}
       and status in ('booked', 'rescheduled')
    returning id`;

  await answerCallbackQuery({ callback_query_id: queryId, text: "¡Gracias por confirmar!" });
  const texto = fila ? "✅ Cita confirmada. ¡Te esperamos!" : "Esa cita ya estaba confirmada o ya no está activa.";
  await enqueue({ workspaceId: ws.id, conversationId: conv.conversationId, chatId: ev.chatId, texto });
  await insertOutbound(ws, conv, texto);
}

async function handleRx(ws: Workspace, conv: Conversacion, queryId: string, corto: string, ev: Inbound): Promise<void> {
  const appointmentId = await resolverPorApptCorto(ws.id, corto);
  await quitarBotonesRecordatorio(ev);

  if (!appointmentId) {
    await answerCallbackQuery({ callback_query_id: queryId, text: "No encontré esa cita.", show_alert: true });
    return;
  }

  // Reusa cancelarCita.run(): mismo DELETE en Google, mismo cancelado de
  // recordatorios pendientes. `buscarCitaDelPaciente` ya exige que
  // `contact_id` coincida con `conv.contactId` — un paciente no puede
  // cancelar la cita de otro ni desde este botón.
  const resultado = await cancelarCita.run({ cita_id: appointmentId }, { workspace: ws, conversation: conv });

  await answerCallbackQuery({ callback_query_id: queryId, text: resultado.ok ? "Cita cancelada" : "No se pudo cancelar" });
  const texto = resultado.ok
    ? "Tu cita quedó cancelada. Si quieres agendar otra, escríbeme cuando quieras."
    : "No pude cancelar esa cita. Escríbeme y lo resolvemos.";
  await enqueue({ workspaceId: ws.id, conversationId: conv.conversationId, chatId: ev.chatId, texto });
  await insertOutbound(ws, conv, texto);
}

/** "Reprogramar" del recordatorio: NO agenda — pide disponibilidad real y devuelve los botones de la spec 12 (con prefijo rb:). */
async function handleRp(ws: Workspace, conv: Conversacion, queryId: string, corto: string, ev: Inbound): Promise<void> {
  const appointmentId = await resolverPorApptCorto(ws.id, corto);
  await quitarBotonesRecordatorio(ev);

  if (!appointmentId) {
    await answerCallbackQuery({ callback_query_id: queryId, text: "No encontré esa cita.", show_alert: true });
    return;
  }

  const [cita] = await sql<{ id: string; duration_min: number; buffer_min: number; service_slug: string | null }[]>`
    select a.id, s.duration_min, s.buffer_min, s.slug as service_slug
      from appointments a left join services s on s.id = a.service_id
     where a.id = ${appointmentId} and a.contact_id = ${conv.contactId}
       and a.status in ('booked','confirmed','rescheduled')`;

  if (!cita || !cita.service_slug) {
    await answerCallbackQuery({ callback_query_id: queryId, text: "No se pudo buscar horarios para esa cita.", show_alert: true });
    return;
  }

  await answerCallbackQuery({ callback_query_id: queryId, text: "Buscando horarios…" });

  const desde = DateTime.now().setZone(ws.timezone).toISODate()!;
  const slots = await computeSlots({
    workspaceId: ws.id, zone: ws.timezone,
    servicio: { duration_min: cita.duration_min, buffer_min: cita.buffer_min }, from: desde, limit: 4,
  });

  if (slots.length === 0) {
    const texto = "No encuentro horarios libres por ahora. Escríbeme y lo buscamos juntos.";
    await enqueue({ workspaceId: ws.id, conversationId: conv.conversationId, chatId: ev.chatId, texto });
    await insertOutbound(ws, conv, texto);
    return;
  }

  const texto = "Elige el nuevo horario para tu cita:";
  await enqueue({
    workspaceId: ws.id, conversationId: conv.conversationId, chatId: ev.chatId, texto,
    replyMarkup: tecladoReprogramar(corto, slots),
  });
  await insertOutbound(ws, conv, texto);
}

/** El horario elegido tras "Reprogramar": MUEVE la cita existente (reprogramar_cita), nunca crea una nueva. */
async function handleRb(
  ws: Workspace, conv: Conversacion, ev: Inbound, queryId: string, partes: string[],
): Promise<void> {
  const corto = partes[1];
  const epochMin = Number(partes[2]);

  if (!corto || !Number.isFinite(epochMin)) {
    await answerCallbackQuery({ callback_query_id: queryId, text: "Horario inválido, intenta de nuevo.", show_alert: true });
    return;
  }

  const appointmentId = await resolverPorApptCorto(ws.id, corto);
  await quitarBotonesRecordatorio(ev);

  if (!appointmentId) {
    await answerCallbackQuery({ callback_query_id: queryId, text: "No encontré esa cita.", show_alert: true });
    return;
  }

  const nuevoInicio = DateTime.fromMillis(epochMin * 60_000).setZone(ws.timezone);
  const resultado = await reprogramarCita.run(
    { cita_id: appointmentId, nuevo_inicio: nuevoInicio.toISO()! },
    { workspace: ws, conversation: conv },
  );

  if (resultado.ok) {
    const d = resultado.data as { cuando: string; servicio: string | null };
    await answerCallbackQuery({ callback_query_id: queryId, text: "Listo, te confirmo" });
    const texto = `✅ Cita movida: ${d.servicio ?? "tu cita"}, ${d.cuando}.`;
    await enqueue({ workspaceId: ws.id, conversationId: conv.conversationId, chatId: ev.chatId, texto });
    await insertOutbound(ws, conv, texto);
    return;
  }

  if (resultado.error === "slot_ocupado") {
    await answerCallbackQuery({ callback_query_id: queryId, text: "Ese horario se acaba de ocupar", show_alert: true });
    const alt = (resultado.data as { alternativas?: SlotDTO[] } | undefined)?.alternativas ?? [];
    const texto = alt.length > 0 ? "Ese horario ya se ocupó. Elige otro:" : "Ese horario ya se ocupó y no tengo más opciones cercanas.";
    await enqueue({
      workspaceId: ws.id, conversationId: conv.conversationId, chatId: ev.chatId, texto,
      replyMarkup: alt.length > 0 ? tecladoReprogramar(corto, alt) : undefined,
    });
    await insertOutbound(ws, conv, texto);
    return;
  }

  await answerCallbackQuery({ callback_query_id: queryId, text: "No se pudo mover la cita.", show_alert: true });
  const texto = "No pude mover tu cita a ese horario. Escríbeme y te ayudo.";
  await enqueue({ workspaceId: ws.id, conversationId: conv.conversationId, chatId: ev.chatId, texto });
  await insertOutbound(ws, conv, texto);
}
