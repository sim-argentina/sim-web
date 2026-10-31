import { redirect } from "next/navigation";
import { actorCrmActual } from "@/lib/crmAuth";
import { Aviso } from "@/app/admin/(panel)/interacciones/ui";
import CerrarSesion from "./CerrarSesion";
import Inicio from "./_componentes/Inicio";

// Inicio de la interfaz comercial (CRM). Protegido en el servidor: sin sesión
// comercial válida (ni admin) vuelve a /comercial/ingresar. El comercial ve su
// jornada, el botón para registrar visitas, sus revisitas y sus visitas de hoy.

// El template del layout aplica a los segmentos hijos, no a esta página: título completo.
export const metadata = { title: { absolute: "Inicio · CRM comercial | SIM Argentina" } };

export default async function ComercialInicio() {
  const r = await actorCrmActual();
  if (r.estado === "no_autenticado" || r.estado === "denegado") redirect("/comercial/ingresar");

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-6">
      <p className="text-xs font-bold tracking-[0.3em] text-red-500">SIM ARGENTINA · CRM COMERCIAL</p>
      {r.estado === "no_disponible" ? (
        <div className="mt-6">
          <Aviso tipo="error" titulo="No se pudo verificar la sesión">
            Probá de nuevo en un momento. Si sigue pasando, avisale a la administración.
          </Aviso>
        </div>
      ) : (
        <>
          <h1 id="titulo-pagina" tabIndex={-1} className="mt-2 mb-5 text-2xl font-black leading-tight outline-none">
            Hola, {r.actor.nombre}
          </h1>
          {r.actor.tipo === "comercial" ? (
            <Inicio />
          ) : (
            <Aviso tipo="alerta" titulo="Estás con la sesión de Administración">
              Esta pantalla es para los usuarios comerciales. El CRM se administra en{" "}
              {/* <a> y no <Link>: salir del área comercial es una navegación de documento completo. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/admin/crm/negocios" className="font-bold underline underline-offset-2">CRM · Negocios</a>.
            </Aviso>
          )}
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
