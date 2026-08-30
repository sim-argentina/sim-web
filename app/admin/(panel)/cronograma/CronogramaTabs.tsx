"use client";

import { useState } from "react";
import CalendarioClient from "./CalendarioClient";
import CronogramaClient from "./CronogramaClient";

type Tab = "calendario" | "equipo";

// Contenedor de pestañas. El ROL viene del servidor (getCurrentAdminRole).
//  · Admin: pestañas Calendario (inicial) + Equipo.
//  · Staff: SOLO Calendario. La pestaña y la sección Equipo NO se renderizan
//    (no van en el HTML SSR, no hay flash de hidratación y ?tab=equipo no aplica),
//    porque la decisión se basa en el rol validado server-side.
export default function CronogramaTabs({ role }: { role: string }) {
  const esAdmin = role === "admin";
  const [tab, setTab] = useState<Tab>("calendario");

  // Staff: sin pestañas, solo el Calendario (meses confirmados).
  if (!esAdmin) {
    return (
      <div className="min-h-screen bg-black text-white">
        <CalendarioClient role={role} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl px-4 pt-2 md:px-6">
        <div className="flex gap-2">
          <TabBtn activa={tab === "calendario"} onClick={() => setTab("calendario")}>Calendario</TabBtn>
          <TabBtn activa={tab === "equipo"} onClick={() => setTab("equipo")}>Equipo</TabBtn>
        </div>
      </div>
      {tab === "calendario" ? <CalendarioClient role={role} /> : <CronogramaClient role={role} />}
    </div>
  );
}

function TabBtn({ activa, onClick, children }: { activa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-5 py-2.5 text-sm font-black uppercase tracking-wide transition ${activa ? "bg-red-600 text-white" : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"}`}
    >
      {children}
    </button>
  );
}
