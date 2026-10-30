"use client";

// Jornadas (CRM B1): lista y detalle, para el comercial (las suyas) y la
// administración (todas, con filtros, y la carga de una jornada ya realizada).
// Kilómetros y gastos no frenan nada: vacío = sin cargar, 0 = cero confirmado.
// Una jornada no se cierra sola; cerrarla no inventa los datos que falten.

import Link from "next/link";
import { useEffect, useState } from "react";
import { Lock, Plus } from "lucide-react";
import { Aviso, Boton, Cargando, Dialogo, Etiqueta, Panel } from "@/app/admin/(panel)/interacciones/ui";
import { hoyEnSim } from "@/lib/agenda";
import type { Catalogo, JornadaDto, VisitaDto } from "@/lib/crmB1";
import { enviar, pedir } from "./api";
import { CamposJornada, INPUT, ResumenVisita, Selector, datosJornada, fechaCorta, hora, pesos, valoresJornada, type ValoresJornada } from "./campos";

type Comercial = { id: string; nombre: string; activo: boolean };

export function FilaJornada({ j, href, conUsuario }: { j: JornadaDto; href: string; conUsuario?: boolean }) {
  return (
    <li>
      <Link href={href} className="block rounded-2xl border border-white/10 bg-white/[0.03] p-4 hover:border-white/30">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-bold">{fechaCorta(j.fecha)} · {j.nombre ?? "Jornada sin nombre"}</p>
            <p className="text-sm text-white/60">{[conUsuario ? j.usuario.nombre : null, j.zona, `${j.visitas} visita${j.visitas === 1 ? "" : "s"}`,
              j.km_recorridos !== null ? `${j.km_recorridos.toLocaleString("es-AR")} km` : "km pendientes"].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {j.cerrada_en ? <Etiqueta tono="gris">Cerrada</Etiqueta> : <Etiqueta tono="verde">Abierta</Etiqueta>}
            {j.pendientes.length ? <Etiqueta tono="ambar">Faltan datos</Etiqueta> : null}
            {j.cargada_por_admin ? <Etiqueta>Cargada por Administración</Etiqueta> : null}
          </div>
        </div>
      </Link>
    </li>
  );
}

export function ListaJornadas({ modo, apiBase, baseJornada }: { modo: "comercial" | "admin"; apiBase: string; baseJornada: string }) {
  const [f, setF] = useState({ usuario: "", desde: "", hasta: "", estado: "", pendientes: false });
  const [lista, setLista] = useState<JornadaDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catalogo, setCatalogo] = useState<(Catalogo & { usuarios?: Comercial[] }) | null>(null);
  const [alta, setAlta] = useState<{ usuario: string; fecha: string; valores: ValoresJornada } | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vivo = true;
    pedir<Catalogo & { usuarios?: Comercial[] }>(`${apiBase}/catalogo`).then((r) => { if (vivo && r.ok) setCatalogo(r.data); });
    return () => { vivo = false; };
  }, [apiBase]);
  useEffect(() => {
    let vivo = true;
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v === true ? "1" : String(v));
    pedir<{ jornadas: JornadaDto[] }>(`${apiBase}/jornadas?${p}`).then((r) => {
      if (!vivo) return;
      if (r.ok) { setLista(r.data.jornadas); setError(null); } else setError(r.error);
    });
    return () => { vivo = false; };
  }, [f, apiBase, recarga]);

  const crear = async () => {
    if (!alta) return;
    setTrabajando(true);
    const r = await enviar<{ id: string }>(`${apiBase}/jornadas`, "POST", { datos: { usuario_id: alta.usuario, fecha: alta.fecha, ...datosJornada(alta.valores) } });
    setTrabajando(false);
    if (r.ok) { setAlta(null); setRecarga((n) => n + 1); } else setError(r.error);
  };

  return (
    <div className="space-y-4">
      {modo === "admin" && catalogo ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Selector etiqueta="Comercial" valor={f.usuario} onCambio={(v) => setF({ ...f, usuario: v })} vacio="Todos" opciones={(catalogo.usuarios ?? []).map((u) => ({ valor: u.id, texto: u.nombre }))} />
          <label className="space-y-1.5 text-sm font-semibold text-white/80">Desde<input type="date" className={INPUT} value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} /></label>
          <label className="space-y-1.5 text-sm font-semibold text-white/80">Hasta<input type="date" className={INPUT} value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} /></label>
          <Selector etiqueta="Estado" valor={f.estado} onCambio={(v) => setF({ ...f, estado: v })} vacio="Todas" opciones={[{ valor: "abierta", texto: "Abiertas" }, { valor: "cerrada", texto: "Cerradas" }]} />
          <label className="flex min-h-11 items-end gap-2 pb-2 text-sm font-semibold text-white/80">
            <input type="checkbox" checked={f.pendientes} onChange={(e) => setF({ ...f, pendientes: e.target.checked })} className="h-5 w-5 accent-red-600" />Con datos pendientes
          </label>
        </div>
      ) : null}
      {modo === "admin" ? (
        <Boton variante="secundario" onClick={() => setAlta({ usuario: "", fecha: hoyEnSim(), valores: valoresJornada() })}><Plus className="h-4 w-4" aria-hidden />Cargar una jornada ya realizada</Boton>
      ) : null}
      {error ? <Aviso tipo="error">{error}</Aviso> : null}
      {lista === null ? <Cargando /> : lista.length === 0 ? <p className="py-6 text-sm text-white/60">No hay jornadas.</p> : (
        <ul className="space-y-2">{lista.map((j) => <FilaJornada key={j.id} j={j} href={`${baseJornada}${j.id}`} conUsuario={modo === "admin"} />)}</ul>
      )}
      {alta && catalogo ? (
        <Panel titulo="Cargar jornada realizada" onCerrar={() => setAlta(null)} pie={<Boton variante="primario" className="w-full" cargando={trabajando} disabled={!alta.usuario || !alta.fecha} onClick={() => void crear()}>Cargar jornada</Boton>}>
          <div className="space-y-4">
            <Aviso tipo="info">Para registrar visitas que un comercial hizo sin abrir jornada. Queda cerrada y marcada como cargada por Administración.</Aviso>
            <Selector etiqueta="Comercial" valor={alta.usuario} onCambio={(v) => setAlta({ ...alta, usuario: v })} vacio="Elegí" opciones={(catalogo.usuarios ?? []).map((u) => ({ valor: u.id, texto: u.nombre }))} />
            <label className="block space-y-1.5 text-sm font-semibold text-white/80">Fecha<input type="date" max={hoyEnSim()} className={INPUT} value={alta.fecha} onChange={(e) => setAlta({ ...alta, fecha: e.target.value })} /></label>
            <CamposJornada valores={alta.valores} onCambio={(v) => setAlta({ ...alta, valores: v })} catalogo={catalogo} />
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

export function DetalleJornada({ modo, apiBase, id, baseNegocio }: { modo: "comercial" | "admin"; apiBase: string; id: string; baseNegocio: string }) {
  const [datos, setDatos] = useState<{ jornada: JornadaDto; visitas: VisitaDto[] } | null>(null);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [valores, setValores] = useState<ValoresJornada | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "exito" | "error" | "alerta"; texto: string } | null>(null);
  const [cerrar, setCerrar] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vivo = true;
    Promise.all([pedir<{ jornada: JornadaDto; visitas: VisitaDto[] }>(`${apiBase}/jornadas/${id}`), pedir<Catalogo>(`${apiBase}/catalogo`)]).then(([d, c]) => {
      if (!vivo) return;
      if (d.ok) { setDatos(d.data); setValores(valoresJornada(d.data.jornada)); setError(null); } else setError(d.error);
      if (c.ok) setCatalogo(c.data);
    });
    return () => { vivo = false; };
  }, [apiBase, id, recarga]);

  if (error) return <Aviso tipo="error">{error}</Aviso>;
  if (!datos || !catalogo || !valores) return <Cargando />;
  const j = datos.jornada;

  const guardar = async (conCierre: boolean) => {
    setTrabajando(true);
    const r = await enviar(`${apiBase}/jornadas/${id}`, "PATCH", { version: j.version, cambios: datosJornada(valores), cerrar: conCierre });
    setTrabajando(false);
    setCerrar(false);
    if (!r.ok) { setAviso({ tipo: "error", texto: r.error }); return; }
    setAviso({ tipo: "exito", texto: conCierre ? "Jornada cerrada. Lo que falte se puede completar después." : "Datos guardados." });
    setRecarga((n) => n + 1);
  };
  const viejaAbierta = !j.cerrada_en && j.fecha < hoyEnSim();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 id="titulo-pagina" tabIndex={-1} className="text-2xl font-black outline-none">{fechaCorta(j.fecha)} · {j.nombre ?? "Jornada"}</h1>
        <p className="text-sm text-white/60">{[modo === "admin" ? j.usuario.nombre : null, j.zona, `abierta ${hora(j.abierta_en)}`, j.cerrada_en ? `cerrada ${hora(j.cerrada_en)}` : "abierta",
          j.cargada_por_admin ? "cargada por Administración" : null].filter(Boolean).join(" · ")}</p>
        <p className="text-sm text-white/70">Km recorridos: {j.km_recorridos === null ? "pendiente" : j.km_recorridos.toLocaleString("es-AR")} · Combustible: {pesos(j.combustible_importe)}
          {j.combustible_cantidad !== null ? ` (${j.combustible_cantidad.toLocaleString("es-AR")} ${j.combustible_unidad === "m3" ? "m³" : "l"} cargados)` : ""} · Estacionamiento: {pesos(j.estacionamiento_importe)} · Peajes: {pesos(j.peajes_importe)} · Otros: {pesos(j.otros_importe)}</p>
        {j.pendientes.length ? <p className="text-sm text-amber-200">Falta cargar: {j.pendientes.join(", ")}.</p> : null}
      </header>
      {viejaAbierta ? (
        <Aviso tipo="alerta" titulo={`Esta jornada es del ${fechaCorta(j.fecha)} y sigue abierta`}>
          Cerrala para abrir la de hoy. Si no sabés los km finales, dejalos vacíos: quedan pendientes. Sus visitas no se mueven a otra jornada.
        </Aviso>
      ) : null}
      <div aria-live="polite">{aviso ? <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso> : null}</div>
      <section className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <h2 className="text-lg font-black">Kilómetros y gastos</h2>
        <CamposJornada valores={valores} onCambio={setValores} catalogo={catalogo} />
        <div className="flex flex-wrap gap-2">
          <Boton variante="secundario" cargando={trabajando} onClick={() => void guardar(false)}>Guardar datos</Boton>
          {!j.cerrada_en ? <Boton variante="primario" onClick={() => setCerrar(true)}><Lock className="h-4 w-4" aria-hidden />Cerrar jornada</Boton> : null}
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-black">Visitas de esta jornada ({datos.visitas.filter((v) => !v.anulada).length})</h2>
        {datos.visitas.length === 0 ? <p className="text-sm text-white/60">Sin visitas.</p> : (
          <ul className="space-y-3">
            {datos.visitas.map((v) => (
              <ResumenVisita key={v.id} v={v} acciones={<Link href={`${baseNegocio}${v.empresa_id}`} className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-white/70 hover:text-white">Ver negocio</Link>} />
            ))}
          </ul>
        )}
      </section>
      {cerrar ? (
        <Dialogo titulo="Cerrar jornada" onCerrar={() => setCerrar(false)} acciones={
          <>
            <Boton variante="fantasma" onClick={() => setCerrar(false)}>Volver</Boton>
            <Boton variante="primario" cargando={trabajando} onClick={() => void guardar(true)}>Guardar y cerrar</Boton>
          </>}>
          {datosJornada(valores).km_final === null || datosJornada(valores).km_inicial === null
            ? "Faltan kilómetros: la jornada se cierra igual y quedan pendientes para completar después."
            : "Se guardan los datos y se cierra la jornada."}
        </Dialogo>
      ) : null}
    </div>
  );
}
