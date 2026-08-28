"use client";

import { useState } from "react";
import CalendarioClient from "./CalendarioClient";
import CronogramaClient from "./CronogramaClient";

type Tab = "calendario" | "equipo";

// Contenedor de pestañas. Calendario es la pestaña inicial. La pestaña Equipo
// reutiliza íntegramente el cliente del Bloque 1 (sin duplicar su lógica).
export default function CronogramaTabs({ role }: { role: string }) {
  const [tab, setTab] = useState<Tab>("calendario");

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl px-4 pt-2 md:px-6">
        <div className="flex gap-2">
          <TabBtn activa={tab === "calendario"} onClick={() => setTab("calendario")}>
            Calendario
          </TabBtn>
          <TabBtn activa={tab === "equipo"} onClick={() => setTab("equipo")}>
            Equipo
          </TabBtn>
        </div>
      </div>

      {/* Se renderiza el cliente de la pestaña activa (cada uno trae su <main>). */}
      {tab === "calendario" ? <CalendarioClient role={role} /> : <CronogramaClient role={role} />}
    </div>
  );
}

function TabBtn({
  activa,
  onClick,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-5 py-2.5 text-sm font-black uppercase tracking-wide transition ${
        activa ? "bg-red-600 text-white" : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
      }`}
    >
      {children}
    </button>
  );
}
