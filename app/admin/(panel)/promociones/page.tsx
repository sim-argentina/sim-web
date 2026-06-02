"use client";

import { useEffect, useMemo, useState } from "react";

type ClientePromo = {
  nombre: string;
  telefono: string;
  cantidad_turnos: number;
  total_gastado: number;
  ultimo_turno: string;
};

function formatoDinero(valor: number) {
  return `$${valor.toLocaleString("es-AR")}`;
}

export default function AdminPromocionesPage() {
  const [clientes, setClientes] = useState<ClientePromo[]>([]);
  const [loading, setLoading] = useState(false);

  const [busqueda, setBusqueda] = useState("");
  const [dias, setDias] = useState(30);
  const [historico, setHistorico] = useState(false);

  const [turnosObjetivo, setTurnosObjetivo] = useState(5);

  async function cargarClientes() {
    setLoading(true);

    try {
      const params = new URLSearchParams();
      params.set("dias", String(dias));
      params.set("historico", String(historico));

      if (busqueda.trim().length >= 2) {
        params.set("q", busqueda.trim());
      }

      const res = await fetch(`/api/promociones/clientes?${params.toString()}`, {
        cache: "no-store",
      });

      const data = await res.json();

      if (!res.ok) {
        console.error(data);
        alert(data.error || "Error cargando promociones");
        return;
      }

      setClientes(data.clientes || []);
    } catch (error) {
      console.error(error);
      alert("Error cargando promociones");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargarClientes();
  }, [dias, historico]);

  const resumen = useMemo(() => {
    const clientesConPromo = clientes.filter(
      (cliente) => cliente.cantidad_turnos >= turnosObjetivo
    ).length;

    const clientesCerca = clientes.filter(
      (cliente) =>
        cliente.cantidad_turnos < turnosObjetivo &&
        cliente.cantidad_turnos >= turnosObjetivo - 1
    ).length;

    return {
      totalClientes: clientes.length,
      clientesConPromo,
      clientesCerca,
    };
  }, [clientes, turnosObjetivo]);

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white md:px-6">
      <section className="mx-auto max-w-7xl">
        <div className="mb-6">
          <p className="mb-2 text-xs uppercase tracking-[0.3em] text-red-500">
            Admin SIM
          </p>

          <h1 className="text-3xl font-black uppercase md:text-5xl">
            Promociones
          </h1>

          <p className="mt-2 max-w-2xl text-sm text-white/60">
            Controlá qué clientes cumplen condiciones para beneficios, premios o
            turnos gratis.
          </p>
        </div>

        <div className="mb-6 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="mb-4 text-xl font-black uppercase text-red-500">
            Promo por cantidad de turnos
          </h2>

          <div className="grid gap-3 md:grid-cols-5">
            <Campo label="Buscar cliente">
              <input
                type="text"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") cargarClientes();
                }}
                placeholder="Nombre o teléfono"
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-red-500"
              />
            </Campo>

            <Campo label="Turnos necesarios">
              <input
                type="number"
                min={1}
                value={turnosObjetivo}
                onChange={(e) => setTurnosObjetivo(Number(e.target.value))}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              />
            </Campo>

            <Campo label="Últimos días">
              <input
                type="number"
                min={1}
                value={dias}
                disabled={historico}
                onChange={(e) => setDias(Number(e.target.value))}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500 disabled:opacity-30"
              />
            </Campo>

            <div className="flex items-end">
              <label className="flex h-[38px] w-full items-center gap-2 rounded-xl border border-white/15 bg-black px-3 text-sm font-bold text-white/70">
                <input
                  type="checkbox"
                  checked={historico}
                  onChange={(e) => setHistorico(e.target.checked)}
                  className="h-4 w-4 accent-red-600"
                />
                Histórico
              </label>
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={cargarClientes}
                className="w-full rounded-xl bg-red-600 px-4 py-2 text-sm font-black uppercase transition hover:bg-red-700"
              >
                Filtrar
              </button>
            </div>
          </div>
        </div>

        <div className="mb-6 grid gap-3 md:grid-cols-3">
          <ResumenCard titulo="Clientes encontrados" valor={resumen.totalClientes} />
          <ResumenCard titulo="Ya acceden a promo" valor={resumen.clientesConPromo} />
          <ResumenCard titulo="A 1 turno de llegar" valor={resumen.clientesCerca} />
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black uppercase text-red-500">
                Estado de clientes
              </h2>
              <p className="text-sm text-white/50">
                {historico
                  ? "Mostrando historial completo"
                  : `Mostrando últimos ${dias} días`}
              </p>
            </div>
          </div>

          {loading ? (
            <p className="text-white/60">Cargando clientes...</p>
          ) : clientes.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black p-5">
              <p className="text-white/60">
                No hay clientes para los filtros seleccionados.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[900px] space-y-2">
                <div className="grid grid-cols-[1.5fr_1fr_120px_160px_150px_180px] gap-2 px-3 text-xs font-black uppercase tracking-[0.15em] text-white/35">
                  <span>Cliente</span>
                  <span>Teléfono</span>
                  <span>Turnos</span>
                  <span>Progreso</span>
                  <span>Total gastado</span>
                  <span>Estado</span>
                </div>

                {clientes.map((cliente) => {
                  const cumple = cliente.cantidad_turnos >= turnosObjetivo;
                  const faltan = Math.max(
                    turnosObjetivo - cliente.cantidad_turnos,
                    0
                  );

                  const porcentaje = Math.min(
                    (cliente.cantidad_turnos / turnosObjetivo) * 100,
                    100
                  );

                  return (
                    <div
                      key={`${cliente.nombre}-${cliente.telefono}`}
                      className={`grid grid-cols-[1.5fr_1fr_120px_160px_150px_180px] items-center gap-2 rounded-xl border px-3 py-3 text-sm ${
                        cumple
                          ? "border-green-500/50 bg-green-950/25"
                          : "border-white/10 bg-black"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-black">
                          {cliente.nombre || "Sin nombre"}
                        </p>
                        <p className="text-xs text-white/40">
                          Último turno: {cliente.ultimo_turno || "-"}
                        </p>
                      </div>

                      <span className="text-white/70">
                        {cliente.telefono || "-"}
                      </span>

                      <span className="font-black">
                        {cliente.cantidad_turnos} / {turnosObjetivo}
                      </span>

                      <div>
                        <div className="h-2 overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full bg-red-600"
                            style={{ width: `${porcentaje}%` }}
                          />
                        </div>
                        <p className="mt-1 text-xs text-white/40">
                          {Math.round(porcentaje)}%
                        </p>
                      </div>

                      <span className="font-black text-red-500">
                        {formatoDinero(cliente.total_gastado)}
                      </span>

                      <span
                        className={`rounded-full px-3 py-1 text-center text-xs font-black uppercase ${
                          cumple
                            ? "bg-green-600 text-white"
                            : "bg-white/10 text-white/60"
                        }`}
                      >
                        {cumple ? "Promo disponible" : `Faltan ${faltan}`}
                      </span>
                    </div>
                  );
                })}
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

function ResumenCard({ titulo, valor }: { titulo: string; valor: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-white/40">
        {titulo}
      </p>
      <p className="mt-2 text-3xl font-black text-white">{valor}</p>
    </div>
  );
}