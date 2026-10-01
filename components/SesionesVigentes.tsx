"use client";

import { useEffect, useState } from "react";
import { listaDuraciones } from "@/lib/ofertaPublicaTexto";

// (Bloque final) Las duraciones de las sesiones que muestra la Home salen del
// catálogo VIGENTE de Reservas, que resuelve el servidor en cada request
// (/api/reservas/catalogo: force-dynamic, no-store). La Home es ISR (6 h, por las
// reseñas de Google): si el texto viajara en ese HTML, quitar el override se
// vería recién en la próxima revalidación. Así cambia en el request siguiente,
// sin redeploy y sin reloj del navegador. Mientras carga muestra "—".
export default function SesionesVigentes() {
  const [texto, setTexto] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/reservas/catalogo", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { duraciones?: unknown } | null) => {
        if (!vivo || !d || !Array.isArray(d.duraciones) || d.duraciones.length === 0) return;
        setTexto(`${listaDuraciones(d.duraciones as number[])} minutos`);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  return <>{texto ?? "—"}</>;
}
