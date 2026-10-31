"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Aviso, Boton } from "@/app/admin/(panel)/interacciones/ui";
import { PREFIJO_BORRADOR } from "@/lib/crmB1";

// Cierra la sesión comercial: el servidor revoca todas las sesiones del usuario y
// borra la cookie de este navegador. También borra los borradores de visita que
// queden en este dispositivo (no quedan datos del comercial para el siguiente).
function borrarBorradores() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIJO_BORRADOR)) localStorage.removeItem(k);
  } catch { /* sin almacenamiento */ }
}

export default function CerrarSesion() {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function salir() {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch("/comercial/api/salir", { method: "POST", cache: "no-store" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "No se pudo cerrar la sesión.");
      }
    } catch {
      setError("No se pudo conectar con el servidor.");
    }
    setCargando(false);
    borrarBorradores();
    router.replace("/comercial/ingresar");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {error ? <Aviso tipo="error">{error}</Aviso> : null}
      <Boton variante="secundario" cargando={cargando} onClick={salir} className="w-full">
        <LogOut className="h-4 w-4" aria-hidden />
        Cerrar sesión
      </Boton>
      <p className="text-center text-xs text-white/50">Cierra tu sesión en todos los dispositivos.</p>
    </div>
  );
}
