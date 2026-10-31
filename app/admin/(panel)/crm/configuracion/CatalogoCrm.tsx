"use client";

// Rubros y zonas del CRM (B1). No se borran: se desactivan (los negocios que ya
// los usan los conservan; no aparecen para elegir). Los rubros no son una lista
// cerrada: un alta puede describir uno no listado, y desde Negocios (filtro "Sin
// rubro de la lista") se ven esos casos para sumarlos acá y reclasificarlos.

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Aviso, Boton, Cargando, Etiqueta } from "../../interacciones/ui";
import { enviar, pedir } from "@/components/crm/api";
import { INPUT } from "@/components/crm/campos";
import type { Catalogo } from "@/lib/crmB1";

type Item = Catalogo["rubros"][number];

function Lista({ tipo, titulo, items, onCambio }: { tipo: "rubro" | "zona"; titulo: string; items: Item[]; onCambio: (t: string, ok: boolean) => void }) {
  const [nuevo, setNuevo] = useState("");
  const [edicion, setEdicion] = useState<Record<string, string>>({});
  const [trabajando, setTrabajando] = useState(false);
  const guardar = async (p: ReturnType<typeof enviar>, exito: string) => {
    setTrabajando(true);
    const r = await p;
    setTrabajando(false);
    onCambio(r.ok ? exito : r.error, r.ok);
    return r.ok;
  };
  return (
    <section className="space-y-3 rounded-3xl border border-white/10 bg-white/[0.02] p-4 md:p-6">
      <h2 className="text-lg font-black">{titulo}</h2>
      <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (nuevo.trim() && await guardar(enviar("/api/admin/crm/catalogo", "POST", { tipo, datos: { nombre: nuevo.trim() } }), `${tipo === "rubro" ? "Rubro" : "Zona"} agregado.`)) setNuevo(""); }}>
        <input className={INPUT} maxLength={60} value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder={tipo === "rubro" ? "Nuevo rubro" : "Nueva zona"} aria-label={tipo === "rubro" ? "Nuevo rubro" : "Nueva zona"} />
        <Boton type="submit" variante="primario" disabled={trabajando || !nuevo.trim()}><Plus className="h-4 w-4" aria-hidden />Agregar</Boton>
      </form>
      {items.length === 0 ? <p className="text-sm text-white/60">Todavía no hay {tipo === "rubro" ? "rubros" : "zonas"}.</p> : (
        <ul className="divide-y divide-white/10">
          {items.map((it) => (
            <li key={it.id} className="flex flex-wrap items-center gap-2 py-2">
              <input className={`${INPUT} min-w-0 flex-1`} maxLength={60} value={edicion[it.id] ?? it.nombre} onChange={(e) => setEdicion({ ...edicion, [it.id]: e.target.value })} aria-label={`Nombre de ${it.nombre}`} />
              {!it.activo ? <Etiqueta tono="gris">Inactivo</Etiqueta> : null}
              {edicion[it.id] !== undefined && edicion[it.id].trim() && edicion[it.id] !== it.nombre ? (
                <Boton disabled={trabajando} onClick={async () => { if (await guardar(enviar(`/api/admin/crm/catalogo/${it.id}`, "PATCH", { tipo, version: it.version, datos: { nombre: edicion[it.id].trim() } }), "Nombre guardado.")) setEdicion({ ...edicion, [it.id]: undefined as unknown as string }); }}>Guardar</Boton>
              ) : null}
              <Boton variante="fantasma" disabled={trabajando} onClick={() => void guardar(enviar(`/api/admin/crm/catalogo/${it.id}`, "PATCH", { tipo, version: it.version, datos: { activo: !it.activo } }), it.activo ? "Desactivado." : "Activado.")}>
                {it.activo ? "Desactivar" : "Activar"}
              </Boton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function CatalogoCrm() {
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; ok: boolean } | null>(null);
  const [recarga, setRecarga] = useState(0);
  useEffect(() => {
    let vivo = true;
    pedir<Catalogo>("/api/admin/crm/catalogo").then((r) => { if (vivo && r.ok) setCatalogo(r.data); });
    return () => { vivo = false; };
  }, [recarga]);
  if (!catalogo) return <Cargando />;
  const cambio = (texto: string, ok: boolean) => { setAviso({ texto, ok }); if (ok) setRecarga((n) => n + 1); };
  return (
    <div className="space-y-4">
      <div aria-live="polite">{aviso ? <Aviso tipo={aviso.ok ? "exito" : "error"}>{aviso.texto}</Aviso> : null}</div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Lista tipo="rubro" titulo="Rubros" items={catalogo.rubros} onCambio={cambio} />
        <Lista tipo="zona" titulo="Zonas" items={catalogo.zonas} onCambio={cambio} />
      </div>
      <p className="text-sm text-white/60">Los negocios con un rubro descrito a mano se ven en Negocios con el filtro «Sin rubro de la lista».</p>
    </div>
  );
}
