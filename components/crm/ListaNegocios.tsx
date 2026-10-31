"use client";

// Lista de negocios. Comercial: los suyos, con búsqueda y estado. Administración:
// todos, con filtros (responsable, rubro, zona, prioridad, estado, posibles
// duplicados, archivados) y alta con asignación.

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Aviso, Boton, Cargando, Etiqueta, Panel } from "@/app/admin/(panel)/interacciones/ui";
import type { Catalogo, EmpresaDto } from "@/lib/crmB1";
import { pedir } from "./api";
import AltaNegocio from "./AltaNegocio";
import { EstadoNegocioEtiqueta, INPUT, Selector, fechaCorta } from "./campos";

type Comercial = { id: string; nombre: string; activo: boolean };

export default function ListaNegocios({ modo, apiBase, baseNegocio, rutaNuevo }: {
  modo: "comercial" | "admin";
  apiBase: string;
  /** Prefijo de la ficha: se le agrega el id. */
  baseNegocio: string;
  rutaNuevo?: string;
}) {
  const [q, setQ] = useState("");
  const [f, setF] = useState({ estado: "", responsable: "", rubro: "", zona: "", prioridad: "", duplicados: false });
  const [lista, setLista] = useState<EmpresaDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catalogo, setCatalogo] = useState<(Catalogo & { usuarios?: Comercial[] }) | null>(null);
  const [alta, setAlta] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vivo = true;
    pedir<Catalogo & { usuarios?: Comercial[] }>(`${apiBase}/catalogo`).then((r) => { if (vivo && r.ok) setCatalogo(r.data); });
    return () => { vivo = false; };
  }, [apiBase]);

  useEffect(() => {
    let vivo = true;
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (f.estado) p.set("estado", f.estado);
    if (modo === "admin") {
      if (f.responsable) p.set("responsable", f.responsable);
      if (f.rubro) p.set("rubro", f.rubro);
      if (f.zona) p.set("zona", f.zona);
      if (f.prioridad) p.set("prioridad", f.prioridad);
      if (f.duplicados) p.set("duplicados", "1");
    }
    const t = setTimeout(() => {
      pedir<{ negocios: EmpresaDto[] }>(`${apiBase}/negocios?${p}`).then((r) => {
        if (!vivo) return;
        if (r.ok) { setLista(r.data.negocios); setError(null); } else setError(r.error);
      });
    }, 200);
    return () => { vivo = false; clearTimeout(t); };
  }, [q, f, modo, apiBase, recarga]);

  const estados = [["", "Todos"], ["por_visitar", "Por visitar"], ["visitado", "Visitados"], ["con_oportunidad", "Leads"], ...(modo === "admin" ? [["archivado", "Archivados"]] : [])];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-white/40" aria-hidden />
          <input className={`${INPUT} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre" aria-label="Buscar negocio" />
        </div>
        {modo === "comercial" && rutaNuevo ? (
          <Link href={rutaNuevo} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700">
            <Plus className="h-4 w-4" aria-hidden />Nuevo
          </Link>
        ) : null}
        {modo === "admin" ? <Boton variante="primario" onClick={() => setAlta(true)}><Plus className="h-4 w-4" aria-hidden />Nuevo negocio</Boton> : null}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Estado">
        {estados.map(([v, t]) => (
          <button key={v} type="button" aria-pressed={f.estado === v} onClick={() => setF({ ...f, estado: v })}
            className={`min-h-10 rounded-xl border px-3 text-sm font-semibold ${f.estado === v ? "border-red-500 bg-red-600 text-white" : "border-white/15 text-white/80"}`}>{t}</button>
        ))}
      </div>
      {modo === "admin" && catalogo ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Selector etiqueta="Responsable" valor={f.responsable} onCambio={(v) => setF({ ...f, responsable: v })} vacio="Todos"
            opciones={[{ valor: "sin_asignar", texto: "Sin asignar" }, ...(catalogo.usuarios ?? []).map((u) => ({ valor: u.id, texto: u.nombre }))]} />
          <Selector etiqueta="Rubro" valor={f.rubro} onCambio={(v) => setF({ ...f, rubro: v })} vacio="Todos"
            opciones={[{ valor: "sin_clasificar", texto: "Sin rubro de la lista" }, ...catalogo.rubros.map((r) => ({ valor: r.id, texto: r.nombre }))]} />
          <Selector etiqueta="Zona" valor={f.zona} onCambio={(v) => setF({ ...f, zona: v })} vacio="Todas" opciones={catalogo.zonas.map((z) => ({ valor: z.id, texto: z.nombre }))} />
          <Selector etiqueta="Prioridad" valor={f.prioridad} onCambio={(v) => setF({ ...f, prioridad: v })} vacio="Todas" opciones={["A", "B", "C"].map((p) => ({ valor: p, texto: p }))} />
          <label className="flex min-h-11 items-end gap-2 pb-2 text-sm font-semibold text-white/80">
            <input type="checkbox" checked={f.duplicados} onChange={(e) => setF({ ...f, duplicados: e.target.checked })} className="h-5 w-5 accent-red-600" />
            Posibles duplicados
          </label>
        </div>
      ) : null}
      {error ? <Aviso tipo="error">{error}</Aviso> : lista === null ? <Cargando /> : lista.length === 0 ? (
        <p className="py-6 text-sm text-white/60">{modo === "comercial" ? "No tenés negocios con ese filtro." : "No hay negocios con ese filtro."}</p>
      ) : (
        <ul className="space-y-2">
          {lista.map((e) => (
            <li key={e.id}>
              <Link href={`${baseNegocio}${e.id}`} className="block rounded-2xl border border-white/10 bg-white/[0.03] p-4 hover:border-white/30">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold">{e.nombre_comercial}</p>
                    <p className="text-sm text-white/60">{[e.rubro ?? (e.rubro_detalle ? `${e.rubro_detalle} (sin clasificar)` : null), e.zona, e.direccion].filter(Boolean).join(" · ") || "Sin datos de ubicación"}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <EstadoNegocioEtiqueta estado={e.estado} />
                    {e.prioridad ? <Etiqueta>{e.prioridad}</Etiqueta> : null}
                    {e.posible_duplicado ? <Etiqueta tono="ambar">Posible duplicado</Etiqueta> : null}
                    {e.cliente_previo ? <Etiqueta>Cliente previo</Etiqueta> : null}
                  </div>
                </div>
                <p className="mt-1 text-xs text-white/50">
                  {e.visitas} visita{e.visitas === 1 ? "" : "s"}{e.ultima_visita ? ` · última ${fechaCorta(e.ultima_visita.slice(0, 10))}` : ""}
                  {e.revisita_pendiente !== false ? ` · revisita ${e.revisita_pendiente ? fechaCorta(e.revisita_pendiente) : "sin fecha"}` : ""}
                  {modo === "admin" ? ` · ${e.responsable?.nombre ?? "sin asignar"}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {alta && catalogo ? (
        <Panel titulo="Nuevo negocio" onCerrar={() => setAlta(false)}>
          <AltaNegocio modo="admin" apiBase={apiBase} catalogo={catalogo} comerciales={catalogo.usuarios}
            onCreado={() => { setAlta(false); setRecarga((n) => n + 1); }} onAbrir={(id) => { window.location.href = `${baseNegocio}${id}`; }} />
        </Panel>
      ) : null}
    </div>
  );
}
