"use client";

import { useEffect, useState } from "react";
import { estadoBloqueoEfectivo, type EstadoBloqueo } from "@/lib/bloqueosEstado";
import { esFinDeSemana } from "@/lib/agenda";

type Bloqueo = {
  id: number;
  fecha: string;
  todo_el_dia: boolean;
  hora_inicio: string | null;
  hora_fin: string | null;
  simulador: string | null;
  motivo: string | null;
  activo: boolean;
  created_at: string;
};

// (B4) Qué duraciones se editan, sus precios normales y las columnas de cada
// una las decide el servidor con la modalidad VIGENTE (catálogo central). La
// página no tiene duraciones ni precios propios.
type CampoPrecio = { duracion: number; columna: string };

type PrecioEspecial = { id: string; fecha: string } & Record<string, string | number | null>;

type VistaPrecios = {
  modalidad: string;
  duraciones: number[];
  campos: CampoPrecio[];
  /** Columnas guardadas que la modalidad vigente no usa: se muestran, no se editan. */
  otros: CampoPrecio[];
  precios_base: { semana: Record<string, number>; fin_de_semana: Record<string, number> };
  precios: PrecioEspecial[];
};

const SIMULADORES = ["Ferrari", "McLaren", "Red Bull", "Alpine"];

const fmtMoney = (n: number | null) => (n == null ? "—" : `$${n.toLocaleString("es-AR")}`);

function esVistaPrecios(x: unknown): x is VistaPrecios {
  const v = x as VistaPrecios | null;
  return (
    !!v &&
    typeof v.modalidad === "string" &&
    Array.isArray(v.duraciones) &&
    Array.isArray(v.campos) &&
    Array.isArray(v.otros) &&
    !!v.precios_base?.semana &&
    !!v.precios_base?.fin_de_semana &&
    Array.isArray(v.precios)
  );
}

// "15 y 30", "10, 20 o 30".
const listaDuraciones = (ds: number[], conjuncion: "y" | "o") =>
  ds.length <= 1 ? ds.join("") : `${ds.slice(0, -1).join(", ")} ${conjuncion} ${ds[ds.length - 1]}`;

const precioDe = (fila: PrecioEspecial, columna: string): number | null => {
  const v = fila[columna];
  return typeof v === "number" ? v : null;
};

// Lo guardado para una fecha en las columnas que se editan ("" = precio normal).
function valoresDe(vista: VistaPrecios, fecha: string): Record<string, string> {
  const fila = vista.precios.find((p) => p.fecha === fecha);
  const out: Record<string, string> = {};
  for (const c of vista.campos) {
    const v = fila ? precioDe(fila, c.columna) : null;
    out[c.columna] = v == null ? "" : String(v);
  }
  return out;
}

// Precio normal de una duración: el del tipo de día de la fecha elegida, o los
// dos si todavía no hay fecha y difieren.
function precioNormal(vista: VistaPrecios, duracion: number, fecha: string) {
  const semana = vista.precios_base.semana[String(duracion)] ?? null;
  const finde = vista.precios_base.fin_de_semana[String(duracion)] ?? null;
  if (fecha) return fmtMoney(esFinDeSemana(fecha) ? finde : semana);
  return semana === finde ? fmtMoney(semana) : `${fmtMoney(semana)} lun a vie · ${fmtMoney(finde)} sáb y dom`;
}
// "Hoy" en Argentina (YYYY-MM-DD).
const hoyAR = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());

const ESTADO_CHIP: Record<EstadoBloqueo, string> = {
  activo: "bg-green-600 text-white",
  programado: "bg-blue-600 text-white",
  inactivo: "bg-zinc-800 text-zinc-400",
};
const ESTADO_LABEL: Record<EstadoBloqueo, string> = { activo: "Activo", programado: "Programado", inactivo: "Inactivo" };

export default function AdminBloqueosPage() {
  const [bloqueos, setBloqueos] = useState<Bloqueo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creando, setCreando] = useState(false);

  const [fecha, setFecha] = useState("");
  const [todoElDia, setTodoElDia] = useState(true);
  const [horaInicio, setHoraInicio] = useState("");
  const [horaFin, setHoraFin] = useState("");
  const [simulador, setSimulador] = useState(""); // "" = todos
  const [motivo, setMotivo] = useState("");

  // Precios especiales (independientes de los bloqueos).
  const [vistaPrecios, setVistaPrecios] = useState<VistaPrecios | null>(null);
  const [errorPrecios, setErrorPrecios] = useState<string | null>(null);
  const [pFecha, setPFecha] = useState("");
  // Valor escrito por columna editable ("" = precio normal).
  const [pValores, setPValores] = useState<Record<string, string>>({});
  const [guardandoPrecio, setGuardandoPrecio] = useState(false);

  async function cargarBloqueos() {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/bloqueos", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Error cargando bloqueos");
        return;
      }
      setBloqueos(data.bloqueos || []);
    } catch {
      alert("Error cargando bloqueos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargarBloqueos();
    cargarPrecios();
  }, []);

  async function cargarPrecios(): Promise<VistaPrecios | null> {
    try {
      const res = await fetch("/api/admin/bloqueos/precios", { cache: "no-store" });
      const data = await res.json();
      if (res.ok && esVistaPrecios(data)) {
        setVistaPrecios(data);
        setErrorPrecios(null);
        return data;
      }
      setErrorPrecios(data?.error || "No se pudieron cargar los precios especiales.");
    } catch {
      setErrorPrecios("No se pudieron cargar los precios especiales.");
    }
    return null;
  }

  // Si la fecha elegida ya tiene precios, el formulario arranca con ellos:
  // guardar un campo vacío vuelve al precio normal, y no se borra sin verlo.
  function cambiarFechaPrecio(fecha: string) {
    setPFecha(fecha);
    if (vistaPrecios?.precios.some((p) => p.fecha === fecha)) setPValores(valoresDe(vistaPrecios, fecha));
  }

  async function guardarPrecio(e: React.FormEvent) {
    e.preventDefault();
    if (!vistaPrecios) return;
    const vista = vistaPrecios;
    if (!pFecha) { alert("Elegí una fecha."); return; }
    const filaActual = vista.precios.find((p) => p.fecha === pFecha);
    const conservaOtros = !!filaActual && vista.otros.some((c) => precioDe(filaActual, c.columna) != null);
    if (vista.campos.every((c) => !(pValores[c.columna] ?? "").trim()) && !conservaOtros) {
      alert(filaActual
        ? "Para quitar todos los precios de esa fecha usá Eliminar."
        : `Cargá al menos un precio (${listaDuraciones(vista.duraciones, "o")} min).`);
      return;
    }
    setGuardandoPrecio(true);
    try {
      // Solo las columnas del catálogo con el que se armó el formulario (vacío =
      // precio normal). Las de otra modalidad no se mandan: el servidor las conserva.
      const body: Record<string, unknown> = { fecha: pFecha, modalidad_vista: vista.modalidad };
      for (const c of vista.campos) {
        const v = (pValores[c.columna] ?? "").trim();
        body[c.columna] = v === "" ? null : v;
      }
      const res = await fetch("/api/admin/bloqueos/precios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data?.codigo === "catalogo_actualizado") {
        // Cambió la modalidad comercial: no se escribió nada. Se recargan el
        // catálogo vigente y lo guardado para esa fecha.
        alert(data.error);
        const nueva = await cargarPrecios();
        setPValores(nueva ? valoresDe(nueva, pFecha) : {});
        return;
      }
      if (!res.ok) { alert(data.error || "Error guardando el precio especial"); return; }
      setPFecha(""); setPValores({});
      await cargarPrecios();
    } catch {
      alert("Error guardando el precio especial");
    } finally {
      setGuardandoPrecio(false);
    }
  }

  function editarPrecio(p: PrecioEspecial) {
    if (!vistaPrecios) return;
    setPFecha(p.fecha);
    setPValores(valoresDe(vistaPrecios, p.fecha));
  }

  async function eliminarPrecio(p: PrecioEspecial) {
    const otros = vistaPrecios?.otros.filter((c) => precioDe(p, c.columna) != null) ?? [];
    const tambien = otros.length > 0
      ? `\n\nTambién se borran los de ${listaDuraciones(otros.map((c) => c.duracion), "y")} min, que hoy no se usan.`
      : "";
    if (!confirm(`¿Eliminar el precio especial del ${p.fecha}?${tambien}\n\nLas nuevas reservas usarán el precio normal. No cambia reservas ya pagadas.`)) return;
    const res = await fetch(`/api/admin/bloqueos/precios/${p.id}`, { method: "DELETE" });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || "Error eliminando el precio"); return; }
    setVistaPrecios((v) => (v ? { ...v, precios: v.precios.filter((x) => x.id !== p.id) } : v));
  }

  async function crearBloqueo(e: React.FormEvent) {
    e.preventDefault();
    if (!fecha) {
      alert("Elegí una fecha.");
      return;
    }
    if (!todoElDia && (!horaInicio || !horaFin)) {
      alert("Indicá hora de inicio y fin, o marcá todo el día.");
      return;
    }

    setCreando(true);
    try {
      const res = await fetch("/api/admin/bloqueos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha,
          todo_el_dia: todoElDia,
          hora_inicio: todoElDia ? null : horaInicio,
          hora_fin: todoElDia ? null : horaFin,
          simulador: simulador || null,
          motivo: motivo || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Error creando bloqueo");
        return;
      }
      if (Number(data.reservas_afectadas) > 0) {
        alert(
          `Bloqueo creado.\n\n⚠ Atención: hay ${data.reservas_afectadas} reserva(s) activa(s) que caen dentro de este bloqueo. No se eliminaron — gestionalas manualmente si corresponde.`
        );
      }
      setFecha("");
      setTodoElDia(true);
      setHoraInicio("");
      setHoraFin("");
      setSimulador("");
      setMotivo("");
      await cargarBloqueos();
    } catch {
      alert("Error creando bloqueo");
    } finally {
      setCreando(false);
    }
  }

  async function cambiarEstado(b: Bloqueo) {
    const res = await fetch(`/api/admin/bloqueos/${b.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !b.activo }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Error actualizando bloqueo");
      return;
    }
    await cargarBloqueos();
  }

  async function eliminarBloqueo(b: Bloqueo) {
    if (
      !confirm(
        `¿Eliminar el bloqueo del ${b.fecha}?\n\nNo se borran reservas existentes, solo la regla de bloqueo.`
      )
    ) {
      return;
    }
    const res = await fetch(`/api/admin/bloqueos/${b.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Error eliminando bloqueo");
      return;
    }
    setBloqueos((prev) => prev.filter((x) => x.id !== b.id));
  }

  function rango(b: Bloqueo) {
    if (b.todo_el_dia) return "Todo el día";
    return `${b.hora_inicio ?? "?"} – ${b.hora_fin ?? "?"}`;
  }

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white md:px-6">
      <section className="mx-auto max-w-5xl">
        <div className="mb-6">
          <p className="mb-2 text-xs uppercase tracking-[0.3em] text-red-500">
            Admin SIM
          </p>
          <h1 className="text-3xl font-black uppercase md:text-5xl">
            Bloqueos de reservas
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-white/60">
            Cerrá la reserva online por fecha, rango horario y/o simulador
            (mantenimiento, eventos privados, feriados). No afecta reservas ya
            confirmadas.
          </p>
        </div>

        <form
          onSubmit={crearBloqueo}
          className="mb-6 rounded-3xl border border-white/10 bg-white/[0.03] p-4"
        >
          <h2 className="mb-4 text-xl font-black uppercase text-red-500">
            Crear bloqueo
          </h2>

          <div className="grid gap-3 md:grid-cols-3">
            <Campo label="Fecha">
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              />
            </Campo>

            <Campo label="Simulador">
              <select
                value={simulador}
                onChange={(e) => setSimulador(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              >
                <option value="">Todos</option>
                {SIMULADORES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo label="Motivo (opcional)">
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Mantenimiento, evento privado..."
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-red-500"
              />
            </Campo>

            <div className="md:col-span-3">
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/15 bg-black px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={todoElDia}
                  onChange={(e) => setTodoElDia(e.target.checked)}
                  className="h-4 w-4 accent-red-600"
                />
                <span className="text-sm font-bold">Bloquear todo el día</span>
              </label>
            </div>

            {!todoElDia && (
              <>
                <Campo label="Hora inicio">
                  <input
                    type="time"
                    value={horaInicio}
                    onChange={(e) => setHoraInicio(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
                  />
                </Campo>
                <Campo label="Hora fin">
                  <input
                    type="time"
                    value={horaFin}
                    onChange={(e) => setHoraFin(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
                  />
                </Campo>
              </>
            )}

            <div className="flex items-end">
              <button
                type="submit"
                disabled={creando}
                className="w-full rounded-xl bg-red-600 px-4 py-2 text-sm font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30"
              >
                {creando ? "Creando..." : "Crear bloqueo"}
              </button>
            </div>
          </div>
        </form>

        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="mb-4 text-xl font-black uppercase text-red-500">
            Bloqueos creados
          </h2>

          {loading ? (
            <p className="text-white/60">Cargando bloqueos...</p>
          ) : bloqueos.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black p-5">
              <p className="text-white/60">Todavía no hay bloqueos creados.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {bloqueos.map((b) => {
                const est = estadoBloqueoEfectivo(b);
                return (
                <div
                  key={b.id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
                    est === "inactivo"
                      ? "border-white/5 bg-white/[0.02] opacity-50"
                      : "border-white/10 bg-black"
                  }`}
                >
                  <div className="min-w-[180px]">
                    <p className="font-black text-red-500">{b.fecha}</p>
                    <p className="text-xs text-white/50">
                      {rango(b)} · {b.simulador || "Todos los simuladores"}
                    </p>
                    {b.motivo && (
                      <p className="mt-0.5 text-xs text-white/40">{b.motivo}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`rounded-xl px-3 py-2 text-xs font-black uppercase ${ESTADO_CHIP[est]}`} title="Estado efectivo según fecha/hora">
                      {ESTADO_LABEL[est]}
                    </span>
                    <button
                      type="button"
                      onClick={() => cambiarEstado(b)}
                      title={b.activo ? "Desactivar manualmente" : "Reactivar"}
                      className="rounded-xl border border-white/15 px-3 py-2 text-xs font-black uppercase text-white/70 transition hover:bg-white/10"
                    >
                      {b.activo ? "Desactivar" : "Activar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => eliminarBloqueo(b)}
                      className="rounded-xl border border-red-500/40 px-3 py-2 text-xs font-black uppercase text-red-400 transition hover:bg-red-600 hover:text-white"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── PRECIOS ESPECIALES (independientes de los bloqueos) ── */}
        <form onSubmit={guardarPrecio} className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="mb-1 text-xl font-black uppercase text-red-500">Precios especiales</h2>
          <p className="mb-4 text-xs text-white/50">
            Precio excepcional de reserva online para una fecha concreta. Dejá un campo vacío para usar el precio normal. No bloquea horarios ni cambia la disponibilidad.
            {vistaPrecios && <> Duraciones vigentes: {listaDuraciones(vistaPrecios.duraciones, "y")} min.</>}
          </p>
          {!vistaPrecios ? (
            <p className="text-sm text-white/60">{errorPrecios ?? "Cargando precios especiales..."}</p>
          ) : (
            <div className={vistaPrecios.campos.length >= 3 ? "grid gap-3 md:grid-cols-5" : "grid gap-3 md:grid-cols-4"}>
              <Campo label="Fecha">
                <input type="date" value={pFecha} onChange={(e) => cambiarFechaPrecio(e.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500" />
              </Campo>
              {vistaPrecios.campos.map((c) => (
                <Campo key={c.columna} label={`Precio ${c.duracion} min`}>
                  <input type="number" min={0} step={1} value={pValores[c.columna] ?? ""}
                    onChange={(e) => setPValores((prev) => ({ ...prev, [c.columna]: e.target.value }))} placeholder="Normal"
                    className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-red-500" />
                  <p className="mt-1 text-[11px] text-white/40">Normal: {precioNormal(vistaPrecios, c.duracion, pFecha)}</p>
                </Campo>
              ))}
              <div className="flex items-end md:pb-5">
                <button type="submit" disabled={guardandoPrecio}
                  className="w-full rounded-xl bg-red-600 px-4 py-2 text-sm font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30">
                  {guardandoPrecio ? "Guardando..." : "Guardar precio"}
                </button>
              </div>
            </div>
          )}
        </form>

        <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="mb-4 text-xl font-black uppercase text-red-500">Precios especiales creados</h2>
          {!vistaPrecios || vistaPrecios.precios.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black p-5">
              <p className="text-white/60">Todavía no hay precios especiales.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {vistaPrecios.precios.map((p) => {
                const activo = p.fecha >= hoyAR();
                // Guardado para otra modalidad: se conserva y se muestra, no se edita.
                const otros = vistaPrecios.otros.filter((c) => precioDe(p, c.columna) != null);
                return (
                  <div key={p.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${activo ? "border-white/10 bg-black" : "border-white/5 bg-white/[0.02] opacity-50"}`}>
                    <div className="min-w-[220px]">
                      <p className="font-black text-red-500">{p.fecha}</p>
                      <p className="text-xs text-white/60">
                        {vistaPrecios.campos.map((c, i) => (
                          <span key={c.columna}>{i > 0 && " · "}{c.duracion} min: <b className="text-white">{fmtMoney(precioDe(p, c.columna))}</b></span>
                        ))}
                      </p>
                      {otros.length > 0 && (
                        <p className="mt-0.5 text-[11px] text-white/40">
                          Sin uso en la modalidad vigente (se conserva): {otros.map((c) => `${c.duracion} min ${fmtMoney(precioDe(p, c.columna))}`).join(" · ")}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-xl px-3 py-2 text-xs font-black uppercase ${activo ? "bg-green-600 text-white" : "bg-zinc-800 text-zinc-400"}`}>
                        {activo ? "Activo" : "Inactivo"}
                      </span>
                      <button type="button" onClick={() => editarPrecio(p)}
                        className="rounded-xl border border-white/15 px-3 py-2 text-xs font-black uppercase text-white/70 transition hover:bg-white/10">Editar</button>
                      <button type="button" onClick={() => eliminarPrecio(p)}
                        className="rounded-xl border border-red-500/40 px-3 py-2 text-xs font-black uppercase text-red-400 transition hover:bg-red-600 hover:text-white">Eliminar</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function Campo({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
        {label}
      </label>
      {children}
    </div>
  );
}
