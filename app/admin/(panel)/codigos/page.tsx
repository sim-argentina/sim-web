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
  const [soloDiasHabiles, setSoloDiasHabiles] = useState(false);

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
          solo_dias_habiles: soloDiasHabiles,
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
      setSoloDiasHabiles(false);

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
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/15 bg-black px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={soloDiasHabiles}
                  onChange={(e) => setSoloDiasHabiles(e.target.checked)}
                  className="h-4 w-4 accent-red-600"
                />
                <span className="text-sm font-bold">
                  Solo válido para reservas de lunes a viernes
                </span>
              </label>
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
                      {codigo.solo_dias_habiles && (
                        <span className="mt-1 inline-block rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-400">
                          Solo Lun–Vie
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