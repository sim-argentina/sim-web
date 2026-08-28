"use client";

import { useCallback, useEffect, useState } from "react";
import { Star } from "lucide-react";

type Empleado = {
  id: string;
  nombre_formal: string;
  activo: boolean;
  es_fallback: boolean;
  empleado_aliases: Array<{ id: string; alias: string; alias_normalizado: string }>;
};

type Props = { role: string };

// Convierte el texto de alias (separado por comas) en array para la API.
function parseAliases(texto: string): string[] {
  return texto
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
}

function aliasesTexto(e: Empleado): string {
  return e.empleado_aliases.map((a) => a.alias).join(", ");
}

export default function CronogramaClient({ role }: Props) {
  const esAdmin = role === "admin";

  const [activos, setActivos] = useState<Empleado[]>([]);
  const [archivados, setArchivados] = useState<Empleado[]>([]);
  const [loading, setLoading] = useState(true);
  const [verArchivados, setVerArchivados] = useState(false);

  // Alta (solo admin).
  const [nombre, setNombre] = useState("");
  const [aliases, setAliases] = useState("");
  const [creando, setCreando] = useState(false);

  // Edición inline (solo admin).
  const [editId, setEditId] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState("");
  const [editAliases, setEditAliases] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setLoading(true);
      const url = esAdmin ? "/api/admin/empleados?archivados=1" : "/api/admin/empleados";
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Error cargando integrantes");
        return;
      }
      setActivos(data.empleados || []);
      setArchivados(data.archivados || []);
    } catch {
      alert("Error cargando integrantes");
    } finally {
      setLoading(false);
    }
  }, [esAdmin]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) {
      alert("Ingresá el nombre del integrante.");
      return;
    }
    const listaAlias = parseAliases(aliases);
    if (listaAlias.length === 0) listaAlias.push(nombre.trim()); // por defecto, el nombre
    setCreando(true);
    try {
      const res = await fetch("/api/admin/empleados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombre.trim(), aliases: listaAlias }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Error creando integrante");
        return;
      }
      setNombre("");
      setAliases("");
      await cargar();
    } catch {
      alert("Error creando integrante");
    } finally {
      setCreando(false);
    }
  }

  function abrirEdicion(e: Empleado) {
    setEditId(e.id);
    setEditNombre(e.nombre_formal);
    setEditAliases(aliasesTexto(e));
  }

  function cancelarEdicion() {
    setEditId(null);
    setEditNombre("");
    setEditAliases("");
  }

  async function guardarEdicion(id: string) {
    if (!editNombre.trim()) {
      alert("El nombre no puede quedar vacío.");
      return;
    }
    const listaAlias = parseAliases(editAliases);
    if (listaAlias.length === 0) listaAlias.push(editNombre.trim());
    setGuardando(true);
    try {
      const res = await fetch(`/api/admin/empleados/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "editar", nombre: editNombre.trim(), aliases: listaAlias }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Error guardando cambios");
        return;
      }
      cancelarEdicion();
      await cargar();
    } catch {
      alert("Error guardando cambios");
    } finally {
      setGuardando(false);
    }
  }

  async function archivar(e: Empleado) {
    if (!confirm(`¿Archivar a ${e.nombre_formal}?\n\nSeguirá disponible en el histórico y podés reactivarlo cuando quieras.`)) return;
    const res = await fetch(`/api/admin/empleados/${e.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "archivar" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || "Error archivando integrante");
      return;
    }
    await cargar();
  }

  async function reactivar(e: Empleado) {
    const res = await fetch(`/api/admin/empleados/${e.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "reactivar" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || "Error reactivando integrante");
      return;
    }
    await cargar();
  }

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white md:px-6">
      <section className="mx-auto max-w-5xl">
        <div className="mb-6">
          <p className="mb-2 text-xs uppercase tracking-[0.3em] text-red-500">Cronograma</p>
          <h1 className="text-3xl font-black uppercase md:text-5xl">Equipo</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/60">
            Integrantes del equipo y sus alias. {esAdmin
              ? "Podés dar de alta, editar, archivar y reactivar integrantes."
              : "Vista de solo lectura."}
          </p>
        </div>

        {esAdmin && (
          <form onSubmit={crear} className="mb-6 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="mb-4 text-xl font-black uppercase text-red-500">Nuevo integrante</h2>
            <div className="grid gap-3 md:grid-cols-[1fr_1.4fr_auto]">
              <Campo label="Nombre">
                <input
                  value={nombre}
                  onChange={(ev) => setNombre(ev.target.value)}
                  placeholder="Ej. Martín"
                  maxLength={80}
                  className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-red-500"
                />
              </Campo>
              <Campo label="Alias (separados por coma)">
                <input
                  value={aliases}
                  onChange={(ev) => setAliases(ev.target.value)}
                  placeholder="Martín, Tincho"
                  className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-red-500"
                />
              </Campo>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={creando}
                  className="w-full rounded-xl bg-red-600 px-4 py-2 text-sm font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30"
                >
                  {creando ? "Creando..." : "Agregar"}
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs text-white/40">
              Si dejás los alias vacíos, se usa el nombre. Los alias sirven para reconocer al integrante (por ejemplo, en cronogramas).
            </p>
          </form>
        )}

        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="mb-4 text-xl font-black uppercase text-red-500">Integrantes activos</h2>

          {loading ? (
            <p className="text-white/60">Cargando...</p>
          ) : activos.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black p-5">
              <p className="text-white/60">Todavía no hay integrantes activos.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {activos.map((e) =>
                esAdmin && editId === e.id ? (
                  <EdicionRow
                    key={e.id}
                    nombre={editNombre}
                    aliases={editAliases}
                    guardando={guardando}
                    onNombre={setEditNombre}
                    onAliases={setEditAliases}
                    onGuardar={() => guardarEdicion(e.id)}
                    onCancelar={cancelarEdicion}
                  />
                ) : (
                  <div
                    key={e.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black px-4 py-3 text-sm"
                  >
                    <div className="min-w-[200px]">
                      <p className="flex items-center gap-2 font-black text-white">
                        {e.nombre_formal}
                        {e.es_fallback && (
                          <span
                            title="Integrante predeterminado (se le asignan los horarios no cubiertos)"
                            className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-400"
                          >
                            <Star className="h-3 w-3" /> Predeterminado
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-white/50">
                        Alias: <span className="text-white/70">{aliasesTexto(e)}</span>
                      </p>
                    </div>

                    {esAdmin && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => abrirEdicion(e)}
                          className="rounded-xl border border-white/15 px-3 py-2 text-xs font-black uppercase text-white/70 transition hover:bg-white/10"
                        >
                          Editar
                        </button>
                        {!e.es_fallback && (
                          <button
                            type="button"
                            onClick={() => archivar(e)}
                            className="rounded-xl border border-red-500/40 px-3 py-2 text-xs font-black uppercase text-red-400 transition hover:bg-red-600 hover:text-white"
                          >
                            Archivar
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ),
              )}
            </div>
          )}
        </div>

        {/* Archivados: solo admin. */}
        {esAdmin && (
          <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-xl font-black uppercase text-red-500">Archivados</h2>
              <button
                type="button"
                onClick={() => setVerArchivados((v) => !v)}
                className="rounded-xl border border-white/15 px-3 py-2 text-xs font-black uppercase text-white/70 transition hover:bg-white/10"
              >
                {verArchivados ? "Ocultar" : `Ver (${archivados.length})`}
              </button>
            </div>

            {verArchivados &&
              (archivados.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-black p-5">
                  <p className="text-white/60">No hay integrantes archivados.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {archivados.map((e) => (
                    <div
                      key={e.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 text-sm opacity-70"
                    >
                      <div className="min-w-[200px]">
                        <p className="font-black text-white/80">{e.nombre_formal}</p>
                        <p className="mt-0.5 text-xs text-white/40">Alias: {aliasesTexto(e)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => reactivar(e)}
                        className="rounded-xl border border-green-500/40 px-3 py-2 text-xs font-black uppercase text-green-400 transition hover:bg-green-600 hover:text-white"
                      >
                        Reactivar
                      </button>
                    </div>
                  ))}
                </div>
              ))}
          </div>
        )}
      </section>
    </main>
  );
}

function EdicionRow({
  nombre,
  aliases,
  guardando,
  onNombre,
  onAliases,
  onGuardar,
  onCancelar,
}: {
  nombre: string;
  aliases: string;
  guardando: boolean;
  onNombre: (v: string) => void;
  onAliases: (v: string) => void;
  onGuardar: () => void;
  onCancelar: () => void;
}) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-black px-4 py-3">
      <div className="grid gap-3 md:grid-cols-[1fr_1.4fr_auto]">
        <Campo label="Nombre">
          <input
            value={nombre}
            onChange={(e) => onNombre(e.target.value)}
            maxLength={80}
            className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
          />
        </Campo>
        <Campo label="Alias (separados por coma)">
          <input
            value={aliases}
            onChange={(e) => onAliases(e.target.value)}
            className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
          />
        </Campo>
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={onGuardar}
            disabled={guardando}
            className="rounded-xl bg-red-600 px-4 py-2 text-xs font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30"
          >
            {guardando ? "..." : "Guardar"}
          </button>
          <button
            type="button"
            onClick={onCancelar}
            className="rounded-xl border border-white/15 px-3 py-2 text-xs font-black uppercase text-white/70 transition hover:bg-white/10"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">{label}</label>
      {children}
    </div>
  );
}
