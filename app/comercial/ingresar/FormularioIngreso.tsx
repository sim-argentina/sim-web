"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { Aviso, Boton } from "@/app/admin/(panel)/interacciones/ui";

// Formulario de ingreso comercial. Las credenciales viajan solo en el cuerpo de un
// POST (nunca en la URL): el form es method="post" y el botón está deshabilitado
// hasta que hidrata, así no hay envío nativo antes de tiempo. La cookie de sesión
// es HttpOnly: este componente nunca ve el token.

const INPUT =
  "w-full min-h-12 rounded-xl border border-white/15 bg-black px-4 py-3 text-base text-white outline-none placeholder:text-white/30 focus:border-red-500";

const sinSuscripcion = () => () => {};

export default function FormularioIngreso({ disponible }: { disponible: boolean }) {
  const router = useRouter();
  // false en el HTML del servidor, true una vez hidratado.
  const listo = useSyncExternalStore(sinSuscripcion, () => true, () => false);
  const [usuario, setUsuario] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [ver, setVer] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // La cookie es SameSite=strict: si se llegó desde otra app (un enlace de
    // WhatsApp, por ejemplo) el servidor no la vio. Acá sí viaja.
    let vivo = true;
    fetch("/comercial/api/sesion", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { actor?: { tipo?: string } } | null) => {
        if (vivo && d?.actor?.tipo === "comercial") router.replace("/comercial");
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [router]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (cargando) return;
    setCargando(true);
    setError(null);
    try {
      const res = await fetch("/comercial/api/ingresar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, contrasena }),
        cache: "no-store",
      });
      if (res.ok) {
        setContrasena("");
        router.replace("/comercial");
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "No se pudo ingresar.");
    } catch {
      setError("No se pudo conectar con el servidor.");
    }
    setCargando(false);
  }

  if (!disponible) {
    return (
      <Aviso tipo="alerta" titulo="Acceso comercial no disponible">
        El ingreso todavía no está configurado. Avisale a la administración.
      </Aviso>
    );
  }

  return (
    <form method="post" action="/comercial/api/ingresar" onSubmit={enviar} className="space-y-5" noValidate>
      <div className="space-y-2">
        <label htmlFor="crm-usuario" className="block text-sm font-semibold text-white/80">Usuario</label>
        <input
          id="crm-usuario"
          name="usuario"
          type="text"
          inputMode="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          maxLength={64}
          value={usuario}
          onChange={(e) => setUsuario(e.target.value)}
          className={INPUT}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="crm-contrasena" className="block text-sm font-semibold text-white/80">Contraseña</label>
        <div className="relative">
          <input
            id="crm-contrasena"
            name="contrasena"
            type={ver ? "text" : "password"}
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            maxLength={128}
            value={contrasena}
            onChange={(e) => setContrasena(e.target.value)}
            className={`${INPUT} pr-14`}
          />
          <button
            type="button"
            onClick={() => setVer((v) => !v)}
            aria-label={ver ? "Ocultar contraseña" : "Mostrar contraseña"}
            aria-pressed={ver}
            className="absolute inset-y-0 right-0 inline-flex w-12 items-center justify-center rounded-r-xl text-white/60 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400"
          >
            {ver ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
          </button>
        </div>
      </div>
      <div aria-live="polite">{error ? <Aviso tipo="error">{error}</Aviso> : null}</div>
      <Boton
        type="submit"
        variante="primario"
        cargando={cargando}
        disabled={!listo || usuario.trim() === "" || contrasena === ""}
        className="min-h-12 w-full text-base"
      >
        <LogIn className="h-4 w-4" aria-hidden />
        Ingresar
      </Boton>
    </form>
  );
}
