"use client";

import { useEffect, useMemo, useState } from "react";

type CodigoDescuento = {
  id: number;
  codigo: string;
  descripcion?: string | null;
  tipo_descuento: string;
  valor_descuento: number;
  usos_maximos?: number | null;
  usos_actuales: number;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  solo_dias_habiles?: boolean;
  dias_permitidos?: number[] | null;
  fechas_bloqueadas?: string[] | null;
  duraciones_permitidas?: number[] | null;
  activo: boolean;
  creado_para?: string | null;
  created_at: string;
};

function formatoTipo(tipo: string) {
  if (tipo === "porcentaje") return "Porcentaje";
  if (tipo === "monto_fijo") return "Monto fijo";
  if (tipo === "turno_gratis") return "Turno gratis";
  return tipo;
}

function formatoValor(codigo: CodigoDescuento) {
  if (codigo.tipo_descuento === "porcentaje") {
    return `${codigo.valor_descuento}%`;
  }

  return `$${Number(codigo.valor_descuento).toLocaleString("es-AR")}`;
}

const DIAS_SEMANA = [
  { n: 1, label: "Lun" },
  { n: 2, label: "Mar" },
  { n: 3, label: "Mié" },
  { n: 4, label: "Jue" },
  { n: 5, label: "Vie" },
  { n: 6, label: "Sáb" },
  { n: 0, label: "Dom" },
];

// Etiqueta corta de las restricciones de un código (para la tabla). null = sin restricción.
function restriccionCodigo(c: CodigoDescuento): string | null {
  const parts: string[] = [];
  const dias = Array.isArray(c.dias_permitidos) ? c.dias_permitidos : [];
  if (dias.length > 0) {
    parts.push(
      DIAS_SEMANA.filter((d) => dias.includes(d.n))
        .map((d) => d.label)
        .join(", ")
    );
  } else if (c.solo_dias_habiles) {
    parts.push("Lun a Vie");
  }
  const fb = Array.isArray(c.fechas_bloqueadas) ? c.fechas_bloqueadas : [];
  if (fb.length > 0) {
    parts.push(`${fb.length} fecha${fb.length > 1 ? "s" : ""} bloq.`);
  }
  const durs = Array.isArray(c.duraciones_permitidas) ? c.duraciones_permitidas : [];
  if (durs.length > 0) {
    const h15 = durs.includes(15);
    const h30 = durs.includes(30);
    parts.push(h15 && h30 ? "15/30 min" : h15 ? "15 min" : "30 min");
  }
  return parts.length ? parts.join(" · ") : null;
}

export default function AdminCodigosPage() {
  const [codigos, setCodigos] = useState<CodigoDescuento[]>([]);
  const [loading, setLoading] = useState(true);
  const [creando, setCreando] = useState(false);

  const [codigoManual, setCodigoManual] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [tipoDescuento, setTipoDescuento] = useState("porcentaje");
  const [valorDescuento, setValorDescuento] = useState("");
  const [usosMaximos, setUsosMaximos] = useState("1");
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [creadoPara, setCreadoPara] = useState("");
  const [diasPermitidos, setDiasPermitidos] = useState<number[]>([]);
  const [fechasBloqueadas, setFechasBloqueadas] = useState<string[]>([]);
  const [fechaBloqueadaInput, setFechaBloqueadaInput] = useState("");
  const [duracionesPermitidas, setDuracionesPermitidas] = useState<number[]>([]);

  async function cargarCodigos() {
    try {
      setLoading(true);

      const res = await fetch("/api/codigos-descuento", {
        cache: "no-store",
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Error cargando códigos");
        return;
      }

      setCodigos(data.codigos || []);
    } catch (error) {
      console.error(error);
      alert("Error cargando códigos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargarCodigos();
  }, []);

  const codigosActivos = useMemo(
    () => codigos.filter((codigo) => codigo.activo).length,
    [codigos]
  );

  async function crearCodigo(e: React.FormEvent) {
    e.preventDefault();

    if (!valorDescuento || Number(valorDescuento) <= 0) {
      alert("Ingresá un valor de descuento válido.");
      return;
    }

    setCreando(true);

    try {
      const res = await fetch("/api/codigos-descuento", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          codigo: codigoManual,
          descripcion,
          tipo_descuento: tipoDescuento,
          valor_descuento: Number(valorDescuento),
          usos_maximos: usosMaximos ? Number(usosMaximos) : null,
          fecha_inicio: fechaInicio || null,
          fecha_fin: fechaFin || null,
          creado_para: creadoPara,
          dias_permitidos: diasPermitidos.length ? diasPermitidos : null,
          fechas_bloqueadas: fechasBloqueadas.length ? fechasBloqueadas : null,
          duraciones_permitidas: duracionesPermitidas.length
            ? duracionesPermitidas
            : null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Error creando código");
        return;
      }

      setCodigoManual("");
      setDescripcion("");
      setTipoDescuento("porcentaje");
      setValorDescuento("");
      setUsosMaximos("1");
      setFechaInicio("");
      setFechaFin("");
      setCreadoPara("");
      setDiasPermitidos([]);
      setFechasBloqueadas([]);
      setFechaBloqueadaInput("");
      setDuracionesPermitidas([]);

      await cargarCodigos();
    } catch (error) {
      console.error(error);
      alert("Error creando código");
    } finally {
      setCreando(false);
    }
  }

  async function cambiarEstado(codigo: CodigoDescuento) {
    const res = await fetch(`/api/codigos-descuento/${codigo.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        activo: !codigo.activo,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || "Error actualizando código");
      return;
    }

    await cargarCodigos();
  }

  async function eliminarCodigo(codigo: CodigoDescuento) {
    const usado = Number(codigo.usos_actuales || 0) > 0;
    const aviso = codigo.activo
      ? `El código "${codigo.codigo}" está ACTIVO. ¿Seguro que querés eliminarlo de la lista?`
      : `¿Eliminar el código "${codigo.codigo}" de la lista?`;
    if (!confirm(usado ? `${aviso}\n\nSu historial de usos se conserva.` : aviso)) {
      return;
    }

    const res = await fetch(`/api/codigos-descuento/${codigo.id}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Error eliminando código");
      return;
    }

    // UI sin recargar: lo saco de la lista local.
    setCodigos((prev) => prev.filter((c) => c.id !== codigo.id));
  }

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white md:px-6">
      <section className="mx-auto max-w-7xl">
        <div className="mb-6">
          <p className="mb-2 text-xs uppercase tracking-[0.3em] text-red-500">
            Admin SIM
          </p>

          <h1 className="text-3xl font-black uppercase md:text-5xl">
            Códigos de descuento
          </h1>

          <p className="mt-2 max-w-2xl text-sm text-white/60">
            Generá códigos únicos para reservas online, empresas, sorteos,
            clientes especiales o campañas.
          </p>
        </div>

        <div className="mb-6 grid gap-3 md:grid-cols-3">
          <CardResumen titulo="Códigos creados" valor={codigos.length} />
          <CardResumen titulo="Activos" valor={codigosActivos} />
          <CardResumen
            titulo="Usos acumulados"
            valor={codigos.reduce(
              (acc, codigo) => acc + Number(codigo.usos_actuales || 0),
              0
            )}
          />
        </div>

        <form
          onSubmit={crearCodigo}
          className="mb-6 rounded-3xl border border-white/10 bg-white/[0.03] p-4"
        >
          <h2 className="mb-4 text-xl font-black uppercase text-red-500">
            Crear código
          </h2>

          <div className="grid gap-3 md:grid-cols-4">
            <Campo label="Código manual">
              <input
                value={codigoManual}
                onChange={(e) => setCodigoManual(e.target.value.toUpperCase())}
                placeholder="Vacío = automático"
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold uppercase outline-none placeholder:text-white/30 focus:border-red-500"
              />
            </Campo>

            <Campo label="Creado para">
              <input
                value={creadoPara}
                onChange={(e) => setCreadoPara(e.target.value)}
                placeholder="Empresa, cliente, sorteo..."
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-red-500"
              />
            </Campo>

            <Campo label="Tipo">
              <select
                value={tipoDescuento}
                onChange={(e) => setTipoDescuento(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              >
                <option value="porcentaje">Porcentaje</option>
                <option value="monto_fijo">Monto fijo</option>
                <option value="turno_gratis">Turno gratis</option>
              </select>
            </Campo>

            <Campo label="Valor">
              <input
                type="number"
                min={1}
                value={valorDescuento}
                onChange={(e) => setValorDescuento(e.target.value)}
                placeholder={tipoDescuento === "porcentaje" ? "20" : "12000"}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-red-500"
              />
            </Campo>

            <Campo label="Usos máximos">
              <input
                type="number"
                min={1}
                value={usosMaximos}
                onChange={(e) => setUsosMaximos(e.target.value)}
                placeholder="1"
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-red-500"
              />
            </Campo>

            <Campo label="Fecha inicio">
              <input
                type="date"
                value={fechaInicio}
                onChange={(e) => setFechaInicio(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              />
            </Campo>

            <Campo label="Fecha fin">
              <input
                type="date"
                value={fechaFin}
                onChange={(e) => setFechaFin(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              />
            </Campo>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={creando}
                className="w-full rounded-xl bg-red-600 px-4 py-2 text-sm font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30"
              >
                {creando ? "Creando..." : "Crear código"}
              </button>
            </div>

            <div className="md:col-span-4">
              <Campo label="Descripción">
                <input
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  placeholder="Ej: Código para campaña con empresa, sorteo, premio..."
                  className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-red-500"
                />
              </Campo>
            </div>

            <div className="md:col-span-4">
              <p className="mb-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
                Días permitidos{" "}
                <span className="text-white/25">(vacío = cualquier día)</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {DIAS_SEMANA.map((d) => {
                  const active = diasPermitidos.includes(d.n);
                  return (
                    <button
                      key={d.n}
                      type="button"
                      onClick={() =>
                        setDiasPermitidos((prev) =>
                          prev.includes(d.n)
                            ? prev.filter((x) => x !== d.n)
                            : [...prev, d.n]
                        )
                      }
                      className={`rounded-xl border px-3 py-2 text-xs font-black uppercase transition ${
                        active
                          ? "border-red-500 bg-red-600 text-white"
                          : "border-white/15 bg-black text-white/50 hover:border-white/30"
                      }`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="md:col-span-4">
              <p className="mb-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
                Fechas bloqueadas{" "}
                <span className="text-white/25">
                  (el código NO se puede usar esas fechas)
                </span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={fechaBloqueadaInput}
                  onChange={(e) => setFechaBloqueadaInput(e.target.value)}
                  className="rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    const f = fechaBloqueadaInput;
                    if (f && !fechasBloqueadas.includes(f)) {
                      setFechasBloqueadas((prev) => [...prev, f].sort());
                    }
                    setFechaBloqueadaInput("");
                  }}
                  className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-black uppercase text-white/70 transition hover:border-white/30"
                >
                  Agregar
                </button>
                {fechasBloqueadas.map((f) => (
                  <span
                    key={f}
                    className="inline-flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs font-bold text-amber-300"
                  >
                    {f}
                    <button
                      type="button"
                      onClick={() =>
                        setFechasBloqueadas((prev) =>
                          prev.filter((x) => x !== f)
                        )
                      }
                      className="text-amber-400/70 hover:text-white"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div className="md:col-span-4">
              <p className="mb-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
                Duraciones permitidas{" "}
                <span className="text-white/25">(vacío = todas)</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {[15, 30].map((d) => {
                  const active = duracionesPermitidas.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() =>
                        setDuracionesPermitidas((prev) =>
                          prev.includes(d)
                            ? prev.filter((x) => x !== d)
                            : [...prev, d]
                        )
                      }
                      className={`rounded-xl border px-3 py-2 text-xs font-black uppercase transition ${
                        active
                          ? "border-red-500 bg-red-600 text-white"
                          : "border-white/15 bg-black text-white/50 hover:border-white/30"
                      }`}
                    >
                      {d} min
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </form>

        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="mb-4 text-xl font-black uppercase text-red-500">
            Códigos creados
          </h2>

          {loading ? (
            <p className="text-white/60">Cargando códigos...</p>
          ) : codigos.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black p-5">
              <p className="text-white/60">Todavía no hay códigos creados.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[1200px] space-y-2">
                <div className="grid grid-cols-[1.1fr_1.2fr_1fr_90px_90px_95px_95px_110px_96px] gap-2 px-3 text-xs font-black uppercase tracking-[0.15em] text-white/35">
                  <span>Código</span>
                  <span>Para</span>
                  <span>Tipo</span>
                  <span>Valor</span>
                  <span>Usos</span>
                  <span>Inicio</span>
                  <span>Fin</span>
                  <span>Estado</span>
                  <span>Eliminar</span>
                </div>

                {codigos.map((codigo) => (
                  <div
                    key={codigo.id}
                    className={`grid grid-cols-[1.1fr_1.2fr_1fr_90px_90px_95px_95px_110px_96px] items-center gap-2 rounded-xl border px-3 py-3 text-sm ${
                      codigo.activo
                        ? "border-white/10 bg-black"
                        : "border-white/5 bg-white/[0.02] opacity-50"
                    }`}
                  >
                    <div>
                      <p className="font-black text-red-500">{codigo.codigo}</p>
                      <p className="truncate text-xs text-white/40">
                        {codigo.descripcion || "Sin descripción"}
                      </p>
                      {restriccionCodigo(codigo) && (
                        <span className="mt-1 inline-block rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-400">
                          {restriccionCodigo(codigo)}
                        </span>
                      )}
                    </div>

                    <span className="truncate text-white/70">
                      {codigo.creado_para || "-"}
                    </span>

                    <span>{formatoTipo(codigo.tipo_descuento)}</span>

                    <span className="font-black">{formatoValor(codigo)}</span>

                    <span>
                      {codigo.usos_actuales || 0}
                      {codigo.usos_maximos ? `/${codigo.usos_maximos}` : ""}
                    </span>

                    <span>{codigo.fecha_inicio || "-"}</span>
                    <span>{codigo.fecha_fin || "-"}</span>

                    <button
                      type="button"
                      onClick={() => cambiarEstado(codigo)}
                      className={`rounded-xl px-3 py-2 text-xs font-black uppercase transition ${
                        codigo.activo
                          ? "bg-green-600 text-white hover:bg-green-700"
                          : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                      }`}
                    >
                      {codigo.activo ? "Activo" : "Inactivo"}
                    </button>

                    <button
                      type="button"
                      onClick={() => eliminarCodigo(codigo)}
                      className="rounded-xl border border-red-500/40 px-3 py-2 text-xs font-black uppercase text-red-400 transition hover:bg-red-600 hover:text-white"
                    >
                      Eliminar
                    </button>
                  </div>
                ))}
              </div>
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

function CardResumen({ titulo, valor }: { titulo: string; valor: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-white/40">
        {titulo}
      </p>
      <p className="mt-2 text-3xl font-black text-white">{valor}</p>
    </div>
  );
}