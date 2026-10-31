"use client";

// Inicio del comercial (CRM B1): jornada activa (o abrir una), botón grande para
// registrar una visita, visitas de hoy, revisitas pendientes y accesos a sus
// negocios y jornadas. Si quedó abierta una jornada de otro día, se ofrece
// resolverla (cerrarla sin inventar kilómetros); no se cierra sola.

import Link from "next/link";
import { useEffect, useState } from "react";
import { Briefcase, CalendarClock, MapPinned, Plus, Route } from "lucide-react";
import { Aviso, Boton, Cargando, Etiqueta } from "@/app/admin/(panel)/interacciones/ui";
import { sumarDias } from "@/lib/agenda";
import { enviar, pedir } from "@/components/crm/api";
import { CamposJornada, ResumenVisita, datosJornada, fechaCorta, valoresJornada, type ValoresJornada } from "@/components/crm/campos";
import type { Catalogo, InicioDto } from "@/lib/crmB1";

export default function Inicio() {
  const [inicio, setInicio] = useState<InicioDto | null>(null);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abrir, setAbrir] = useState<ValoresJornada | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vivo = true;
    Promise.all([pedir<InicioDto>("/comercial/api/inicio"), pedir<Catalogo>("/comercial/api/catalogo")]).then(([i, c]) => {
      if (!vivo) return;
      if (i.ok) { setInicio(i.data); setError(null); } else setError(i.error);
      if (c.ok) setCatalogo(c.data);
    });
    return () => { vivo = false; };
  }, [recarga]);

  if (error) return <Aviso tipo="error">{error}</Aviso>;
  if (!inicio || !catalogo) return <Cargando />;
  const j = inicio.jornada_abierta;
  // De ayer: puede ser la misma salida que cruzó la medianoche (se puede seguir, con aviso).
  // Más vieja: hay que resolverla antes (la base no acepta visitas de hoy en ella).
  const deOtroDia = !!j && j.fecha < inicio.hoy;
  const vieja = !!j && j.fecha < sumarDias(inicio.hoy, -1);

  const abrirJornada = async () => {
    if (!abrir) return;
    setTrabajando(true);
    const d = datosJornada(abrir);
    const r = await enviar("/comercial/api/jornadas", "POST", { datos: { nombre: d.nombre, zona_id: d.zona_id, km_inicial: d.km_inicial } });
    setTrabajando(false);
    if (!r.ok) { setError(r.error); return; }
    setAbrir(null);
    setRecarga((n) => n + 1);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
        {j ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold uppercase tracking-wide text-white/60">Jornada activa</p>
              <Etiqueta tono={deOtroDia ? "ambar" : "verde"}>{deOtroDia ? `Del ${fechaCorta(j.fecha)}` : "Hoy"}</Etiqueta>
            </div>
            <p className="text-lg font-black">{j.nombre ?? "Jornada sin nombre"}{j.zona ? <span className="font-normal text-white/60"> · {j.zona}</span> : null}</p>
            <p className="text-sm text-white/60">{j.visitas} visita{j.visitas === 1 ? "" : "s"} · km iniciales {j.km_inicial === null ? "sin cargar" : j.km_inicial.toLocaleString("es-AR")}</p>
            {vieja ? <Aviso tipo="alerta">Quedó abierta la jornada del {fechaCorta(j.fecha)}. Cerrala antes de registrar las visitas de hoy (los km que no sepas quedan pendientes; sus visitas no se mueven).</Aviso>
              : deOtroDia ? <Aviso tipo="alerta">Esta jornada empezó ayer. Si es la misma salida, podés seguir registrando; si no, cerrala y abrí la de hoy.</Aviso> : null}
            <Link href={`/comercial/jornadas/${j.id}`} className="inline-flex min-h-11 items-center rounded-xl border border-white/15 px-4 text-sm font-bold text-white/85 hover:border-white/40">
              {deOtroDia ? "Resolver jornada anterior" : "Km, gastos y cierre"}
            </Link>
          </div>
        ) : abrir ? (
          <div className="space-y-4">
            <p className="text-lg font-black">Abrir jornada</p>
            <CamposJornada valores={abrir} onCambio={setAbrir} catalogo={catalogo} conKmFinal={false} />
            <div className="flex gap-2">
              <Boton variante="primario" cargando={trabajando} onClick={() => void abrirJornada()}>Abrir jornada</Boton>
              <Boton variante="fantasma" onClick={() => setAbrir(null)}>Cancelar</Boton>
            </div>
            <p className="text-xs text-white/50">Todo es opcional: los km y los gastos se pueden cargar después.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="font-bold">No tenés una jornada abierta.</p>
            <Boton variante="primario" className="w-full min-h-12 text-base" onClick={() => setAbrir(valoresJornada())}><Route className="h-5 w-5" aria-hidden />Abrir jornada</Boton>
          </div>
        )}
      </section>

      {j && !vieja ? (
        <Link href="/comercial/visitas/nueva" className="flex min-h-16 w-full items-center justify-center gap-2 rounded-3xl bg-red-600 text-xl font-black text-white shadow-lg hover:bg-red-700">
          <Plus className="h-6 w-6" aria-hidden />Registrar visita
        </Link>
      ) : (
        <p className="rounded-3xl border border-dashed border-white/15 p-4 text-center text-sm text-white/60">
          <b>+ Registrar visita</b> se habilita con una jornada de hoy abierta.
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-black">Revisitas pendientes ({inicio.revisitas.length})</h2>
        {inicio.revisitas.length === 0 ? <p className="text-sm text-white/60">No tenés revisitas pendientes.</p> : (
          <ul className="space-y-2">
            {inicio.revisitas.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 rounded-2xl border border-white/10 p-3">
                <Link href={`/comercial/negocios/${t.empresa_id}`} className="min-w-0">
                  <p className="truncate font-bold">{t.empresa}</p>
                  <p className="text-xs text-white/60"><CalendarClock className="mr-1 inline h-3.5 w-3.5" aria-hidden />{t.vence_el ? fechaCorta(t.vence_el) : "Sin fecha"}{t.vence_el && t.vence_el < inicio.hoy ? " · vencida" : ""}</p>
                </Link>
                {j && !vieja ? <Link href={`/comercial/visitas/nueva?negocio=${t.empresa_id}`} className="shrink-0 rounded-xl border border-white/15 px-3 py-2 text-sm font-bold">Visitar</Link> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-black">Visitas de hoy ({inicio.visitas_hoy.length})</h2>
        {inicio.visitas_hoy.length === 0 ? <p className="text-sm text-white/60">Todavía no registraste visitas hoy.</p> : (
          <ul className="space-y-2">{inicio.visitas_hoy.map((v) => <ResumenVisita key={v.id} v={v} />)}</ul>
        )}
      </section>

      <nav className="grid grid-cols-2 gap-3" aria-label="Accesos">
        <Link href="/comercial/negocios" className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-white/15 font-bold hover:border-white/40">
          <Briefcase className="h-5 w-5" aria-hidden />Mis negocios
        </Link>
        <Link href="/comercial/jornadas" className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-white/15 font-bold hover:border-white/40">
          <MapPinned className="h-5 w-5" aria-hidden />Mis jornadas
        </Link>
      </nav>
      <p className="text-center text-xs text-white/50">{inicio.negocios.asignados} negocio{inicio.negocios.asignados === 1 ? "" : "s"} asignado{inicio.negocios.asignados === 1 ? "" : "s"} · {inicio.negocios.por_visitar} por visitar</p>
    </div>
  );
}
