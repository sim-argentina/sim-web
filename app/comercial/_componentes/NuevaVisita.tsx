"use client";

// Pantalla "Registrar visita" del comercial: toma la jornada activa y el catálogo,
// muestra el formulario y, al guardar, qué quedó registrado (lead, revisita).

import Link from "next/link";
import { useEffect, useState } from "react";
import { CircleCheck } from "lucide-react";
import { Aviso, Cargando } from "@/app/admin/(panel)/interacciones/ui";
import { sumarDias } from "@/lib/agenda";
import { pedir } from "@/components/crm/api";
import { fechaCorta } from "@/components/crm/campos";
import FormularioVisita, { type VisitaGuardada } from "@/components/crm/FormularioVisita";
import type { Catalogo, FichaEmpresaDto, InicioDto } from "@/lib/crmB1";

export default function NuevaVisita({ usuarioId, negocioId }: { usuarioId: string; negocioId: string | null }) {
  const [inicio, setInicio] = useState<InicioDto | null>(null);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [empresa, setEmpresa] = useState<{ id: string; nombre: string } | null | undefined>(negocioId ? undefined : null);
  const [error, setError] = useState<string | null>(null);
  const [guardada, setGuardada] = useState<{ r: VisitaGuardada; empresa: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    Promise.all([
      pedir<InicioDto>("/comercial/api/inicio"),
      pedir<Catalogo>("/comercial/api/catalogo"),
      negocioId ? pedir<FichaEmpresaDto>(`/comercial/api/negocios/${negocioId}`) : Promise.resolve(null),
    ]).then(([i, c, f]) => {
      if (!vivo) return;
      if (i.ok) setInicio(i.data); else setError(i.error);
      if (c.ok) setCatalogo(c.data);
      if (f) setEmpresa(f.ok ? { id: f.data.empresa.id, nombre: f.data.empresa.nombre_comercial } : null);
    });
    return () => { vivo = false; };
  }, [negocioId]);

  if (error) return <Aviso tipo="error">{error}</Aviso>;
  if (!inicio || !catalogo || empresa === undefined) return <Cargando />;
  const j = inicio.jornada_abierta;
  if (!j || j.fecha < sumarDias(inicio.hoy, -1)) {
    return (
      <Aviso tipo="alerta" titulo={j ? "Quedó abierta una jornada anterior" : "No tenés una jornada abierta"}>
        {j ? "Cerrala y abrí la de hoy para registrar visitas." : "Abrí la jornada desde el inicio para registrar visitas."}{" "}
        <Link href="/comercial" className="font-bold underline">Ir al inicio</Link>
      </Aviso>
    );
  }

  if (guardada) {
    const { r } = guardada;
    return (
      <div className="space-y-4">
        <div className="rounded-3xl border border-green-500/40 bg-green-950/25 p-5">
          <p className="flex items-center gap-2 text-xl font-black"><CircleCheck className="h-6 w-6 text-green-400" aria-hidden />Visita guardada</p>
          <p className="mt-1 text-white/80">{guardada.empresa}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-white/80">
            {r.empresa_creada ? <li>Se creó el negocio y quedó asignado a vos.</li> : null}
            {r.contacto_creado ? <li>Se guardó el contacto en la ficha.</li> : null}
            {r.oportunidad?.creada ? <li>Contacto útil: quedó un lead para el seguimiento de Administración ({r.oportunidad.estado === "interesado" ? "interesado" : "contacto conseguido"}).</li> : null}
            {r.oportunidad && !r.oportunidad.creada ? <li>El negocio ya tenía un lead abierto: la visita se sumó a ese seguimiento.</li> : null}
            {r.tarea ? <li>Revisita programada{r.tarea.vence_el ? ` para el ${fechaCorta(r.tarea.vence_el)}` : " (sin fecha)"}.</li> : null}
            {r.repetida ? <li>Este envío ya había llegado: no se duplicó.</li> : null}
          </ul>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => setGuardada(null)} className="min-h-12 rounded-2xl bg-red-600 font-bold text-white hover:bg-red-700">Registrar otra</button>
          <Link href="/comercial" className="flex min-h-12 items-center justify-center rounded-2xl border border-white/15 font-bold">Volver al inicio</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/60">Jornada: <b className="text-white/85">{j.nombre ?? "sin nombre"}</b>{j.zona ? ` · ${j.zona}` : ""}</p>
      <FormularioVisita modo="comercial" apiBase="/comercial/api" catalogo={catalogo} usuarioId={usuarioId} jornada={j} empresaInicial={empresa}
        onGuardada={(r, nombre) => { setGuardada({ r, empresa: nombre }); window.scrollTo({ top: 0 }); }} />
    </div>
  );
}
