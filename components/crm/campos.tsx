"use client";

// Piezas compartidas de las pantallas del CRM (comercial y administración):
// campos de negocio, contacto y jornada; formato de fechas e importes; y la lista
// de visitas con sus hechos. Mismo lenguaje visual que el panel (Interacciones).

import { useId, type ReactNode } from "react";
import { MessageCircle, Phone } from "lucide-react";
import { Chips, Etiqueta, cx } from "@/app/admin/(panel)/interacciones/ui";
import {
  DECISOR, INTERESES, NECESIDADES, PACKS, PRIORIDADES, UNIDADES_COMBUSTIBLE, enlaceWhatsapp, texto,
  type Catalogo, type ContactoDto, type Decisor, type EstadoNegocio, type JornadaDto, type Prioridad, type VisitaDto,
} from "@/lib/crmB1";

export const INPUT =
  "w-full min-h-11 rounded-xl border border-white/15 bg-black px-3 py-2 text-base text-white outline-none placeholder:text-white/30 focus:border-red-500 disabled:opacity-50";

const ZONA = "America/Argentina/Cordoba";
const F_FECHA = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });
const F_HORA = new Intl.DateTimeFormat("es-AR", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const F_FECHA_HORA = new Intl.DateTimeFormat("es-AR", { timeZone: ZONA, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const F_PESOS = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });

/** "YYYY-MM-DD" (día de negocio) → "jue 30/10". */
export const fechaCorta = (d: string | null) => (d ? F_FECHA.format(new Date(`${d}T12:00:00Z`)) : "—");
export const hora = (iso: string | null) => (iso ? F_HORA.format(new Date(iso)) : "—");
export const fechaHora = (iso: string | null) => (iso ? F_FECHA_HORA.format(new Date(iso)) : "—");
export const pesos = (n: number | null) => (n === null ? "sin cargar" : F_PESOS.format(n));

// ── Campos básicos ──────────────────────────────────────────────────────────
export function CampoTexto({ etiqueta, valor, onCambio, ayuda, max, tipo = "text", modo, autoFoco, placeholder }: {
  etiqueta: string; valor: string; onCambio: (v: string) => void; ayuda?: ReactNode; max?: number; tipo?: string;
  modo?: "text" | "tel" | "decimal" | "numeric" | "url"; autoFoco?: boolean; placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold text-white/80">{etiqueta}</label>
      <input id={id} type={tipo} inputMode={modo} maxLength={max} value={valor} onChange={(e) => onCambio(e.target.value)} autoFocus={autoFoco}
        placeholder={placeholder} autoComplete="off" className={INPUT} />
      {ayuda ? <p className="text-xs text-white/50">{ayuda}</p> : null}
    </div>
  );
}

export function Selector({ etiqueta, valor, onCambio, opciones, vacio = "Sin elegir", ayuda }: {
  etiqueta: string; valor: string; onCambio: (v: string) => void; opciones: Array<{ valor: string; texto: string }>; vacio?: string; ayuda?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold text-white/80">{etiqueta}</label>
      <select id={id} value={valor} onChange={(e) => onCambio(e.target.value)} className={INPUT}>
        <option value="">{vacio}</option>
        {opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
      </select>
      {ayuda ? <p className="text-xs text-white/50">{ayuda}</p> : null}
    </div>
  );
}

/** Número opcional: vacío = sin cargar (null); "0" = cero confirmado. */
export function CampoNumero({ etiqueta, valor, onCambio, ayuda, decimales = true }: {
  etiqueta: string; valor: string; onCambio: (v: string) => void; ayuda?: ReactNode; decimales?: boolean;
}) {
  return <CampoTexto etiqueta={etiqueta} valor={valor} onCambio={(v) => onCambio(v.replace(decimales ? /[^\d,.]/g : /\D/g, ""))} modo={decimales ? "decimal" : "numeric"} ayuda={ayuda} max={14} />;
}
/** "1.234,5" y "12.5" son decimales; "12.345" son miles (como se escribe en Argentina). */
export const aNumero = (v: string): number | null => {
  let t = v.trim();
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (!/^\d+\.\d{1,2}$/.test(t)) t = t.replace(/\./g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
export const deNumero = (n: number | null) => (n === null ? "" : String(n).replace(".", ","));

// ── Negocio ─────────────────────────────────────────────────────────────────
export type ValoresEmpresa = { nombre_comercial: string; rubro: string; rubro_detalle: string; direccion: string; zona_id: string; instagram: string; web: string; prioridad: Prioridad | null };
export const empresaVacia = (nombre = "", zona = ""): ValoresEmpresa => ({ nombre_comercial: nombre, rubro: "", rubro_detalle: "", direccion: "", zona_id: zona, instagram: "", web: "", prioridad: null });
export const OTRO_RUBRO = "__otro__";

/** Datos de negocio para la API: el rubro es uno de la lista O una descripción libre (nunca ambos). */
export function datosEmpresa(v: ValoresEmpresa, completos = true): Record<string, unknown> {
  const d: Record<string, unknown> = {
    nombre_comercial: v.nombre_comercial.trim(),
    rubro_id: v.rubro && v.rubro !== OTRO_RUBRO ? v.rubro : null,
    rubro_detalle: v.rubro === OTRO_RUBRO && v.rubro_detalle.trim() ? v.rubro_detalle.trim() : null,
    direccion: v.direccion.trim() || null, zona_id: v.zona_id || null,
  };
  if (completos) Object.assign(d, { instagram: v.instagram.trim() || null, web: v.web.trim() || null, prioridad: v.prioridad });
  return d;
}

export function CamposEmpresa({ valores, onCambio, catalogo, completos = true, autoFoco }: {
  valores: ValoresEmpresa; onCambio: (v: ValoresEmpresa) => void; catalogo: Catalogo; completos?: boolean; autoFoco?: boolean;
}) {
  const cambiar = <K extends keyof ValoresEmpresa>(k: K, v: ValoresEmpresa[K]) => onCambio({ ...valores, [k]: v });
  return (
    <div className="space-y-4">
      <CampoTexto etiqueta="Nombre comercial" valor={valores.nombre_comercial} onCambio={(v) => cambiar("nombre_comercial", v)} max={120} autoFoco={autoFoco} />
      <Selector etiqueta="Rubro" valor={valores.rubro} onCambio={(v) => cambiar("rubro", v)} vacio="Sin elegir"
        opciones={[...catalogo.rubros.filter((r) => r.activo).map((r) => ({ valor: r.id, texto: r.nombre })), { valor: OTRO_RUBRO, texto: "No está en la lista…" }]} />
      {valores.rubro === OTRO_RUBRO ? (
        <CampoTexto etiqueta="¿Qué rubro es?" valor={valores.rubro_detalle} onCambio={(v) => cambiar("rubro_detalle", v)} max={80}
          ayuda="Se guarda como descripción del negocio; la administración decide si lo suma a la lista." />
      ) : null}
      <CampoTexto etiqueta="Dirección" valor={valores.direccion} onCambio={(v) => cambiar("direccion", v)} max={200} />
      {catalogo.zonas.length ? (
        <Selector etiqueta="Zona" valor={valores.zona_id} onCambio={(v) => cambiar("zona_id", v)} opciones={catalogo.zonas.filter((z) => z.activo).map((z) => ({ valor: z.id, texto: z.nombre }))} />
      ) : null}
      {completos ? (
        <>
          <CampoTexto etiqueta="Instagram" valor={valores.instagram} onCambio={(v) => cambiar("instagram", v)} max={100} placeholder="@negocio" />
          <CampoTexto etiqueta="Web" valor={valores.web} onCambio={(v) => cambiar("web", v)} max={200} modo="url" />
          <Chips etiqueta="Prioridad" opciones={PRIORIDADES} valor={valores.prioridad} onCambio={(v) => cambiar("prioridad", v)} ayuda="Sin elegir = sin clasificar." />
        </>
      ) : null}
    </div>
  );
}

// ── Contacto ────────────────────────────────────────────────────────────────
export type ValoresContacto = { nombre: string; cargo: string; telefono: string; tiene_whatsapp: "si" | "no" | null; es_decisor: Decisor | null };
export const contactoVacio = (): ValoresContacto => ({ nombre: "", cargo: "", telefono: "", tiene_whatsapp: null, es_decisor: null });
export const datosContacto = (v: ValoresContacto) => ({
  nombre: v.nombre.trim() || null, cargo: v.cargo.trim() || null, telefono: v.telefono.trim() || null,
  tiene_whatsapp: v.tiene_whatsapp === null ? null : v.tiene_whatsapp === "si", es_decisor: v.es_decisor ?? "no_sabe",
});

export function CamposContacto({ valores, onCambio, autoFoco }: { valores: ValoresContacto; onCambio: (v: ValoresContacto) => void; autoFoco?: boolean }) {
  const cambiar = <K extends keyof ValoresContacto>(k: K, v: ValoresContacto[K]) => onCambio({ ...valores, [k]: v });
  return (
    <div className="space-y-4">
      <CampoTexto etiqueta="Nombre" valor={valores.nombre} onCambio={(v) => cambiar("nombre", v)} max={80} autoFoco={autoFoco} />
      <CampoTexto etiqueta="Cargo o rol" valor={valores.cargo} onCambio={(v) => cambiar("cargo", v)} max={80} placeholder="Dueño, encargada…" />
      <CampoTexto etiqueta="Teléfono / WhatsApp" valor={valores.telefono} onCambio={(v) => cambiar("telefono", v)} max={40} tipo="tel" modo="tel"
        ayuda="Un solo número; si es el central del local, también vale." />
      {valores.telefono.trim() ? (
        <Chips etiqueta="¿Tiene WhatsApp?" opciones={[{ valor: "si", texto: "Sí" }, { valor: "no", texto: "No" }] as const} valor={valores.tiene_whatsapp}
          onCambio={(v) => cambiar("tiene_whatsapp", v)} ayuda="Sin elegir = no sabemos." />
      ) : null}
      <Chips etiqueta="¿Decide la compra?" opciones={DECISOR} valor={valores.es_decisor} onCambio={(v) => cambiar("es_decisor", v)} ayuda="Sin elegir = no sabemos." />
    </div>
  );
}

export function TelefonoContacto({ c }: { c: Pick<ContactoDto, "telefono" | "telefono_normalizado" | "tiene_whatsapp"> }) {
  if (!c.telefono) return <span className="text-white/40">Sin teléfono</span>;
  const wa = c.tiene_whatsapp === false ? null : enlaceWhatsapp(c.telefono_normalizado);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <a href={`tel:+${c.telefono_normalizado ?? ""}`} className="inline-flex items-center gap-1 font-semibold text-white underline-offset-2 hover:underline">
        <Phone className="h-3.5 w-3.5" aria-hidden />{c.telefono}
      </a>
      {wa ? (
        <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-green-300 underline-offset-2 hover:underline">
          <MessageCircle className="h-3.5 w-3.5" aria-hidden />WhatsApp
        </a>
      ) : null}
    </span>
  );
}

// ── Jornada ─────────────────────────────────────────────────────────────────
export type ValoresJornada = { nombre: string; zona_id: string; km_inicial: string; km_final: string; combustible_cantidad: string; combustible_unidad: string;
  combustible_importe: string; estacionamiento_importe: string; peajes_importe: string; otros_importe: string; otros_detalle: string };
export const valoresJornada = (j?: JornadaDto | null): ValoresJornada => ({
  nombre: j?.nombre ?? "", zona_id: j?.zona_id ?? "", km_inicial: deNumero(j?.km_inicial ?? null), km_final: deNumero(j?.km_final ?? null),
  combustible_cantidad: deNumero(j?.combustible_cantidad ?? null), combustible_unidad: j?.combustible_unidad ?? "", combustible_importe: deNumero(j?.combustible_importe ?? null),
  estacionamiento_importe: deNumero(j?.estacionamiento_importe ?? null), peajes_importe: deNumero(j?.peajes_importe ?? null),
  otros_importe: deNumero(j?.otros_importe ?? null), otros_detalle: j?.otros_detalle ?? "",
});
export const datosJornada = (v: ValoresJornada) => ({
  nombre: v.nombre.trim() || null, zona_id: v.zona_id || null, km_inicial: aNumero(v.km_inicial), km_final: aNumero(v.km_final),
  combustible_cantidad: aNumero(v.combustible_cantidad), combustible_unidad: aNumero(v.combustible_cantidad) === null ? null : v.combustible_unidad || null,
  combustible_importe: aNumero(v.combustible_importe), estacionamiento_importe: aNumero(v.estacionamiento_importe), peajes_importe: aNumero(v.peajes_importe),
  otros_importe: aNumero(v.otros_importe), otros_detalle: v.otros_detalle.trim() || null,
});

export function CamposJornada({ valores, onCambio, catalogo, conKmFinal = true }: {
  valores: ValoresJornada; onCambio: (v: ValoresJornada) => void; catalogo: Catalogo; conKmFinal?: boolean;
}) {
  const cambiar = <K extends keyof ValoresJornada>(k: K, v: string) => onCambio({ ...valores, [k]: v });
  const sinGasto = (k: keyof ValoresJornada) => (
    <button type="button" onClick={() => cambiar(k, "0")} className="text-xs font-semibold text-white/60 underline underline-offset-2 hover:text-white">Sin gasto (0)</button>
  );
  const km = aNumero(valores.km_final) !== null && aNumero(valores.km_inicial) !== null ? aNumero(valores.km_final)! - aNumero(valores.km_inicial)! : null;
  return (
    <div className="space-y-4">
      <CampoTexto etiqueta="Nombre o descripción" valor={valores.nombre} onCambio={(v) => cambiar("nombre", v)} max={80} placeholder="Zona norte, mañana…" />
      {catalogo.zonas.length ? <Selector etiqueta="Zona" valor={valores.zona_id} onCambio={(v) => cambiar("zona_id", v)} opciones={catalogo.zonas.filter((z) => z.activo).map((z) => ({ valor: z.id, texto: z.nombre }))} /> : null}
      <div className="grid grid-cols-2 gap-3">
        <CampoNumero etiqueta="Km iniciales" valor={valores.km_inicial} onCambio={(v) => cambiar("km_inicial", v)} />
        {conKmFinal ? <CampoNumero etiqueta="Km finales" valor={valores.km_final} onCambio={(v) => cambiar("km_final", v)} /> : null}
      </div>
      {conKmFinal ? (
        <p className={cx("text-sm", km !== null && km < 0 ? "text-red-300" : "text-white/60")}>
          Km recorridos: {km === null ? "pendiente (falta un extremo)" : km < 0 ? "los finales no pueden ser menores que los iniciales" : km.toLocaleString("es-AR")}
        </p>
      ) : null}
      {conKmFinal ? (
        <>
          <p className="text-xs text-white/50">Gastos: vacío = sin cargar · 0 = no hubo gasto.</p>
          <div className="grid grid-cols-2 gap-3">
            <CampoNumero etiqueta="Combustible cargado" valor={valores.combustible_cantidad} onCambio={(v) => cambiar("combustible_cantidad", v)} />
            <Selector etiqueta="Unidad" valor={valores.combustible_unidad} onCambio={(v) => cambiar("combustible_unidad", v)} opciones={[...UNIDADES_COMBUSTIBLE]} />
          </div>
          <CampoNumero etiqueta="Gasto en combustible ($)" valor={valores.combustible_importe} onCambio={(v) => cambiar("combustible_importe", v)}
            ayuda={<>Es lo que se cargó y pagó en esta jornada, no lo consumido. {sinGasto("combustible_importe")}</>} />
          <CampoNumero etiqueta="Estacionamiento ($)" valor={valores.estacionamiento_importe} onCambio={(v) => cambiar("estacionamiento_importe", v)} ayuda={sinGasto("estacionamiento_importe")} />
          <CampoNumero etiqueta="Peajes ($)" valor={valores.peajes_importe} onCambio={(v) => cambiar("peajes_importe", v)} ayuda={sinGasto("peajes_importe")} />
          <CampoNumero etiqueta="Otros gastos ($)" valor={valores.otros_importe} onCambio={(v) => cambiar("otros_importe", v)} ayuda={sinGasto("otros_importe")} />
          <CampoTexto etiqueta="Detalle de otros gastos" valor={valores.otros_detalle} onCambio={(v) => cambiar("otros_detalle", v)} max={200} />
        </>
      ) : null}
    </div>
  );
}

// ── Estados y visitas ───────────────────────────────────────────────────────
const ESTADOS: Record<EstadoNegocio, { texto: string; tono: "neutro" | "rojo" | "verde" | "ambar" | "gris" }> = {
  por_visitar: { texto: "Por visitar", tono: "ambar" },
  visitado: { texto: "Visitado", tono: "neutro" },
  con_oportunidad: { texto: "Lead para seguimiento", tono: "verde" },
  archivado: { texto: "Archivado", tono: "gris" },
};
export const EstadoNegocioEtiqueta = ({ estado }: { estado: EstadoNegocio }) => <Etiqueta tono={ESTADOS[estado].tono}>{ESTADOS[estado].texto}</Etiqueta>;

/** Hechos de una visita en palabras (lo que se registró, sin inferir). */
export function hechosVisita(v: VisitaDto): string[] {
  const h: string[] = [];
  if (v.cerrado) h.push("Cerrado / no atendieron");
  if (v.hablo_con_responsable) h.push("Habló con el responsable");
  if (v.hablo_con_empleado) h.push("Habló con un empleado");
  if (v.responsable_ausente) h.push("El responsable no estaba");
  if (v.contacto_util) h.push("Contacto útil obtenido");
  if (v.decisor_contactado) h.push("Habló con un decisor");
  else if (v.hablo_con_contacto) h.push("Habló con el contacto");
  return h;
}

export function ResumenVisita({ v, acciones }: { v: VisitaDto; acciones?: ReactNode }) {
  return (
    <li className={cx("rounded-2xl border p-4", v.anulada ? "border-white/5 bg-white/[0.01] opacity-60" : "border-white/10 bg-white/[0.03]")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {v.empresa ? <p className="font-bold">{v.empresa}</p> : null}
          <p className="text-sm text-white/60">{fechaCorta(v.fecha)} · {hora(v.ocurrida_en)} · {v.realizada_por.nombre}
            {v.registrada_por.tipo === "admin" ? " · cargada por Administración" : ""}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {v.anulada ? <Etiqueta tono="gris">Anulada</Etiqueta> : null}
          {v.es_origen_oportunidad ? <Etiqueta tono="verde">Originó el lead</Etiqueta> : null}
        </div>
      </div>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {hechosVisita(v).map((h) => <li key={h}><Etiqueta>{h}</Etiqueta></li>)}
        <li><Etiqueta tono={v.interes ? "rojo" : "gris"}>Interés: {texto(INTERESES, v.interes) ?? "no evaluado"}</Etiqueta></li>
        {v.pack_potencial ? <li><Etiqueta>{texto(PACKS, v.pack_potencial)}</Etiqueta></li> : null}
      </ul>
      {v.contacto ? <p className="mt-2 text-sm text-white/70">Contacto: {v.contacto.nombre ?? "sin nombre"}{v.contacto.cargo ? ` (${v.contacto.cargo})` : ""}</p> : null}
      {v.necesidades.length ? (
        <p className="mt-1 text-sm text-white/70">Necesidades: {v.necesidades.map((n) => (n === "otra" ? v.necesidad_otra ?? "Otra" : texto(NECESIDADES, n))).join(", ")}</p>
      ) : null}
      {v.volver_otro_dia ? <p className="mt-1 text-sm text-white/70">Volver otro día{v.revisita_para ? `: ${fechaCorta(v.revisita_para)}` : ""}</p> : null}
      {v.observacion ? <p className="mt-2 whitespace-pre-wrap text-sm text-white/80">“{v.observacion}”</p> : null}
      {v.anulada_motivo ? <p className="mt-2 text-sm text-amber-200">Anulada: {v.anulada_motivo}</p> : null}
      {v.notas.length ? (
        <ul className="mt-3 space-y-1 border-t border-white/10 pt-2">
          {v.notas.map((n) => <li key={n.id} className="text-sm text-white/70"><span className="text-white/50">{fechaHora(n.creada_en)} · {n.autor.nombre}:</span> {n.texto}</li>)}
        </ul>
      ) : null}
      {acciones ? <div className="mt-3 flex flex-wrap gap-2">{acciones}</div> : null}
    </li>
  );
}
