"use client";

// Alta de un negocio SIN visita (para visitarlo después). No genera visita,
// jornada, lead ni interés. El comercial lo crea asignado a sí mismo; la
// administración puede elegir responsable y marcar cliente previo. Si hay
// negocios parecidos, avisa: los propios se pueden abrir; de los ajenos solo se
// ve el nombre, la zona, el rubro y si están asignados.

import { useState } from "react";
import { Aviso, Boton, Chips } from "@/app/admin/(panel)/interacciones/ui";
import type { CandidatoDuplicado, Catalogo } from "@/lib/crmB1";
import { enviar } from "./api";
import { CamposEmpresa, Selector, datosEmpresa, empresaVacia, type ValoresEmpresa } from "./campos";

export default function AltaNegocio({ modo, apiBase, catalogo, comerciales, onCreado, onAbrir }: {
  modo: "comercial" | "admin";
  apiBase: string;
  catalogo: Catalogo;
  comerciales?: Array<{ id: string; nombre: string; activo: boolean }>;
  onCreado: (id: string) => void;
  onAbrir: (id: string) => void;
}) {
  const [valores, setValores] = useState<ValoresEmpresa>(empresaVacia());
  const [responsable, setResponsable] = useState("");
  const [clientePrevio, setClientePrevio] = useState<"si" | null>(null);
  const [candidatos, setCandidatos] = useState<CandidatoDuplicado[] | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function crear(confirmar: boolean) {
    if (!valores.nombre_comercial.trim()) { setError("Falta el nombre comercial."); return; }
    setEnviando(true);
    setError(null);
    const datos = datosEmpresa(valores);
    if (modo === "admin") Object.assign(datos, { responsable_id: responsable || null, cliente_previo: clientePrevio === "si" });
    const r = await enviar<{ id: string }>(`${apiBase}/negocios`, "POST", { datos, confirmar_duplicado: confirmar });
    setEnviando(false);
    if (r.ok) { onCreado(r.data.id); return; }
    if (r.codigo === "posible_duplicado") { setCandidatos(r.candidatos ?? []); return; }
    setError(r.error);
  }

  return (
    <div className="space-y-4">
      <CamposEmpresa valores={valores} onCambio={(v) => { setValores(v); setCandidatos(null); }} catalogo={catalogo} autoFoco />
      {modo === "admin" ? (
        <>
          <Selector etiqueta="Responsable comercial" valor={responsable} onCambio={setResponsable} vacio="Sin asignar"
            opciones={(comerciales ?? []).filter((c) => c.activo).map((c) => ({ valor: c.id, texto: c.nombre }))} />
          <Chips etiqueta="Cliente previo" opciones={[{ valor: "si", texto: "Ya compró antes" }] as const} valor={clientePrevio} onCambio={setClientePrevio}
            ayuda="Identifica un cliente anterior; no carga compras." />
        </>
      ) : null}
      {candidatos ? (
        <Aviso tipo="alerta" titulo="Hay negocios parecidos">
          <ul className="mt-2 space-y-2">
            {candidatos.map((c, i) => (
              <li key={c.id ?? i} className="rounded-xl border border-white/10 p-2">
                <p className="font-semibold">{c.nombre_comercial}</p>
                <p className="text-xs text-white/60">{[c.zona, c.rubro, c.direccion].filter(Boolean).join(" · ") || "Sin más datos"} · {c.asignacion === "vos" ? "asignado a vos" : c.asignacion === "sin_asignar" ? "sin asignar" : "asignado a otra persona"}</p>
                {c.id ? <Boton variante="secundario" className="mt-2" onClick={() => onAbrir(c.id!)}>Abrir ese negocio</Boton> : null}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Boton variante="primario" cargando={enviando} onClick={() => void crear(true)}>Es otro negocio: crearlo</Boton>
          </div>
        </Aviso>
      ) : null}
      {error ? <Aviso tipo="error">{error}</Aviso> : null}
      {!candidatos ? <Boton variante="primario" className="w-full" cargando={enviando} onClick={() => void crear(false)}>Crear negocio</Boton> : null}
    </div>
  );
}
