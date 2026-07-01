"use client";

import { useEffect, useMemo, useState } from "react";
import { getTurnoTimerState, useNow, TURNO_BADGE_CLASS } from "@/lib/turnoTimer";

type PagoDetalle = {
  metodo_pago: string;
  monto: number | string;
  posnet_pago?: string;
};

type ClienteSugerido = {
  nombre: string;
  telefono: string;
};

type TurnoStand = {
  id: number;
  nombre?: string;
  telefono?: string;
  fecha: string;
  hora: string;
  hora_estimada_subida?: string;
  hora_subida?: string;
  hora_bajada?: string;
  simuladores?: string[] | string;
  cantidad_personas?: number;
  cantidad_minutos?: number;
  cantidad_turnos?: number;
  total?: number;
  metodo_pago?: string;
  turno_listo?: boolean;
  posnet?: string;
  posnet_pago?: string;
  pagos_detalle?: PagoDetalle[] | string;
  estado?: string;
  observaciones?: string;
};

const SIMULADORES = ["Ferrari", "McLaren", "Red Bull", "Alpine"];
const POSNETS = ["MP", "PayWay"];
const METODOS_PAGO = [
  { value: "qr", label: "QR" },
  { value: "efectivo", label: "Efectivo" },
  { value: "debito", label: "Débito" },
  { value: "credito", label: "Crédito" },
  { value: "transferencia", label: "Transferencia" },
];

function fechaLocalISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function horaActual() {
  const date = new Date();
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

function sumarMinutosAHora(hora: string, minutos: number) {
  if (!hora) return "";

  const [h, m] = hora.split(":").map(Number);
  const date = new Date();

  date.setHours(h, m + minutos, 0, 0);

  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

function normalizarSimuladores(simuladores?: string[] | string) {
  if (Array.isArray(simuladores)) return simuladores;

  if (typeof simuladores === "string") {
    try {
      const parsed = JSON.parse(simuladores);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function normalizarPagos(turno?: TurnoStand | null): PagoDetalle[] {
  if (!turno) return [{ metodo_pago: "qr", monto: "", posnet_pago: "" }];

  if (Array.isArray(turno.pagos_detalle) && turno.pagos_detalle.length > 0) {
    return turno.pagos_detalle.map((pago) => ({
      metodo_pago: pago.metodo_pago || "qr",
      monto: pago.monto ?? "",
      posnet_pago: pago.posnet_pago || "",
    }));
  }

  if (typeof turno.pagos_detalle === "string") {
    try {
      const parsed = JSON.parse(turno.pagos_detalle);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((pago) => ({
          metodo_pago: pago.metodo_pago || "qr",
          monto: pago.monto ?? "",
          posnet_pago: pago.posnet_pago || "",
        }));
      }
    } catch {}
  }

  return [
    {
      metodo_pago: turno.metodo_pago || "qr",
      monto: turno.total || "",
      posnet_pago: turno.posnet_pago || turno.posnet || "",
    },
  ];
}

function metodoUsaPosnet(metodo: string) {
  return metodo === "debito" || metodo === "credito" || metodo === "qr";
}

function limpiarPagosParaGuardar(pagos: PagoDetalle[]) {
  return pagos
    .map((pago) => ({
      metodo_pago: pago.metodo_pago || "qr",
      monto: Number(pago.monto) || 0,
      posnet_pago: metodoUsaPosnet(pago.metodo_pago)
        ? pago.posnet_pago || null
        : null,
    }))
    .filter((pago) => pago.monto > 0);
}

function formatearPago(pago?: string) {
  if (!pago) return "-";
  if (pago === "mixto") return "Mixto";
  if (pago === "qr") return "QR";
  if (pago === "debito") return "Débito";
  if (pago === "credito") return "Crédito";
  if (pago === "efectivo") return "Efectivo";
  if (pago === "transferencia") return "Transferencia";
  if (pago === "gratis") return "Gratis";
  return pago;
}

function formatoDinero(valor: number) {
  return `$${valor.toLocaleString("es-AR")}`;
}

function turnosDeRegistro(turno: TurnoStand) {
  return Number(turno.cantidad_turnos) || 1;
}

function formatearPagosDetalle(turno: TurnoStand) {
  const pagos = normalizarPagos(turno).filter((pago) => Number(pago.monto) > 0);

  if (!pagos.length) return formatearPago(turno.metodo_pago);

  return pagos
    .map(
      (pago) =>
        `${formatearPago(pago.metodo_pago)} ${formatoDinero(Number(pago.monto) || 0)}`,
    )
    .join(" + ");
}

export default function TurneroAdminPage() {
  const [turnos, setTurnos] = useState<TurnoStand[]>([]);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [editando, setEditando] = useState(false);

  const [fecha, setFecha] = useState(fechaLocalISO());
  const [hora, setHora] = useState(horaActual());
  const [horaEstimadaSubida, setHoraEstimadaSubida] = useState("");
  const [horaSubida, setHoraSubida] = useState("");

  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");

  const [clientesSugeridos, setClientesSugeridos] = useState<ClienteSugerido[]>(
    [],
  );
  const [mostrarSugerenciasClientes, setMostrarSugerenciasClientes] =
    useState(false);

  const [simuladores, setSimuladores] = useState<string[]>([]);

  const [cantidadPersonas, setCantidadPersonas] = useState(1);
  const [cantidadMinutos, setCantidadMinutos] = useState(15);
  const [cantidadTurnos, setCantidadTurnos] = useState(1);

  const [pagosDetalle, setPagosDetalle] = useState<PagoDetalle[]>([
    { metodo_pago: "qr", monto: "", posnet_pago: "" },
  ]);
  const [observaciones, setObservaciones] = useState("");
  const [turnoGratis, setTurnoGratis] = useState(false);

  const [turnoEditando, setTurnoEditando] = useState<TurnoStand | null>(null);

  const horaBajada = useMemo(() => {
    return sumarMinutosAHora(horaSubida, cantidadMinutos);
  }, [horaSubida, cantidadMinutos]);

  const totalPagos = useMemo(() => {
    return pagosDetalle.reduce(
      (acc, pago) => acc + (Number(pago.monto) || 0),
      0,
    );
  }, [pagosDetalle]);

  async function buscarClientes(valor: string) {
    const busqueda = valor.trim();

    if (busqueda.length < 2) {
      setClientesSugeridos([]);
      setMostrarSugerenciasClientes(false);
      return;
    }

    try {
      const res = await fetch(`/api/clientes?q=${encodeURIComponent(busqueda)}`);
      const data = await res.json();

      if (!res.ok) {
        console.error(data);
        return;
      }

      setClientesSugeridos(data.clientes || []);
      setMostrarSugerenciasClientes(true);
    } catch (error) {
      console.error("Error buscando clientes:", error);
    }
  }

  function seleccionarCliente(cliente: ClienteSugerido) {
    setNombre(cliente.nombre || "");
    setTelefono(cliente.telefono || "");
    setClientesSugeridos([]);
    setMostrarSugerenciasClientes(false);
  }

  async function cargarTurnos() {
    try {
      const res = await fetch("/api/turnos-stand", { cache: "no-store" });
      const data = await res.json();

      if (!res.ok) {
        console.error(data);
        return;
      }

      setTurnos(data.turnos || []);
    } catch (error) {
      console.error("Error cargando turnos:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargarTurnos();
  }, []);

  const turnosDelDia = useMemo(() => {
    return turnos
      .filter((turno) => turno.fecha === fecha)
      .filter((turno) => turno.estado !== "cancelado")
      .sort((a, b) => (a.hora || "").localeCompare(b.hora || ""));
  }, [turnos, fecha]);

  // Reloj para los temporizadores en vivo (un solo intervalo, se limpia al desmontar).
  const now = useNow();

  const resumenDia = useMemo(() => {
    const porMetodo: Record<string, { cantidad: number; total: number }> = {};
    const porSimulador: Record<string, number> = {};
    const porMinutos: Record<string, number> = {};
    const porPersonas: Record<string, number> = {};
    const porPosnet: Record<string, { cantidad: number; total: number }> = {};
    const porPosnetYMetodo: Record<string, number> = {};

    let totalFacturado = 0;
    let cantidadTurnos = 0;

    turnosDelDia.forEach((turno) => {
      const totalTurno = Number(turno.total || 0);
      const minutos = `${turno.cantidad_minutos || 15} min`;
      const personas = `${turno.cantidad_personas || 1} persona${
        (turno.cantidad_personas || 1) > 1 ? "s" : ""
      }`;
      const simus = normalizarSimuladores(turno.simuladores);
      const pagosTurno = normalizarPagos(turno).filter(
        (pago) => Number(pago.monto) > 0,
      );
      const turnos = turnosDeRegistro(turno);

      cantidadTurnos += turnos;
      totalFacturado += totalTurno;

      if (pagosTurno.length > 0) {
        pagosTurno.forEach((pago) => {
          const metodo = formatearPago(pago.metodo_pago);
          const monto = Number(pago.monto) || 0;
          const posnetTurno = pago.posnet_pago || null;

          porMetodo[metodo] = porMetodo[metodo] || { cantidad: 0, total: 0 };
          porMetodo[metodo].cantidad += 1;
          porMetodo[metodo].total += monto;

          if (posnetTurno && metodoUsaPosnet(pago.metodo_pago)) {
            porPosnet[posnetTurno] = porPosnet[posnetTurno] || {
              cantidad: 0,
              total: 0,
            };
            porPosnet[posnetTurno].cantidad += 1;
            porPosnet[posnetTurno].total += monto;

            const clave = `${posnetTurno} - ${metodo}`;
            porPosnetYMetodo[clave] = (porPosnetYMetodo[clave] || 0) + monto;
          }
        });
      } else {
        const metodo = formatearPago(turno.metodo_pago);
        const posnetTurno = turno.posnet_pago || turno.posnet;

        porMetodo[metodo] = porMetodo[metodo] || { cantidad: 0, total: 0 };
        porMetodo[metodo].cantidad += 1;
        porMetodo[metodo].total += totalTurno;

        if (posnetTurno && metodoUsaPosnet(turno.metodo_pago || "")) {
          porPosnet[posnetTurno] = porPosnet[posnetTurno] || {
            cantidad: 0,
            total: 0,
          };

          porPosnet[posnetTurno].cantidad += 1;
          porPosnet[posnetTurno].total += totalTurno;

          const clave = `${posnetTurno} - ${metodo}`;
          porPosnetYMetodo[clave] = (porPosnetYMetodo[clave] || 0) + totalTurno;
        }
      }

      porMinutos[minutos] = (porMinutos[minutos] || 0) + 1;
      porPersonas[personas] = (porPersonas[personas] || 0) + 1;

      simus.forEach((sim) => {
        porSimulador[sim] = (porSimulador[sim] || 0) + 1;
      });
    });

    return {
      cantidadTurnos,
      totalFacturado,
      porMetodo,
      porSimulador,
      porMinutos,
      porPersonas,
      porPosnet,
      porPosnetYMetodo,
    };
  }, [turnosDelDia]);

  function manejarFlechitas(e: React.KeyboardEvent<HTMLFormElement>) {
    if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(e.key))
      return;

    const target = e.target as HTMLElement;
    if (!target.matches("input, select, textarea, button")) return;

    const form = e.currentTarget;
    const campos = Array.from(
      form.querySelectorAll<HTMLElement>(
        "[data-turnero-cell]:not(:disabled):not([readonly])",
      ),
    );
    const actual = campos.indexOf(target);

    if (actual === -1) return;

    const columnas = 8;
    let siguiente = actual;

    if (e.key === "ArrowRight") siguiente = actual + 1;
    if (e.key === "ArrowLeft") siguiente = actual - 1;
    if (e.key === "ArrowDown") siguiente = actual + columnas;
    if (e.key === "ArrowUp") siguiente = actual - columnas;

    if (siguiente < 0 || siguiente >= campos.length) return;

    e.preventDefault();

    const siguienteCampo = campos[siguiente];
    siguienteCampo.focus();

    if (siguienteCampo instanceof HTMLInputElement) {
      siguienteCampo.select();
    }
  }

  function actualizarPago(
    index: number,
    campo: keyof PagoDetalle,
    valor: string,
  ) {
    setPagosDetalle((actuales) =>
      actuales.map((pago, i) => {
        if (i !== index) return pago;

        const actualizado = { ...pago, [campo]: valor };

        if (campo === "metodo_pago" && !metodoUsaPosnet(valor)) {
          actualizado.posnet_pago = "";
        }

        return actualizado;
      }),
    );
  }

  function agregarPago() {
    setPagosDetalle((actuales) => [
      ...actuales,
      { metodo_pago: "efectivo", monto: "", posnet_pago: "" },
    ]);
  }

  function eliminarPago(index: number) {
    setPagosDetalle((actuales) => {
      if (actuales.length === 1) return actuales;
      return actuales.filter((_, i) => i !== index);
    });
  }

  function toggleSimulador(simulador: string) {
    setSimuladores((actuales) =>
      actuales.includes(simulador)
        ? actuales.filter((s) => s !== simulador)
        : [...actuales, simulador],
    );
  }

  function limpiarFormulario() {
    setHora(horaActual());
    setHoraEstimadaSubida("");
    setHoraSubida("");
    setNombre("");
    setTelefono("");
    setClientesSugeridos([]);
    setMostrarSugerenciasClientes(false);
    setSimuladores([]);
    setCantidadPersonas(1);
    setCantidadMinutos(15);
    setCantidadTurnos(1);
    setPagosDetalle([{ metodo_pago: "qr", monto: "", posnet_pago: "" }]);
    setObservaciones("");
    setTurnoGratis(false);
  }

  function armarPayload() {
    if (turnoGratis) {
      return {
        nombre,
        telefono,
        fecha,
        hora,
        hora_estimada_subida: horaEstimadaSubida,
        hora_subida: horaSubida,
        hora_bajada: horaBajada,
        simuladores,
        cantidad_personas: cantidadPersonas,
        cantidad_minutos: cantidadMinutos,
        cantidad_turnos: cantidadTurnos,
        metodo_pago: "gratis",
        posnet_pago: null,
        pagos_detalle: [],
        total: 0,
        observaciones,
      };
    }
    const pagosLimpios = limpiarPagosParaGuardar(pagosDetalle);
    const primerPago = pagosLimpios[0];
    const totalFinal = pagosLimpios.reduce((acc, pago) => acc + pago.monto, 0);
    const posnets = pagosLimpios
      .map((pago) => pago.posnet_pago)
      .filter(Boolean)
      .join(" + ");

    return {
      nombre,
      telefono,
      fecha,
      hora,
      hora_estimada_subida: horaEstimadaSubida,
      hora_subida: horaSubida,
      hora_bajada: horaBajada,
      simuladores,
      cantidad_personas: cantidadPersonas,
      cantidad_minutos: cantidadMinutos,
      cantidad_turnos: cantidadTurnos,
      metodo_pago:
        pagosLimpios.length > 1 ? "mixto" : primerPago?.metodo_pago || "qr",
      posnet_pago: posnets || null,
      pagos_detalle: pagosLimpios,
      total: totalFinal,
      observaciones,
    };
  }

  async function crearTurno(e: React.FormEvent) {
    e.preventDefault();

    if (!fecha || !hora) {
      alert("Falta fecha u hora de toma.");
      return;
    }

    if (!turnoGratis && totalPagos <= 0) {
      alert("Cargá al menos un pago con monto mayor a 0.");
      return;
    }

    setGuardando(true);

    try {
      const res = await fetch("/api/turnos-stand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(armarPayload()),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Error creando turno.");
        return;
      }

      limpiarFormulario();
      await cargarTurnos();
    } catch (error) {
      console.error(error);
      alert("Error creando turno.");
    } finally {
      setGuardando(false);
    }
  }

  function abrirEdicion(turno: TurnoStand) {
    setTurnoEditando(turno);
    setNombre(turno.nombre || "");
    setTelefono(turno.telefono || "");
    setClientesSugeridos([]);
    setMostrarSugerenciasClientes(false);
    setFecha(turno.fecha);
    setHora(turno.hora || horaActual());
    setHoraEstimadaSubida(turno.hora_estimada_subida || "");
    setHoraSubida(turno.hora_subida || "");
    setSimuladores(normalizarSimuladores(turno.simuladores));
    setCantidadPersonas(turno.cantidad_personas || 1);
    setCantidadMinutos(turno.cantidad_minutos || 15);
    setCantidadTurnos(turno.cantidad_turnos || 1);
    setPagosDetalle(normalizarPagos(turno));
    setObservaciones(turno.observaciones || "");
    setTurnoGratis(turno.metodo_pago === "gratis");
  }

  async function guardarEdicion(e: React.FormEvent) {
    e.preventDefault();

    if (!turnoEditando) return;

    if (!turnoGratis && totalPagos <= 0) {
      alert("Cargá al menos un pago con monto mayor a 0.");
      return;
    }

    setEditando(true);

    try {
      const res = await fetch(`/api/turnos-stand/${turnoEditando.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(armarPayload()),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Error actualizando turno.");
        return;
      }

      setTurnoEditando(null);
      limpiarFormulario();
      await cargarTurnos();
    } catch (error) {
      console.error(error);
      alert("Error actualizando turno.");
    } finally {
      setEditando(false);
    }
  }

  function cerrarEdicion() {
    setTurnoEditando(null);
    limpiarFormulario();
  }

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white md:px-6">
      <section className="mx-auto max-w-7xl">
        <div className="mb-6">
          <p className="mb-2 text-xs uppercase tracking-[0.3em] text-red-500">
            Admin SIM
          </p>

          <h1 className="text-3xl font-black uppercase md:text-5xl">
            Turnero del stand
          </h1>

          <p className="mt-2 max-w-2xl text-sm text-white/60">
            Cargá turnos, revisá el día y controlá el cierre con resumen.
          </p>
        </div>

        <form
          onSubmit={turnoEditando ? guardarEdicion : crearTurno}
          onKeyDown={manejarFlechitas}
          className="mb-6 rounded-3xl border border-white/10 bg-white/[0.03] p-4"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-xl font-black uppercase text-red-500">
              {turnoEditando ? "Editar turno" : "Nuevo turno"}
            </h2>

            {turnoEditando && (
              <button
                type="button"
                onClick={cerrarEdicion}
                className="rounded-full border border-white/15 px-4 py-2 text-xs font-black uppercase text-white/70 hover:border-white hover:text-white"
              >
                Cancelar edición
              </button>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Campo label="Fecha">
              <input
                data-turnero-cell
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              />
            </Campo>

            <Campo label="Hora toma">
              <input
                data-turnero-cell
                type="time"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              />
            </Campo>

            <Campo label="Hora estimada">
              <input
                data-turnero-cell
                type="time"
                value={horaEstimadaSubida}
                onChange={(e) => setHoraEstimadaSubida(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              />
            </Campo>

            <Campo label="Hora subida">
              <input
                data-turnero-cell
                type="time"
                value={horaSubida}
                onChange={(e) => setHoraSubida(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              />
            </Campo>

            <Campo label="Hora bajada">
              <input
                type="time"
                value={horaBajada}
                readOnly
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-white/60 outline-none"
              />
            </Campo>

            <div className="relative">
              <Campo label="Cliente">
                <input
                  data-turnero-cell
                  type="text"
                  value={nombre}
                  onChange={(e) => {
                    setNombre(e.target.value);
                    buscarClientes(e.target.value);
                  }}
                  onFocus={() => {
                    if (clientesSugeridos.length > 0) {
                      setMostrarSugerenciasClientes(true);
                    }
                  }}
                  placeholder="Nombre"
                  className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-red-500"
                />
              </Campo>
            </div>

            <div className="relative">
              <Campo label="Teléfono">
                <input
                  data-turnero-cell
                  type="text"
                  value={telefono}
                  onChange={(e) => {
                    setTelefono(e.target.value);
                    buscarClientes(e.target.value);
                  }}
                  onFocus={() => {
                    if (clientesSugeridos.length > 0) {
                      setMostrarSugerenciasClientes(true);
                    }
                  }}
                  placeholder="351..."
                  className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-red-500"
                />
              </Campo>
            </div>

            <Campo label="Total">
              <input
                type="text"
                value={formatoDinero(turnoGratis ? 0 : totalPagos)}
                readOnly
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-white/60 outline-none"
              />
            </Campo>
          </div>

          {mostrarSugerenciasClientes && clientesSugeridos.length > 0 && (
            <div className="mt-3 rounded-2xl border border-red-500/30 bg-black p-2 shadow-2xl">
              <p className="mb-2 px-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/35">
                Clientes encontrados
              </p>

              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {clientesSugeridos.map((cliente, index) => (
                  <button
                    key={`${cliente.nombre}-${cliente.telefono}-${index}`}
                    type="button"
                    onClick={() => seleccionarCliente(cliente)}
                    className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition hover:border-red-500 hover:bg-red-600/20"
                  >
                    <p className="truncate text-sm font-black text-white">
                      {cliente.nombre || "Sin nombre"}
                    </p>
                    <p className="truncate text-xs font-bold text-white/45">
                      {cliente.telefono || "Sin teléfono"}
                    </p>
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  setClientesSugeridos([]);
                  setMostrarSugerenciasClientes(false);
                }}
                className="mt-2 rounded-lg px-2 py-1 text-xs font-bold text-white/45 hover:text-white"
              >
                Cerrar sugerencias
              </button>
            </div>
          )}

          <div className="mt-3 grid gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Campo label="Personas">
              <input
                data-turnero-cell
                type="number"
                min={1}
                max={4}
                value={cantidadPersonas}
                onChange={(e) =>
                  setCantidadPersonas(Math.min(4, Math.max(1, Number(e.target.value) || 1)))
                }
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              />
            </Campo>

            <Campo label="Minutos">
              <input
                data-turnero-cell
                type="number"
                min={1}
                value={cantidadMinutos}
                onChange={(e) => setCantidadMinutos(Number(e.target.value))}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              />
            </Campo>

            <Campo label="Turnos">
              <input
                data-turnero-cell
                type="number"
                min={1}
                value={cantidadTurnos}
                onChange={(e) => setCantidadTurnos(Number(e.target.value))}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              />
            </Campo>

            <div className="xl:col-span-4">
              <Campo label="Observaciones">
                <input
                  data-turnero-cell
                  type="text"
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Notas internas"
                  className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-red-500"
                />
              </Campo>
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={guardando || editando}
                className="w-full rounded-xl bg-red-600 px-4 py-2 text-sm font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30"
              >
                {turnoEditando
                  ? editando
                    ? "Actualizando..."
                    : "Actualizar"
                  : guardando
                    ? "Guardando..."
                    : "Guardar"}
              </button>
            </div>
          </div>

          {/* Turno gratis */}
          <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-2xl border border-white/10 bg-black/60 p-3">
            <input
              type="checkbox"
              checked={turnoGratis}
              onChange={(e) => setTurnoGratis(e.target.checked)}
              className="h-4 w-4 accent-red-500"
            />
            <span className="text-sm font-black uppercase tracking-[0.12em] text-white/80">
              Turno gratis
            </span>
            <span className="text-xs font-bold text-white/40">Sin cobro · total $0</span>
          </label>

          {turnoGratis ? (
            <div className="mt-3 rounded-2xl border border-green-500/25 bg-green-500/10 p-4 text-sm font-bold text-green-300">
              Turno gratuito — no se registra cobro. Se guarda con método “Gratis” y total $0.
            </div>
          ) : (
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/60 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
                Métodos de pago
              </p>
              <button
                type="button"
                onClick={agregarPago}
                className="rounded-full border border-red-500/60 px-3 py-1 text-[10px] font-black uppercase text-red-400 hover:bg-red-600 hover:text-white"
              >
                + Agregar pago
              </button>
            </div>

            <div className="space-y-2">
              {pagosDetalle.map((pago, index) => {
                const usaPosnet = metodoUsaPosnet(pago.metodo_pago);

                return (
                  <div
                    key={index}
                    className="grid gap-2 md:grid-cols-[1.1fr_1fr_1fr_90px]"
                  >
                    <select
                      data-turnero-cell
                      value={pago.metodo_pago}
                      onChange={(e) =>
                        actualizarPago(index, "metodo_pago", e.target.value)
                      }
                      className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
                    >
                      {METODOS_PAGO.map((metodo) => (
                        <option key={metodo.value} value={metodo.value}>
                          {metodo.label}
                        </option>
                      ))}
                    </select>

                    <input
                      data-turnero-cell
                      type="number"
                      min={0}
                      value={pago.monto}
                      onChange={(e) =>
                        actualizarPago(index, "monto", e.target.value)
                      }
                      placeholder="Monto"
                      className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-red-500"
                    />

                    <select
                      data-turnero-cell
                      value={pago.posnet_pago || ""}
                      onChange={(e) =>
                        actualizarPago(index, "posnet_pago", e.target.value)
                      }
                      disabled={!usaPosnet}
                      className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500 disabled:opacity-30"
                    >
                      <option value="">Sin posnet</option>
                      {POSNETS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={() => eliminarPago(index)}
                      disabled={pagosDetalle.length === 1}
                      className="rounded-xl border border-white/15 px-3 py-2 text-xs font-black uppercase text-white/60 transition hover:border-red-500 hover:text-white disabled:opacity-30"
                    >
                      Quitar
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 flex justify-end text-sm font-black">
              Total pagos:{" "}
              <span className="ml-2 text-red-500">
                {formatoDinero(totalPagos)}
              </span>
            </div>
          </div>
          )}

          <div className="mt-4">
            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
              Simuladores
            </p>

            <div className="flex flex-wrap gap-2">
              {SIMULADORES.map((simulador) => {
                const seleccionado = simuladores.includes(simulador);

                return (
                  <button
                    key={simulador}
                    type="button"
                    onClick={() => toggleSimulador(simulador)}
                    className={`rounded-full border px-4 py-2 text-xs font-black uppercase transition ${
                      seleccionado
                        ? "border-red-500 bg-red-600 text-white"
                        : "border-white/15 bg-black text-white/60 hover:border-red-500 hover:text-white"
                    }`}
                  >
                    {simulador}
                  </button>
                );
              })}
            </div>
          </div>
        </form>

        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-xl font-black uppercase text-red-500">
                Turnos guardados
              </h2>
              <p className="text-sm text-white/50">{fecha}</p>
            </div>

            <div className="flex items-end gap-3">
              <Campo label="Ver día">
                <input
                  type="date"
                  value={fecha}
                  onChange={(e) => {
                    setFecha(e.target.value);
                    setTurnoEditando(null);
                  }}
                  className="rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
                />
              </Campo>

              <div className="rounded-full border border-white/10 px-4 py-2 text-sm font-bold text-white/70">
                {turnosDelDia.length} turnos
              </div>
            </div>
          </div>

          {loading ? (
            <p className="text-white/60">Cargando turnos...</p>
          ) : turnosDelDia.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black p-5">
              <p className="text-white/60">
                No hay turnos cargados para esta fecha.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[1220px] space-y-2">
                <div className="grid grid-cols-[60px_70px_80px_80px_80px_1.4fr_1fr_90px_90px_1.4fr_130px_120px_80px] gap-2 px-3 text-xs font-black uppercase tracking-[0.15em] text-white/35">
                  <span>Listo</span>
                  <span>Toma</span>
                  <span>Est.</span>
                  <span>Sube</span>
                  <span>Baja</span>
                  <span>Cliente</span>
                  <span>Simus</span>
                  <span>Pers.</span>
                  <span>Min.</span>
                  <span>Pago</span>
                  <span>Posnet</span>
                  <span>Total</span>
                  <span></span>
                </div>

                {turnosDelDia.map((turno) => {
                  const simus = normalizarSimuladores(turno.simuladores);
                  const pagos = normalizarPagos(turno).filter(
                    (pago) => Number(pago.monto) > 0,
                  );
                  const posnets = pagos.length
                    ? pagos
                        .map((pago) => pago.posnet_pago)
                        .filter(Boolean)
                        .join(" + ") || "-"
                    : turno.posnet_pago || turno.posnet || "-";
                  const listo = Boolean(turno.turno_listo);
                  const timer = getTurnoTimerState(
                    {
                      fecha: turno.fecha,
                      horaSubida: turno.hora_subida,
                      minutos: turno.cantidad_minutos,
                      listo: turno.turno_listo,
                      cancelado: turno.estado === "cancelado",
                    },
                    now,
                  );

                  return (
                    <div
                      key={turno.id}
                      className={`grid grid-cols-[60px_70px_80px_80px_80px_1.4fr_1fr_90px_90px_1.4fr_130px_120px_80px] items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${
                        timer.status === "listo"
                          ? "border-green-500/50 bg-green-950/25"
                          : timer.status === "rojo"
                          ? "border-red-500/60 bg-red-950/30"
                          : timer.status === "amarillo"
                          ? "border-amber-500/50 bg-amber-950/20"
                          : "border-white/10 bg-black hover:border-red-500/60"
                      }`}
                    >
                      <label className="flex items-center justify-center">
                        <input
                          type="checkbox"
                          checked={Boolean(turno.turno_listo)}
                          onChange={async (e) => {
                            const nuevoValor = e.target.checked;

                            setTurnos((prev) =>
                              prev.map((t) =>
                                t.id === turno.id
                                  ? { ...t, turno_listo: nuevoValor }
                                  : t,
                              ),
                            );

                            await fetch(`/api/turnos-stand/${turno.id}`, {
                              method: "PATCH",
                              headers: {
                                "Content-Type": "application/json",
                              },
                              body: JSON.stringify({
                                ...turno,
                                turno_listo: nuevoValor,
                              }),
                            });
                          }}
                          className="h-5 w-5 accent-red-600"
                        />
                      </label>

                      <span className="font-black">{turno.hora || "-"}</span>
                      <span className="text-white/70">
                        {turno.hora_estimada_subida || "-"}
                      </span>
                      <span className="text-white/70">
                        {turno.hora_subida || "-"}
                      </span>
                      <span className="text-white/70">
                        {turno.hora_bajada ||
                          sumarMinutosAHora(
                            turno.hora_subida || "",
                            turno.cantidad_minutos || 15,
                          ) ||
                          "-"}
                      </span>

                      <div className="min-w-0">
                        <p
                          className={`truncate font-black ${
                            listo ? "text-white/60 line-through" : ""
                          }`}
                        >
                          {turno.nombre || "Sin nombre"}
                        </p>
                        <p className="truncate text-xs text-white/40">
                          {turno.telefono || "Sin teléfono"}
                        </p>
                        <span
                          className={`mt-1 inline-flex w-fit items-center rounded-md px-2 py-0.5 text-[11px] font-bold ${TURNO_BADGE_CLASS[timer.status]}`}
                        >
                          {timer.label}
                        </span>
                      </div>

                      <span className="truncate text-white/70">
                        {simus.length ? simus.join(", ") : "-"}
                      </span>

                      <span>{turno.cantidad_personas || 1}</span>
                      <span>{turno.cantidad_minutos || 15}</span>
                      <span className="truncate">
                        {formatearPagosDetalle(turno)}
                      </span>
                      <span>{posnets}</span>

                      <span className="font-black text-red-500">
                        {formatoDinero(Number(turno.total || 0))}
                      </span>

                      <button
                        onClick={() => abrirEdicion(turno)}
                        className="rounded-lg border border-white/15 px-3 py-2 text-xs font-black uppercase text-white/70 transition hover:border-red-500 hover:bg-red-600 hover:text-white"
                      >
                        Editar
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 rounded-3xl border border-red-500/30 bg-red-950/20 p-5">
          <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-2xl font-black uppercase text-red-500">
                Resumen del día
              </h2>
              <p className="text-sm text-white/50">{fecha}</p>
            </div>

            <div className="text-left md:text-right">
              <p className="text-sm uppercase tracking-[0.2em] text-white/40">
                Facturación total
              </p>
              <p className="text-3xl font-black">
                {formatoDinero(resumenDia.totalFacturado)}
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <div className="rounded-2xl border border-white/10 bg-black p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">
                Turnos
              </p>
              <p className="mt-2 text-2xl font-black">
                {resumenDia.cantidadTurnos}
              </p>
            </div>

            <ResumenBox titulo="Por método" data={resumenDia.porMetodo} />
            <ResumenBox titulo="Por simulador" data={resumenDia.porSimulador} />
            <ResumenBox titulo="Por duración" data={resumenDia.porMinutos} />
            <ResumenBox titulo="Por personas" data={resumenDia.porPersonas} />
            <ResumenBox titulo="Por posnet" data={resumenDia.porPosnet} />
          </div>

          <div className="mt-3 rounded-2xl border border-white/10 bg-black p-4">
            <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-white/40">
              Posnet por método de pago
            </p>

            {Object.keys(resumenDia.porPosnetYMetodo).length === 0 ? (
              <p className="text-sm text-white/45">
                No hay cobros con posnet cargados para este día.
              </p>
            ) : (
              <div className="grid gap-2 md:grid-cols-3">
                {Object.entries(resumenDia.porPosnetYMetodo).map(
                  ([clave, valor]) => (
                    <div
                      key={clave}
                      className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2 text-sm"
                    >
                      <span className="font-bold text-white/70">{clave}</span>
                      <span className="font-black text-red-500">
                        {formatoDinero(valor)}
                      </span>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function Campo({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
        {label}
      </label>
      {children}
    </div>
  );
}

function ResumenBox({
  titulo,
  data,
}: {
  titulo: string;
  data: Record<string, any>;
}) {
  const entries = Object.entries(data);

  return (
    <div className="rounded-2xl border border-white/10 bg-black p-4">
      <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-white/40">
        {titulo}
      </p>

      {entries.length === 0 ? (
        <p className="text-sm text-white/45">Sin datos</p>
      ) : (
        <div className="space-y-2">
          {entries.map(([key, value]) => {
            const esObjeto =
              typeof value === "object" && value !== null && "total" in value;

            return (
              <div
                key={key}
                className="flex items-start justify-between gap-3 text-sm"
              >
                <span className="font-bold text-white/70">{key}</span>

                <span className="text-right font-black">
                  {esObjeto ? (
                    <>
                      {value.cantidad} /{" "}
                      <span className="text-red-500">
                        {formatoDinero(value.total)}
                      </span>
                    </>
                  ) : (
                    value
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}