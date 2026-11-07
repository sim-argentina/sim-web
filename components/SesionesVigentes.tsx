"use client";

import { useEffect, useState } from "react";
import { listaDuraciones } from "@/lib/ofertaPublicaTexto";

// (Bloque final) Las duraciones de las sesiones que muestra la Home salen del
// catálogo VIGENTE de Reservas, que resuelve el servidor en cada request
// (/api/reservas/catalogo: force-dynamic, no-store). La Home es ISR (6 h, por las
// reseñas de Google): si el texto viajara en ese HTML, quitar el override se
// vería recién en la próxima revalidación. Así cambia en el request siguiente,
// sin redeploy y sin reloj del navegador. Mientras carga muestra "—".
//
// La barra del Hero (HeroHome) usa la MISMA consulta con useDuracionesVigentes:
// una sola petición por carga de página, compartida por los dos componentes.

let pedido: Promise<number[] | null> | null = null;

function duracionesVigentes(): Promise<number[] | null> {
  if (!pedido) {
    pedido = fetch("/api/reservas/catalogo", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { duraciones?: unknown } | null) => {
        const lista = d && Array.isArray(d.duraciones) ? d.duraciones.map(Number) : [];
        const validas = lista.filter((n) => Number.isInteger(n) && n > 0);
        return validas.length > 0 ? validas.sort((a, b) => a - b) : null;
      })
      .catch(() => null)
      .finally(() => {
        // Se comparte durante la carga; la próxima navegación vuelve a preguntar.
        setTimeout(() => { pedido = null; }, 0);
      });
  }
  return pedido;
}

/** Duraciones vigentes (minutos, ordenadas) o null mientras carga / si falla. */
export function useDuracionesVigentes(): number[] | null {
  const [duraciones, setDuraciones] = useState<number[] | null>(null);
  useEffect(() => {
    let vivo = true;
    duracionesVigentes().then((d) => {
      if (vivo && d) setDuraciones(d);
    });
    return () => {
      vivo = false;
    };
  }, []);
  return duraciones;
}

export default function SesionesVigentes() {
  const duraciones = useDuracionesVigentes();
  return <>{duraciones ? `${listaDuraciones(duraciones)} minutos` : "—"}</>;
}
