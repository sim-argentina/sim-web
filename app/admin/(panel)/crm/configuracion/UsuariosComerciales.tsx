"use client";

// Usuarios comerciales del CRM (B0): alta, restablecimiento de contraseña,
// desactivación, reactivación y revocación de sesiones. La API decide todo; esta
// pantalla solo muestra lo que devuelve (DTO sin hash, sal ni tokens).
//
// La contraseña la define la administración. "Generar" arma una al azar EN ESTE
// NAVEGADOR (crypto.getRandomValues) para copiarla y pasársela a la persona: el
// servidor guarda solo su hash y nunca la devuelve.

import { useEffect, useState } from "react";
import { Copy, KeyRound, RefreshCw, UserPlus } from "lucide-react";
import { Aviso, Boton, Cargando, Dialogo, Etiqueta } from "../../interacciones/ui";
import { CONTRASENA_MIN, type AccionUsuario, type UsuarioComercialDto } from "@/lib/crmUsuarios";

const INPUT =
  "w-full min-h-11 rounded-xl border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-red-500";
const FECHA = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Cordoba", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const fecha = (iso: string | null) => (iso ? FECHA.format(new Date(iso)) : "—");

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
function generarContrasena(largo = 16): string {
  const bytes = new Uint32Array(largo);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join("");
}

type Pendiente = { usuario: UsuarioComercialDto; accion: Exclude<AccionUsuario, "restablecer"> } | null;

const TEXTO_ACCION: Record<Exclude<AccionUsuario, "restablecer">, { titulo: string; boton: string; detalle: string }> = {
  desactivar: {
    titulo: "Desactivar usuario",
    boton: "Desactivar",
    detalle: "No va a poder ingresar y sus sesiones abiertas se cierran ahora. Su historial se conserva.",
  },
  reactivar: {
    titulo: "Reactivar usuario",
    boton: "Reactivar",
    detalle: "Va a poder ingresar otra vez con su contraseña. Las sesiones anteriores a la desactivación siguen cerradas.",
  },
  revocar: {
    titulo: "Cerrar sus sesiones",
    boton: "Cerrar sesiones",
    detalle: "Se cierran todas sus sesiones abiertas en cualquier dispositivo. La contraseña no cambia.",
  },
};

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
    const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok) return { ok: false, error: data?.error ?? "No se pudo completar la acción." };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "No se pudo conectar con el servidor." };
  }
}

function CampoContrasena({ id, valor, onCambio, generada, onGenerar }: {
  id: string; valor: string; onCambio: (v: string) => void; generada: boolean; onGenerar: () => void;
}) {
  const [copiada, setCopiada] = useState(false);
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-semibold text-white/80">Contraseña</label>
      <div className="flex flex-wrap gap-2">
        <input
          id={id}
          type={generada ? "text" : "password"}
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={128}
          value={valor}
          onChange={(e) => onCambio(e.target.value)}
          className={`${INPUT} min-w-0 flex-1 font-mono`}
        />
        <Boton variante="secundario" onClick={() => { onGenerar(); setCopiada(false); }}>
          <RefreshCw className="h-4 w-4" aria-hidden />
          Generar
        </Boton>
        {generada && valor ? (
          <Boton
            variante="secundario"
            onClick={() => navigator.clipboard?.writeText(valor).then(() => setCopiada(true)).catch(() => {})}
          >
            <Copy className="h-4 w-4" aria-hidden />
            {copiada ? "Copiada" : "Copiar"}
          </Boton>
        ) : null}
      </div>
      <p className="text-xs text-white/50">
        Al menos {CONTRASENA_MIN} caracteres, sin el nombre de usuario. Pasásela a la persona por un medio privado: después de guardar no se vuelve a mostrar.
      </p>
    </div>
  );
}

export default function UsuariosComerciales() {
  const [usuarios, setUsuarios] = useState<UsuarioComercialDto[] | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "exito" | "error"; texto: string } | null>(null);

  const [nombre, setNombre] = useState("");
  const [usuario, setUsuario] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [generada, setGenerada] = useState(false);
  const [creando, setCreando] = useState(false);

  const [pendiente, setPendiente] = useState<Pendiente>(null);
  const [restablecer, setRestablecer] = useState<UsuarioComercialDto | null>(null);
  const [nueva, setNueva] = useState("");
  const [nuevaGenerada, setNuevaGenerada] = useState(false);
  const [trabajando, setTrabajando] = useState(false);

  const [intento, setIntento] = useState(0);
  useEffect(() => {
    let vivo = true;
    api<{ usuarios: UsuarioComercialDto[] }>("/api/admin/crm/usuarios").then((r) => {
      if (!vivo) return;
      if (r.ok) {
        setUsuarios(r.data.usuarios);
        setErrorCarga(null);
      } else {
        setErrorCarga(r.error);
      }
    });
    return () => {
      vivo = false;
    };
  }, [intento]);

  function reemplazar(u: UsuarioComercialDto) {
    setUsuarios((lista) => (lista ?? []).map((x) => (x.id === u.id ? u : x)));
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setCreando(true);
    setAviso(null);
    const r = await api<{ usuario: UsuarioComercialDto }>("/api/admin/crm/usuarios", {
      method: "POST",
      body: JSON.stringify({ nombre, usuario, contrasena }),
    });
    setCreando(false);
    if (!r.ok) {
      setAviso({ tipo: "error", texto: r.error });
      return;
    }
    setUsuarios((lista) => [r.data.usuario, ...(lista ?? [])]);
    setNombre("");
    setUsuario("");
    setContrasena("");
    setGenerada(false);
    setAviso({ tipo: "exito", texto: `Usuario «${r.data.usuario.usuario}» creado. Ya puede ingresar en /comercial/ingresar.` });
  }

  async function ejecutar(accion: AccionUsuario, u: UsuarioComercialDto, contrasenaNueva?: string) {
    setTrabajando(true);
    setAviso(null);
    const r = await api<{ usuario: UsuarioComercialDto }>(`/api/admin/crm/usuarios/${u.id}`, {
      method: "PATCH",
      body: JSON.stringify(accion === "restablecer" ? { accion, contrasena: contrasenaNueva } : { accion }),
    });
    setTrabajando(false);
    if (!r.ok) {
      setAviso({ tipo: "error", texto: r.error });
      return false;
    }
    reemplazar(r.data.usuario);
    const textos: Record<AccionUsuario, string> = {
      restablecer: "Contraseña restablecida. Sus sesiones anteriores quedaron cerradas.",
      desactivar: "Usuario desactivado. Sus sesiones quedaron cerradas.",
      reactivar: "Usuario reactivado. Puede volver a ingresar con su contraseña.",
      revocar: "Sesiones cerradas en todos sus dispositivos.",
    };
    setAviso({ tipo: "exito", texto: `${u.nombre}: ${textos[accion]}` });
    return true;
  }

  return (
    <div>
      <h1 id="titulo-pagina" tabIndex={-1} className="mt-2 text-3xl font-black outline-none">Usuarios comerciales</h1>
      <p className="mt-2 max-w-3xl text-sm text-white/60">
        Cada usuario ingresa con su propio usuario y contraseña en <span className="font-mono text-white/80">/comercial/ingresar</span>.
        No tiene acceso al panel. Lo que se hace desde esta pantalla queda registrado como «Administración»: la sesión del panel es compartida y no identifica a una persona.
      </p>

      <div className="mt-6 space-y-4" aria-live="polite">
        {aviso ? <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso> : null}
      </div>

      <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.02] p-4 md:p-6" aria-labelledby="titulo-nuevo">
        <h2 id="titulo-nuevo" className="flex items-center gap-2 text-lg font-black">
          <UserPlus className="h-5 w-5 text-red-500" aria-hidden />
          Nuevo usuario
        </h2>
        <form onSubmit={crear} className="mt-4 grid gap-4 md:grid-cols-2" noValidate>
          <div className="space-y-2">
            <label htmlFor="crm-nombre" className="block text-sm font-semibold text-white/80">Nombre</label>
            <input id="crm-nombre" type="text" autoComplete="off" maxLength={80} value={nombre}
              onChange={(e) => setNombre(e.target.value)} className={INPUT} />
          </div>
          <div className="space-y-2">
            <label htmlFor="crm-usuario-nuevo" className="block text-sm font-semibold text-white/80">Usuario</label>
            <input id="crm-usuario-nuevo" type="text" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              maxLength={40} value={usuario} onChange={(e) => setUsuario(e.target.value.toLowerCase())} className={`${INPUT} font-mono`} />
            <p className="text-xs text-white/50">De 3 a 40 caracteres: minúsculas, números, punto, guion o guion bajo.</p>
          </div>
          <div className="md:col-span-2">
            <CampoContrasena id="crm-contrasena-nueva" valor={contrasena} generada={generada}
              onCambio={(v) => { setContrasena(v); setGenerada(false); }}
              onGenerar={() => { setContrasena(generarContrasena()); setGenerada(true); }} />
          </div>
          <div className="md:col-span-2">
            <Boton type="submit" variante="primario" cargando={creando} disabled={!nombre.trim() || !usuario.trim() || !contrasena}>
              Crear usuario
            </Boton>
          </div>
        </form>
      </section>

      <section className="mt-8" aria-labelledby="titulo-lista">
        <h2 id="titulo-lista" className="text-lg font-black">Usuarios</h2>
        {errorCarga ? (
          <div className="mt-4">
            <Aviso tipo="error" acciones={<Boton onClick={() => setIntento((n) => n + 1)}>Reintentar</Boton>}>{errorCarga}</Aviso>
          </div>
        ) : usuarios === null ? (
          <Cargando />
        ) : usuarios.length === 0 ? (
          <p className="mt-4 text-sm text-white/60">Todavía no hay usuarios comerciales.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {usuarios.map((u) => (
              <li key={u.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold">{u.nombre}</p>
                    <p className="font-mono text-sm text-white/60">{u.usuario}</p>
                  </div>
                  {u.activo ? <Etiqueta tono="verde">Activo</Etiqueta> : <Etiqueta tono="gris">Desactivado</Etiqueta>}
                </div>
                <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-white/60 sm:grid-cols-3">
                  <div><dt className="inline">Último ingreso: </dt><dd className="inline text-white/80">{fecha(u.ultimo_ingreso_en)}</dd></div>
                  <div><dt className="inline">Contraseña desde: </dt><dd className="inline text-white/80">{fecha(u.contrasena_cambiada_en)}</dd></div>
                  <div><dt className="inline">Alta: </dt><dd className="inline text-white/80">{fecha(u.creado_en)}</dd></div>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Boton disabled={trabajando} onClick={() => { setRestablecer(u); setNueva(""); setNuevaGenerada(false); }}>
                    <KeyRound className="h-4 w-4" aria-hidden />
                    Restablecer contraseña
                  </Boton>
                  {u.activo ? (
                    <>
                      <Boton disabled={trabajando} onClick={() => setPendiente({ usuario: u, accion: "revocar" })}>Cerrar sesiones</Boton>
                      <Boton variante="peligro" disabled={trabajando} onClick={() => setPendiente({ usuario: u, accion: "desactivar" })}>Desactivar</Boton>
                    </>
                  ) : (
                    <Boton disabled={trabajando} onClick={() => setPendiente({ usuario: u, accion: "reactivar" })}>Reactivar</Boton>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pendiente ? (
        <Dialogo
          titulo={`${TEXTO_ACCION[pendiente.accion].titulo}: ${pendiente.usuario.nombre}`}
          onCerrar={() => setPendiente(null)}
          acciones={
            <>
              <Boton variante="fantasma" onClick={() => setPendiente(null)}>Volver</Boton>
              <Boton
                variante={pendiente.accion === "desactivar" ? "peligro" : "primario"}
                cargando={trabajando}
                onClick={async () => {
                  const p = pendiente;
                  await ejecutar(p.accion, p.usuario);
                  setPendiente(null);
                }}
              >
                {TEXTO_ACCION[pendiente.accion].boton}
              </Boton>
            </>
          }
        >
          {TEXTO_ACCION[pendiente.accion].detalle}
        </Dialogo>
      ) : null}

      {restablecer ? (
        <Dialogo
          titulo={`Restablecer contraseña: ${restablecer.nombre}`}
          onCerrar={() => setRestablecer(null)}
          acciones={
            <>
              <Boton variante="fantasma" onClick={() => setRestablecer(null)}>Volver</Boton>
              <Boton
                variante="primario"
                cargando={trabajando}
                disabled={!nueva}
                onClick={async () => {
                  const u = restablecer;
                  if (await ejecutar("restablecer", u, nueva)) {
                    setRestablecer(null);
                    setNueva("");
                  }
                }}
              >
                Guardar contraseña
              </Boton>
            </>
          }
        >
          <div className="space-y-3">
            <p>Se cierran todas sus sesiones abiertas. {restablecer.activo ? "" : "El usuario sigue desactivado hasta que lo reactives."}</p>
            <CampoContrasena id="crm-contrasena-restablecer" valor={nueva} generada={nuevaGenerada}
              onCambio={(v) => { setNueva(v); setNuevaGenerada(false); }}
              onGenerar={() => { setNueva(generarContrasena()); setNuevaGenerada(true); }} />
          </div>
        </Dialogo>
      ) : null}
    </div>
  );
}
