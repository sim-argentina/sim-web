"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Aviso, Cargando } from "@/app/admin/(panel)/interacciones/ui";
import { pedir } from "@/components/crm/api";
import AltaNegocio from "@/components/crm/AltaNegocio";
import type { Catalogo } from "@/lib/crmB1";

// Alta de negocio del comercial: al crearlo (o al elegir uno propio parecido) abre su ficha.
export default function NuevoNegocio() {
  const router = useRouter();
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    pedir<Catalogo>("/comercial/api/catalogo").then((r) => { if (!vivo) return; if (r.ok) setCatalogo(r.data); else setError(r.error); });
    return () => { vivo = false; };
  }, []);
  if (error) return <Aviso tipo="error">{error}</Aviso>;
  if (!catalogo) return <Cargando />;
  const abrir = (id: string) => router.push(`/comercial/negocios/${id}`);
  return <AltaNegocio modo="comercial" apiBase="/comercial/api" catalogo={catalogo} onCreado={abrir} onAbrir={abrir} />;
}
