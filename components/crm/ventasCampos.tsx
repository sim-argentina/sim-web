"use client";

// Piezas de las pantallas de ventas del CRM (B3, solo Administración): campo de
// importe con vista previa (lo que se va a guardar, en pesos), etiquetas de los
// estados derivados y el envío idempotente: una clave por envío; un resultado
// INCIERTO bloquea el formulario y se reintenta con la MISMA clave y el MISMO
// cuerpo (si ya había llegado, la base devuelve lo guardado y no duplica).

import { useId, useState, type ReactNode } from "react";
import { Etiqueta } from "@/app/admin/(panel)/interacciones/ui";
import { enviar, type Respuesta } from "./api";
import { INPUT } from "./campos";
import {
  formatoPesos, leerImporte, textoEstadoCobro, textoEstadoComision, type Centavos, type EstadoCobro, type EstadoComision,
} from "@/lib/crmB3";

/** Importe en pesos: acepta "150.000", "150000,50"… y muestra cómo se va a guardar. */
export function CampoImporte({ etiqueta, valor, onCambio, ayuda, deshabilitado, autoFoco }: {
  etiqueta: string; valor: string; onCambio: (v: string) => void; ayuda?: ReactNode; deshabilitado?: boolean; autoFoco?: boolean;
}) {
  const id = useId();
  const c = leerImporte(valor);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold text-white/80">{etiqueta}</label>
      <input id={id} inputMode="decimal" autoComplete="off" maxLength={20} value={valor} disabled={deshabilitado} autoFocus={autoFoco}
        onChange={(e) => onCambio(e.target.value.replace(/[^\d.,$\s]/g, ""))} className={INPUT} aria-describedby={`${id}-v`} />
      <p id={`${id}-v`} className={`text-xs ${valor.trim() && c === null ? "text-red-300" : "text-white/60"}`}>
        {!valor.trim() ? "Sin cargar." : c === null ? "No se entiende el importe: usá 150.000 o 150000,50." : <>Se guarda: <strong className="text-white">{formatoPesos(c)}</strong></>}
      </p>
      {ayuda ? <p className="text-xs text-white/50">{ayuda}</p> : null}
    </div>
  );
}

/** Centavos → texto editable ("150000" o "150000,50"). */
export const deCentavos = (c: Centavos | null) => (c === null ? "" : c % 100 === 0 ? String(c / 100) : `${Math.trunc(c / 100)},${String(c % 100).padStart(2, "0")}`);

export function EtiquetaCobro({ estado }: { estado: EstadoCobro }) {
  return <Etiqueta tono={estado === "cobrada" ? "verde" : estado === "sin_cobros" ? "ambar" : "neutro"}>{textoEstadoCobro(estado)}</Etiqueta>;
}

export function EtiquetaComision({ estado }: { estado: EstadoComision }) {
  const tono = estado === "a_revisar" ? "rojo" : estado === "pagada" ? "verde" : estado === "generada" || estado === "pagada_parcial" ? "ambar" : "gris";
  return <Etiqueta tono={tono}>Comisión: {textoEstadoComision(estado)}</Etiqueta>;
}

type Pendiente = { url: string; metodo: "POST" | "PATCH"; cuerpo: Record<string, unknown> };

/**
 * Envío con clave de idempotencia. `mandar` agrega la clave; si la respuesta es
 * incierta, `incierto` queda en true y `reintentar` repite exactamente lo mismo.
 * Tras un éxito (o al descartar) se genera una clave nueva.
 */
export function useEnvio() {
  const [clave, setClave] = useState(() => crypto.randomUUID());
  const [enviando, setEnviando] = useState(false);
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);

  async function ejecutar<T>(p: Pendiente): Promise<Respuesta<T>> {
    setEnviando(true);
    const r = await enviar<T>(p.url, p.metodo, { ...p.cuerpo, clave });
    setEnviando(false);
    if (r.ok) {
      setPendiente(null);
      setClave(crypto.randomUUID());
    } else if (r.incierto) setPendiente(p);
    else setPendiente(null);
    return r;
  }
  return {
    enviando,
    incierto: !!pendiente,
    mandar: <T,>(url: string, metodo: "POST" | "PATCH", cuerpo: Record<string, unknown>) => ejecutar<T>({ url, metodo, cuerpo }),
    reintentar: <T,>() => (pendiente ? ejecutar<T>(pendiente) : Promise.resolve(null)),
    descartar: () => { setPendiente(null); setClave(crypto.randomUUID()); },
  };
}

export const MENSAJE_INCIERTO = "No sabemos si se guardó (sin respuesta del servidor). Reintentá: si ya había llegado, no se duplica.";
