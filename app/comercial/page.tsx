import Link from "next/link";
import { redirect } from "next/navigation";
import { actorCrmActual } from "@/lib/crmAuth";
import { Aviso } from "@/app/admin/(panel)/interacciones/ui";
import CerrarSesion from "./CerrarSesion";

// Inicio de la interfaz comercial (CRM B0). Protegida en el servidor: sin sesión
// comercial válida (ni admin) vuelve a /comercial/ingresar. Todavía no hay
// funciones del CRM: solo el nombre y el cierre de sesión.

// El template del layout aplica a los segmentos hijos, no a esta página: título completo.
export const metadata = { title: { absolute: "Inicio · CRM comercial | SIM Argentina" } };

export default async function ComercialInicio() {
  const r = await actorCrmActual();
  if (r.estado === "no_autenticado" || r.estado === "denegado") redirect("/comercial/ingresar");

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-8">
      <p className="text-xs font-bold tracking-[0.3em] text-red-500">SIM ARGENTINA · CRM COMERCIAL</p>
      {r.estado === "no_disponible" ? (
        <div className="mt-6">
          <Aviso tipo="error" titulo="No se pudo verificar la sesión">
            Probá de nuevo en un momento. Si sigue pasando, avisale a la administración.
          </Aviso>
        </div>
      ) : (
        <>
          <h1 id="titulo-pagina" tabIndex={-1} className="mt-3 text-3xl font-black leading-tight outline-none">
            Hola, {r.actor.nombre}
          </h1>
          <div className="mt-6 space-y-4">
            <Aviso tipo="info" titulo="El CRM está en preparación">
              {r.actor.tipo === "comercial" ? "Por ahora solo podés ingresar y cerrar sesión. " : ""}
              La carga de visitas y negocios va a estar disponible en una próxima etapa.
            </Aviso>
            {r.actor.tipo === "admin" ? (
              <Aviso tipo="alerta" titulo="Estás con la sesión de Administración">
                Esta pantalla es para los usuarios comerciales. Los usuarios se administran en{" "}
                <Link href="/admin/crm/configuracion" className="font-bold underline underline-offset-2">CRM · Configuración</Link>.
              </Aviso>
            ) : null}
          </div>
          {r.actor.tipo === "comercial" ? (
            <div className="mt-auto pt-10">
              <CerrarSesion />
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
