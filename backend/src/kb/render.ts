import { createHash } from "node:crypto";

/**
 * Renderiza business_info.structured a texto plano para el system prompt.
 *
 * ⚠️ DETERMINISTA O NO SIRVE. Este texto entra al prefijo cacheado de DeepSeek.
 * Un hit cuesta 50× menos que un miss, y el match se evalúa desde el token 0:
 * si el texto cambia entre ejecuciones, el cache no pega nunca.
 *
 * Reglas que lo garantizan:
 *   1. Orden fijo de secciones y de claves. Nunca iterar un objeto sin ordenar.
 *   2. Formato de número fijo: 120000 → "$120.000", siempre igual.
 *   3. Saltos de línea "\n", nunca "\r\n". En Windows esto muerde.
 *   4. Cero datos volátiles: ni fecha, ni hora, ni "generado el...".
 *
 * Y dos cosas que NUNCA pueden llegar al prompt, porque las lee un paciente:
 *   · Los placeholders `<<EDITAR>>`  → se omiten, y se cuentan.
 *   · Los marcadores `#dato-ficticio` → se recortan del texto.
 */

export const EDITAR = "<<EDITAR>>";
const MARCA_FICTICIA = /\s*#dato-ficticio\b[^\n]*/gi;

export type Servicio = {
  slug: string;
  name: string;
  duration_min: number;
  buffer_min: number;
  price_from: number | null;
  price_note: string | null;
  requires_eval: boolean;
  sort_order: number;
  is_active: boolean;
  ficticio: string;
};

export type RenderResult = {
  text: string;
  hash: string;
  bytes: number;
  omitidos: string[];   // rutas con <<EDITAR>> que se dejaron fuera
  ficticios: string[];  // rutas con valores inventados que SÍ entraron
};

// ── helpers ──────────────────────────────────────────────────

/** `true` si el valor es un placeholder sin rellenar. */
function esEditar(v: unknown): boolean {
  return typeof v === "string" && v.trim() === EDITAR;
}

/** Limpia un valor de texto: recorta marcadores internos y normaliza espacios. */
function limpio(v: string): string {
  return v.replace(MARCA_FICTICIA, "").replace(/\s+/g, " ").trim();
}

/**
 * Formatea los montos en pesos que vengan sueltos dentro de un texto.
 * "Porcelana desde 1200000" → "Porcelana desde $1.200.000".
 * Solo toca runs de 6 a 8 dígitos: por debajo son duraciones o cantidades.
 */
function montosEnTexto(v: string): string {
  return v.replace(/(?<![\d$.])\d{6,8}(?![\d.])/g, (m) => cop(Number(m)));
}

/** 120000 → "$120.000". Formato FIJO, sin Intl (que depende del ICU del runtime). */
export function cop(n: number): string {
  const entero = Math.round(n).toString();
  const conPuntos = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `$${conPuntos}`;
}

/**
 * Precio de un servicio, en prosa natural. Lo lee un paciente a través del
 * modelo, así que "desde $120.000" y no "$120.000 desde".
 * La valoración gratis es 0, no null: es un dato, no un hueco.
 */
function precio(s: Servicio): string {
  if (s.price_from === null) return "precio por confirmar";
  if (s.price_from === 0) return "gratuita";

  const monto = cop(s.price_from);
  const nota = s.price_note ? montosEnTexto(limpio(s.price_note)) : "";
  if (!nota) return `desde ${monto}`;

  // La nota suele empezar por "desde": se antepone en vez de quedar colgando.
  const m = nota.match(/^desde\b[;,]?\s*(.*)$/i);
  if (m) {
    const resto = m[1] ?? "";
    return resto ? `desde ${monto} · ${resto}` : `desde ${monto}`;
  }
  return `${monto} · ${nota}`;
}

// ── el renderer ──────────────────────────────────────────────

export function render(structured: unknown, servicios: Servicio[]): RenderResult {
  const d = structured as Record<string, any>;
  const L: string[] = [];
  const omitidos: string[] = [];
  const ficticios: string[] = [];

  /** Añade "etiqueta: valor" si el valor existe y no es un placeholder. */
  const linea = (etiqueta: string, valor: unknown, ruta: string) => {
    if (valor === null || valor === undefined || valor === "") return;
    if (esEditar(valor)) { omitidos.push(ruta); return; }
    const txt = limpio(String(valor));
    if (txt === "") return;
    L.push(etiqueta ? `${etiqueta}: ${txt}` : txt);
  };

  /** Registra qué campos de un bloque vienen marcados como inventados. */
  const marcarFicticios = (bloque: any, prefijo: string) => {
    const f = bloque?._ficticio;
    if (f === true) ficticios.push(prefijo);
    else if (Array.isArray(f)) for (const k of f) ficticios.push(`${prefijo}.${k}`);
  };

  // ── 1 · Negocio ────────────────────────────────────────────
  const n = d.negocio ?? {};
  L.push("# LA CLÍNICA");
  linea("Nombre", n.nombre, "negocio.nombre");
  linea("Tipo", n.tipo, "negocio.tipo");
  const ubic = [n.ciudad, n.departamento, n.pais].filter((x) => x && !esEditar(x)).join(", ");
  if (ubic) L.push(`Ciudad: ${ubic}`);

  // ── 2 · Sedes ──────────────────────────────────────────────
  const sedes: any[] = Array.isArray(d.sedes) ? d.sedes : [];
  if (sedes.length) {
    L.push("", "# DÓNDE ESTAMOS Y CÓMO CONTACTARNOS");
    sedes.forEach((s, i) => {
      const p = `sedes[${i}]`;
      marcarFicticios(s, p);
      linea("Dirección", s.direccion, `${p}.direccion`);
      linea("Cómo llegar", s.indicaciones, `${p}.indicaciones`);
      linea("Teléfono", s.telefono, `${p}.telefono`);
      if (s.whatsapp && s.whatsapp !== s.telefono) linea("WhatsApp", s.whatsapp, `${p}.whatsapp`);
      // `coordenadas` y `maps` NO entran: no le sirven a un paciente en un chat
      // y el link es un placeholder que apunta al vault.
    });
  }

  // ── 3 · Horario ────────────────────────────────────────────
  const h = d.horario ?? {};
  L.push("", "# HORARIO DE ATENCIÓN");
  linea("Lunes a viernes", h.lunes_viernes, "horario.lunes_viernes");
  linea("Sábado", h.sabado, "horario.sabado");
  linea("Domingo", h.domingo, "horario.domingo");
  if (h.almuerzo) linea("Cierre de mediodía", h.almuerzo, "horario.almuerzo");
  else L.push("La jornada de lunes a viernes es continua, sin cierre al mediodía.");

  // ── 4 · Servicios ──────────────────────────────────────────
  // Orden por sort_order y, a igualdad, por slug: estable aunque cambie el CSV.
  const activos = servicios
    .filter((s) => s.is_active)
    .sort((a, b) => a.sort_order - b.sort_order || a.slug.localeCompare(b.slug, "es"));

  L.push("", "# SERVICIOS Y PRECIOS");
  L.push("Todos los precios son DESDE. El precio real se define en la valoración.");
  for (const s of activos) {
    const partes = [`${s.name} (${s.slug})`, `${s.duration_min} min`, precio(s)];
    if (s.requires_eval) partes.push("requiere valoración previa");
    L.push(`- ${partes.join(" · ")}`);
    if (s.ficticio && s.ficticio !== "no") ficticios.push(`services.${s.slug}:${s.ficticio}`);
  }

  // ── 5 · Equipo ─────────────────────────────────────────────
  const equipo: any[] = Array.isArray(d.equipo) ? d.equipo : [];
  const conNombre = equipo.filter((m) => m?.nombre && !esEditar(m.nombre));
  equipo.forEach((m, i) => {
    if (esEditar(m?.nombre)) omitidos.push(`equipo[${i}].nombre`);
    marcarFicticios(m, `equipo[${i}]`);
  });
  if (conNombre.length) {
    L.push("", "# EQUIPO");
    for (const m of conNombre) {
      const esp = m.especialidad && !esEditar(m.especialidad) ? ` — ${limpio(m.especialidad)}` : "";
      L.push(`- ${limpio(m.nombre)}${esp}`);
    }
  }

  // ── 6 · Pagos ──────────────────────────────────────────────
  const pg = d.pagos ?? {};
  marcarFicticios(pg, "pagos");
  const medios: string[] = Array.isArray(pg.medios)
    ? pg.medios.filter((m: unknown) => m && !esEditar(m)).map((m: string) => limpio(m))
    : [];
  if (medios.length || pg.financiacion || pg.eps_prepagadas) {
    L.push("", "# PAGOS");
    if (medios.length) L.push(`Medios de pago: ${medios.join(", ")}.`);
    linea("Financiación", pg.financiacion, "pagos.financiacion");
    linea("EPS y prepagadas", pg.eps_prepagadas, "pagos.eps_prepagadas");
  }

  // ── 7 · Políticas ──────────────────────────────────────────
  const po = d.politicas ?? {};
  marcarFicticios(po, "politicas");
  L.push("", "# POLÍTICAS");
  linea("Cancelación", po.cancelacion, "politicas.cancelacion");
  linea("Llegada tarde", po.llegada_tarde, "politicas.llegada_tarde");
  linea("Primera cita", po.primera_cita, "politicas.primera_cita");

  // ── 8 · FAQs ───────────────────────────────────────────────
  const faqs: any[] = Array.isArray(d.faqs) ? d.faqs : [];
  const utiles = faqs.filter((f, i) => {
    marcarFicticios(f, `faqs[${i}]`);
    if (esEditar(f?.r)) { omitidos.push(`faqs[${i}].r`); return false; }
    return f?.p && f?.r;
  });
  if (utiles.length) {
    L.push("", "# PREGUNTAS FRECUENTES");
    for (const f of utiles) L.push(`P: ${limpio(f.p)}`, `R: ${limpio(f.r)}`);
  }

  // Unión con \n explícito y un único salto final: sin \r\n, sin cola variable.
  const text = L.join("\n").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";

  return {
    text,
    hash: createHash("sha256").update(text, "utf8").digest("hex"),
    bytes: Buffer.byteLength(text, "utf8"),
    omitidos,
    ficticios,
  };
}

/** Estimación de tokens, ~3.5 bytes/token para español. Solo para el umbral de RAG. */
export function tokensAprox(bytes: number): number {
  return Math.round(bytes / 3.5);
}
