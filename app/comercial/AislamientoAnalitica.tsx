"use client";

import { useEffect } from "react";

// Defensa en profundidad del aislamiento del área comercial respecto de la
// analítica pública. El documento comercial nace sin Google Tag Manager (no se
// carga en /comercial y el middleware convierte en navegación de documento
// completo cualquier entrada desde otra página). Si aun así este documento trae
// GTM —una navegación nueva que alguien agregue sin pasar por ahí—, se recarga
// una vez para descartarlo. Si después de recargar sigue (una extensión del
// navegador, por ejemplo), no insiste: no hay bucle.

const MARCA = "crm-aislamiento-recarga";

declare global {
  interface Window {
    google_tag_manager?: unknown;
  }
}

export default function AislamientoAnalitica() {
  useEffect(() => {
    const conGtm = Boolean(window.google_tag_manager) || Boolean(document.querySelector('script[src*="googletagmanager.com"]'));
    try {
      if (!conGtm) {
        sessionStorage.removeItem(MARCA);
        return;
      }
      if (sessionStorage.getItem(MARCA)) return;
      sessionStorage.setItem(MARCA, "1");
    } catch {
      return;
    }
    window.location.reload();
  }, []);
  return null;
}
