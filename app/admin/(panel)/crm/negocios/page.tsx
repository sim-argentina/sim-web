import ListaNegocios from "@/components/crm/ListaNegocios";

// CRM · Negocios (B1): todos, con búsqueda, filtros, alta y asignación.
export default function CrmNegociosPage() {
  return (
    <>
      <h1 id="titulo-pagina" tabIndex={-1} className="mb-4 text-3xl font-black outline-none">Negocios</h1>
      <ListaNegocios modo="admin" apiBase="/api/admin/crm" baseNegocio="/admin/crm/negocios/" />
    </>
  );
}
