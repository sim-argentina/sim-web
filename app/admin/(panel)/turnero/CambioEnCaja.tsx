"use client";

import { useEffect, useState } from "react";

// Cambio que queda en la caja al cierre del día: una nota operativa para quien
// abre al día siguiente. No es un arqueo ni entra en Finanzas, el resumen del
// día ni las métricas. La fecha, el registro y el cierre anterior los resuelve
// el servidor (/api/turnos-stand/cambio): el navegador no decide qué día cierra.

type Vista = {
  hoy: string;
  fecha: string;
  registro: { fecha: string; monto: number; actualizado_por: string; updated_at: string } | null;
  anterior: { fecha: string; monto: number } | null;
  puede_elegir_fecha: boolean;
};

const API = "/api/turnos-stand/cambio";

const pesos = (n: number) => `$${n.toLocaleString("es-AR")}`;
const diaMesAnio = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
const horaArgentina = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Cordoba", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
};
/** Lo que se escribe, mostrado con separador de miles. Solo dígitos. */
const conMiles = (texto: string) => {
  const digitos = texto.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 8);
  return digitos === "" ? "" : Number(digitos).toLocaleString("es-AR");
};
const montoDe = (v: Vista) => (v.registro ? conMiles(String(v.registro.monto)) : "");

export default function CambioEnCaja() {
  const [vista, setVista] = useState<Vista | null>(null);
  const [fechaPedida, setFechaPedida] = useState<string | null>(null);
  const [monto, setMonto] = useState("");
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    let vigente = true;
    fetch(fechaPedida ? `${API}?fecha=${fechaPedida}` : API, { cache: "no-store" })
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as (Vista & { error?: string }) | null;
        if (!vigente) return;
        if (!r.ok || !d) {
          setError(d?.error || "No se pudo cargar el cambio en caja.");
          return;
        }
        setVista(d);
        setMonto(montoDe(d));
      })
      .catch(() => {
        if (vigente) setError("No se pudo cargar el cambio en caja.");
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [fechaPedida]);

  /** Solo admin: ver o corregir otro día (el servidor lo vuelve a validar). */
  function elegirDia(valor: string) {
    if (!valor || !vista) return;
    const nueva = valor === vista.hoy ? null : valor;
    if (nueva === fechaPedida) return;
    setCargando(true);
    setError("");
    setAviso("");
    setFechaPedida(nueva);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!vista || monto === "" || guardando) return;
    setGuardando(true);
    setError("");
    setAviso("");
    try {
      const cuerpo: { monto: number; fecha?: string } = { monto: Number(monto.replace(/\D/g, "")) };
      if (vista.fecha !== vista.hoy) cuerpo.fecha = vista.fecha;
      const r = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const d = (await r.json().catch(() => null)) as (Vista & { error?: string }) | null;
      if (!r.ok || !d) {
        setError(d?.error || "No se pudo guardar. Probá de nuevo.");
        return;
      }
      setVista(d);
      setMonto(montoDe(d));
      setAviso("Guardado.");
    } catch {
      setError("No se pudo guardar. Probá de nuevo.");
    } finally {
      setGuardando(false);
    }
  }

  const esHoy = !!vista && vista.fecha === vista.hoy;

  return (
    <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-black uppercase text-red-500">Cambio en caja</h2>
          <p className="text-sm text-white/50">
            Efectivo que queda en la caja como cambio para quien abre al día siguiente.
          </p>
        </div>

        {vista?.puede_elegir_fecha && (
          <label className="block">
            <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Día</span>
            <input
              type="date"
              value={vista.fecha}
              max={vista.hoy}
              onChange={(e) => elegirDia(e.target.value)}
              className="rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
            />
          </label>
        )}
      </div>

      {!vista ? (
        <p className={`text-sm ${cargando ? "text-white/45" : "text-red-400"}`}>
          {cargando ? "Cargando…" : error || "No se pudo cargar el cambio en caja."}
        </p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-black p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">Cambio del cierre anterior</p>
              {vista.anterior ? (
                <>
                  <p className="mt-2 text-2xl font-black">{pesos(vista.anterior.monto)}</p>
                  <p className="text-xs text-white/40">{diaMesAnio(vista.anterior.fecha)}</p>
                </>
              ) : (
                <p className="mt-2 text-sm text-white/60">Sin cambio anterior registrado.</p>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-black p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">
                {esHoy ? "Cambio registrado hoy" : `Cambio registrado el ${diaMesAnio(vista.fecha)}`}
              </p>
              {vista.registro ? (
                <>
                  <p className="mt-2 text-2xl font-black">{pesos(vista.registro.monto)}</p>
                  <p className="text-xs text-white/40">
                    Guardado por {vista.registro.actualizado_por}
                    {horaArgentina(vista.registro.updated_at) && ` · ${horaArgentina(vista.registro.updated_at)}`}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-white/60">{esHoy ? "Todavía no se registró." : "Sin registro ese día."}</p>
              )}
            </div>
          </div>

          <form onSubmit={guardar} className="mt-3 flex flex-col gap-3 md:flex-row md:items-end">
            <label className="block flex-1">
              <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
                {esHoy ? "Cambio que queda en caja" : `Cambio que quedó en caja el ${diaMesAnio(vista.fecha)}`}
              </span>
              <span className="flex items-center rounded-xl border border-white/15 bg-black px-3 focus-within:border-red-500">
                <span className="text-sm font-bold text-white/50">$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={monto}
                  onChange={(e) => {
                    setMonto(conMiles(e.target.value));
                    setAviso("");
                  }}
                  placeholder="0"
                  className="w-full bg-transparent px-2 py-2 text-sm font-bold outline-none"
                />
              </span>
            </label>
            <button
              type="submit"
              disabled={guardando || monto === ""}
              className="rounded-xl bg-red-600 px-6 py-2 text-sm font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30"
            >
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </form>

          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
          {aviso && <p className="mt-2 text-sm text-emerald-400">{aviso}</p>}
        </>
      )}
    </div>
  );
}
