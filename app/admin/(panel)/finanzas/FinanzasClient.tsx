"use client";

// Módulo Finanzas — UI admin. Todo el estado vive acá; las APIs son
// /api/admin/finanzas/* (solo admin). Diseño consistente con el panel actual.

import { useCallback, useEffect, useMemo, useState } from "react";

// ── Tipos (espejo de las APIs) ───────────────────────────────────────────────

type Cuenta = {
  id: string;
  nombre: string;
  ambito: "sim" | "personal" | "compartida";
  tipo: string;
  activa: boolean;
  orden: number;
};

type Categoria = {
  id: string;
  nombre: string;
  ambito: "sim" | "personal" | "ambos";
  tipo: "ingreso" | "costo" | "gasto" | "inversion" | "retiro" | "ajuste";
  activa: boolean;
  orden: number;
};

type Movimiento = {
  id: string;
  fecha: string;
  mes_contable: string;
  ambito: "sim" | "personal";
  tipo: "ingreso" | "egreso" | "transferencia" | "ajuste";
  clasificacion: string;
  cuenta_origen_id: string | null;
  cuenta_destino_id: string | null;
  categoria_id: string | null;
  subcategoria: string | null;
  descripcion: string;
  monto: number;
  observaciones: string | null;
  origen: string;
};

type SaldoCuentaApi = {
  cuenta: Cuenta;
  saldo_inicial: number;
  ingresos: number;
  egresos: number;
  transferencias_entrantes: number;
  transferencias_salientes: number;
  saldo_teorico: number;
};

type IngresoAuto = {
  fuente: string;
  fuenteLabel: string;
  categoria: string;
  metodo: string;
  cuentaTipo: string | null;
  total: number;
  cantidad: number;
};

type ResumenApi = {
  mes: string;
  antes_de_inicio?: boolean;
  mes_inicio?: string;
  resumen: {
    ingresosAutomaticos: number;
    ingresosManualesSim: number;
    ingresosSim: number;
    costos: number;
    gastos: number;
    inversiones: number;
    retiros: number;
    resultadoOperativo: number;
    personal: { ingresos: number; gastos: number; porCategoria: Record<string, number> };
    turnosDelMes: number;
  };
  ingresosAutomaticos: IngresoAuto[];
  saldos: SaldoCuentaApi[];
  totales: {
    saldo_inicial: number;
    saldo_teorico: number;
    saldo_real: number | null;
    diferencia_cierre: number | null;
  };
  cierre: { estado: string; observaciones?: string | null; cerrado_at?: string | null };
};

type Regla = {
  id: string;
  ambito: string | null;
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

type CierreApi = {
  mes: string;
  estado: string;
  observaciones: string | null;
  cerrado_at: string | null;
  cuentas: Array<{
    cuenta: Cuenta;
    saldo_inicial: number;
    saldo_teorico: number;
    saldo_real_guardado: number | null;
    diferencia_guardada: number | null;
  }>;
};

type MetricasApi = {
  mes: string;
  metricas: Record<string, number | null> & {
    estructura_costos: Record<string, number | null>;
  };
  serie: Array<{
    mes: string;
    ingresos: number;
    costos: number;
    gastos: number;
    resultado_operativo: number;
    turnos: number;
  }>;
  contexto: {
    turnos: number;
    capacidad_teorica: number;
    inversion_acumulada: number;
    caja_disponible: number;
    egresos_promedio: number;
    inversiones_mes: number;
    retiros_mes: number;
    config: Record<string, number>;
  };
};

type Configuracion = Record<string, number | string>;

type Sugerencia = {
  ambito: "sim" | "personal";
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
  const nombres = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return `${nombres[m - 1]} ${y}`;
}

function labelMesLargo(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const nombres = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  return `${nombres[m - 1]} ${y}`;
}

const TIPO_LABEL: Record<string, string> = {
  ingreso: "Ingreso",
  egreso: "Egreso",
  transferencia: "Transferencia",
  ajuste: "Ajuste",
};

const CLASIF_LABEL: Record<string, string> = {
  ingreso: "Ingreso",
  costo: "Costo",
  gasto: "Gasto",
  inversion: "Inversión",
  retiro: "Retiro",
  ajuste: "Ajuste",
  otro: "Otro",
};

const TABS = [
  { id: "resumen", label: "Resumen" },
  { id: "movimientos", label: "Movimientos" },
  { id: "cierre", label: "Cierre mensual" },
  { id: "personal", label: "Personal" },
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
  ambito: "sim" | "personal";
  tipo: "ingreso" | "egreso" | "ajuste";
  clasificacion: string;
  cuenta_origen_id: string;
  cuenta_destino_id: string;
  categoria_id: string;
  descripcion: string;
  monto: string;
  observaciones: string;
};

function movFormVacio(preset: Partial<MovForm> = {}): MovForm {
  return {
    id: null,
    fecha: fechaHoy(),
    ambito: "sim",
    tipo: "egreso",
    clasificacion: "gasto",
    cuenta_origen_id: "",
    cuenta_destino_id: "",
    categoria_id: "",
    descripcion: "",
    monto: "",
    observaciones: "",
    ...preset,
  };
}

type TransfForm = {
  fecha: string;
  cuenta_origen_id: string;
  cuenta_destino_id: string;
  monto: string;
  descripcion: string;
  observaciones: string;
};

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

  // Modales
  const [movForm, setMovForm] = useState<MovForm | null>(null);
  const [transfForm, setTransfForm] = useState<TransfForm | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Carga rápida
  const [textoRapido, setTextoRapido] = useState("");
  const [clasificando, setClasificando] = useState(false);

  const cuentasPorId = useMemo(() => {
    const m: Record<string, Cuenta> = {};
    for (const c of cuentas) m[c.id] = c;
    return m;
  }, [cuentas]);

  const categoriasPorId = useMemo(() => {
    const m: Record<string, Categoria> = {};
    for (const c of categorias) m[c.id] = c;
    return m;
  }, [categorias]);

  const mostrarAviso = useCallback((msg: string) => {
    setAviso(msg);
    setTimeout(() => setAviso(null), 3500);
  }, []);

  // ── Fetch helpers ──
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
      if (!rm.ok) throw new Error(dm.error || "Error");
      setResumen(dr);
      setMovimientos((dm.movimientos || []).map((x: Movimiento) => ({ ...x, monto: Number(x.monto) })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando el mes");
    } finally {
      setCargando(false);
    }
  }, []);

  const cargarCierre = useCallback(async (m: string) => {
    const r = await fetch(`/api/admin/finanzas/cierre?mes=${m}`, { cache: "no-store" });
    const d = await r.json();
    if (r.ok && Array.isArray(d.cuentas)) setCierre(d);
  }, []);

  const cargarReglas = useCallback(async () => {
    const r = await fetch("/api/admin/finanzas/reglas", { cache: "no-store" });
    const d = await r.json();
    if (r.ok) setReglas(d.reglas || []);
  }, []);

  const cargarMetricas = useCallback(async (m: string) => {
    const r = await fetch(`/api/admin/finanzas/metricas?mes=${m}`, { cache: "no-store" });
    const d = await r.json();
    if (r.ok && d.metricas) setMetricas(d);
  }, []);

  const cargarConfig = useCallback(async () => {
    const r = await fetch("/api/admin/finanzas/configuracion", { cache: "no-store" });
    const d = await r.json();
    if (r.ok) setConfig(d.configuracion);
  }, []);

  useEffect(() => {
    cargarBase();
  }, [cargarBase]);

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
  const TABS_DATOS: TabId[] = ["resumen", "movimientos", "cierre", "personal", "metricas"];

  // ── Acciones ──
  async function guardarMovimiento() {
    if (!movForm) return;
    setGuardando(true);
    try {
      const payload = {
        fecha: movForm.fecha,
        ambito: movForm.ambito,
        tipo: movForm.tipo,
        clasificacion: movForm.clasificacion,
        cuenta_origen_id: movForm.tipo === "ajuste" && movForm.cuenta_destino_id ? null : movForm.cuenta_origen_id || null,
        cuenta_destino_id: movForm.tipo === "ajuste" ? movForm.cuenta_destino_id || null : null,
        categoria_id: movForm.categoria_id || null,
        descripcion: movForm.descripcion,
        monto: Number(movForm.monto),
        observaciones: movForm.observaciones || null,
      };
      const url = movForm.id
        ? `/api/admin/finanzas/movimientos/${movForm.id}`
        : "/api/admin/finanzas/movimientos";
      const r = await fetch(url, {
        method: movForm.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) {
        alert(d.error || "Error guardando");
        return;
      }
      setMovForm(null);
      mostrarAviso(movForm.id ? "Movimiento actualizado" : "Movimiento cargado");
      refrescar();
    } finally {
      setGuardando(false);
    }
  }

  async function eliminarMovimiento(id: string) {
    if (!confirm("¿Eliminar este movimiento?")) return;
    const r = await fetch(`/api/admin/finanzas/movimientos/${id}`, { method: "DELETE" });
    const d = await r.json();
    if (!r.ok) {
      alert(d.error || "Error eliminando");
      return;
    }
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
          observaciones: transfForm.observaciones || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        alert(d.error || "Error creando transferencia");
        return;
      }
      setTransfForm(null);
      mostrarAviso("Transferencia registrada");
      refrescar();
    } finally {
      setGuardando(false);
    }
  }

  async function clasificarRapido() {
    const texto = textoRapido.trim();
    if (texto.length < 3) return;
    setClasificando(true);
    try {
      const r = await fetch("/api/admin/finanzas/clasificar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto }),
      });
      const d = await r.json();
      if (!r.ok) {
        alert(d.error || "No se pudo interpretar");
        return;
      }
      const s: Sugerencia = d.sugerencia;
      if (s.tipo === "transferencia") {
        setTransfForm({
          fecha: fechaHoy(),
          cuenta_origen_id: s.cuenta_origen_id || "",
          cuenta_destino_id: s.cuenta_destino_id || "",
          monto: s.monto ? String(s.monto) : "",
          descripcion: s.descripcion,
          observaciones: "",
        });
      } else {
        setMovForm(
          movFormVacio({
            ambito: s.ambito,
            tipo: s.tipo === "ajuste" ? "ajuste" : s.tipo,
            clasificacion: s.clasificacion,
            cuenta_origen_id: s.cuenta_origen_id || "",
            categoria_id: s.categoria_id || "",
            descripcion: s.descripcion,
            monto: s.monto ? String(s.monto) : "",
          })
        );
      }
      setTextoRapido("");
    } finally {
      setClasificando(false);
    }
  }

  // categorías filtradas para el form
  const categoriasForm = useMemo(() => {
    if (!movForm) return [];
    const tipoCat = movForm.tipo === "ingreso" ? "ingreso" : movForm.clasificacion;
    return categorias.filter(
      (c) =>
        c.activa &&
        (c.ambito === movForm.ambito || c.ambito === "ambos") &&
        c.tipo === (tipoCat as Categoria["tipo"])
    );
  }, [categorias, movForm]);

  const cuentasActivas = useMemo(() => cuentas.filter((c) => c.activa), [cuentas]);

  // ═══ RENDER ═══
  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white md:px-6">
      <section className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.3em] text-red-500">Admin SIM</p>
            <h1 className="text-3xl font-black uppercase md:text-5xl">Finanzas</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/60">
              Ingresos, egresos, cuentas, cierres y métricas — todo mes a mes.
            </p>
          </div>

          <div className="flex items-end gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
                Mes
              </label>
              <input
                type="month"
                value={mes}
                onChange={(e) => e.target.value && setMes(e.target.value)}
                className="rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              />
            </div>
            {mesCerrado && (
              <span className="rounded-full border border-amber-500/50 bg-amber-950/30 px-4 py-2 text-xs font-black uppercase text-amber-400">
                Mes cerrado
              </span>
            )}
          </div>
        </div>

        {/* Carga rápida */}
        <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex flex-col gap-2 md:flex-row">
            <input
              type="text"
              value={textoRapido}
              onChange={(e) => setTextoRapido(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && clasificarRapido()}
              placeholder='Carga rápida: "8500 nafta efectivo" · "sim 100000 contador mp" · "transferi 450000 efectivo a mp"'
              className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/25 focus:border-red-500"
            />
            <button
              onClick={clasificarRapido}
              disabled={clasificando || textoRapido.trim().length < 3}
              className="rounded-xl bg-red-600 px-5 py-2 text-sm font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30"
            >
              {clasificando ? "..." : "Interpretar"}
            </button>
          </div>
        </div>

        {/* Botonera principal */}
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={() => setMovForm(movFormVacio({ tipo: "egreso", clasificacion: "gasto" }))}
            className="rounded-full bg-red-600 px-4 py-2 text-xs font-black uppercase transition hover:bg-red-700"
          >
            + Agregar gasto
          </button>
          <button
            onClick={() => setMovForm(movFormVacio({ tipo: "ingreso", clasificacion: "ingreso" }))}
            className="rounded-full border border-white/15 px-4 py-2 text-xs font-black uppercase text-white/70 transition hover:border-red-500 hover:text-white"
          >
            + Ingreso manual
          </button>
          <button
            onClick={() =>
              setTransfForm({
                fecha: fechaHoy(),
                cuenta_origen_id: "",
                cuenta_destino_id: "",
                monto: "",
                descripcion: "",
                observaciones: "",
              })
            }
            className="rounded-full border border-white/15 px-4 py-2 text-xs font-black uppercase text-white/70 transition hover:border-red-500 hover:text-white"
          >
            ⇄ Transferir entre cuentas
          </button>
          <button
            onClick={() => setTab("cierre")}
            className="rounded-full border border-white/15 px-4 py-2 text-xs font-black uppercase text-white/70 transition hover:border-red-500 hover:text-white"
          >
            Cerrar mes
          </button>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03] p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap rounded-xl px-4 py-2 text-xs font-black uppercase transition ${
                tab === t.id ? "bg-red-600 text-white" : "text-white/50 hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {aviso && (
          <div className="mb-4 rounded-2xl border border-green-500/30 bg-green-950/30 px-4 py-3 text-sm font-bold text-green-400">
            {aviso}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm font-bold text-red-400">
            {error}
          </div>
        )}

        {cargando && !resumen ? (
          <p className="text-white/60">Cargando finanzas...</p>
        ) : antesDeInicio && TABS_DATOS.includes(tab) ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center">
            <p className="text-lg font-black uppercase text-white/80">
              Finanzas comienza en {labelMesLargo(resumen?.mes_inicio || "2026-07")}.
            </p>
            <p className="mt-2 text-sm text-white/45">
              No se incluyen datos históricos anteriores. Elegí {labelMesLargo(resumen?.mes_inicio || "2026-07")} o un mes posterior.
            </p>
          </div>
        ) : (
          <>
            {tab === "resumen" && resumen && !resumen.antes_de_inicio && <TabResumen resumen={resumen} />}
            {tab === "movimientos" && (
              <TabMovimientos
                movimientos={movimientos}
                cuentasPorId={cuentasPorId}
                categoriasPorId={categoriasPorId}
                cuentas={cuentasActivas}
                categorias={categorias}
                onEditar={(m) =>
                  setMovForm({
                    id: m.id,
                    fecha: m.fecha,
                    ambito: m.ambito,
                    tipo: m.tipo === "transferencia" ? "egreso" : m.tipo,
                    clasificacion: m.clasificacion,
                    cuenta_origen_id: m.cuenta_origen_id || "",
                    cuenta_destino_id: m.cuenta_destino_id || "",
                    categoria_id: m.categoria_id || "",
                    descripcion: m.descripcion,
                    monto: String(m.monto),
                    observaciones: m.observaciones || "",
                  })
                }
                onEliminar={eliminarMovimiento}
              />
            )}
            {tab === "cierre" && (
              <TabCierre
                mes={mes}
                cierre={cierre}
                onCerrado={() => {
                  mostrarAviso("Cierre guardado");
                  refrescar();
                  cargarCierre(mes);
                }}
                onReabierto={() => {
                  mostrarAviso("Mes reabierto");
                  refrescar();
                  cargarCierre(mes);
                }}
              />
            )}
            {tab === "personal" && resumen && (
              <TabPersonal
                resumen={resumen}
                movimientos={movimientos}
                cuentasPorId={cuentasPorId}
                categoriasPorId={categoriasPorId}
                onAgregarGasto={() =>
                  setMovForm(movFormVacio({ ambito: "personal", tipo: "egreso", clasificacion: "gasto" }))
                }
              />
            )}
            {tab === "categorias" && (
              <TabCategorias categorias={categorias} onCambio={cargarBase} mostrarAviso={mostrarAviso} />
            )}
            {tab === "reglas" && (
              <TabReglas
                reglas={reglas}
                categorias={categorias}
                onCambio={cargarReglas}
                mostrarAviso={mostrarAviso}
              />
            )}
            {tab === "metricas" && <TabMetricas metricas={metricas} />}
            {tab === "config" && (
              <div className="space-y-6">
                <SeccionInicializar
                  cuentas={cuentasActivas}
                  onHecho={() => {
                    mostrarAviso("Saldos inicializados");
                    refrescar();
                  }}
                />
                <TabConfig config={config} onGuardado={(c) => { setConfig(c); mostrarAviso("Configuración guardada"); }} />
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Modal movimiento ── */}
      {movForm && (
        <Modal titulo={movForm.id ? "Editar movimiento" : "Nuevo movimiento"} onCerrar={() => setMovForm(null)}>
          <div className="grid gap-3 md:grid-cols-2">
            <Campo label="Fecha">
              <input
                type="date"
                value={movForm.fecha}
                onChange={(e) => setMovForm({ ...movForm, fecha: e.target.value })}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              />
            </Campo>
            <Campo label="Ámbito">
              <select
                value={movForm.ambito}
                onChange={(e) =>
                  setMovForm({ ...movForm, ambito: e.target.value as "sim" | "personal", categoria_id: "" })
                }
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              >
                <option value="sim">SIM</option>
                <option value="personal">Personal</option>
              </select>
            </Campo>
            <Campo label="Tipo">
              <select
                value={movForm.tipo}
                onChange={(e) => {
                  const tipo = e.target.value as MovForm["tipo"];
                  setMovForm({
                    ...movForm,
                    tipo,
                    clasificacion: tipo === "ingreso" ? "ingreso" : tipo === "ajuste" ? "ajuste" : movForm.clasificacion === "ingreso" ? "gasto" : movForm.clasificacion,
                    categoria_id: "",
                  });
                }}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              >
                <option value="egreso">Egreso</option>
                <option value="ingreso">Ingreso</option>
                <option value="ajuste">Ajuste</option>
              </select>
            </Campo>
            <Campo label="Clasificación">
              <select
                value={movForm.clasificacion}
                onChange={(e) => setMovForm({ ...movForm, clasificacion: e.target.value, categoria_id: "" })}
                disabled={movForm.tipo === "ingreso" || movForm.tipo === "ajuste"}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500 disabled:opacity-40"
              >
                {movForm.tipo === "ingreso" ? (
                  <option value="ingreso">Ingreso</option>
                ) : movForm.tipo === "ajuste" ? (
                  <option value="ajuste">Ajuste</option>
                ) : (
                  <>
                    <option value="costo">Costo</option>
                    <option value="gasto">Gasto</option>
                    <option value="inversion">Inversión</option>
                    <option value="retiro">Retiro</option>
                    <option value="otro">Otro</option>
                  </>
                )}
              </select>
            </Campo>
            {movForm.tipo === "ajuste" ? (
              <>
                <Campo label="Cuenta (suma)">
                  <select
                    value={movForm.cuenta_destino_id}
                    onChange={(e) =>
                      setMovForm({ ...movForm, cuenta_destino_id: e.target.value, cuenta_origen_id: "" })
                    }
                    className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
                  >
                    <option value="">—</option>
                    {cuentasActivas.map((c) => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                  </select>
                </Campo>
                <Campo label="Cuenta (resta)">
                  <select
                    value={movForm.cuenta_origen_id}
                    onChange={(e) =>
                      setMovForm({ ...movForm, cuenta_origen_id: e.target.value, cuenta_destino_id: "" })
                    }
                    className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
                  >
                    <option value="">—</option>
                    {cuentasActivas.map((c) => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                  </select>
                </Campo>
              </>
            ) : (
              <Campo label="Cuenta">
                <select
                  value={movForm.cuenta_origen_id}
                  onChange={(e) => setMovForm({ ...movForm, cuenta_origen_id: e.target.value })}
                  className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
                >
                  <option value="">Elegir cuenta...</option>
                  {cuentasActivas.map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
              </Campo>
            )}
            <Campo label="Categoría">
              <select
                value={movForm.categoria_id}
                onChange={(e) => setMovForm({ ...movForm, categoria_id: e.target.value })}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              >
                <option value="">Sin categoría</option>
                {categoriasForm.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </Campo>
            <Campo label="Monto">
              <input
                type="number"
                min={0}
                value={movForm.monto}
                onChange={(e) => setMovForm({ ...movForm, monto: e.target.value })}
                placeholder="0"
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-red-500"
              />
            </Campo>
            <Campo label="Descripción">
              <input
                type="text"
                value={movForm.descripcion}
                onChange={(e) => setMovForm({ ...movForm, descripcion: e.target.value })}
                placeholder="Ej: Alquiler julio"
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-red-500"
              />
            </Campo>
            <div className="md:col-span-2">
              <Campo label="Observaciones">
                <input
                  type="text"
                  value={movForm.observaciones}
                  onChange={(e) => setMovForm({ ...movForm, observaciones: e.target.value })}
                  placeholder="Notas internas"
                  className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-red-500"
                />
              </Campo>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => setMovForm(null)}
              className="rounded-xl border border-white/15 px-5 py-2.5 text-xs font-black uppercase text-white/60 hover:border-white hover:text-white"
            >
              Cancelar
            </button>
            <button
              onClick={guardarMovimiento}
              disabled={guardando || !movForm.monto || Number(movForm.monto) <= 0}
              className="rounded-xl bg-red-600 px-6 py-2.5 text-xs font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30"
            >
              {guardando ? "Guardando..." : movForm.id ? "Actualizar" : "Guardar"}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Modal transferencia ── */}
      {transfForm && (
        <Modal titulo="Transferir entre cuentas" onCerrar={() => setTransfForm(null)}>
          <div className="grid gap-3 md:grid-cols-2">
            <Campo label="Desde">
              <select
                value={transfForm.cuenta_origen_id}
                onChange={(e) => setTransfForm({ ...transfForm, cuenta_origen_id: e.target.value })}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              >
                <option value="">Cuenta origen...</option>
                {cuentasActivas.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </Campo>
            <Campo label="Hacia">
              <select
                value={transfForm.cuenta_destino_id}
                onChange={(e) => setTransfForm({ ...transfForm, cuenta_destino_id: e.target.value })}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              >
                <option value="">Cuenta destino...</option>
                {cuentasActivas
                  .filter((c) => c.id !== transfForm.cuenta_origen_id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
              </select>
            </Campo>
            <Campo label="Monto">
              <input
                type="number"
                min={0}
                value={transfForm.monto}
                onChange={(e) => setTransfForm({ ...transfForm, monto: e.target.value })}
                placeholder="0"
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-red-500"
              />
            </Campo>
            <Campo label="Fecha">
              <input
                type="date"
                value={transfForm.fecha}
                onChange={(e) => setTransfForm({ ...transfForm, fecha: e.target.value })}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              />
            </Campo>
            <div className="md:col-span-2">
              <Campo label="Observación">
                <input
                  type="text"
                  value={transfForm.descripcion}
                  onChange={(e) => setTransfForm({ ...transfForm, descripcion: e.target.value })}
                  placeholder="Ej: paso efectivo a MP"
                  className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-red-500"
                />
              </Campo>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => setTransfForm(null)}
              className="rounded-xl border border-white/15 px-5 py-2.5 text-xs font-black uppercase text-white/60 hover:border-white hover:text-white"
            >
              Cancelar
            </button>
            <button
              onClick={guardarTransferencia}
              disabled={
                guardando ||
                !transfForm.cuenta_origen_id ||
                !transfForm.cuenta_destino_id ||
                !transfForm.monto ||
                Number(transfForm.monto) <= 0
              }
              className="rounded-xl bg-red-600 px-6 py-2.5 text-xs font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30"
            >
              {guardando ? "Guardando..." : "Transferir"}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}

// ═════════ Componentes auxiliares ═════════

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
        {label}
      </label>
      {children}
    </div>
  );
}

function Modal({
  titulo,
  onCerrar,
  children,
}: {
  titulo: string;
  onCerrar: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/80 p-0 md:items-center md:p-6">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0a0a0a] p-5 md:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black uppercase text-red-500">{titulo}</h3>
          <button onClick={onCerrar} className="text-2xl text-white/40 hover:text-white">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CardKpi({
  titulo,
  valor,
  detalle,
  color,
}: {
  titulo: string;
  valor: string;
  detalle?: string;
  color?: "rojo" | "verde" | "neutro" | "ambar";
}) {
  const colorCls =
    color === "verde"
      ? "text-green-400"
      : color === "rojo"
      ? "text-red-500"
      : color === "ambar"
      ? "text-amber-400"
      : "text-white";
  return (
    <div className="rounded-2xl border border-white/10 bg-black p-4">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">{titulo}</p>
      <p className={`mt-2 text-xl font-black md:text-2xl ${colorCls}`}>{valor}</p>
      {detalle && <p className="mt-1 text-xs text-white/40">{detalle}</p>}
    </div>
  );
}

// ═════════ TAB: Resumen ═════════

function TabResumen({ resumen }: { resumen: ResumenApi }) {
  const r = resumen.resumen;
  const saldosSim = resumen.saldos.filter((s) => s.cuenta.ambito === "sim");

  // agrupar ingresos automáticos por fuente
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
      {/* KPIs principales */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <CardKpi titulo="Ingresos del mes" valor={dinero(r.ingresosSim)} color="verde"
          detalle={`Auto ${dinero(r.ingresosAutomaticos)} + manual ${dinero(r.ingresosManualesSim)}`} />
        <CardKpi titulo="Costos del mes" valor={dinero(r.costos)} color="rojo" />
        <CardKpi titulo="Gastos del mes" valor={dinero(r.gastos)} color="rojo" />
        <CardKpi
          titulo="Resultado operativo"
          valor={dinero(r.resultadoOperativo)}
          color={r.resultadoOperativo >= 0 ? "verde" : "rojo"}
          detalle="Ingresos − costos − gastos"
        />
        <CardKpi titulo="Saldo inicial" valor={dinero(resumen.totales.saldo_inicial)} />
        <CardKpi titulo="Saldo final teórico" valor={dinero(resumen.totales.saldo_teorico)} />
        <CardKpi
          titulo="Saldo real (cierre)"
          valor={resumen.totales.saldo_real !== null ? dinero(resumen.totales.saldo_real) : "Sin cierre"}
        />
        <CardKpi
          titulo="Diferencia de cierre"
          valor={resumen.totales.diferencia_cierre !== null ? dinero(resumen.totales.diferencia_cierre) : "—"}
          color={
            resumen.totales.diferencia_cierre === null
              ? "neutro"
              : Math.abs(resumen.totales.diferencia_cierre) < 1
              ? "verde"
              : "ambar"
          }
        />
      </div>

      {/* Inversiones / retiros / personal resumen corto */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <CardKpi titulo="Inversiones" valor={dinero(r.inversiones)} />
        <CardKpi titulo="Retiros" valor={dinero(r.retiros)} />
        <CardKpi titulo="Turnos del mes" valor={String(r.turnosDelMes)} />
        <CardKpi titulo="Resultado personal" valor={dinero(r.personal.ingresos - r.personal.gastos)}
          color={r.personal.ingresos - r.personal.gastos >= 0 ? "verde" : "rojo"} />
      </div>

      {/* Cuentas */}
      <div>
        <h2 className="mb-3 text-lg font-black uppercase text-red-500">Cuentas SIM</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {saldosSim.map((s) => (
            <div key={s.cuenta.id} className="rounded-2xl border border-white/10 bg-black p-4">
              <p className="text-sm font-black uppercase">{s.cuenta.nombre}</p>
              <p className="mt-2 text-2xl font-black text-red-500">{dinero(s.saldo_teorico)}</p>
              <div className="mt-3 space-y-1 text-xs text-white/50">
                <p>Saldo inicial: <span className="font-bold text-white/80">{dinero(s.saldo_inicial)}</span></p>
                <p>Ingresos: <span className="font-bold text-green-400">{dinero(s.ingresos)}</span></p>
                <p>Egresos: <span className="font-bold text-red-400">{dinero(s.egresos)}</span></p>
                <p>Transf. entrantes: <span className="font-bold text-white/80">{dinero(s.transferencias_entrantes)}</span></p>
                <p>Transf. salientes: <span className="font-bold text-white/80">{dinero(s.transferencias_salientes)}</span></p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Ingresos automáticos */}
      <div className="rounded-2xl border border-white/10 bg-black p-4">
        <h2 className="mb-3 text-lg font-black uppercase text-red-500">
          Ingresos automáticos · {labelMes(resumen.mes)}
        </h2>
        <p className="mb-3 text-xs text-white/40">
          Leídos del sistema (turnero, reservas, gift cards, campeonatos). No se editan desde acá.
        </p>
        {Object.keys(porFuente).length === 0 ? (
          <p className="text-sm text-white/45">Sin ingresos automáticos este mes.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-[10px] font-black uppercase tracking-[0.15em] text-white/35">
                  <th className="pb-2">Fuente</th>
                  <th className="pb-2">Categoría</th>
                  <th className="pb-2 text-right">Cantidad</th>
                  <th className="pb-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(porFuente).map(([fuente, f]) => (
                  <tr key={fuente} className="border-t border-white/5">
                    <td className="py-2 font-bold">{f.label}</td>
                    <td className="py-2 text-white/60">{f.categoria}</td>
                    <td className="py-2 text-right text-white/60">{f.cantidad || "—"}</td>
                    <td className="py-2 text-right font-black text-green-400">{dinero(f.total)}</td>
                  </tr>
                ))}
                <tr className="border-t border-white/10">
                  <td colSpan={3} className="py-2 text-right text-xs font-black uppercase text-white/40">
                    Total automático
                  </td>
                  <td className="py-2 text-right font-black text-green-400">
                    {dinero(resumen.resumen.ingresosAutomaticos)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {/* Detalle por método/cuenta */}
        {resumen.ingresosAutomaticos.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-bold text-white/40 hover:text-white/70">
              Ver detalle por método de pago
            </summary>
            <div className="mt-2 grid gap-1 md:grid-cols-2">
              {resumen.ingresosAutomaticos.map((i, idx) => (
                <div key={idx} className="flex items-center justify-between rounded-lg bg-white/[0.04] px-3 py-1.5 text-xs">
                  <span className="text-white/60">
                    {i.fuenteLabel} · {i.metodo}
                    {i.cuentaTipo ? ` → ${i.cuentaTipo.replace("_", " ")}` : " (sin cuenta)"}
                  </span>
                  <span className="font-black">{dinero(i.total)}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

// ═════════ TAB: Movimientos ═════════

function TabMovimientos({
  movimientos,
  cuentasPorId,
  categoriasPorId,
  cuentas,
  categorias,
  onEditar,
  onEliminar,
}: {
  movimientos: Movimiento[];
  cuentasPorId: Record<string, Cuenta>;
  categoriasPorId: Record<string, Categoria>;
  cuentas: Cuenta[];
  categorias: Categoria[];
  onEditar: (m: Movimiento) => void;
  onEliminar: (id: string) => void;
}) {
  const [fAmbito, setFAmbito] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fClasif, setFClasif] = useState("");
  const [fCuenta, setFCuenta] = useState("");
  const [fCategoria, setFCategoria] = useState("");
  const [fTexto, setFTexto] = useState("");

  const filtrados = useMemo(() => {
    const texto = fTexto.trim().toLowerCase();
    return movimientos.filter((m) => {
      if (fAmbito && m.ambito !== fAmbito) return false;
      if (fTipo && m.tipo !== fTipo) return false;
      if (fClasif && m.clasificacion !== fClasif) return false;
      if (fCuenta && m.cuenta_origen_id !== fCuenta && m.cuenta_destino_id !== fCuenta) return false;
      if (fCategoria && m.categoria_id !== fCategoria) return false;
      if (texto) {
        const blob = `${m.descripcion} ${m.observaciones || ""} ${m.subcategoria || ""}`.toLowerCase();
        if (!blob.includes(texto)) return false;
      }
      return true;
    });
  }, [movimientos, fAmbito, fTipo, fClasif, fCuenta, fCategoria, fTexto]);

  const totalFiltrado = filtrados.reduce(
    (a, m) => (m.tipo === "transferencia" ? a : m.tipo === "ingreso" ? a + m.monto : a - m.monto),
    0
  );

  const sel =
    "rounded-xl border border-white/15 bg-black px-3 py-2 text-xs font-bold outline-none focus:border-red-500";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      {/* Filtros */}
      <div className="mb-4 flex flex-wrap gap-2">
        <select value={fAmbito} onChange={(e) => setFAmbito(e.target.value)} className={sel}>
          <option value="">Ámbito: todos</option>
          <option value="sim">SIM</option>
          <option value="personal">Personal</option>
        </select>
        <select value={fTipo} onChange={(e) => setFTipo(e.target.value)} className={sel}>
          <option value="">Tipo: todos</option>
          <option value="ingreso">Ingreso</option>
          <option value="egreso">Egreso</option>
          <option value="transferencia">Transferencia</option>
          <option value="ajuste">Ajuste</option>
        </select>
        <select value={fClasif} onChange={(e) => setFClasif(e.target.value)} className={sel}>
          <option value="">Clasif: todas</option>
          {Object.entries(CLASIF_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select value={fCuenta} onChange={(e) => setFCuenta(e.target.value)} className={sel}>
          <option value="">Cuenta: todas</option>
          {cuentas.map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>
        <select value={fCategoria} onChange={(e) => setFCategoria(e.target.value)} className={sel}>
          <option value="">Categoría: todas</option>
          {categorias.filter((c) => c.activa).map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>
        <input
          type="text"
          value={fTexto}
          onChange={(e) => setFTexto(e.target.value)}
          placeholder="Buscar texto..."
          className={`${sel} placeholder:text-white/25`}
        />
      </div>

      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-white/40">{filtrados.length} movimientos</p>
        <p className="text-xs font-black">
          Neto (sin transferencias):{" "}
          <span className={totalFiltrado >= 0 ? "text-green-400" : "text-red-400"}>{dinero(totalFiltrado)}</span>
        </p>
      </div>

      {filtrados.length === 0 ? (
        <p className="py-6 text-center text-sm text-white/40">No hay movimientos con estos filtros.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="text-left text-[10px] font-black uppercase tracking-[0.15em] text-white/35">
                <th className="pb-2 pr-3">Fecha</th>
                <th className="pb-2 pr-3">Ámbito</th>
                <th className="pb-2 pr-3">Tipo</th>
                <th className="pb-2 pr-3">Clasif.</th>
                <th className="pb-2 pr-3">Cuenta</th>
                <th className="pb-2 pr-3">Categoría</th>
                <th className="pb-2 pr-3">Descripción</th>
                <th className="pb-2 pr-3 text-right">Monto</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((m) => {
                const esTransf = m.tipo === "transferencia";
                const esInicial = m.origen === "ajuste_inicial";
                const cuentaTxt = esTransf
                  ? `${cuentasPorId[m.cuenta_origen_id || ""]?.nombre || "?"} → ${cuentasPorId[m.cuenta_destino_id || ""]?.nombre || "?"}`
                  : cuentasPorId[m.cuenta_origen_id || m.cuenta_destino_id || ""]?.nombre || "—";
                return (
                  <tr key={m.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                    <td className="py-2 pr-3 font-bold">{m.fecha}</td>
                    <td className="py-2 pr-3 uppercase text-white/60">{m.ambito}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                          m.tipo === "ingreso"
                            ? "bg-green-950/60 text-green-400"
                            : m.tipo === "egreso"
                            ? "bg-red-950/60 text-red-400"
                            : "bg-white/10 text-white/70"
                        }`}
                      >
                        {esInicial ? "Ajuste inicial" : TIPO_LABEL[m.tipo]}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-white/60">{CLASIF_LABEL[m.clasificacion] || m.clasificacion}</td>
                    <td className="py-2 pr-3 text-white/60">{cuentaTxt}</td>
                    <td className="py-2 pr-3 text-white/60">
                      {m.categoria_id ? categoriasPorId[m.categoria_id]?.nombre || "—" : "—"}
                    </td>
                    <td className="max-w-[220px] truncate py-2 pr-3 text-white/70" title={m.descripcion}>
                      {m.descripcion || "—"}
                    </td>
                    <td
                      className={`py-2 pr-3 text-right font-black ${
                        m.tipo === "ingreso" ? "text-green-400" : m.tipo === "egreso" ? "text-red-400" : "text-white/80"
                      }`}
                    >
                      {dinero(m.monto)}
                    </td>
                    <td className="py-2 text-right">
                      <div className="flex justify-end gap-1">
                        {!esTransf && !esInicial && (
                          <button
                            onClick={() => onEditar(m)}
                            className="rounded-lg border border-white/15 px-2.5 py-1 text-[10px] font-black uppercase text-white/60 hover:border-red-500 hover:text-white"
                          >
                            Editar
                          </button>
                        )}
                        <button
                          onClick={() => onEliminar(m.id)}
                          className="rounded-lg border border-white/15 px-2.5 py-1 text-[10px] font-black uppercase text-white/60 hover:border-red-500 hover:bg-red-600 hover:text-white"
                        >
                          ×
                        </button>
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

function TabCierre({
  mes,
  cierre,
  onCerrado,
  onReabierto,
}: {
  mes: string;
  cierre: CierreApi | null;
  onCerrado: () => void;
  onReabierto: () => void;
}) {
  const [reales, setReales] = useState<Record<string, string>>({});
  const [obs, setObs] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!cierre) return;
    const init: Record<string, string> = {};
    for (const c of cierre.cuentas) {
      init[c.cuenta.id] =
        c.saldo_real_guardado !== null ? String(c.saldo_real_guardado) : "";
    }
    setReales(init);
    setObs(cierre.observaciones || "");
  }, [cierre]);

  if (!cierre) return <p className="text-white/60">Cargando cierre...</p>;

  const cerrado = cierre.estado !== "abierto";

  async function cerrarMes() {
    if (!cierre) return;
    const saldos: Record<string, number> = {};
    for (const c of cierre.cuentas) {
      const v = reales[c.cuenta.id];
      if (v === "" || v === undefined) {
        alert(`Falta el saldo real de "${c.cuenta.nombre}"`);
        return;
      }
      saldos[c.cuenta.id] = Number(v);
    }
    if (!confirm(`¿Cerrar el mes ${mes}? No se podrán cargar movimientos hasta reabrirlo.`)) return;
    setGuardando(true);
    try {
      const r = await fetch("/api/admin/finanzas/cierre", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes, saldos_reales: saldos, observaciones: obs || null }),
      });
      const d = await r.json();
      if (!r.ok) {
        alert(d.error || "Error cerrando el mes");
        return;
      }
      onCerrado();
    } finally {
      setGuardando(false);
    }
  }

  async function reabrir() {
    if (!confirm(`¿Reabrir el mes ${mes}?`)) return;
    setGuardando(true);
    try {
      const r = await fetch("/api/admin/finanzas/reabrir-mes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes }),
      });
      const d = await r.json();
      if (!r.ok) {
        alert(d.error || "Error reabriendo");
        return;
      }
      onReabierto();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-black uppercase text-red-500">Cierre de {labelMes(mes)}</h2>
          <p className="mt-1 text-xs text-white/50">
            Estado:{" "}
            <span
              className={`font-black uppercase ${
                cierre.estado === "abierto"
                  ? "text-white/70"
                  : cierre.estado === "cerrado"
                  ? "text-green-400"
                  : "text-amber-400"
              }`}
            >
              {cierre.estado === "cerrado_con_diferencia" ? "Cerrado con diferencia" : cierre.estado}
            </span>
            {cierre.cerrado_at && ` · ${new Date(cierre.cerrado_at).toLocaleString("es-AR")}`}
          </p>
        </div>
        {cerrado ? (
          <button
            onClick={reabrir}
            disabled={guardando}
            className="rounded-xl border border-amber-500/50 px-5 py-2.5 text-xs font-black uppercase text-amber-400 transition hover:bg-amber-500/10 disabled:opacity-40"
          >
            Reabrir mes
          </button>
        ) : (
          <button
            onClick={cerrarMes}
            disabled={guardando}
            className="rounded-xl bg-red-600 px-6 py-2.5 text-xs font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30"
          >
            {guardando ? "Cerrando..." : "Cerrar mes"}
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black p-4">
        <table className="w-full min-w-[700px] text-sm">
          <thead>
            <tr className="text-left text-[10px] font-black uppercase tracking-[0.15em] text-white/35">
              <th className="pb-2 pr-3">Cuenta</th>
              <th className="pb-2 pr-3 text-right">Saldo inicial</th>
              <th className="pb-2 pr-3 text-right">Saldo teórico</th>
              <th className="pb-2 pr-3 text-right">Saldo real</th>
              <th className="pb-2 text-right">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {cierre.cuentas.map((c) => {
              const realStr = reales[c.cuenta.id] ?? "";
              const real = realStr === "" ? null : Number(realStr);
              const dif = real !== null && Number.isFinite(real) ? real - c.saldo_teorico : null;
              return (
                <tr key={c.cuenta.id} className="border-t border-white/5">
                  <td className="py-2.5 pr-3 font-bold">
                    {c.cuenta.nombre}
                    <span className="ml-2 text-[10px] uppercase text-white/30">{c.cuenta.ambito}</span>
                  </td>
                  <td className="py-2.5 pr-3 text-right text-white/60">{dinero(c.saldo_inicial)}</td>
                  <td className="py-2.5 pr-3 text-right font-black">{dinero(c.saldo_teorico)}</td>
                  <td className="py-2.5 pr-3 text-right">
                    <input
                      type="number"
                      value={realStr}
                      disabled={cerrado}
                      onChange={(e) => setReales({ ...reales, [c.cuenta.id]: e.target.value })}
                      placeholder="0"
                      className="w-32 rounded-lg border border-white/15 bg-black px-2 py-1.5 text-right text-sm font-bold outline-none focus:border-red-500 disabled:opacity-50"
                    />
                  </td>
                  <td
                    className={`py-2.5 text-right font-black ${
                      dif === null ? "text-white/30" : Math.abs(dif) < 1 ? "text-green-400" : "text-amber-400"
                    }`}
                  >
                    {dif === null ? "—" : dinero(dif)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black p-4">
        <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
          Observaciones del cierre
        </label>
        <textarea
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          disabled={cerrado}
          rows={2}
          placeholder="Notas del cierre (diferencias, aclaraciones...)"
          className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/25 focus:border-red-500 disabled:opacity-50"
        />
      </div>

      <p className="text-xs text-white/35">
        El saldo inicial de cada mes se toma automáticamente del saldo real del cierre del mes anterior.
        Saldo teórico = inicial + ingresos − egresos + transferencias entrantes − salientes.
      </p>
    </div>
  );
}

// ═════════ TAB: Personal ═════════

function TabPersonal({
  resumen,
  movimientos,
  cuentasPorId,
  categoriasPorId,
  onAgregarGasto,
}: {
  resumen: ResumenApi;
  movimientos: Movimiento[];
  cuentasPorId: Record<string, Cuenta>;
  categoriasPorId: Record<string, Categoria>;
  onAgregarGasto: () => void;
}) {
  const p = resumen.resumen.personal;
  const saldosPersonal = resumen.saldos.filter((s) => s.cuenta.ambito === "personal");
  const movsPersonal = movimientos.filter((m) => m.ambito === "personal");
  const categoriasOrdenadas = Object.entries(p.porCategoria).sort((a, b) => b[1] - a[1]);
  const maxCat = categoriasOrdenadas.length ? categoriasOrdenadas[0][1] : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-black uppercase text-red-500">Finanzas personales · {labelMes(resumen.mes)}</h2>
        <button
          onClick={onAgregarGasto}
          className="rounded-full bg-red-600 px-4 py-2 text-xs font-black uppercase transition hover:bg-red-700"
        >
          + Gasto personal
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <CardKpi titulo="Ingresos personales" valor={dinero(p.ingresos)} color="verde" />
        <CardKpi titulo="Gastos personales" valor={dinero(p.gastos)} color="rojo" />
        <CardKpi titulo="Resultado" valor={dinero(p.ingresos - p.gastos)}
          color={p.ingresos - p.gastos >= 0 ? "verde" : "rojo"} />
        <CardKpi titulo="Retiros desde SIM" valor={dinero(resumen.resumen.retiros)}
          detalle="Registrados como retiro en SIM" />
      </div>

      {/* Saldos personales */}
      <div className="grid gap-3 md:grid-cols-3">
        {saldosPersonal.map((s) => (
          <div key={s.cuenta.id} className="rounded-2xl border border-white/10 bg-black p-4">
            <p className="text-sm font-black uppercase">{s.cuenta.nombre}</p>
            <p className="mt-2 text-2xl font-black text-red-500">{dinero(s.saldo_teorico)}</p>
            <p className="mt-1 text-xs text-white/40">
              Inicial {dinero(s.saldo_inicial)} · Ingresos {dinero(s.ingresos + s.transferencias_entrantes)} · Egresos{" "}
              {dinero(s.egresos + s.transferencias_salientes)}
            </p>
          </div>
        ))}
      </div>

      {/* Gastos por categoría */}
      <div className="rounded-2xl border border-white/10 bg-black p-4">
        <h3 className="mb-3 text-sm font-black uppercase text-white/60">Gastos por categoría</h3>
        {categoriasOrdenadas.length === 0 ? (
          <p className="text-sm text-white/40">Sin gastos personales este mes.</p>
        ) : (
          <div className="space-y-2">
            {categoriasOrdenadas.map(([cat, monto]) => (
              <div key={cat} className="flex items-center gap-3">
                <span className="w-40 shrink-0 truncate text-xs font-bold text-white/60">{cat}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-red-600"
                    style={{ width: maxCat ? `${Math.max(3, (monto / maxCat) * 100)}%` : "0%" }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right text-xs font-black">{dinero(monto)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Movimientos personales */}
      <div className="rounded-2xl border border-white/10 bg-black p-4">
        <h3 className="mb-3 text-sm font-black uppercase text-white/60">Movimientos personales</h3>
        {movsPersonal.length === 0 ? (
          <p className="text-sm text-white/40">Sin movimientos personales este mes.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <tbody>
                {movsPersonal.map((m) => (
                  <tr key={m.id} className="border-t border-white/5">
                    <td className="py-2 pr-3 text-white/60">{m.fecha}</td>
                    <td className="py-2 pr-3">
                      <span className={`text-[11px] font-bold ${m.tipo === "ingreso" ? "text-green-400" : "text-red-400"}`}>
                        {TIPO_LABEL[m.tipo]}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-white/60">
                      {m.categoria_id ? categoriasPorId[m.categoria_id]?.nombre || "—" : "—"}
                    </td>
                    <td className="py-2 pr-3 text-white/60">
                      {cuentasPorId[m.cuenta_origen_id || m.cuenta_destino_id || ""]?.nombre || "—"}
                    </td>
                    <td className="max-w-[200px] truncate py-2 pr-3 text-white/70">{m.descripcion || "—"}</td>
                    <td className={`py-2 text-right font-black ${m.tipo === "ingreso" ? "text-green-400" : "text-red-400"}`}>
                      {dinero(m.monto)}
                    </td>
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

// ═════════ TAB: Categorías ═════════

function TabCategorias({
  categorias,
  onCambio,
  mostrarAviso,
}: {
  categorias: Categoria[];
  onCambio: () => void;
  mostrarAviso: (m: string) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [ambito, setAmbito] = useState("sim");
  const [tipo, setTipo] = useState("gasto");
  const [guardando, setGuardando] = useState(false);
  const [fAmbito, setFAmbito] = useState("");
  const [fTipo, setFTipo] = useState("");

  async function crear() {
    if (!nombre.trim()) return;
    setGuardando(true);
    try {
      const r = await fetch("/api/admin/finanzas/categorias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombre.trim(), ambito, tipo }),
      });
      const d = await r.json();
      if (!r.ok) {
        alert(d.error || "Error creando categoría");
        return;
      }
      setNombre("");
      mostrarAviso("Categoría creada");
      onCambio();
    } finally {
      setGuardando(false);
    }
  }

  async function toggleActiva(c: Categoria) {
    const r = await fetch(`/api/admin/finanzas/categorias/${c.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activa: !c.activa }),
    });
    if (r.ok) onCambio();
  }

  const filtradas = categorias.filter(
    (c) => (!fAmbito || c.ambito === fAmbito) && (!fTipo || c.tipo === fTipo)
  );

  const sel =
    "rounded-xl border border-white/15 bg-black px-3 py-2 text-xs font-bold outline-none focus:border-red-500";

  return (
    <div className="space-y-4">
      {/* Alta */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="mb-3 text-sm font-black uppercase text-white/60">Nueva categoría</h3>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre"
            className={`${sel} flex-1 min-w-[180px] placeholder:text-white/25`}
          />
          <select value={ambito} onChange={(e) => setAmbito(e.target.value)} className={sel}>
            <option value="sim">SIM</option>
            <option value="personal">Personal</option>
            <option value="ambos">Ambos</option>
          </select>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={sel}>
            <option value="ingreso">Ingreso</option>
            <option value="costo">Costo</option>
            <option value="gasto">Gasto</option>
            <option value="inversion">Inversión</option>
            <option value="retiro">Retiro</option>
            <option value="ajuste">Ajuste</option>
          </select>
          <button
            onClick={crear}
            disabled={guardando || !nombre.trim()}
            className="rounded-xl bg-red-600 px-5 py-2 text-xs font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30"
          >
            Crear
          </button>
        </div>
      </div>

      {/* Filtros + listado */}
      <div className="rounded-2xl border border-white/10 bg-black p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          <select value={fAmbito} onChange={(e) => setFAmbito(e.target.value)} className={sel}>
            <option value="">Ámbito: todos</option>
            <option value="sim">SIM</option>
            <option value="personal">Personal</option>
            <option value="ambos">Ambos</option>
          </select>
          <select value={fTipo} onChange={(e) => setFTipo(e.target.value)} className={sel}>
            <option value="">Tipo: todos</option>
            <option value="ingreso">Ingreso</option>
            <option value="costo">Costo</option>
            <option value="gasto">Gasto</option>
            <option value="inversion">Inversión</option>
            <option value="retiro">Retiro</option>
            <option value="ajuste">Ajuste</option>
          </select>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {filtradas.map((c) => (
            <div
              key={c.id}
              className={`flex items-center justify-between rounded-xl border px-3 py-2 ${
                c.activa ? "border-white/10 bg-white/[0.03]" : "border-white/5 bg-black opacity-50"
              }`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{c.nombre}</p>
                <p className="text-[10px] uppercase text-white/35">
                  {c.ambito} · {CLASIF_LABEL[c.tipo] || c.tipo}
                </p>
              </div>
              <button
                onClick={() => toggleActiva(c)}
                className={`ml-2 shrink-0 rounded-lg border px-2.5 py-1 text-[10px] font-black uppercase transition ${
                  c.activa
                    ? "border-green-500/40 text-green-400 hover:bg-green-500/10"
                    : "border-white/15 text-white/40 hover:text-white"
                }`}
              >
                {c.activa ? "Activa" : "Inactiva"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═════════ TAB: Reglas ═════════

function TabReglas({
  reglas,
  categorias,
  onCambio,
  mostrarAviso,
}: {
  reglas: Regla[];
  categorias: Categoria[];
  onCambio: () => void;
  mostrarAviso: (m: string) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [ambito, setAmbito] = useState("");
  const [tipoSug, setTipoSug] = useState("egreso");
  const [clasifSug, setClasifSug] = useState("gasto");
  const [categoriaId, setCategoriaId] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function crear() {
    if (keyword.trim().length < 2) return;
    setGuardando(true);
    try {
      const r = await fetch("/api/admin/finanzas/reglas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: keyword.trim(),
          ambito: ambito || null,
          tipo_sugerido: tipoSug || null,
          clasificacion_sugerida: clasifSug || null,
          categoria_id: categoriaId || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        alert(d.error || "Error creando regla");
        return;
      }
      setKeyword("");
      mostrarAviso("Regla creada");
      onCambio();
    } finally {
      setGuardando(false);
    }
  }

  async function toggleActiva(regla: Regla) {
    const r = await fetch(`/api/admin/finanzas/reglas/${regla.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activa: !regla.activa }),
    });
    if (r.ok) onCambio();
  }

  async function eliminar(id: string) {
    if (!confirm("¿Eliminar esta regla?")) return;
    const r = await fetch(`/api/admin/finanzas/reglas/${id}`, { method: "DELETE" });
    if (r.ok) {
      mostrarAviso("Regla eliminada");
      onCambio();
    }
  }

  const sel =
    "rounded-xl border border-white/15 bg-black px-3 py-2 text-xs font-bold outline-none focus:border-red-500";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="mb-1 text-sm font-black uppercase text-white/60">Nueva regla</h3>
        <p className="mb-3 text-xs text-white/35">
          Si la descripción contiene la keyword, se sugiere tipo / clasificación / categoría automáticamente.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder='Keyword (ej: "fibra")'
            className={`${sel} min-w-[140px] placeholder:text-white/25`}
          />
          <select value={ambito} onChange={(e) => setAmbito(e.target.value)} className={sel}>
            <option value="">Cualquier ámbito</option>
            <option value="sim">SIM</option>
            <option value="personal">Personal</option>
          </select>
          <select value={tipoSug} onChange={(e) => setTipoSug(e.target.value)} className={sel}>
            <option value="ingreso">Ingreso</option>
            <option value="egreso">Egreso</option>
          </select>
          <select value={clasifSug} onChange={(e) => setClasifSug(e.target.value)} className={sel}>
            {Object.entries(CLASIF_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} className={sel}>
            <option value="">Sin categoría</option>
            {categorias.filter((c) => c.activa).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre} ({c.ambito})
              </option>
            ))}
          </select>
          <button
            onClick={crear}
            disabled={guardando || keyword.trim().length < 2}
            className="rounded-xl bg-red-600 px-5 py-2 text-xs font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30"
          >
            Crear
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black p-4">
        {reglas.length === 0 ? (
          <p className="text-sm text-white/40">Sin reglas cargadas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="text-left text-[10px] font-black uppercase tracking-[0.15em] text-white/35">
                  <th className="pb-2 pr-3">Keyword</th>
                  <th className="pb-2 pr-3">Ámbito</th>
                  <th className="pb-2 pr-3">Tipo</th>
                  <th className="pb-2 pr-3">Clasif.</th>
                  <th className="pb-2 pr-3">Categoría</th>
                  <th className="pb-2 pr-3">Prioridad</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {reglas.map((r) => (
                  <tr key={r.id} className={`border-t border-white/5 ${r.activa ? "" : "opacity-40"}`}>
                    <td className="py-2 pr-3 font-black">{r.keyword}</td>
                    <td className="py-2 pr-3 uppercase text-white/60">{r.ambito || "—"}</td>
                    <td className="py-2 pr-3 text-white/60">{r.tipo_sugerido || "—"}</td>
                    <td className="py-2 pr-3 text-white/60">
                      {r.clasificacion_sugerida ? CLASIF_LABEL[r.clasificacion_sugerida] : "—"}
                    </td>
                    <td className="py-2 pr-3 text-white/60">{r.categoria?.nombre || "—"}</td>
                    <td className="py-2 pr-3 text-white/60">{r.prioridad}</td>
                    <td className="py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => toggleActiva(r)}
                          className={`rounded-lg border px-2.5 py-1 text-[10px] font-black uppercase ${
                            r.activa
                              ? "border-green-500/40 text-green-400 hover:bg-green-500/10"
                              : "border-white/15 text-white/40 hover:text-white"
                          }`}
                        >
                          {r.activa ? "Activa" : "Inactiva"}
                        </button>
                        <button
                          onClick={() => eliminar(r.id)}
                          className="rounded-lg border border-white/15 px-2.5 py-1 text-[10px] font-black uppercase text-white/60 hover:border-red-500 hover:bg-red-600 hover:text-white"
                        >
                          ×
                        </button>
                      </div>
                    </td>
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

function SemaforoDot({ estado }: { estado: "verde" | "ambar" | "rojo" | null }) {
  if (!estado) return null;
  const cls =
    estado === "verde" ? "bg-green-500" : estado === "ambar" ? "bg-amber-500" : "bg-red-600";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${cls}`} />;
}

function CardMetrica({
  titulo,
  valor,
  formula,
  semaforo,
  comparacion,
}: {
  titulo: string;
  valor: string;
  formula: string;
  semaforo?: "verde" | "ambar" | "rojo" | null;
  comparacion?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black p-4" title={formula}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-[0.15em] text-white/40">{titulo}</p>
        {semaforo !== undefined && <SemaforoDot estado={semaforo} />}
      </div>
      <p className="mt-2 text-xl font-black md:text-2xl">{valor}</p>
      {comparacion && <p className="mt-1 text-xs text-white/40">{comparacion}</p>}
      <p className="mt-1 truncate text-[10px] text-white/25" title={formula}>
        {formula}
      </p>
    </div>
  );
}

function TabMetricas({ metricas }: { metricas: MetricasApi | null }) {
  if (!metricas) return <p className="text-white/60">Cargando métricas...</p>;

  const m = metricas.metricas;
  const ctx = metricas.contexto;
  const serie = metricas.serie;
  const maxIngreso = Math.max(...serie.map((s) => s.ingresos), 1);

  const semMargen = (v: number | null): "verde" | "ambar" | "rojo" | null =>
    v === null ? null : v >= 0.3 ? "verde" : v >= 0.1 ? "ambar" : "rojo";
  const semPositivo = (v: number | null): "verde" | "ambar" | "rojo" | null =>
    v === null ? null : v > 0 ? "verde" : v === 0 ? "ambar" : "rojo";

  return (
    <div className="space-y-6">
      {/* Evolución */}
      <div className="rounded-2xl border border-white/10 bg-black p-4">
        <h3 className="mb-4 text-sm font-black uppercase text-white/60">Evolución mensual (ingresos vs resultado)</h3>
        <div className="flex items-end gap-2 overflow-x-auto pb-2" style={{ minHeight: 140 }}>
          {serie.map((s) => (
            <div key={s.mes} className="flex min-w-[70px] flex-1 flex-col items-center gap-1">
              <span className="text-[10px] font-black text-white/60">{dinero(s.ingresos)}</span>
              <div className="flex h-24 w-full items-end justify-center gap-1">
                <div
                  className="w-1/3 rounded-t bg-red-600"
                  style={{ height: `${Math.max(3, (s.ingresos / maxIngreso) * 100)}%` }}
                  title={`Ingresos ${dinero(s.ingresos)}`}
                />
                <div
                  className={`w-1/3 rounded-t ${s.resultado_operativo >= 0 ? "bg-green-500" : "bg-amber-500"}`}
                  style={{
                    height: `${Math.max(3, (Math.abs(s.resultado_operativo) / maxIngreso) * 100)}%`,
                  }}
                  title={`Resultado ${dinero(s.resultado_operativo)}`}
                />
              </div>
              <span className="text-[10px] font-bold uppercase text-white/40">{labelMes(s.mes)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Rentabilidad */}
      <div>
        <h3 className="mb-3 text-sm font-black uppercase text-white/60">Rentabilidad</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <CardMetrica titulo="Revenue" valor={dinero(m.revenue as number)} formula="Ingresos totales del mes" />
          <CardMetrica titulo="Gross Profit" valor={dinero(m.gross_profit as number)} formula="Ingresos − costos directos"
            semaforo={semPositivo(m.gross_profit as number)} />
          <CardMetrica titulo="Gross Margin" valor={pct(m.gross_margin)} formula="Utilidad bruta / ingresos"
            semaforo={semMargen(m.gross_margin)} />
          <CardMetrica titulo="Operating Profit" valor={dinero(m.operating_profit as number)}
            formula="Ingresos − costos − gastos" semaforo={semPositivo(m.operating_profit as number)} />
          <CardMetrica titulo="Operating Margin" valor={pct(m.operating_margin)} formula="Resultado operativo / ingresos"
            semaforo={semMargen(m.operating_margin)} />
          <CardMetrica titulo="EBITDA aprox." valor={dinero(m.ebitda_aprox as number)}
            formula="Aproximación de gestión: ingresos − costos − gastos (sin inversiones, retiros ni ajustes)" />
          <CardMetrica titulo="Net Cash Flow" valor={dinero(m.net_cash_flow as number)}
            formula="Ingresos − (costos + gastos + inversiones + retiros)" semaforo={semPositivo(m.net_cash_flow as number)} />
          <CardMetrica titulo="MoM Growth" valor={pct(m.mom_growth)} formula="Ingresos vs mes anterior"
            semaforo={semPositivo(m.mom_growth)} />
        </div>
      </div>

      {/* Estructura */}
      <div>
        <h3 className="mb-3 text-sm font-black uppercase text-white/60">Estructura y equilibrio</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <CardMetrica titulo="Cost Ratio" valor={pct(m.cost_ratio)} formula="Costos directos / ingresos" />
          <CardMetrica titulo="Expense Ratio" valor={pct(m.expense_ratio)} formula="Gastos operativos / ingresos" />
          <CardMetrica titulo="Break-even" valor={dinero(m.break_even as number)}
            formula="Facturación necesaria para cubrir costos + gastos del mes" />
          <CardMetrica titulo="Retiros / Ingresos" valor={pct(m.retiros_ratio)} formula="Retiros personales / ingresos SIM" />
          <CardMetrica titulo="% Costos" valor={pct(m.estructura_costos?.costos)} formula="Costos / ingresos" />
          <CardMetrica titulo="% Gastos" valor={pct(m.estructura_costos?.gastos)} formula="Gastos / ingresos" />
          <CardMetrica titulo="% Inversiones" valor={pct(m.estructura_costos?.inversiones)} formula="Inversiones / ingresos" />
          <CardMetrica titulo="% Retiros" valor={pct(m.estructura_costos?.retiros)} formula="Retiros / ingresos" />
        </div>
      </div>

      {/* Operación del stand */}
      <div>
        <h3 className="mb-3 text-sm font-black uppercase text-white/60">Operación del stand</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <CardMetrica titulo="Turnos del mes" valor={String(ctx.turnos)} formula="Turnos vendidos (turnero del stand)" />
          <CardMetrica titulo="Revenue / Turno" valor={dinero(m.revenue_per_turn)} formula="Ingresos / turnos del mes" />
          <CardMetrica titulo="Costo / Turno" valor={dinero(m.cost_per_turn)} formula="Costos directos / turnos" />
          <CardMetrica titulo="Ganancia / Turno" valor={dinero(m.profit_per_turn)} formula="Resultado operativo / turnos"
            semaforo={semPositivo(m.profit_per_turn)} />
          <CardMetrica titulo="Ticket promedio" valor={dinero(m.average_ticket)} formula="Ingresos del stand / turnos" />
          <CardMetrica titulo="Ocupación" valor={pct(m.occupancy_rate)}
            formula={`Turnos / capacidad teórica (${ctx.capacidad_teorica} turnos)`}
            semaforo={m.occupancy_rate === null ? null : (m.occupancy_rate as number) >= 0.5 ? "verde" : (m.occupancy_rate as number) >= 0.25 ? "ambar" : "rojo"} />
          <CardMetrica titulo="Revenue / Simulador" valor={dinero(m.revenue_per_simulator)} formula="Ingresos / simuladores activos" />
          <CardMetrica titulo="Revenue / Hora sim." valor={dinero(m.revenue_per_simulator_hour)} formula="Ingresos / horas disponibles de simulador" />
        </div>
      </div>

      {/* Inversión y caja */}
      <div>
        <h3 className="mb-3 text-sm font-black uppercase text-white/60">Inversión y caja</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <CardMetrica titulo="ROI" valor={pct(m.roi)}
            formula={`ROI = resultado / inversión. Inversión acumulada: ${dinero(ctx.inversion_acumulada)}`} />
          <CardMetrica titulo="ROA" valor={pct(m.roa)}
            formula="Resultado operativo / activos estimados (config o inversión acumulada)" />
          <CardMetrica titulo="Payback" valor={m.payback_meses !== null ? `${m.payback_meses} meses` : "—"}
            formula="Inversión acumulada / flujo operativo promedio mensual" />
          <CardMetrica titulo="Cash Burn" valor={m.cash_burn !== null ? dinero(m.cash_burn as number) : "—"}
            formula="Egresos operativos cuando el resultado es negativo"
            semaforo={m.cash_burn !== null ? "rojo" : "verde"} />
          <CardMetrica titulo="Runway" valor={m.runway_meses !== null ? `${m.runway_meses} meses` : "—"}
            formula={`Caja disponible (${dinero(ctx.caja_disponible)}) / egresos promedio (${dinero(ctx.egresos_promedio)})`}
            semaforo={m.runway_meses === null ? null : (m.runway_meses as number) >= 6 ? "verde" : (m.runway_meses as number) >= 3 ? "ambar" : "rojo"} />
          <CardMetrica titulo="Inversión acumulada" valor={dinero(ctx.inversion_acumulada)}
            formula="Inversión inicial (config) + inversiones cargadas en Finanzas" />
          <CardMetrica titulo="Caja disponible" valor={dinero(ctx.caja_disponible)} formula="Suma de saldos teóricos de cuentas SIM" />
          <CardMetrica titulo="Inversiones del mes" valor={dinero(ctx.inversiones_mes)} formula="Egresos clasificados como inversión" />
        </div>
      </div>

      <p className="text-xs text-white/30">
        Las métricas son un tablero de gestión interna (aproximaciones útiles, no contabilidad formal).
        Pasá el mouse por cada card para ver la fórmula.
      </p>
    </div>
  );
}

// ═════════ TAB: Config ═════════

// ═════════ Inicializar saldos ═════════

function SeccionInicializar({
  cuentas,
  onHecho,
}: {
  cuentas: Cuenta[];
  onHecho: () => void;
}) {
  const [mes, setMes] = useState(mesActualLocal());
  const [saldos, setSaldos] = useState<Record<string, string>>({});
  const [observacion, setObservacion] = useState("");
  const [yaInicializado, setYaInicializado] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const cargarExistente = useCallback(async (m: string) => {
    setCargando(true);
    try {
      const r = await fetch(`/api/admin/finanzas/inicializar?mes=${m}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) return;
      setYaInicializado(Boolean(d.inicializado));
      const prev: Record<string, string> = {};
      for (const [id, v] of Object.entries(d.saldos || {})) prev[id] = String(v);
      setSaldos(prev);
      setObservacion(d.observacion || "");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargarExistente(mes);
  }, [mes, cargarExistente]);

  async function guardar(reemplazar = false) {
    const payload: Record<string, number> = {};
    for (const [id, v] of Object.entries(saldos)) {
      if (v !== "" && Number.isFinite(Number(v))) payload[id] = Number(v);
    }
    if (Object.keys(payload).length === 0) {
      alert("Cargá al menos un saldo.");
      return;
    }
    setGuardando(true);
    try {
      const r = await fetch("/api/admin/finanzas/inicializar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes, saldos: payload, observacion: observacion || null, reemplazar }),
      });
      const d = await r.json();
      if (r.status === 409 && d.requiere_reemplazo) {
        if (confirm(`Ya existe una inicialización para ${mes}. ¿Reemplazarla con estos valores?`)) {
          setGuardando(false);
          await guardar(true);
        }
        return;
      }
      if (!r.ok) {
        alert(d.error || "Error inicializando saldos");
        return;
      }
      setYaInicializado(true);
      onHecho();
    } finally {
      setGuardando(false);
    }
  }

  const grupos: Array<{ titulo: string; cuentas: Cuenta[] }> = [
    { titulo: "SIM", cuentas: cuentas.filter((c) => c.ambito === "sim") },
    { titulo: "Personal", cuentas: cuentas.filter((c) => c.ambito === "personal") },
  ];

  return (
    <div className="rounded-2xl border border-red-500/25 bg-red-950/10 p-4">
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-black uppercase text-red-500">Inicializar saldos</h3>
        {yaInicializado && (
          <span className="rounded-full border border-green-500/40 px-3 py-0.5 text-[10px] font-black uppercase text-green-400">
            Mes inicializado
          </span>
        )}
      </div>
      <p className="mb-4 text-xs text-white/40">
        Cargá la plata real con la que arranca cada cuenta. Se registra como “Ajuste inicial”:
        solo mueve saldos de caja, no cuenta como venta, costo ni gasto, y no afecta las métricas.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
            Mes inicial
          </label>
          <input
            type="month"
            value={mes}
            onChange={(e) => e.target.value && setMes(e.target.value)}
            className="rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
          />
        </div>
        {cargando && <p className="pb-2 text-xs text-white/40">Cargando...</p>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {grupos.map((g) => (
          <div key={g.titulo} className="rounded-xl border border-white/10 bg-black p-3">
            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
              {g.titulo}
            </p>
            <div className="space-y-2">
              {g.cuentas.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3">
                  <span className="text-sm font-bold text-white/70">{c.nombre}</span>
                  <input
                    type="number"
                    value={saldos[c.id] ?? ""}
                    onChange={(e) => setSaldos({ ...saldos, [c.id]: e.target.value })}
                    placeholder="$ 0"
                    className="w-36 rounded-lg border border-white/15 bg-black px-3 py-1.5 text-right text-sm font-bold outline-none placeholder:text-white/25 focus:border-red-500"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-end">
        <div className="flex-1">
          <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
            Observación
          </label>
          <input
            type="text"
            value={observacion}
            onChange={(e) => setObservacion(e.target.value)}
            placeholder="Ej: arranque del sistema, saldos contados el 1/7"
            className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/25 focus:border-red-500"
          />
        </div>
        <button
          onClick={() => guardar(false)}
          disabled={guardando}
          className="rounded-xl bg-red-600 px-6 py-2.5 text-xs font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30"
        >
          {guardando ? "Guardando..." : yaInicializado ? "Actualizar saldos" : "Inicializar saldos"}
        </button>
      </div>
    </div>
  );
}

const CONFIG_CAMPOS: Array<{ campo: string; label: string; ayuda: string }> = [
  { campo: "cantidad_simuladores", label: "Simuladores activos", ayuda: "Usado en ocupación y revenue por simulador" },
  { campo: "horas_operativas_dia", label: "Horas operativas por día", ayuda: "Capacidad horaria diaria del stand" },
  { campo: "duracion_turno_min", label: "Duración promedio de turno (min)", ayuda: "Para calcular slots por día" },
  { campo: "dias_operativos_mes", label: "Días operativos por mes", ayuda: "Días que abre el stand" },
  { campo: "valor_activos", label: "Valor estimado de activos ($)", ayuda: "Usado en ROA (si es 0 se usa inversión acumulada)" },
  { campo: "inversion_inicial", label: "Inversión inicial estimada ($)", ayuda: "Base del ROI y payback" },
  { campo: "meta_facturacion", label: "Meta de facturación mensual ($)", ayuda: "Objetivo de ingresos" },
  { campo: "meta_margen_operativo", label: "Meta de margen operativo (0-1)", ayuda: "Ej: 0.3 = 30%" },
  { campo: "meta_ocupacion", label: "Meta de ocupación (0-1)", ayuda: "Ej: 0.5 = 50%" },
];

function TabConfig({
  config,
  onGuardado,
}: {
  config: Configuracion | null;
  onGuardado: (c: Configuracion) => void;
}) {
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
      const r = await fetch("/api/admin/finanzas/configuracion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) {
        alert(d.error || "Error guardando configuración");
        return;
      }
      onGuardado(d.configuracion);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="mb-1 text-sm font-black uppercase text-white/60">Configuración financiera</h3>
      <p className="mb-4 text-xs text-white/35">
        Variables usadas por las métricas (ocupación, ROI, ROA, payback, break-even).
      </p>
      <div className="mb-4 max-w-xs">
        <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.15em] text-white/40">
          Mes inicial de Finanzas
        </label>
        <input
          type="month"
          value={mesInicio}
          onChange={(e) => e.target.value && setMesInicio(e.target.value)}
          className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
        />
        <p className="mt-1 text-[10px] text-white/30">
          Mes cero operativo. Los meses anteriores no muestran datos ni permiten cargar movimientos.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {CONFIG_CAMPOS.map(({ campo, label, ayuda }) => (
          <div key={campo}>
            <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.15em] text-white/40">
              {label}
            </label>
            <input
              type="number"
              min={0}
              step="any"
              value={valores[campo] ?? ""}
              onChange={(e) => setValores({ ...valores, [campo]: e.target.value })}
              className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
            />
            <p className="mt-1 text-[10px] text-white/30">{ayuda}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <button
          onClick={guardar}
          disabled={guardando}
          className="rounded-xl bg-red-600 px-6 py-2.5 text-xs font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30"
        >
          {guardando ? "Guardando..." : "Guardar configuración"}
        </button>
      </div>
    </div>
  );
}
