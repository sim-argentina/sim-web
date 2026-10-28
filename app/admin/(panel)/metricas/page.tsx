"use client";

// Métricas de gestión: contenedor de pestañas. Cada pestaña se descarga (código y
// datos) recién cuando se abre: el Stand, que es la principal, ya no espera a que
// carguen reservas, campeonatos ni el historial completo, y SheetJS solo baja al
// importar un Excel.

import { Suspense, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";

const Cargando = () => (
  <div className="mt-6 space-y-4" role="status" aria-label="Cargando">
    <div className="h-14 animate-pulse rounded-2xl bg-white/[0.05] motion-reduce:animate-none" />
    <div className="h-64 animate-pulse rounded-2xl bg-white/[0.05] motion-reduce:animate-none" />
  </div>
);

const StandDashboard = dynamic(() => import("./stand/StandDashboard"), { loading: Cargando });
const ReservasCampeonatos = dynamic(() => import("./ReservasCampeonatos"), { loading: Cargando });
const WebTab = dynamic(() => import("./WebTab"), { loading: Cargando });
const EquipoTab = dynamic(() => import("./EquipoTab"), { loading: Cargando });

type Vista = "stand" | "reservas" | "campeonatos" | "web" | "equipo";
const VISTAS: Vista[] = ["stand", "reservas", "campeonatos", "web", "equipo"];
const NOMBRE: Record<Vista, string> = { stand: "Stand", reservas: "Reservas web", campeonatos: "Campeonatos", web: "Web", equipo: "Equipo" };

export default function AdminMetricasPage() {
  return (
    <Suspense fallback={<Cargando />}>
      <Metricas />
    </Suspense>
  );
}

function Metricas() {
  const busqueda = useSearchParams();
  const [vista, setVista] = useState<Vista>(() => {
    const v = busqueda.get("vista") as Vista | null;
    return v && VISTAS.includes(v) ? v : "stand";
  });
  // Rol para gatear la pestaña Equipo (admin-only). La API sigue siendo la autoridad.
  const [role, setRole] = useState<string | null>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    fetch("/api/admin/me")
      .then((r) => r.json())
      .then((d) => setRole(d.role))
      .catch(() => {});
  }, []);
  const esAdmin = role === "admin";
  const visibles = VISTAS.filter((v) => v !== "equipo" || esAdmin);

  function elegir(v: Vista) {
    setVista(v);
    const sp = new URLSearchParams(window.location.search);
    sp.set("vista", v);
    window.history.replaceState(null, "", `${window.location.pathname}?${sp.toString()}`);
  }

  function teclas(e: ReactKeyboardEvent, i: number) {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const j = (i + d + visibles.length) % visibles.length;
    elegir(visibles[j]);
    tabs.current[j]?.focus();
  }

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="mb-6 pl-16 2xl:pl-0">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.3em] text-red-500">Panel administrativo</p>
          <h1 className="text-3xl font-bold sm:text-4xl">Métricas de gestión</h1>
        </div>

        <div role="tablist" aria-label="Secciones de métricas" className="mb-2 flex max-w-full overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.04] p-1 sm:w-fit">
          {visibles.map((v, i) => (
            <button
              key={v}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${v}`}
              aria-selected={vista === v}
              aria-controls={`panel-${v}`}
              tabIndex={vista === v ? 0 : -1}
              onClick={() => elegir(v)}
              onKeyDown={(e) => teclas(e, i)}
              className={`min-h-11 shrink-0 rounded-xl px-5 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400 ${
                vista === v ? "bg-red-600 text-white" : "text-white/55 hover:text-white"
              }`}
            >
              {NOMBRE[v]}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`panel-${vista}`} aria-labelledby={`tab-${vista}`} className="mt-4">
          {vista === "stand" ? (
            <StandDashboard />
          ) : vista === "reservas" || vista === "campeonatos" ? (
            <ReservasCampeonatos key={vista} vista={vista} />
          ) : vista === "web" ? (
            <WebTab />
          ) : esAdmin ? (
            <EquipoTab />
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-10 text-center text-white/60">Sección disponible solo para administradores.</div>
          )}
        </div>
      </div>
    </main>
  );
}
