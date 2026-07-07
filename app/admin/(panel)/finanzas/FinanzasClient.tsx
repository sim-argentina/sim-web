"use client";

// Módulo Finanzas — UI admin (modelo de caja de SIM).
// Sin ámbitos, sin Banco, sin retiros. Cuentas: Efectivo / Mercado Pago.
// Saldo inicial general, "Mi sueldo", métricas con detalle y diagnóstico.

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarioFinanciero, SaludFinanciera } from "./CalendarioFinanciero";

// ── Tipos ────────────────────────────────────────────────────────────────────

type Cuenta = { id: string; nombre: string; tipo: string; activa: boolean; orden: number };

type Categoria = {
  id: string;
  nombre: string;
  tipo: "ingreso" | "costo" | "gasto" | "inversion" | "sueldo_personal" | "ajuste";
  activa: boolean;
  orden: number;
  protegida: boolean;
};

type Movimiento = {
  id: string;
  fecha: string;
  mes_contable: string;
  tipo: "ingreso" | "egreso" | "transferencia" | "ajuste";
  clasificacion: string;
  cuenta_origen_id: string | null;
  cuenta_destino_id: string | null;
  categoria_id: string | null;
  descripcion: string;
  monto: number;
  observaciones: string | null;
  origen: string;
};

type PorFuente = {
  tipo: "efectivo" | "mercado_pago";
  nombre: string;
  ingresos: number;
  financiamiento: number;
  costos: number;
  gastos: number;
  inversiones: number;
  gastosSueldo: number;
  otros: number;
  pagosDeuda: number;
  transferenciasEntrantes: number;
  transferenciasSalientes: number;
  egresos: number;
  neto: number;
};

type IngresoAuto = {
  fuente: string;
  fuenteLabel: string;
  categoria: string;
  metodo: string;
  cuentaTipo: string;
  total: number;
  cantidad: number;
};

type ResumenApi = {
  mes: string;
  antes_de_inicio?: boolean;
  mes_inicio?: string;
  resumen: {
    ingresosAutomaticos: number;
    ingresosManuales: number;
    ingresos: number;
    financiamiento: number;
    costos: number;
    gastos: number;
    inversiones: number;
    gastosSueldo: number;
    pagosDeuda: number;
    otros: number;
    ajustesNet: number;
    sueldoAsignado: number;
    sueldoDisponible: number;
    resultadoOperativo: number;
    saldoInicialGeneral: number;
    saldoFinalTeoricoGeneral: number;
    turnosDelMes: number;
    porFuente: PorFuente[];
    sueldoPorCategoria: Record<string, number>;
    sueldoPorFuente: Record<string, number>;
  };
  saldoInicialPorFuente?: { efectivo: number; mercado_pago: number; desglosado: boolean };
  ingresosAutomaticos: IngresoAuto[];
  cierre: { estado: string; saldo_real_general: number | null; diferencia_general: number | null };
};

type Regla = {
  id: string;
  keyword: string;
  tipo_sugerido: string | null;
  clasificacion_sugerida: string | null;
  categoria_id: string | null;
  cuenta_id: string | null;
  prioridad: number;
  activa: boolean;
  categoria?: { id: string; nombre: string } | null;
  cuenta?: { id: string; nombre: string } | null;
};

type RubroCat = { categoria: string; total: number; cantidad: number; efectivo: number; mercado_pago: number };
type PorFuenteApi = {
  tipo: "efectivo" | "mercado_pago";
  nombre: string;
  ingresos: number;
  financiamiento: number;
  costos: number;
  gastos: number;
  inversiones: number;
  gastosSueldo: number;
  otros: number;
  pagosDeuda: number;
  transferenciasEntrantes: number;
  transferenciasSalientes: number;
  egresos: number;
  neto: number;
};
type CierreApi = {
  mes: string;
  estado: string;
  observaciones: string | null;
  cerrado_at: string | null;
  saldo_inicial_general: number;
  saldo_teorico_general: number;
  saldo_real_guardado: number | null;
  diferencia_guardada: number | null;
  desglose: { ingresos: number; financiamiento: number; costos: number; gastos: number; inversiones: number; gastos_sueldo: number; pagos_deuda: number; otros: number; ajustes: number };
  por_fuente: PorFuenteApi[];
  detalle: {
    ingresos: { total: number; automaticos: Array<{ fuente: string; total: number; cantidad: number }>; automaticos_total: number; manuales_por_categoria: RubroCat[]; manuales_total: number };
    costos_por_categoria: RubroCat[];
    gastos_por_categoria: RubroCat[];
    inversiones_por_categoria: RubroCat[];
    otros_por_categoria: RubroCat[];
    sueldo_por_categoria: RubroCat[];
    sueldo_total: number;
    sueldo_asignado: number;
    financiamiento: { total: number; items: Array<{ id: string; fecha: string; descripcion: string; monto: number; fuente: string | null }> };
    pagos_deuda_por_categoria: RubroCat[];
  };
};

type MetricasApi = {
  mes: string;
  metricas: Record<string, number | null> & { estructura_costos: Record<string, number | null> };
  serie: Array<{ mes: string; ingresos: number; costos: number; gastos: number; resultado_operativo: number; turnos: number }>;
  contexto: Record<string, number | boolean | null>;
};

type Configuracion = Record<string, number | string>;
type Excepcion = { id: string; fecha: string; cerrado: boolean; horas: number | null; simuladores: number | null; motivo: string | null };

type Sugerencia = {
  tipo: "ingreso" | "egreso" | "transferencia" | "ajuste";
  clasificacion: string;
  cuenta_origen_id: string | null;
  cuenta_destino_id: string | null;
  categoria_id: string | null;
  categoria_nombre: string | null;
  monto: number | null;
  descripcion: string;
  confianza: number;
  requiere_confirmacion: boolean;
};

// ── Utilidades ───────────────────────────────────────────────────────────────

function mesActualLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function fechaHoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dinero(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const s = `$${abs.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;
  return v < 0 ? `-${s}` : s;
}
function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${(v * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`;
}
function labelMes(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const n = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return `${n[m - 1]} ${y}`;
}
function labelMesLargo(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const n = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return `${n[m - 1]} ${y}`;
}
function tipoCuentaLabel(t: string): string {
  return t === "efectivo" ? "Efectivo" : "Mercado Pago";
}

const TIPO_LABEL: Record<string, string> = { ingreso: "Ingreso", egreso: "Egreso", transferencia: "Transferencia", ajuste: "Ajuste" };
const CLASIF_LABEL: Record<string, string> = {
  ingreso: "Ingreso", costo: "Costo", gasto: "Gasto", inversion: "Inversión",
  sueldo_personal: "Mi sueldo", ajuste: "Ajuste", otro: "Otro", retiro: "Mi sueldo",
};
const TIPO_CAT_LABEL: Record<string, string> = {
  ingreso: "Ingreso", costo: "Costo", gasto: "Gasto", inversion: "Inversión", sueldo_personal: "Sueldo personal", ajuste: "Ajuste", retiro: "Retiro",
};

// Orden de las categorías en el selector: primero por clasificación, luego por orden/nombre.
const ORDEN_TIPO_CAT: Record<string, number> = {
  ingreso: 0, costo: 1, gasto: 2, inversion: 3, sueldo_personal: 4, retiro: 5, ajuste: 6,
};

// Al elegir una categoría, el movimiento adopta la clasificación (y el tipo/es-sueldo
// coherente) de esa categoría, para que lo guardado y las métricas queden consistentes.
function movDesdeCategoria(catTipo: string): { tipo: "ingreso" | "egreso" | "ajuste"; clasificacion: string; esSueldo: boolean } {
  switch (catTipo) {
    case "ingreso": return { tipo: "ingreso", clasificacion: "ingreso", esSueldo: false };
    case "costo": return { tipo: "egreso", clasificacion: "costo", esSueldo: false };
    case "inversion": return { tipo: "egreso", clasificacion: "inversion", esSueldo: false };
    case "sueldo_personal":
    case "retiro": return { tipo: "egreso", clasificacion: "sueldo_personal", esSueldo: true };
    case "gasto":
    default: return { tipo: "egreso", clasificacion: "gasto", esSueldo: false };
  }
}

const TABS = [
  { id: "resumen", label: "Resumen" },
  { id: "movimientos", label: "Movimientos" },
  { id: "cierre", label: "Cierre mensual" },
  { id: "sueldo", label: "Mi sueldo" },
  { id: "calendario", label: "Calendario financiero" },
  { id: "categorias", label: "Categorías" },
  { id: "reglas", label: "Reglas" },
  { id: "metricas", label: "Métricas" },
  { id: "config", label: "Config" },
] as const;
type TabId = (typeof TABS)[number]["id"];

// ── Formulario de movimiento ─────────────────────────────────────────────────

type MovForm = {
  id: string | null;
  fecha: string;
  tipo: "ingreso" | "egreso" | "ajuste";
  clasificacion: string;
  cuenta_origen_id: string;
  cuenta_destino_id: string;
  categoria_id: string;
  descripcion: string;
  monto: string;
  observaciones: string;
  esSueldo: boolean;
};
function movFormVacio(preset: Partial<MovForm> = {}): MovForm {
  return {
    id: null, fecha: fechaHoy(), tipo: "egreso", clasificacion: "gasto",
    cuenta_origen_id: "", cuenta_destino_id: "", categoria_id: "", descripcion: "", monto: "", observaciones: "", esSueldo: false,
    ...preset,
  };
}
type TransfForm = { fecha: string; cuenta_origen_id: string; cuenta_destino_id: string; monto: string; descripcion: string };

// ═════════════════════════════════════════════════════════════════════════════

export default function FinanzasClient() {
  const [mes, setMes] = useState(mesActualLocal());
  const [tab, setTab] = useState<TabId>("resumen");

  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [resumen, setResumen] = useState<ResumenApi | null>(null);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [reglas, setReglas] = useState<Regla[]>([]);
  const [cierre, setCierre] = useState<CierreApi | null>(null);
  const [metricas, setMetricas] = useState<MetricasApi | null>(null);
  const [config, setConfig] = useState<Configuracion | null>(null);

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [movForm, setMovForm] = useState<MovForm | null>(null);
  const [transfForm, setTransfForm] = useState<TransfForm | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [textoRapido, setTextoRapido] = useState("");
  const [clasificando, setClasificando] = useState(false);

  const cuentasPorId = useMemo(() => Object.fromEntries(cuentas.map((c) => [c.id, c])), [cuentas]);
  const categoriasPorId = useMemo(() => Object.fromEntries(categorias.map((c) => [c.id, c])), [categorias]);
  const cuentasActivas = useMemo(() => cuentas.filter((c) => c.activa), [cuentas]);

  const mostrarAviso = useCallback((msg: string) => {
    setAviso(msg);
    setTimeout(() => setAviso(null), 3500);
  }, []);

  const cargarBase = useCallback(async () => {
    try {
      const [rc, rcat] = await Promise.all([
        fetch("/api/admin/finanzas/cuentas", { cache: "no-store" }),
        fetch("/api/admin/finanzas/categorias", { cache: "no-store" }),
      ]);
      const dc = await rc.json();
      const dcat = await rcat.json();
      if (rc.ok) setCuentas(dc.cuentas || []);
      if (rcat.ok) setCategorias(dcat.categorias || []);
    } catch {
      setError("Error cargando datos base");
    }
  }, []);

  const cargarMes = useCallback(async (m: string) => {
    setCargando(true);
    setError(null);
    try {
      const [rr, rm] = await Promise.all([
        fetch(`/api/admin/finanzas/resumen?mes=${m}`, { cache: "no-store" }),
        fetch(`/api/admin/finanzas/movimientos?mes=${m}`, { cache: "no-store" }),
      ]);
      const dr = await rr.json();
      const dm = await rm.json();
      if (!rr.ok) throw new Error(dr.error || "Error");
      setResumen(dr);
      setMovimientos(rm.ok ? (dm.movimientos || []).map((x: Movimiento) => ({ ...x, monto: Number(x.monto) })) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando el mes");
    } finally {
      setCargando(false);
    }
  }, []);

  const cargarCierre = useCallback(async (m: string) => {
    const r = await fetch(`/api/admin/finanzas/cierre?mes=${m}`, { cache: "no-store" });
    const d = await r.json();
    if (r.ok && !d.antes_de_inicio) setCierre(d);
    else setCierre(null);
  }, []);
  const cargarReglas = useCallback(async () => {
    const r = await fetch("/api/admin/finanzas/reglas", { cache: "no-store" });
    const d = await r.json();
    if (r.ok) setReglas(d.reglas || []);
  }, []);
  const cargarMetricas = useCallback(async (m: string) => {
    const r = await fetch(`/api/admin/finanzas/metricas?mes=${m}`, { cache: "no-store" });
    const d = await r.json();
    setMetricas(r.ok && d.metricas ? d : null);
  }, []);
  const cargarConfig = useCallback(async () => {
    const r = await fetch("/api/admin/finanzas/configuracion", { cache: "no-store" });
    const d = await r.json();
    if (r.ok) setConfig(d.configuracion);
  }, []);

  useEffect(() => { cargarBase(); }, [cargarBase]);
  useEffect(() => {
    cargarMes(mes);
    if (tab === "cierre") cargarCierre(mes);
    if (tab === "metricas") cargarMetricas(mes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes]);
  useEffect(() => {
    if (tab === "cierre") cargarCierre(mes);
    if (tab === "reglas") cargarReglas();
    if (tab === "metricas") cargarMetricas(mes);
    if (tab === "config") cargarConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const refrescar = useCallback(() => {
    cargarMes(mes);
    if (tab === "cierre") cargarCierre(mes);
    if (tab === "metricas") cargarMetricas(mes);
  }, [mes, tab, cargarMes, cargarCierre, cargarMetricas]);

  const mesCerrado = resumen?.cierre?.estado && resumen.cierre.estado !== "abierto";
  const antesDeInicio = Boolean(resumen?.antes_de_inicio) && resumen?.mes === mes;
  const TABS_DATOS: TabId[] = ["resumen", "movimientos", "cierre", "sueldo", "calendario", "metricas"];

  async function guardarMovimiento() {
    if (!movForm) return;
    setGuardando(true);
    try {
      const payload = {
        fecha: movForm.fecha,
        tipo: movForm.tipo,
        clasificacion: movForm.esSueldo ? "sueldo_personal" : movForm.clasificacion,
        cuenta_origen_id: movForm.tipo === "ajuste" && movForm.cuenta_destino_id ? null : movForm.cuenta_origen_id || null,
        cuenta_destino_id: movForm.tipo === "ajuste" ? movForm.cuenta_destino_id || null : null,
        categoria_id: movForm.categoria_id || null,
        descripcion: movForm.descripcion,
        monto: Number(movForm.monto),
        observaciones: movForm.observaciones || null,
      };
      const url = movForm.id ? `/api/admin/finanzas/movimientos/${movForm.id}` : "/api/admin/finanzas/movimientos";
      const r = await fetch(url, {
        method: movForm.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) { alert(d.error || "Error guardando"); return; }
      setMovForm(null);
      mostrarAviso(movForm.id ? "Movimiento actualizado" : "Movimiento cargado");
      refrescar();
    } finally { setGuardando(false); }
  }

  async function eliminarMovimiento(id: string) {
    if (!confirm("¿Eliminar este movimiento?")) return;
    const r = await fetch(`/api/admin/finanzas/movimientos/${id}`, { method: "DELETE" });
    const d = await r.json();
    if (!r.ok) { alert(d.error || "Error eliminando"); return; }
    mostrarAviso("Movimiento eliminado");
    refrescar();
  }

  async function guardarTransferencia() {
    if (!transfForm) return;
    setGuardando(true);
    try {
      const r = await fetch("/api/admin/finanzas/transferencias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha: transfForm.fecha,
          cuenta_origen_id: transfForm.cuenta_origen_id || null,
          cuenta_destino_id: transfForm.cuenta_destino_id || null,
          monto: Number(transfForm.monto),
          descripcion: transfForm.descripcion || "Transferencia entre cuentas",
        }),
      });
      const d = await r.json();
      if (!r.ok) { alert(d.error || "Error creando transferencia"); return; }
      setTransfForm(null);
      mostrarAviso("Transferencia registrada");
      refrescar();
    } finally { setGuardando(false); }
  }

  const interpretar = useCallback(async (texto: string, forzarSueldo = false) => {
    const t = texto.trim();
    if (t.length < 3) return;
    // Fuerza la intención "Mi sueldo" cuando se carga desde la barra de sueldo.
    const consulta = forzarSueldo && !/sueldo|personal/i.test(t) ? `sueldo ${t}` : t;
    const r = await fetch("/api/admin/finanzas/clasificar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto: consulta }),
    });
    const d = await r.json();
    if (!r.ok) { alert(d.error || "No se pudo interpretar"); return; }
    const s: Sugerencia = d.sugerencia;
    if (s.tipo === "transferencia") {
      setTransfForm({ fecha: fechaHoy(), cuenta_origen_id: s.cuenta_origen_id || "", cuenta_destino_id: s.cuenta_destino_id || "", monto: s.monto ? String(s.monto) : "", descripcion: t });
    } else {
      const esSueldo = forzarSueldo || s.clasificacion === "sueldo_personal" || s.clasificacion === "retiro";
      setMovForm(movFormVacio({
        tipo: esSueldo ? "egreso" : s.tipo === "ajuste" ? "ajuste" : s.tipo,
        clasificacion: esSueldo ? "sueldo_personal" : s.clasificacion,
        esSueldo,
        cuenta_origen_id: s.cuenta_origen_id || "",
        categoria_id: s.categoria_id || "",
        descripcion: t,
        monto: s.monto ? String(s.monto) : "",
      }));
    }
  }, []);

  async function clasificarRapido() {
    if (textoRapido.trim().length < 3) return;
    setClasificando(true);
    try {
      await interpretar(textoRapido);
      setTextoRapido("");
    } finally { setClasificando(false); }
  }

  const categoriasForm = useMemo(() => {
    if (!movForm) return [];
    // TODAS las categorías configuradas, sin filtrar por la clasificación elegida:
    // se puede asignar cualquiera y, al elegirla, la clasificación del movimiento se
    // actualiza sola. Incluye activas e inactivas (compatibilidad con movimientos
    // viejos). Se excluye "ajuste" (los ajustes de saldo no usan este selector),
    // salvo que sea la categoría ya asignada al movimiento en edición.
    const actual = movForm.categoria_id || "";
    return categorias
      .filter((c) => c.tipo !== "ajuste" || c.id === actual)
      .sort((a, b) => {
        const ta = ORDEN_TIPO_CAT[a.tipo] ?? 99;
        const tb = ORDEN_TIPO_CAT[b.tipo] ?? 99;
        if (ta !== tb) return ta - tb;
        return (a.orden - b.orden) || a.nombre.localeCompare(b.nombre);
      });
  }, [categorias, movForm]);

  // Elegir una categoría: adopta su clasificación/tipo/es-sueldo para que quede coherente.
  const aplicarCategoria = (catId: string) => {
    setMovForm((f) => {
      if (!f) return f;
      if (!catId) return { ...f, categoria_id: "" };
      const cat = categoriasPorId[catId];
      if (!cat) return { ...f, categoria_id: catId };
      const m = movDesdeCategoria(cat.tipo);
      return { ...f, categoria_id: catId, tipo: m.tipo, clasificacion: m.clasificacion, esSueldo: m.esSueldo };
    });
  };

  const abrirGasto = () => setMovForm(movFormVacio({ tipo: "egreso", clasificacion: "gasto" }));
  const abrirIngreso = () => setMovForm(movFormVacio({ tipo: "ingreso", clasificacion: "ingreso" }));
  const abrirSueldo = () => setMovForm(movFormVacio({ tipo: "egreso", clasificacion: "sueldo_personal", esSueldo: true }));
  const abrirTransf = () => setTransfForm({ fecha: fechaHoy(), cuenta_origen_id: "", cuenta_destino_id: "", monto: "", descripcion: "" });

  const inputCls = "w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500";

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white md:px-6">
      <section className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.3em] text-red-500">Admin SIM</p>
            <h1 className="text-3xl font-black uppercase md:text-5xl">Finanzas</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/60">Caja del stand mes a mes: ingresos, gastos, mi sueldo y métricas.</p>
          </div>
          <div className="flex items-end gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Mes</label>
              <input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className="rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500" />
            </div>
            {mesCerrado && <span className="rounded-full border border-amber-500/50 bg-amber-950/30 px-4 py-2 text-xs font-black uppercase text-amber-400">Mes cerrado</span>}
          </div>
        </div>

        {/* Carga rápida */}
        <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex flex-col gap-2 md:flex-row">
            <input type="text" value={textoRapido} onChange={(e) => setTextoRapido(e.target.value)} onKeyDown={(e) => e.key === "Enter" && clasificarRapido()}
              placeholder='Carga rápida: "ingreso 50000 efectivo" · "venta 30000 mercado pago" · "ingreso 120000 mp" · "8500 nafta efectivo"'
              className={`${inputCls} placeholder:text-white/25`} />
            <button onClick={clasificarRapido} disabled={clasificando || textoRapido.trim().length < 3} className="rounded-xl bg-red-600 px-5 py-2 text-sm font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30">
              {clasificando ? "..." : "Interpretar"}
            </button>
          </div>
        </div>

        {/* Botonera */}
        <div className="mb-4 flex flex-wrap gap-2">
          <button onClick={abrirGasto} className="rounded-full bg-red-600 px-4 py-2 text-xs font-black uppercase transition hover:bg-red-700">+ Agregar gasto</button>
          <button onClick={abrirIngreso} className="rounded-full border border-white/15 px-4 py-2 text-xs font-black uppercase text-white/70 transition hover:border-red-500 hover:text-white">+ Ingreso manual</button>
          <button onClick={abrirSueldo} className="rounded-full border border-white/15 px-4 py-2 text-xs font-black uppercase text-white/70 transition hover:border-red-500 hover:text-white">+ Gasto de sueldo</button>
          <button onClick={abrirTransf} className="rounded-full border border-white/15 px-4 py-2 text-xs font-black uppercase text-white/70 transition hover:border-red-500 hover:text-white">⇄ Transferir</button>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03] p-1">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`whitespace-nowrap rounded-xl px-4 py-2 text-xs font-black uppercase transition ${tab === t.id ? "bg-red-600 text-white" : "text-white/50 hover:text-white"}`}>{t.label}</button>
          ))}
        </div>

        {aviso && <div className="mb-4 rounded-2xl border border-green-500/30 bg-green-950/30 px-4 py-3 text-sm font-bold text-green-400">{aviso}</div>}
        {error && <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm font-bold text-red-400">{error}</div>}

        {cargando && !resumen ? (
          <p className="text-white/60">Cargando finanzas...</p>
        ) : antesDeInicio && TABS_DATOS.includes(tab) ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center">
            <p className="text-lg font-black uppercase text-white/80">Finanzas comienza en {labelMesLargo(resumen?.mes_inicio || "2026-07")}.</p>
            <p className="mt-2 text-sm text-white/45">No se incluyen datos históricos anteriores. Elegí {labelMesLargo(resumen?.mes_inicio || "2026-07")} o un mes posterior.</p>
          </div>
        ) : (
          <>
            {tab === "resumen" && resumen && !resumen.antes_de_inicio && <TabResumen resumen={resumen} />}
            {tab === "movimientos" && (
              <TabMovimientos movimientos={movimientos} cuentasPorId={cuentasPorId} categoriasPorId={categoriasPorId} cuentas={cuentasActivas} categorias={categorias}
                onEditar={(m) => setMovForm({
                  id: m.id, fecha: m.fecha, tipo: m.tipo === "transferencia" ? "egreso" : (m.tipo as MovForm["tipo"]),
                  clasificacion: m.clasificacion, cuenta_origen_id: m.cuenta_origen_id || "", cuenta_destino_id: m.cuenta_destino_id || "",
                  categoria_id: m.categoria_id || "", descripcion: m.descripcion, monto: String(m.monto), observaciones: m.observaciones || "",
                  esSueldo: m.clasificacion === "sueldo_personal" || m.clasificacion === "retiro",
                })}
                onEliminar={eliminarMovimiento} />
            )}
            {tab === "cierre" && <TabCierre mes={mes} cierre={cierre} onHecho={() => { refrescar(); cargarCierre(mes); }} />}
            {tab === "sueldo" && resumen && <TabSueldo mes={mes} resumen={resumen} movimientos={movimientos} cuentasPorId={cuentasPorId} categoriasPorId={categoriasPorId} onAgregar={abrirSueldo} onHecho={() => mostrarAviso("Sueldo actualizado")} refrescar={refrescar} onCargaRapida={(texto) => interpretar(texto, true)} />}
            {tab === "calendario" && (
              <CalendarioFinanciero mes={mes} categorias={categorias} mostrarAviso={mostrarAviso} refrescarFinanzas={refrescar} />
            )}
            {tab === "categorias" && <TabCategorias categorias={categorias} onCambio={cargarBase} mostrarAviso={mostrarAviso} />}
            {tab === "reglas" && <TabReglas reglas={reglas} categorias={categorias} cuentas={cuentasActivas} onCambio={cargarReglas} mostrarAviso={mostrarAviso} />}
            {tab === "metricas" && (
              <div className="space-y-8">
                <TabMetricas metricas={metricas} />
                <SaludFinanciera mes={mes} />
              </div>
            )}
            {tab === "config" && (
              <div className="space-y-6">
                <SeccionInicializar onHecho={() => { mostrarAviso("Saldo inicial guardado"); refrescar(); }} />
                <TabConfig config={config} onGuardado={(c) => { setConfig(c); mostrarAviso("Configuración guardada"); }} />
              </div>
            )}
          </>
        )}
      </section>

      {/* Modal movimiento */}
      {movForm && (
        <Modal titulo={movForm.id ? "Editar movimiento" : movForm.esSueldo ? "Gasto de sueldo" : "Nuevo movimiento"} onCerrar={() => setMovForm(null)}>
          <div className="grid gap-3 md:grid-cols-2">
            <Campo label="Fecha"><input type="date" value={movForm.fecha} onChange={(e) => setMovForm({ ...movForm, fecha: e.target.value })} className={inputCls} /></Campo>
            {!movForm.esSueldo && (
              <Campo label="Tipo">
                <select value={movForm.tipo} onChange={(e) => {
                  const tipo = e.target.value as MovForm["tipo"];
                  setMovForm({ ...movForm, tipo, clasificacion: tipo === "ingreso" ? "ingreso" : tipo === "ajuste" ? "ajuste" : (movForm.clasificacion === "ingreso" ? "gasto" : movForm.clasificacion), categoria_id: "" });
                }} className={inputCls}>
                  <option value="egreso">Egreso</option>
                  <option value="ingreso">Ingreso</option>
                  <option value="ajuste">Ajuste</option>
                </select>
              </Campo>
            )}
            {!movForm.esSueldo && movForm.tipo === "egreso" && (
              <Campo label="Clasificación">
                <select value={movForm.clasificacion} onChange={(e) => setMovForm({ ...movForm, clasificacion: e.target.value, categoria_id: "" })} className={inputCls}>
                  <option value="costo">Costo</option>
                  <option value="gasto">Gasto</option>
                  <option value="inversion">Inversión</option>
                  <option value="otro">Otro</option>
                </select>
              </Campo>
            )}
            {movForm.tipo === "ajuste" ? (
              <>
                <Campo label="Cuenta (suma)">
                  <select value={movForm.cuenta_destino_id} onChange={(e) => setMovForm({ ...movForm, cuenta_destino_id: e.target.value, cuenta_origen_id: "" })} className={inputCls}>
                    <option value="">—</option>{cuentasActivas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </Campo>
                <Campo label="Cuenta (resta)">
                  <select value={movForm.cuenta_origen_id} onChange={(e) => setMovForm({ ...movForm, cuenta_origen_id: e.target.value, cuenta_destino_id: "" })} className={inputCls}>
                    <option value="">—</option>{cuentasActivas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </Campo>
              </>
            ) : (
              <Campo label={movForm.tipo === "ingreso" ? "Fuente del ingreso *" : "Cuenta / fuente *"}>
                <select value={movForm.cuenta_origen_id} onChange={(e) => setMovForm({ ...movForm, cuenta_origen_id: e.target.value })} className={`${inputCls} ${!movForm.cuenta_origen_id ? "border-amber-500/60" : ""}`}>
                  <option value="">{movForm.tipo === "ingreso" ? "¿Entró por Efectivo o Mercado Pago?" : "Elegir Efectivo / Mercado Pago..."}</option>{cuentasActivas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </Campo>
            )}
            {movForm.tipo !== "ajuste" && (
              <Campo label="Categoría">
                <select value={movForm.categoria_id} onChange={(e) => aplicarCategoria(e.target.value)} className={inputCls}>
                  <option value="">Sin categoría</option>{categoriasForm.map((c) => <option key={c.id} value={c.id}>{c.nombre} — {TIPO_CAT_LABEL[c.tipo] ?? c.tipo}</option>)}
                </select>
              </Campo>
            )}
            <Campo label="Monto"><input type="number" min={0} value={movForm.monto} onChange={(e) => setMovForm({ ...movForm, monto: e.target.value })} placeholder="0" className={`${inputCls} placeholder:text-white/30`} /></Campo>
            <Campo label="Descripción"><input type="text" value={movForm.descripcion} onChange={(e) => setMovForm({ ...movForm, descripcion: e.target.value })} placeholder="Ej: Alquiler julio" className={`${inputCls} placeholder:text-white/30`} /></Campo>
            <div className="md:col-span-2"><Campo label="Observaciones"><input type="text" value={movForm.observaciones} onChange={(e) => setMovForm({ ...movForm, observaciones: e.target.value })} placeholder="Notas internas" className={`${inputCls} placeholder:text-white/30`} /></Campo></div>
          </div>
          {movForm.esSueldo && <p className="mt-3 text-xs text-white/40">Gasto personal: sale de la caja del stand (Efectivo o MP) y se descuenta de tu sueldo del mes.</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setMovForm(null)} className="rounded-xl border border-white/15 px-5 py-2.5 text-xs font-black uppercase text-white/60 hover:border-white hover:text-white">Cancelar</button>
            <button onClick={guardarMovimiento} disabled={guardando || !movForm.monto || Number(movForm.monto) <= 0 || (movForm.tipo !== "ajuste" && !movForm.cuenta_origen_id) || (movForm.tipo === "ajuste" && !movForm.cuenta_origen_id && !movForm.cuenta_destino_id)} className="rounded-xl bg-red-600 px-6 py-2.5 text-xs font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30">
              {guardando ? "Guardando..." : movForm.id ? "Actualizar" : "Guardar"}
            </button>
          </div>
        </Modal>
      )}

      {/* Modal transferencia */}
      {transfForm && (
        <Modal titulo="Transferir entre cuentas" onCerrar={() => setTransfForm(null)}>
          <div className="grid gap-3 md:grid-cols-2">
            <Campo label="Desde">
              <select value={transfForm.cuenta_origen_id} onChange={(e) => setTransfForm({ ...transfForm, cuenta_origen_id: e.target.value })} className={inputCls}>
                <option value="">Cuenta origen...</option>{cuentasActivas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </Campo>
            <Campo label="Hacia">
              <select value={transfForm.cuenta_destino_id} onChange={(e) => setTransfForm({ ...transfForm, cuenta_destino_id: e.target.value })} className={inputCls}>
                <option value="">Cuenta destino...</option>{cuentasActivas.filter((c) => c.id !== transfForm.cuenta_origen_id).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </Campo>
            <Campo label="Monto"><input type="number" min={0} value={transfForm.monto} onChange={(e) => setTransfForm({ ...transfForm, monto: e.target.value })} placeholder="0" className={`${inputCls} placeholder:text-white/30`} /></Campo>
            <Campo label="Fecha"><input type="date" value={transfForm.fecha} onChange={(e) => setTransfForm({ ...transfForm, fecha: e.target.value })} className={inputCls} /></Campo>
            <div className="md:col-span-2"><Campo label="Observación"><input type="text" value={transfForm.descripcion} onChange={(e) => setTransfForm({ ...transfForm, descripcion: e.target.value })} placeholder="Ej: paso efectivo a MP" className={`${inputCls} placeholder:text-white/30`} /></Campo></div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setTransfForm(null)} className="rounded-xl border border-white/15 px-5 py-2.5 text-xs font-black uppercase text-white/60 hover:border-white hover:text-white">Cancelar</button>
            <button onClick={guardarTransferencia} disabled={guardando || !transfForm.cuenta_origen_id || !transfForm.cuenta_destino_id || !transfForm.monto || Number(transfForm.monto) <= 0} className="rounded-xl bg-red-600 px-6 py-2.5 text-xs font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30">
              {guardando ? "Guardando..." : "Transferir"}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}

// ═════════ Auxiliares ═════════

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div><label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">{label}</label>{children}</div>);
}
function Modal({ titulo, onCerrar, children, ancho }: { titulo: string; onCerrar: () => void; children: React.ReactNode; ancho?: string }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/80 p-0 md:items-center md:p-6">
      <div className={`max-h-[92vh] w-full ${ancho || "max-w-2xl"} overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0a0a0a] p-5 md:rounded-3xl`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black uppercase text-red-500">{titulo}</h3>
          <button onClick={onCerrar} className="text-2xl text-white/40 hover:text-white">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
function CardKpi({ titulo, valor, detalle, color }: { titulo: string; valor: string; detalle?: string; color?: "rojo" | "verde" | "neutro" | "ambar" }) {
  const cls = color === "verde" ? "text-green-400" : color === "rojo" ? "text-red-500" : color === "ambar" ? "text-amber-400" : "text-white";
  return (
    <div className="rounded-2xl border border-white/10 bg-black p-4">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">{titulo}</p>
      <p className={`mt-2 text-xl font-black md:text-2xl ${cls}`}>{valor}</p>
      {detalle && <p className="mt-1 text-xs text-white/40">{detalle}</p>}
    </div>
  );
}

// ═════════ TAB: Resumen ═════════

function TabResumen({ resumen }: { resumen: ResumenApi }) {
  const r = resumen.resumen;
  const porFuente = useMemo(() => {
    const acc: Record<string, { label: string; categoria: string; total: number; cantidad: number }> = {};
    for (const i of resumen.ingresosAutomaticos) {
      if (!acc[i.fuente]) acc[i.fuente] = { label: i.fuenteLabel, categoria: i.categoria, total: 0, cantidad: 0 };
      acc[i.fuente].total += i.total;
      acc[i.fuente].cantidad = Math.max(acc[i.fuente].cantidad, i.cantidad);
    }
    return acc;
  }, [resumen.ingresosAutomaticos]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <CardKpi titulo="Ingresos del mes" valor={dinero(r.ingresos)} color="verde" detalle={`Auto ${dinero(r.ingresosAutomaticos)} + manual ${dinero(r.ingresosManuales)}`} />
        <CardKpi titulo="Costos del mes" valor={dinero(r.costos)} color="rojo" />
        <CardKpi titulo="Gastos del mes" valor={dinero(r.gastos)} color="rojo" />
        <CardKpi titulo="Inversiones" valor={dinero(r.inversiones)} />
        <CardKpi titulo="Mi sueldo asignado" valor={dinero(r.sueldoAsignado)} />
        <CardKpi titulo="Gastado de sueldo" valor={dinero(r.gastosSueldo)} color="rojo" detalle={r.sueldoAsignado > 0 ? (r.sueldoDisponible >= 0 ? `Te queda ${dinero(r.sueldoDisponible)}` : `Te pasaste ${dinero(-r.sueldoDisponible)}`) : undefined} />
        <CardKpi titulo="Resultado operativo" valor={dinero(r.resultadoOperativo)} color={r.resultadoOperativo >= 0 ? "verde" : "rojo"} detalle="Ingresos − costos − gastos" />
        <CardKpi titulo="Turnos del mes" valor={String(r.turnosDelMes)} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <CardKpi titulo="Saldo inicial general" valor={dinero(r.saldoInicialGeneral)} />
        {r.financiamiento > 0 && <CardKpi titulo="Financiamiento (préstamos)" valor={dinero(r.financiamiento)} color="ambar" detalle="Entra caja, no es facturación" />}
        <CardKpi titulo="Saldo final teórico" valor={dinero(r.saldoFinalTeoricoGeneral)} detalle="Inicial + ingresos + financiamiento − egresos" />
        <CardKpi titulo="Saldo real (cierre)" valor={resumen.cierre.saldo_real_general !== null ? dinero(resumen.cierre.saldo_real_general) : "Sin cierre"} />
        <CardKpi titulo="Diferencia de cierre" valor={resumen.cierre.diferencia_general !== null ? dinero(resumen.cierre.diferencia_general) : "—"}
          color={resumen.cierre.diferencia_general === null ? "neutro" : Math.abs(resumen.cierre.diferencia_general) < 1 ? "verde" : "ambar"} />
      </div>

      {/* Ingresos por fuente (Efectivo / Mercado Pago) */}
      <div>
        <h2 className="mb-3 text-lg font-black uppercase text-red-500">Ingresos por fuente</h2>
        <div className="grid grid-cols-2 gap-3">
          {r.porFuente.map((f) => (
            <CardKpi key={f.tipo} titulo={`Ingresos por ${f.nombre}`} valor={dinero(f.ingresos)} color="verde" detalle="Automáticos + manuales de esta fuente" />
          ))}
        </div>
        <p className="mt-2 text-[11px] text-white/30">Suma lo cobrado por cada fuente (turnero/reservas/gift cards/campeonatos + ingresos manuales). Total operativo: {dinero(r.ingresos)}.</p>
      </div>

      {/* Movimientos por fuente */}
      <div>
        <h2 className="mb-3 text-lg font-black uppercase text-red-500">Movimientos por fuente</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {r.porFuente.map((f) => (
            <div key={f.tipo} className="rounded-2xl border border-white/10 bg-black p-4">
              <p className="text-sm font-black uppercase">{f.nombre}</p>
              <p className={`mt-2 text-2xl font-black ${f.neto >= 0 ? "text-green-400" : "text-red-500"}`}>{dinero(f.neto)} <span className="text-xs font-bold text-white/40">neto del mes</span></p>
              <div className="mt-3 space-y-1 text-xs text-white/50">
                <p>Ingresos: <span className="font-bold text-green-400">{dinero(f.ingresos)}</span></p>
                {f.financiamiento > 0 && <p>Financiamiento: <span className="font-bold text-amber-400">{dinero(f.financiamiento)}</span></p>}
                <p>Pagado: <span className="font-bold text-red-400">{dinero(f.egresos)}</span></p>
                <p>Transf. entrantes: <span className="font-bold text-white/80">{dinero(f.transferenciasEntrantes)}</span></p>
                <p>Transf. salientes: <span className="font-bold text-white/80">{dinero(f.transferenciasSalientes)}</span></p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-white/30">El saldo inicial es general (no se divide por fuente). Acá ves solo el movimiento de caja por Efectivo / Mercado Pago.</p>
      </div>

      {/* Saldo actual disponible (saldo inicial de la fuente + neto del mes) */}
      <div>
        <h2 className="mb-3 text-lg font-black uppercase text-red-500">Saldo actual disponible</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {r.porFuente.map((f) => {
            const inicial = f.tipo === "efectivo"
              ? (resumen.saldoInicialPorFuente?.efectivo ?? 0)
              : (resumen.saldoInicialPorFuente?.mercado_pago ?? 0);
            const saldoActual = inicial + f.neto;
            return (
              <div key={f.tipo} className="rounded-2xl border border-white/10 bg-black p-4">
                <p className="text-sm font-black uppercase">{f.nombre} disponible</p>
                <p className={`mt-2 text-2xl font-black ${saldoActual >= 0 ? "text-green-400" : "text-red-500"}`}>{dinero(saldoActual)} <span className="text-xs font-bold text-white/40">disponible actualmente</span></p>
                <div className="mt-3 space-y-1 text-xs text-white/50">
                  <p>Saldo inicial: <span className="font-bold text-white/80">{dinero(inicial)}</span></p>
                  <p>Ingresos: <span className="font-bold text-green-400">+{dinero(f.ingresos)}</span></p>
                  {f.financiamiento > 0 && <p>Financiamiento: <span className="font-bold text-amber-400">+{dinero(f.financiamiento)}</span></p>}
                  <p>Pagado: <span className="font-bold text-red-400">-{dinero(f.egresos)}</span></p>
                  <p>Transferencias: <span className="font-bold text-white/80">+{dinero(f.transferenciasEntrantes)} / -{dinero(f.transferenciasSalientes)}</span></p>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-white/30">
          Dinero que debería existir hoy por fuente = saldo inicial + ingresos + financiamiento + transferencias entrantes − pagos − transferencias salientes.
          {resumen.saldoInicialPorFuente && !resumen.saldoInicialPorFuente.desglosado && r.saldoInicialGeneral !== 0 ? " El saldo inicial no está desglosado por fuente: se muestra en Efectivo." : ""}
        </p>
      </div>

      {/* Ingresos automáticos */}
      <div className="rounded-2xl border border-white/10 bg-black p-4">
        <h2 className="mb-3 text-lg font-black uppercase text-red-500">Ingresos automáticos · {labelMes(resumen.mes)}</h2>
        <p className="mb-3 text-xs text-white/40">Leídos del sistema (turnero, reservas, gift cards, campeonatos). No se editan desde acá.</p>
        {Object.keys(porFuente).length === 0 ? (
          <p className="text-sm text-white/45">Sin ingresos automáticos este mes.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead><tr className="text-left text-[10px] font-black uppercase tracking-[0.15em] text-white/35"><th className="pb-2">Fuente</th><th className="pb-2">Categoría</th><th className="pb-2 text-right">Cantidad</th><th className="pb-2 text-right">Total</th></tr></thead>
              <tbody>
                {Object.entries(porFuente).map(([fuente, f]) => (
                  <tr key={fuente} className="border-t border-white/5"><td className="py-2 font-bold">{f.label}</td><td className="py-2 text-white/60">{f.categoria}</td><td className="py-2 text-right text-white/60">{f.cantidad || "—"}</td><td className="py-2 text-right font-black text-green-400">{dinero(f.total)}</td></tr>
                ))}
                <tr className="border-t border-white/10"><td colSpan={3} className="py-2 text-right text-xs font-black uppercase text-white/40">Total automático</td><td className="py-2 text-right font-black text-green-400">{dinero(r.ingresosAutomaticos)}</td></tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ═════════ TAB: Movimientos ═════════

function TabMovimientos({ movimientos, cuentasPorId, categoriasPorId, cuentas, categorias, onEditar, onEliminar }: {
  movimientos: Movimiento[]; cuentasPorId: Record<string, Cuenta>; categoriasPorId: Record<string, Categoria>;
  cuentas: Cuenta[]; categorias: Categoria[]; onEditar: (m: Movimiento) => void; onEliminar: (id: string) => void;
}) {
  const [fTipo, setFTipo] = useState("");
  const [fClasif, setFClasif] = useState("");
  const [fCuenta, setFCuenta] = useState("");
  const [fCategoria, setFCategoria] = useState("");
  const [fTexto, setFTexto] = useState("");

  const filtrados = useMemo(() => {
    const texto = fTexto.trim().toLowerCase();
    return movimientos.filter((m) => {
      if (fTipo && m.tipo !== fTipo) return false;
      if (fClasif && m.clasificacion !== fClasif) return false;
      if (fCuenta && m.cuenta_origen_id !== fCuenta && m.cuenta_destino_id !== fCuenta) return false;
      if (fCategoria && m.categoria_id !== fCategoria) return false;
      if (texto && !`${m.descripcion} ${m.observaciones || ""}`.toLowerCase().includes(texto)) return false;
      return true;
    });
  }, [movimientos, fTipo, fClasif, fCuenta, fCategoria, fTexto]);

  const neto = filtrados.reduce((a, m) => (m.tipo === "transferencia" ? a : m.tipo === "ingreso" ? a + m.monto : a - m.monto), 0);
  const sel = "rounded-xl border border-white/15 bg-black px-3 py-2 text-xs font-bold outline-none focus:border-red-500";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-4 flex flex-wrap gap-2">
        <select value={fTipo} onChange={(e) => setFTipo(e.target.value)} className={sel}><option value="">Tipo: todos</option><option value="ingreso">Ingreso</option><option value="egreso">Egreso</option><option value="transferencia">Transferencia</option><option value="ajuste">Ajuste</option></select>
        <select value={fClasif} onChange={(e) => setFClasif(e.target.value)} className={sel}><option value="">Clasif: todas</option><option value="ingreso">Ingreso</option><option value="costo">Costo</option><option value="gasto">Gasto</option><option value="inversion">Inversión</option><option value="sueldo_personal">Mi sueldo</option><option value="otro">Otro</option></select>
        <select value={fCuenta} onChange={(e) => setFCuenta(e.target.value)} className={sel}><option value="">Cuenta: todas</option>{cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
        <select value={fCategoria} onChange={(e) => setFCategoria(e.target.value)} className={sel}><option value="">Categoría: todas</option>{categorias.filter((c) => c.activa).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
        <input type="text" value={fTexto} onChange={(e) => setFTexto(e.target.value)} placeholder="Buscar..." className={`${sel} placeholder:text-white/25`} />
      </div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-white/40">{filtrados.length} movimientos</p>
        <p className="text-xs font-black">Neto (sin transf.): <span className={neto >= 0 ? "text-green-400" : "text-red-400"}>{dinero(neto)}</span></p>
      </div>
      {filtrados.length === 0 ? (
        <p className="py-6 text-center text-sm text-white/40">No hay movimientos con estos filtros.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead><tr className="text-left text-[10px] font-black uppercase tracking-[0.15em] text-white/35"><th className="pb-2 pr-3">Fecha</th><th className="pb-2 pr-3">Tipo</th><th className="pb-2 pr-3">Clasif.</th><th className="pb-2 pr-3">Cuenta</th><th className="pb-2 pr-3">Categoría</th><th className="pb-2 pr-3">Descripción</th><th className="pb-2 pr-3 text-right">Monto</th><th className="pb-2"></th></tr></thead>
            <tbody>
              {filtrados.map((m) => {
                const esTransf = m.tipo === "transferencia";
                const cuentaTxt = esTransf
                  ? `${cuentasPorId[m.cuenta_origen_id || ""]?.nombre || "?"} → ${cuentasPorId[m.cuenta_destino_id || ""]?.nombre || "?"}`
                  : cuentasPorId[m.cuenta_origen_id || m.cuenta_destino_id || ""]?.nombre || "—";
                return (
                  <tr key={m.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                    <td className="py-2 pr-3 font-bold">{m.fecha}</td>
                    <td className="py-2 pr-3"><span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${m.tipo === "ingreso" ? "bg-green-950/60 text-green-400" : m.tipo === "egreso" ? "bg-red-950/60 text-red-400" : "bg-white/10 text-white/70"}`}>{TIPO_LABEL[m.tipo]}</span></td>
                    <td className="py-2 pr-3 text-white/60">{CLASIF_LABEL[m.clasificacion] || m.clasificacion}</td>
                    <td className="py-2 pr-3 text-white/60">{cuentaTxt}</td>
                    <td className="py-2 pr-3 text-white/60">{m.categoria_id ? categoriasPorId[m.categoria_id]?.nombre || "—" : "—"}</td>
                    <td className="max-w-[220px] truncate py-2 pr-3 text-white/70" title={m.descripcion}>{m.descripcion || "—"}</td>
                    <td className={`py-2 pr-3 text-right font-black ${m.tipo === "ingreso" ? "text-green-400" : m.tipo === "egreso" ? "text-red-400" : "text-white/80"}`}>{dinero(m.monto)}</td>
                    <td className="py-2 text-right">
                      <div className="flex justify-end gap-1">
                        {!esTransf && <button onClick={() => onEditar(m)} className="rounded-lg border border-white/15 px-2.5 py-1 text-[10px] font-black uppercase text-white/60 hover:border-red-500 hover:text-white">Editar</button>}
                        <button onClick={() => onEliminar(m.id)} className="rounded-lg border border-white/15 px-2.5 py-1 text-[10px] font-black uppercase text-white/60 hover:border-red-500 hover:bg-red-600 hover:text-white">×</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═════════ TAB: Cierre ═════════

function TabCierre({ mes, cierre, onHecho }: { mes: string; cierre: CierreApi | null; onHecho: () => void }) {
  const [real, setReal] = useState("");
  const [obs, setObs] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!cierre) return;
    setReal(cierre.saldo_real_guardado !== null ? String(cierre.saldo_real_guardado) : "");
    setObs(cierre.observaciones || "");
  }, [cierre]);

  if (!cierre) return <p className="text-white/60">Cargando cierre...</p>;
  const cerrado = cierre.estado !== "abierto";
  const realNum = real === "" ? null : Number(real);
  const dif = realNum !== null && Number.isFinite(realNum) ? realNum - cierre.saldo_teorico_general : null;

  async function cerrar() {
    if (real === "" || !Number.isFinite(Number(real))) { alert("Cargá el saldo real general."); return; }
    if (!confirm(`¿Cerrar ${labelMes(mes)}? No se podrán cargar movimientos hasta reabrirlo.`)) return;
    setGuardando(true);
    try {
      const r = await fetch("/api/admin/finanzas/cierre", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mes, saldo_real: Number(real), observaciones: obs || null }) });
      const d = await r.json();
      if (!r.ok) { alert(d.error || "Error cerrando"); return; }
      onHecho();
    } finally { setGuardando(false); }
  }
  async function reabrir() {
    if (!confirm(`¿Reabrir ${labelMes(mes)}?`)) return;
    setGuardando(true);
    try {
      const r = await fetch("/api/admin/finanzas/reabrir-mes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mes }) });
      const d = await r.json();
      if (!r.ok) { alert(d.error || "Error reabriendo"); return; }
      onHecho();
    } finally { setGuardando(false); }
  }

  const dg = cierre.desglose;
  const det = cierre.detalle;
  const ingresosTotal = det.ingresos.total;
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-black uppercase text-red-500">Cierre de {labelMes(mes)}</h2>
          <p className="mt-1 text-xs text-white/50">Estado: <span className={`font-black uppercase ${cierre.estado === "abierto" ? "text-white/70" : cierre.estado === "cerrado" ? "text-green-400" : "text-amber-400"}`}>{cierre.estado === "cerrado_con_diferencia" ? "Cerrado con diferencia" : cierre.estado}</span>{cierre.cerrado_at && ` · ${new Date(cierre.cerrado_at).toLocaleString("es-AR")}`}</p>
        </div>
        {cerrado ? (
          <button onClick={reabrir} disabled={guardando} className="rounded-xl border border-amber-500/50 bg-amber-500/10 px-6 py-2.5 text-xs font-black uppercase text-amber-400 transition hover:bg-amber-500/20 disabled:opacity-40">↻ Reabrir mes</button>
        ) : (
          <button onClick={cerrar} disabled={guardando} className="rounded-xl bg-red-600 px-6 py-2.5 text-xs font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30">{guardando ? "Cerrando..." : "Cerrar mes"}</button>
        )}
      </div>

      {cerrado && <p className="rounded-xl border border-amber-500/25 bg-amber-950/10 px-4 py-2 text-xs font-bold text-amber-400">Mes cerrado: no se pueden cargar ni editar movimientos. Tocá “Reabrir mes” para volver a habilitar cambios.</p>}

      {/* A) Cierre general */}
      <div className="rounded-2xl border border-white/10 bg-black p-4">
        <h3 className="mb-3 text-sm font-black uppercase text-white/60">A) Cierre general del mes</h3>
        <div className="space-y-1.5 text-sm">
          <FilaCierre label="Saldo inicial general" valor={cierre.saldo_inicial_general} />
          <FilaCierre label="+ Ingresos operativos" valor={dg.ingresos} color="verde" />
          {dg.financiamiento > 0 && <FilaCierre label="+ Financiamiento (préstamos)" valor={dg.financiamiento} color="verde" />}
          <FilaCierre label="− Costos" valor={-dg.costos} color="rojo" />
          <FilaCierre label="− Gastos" valor={-dg.gastos} color="rojo" />
          <FilaCierre label="− Inversiones" valor={-dg.inversiones} color="rojo" />
          <FilaCierre label="− Gastos de sueldo" valor={-dg.gastos_sueldo} color="rojo" />
          {dg.pagos_deuda > 0 && <FilaCierre label="− Pagos de deuda" valor={-dg.pagos_deuda} color="rojo" />}
          {dg.otros !== 0 && <FilaCierre label="− Otros" valor={-dg.otros} color="rojo" />}
          {dg.ajustes !== 0 && <FilaCierre label="± Ajustes" valor={dg.ajustes} />}
          <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2 text-base font-black"><span className="uppercase">Saldo final teórico general</span><span>{dinero(cierre.saldo_teorico_general)}</span></div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black p-4">
          <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Saldo real general (contado por vos)</label>
          <input type="number" value={real} disabled={cerrado} onChange={(e) => setReal(e.target.value)} placeholder="0" className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-lg font-black outline-none focus:border-red-500 disabled:opacity-50" />
          {dif !== null && <p className={`mt-2 text-sm font-black ${Math.abs(dif) < 1 ? "text-green-400" : "text-amber-400"}`}>Diferencia general: {dinero(dif)}</p>}
        </div>
        <div className="rounded-2xl border border-white/10 bg-black p-4">
          <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Observaciones</label>
          <textarea value={obs} onChange={(e) => setObs(e.target.value)} disabled={cerrado} rows={3} placeholder="Notas del cierre..." className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/25 focus:border-red-500 disabled:opacity-50" />
        </div>
      </div>
      <p className="text-xs text-white/35">El cierre oficial es general. El saldo inicial del mes siguiente arranca automáticamente con este saldo real.</p>

      {/* B) Desglose por fuente */}
      <div>
        <h3 className="mb-3 text-sm font-black uppercase text-white/60">B) Desglose por fuente</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {cierre.por_fuente.map((f) => (
            <div key={f.tipo} className="rounded-2xl border border-white/10 bg-black p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-black uppercase">{f.nombre}</p>
                <p className={`text-lg font-black ${f.neto >= 0 ? "text-green-400" : "text-red-500"}`}>{dinero(f.neto)}</p>
              </div>
              <div className="mt-2 space-y-1 text-xs text-white/55">
                <FilaFuente label="Ingresos cobrados" valor={f.ingresos} color="verde" />
                {f.financiamiento > 0 && <FilaFuente label="Financiamiento" valor={f.financiamiento} color="ambar" />}
                <FilaFuente label="Costos" valor={f.costos} />
                <FilaFuente label="Gastos" valor={f.gastos} />
                <FilaFuente label="Inversiones" valor={f.inversiones} />
                <FilaFuente label="Gastos de sueldo" valor={f.gastosSueldo} />
                {f.pagosDeuda > 0 && <FilaFuente label="Pagos de deuda" valor={f.pagosDeuda} />}
                <FilaFuente label="Transf. entrantes" valor={f.transferenciasEntrantes} />
                <FilaFuente label="Transf. salientes" valor={f.transferenciasSalientes} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detalle por rubro */}
      <div>
        <h3 className="mb-3 text-sm font-black uppercase text-white/60">En qué entró / salió</h3>
        <div className="space-y-2">
          {/* Ingresos */}
          <details className="rounded-2xl border border-white/10 bg-black">
            <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-black">
              <span className="uppercase text-green-400">Ingresos por rubro</span>
              <span>{dinero(ingresosTotal)}</span>
            </summary>
            <div className="border-t border-white/10 px-4 py-3">
              {det.ingresos.automaticos.length > 0 && (
                <>
                  <p className="mb-1 text-[10px] font-black uppercase text-white/40">Automáticos (sistema)</p>
                  {det.ingresos.automaticos.map((a) => (
                    <RubroFila key={a.fuente} nombre={a.fuente} total={a.total} base={ingresosTotal} cantidad={a.cantidad} />
                  ))}
                </>
              )}
              {det.ingresos.manuales_por_categoria.length > 0 && (
                <>
                  <p className="mb-1 mt-3 text-[10px] font-black uppercase text-white/40">Manuales</p>
                  {det.ingresos.manuales_por_categoria.map((c) => (
                    <RubroFila key={c.categoria} nombre={c.categoria} total={c.total} base={ingresosTotal} cantidad={c.cantidad} ef={c.efectivo} mp={c.mercado_pago} />
                  ))}
                </>
              )}
              {ingresosTotal === 0 && <p className="text-sm text-white/40">Sin ingresos este mes.</p>}
            </div>
          </details>

          <RubroDetalle titulo="Costos por rubro" items={det.costos_por_categoria} base={dg.costos} color="text-red-400" />
          <RubroDetalle titulo="Gastos por rubro" items={det.gastos_por_categoria} base={dg.gastos} color="text-red-400" />
          <RubroDetalle titulo="Inversiones por rubro" items={det.inversiones_por_categoria} base={dg.inversiones} color="text-red-400" />
          {dg.otros > 0 && <RubroDetalle titulo="Otros egresos" items={det.otros_por_categoria} base={dg.otros} color="text-red-400" />}

          {/* Mi sueldo */}
          <details className="rounded-2xl border border-white/10 bg-black">
            <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-black">
              <span className="uppercase text-amber-400">Mi sueldo · gastos por categoría</span>
              <span>{dinero(det.sueldo_total)}{det.sueldo_asignado > 0 ? ` / ${dinero(det.sueldo_asignado)}` : ""}</span>
            </summary>
            <div className="border-t border-white/10 px-4 py-3">
              {det.sueldo_por_categoria.length === 0 ? <p className="text-sm text-white/40">Sin gastos de sueldo este mes.</p> : (
                det.sueldo_por_categoria.map((c) => (
                  <RubroFila key={c.categoria} nombre={c.categoria} total={c.total} base={det.sueldo_total} cantidad={c.cantidad} ef={c.efectivo} mp={c.mercado_pago} />
                ))
              )}
            </div>
          </details>

          {dg.pagos_deuda > 0 && <RubroDetalle titulo="Pagos de deuda" items={det.pagos_deuda_por_categoria} base={dg.pagos_deuda} color="text-red-400" />}

          {/* Financiamiento */}
          {det.financiamiento.total > 0 && (
            <details className="rounded-2xl border border-amber-500/20 bg-black">
              <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-black">
                <span className="uppercase text-amber-400">Financiamiento recibido</span>
                <span>{dinero(det.financiamiento.total)}</span>
              </summary>
              <div className="border-t border-white/10 px-4 py-3">
                <p className="mb-2 text-[11px] text-white/40">Entra caja pero no es facturación (no cuenta como revenue ni resultado operativo).</p>
                {det.financiamiento.items.map((i) => (
                  <div key={i.id} className="flex items-center justify-between py-1 text-xs">
                    <span className="text-white/60">{i.fecha.slice(8)}/{i.fecha.slice(5, 7)} · {i.descripcion} {i.fuente ? `(${i.fuente === "efectivo" ? "Efectivo" : "MP"})` : ""}</span>
                    <span className="font-black text-amber-400">{dinero(i.monto)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
function FilaCierre({ label, valor, color }: { label: string; valor: number; color?: "verde" | "rojo" }) {
  const cls = color === "verde" ? "text-green-400" : color === "rojo" ? "text-red-400" : "text-white/80";
  return (<div className="flex items-center justify-between"><span className="text-white/60">{label}</span><span className={`font-bold ${cls}`}>{dinero(valor)}</span></div>);
}
function FilaFuente({ label, valor, color }: { label: string; valor: number; color?: "verde" | "ambar" }) {
  if (!valor) return null;
  const cls = color === "verde" ? "text-green-400" : color === "ambar" ? "text-amber-400" : "text-white/80";
  return (<div className="flex items-center justify-between"><span className="text-white/50">{label}</span><span className={`font-bold ${cls}`}>{dinero(valor)}</span></div>);
}
function RubroFila({ nombre, total, base, cantidad, ef, mp }: { nombre: string; total: number; base: number; cantidad?: number; ef?: number; mp?: number }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-white/5 py-1.5 text-xs first:border-t-0">
      <div className="min-w-0">
        <span className="font-bold text-white/70">{nombre}</span>
        <span className="ml-2 text-white/30">{base > 0 ? `${Math.round((total / base) * 100)}%` : ""}{cantidad ? ` · ${cantidad} mov.` : ""}{(ef || mp) ? ` · Ef ${dinero(ef || 0)} / MP ${dinero(mp || 0)}` : ""}</span>
      </div>
      <span className="shrink-0 font-black">{dinero(total)}</span>
    </div>
  );
}
function RubroDetalle({ titulo, items, base, color }: { titulo: string; items: RubroCat[]; base: number; color: string }) {
  return (
    <details className="rounded-2xl border border-white/10 bg-black">
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-black">
        <span className={`uppercase ${color}`}>{titulo}</span>
        <span>{dinero(base)}</span>
      </summary>
      <div className="border-t border-white/10 px-4 py-3">
        {items.length === 0 ? <p className="text-sm text-white/40">Sin movimientos en este rubro.</p> : (
          items.map((c) => <RubroFila key={c.categoria} nombre={c.categoria} total={c.total} base={base} cantidad={c.cantidad} ef={c.efectivo} mp={c.mercado_pago} />)
        )}
      </div>
    </details>
  );
}

// ═════════ TAB: Mi sueldo ═════════

function TabSueldo({ mes, resumen, movimientos, cuentasPorId, categoriasPorId, onAgregar, onHecho, refrescar, onCargaRapida }: {
  mes: string; resumen: ResumenApi; movimientos: Movimiento[]; cuentasPorId: Record<string, Cuenta>; categoriasPorId: Record<string, Categoria>;
  onAgregar: () => void; onHecho: () => void; refrescar: () => void; onCargaRapida: (texto: string) => void;
}) {
  const r = resumen.resumen;
  const [sueldoInput, setSueldoInput] = useState(String(r.sueldoAsignado || ""));
  const [rapido, setRapido] = useState("");
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { setSueldoInput(String(r.sueldoAsignado || "")); }, [r.sueldoAsignado, mes]);

  const gastosSueldo = movimientos.filter((m) => m.tipo === "egreso" && (m.clasificacion === "sueldo_personal" || m.clasificacion === "retiro"));
  const porCategoria = Object.entries(r.sueldoPorCategoria).sort((a, b) => b[1] - a[1]);
  const maxCat = porCategoria.length ? porCategoria[0][1] : 0;
  const excedido = r.sueldoDisponible < 0;

  async function guardarSueldo() {
    setGuardando(true);
    try {
      const r2 = await fetch("/api/admin/finanzas/sueldo", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mes, monto: Number(sueldoInput) || 0 }) });
      const d = await r2.json();
      if (!r2.ok) { alert(d.error || "Error"); return; }
      onHecho(); refrescar();
    } finally { setGuardando(false); }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-red-500/25 bg-red-950/10 p-4">
        <div className="flex-1">
          <h2 className="text-lg font-black uppercase text-red-500">Mi sueldo · {labelMes(mes)}</h2>
          <p className="mt-1 text-xs text-white/40">Definí tu sueldo del mes. Tus gastos personales salen de la caja del stand y se descuentan de acá.</p>
          <div className="mt-3 flex items-end gap-2">
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Sueldo asignado del mes</label>
              <input type="number" min={0} value={sueldoInput} onChange={(e) => setSueldoInput(e.target.value)} placeholder="0" className="w-44 rounded-xl border border-white/15 bg-black px-3 py-2 text-lg font-black outline-none focus:border-red-500" />
            </div>
            <button onClick={guardarSueldo} disabled={guardando} className="rounded-xl bg-red-600 px-5 py-2.5 text-xs font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30">{guardando ? "..." : "Guardar sueldo"}</button>
          </div>
        </div>
        <button onClick={onAgregar} className="rounded-full bg-red-600 px-4 py-2 text-xs font-black uppercase transition hover:bg-red-700">+ Gasto de sueldo</button>
      </div>

      {/* Carga rápida de gasto de sueldo */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Carga rápida de gasto de sueldo</label>
        <div className="flex flex-col gap-2 md:flex-row">
          <input type="text" value={rapido} onChange={(e) => setRapido(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && rapido.trim().length >= 3) { onCargaRapida(rapido); setRapido(""); } }}
            placeholder='Ej: "8500 nafta efectivo" · "12000 comida mp" · "30000 tarjeta mp"'
            className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/25 focus:border-red-500" />
          <button onClick={() => { if (rapido.trim().length >= 3) { onCargaRapida(rapido); setRapido(""); } }} disabled={rapido.trim().length < 3} className="rounded-xl bg-red-600 px-5 py-2 text-sm font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30">Cargar</button>
        </div>
        <p className="mt-1 text-[10px] text-white/30">Ya entra como gasto de “Mi sueldo”. Elegís cuenta (efectivo/mp) y confirmás. La barra global también entiende “sueldo …”.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <CardKpi titulo="Sueldo asignado" valor={dinero(r.sueldoAsignado)} />
        <CardKpi titulo="Gastado" valor={dinero(r.gastosSueldo)} color="rojo" />
        <CardKpi titulo={excedido ? "Te pasaste" : "Te queda"} valor={dinero(Math.abs(r.sueldoDisponible))} color={excedido ? "rojo" : "verde"} detalle={excedido ? "Excediste tu sueldo del mes" : "Disponible de tu sueldo"} />
        <CardKpi titulo="% usado" valor={r.sueldoAsignado > 0 ? pct(r.gastosSueldo / r.sueldoAsignado) : "—"} color={excedido ? "rojo" : "neutro"} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black p-4">
          <h3 className="mb-3 text-sm font-black uppercase text-white/60">Gasto por categoría</h3>
          {porCategoria.length === 0 ? <p className="text-sm text-white/40">Sin gastos de sueldo este mes.</p> : (
            <div className="space-y-2">
              {porCategoria.map(([cat, monto]) => (
                <div key={cat} className="flex items-center gap-3">
                  <span className="w-36 shrink-0 truncate text-xs font-bold text-white/60">{cat}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-red-600" style={{ width: maxCat ? `${Math.max(3, (monto / maxCat) * 100)}%` : "0%" }} /></div>
                  <span className="w-24 shrink-0 text-right text-xs font-black">{dinero(monto)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-white/10 bg-black p-4">
          <h3 className="mb-3 text-sm font-black uppercase text-white/60">Gasto por cuenta</h3>
          <div className="space-y-2">
            {(["efectivo", "mercado_pago"] as const).map((t) => (
              <div key={t} className="flex items-center justify-between rounded-lg bg-white/[0.04] px-3 py-2 text-sm"><span className="font-bold text-white/70">{tipoCuentaLabel(t)}</span><span className="font-black">{dinero(r.sueldoPorFuente[t] || 0)}</span></div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black p-4">
        <h3 className="mb-3 text-sm font-black uppercase text-white/60">Gastos de sueldo del mes</h3>
        {gastosSueldo.length === 0 ? <p className="text-sm text-white/40">Sin gastos de sueldo este mes.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm"><tbody>
              {gastosSueldo.map((m) => (
                <tr key={m.id} className="border-t border-white/5">
                  <td className="py-2 pr-3 text-white/60">{m.fecha}</td>
                  <td className="py-2 pr-3 text-white/60">{m.categoria_id ? categoriasPorId[m.categoria_id]?.nombre || "—" : "—"}</td>
                  <td className="py-2 pr-3 text-white/60">{cuentasPorId[m.cuenta_origen_id || ""]?.nombre || "—"}</td>
                  <td className="max-w-[220px] truncate py-2 pr-3 text-white/70">{m.descripcion || "—"}</td>
                  <td className="py-2 text-right font-black text-red-400">{dinero(m.monto)}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )}
      </div>
    </div>
  );
}

// ═════════ TAB: Categorías ═════════

function TabCategorias({ categorias, onCambio, mostrarAviso }: { categorias: Categoria[]; onCambio: () => void; mostrarAviso: (m: string) => void }) {
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState("gasto");
  const [guardando, setGuardando] = useState(false);
  const [fTipo, setFTipo] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState("");

  const sel = "rounded-xl border border-white/15 bg-black px-3 py-2 text-xs font-bold outline-none focus:border-red-500";

  async function crear() {
    if (!nombre.trim()) return;
    setGuardando(true);
    try {
      const r = await fetch("/api/admin/finanzas/categorias", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre: nombre.trim(), tipo }) });
      const d = await r.json();
      if (!r.ok) { alert(d.error || "Error"); return; }
      setNombre(""); mostrarAviso("Categoría creada"); onCambio();
    } finally { setGuardando(false); }
  }
  async function patch(id: string, body: Record<string, unknown>) {
    const r = await fetch(`/api/admin/finanzas/categorias/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) { alert(d.error || "Error"); return false; }
    onCambio(); return true;
  }
  async function eliminar(c: Categoria) {
    if (!confirm(`¿Eliminar "${c.nombre}"?`)) return;
    const r = await fetch(`/api/admin/finanzas/categorias/${c.id}`, { method: "DELETE" });
    const d = await r.json();
    if (!r.ok) { alert(d.error || "Error"); return; }
    mostrarAviso("Categoría eliminada"); onCambio();
  }

  const filtradas = categorias.filter((c) => !fTipo || c.tipo === fTipo);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="mb-3 text-sm font-black uppercase text-white/60">Nueva categoría</h3>
        <div className="flex flex-wrap gap-2">
          <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" className={`${sel} flex-1 min-w-[180px] placeholder:text-white/25`} />
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={sel}>
            {Object.entries(TIPO_CAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button onClick={crear} disabled={guardando || !nombre.trim()} className="rounded-xl bg-red-600 px-5 py-2 text-xs font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30">Crear</button>
        </div>
        <p className="mt-2 text-[11px] text-white/30">Arrancá con las que necesites y creá el resto a medida que gastás.</p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          <select value={fTipo} onChange={(e) => setFTipo(e.target.value)} className={sel}>
            <option value="">Tipo: todos</option>
            {Object.entries(TIPO_CAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {filtradas.map((c) => (
            <div key={c.id} className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 ${c.activa ? "border-white/10 bg-white/[0.03]" : "border-white/5 bg-black opacity-50"}`}>
              <div className="min-w-0 flex-1">
                {editId === c.id ? (
                  <input autoFocus value={editNombre} onChange={(e) => setEditNombre(e.target.value)} onKeyDown={async (e) => { if (e.key === "Enter" && editNombre.trim()) { if (await patch(c.id, { nombre: editNombre.trim() })) setEditId(null); } if (e.key === "Escape") setEditId(null); }} className="w-full rounded-lg border border-white/15 bg-black px-2 py-1 text-sm font-bold outline-none focus:border-red-500" />
                ) : (
                  <p className="truncate text-sm font-bold">{c.nombre}{c.protegida && <span className="ml-1 text-[9px] uppercase text-amber-400">· sistema</span>}</p>
                )}
                <p className="text-[10px] uppercase text-white/35">{TIPO_CAT_LABEL[c.tipo] || c.tipo}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                {!c.protegida && editId !== c.id && <button onClick={() => { setEditId(c.id); setEditNombre(c.nombre); }} className="rounded-lg border border-white/15 px-2 py-1 text-[10px] font-black uppercase text-white/50 hover:text-white">✎</button>}
                <button onClick={() => patch(c.id, { activa: !c.activa })} disabled={c.protegida} className={`rounded-lg border px-2 py-1 text-[10px] font-black uppercase transition disabled:opacity-30 ${c.activa ? "border-green-500/40 text-green-400 hover:bg-green-500/10" : "border-white/15 text-white/40 hover:text-white"}`}>{c.activa ? "On" : "Off"}</button>
                {!c.protegida && <button onClick={() => eliminar(c)} className="rounded-lg border border-white/15 px-2 py-1 text-[10px] font-black uppercase text-white/50 hover:border-red-500 hover:bg-red-600 hover:text-white">×</button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═════════ TAB: Reglas ═════════

function TabReglas({ reglas, categorias, cuentas, onCambio, mostrarAviso }: { reglas: Regla[]; categorias: Categoria[]; cuentas: Cuenta[]; onCambio: () => void; mostrarAviso: (m: string) => void }) {
  const vacio = { keyword: "", tipo_sugerido: "egreso", clasificacion_sugerida: "gasto", categoria_id: "", cuenta_id: "", prioridad: "100" };
  const [form, setForm] = useState(vacio);
  const [editId, setEditId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const sel = "rounded-xl border border-white/15 bg-black px-3 py-2 text-xs font-bold outline-none focus:border-red-500";

  async function guardar() {
    if (form.keyword.trim().length < 2) return;
    setGuardando(true);
    try {
      const body = {
        keyword: form.keyword.trim(), tipo_sugerido: form.tipo_sugerido || null, clasificacion_sugerida: form.clasificacion_sugerida || null,
        categoria_id: form.categoria_id || null, cuenta_id: form.cuenta_id || null, prioridad: Number(form.prioridad) || 100,
      };
      const url = editId ? `/api/admin/finanzas/reglas/${editId}` : "/api/admin/finanzas/reglas";
      const r = await fetch(url, { method: editId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { alert(d.error || "Error"); return; }
      setForm(vacio); setEditId(null); mostrarAviso(editId ? "Regla actualizada" : "Regla creada"); onCambio();
    } finally { setGuardando(false); }
  }
  async function toggle(rg: Regla) {
    const r = await fetch(`/api/admin/finanzas/reglas/${rg.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activa: !rg.activa }) });
    if (r.ok) onCambio();
  }
  async function eliminar(id: string) {
    if (!confirm("¿Eliminar esta regla?")) return;
    const r = await fetch(`/api/admin/finanzas/reglas/${id}`, { method: "DELETE" });
    if (r.ok) { mostrarAviso("Regla eliminada"); onCambio(); }
  }
  function editar(rg: Regla) {
    setEditId(rg.id);
    setForm({ keyword: rg.keyword, tipo_sugerido: rg.tipo_sugerido || "egreso", clasificacion_sugerida: rg.clasificacion_sugerida || "gasto", categoria_id: rg.categoria_id || "", cuenta_id: rg.cuenta_id || "", prioridad: String(rg.prioridad) });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="mb-1 text-sm font-black uppercase text-white/60">{editId ? "Editar regla" : "Nueva regla"}</h3>
        <p className="mb-3 text-xs text-white/35">Si la descripción de la carga rápida contiene la keyword, se sugiere tipo / clasificación / categoría / cuenta.</p>
        <div className="flex flex-wrap gap-2">
          <input type="text" value={form.keyword} onChange={(e) => setForm({ ...form, keyword: e.target.value })} placeholder='Keyword (ej: "fibra")' className={`${sel} min-w-[140px] placeholder:text-white/25`} />
          <select value={form.tipo_sugerido} onChange={(e) => setForm({ ...form, tipo_sugerido: e.target.value })} className={sel}><option value="ingreso">Ingreso</option><option value="egreso">Egreso</option></select>
          <select value={form.clasificacion_sugerida} onChange={(e) => setForm({ ...form, clasificacion_sugerida: e.target.value })} className={sel}><option value="ingreso">Ingreso</option><option value="costo">Costo</option><option value="gasto">Gasto</option><option value="inversion">Inversión</option><option value="sueldo_personal">Mi sueldo</option><option value="otro">Otro</option></select>
          <select value={form.categoria_id} onChange={(e) => setForm({ ...form, categoria_id: e.target.value })} className={sel}><option value="">Sin categoría</option>{categorias.filter((c) => c.activa).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
          <select value={form.cuenta_id} onChange={(e) => setForm({ ...form, cuenta_id: e.target.value })} className={sel}><option value="">Sin cuenta</option>{cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
          <button onClick={guardar} disabled={guardando || form.keyword.trim().length < 2} className="rounded-xl bg-red-600 px-5 py-2 text-xs font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30">{editId ? "Guardar" : "Crear"}</button>
          {editId && <button onClick={() => { setEditId(null); setForm(vacio); }} className="rounded-xl border border-white/15 px-4 py-2 text-xs font-black uppercase text-white/60 hover:text-white">Cancelar</button>}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black p-4">
        {reglas.length === 0 ? <p className="text-sm text-white/40">Sin reglas cargadas.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead><tr className="text-left text-[10px] font-black uppercase tracking-[0.15em] text-white/35"><th className="pb-2 pr-3">Keyword</th><th className="pb-2 pr-3">Tipo</th><th className="pb-2 pr-3">Clasif.</th><th className="pb-2 pr-3">Categoría</th><th className="pb-2 pr-3">Cuenta</th><th className="pb-2 pr-3">Prio</th><th className="pb-2"></th></tr></thead>
              <tbody>
                {reglas.map((rg) => (
                  <tr key={rg.id} className={`border-t border-white/5 ${rg.activa ? "" : "opacity-40"}`}>
                    <td className="py-2 pr-3 font-black">{rg.keyword}</td>
                    <td className="py-2 pr-3 text-white/60">{rg.tipo_sugerido ? TIPO_LABEL[rg.tipo_sugerido] : "—"}</td>
                    <td className="py-2 pr-3 text-white/60">{rg.clasificacion_sugerida ? CLASIF_LABEL[rg.clasificacion_sugerida] : "—"}</td>
                    <td className="py-2 pr-3 text-white/60">{rg.categoria?.nombre || "—"}</td>
                    <td className="py-2 pr-3 text-white/60">{rg.cuenta?.nombre || "—"}</td>
                    <td className="py-2 pr-3 text-white/60">{rg.prioridad}</td>
                    <td className="py-2 text-right"><div className="flex justify-end gap-1">
                      <button onClick={() => editar(rg)} className="rounded-lg border border-white/15 px-2 py-1 text-[10px] font-black uppercase text-white/50 hover:text-white">✎</button>
                      <button onClick={() => toggle(rg)} className={`rounded-lg border px-2 py-1 text-[10px] font-black uppercase ${rg.activa ? "border-green-500/40 text-green-400 hover:bg-green-500/10" : "border-white/15 text-white/40 hover:text-white"}`}>{rg.activa ? "On" : "Off"}</button>
                      <button onClick={() => eliminar(rg.id)} className="rounded-lg border border-white/15 px-2 py-1 text-[10px] font-black uppercase text-white/50 hover:border-red-500 hover:bg-red-600 hover:text-white">×</button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ═════════ TAB: Métricas ═════════

type MetricaKey = string;
const METRICA_DEFS: Record<MetricaKey, { titulo: string; significado: string; formula: string; fmt: "money" | "pct" | "meses" | "num" }> = {
  revenue: { titulo: "Revenue", significado: "Ingresos totales del mes (ventas del stand + ingresos manuales).", formula: "Ingresos totales", fmt: "money" },
  gross_profit: { titulo: "Gross Profit", significado: "Lo que queda después de los costos directos del servicio.", formula: "Ingresos − costos", fmt: "money" },
  gross_margin: { titulo: "Gross Margin", significado: "Porcentaje de los ingresos que sobrevive a los costos directos.", formula: "Utilidad bruta / ingresos", fmt: "pct" },
  operating_profit: { titulo: "Operating Profit", significado: "Resultado del negocio después de costos y gastos operativos.", formula: "Ingresos − costos − gastos", fmt: "money" },
  operating_margin: { titulo: "Operating Margin", significado: "Qué porcentaje de los ingresos queda como resultado operativo.", formula: "Resultado operativo / ingresos", fmt: "pct" },
  ebitda_aprox: { titulo: "EBITDA aprox.", significado: "Aproximación de gestión de la generación operativa (sin inversiones ni sueldo).", formula: "Ingresos − costos − gastos", fmt: "money" },
  net_cash_flow: { titulo: "Net Cash Flow", significado: "Plata neta que entró/salió del negocio en el mes.", formula: "Ingresos − (costos + gastos + inversiones + sueldo)", fmt: "money" },
  expense_ratio: { titulo: "Expense Ratio", significado: "Peso de los gastos operativos sobre los ingresos.", formula: "Gastos / ingresos", fmt: "pct" },
  cost_ratio: { titulo: "Cost Ratio", significado: "Peso de los costos directos sobre los ingresos.", formula: "Costos / ingresos", fmt: "pct" },
  break_even: { titulo: "Break-even", significado: "Cuánto necesitás facturar para cubrir costos + gastos del mes.", formula: "Costos + gastos", fmt: "money" },
  revenue_per_turn: { titulo: "Revenue / Turno", significado: "Ingreso promedio por turno vendido.", formula: "Ingresos / turnos", fmt: "money" },
  cost_per_turn: { titulo: "Costo / Turno", significado: "Costo directo promedio por turno.", formula: "Costos / turnos", fmt: "money" },
  profit_per_turn: { titulo: "Ganancia / Turno", significado: "Resultado operativo promedio por turno.", formula: "Resultado operativo / turnos", fmt: "money" },
  average_ticket: { titulo: "Ticket promedio", significado: "Ingreso automático promedio por turno del stand.", formula: "Ingresos del stand / turnos", fmt: "money" },
  occupancy_rate: { titulo: "Ocupación", significado: "Qué parte de la capacidad teórica del mes se usó.", formula: "Turnos / capacidad teórica", fmt: "pct" },
  revenue_per_simulator: { titulo: "Revenue / Simulador", significado: "Ingreso por cada simulador activo.", formula: "Ingresos / simuladores", fmt: "money" },
  revenue_per_simulator_hour: { titulo: "Revenue / Hora sim.", significado: "Ingreso por hora disponible de simulador.", formula: "Ingresos / horas de simulador", fmt: "money" },
  roi: { titulo: "ROI", significado: "Retorno sobre la inversión acumulada.", formula: "Resultado / inversión acumulada", fmt: "pct" },
  roa: { titulo: "ROA", significado: "Retorno sobre los activos estimados.", formula: "Resultado / activos", fmt: "pct" },
  payback_meses: { titulo: "Payback", significado: "Meses para recuperar la inversión con el flujo promedio.", formula: "Inversión / flujo promedio mensual", fmt: "meses" },
  cash_burn: { titulo: "Cash Burn", significado: "Egresos operativos cuando el resultado es negativo.", formula: "Costos + gastos (si resultado < 0)", fmt: "money" },
  runway_meses: { titulo: "Runway", significado: "Meses de caja disponible al ritmo de egresos actual.", formula: "Caja disponible / egresos promedio", fmt: "meses" },
  mom_growth: { titulo: "MoM Growth", significado: "Crecimiento de ingresos vs el mes anterior.", formula: "(Ingresos − ingresos mes anterior) / mes anterior", fmt: "pct" },
};

function fmtMetrica(v: number | null, fmt: string): string {
  if (v === null || v === undefined) return "—";
  if (fmt === "pct") return pct(v);
  if (fmt === "meses") return `${v} meses`;
  if (fmt === "num") return String(v);
  return dinero(v);
}

function diagnosticoMetrica(key: string, m: MetricasApi["metricas"], ctx: MetricasApi["contexto"]): { diagnostico: string; recomendacion: string; datos: Array<[string, string]> } {
  const ingresos = Number(ctx.ingresos) || 0;
  const costos = Number(ctx.costos) || 0;
  const gastos = Number(ctx.gastos) || 0;
  const turnos = Number(ctx.turnos) || 0;
  const hayCostos = Boolean(ctx.hay_costos);
  const hayGastos = Boolean(ctx.hay_gastos);
  const sinIngresos = ingresos === 0;
  const val = m[key] as number | null;

  let diagnostico = "";
  let recomendacion = "";
  const datos: Array<[string, string]> = [];

  const advCostosGastos = () => {
    if (!hayCostos && !hayGastos) return "Todavía no cargaste costos ni gastos del mes, así que este número está incompleto. ";
    if (!hayCostos) return "Todavía no cargaste costos directos, así que el número puede estar sobreestimado. ";
    if (!hayGastos) return "Todavía no cargaste gastos operativos (alquiler, sueldos, servicios…), así que puede estar sobreestimado. ";
    return "";
  };

  switch (key) {
    case "revenue":
      datos.push(["Automáticos", dinero(Number(ctx.ingresos_automaticos))], ["Manuales", dinero(Number(ctx.ingresos_manuales))], ["Turnos", String(turnos)]);
      diagnostico = sinIngresos ? "No hay ingresos cargados este mes todavía (ni automáticos ni manuales)." : `Facturaste ${dinero(ingresos)} este mes.`;
      recomendacion = sinIngresos ? "Verificá que el turnero y los pagos estén cargando movimientos." : "Compará contra tu meta de facturación en Config.";
      break;
    case "operating_margin":
    case "gross_margin":
    case "operating_profit":
    case "gross_profit":
    case "ebitda_aprox":
      datos.push(["Ingresos", dinero(ingresos)], ["Costos", dinero(costos)], ["Gastos", dinero(gastos)]);
      if (sinIngresos) { diagnostico = "Con ingresos en $0 no se puede calcular un margen real."; recomendacion = "Cargá o esperá los ingresos del mes."; }
      else if (!hayCostos && !hayGastos) { diagnostico = `Figura muy alto porque todavía no cargaste costos ni gastos. No significa que el negocio tenga ese margen real, sino que faltan registrar egresos del mes.`; recomendacion = "Cargá alquiler, sueldos, servicios, comisiones y demás gastos para obtener un resultado real."; }
      else if (val !== null && val < 0) { diagnostico = `Está en negativo: los costos y gastos superan a los ingresos del mes.`; recomendacion = "Revisá gastos altos y evaluá subir precios o volumen de turnos."; }
      else { diagnostico = `${advCostosGastos()}Con los datos cargados el resultado es ${key.includes("margin") ? pct(val) : dinero(val)}.`; recomendacion = hayCostos && hayGastos ? "Buen punto de partida; seguí comparando mes a mes." : "Completá los egresos faltantes para afinar el número."; }
      break;
    case "occupancy_rate":
      datos.push(["Turnos", String(turnos)], ["Capacidad teórica", String(Number(ctx.capacidad_teorica))], ["Días operativos", String(Number(ctx.dias_operativos))], ["Duración turno", `${Number(ctx.duracion_turno_min)} min`]);
      if (Number(ctx.capacidad_teorica) === 0) { diagnostico = "La capacidad teórica es 0 (revisá simuladores/horas/días en Config)."; recomendacion = "Configurá simuladores y horas operativas."; }
      else if (val !== null && val < 0.25) { diagnostico = `Ocupación baja (${pct(val)}): se usó poca capacidad del stand.`; recomendacion = "Reforzá difusión, promos en días flojos o eventos para llenar horarios."; }
      else { diagnostico = `Ocupación de ${pct(val)} sobre la capacidad teórica del mes.`; recomendacion = "Compará contra tu meta de ocupación en Config."; }
      break;
    case "revenue_per_turn": case "cost_per_turn": case "profit_per_turn": case "average_ticket":
      datos.push(["Turnos", String(turnos)], ["Ingresos", dinero(ingresos)]);
      if (turnos === 0) { diagnostico = "Sin turnos cargados no se puede calcular un promedio por turno."; recomendacion = "Verificá que el turnero registre turnos este mes."; }
      else { diagnostico = `${advCostosGastos()}Promedio por turno: ${dinero(val)}.`; recomendacion = "Mirá la evolución mes a mes para ver si mejora."; }
      break;
    case "roi": case "roa": case "payback_meses":
      datos.push(["Inversión acumulada", dinero(Number(ctx.inversion_acumulada))], ["Valor activos", dinero(Number(ctx.valor_activos))], ["Resultado operativo", dinero(Number(ctx.resultado_operativo))]);
      if (!ctx.hay_inversion_config && key === "roi") { diagnostico = "ROI en 0/— porque no cargaste inversión (inicial ni movimientos de inversión)."; recomendacion = "Cargá la inversión inicial en Config o registrá inversiones para medir el retorno."; }
      else if (key === "roa" && !ctx.hay_activos_config && !ctx.hay_inversion_config) { diagnostico = "ROA sin base: no configuraste valor de activos ni inversión."; recomendacion = "Cargá un valor estimado de activos en Config."; }
      else if (val === null) { diagnostico = "No se puede calcular con los datos actuales (falta inversión/flujo positivo)."; recomendacion = "Cargá inversión y sostené resultado operativo positivo."; }
      else { diagnostico = `Con la inversión cargada, el valor es ${key === "payback_meses" ? `${val} meses` : pct(val)}.`; recomendacion = "Es una aproximación de gestión; afinala cargando bien inversión y activos."; }
      break;
    case "runway_meses": case "cash_burn":
      datos.push(["Caja disponible", dinero(Number(ctx.caja_disponible))], ["Egresos promedio", dinero(Number(ctx.egresos_promedio))], ["Resultado operativo", dinero(Number(ctx.resultado_operativo))]);
      if (key === "cash_burn" && val === null) { diagnostico = "No hay quema de caja: el resultado operativo del mes no es negativo."; recomendacion = "Mantené el resultado operativo positivo."; }
      else if (key === "runway_meses" && val === null) { diagnostico = "Sin egresos promedio suficientes para estimar runway."; recomendacion = "Cargá los gastos del mes para estimar cuántos meses de caja tenés."; }
      else { diagnostico = key === "runway_meses" ? `Te alcanza la caja para ~${val} meses al ritmo de egresos actual.` : `Estás quemando ${dinero(val)} de caja este mes.`; recomendacion = key === "runway_meses" && (val as number) < 3 ? "Runway corto: cuidá gastos y priorizá ingresos." : "Seguí monitoreando mes a mes."; }
      break;
    case "mom_growth":
      datos.push(["Ingresos mes", dinero(ingresos)], ["Mes anterior", ctx.ingresos_mes_anterior !== null ? dinero(Number(ctx.ingresos_mes_anterior)) : "—"]);
      if (val === null) { diagnostico = "No hay mes anterior válido dentro de Finanzas para comparar."; recomendacion = "La comparación aparece a partir del segundo mes operativo."; }
      else { diagnostico = `Los ingresos ${val >= 0 ? "crecieron" : "cayeron"} ${pct(Math.abs(val))} respecto al mes anterior.`; recomendacion = val >= 0 ? "Buen ritmo; sostené lo que funcionó." : "Revisá qué cambió respecto al mes anterior."; }
      break;
    case "break_even":
      datos.push(["Costos", dinero(costos)], ["Gastos", dinero(gastos)], ["Ingresos", dinero(ingresos)]);
      diagnostico = (!hayCostos && !hayGastos) ? "Break-even en 0 porque no cargaste costos ni gastos todavía." : `Necesitás facturar ${dinero(val)} para cubrir costos + gastos. ${ingresos >= (val || 0) ? "Ya lo superaste este mes." : "Todavía no lo alcanzaste."}`;
      recomendacion = "Cargá todos los gastos fijos para que el punto de equilibrio sea realista.";
      break;
    default:
      datos.push(["Ingresos", dinero(ingresos)], ["Costos", dinero(costos)], ["Gastos", dinero(gastos)]);
      diagnostico = `${advCostosGastos()}Valor del mes: ${fmtMetrica(val, METRICA_DEFS[key]?.fmt || "money")}.`;
      recomendacion = "Cargá todos los egresos del mes para un número más preciso.";
  }
  return { diagnostico, recomendacion, datos };
}

function CardMetrica({ def, valor, semaforo, onClick }: { def: { titulo: string; formula: string }; valor: string; semaforo?: "verde" | "ambar" | "rojo" | null; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-2xl border border-white/10 bg-black p-4 text-left transition hover:border-red-500/60">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-[0.15em] text-white/40">{def.titulo}</p>
        {semaforo && <span className={`inline-block h-2.5 w-2.5 rounded-full ${semaforo === "verde" ? "bg-green-500" : semaforo === "ambar" ? "bg-amber-500" : "bg-red-600"}`} />}
      </div>
      <p className="mt-2 text-xl font-black md:text-2xl">{valor}</p>
      <p className="mt-1 truncate text-[10px] text-white/25">{def.formula}</p>
      <p className="mt-1 text-[10px] font-bold uppercase text-red-500/70">Ver detalle →</p>
    </button>
  );
}

function TabMetricas({ metricas }: { metricas: MetricasApi | null }) {
  const [detalle, setDetalle] = useState<string | null>(null);
  if (!metricas) return <p className="text-white/60">Cargando métricas...</p>;
  const m = metricas.metricas;
  const ctx = metricas.contexto;
  const serie = metricas.serie;
  const maxIngreso = Math.max(...serie.map((s) => s.ingresos), 1);

  const semMargen = (v: number | null): "verde" | "ambar" | "rojo" | null => v === null ? null : v >= 0.3 ? "verde" : v >= 0.1 ? "ambar" : "rojo";
  const semPos = (v: number | null): "verde" | "ambar" | "rojo" | null => v === null ? null : v > 0 ? "verde" : v === 0 ? "ambar" : "rojo";

  const grupos: Array<{ titulo: string; keys: MetricaKey[] }> = [
    { titulo: "Rentabilidad", keys: ["revenue", "gross_profit", "gross_margin", "operating_profit", "operating_margin", "ebitda_aprox", "net_cash_flow", "mom_growth"] },
    { titulo: "Estructura y equilibrio", keys: ["cost_ratio", "expense_ratio", "break_even"] },
    { titulo: "Operación del stand", keys: ["revenue_per_turn", "cost_per_turn", "profit_per_turn", "average_ticket", "occupancy_rate", "revenue_per_simulator", "revenue_per_simulator_hour"] },
    { titulo: "Inversión y caja", keys: ["roi", "roa", "payback_meses", "cash_burn", "runway_meses"] },
  ];
  const semKey = (k: string): "verde" | "ambar" | "rojo" | null => {
    const v = m[k] as number | null;
    if (["gross_margin", "operating_margin"].includes(k)) return semMargen(v);
    if (["gross_profit", "operating_profit", "net_cash_flow", "profit_per_turn", "mom_growth"].includes(k)) return semPos(v);
    if (k === "occupancy_rate") return v === null ? null : v >= 0.5 ? "verde" : v >= 0.25 ? "ambar" : "rojo";
    if (k === "runway_meses") return v === null ? null : v >= 6 ? "verde" : v >= 3 ? "ambar" : "rojo";
    if (k === "cash_burn") return v !== null ? "rojo" : "verde";
    return null;
  };

  const def = detalle ? METRICA_DEFS[detalle] : null;
  const diag = detalle ? diagnosticoMetrica(detalle, m, ctx) : null;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-black p-4">
        <h3 className="mb-4 text-sm font-black uppercase text-white/60">Evolución (ingresos vs resultado)</h3>
        <div className="flex items-end gap-2 overflow-x-auto pb-2" style={{ minHeight: 140 }}>
          {serie.map((s) => (
            <div key={s.mes} className="flex min-w-[70px] flex-1 flex-col items-center gap-1">
              <span className="text-[10px] font-black text-white/60">{dinero(s.ingresos)}</span>
              <div className="flex h-24 w-full items-end justify-center gap-1">
                <div className="w-1/3 rounded-t bg-red-600" style={{ height: `${Math.max(3, (s.ingresos / maxIngreso) * 100)}%` }} />
                <div className={`w-1/3 rounded-t ${s.resultado_operativo >= 0 ? "bg-green-500" : "bg-amber-500"}`} style={{ height: `${Math.max(3, (Math.abs(s.resultado_operativo) / maxIngreso) * 100)}%` }} />
              </div>
              <span className="text-[10px] font-bold uppercase text-white/40">{labelMes(s.mes)}</span>
            </div>
          ))}
        </div>
      </div>

      {grupos.map((g) => (
        <div key={g.titulo}>
          <h3 className="mb-3 text-sm font-black uppercase text-white/60">{g.titulo}</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {g.keys.map((k) => (
              <CardMetrica key={k} def={METRICA_DEFS[k]} valor={fmtMetrica(m[k] as number | null, METRICA_DEFS[k].fmt)} semaforo={semKey(k)} onClick={() => setDetalle(k)} />
            ))}
          </div>
        </div>
      ))}

      <p className="text-xs text-white/30">Tocá cualquier métrica para ver qué significa, la fórmula y un diagnóstico con los datos del mes. Son aproximaciones de gestión, no contabilidad formal.</p>

      {detalle && def && diag && (
        <Modal titulo={def.titulo} onCerrar={() => setDetalle(null)}>
          <p className="text-3xl font-black text-red-500">{fmtMetrica(m[detalle] as number | null, def.fmt)}</p>
          <p className="mt-3 text-sm text-white/70">{def.significado}</p>
          <div className="mt-3 rounded-xl bg-white/[0.04] px-3 py-2 text-xs"><span className="font-black uppercase text-white/40">Fórmula:</span> <span className="text-white/70">{def.formula}</span></div>
          <div className="mt-3 grid gap-1.5 md:grid-cols-3">
            {diag.datos.map(([k, v]) => (<div key={k} className="rounded-lg bg-white/[0.04] px-3 py-2"><p className="text-[10px] font-black uppercase text-white/40">{k}</p><p className="text-sm font-black">{v}</p></div>))}
          </div>
          <div className="mt-4 rounded-xl border border-white/10 bg-black p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-amber-400">Diagnóstico</p>
            <p className="mt-1 text-sm text-white/80">{diag.diagnostico}</p>
          </div>
          <div className="mt-3 rounded-xl border border-green-500/20 bg-green-950/10 p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-green-400">Recomendación</p>
            <p className="mt-1 text-sm text-white/80">{diag.recomendacion}</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ═════════ Inicializar saldo general ═════════

function SeccionInicializar({ onHecho }: { onHecho: () => void }) {
  const [mes, setMes] = useState(mesActualLocal());
  const [efectivo, setEfectivo] = useState("");
  const [mp, setMp] = useState("");
  const [observacion, setObservacion] = useState("");
  const [inicializado, setInicializado] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const totalGeneral = (Number(efectivo) || 0) + (Number(mp) || 0);

  const cargar = useCallback(async (m: string) => {
    const r = await fetch(`/api/admin/finanzas/inicializar?mes=${m}`, { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) return;
    setInicializado(Boolean(d.inicializado));
    const ef = Number(d.monto_efectivo) || 0;
    const mercadopago = Number(d.monto_mercado_pago) || 0;
    const general = Number(d.monto) || 0;
    // Compat: saldo viejo cargado sólo como general → lo mostramos en Efectivo.
    if (ef === 0 && mercadopago === 0 && general > 0) {
      setEfectivo(String(general));
      setMp("");
    } else {
      setEfectivo(ef ? String(ef) : "");
      setMp(mercadopago ? String(mercadopago) : "");
    }
    setObservacion(d.observacion || "");
  }, []);
  useEffect(() => { cargar(mes); }, [mes, cargar]);

  async function guardar() {
    if (efectivo === "" && mp === "") { alert("Cargá el saldo inicial (Efectivo y/o Mercado Pago)."); return; }
    if ((efectivo !== "" && !Number.isFinite(Number(efectivo))) || (mp !== "" && !Number.isFinite(Number(mp)))) { alert("Saldo inválido."); return; }
    setGuardando(true);
    try {
      const r = await fetch("/api/admin/finanzas/inicializar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mes, monto_efectivo: Number(efectivo) || 0, monto_mercado_pago: Number(mp) || 0, observacion: observacion || null }) });
      const d = await r.json();
      if (!r.ok) { alert(d.error || "Error"); return; }
      setInicializado(true); onHecho();
    } finally { setGuardando(false); }
  }

  return (
    <div className="rounded-2xl border border-red-500/25 bg-red-950/10 p-4">
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-black uppercase text-red-500">Inicializar saldo</h3>
        {inicializado && <span className="rounded-full border border-green-500/40 px-3 py-0.5 text-[10px] font-black uppercase text-green-400">Mes inicializado</span>}
      </div>
      <p className="mb-4 text-xs text-white/40">Con cuánta plata arranca el mes. Cargalo por fuente (Efectivo y/o Mercado Pago); el saldo inicial del mes es el total general. Solo mueve la caja: no cuenta como ingreso, costo, gasto ni métrica. Los meses siguientes arrancan solos con el saldo real del cierre anterior.</p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Mes</label>
          <input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className="rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Efectivo</label>
          <input type="number" value={efectivo} onChange={(e) => setEfectivo(e.target.value)} placeholder="$ 0" className="w-36 rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/25 focus:border-red-500" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Mercado Pago</label>
          <input type="number" value={mp} onChange={(e) => setMp(e.target.value)} placeholder="$ 0" className="w-36 rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/25 focus:border-red-500" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Saldo inicial general</label>
          <div className="w-36 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-black text-green-400">{dinero(totalGeneral)}</div>
        </div>
        <div className="min-w-[180px] flex-1">
          <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Observación</label>
          <input type="text" value={observacion} onChange={(e) => setObservacion(e.target.value)} placeholder="Ej: arranque del sistema" className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/25 focus:border-red-500" />
        </div>
        <button onClick={guardar} disabled={guardando} className="rounded-xl bg-red-600 px-6 py-2.5 text-xs font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30">{guardando ? "..." : inicializado ? "Actualizar" : "Inicializar"}</button>
      </div>
    </div>
  );
}

// ═════════ TAB: Config ═════════

const CONFIG_CAMPOS: Array<{ campo: string; label: string; ayuda: string }> = [
  { campo: "cantidad_simuladores", label: "Simuladores activos (default)", ayuda: "Por día; podés poner excepciones por fecha" },
  { campo: "horas_operativas_dia", label: "Horas operativas por día (default)", ayuda: "Por día; podés poner excepciones por fecha" },
  { campo: "valor_activos", label: "Valor estimado de activos ($)", ayuda: "Usado en ROA (si es 0 se usa inversión acumulada)" },
  { campo: "inversion_inicial", label: "Inversión inicial estimada ($)", ayuda: "Base del ROI y payback" },
  { campo: "meta_facturacion", label: "Meta de facturación mensual ($)", ayuda: "Objetivo de ingresos" },
  { campo: "meta_margen_operativo", label: "Meta de margen operativo (0-1)", ayuda: "Ej: 0.3 = 30%" },
  { campo: "meta_ocupacion", label: "Meta de ocupación (0-1)", ayuda: "Ej: 0.5 = 50%" },
];

function TabConfig({ config, onGuardado }: { config: Configuracion | null; onGuardado: (c: Configuracion) => void }) {
  const [valores, setValores] = useState<Record<string, string>>({});
  const [mesInicio, setMesInicio] = useState("2026-07");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!config) return;
    const v: Record<string, string> = {};
    for (const { campo } of CONFIG_CAMPOS) v[campo] = String(config[campo] ?? 0);
    setValores(v);
    if (config.mes_inicio) setMesInicio(String(config.mes_inicio));
  }, [config]);

  if (!config) return <p className="text-white/60">Cargando configuración...</p>;

  async function guardar() {
    setGuardando(true);
    try {
      const payload: Record<string, number | string> = { mes_inicio: mesInicio };
      for (const { campo } of CONFIG_CAMPOS) payload[campo] = Number(valores[campo]) || 0;
      const r = await fetch("/api/admin/finanzas/configuracion", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (!r.ok) { alert(d.error || "Error"); return; }
      onGuardado(d.configuracion);
    } finally { setGuardando(false); }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="mb-1 text-sm font-black uppercase text-white/60">Configuración operativa</h3>
        <p className="mb-4 text-xs text-white/35">Los días operativos del mes se calculan solos (días del calendario − días cerrados). La duración de turno se calcula sola (15 min + demora promedio real de subida).</p>
        <div className="mb-4 max-w-xs">
          <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.15em] text-white/40">Mes inicial de Finanzas</label>
          <input type="month" value={mesInicio} onChange={(e) => e.target.value && setMesInicio(e.target.value)} className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500" />
          <p className="mt-1 text-[10px] text-white/30">Mes cero operativo. Los meses anteriores no muestran datos ni permiten cargar.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {CONFIG_CAMPOS.map(({ campo, label, ayuda }) => (
            <div key={campo}>
              <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.15em] text-white/40">{label}</label>
              <input type="number" min={0} step="any" value={valores[campo] ?? ""} onChange={(e) => setValores({ ...valores, [campo]: e.target.value })} className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500" />
              <p className="mt-1 text-[10px] text-white/30">{ayuda}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={guardar} disabled={guardando} className="rounded-xl bg-red-600 px-6 py-2.5 text-xs font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30">{guardando ? "Guardando..." : "Guardar configuración"}</button>
        </div>
      </div>

      <SeccionExcepciones />
    </div>
  );
}

// ═════════ Excepciones operativas ═════════

function SeccionExcepciones() {
  const [mes, setMes] = useState(mesActualLocal());
  const [items, setItems] = useState<Excepcion[]>([]);
  const [fecha, setFecha] = useState(`${mesActualLocal()}-01`);
  const [modo, setModo] = useState<"cerrado" | "horas" | "simuladores">("cerrado");
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async (m: string) => {
    const r = await fetch(`/api/admin/finanzas/excepciones?mes=${m}`, { cache: "no-store" });
    const d = await r.json();
    if (r.ok) setItems(d.excepciones || []);
  }, []);
  useEffect(() => { cargar(mes); setFecha(`${mes}-01`); }, [mes, cargar]);

  async function agregar() {
    const body: Record<string, unknown> = { fecha, motivo: motivo || null };
    if (modo === "cerrado") body.cerrado = true;
    else if (modo === "horas") body.horas = Number(valor);
    else body.simuladores = Number(valor);
    setGuardando(true);
    try {
      const r = await fetch("/api/admin/finanzas/excepciones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { alert(d.error || "Error"); return; }
      setValor(""); setMotivo(""); cargar(mes);
    } finally { setGuardando(false); }
  }
  async function eliminar(f: string) {
    const r = await fetch(`/api/admin/finanzas/excepciones?fecha=${f}`, { method: "DELETE" });
    if (r.ok) cargar(mes);
  }
  const sel = "rounded-xl border border-white/15 bg-black px-3 py-2 text-xs font-bold outline-none focus:border-red-500";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="mb-1 text-sm font-black uppercase text-white/60">Días cerrados / excepciones</h3>
      <p className="mb-3 text-xs text-white/35">Marcá días cerrados (feriado, mantenimiento) o cargá horas/simuladores distintos al default para una fecha. Ajusta capacidad y ocupación.</p>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div><label className="mb-1 block text-[10px] font-black uppercase text-white/40">Mes</label><input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className={sel} /></div>
        <div><label className="mb-1 block text-[10px] font-black uppercase text-white/40">Fecha</label><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={sel} /></div>
        <div><label className="mb-1 block text-[10px] font-black uppercase text-white/40">Tipo</label>
          <select value={modo} onChange={(e) => setModo(e.target.value as typeof modo)} className={sel}><option value="cerrado">Cerrado</option><option value="horas">Horas</option><option value="simuladores">Simuladores</option></select>
        </div>
        {modo !== "cerrado" && <div><label className="mb-1 block text-[10px] font-black uppercase text-white/40">{modo === "horas" ? "Horas" : "Simuladores"}</label><input type="number" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0" className={`${sel} w-24`} /></div>}
        <div className="min-w-[140px] flex-1"><label className="mb-1 block text-[10px] font-black uppercase text-white/40">Motivo</label><input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Opcional" className={`${sel} w-full placeholder:text-white/25`} /></div>
        <button onClick={agregar} disabled={guardando || (modo !== "cerrado" && valor === "")} className="rounded-xl bg-red-600 px-5 py-2 text-xs font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30">Agregar</button>
      </div>
      {items.length === 0 ? <p className="text-sm text-white/40">Sin excepciones este mes (todos los días abiertos con el default).</p> : (
        <div className="space-y-1.5">
          {items.map((e) => (
            <div key={e.id} className="flex items-center justify-between rounded-lg bg-white/[0.04] px-3 py-2 text-sm">
              <span className="font-bold text-white/70">{e.fecha} · {e.cerrado ? <span className="text-red-400">Cerrado</span> : e.horas !== null ? `${e.horas} horas` : `${e.simuladores} simuladores`}{e.motivo && <span className="text-white/40"> — {e.motivo}</span>}</span>
              <button onClick={() => eliminar(e.fecha)} className="rounded-lg border border-white/15 px-2 py-1 text-[10px] font-black uppercase text-white/50 hover:border-red-500 hover:text-white">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
