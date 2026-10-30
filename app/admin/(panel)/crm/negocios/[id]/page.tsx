import Link from "next/link";
import FichaNegocioAdmin from "./FichaNegocioAdmin";

// CRM · Ficha de negocio (B1): datos, asignación, contactos, lead, revisita y visitas
// (corrección y anulación con motivo; registro de una visita realizada por un comercial)
// y, solo acá, las compras y la recompra (B3).
export default async function CrmNegocioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <Link href="/admin/crm/negocios" className="mb-3 inline-flex min-h-11 items-center text-sm font-semibold text-white/70 hover:text-white">← Negocios</Link>
      <FichaNegocioAdmin id={id} />
    </>
  );
}
