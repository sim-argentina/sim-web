import { redirect } from "next/navigation";
import { actorCrmActual } from "@/lib/crmAuth";
import { sesionComercialConfigurada } from "@/lib/crmSesion";
import FormularioIngreso from "./FormularioIngreso";

// Ingreso de usuarios comerciales (CRM B0). Público: es el login. Si el navegador
// ya tiene una sesión comercial válida, va directo al inicio.

export const metadata = { title: "Ingresar" };

export default async function IngresarComercial() {
  const r = await actorCrmActual();
  if (r.estado === "ok" && r.actor.tipo === "comercial") redirect("/comercial");

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-center px-4 py-10">
      <p className="text-xs font-bold tracking-[0.3em] text-red-500">SIM ARGENTINA · CRM COMERCIAL</p>
      <h1 className="mt-3 text-3xl font-black">Ingresar</h1>
      <p className="mt-2 text-sm text-white/60">Con el usuario y la contraseña que te dio la administración.</p>
      <div className="mt-8">
        <FormularioIngreso disponible={sesionComercialConfigurada()} />
      </div>
    </main>
  );
}
