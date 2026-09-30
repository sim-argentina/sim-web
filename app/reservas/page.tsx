"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Clock3,
  Flag,
  ShoppingCart,
  ShieldCheck,
  CalendarDays,
  ChevronDown,
  CircleAlert,
} from "lucide-react";
import TeamCard from "@/components/TeamCard";
import {
  gaEvent, setPendingPurchase,
  trackSelectDate, trackSelectTime, trackApplyPromotion,
  trackCheckoutError, trackPaymentRedirect, trackFreePurchase,
} from "@/lib/analytics";
import { esFinDeSemana } from "@/lib/agenda";
// Solo el código y el mensaje del 409: la oferta la decide el servidor.
import { CATALOGO_ACTUALIZADO } from "@/lib/catalogoComercial";

type TeamKey = "Ferrari" | "McLaren" | "Red Bull" | "Alpine";

// (B3) La oferta —modalidad, duraciones, precios, grilla y disponibilidad— la
// resuelve el servidor en cada request (/api/reservas/disponibilidad y
// /api/reservas/catalogo, sin caché). La página solo la muestra: no calcula
// disponibilidad ni tiene duraciones, precios u horarios propios.
type RangoHorario = { desde: string; hasta: string };

type Catalogo = {
  modalidad: string;
  duraciones: number[];
  duracion_inicial: number;
  desde_precio: number;
  paso_min: number;
  horario: { semana: RangoHorario; fin_de_semana: RangoHorario };
  ventana: string[];
};

type Oferta = Catalogo & {
  fecha: string;
  duracion: number;
  precio: number;
  precios: Record<string, number>;
  grilla: string[];
  horarios: { hora: string; disponibles: number; libres: string[] }[];
};

type Respuesta<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string | null };

// Por qué se recarga la oferta. Define qué pasa con el horario elegido.
type Motivo = "inicio" | "fecha" | "duracion" | "refresco" | "catalogo_actualizado";

// Lo que la persona ya había elegido y se conserva si sigue siendo válido.
type Preferencia = { hora: string; equipos: TeamKey[] };

type FeedbackModalState = {
  open: boolean;
  type: "success" | "error";
  title: string;
  message: string;
};

type CodigoAplicado = {
  codigo: string;
  descuento: number;
  totalOriginal: number;
  totalFinal: number;
};

const teams = [
  {
    key: "Ferrari" as TeamKey,
    code: "S F",
    car: "SF-24",
    subtitle: "Escudería Ferrari",
    colorFrom: "from-red-950/80",
    colorTo: "to-red-900/20",
    accent: "bg-red-500",
    logoSrc: "/logos/ferrari.png",
    logoAlt: "Logo Ferrari",
  },
  {
    key: "McLaren" as TeamKey,
    code: "M C L",
    car: "MCL38",
    subtitle: "Escudería McLaren",
    colorFrom: "from-orange-950/80",
    colorTo: "to-orange-900/20",
    accent: "bg-orange-500",
    logoSrc: "/logos/mclaren.png",
    logoAlt: "Logo McLaren",
  },
  {
    key: "Red Bull" as TeamKey,
    code: "R B",
    car: "RB20",
    subtitle: "Escudería Red Bull",
    colorFrom: "from-blue-950/80",
    colorTo: "to-blue-900/20",
    accent: "bg-blue-500",
    logoSrc: "/logos/redbull.png",
    logoAlt: "Logo Red Bull",
  },
  {
    key: "Alpine" as TeamKey,
    code: "A L P",
    car: "A524",
    subtitle: "Escudería Alpine",
    colorFrom: "from-cyan-950/80",
    colorTo: "to-cyan-900/20",
    accent: "bg-sky-500",
    logoSrc: "/logos/alpine.png",
    logoAlt: "Logo Alpine",
  },
];

function cn(...classes: string[]) {
  return classes.filter(Boolean).join(" ");
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

function capitalizeFirst(text: string) {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatFullDateLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  const formatted = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);

  return capitalizeFirst(formatted);
}

// (M6) El tipo de día lo define lib/agenda, la misma fuente que el servidor.
function isWeekendDate(dateKey: string) {
  return esFinDeSemana(dateKey);
}

function getPhoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

// "15 o 30", "10, 20 o 30".
function listaDuraciones(duraciones: number[]) {
  if (duraciones.length <= 1) return duraciones.join("");
  return `${duraciones.slice(0, -1).join(", ")} o ${duraciones[duraciones.length - 1]}`;
}

function esCatalogo(x: unknown): x is Catalogo {
  const c = x as Catalogo | null;
  return (
    !!c &&
    typeof c.modalidad === "string" &&
    Array.isArray(c.duraciones) &&
    c.duraciones.length > 0 &&
    typeof c.duracion_inicial === "number" &&
    typeof c.desde_precio === "number" &&
    typeof c.paso_min === "number" &&
    !!c.horario?.semana &&
    !!c.horario?.fin_de_semana &&
    Array.isArray(c.ventana) &&
    c.ventana.length > 0
  );
}

function esOferta(x: unknown): x is Oferta {
  const o = x as Oferta | null;
  return (
    esCatalogo(o) &&
    typeof o.fecha === "string" &&
    typeof o.duracion === "number" &&
    typeof o.precio === "number" &&
    !!o.precios &&
    Array.isArray(o.grilla) &&
    Array.isArray(o.horarios)
  );
}

async function pedirOferta(fecha: string | null, duracion: number | null): Promise<Respuesta<Oferta>> {
  const qs = new URLSearchParams();
  if (fecha) qs.set("fecha", fecha);
  if (duracion !== null) qs.set("duracion", String(duracion));
  const q = qs.toString();
  const response = await fetch(`/api/reservas/disponibilidad${q ? `?${q}` : ""}`, {
    cache: "no-store",
  });
  const result = await response.json().catch(() => null);
  if (response.ok && esOferta(result)) return { ok: true, data: result };
  return {
    ok: false,
    status: response.status,
    error: typeof result?.error === "string" ? result.error : null,
  };
}

async function pedirCatalogo(): Promise<Catalogo | null> {
  const response = await fetch("/api/reservas/catalogo", { cache: "no-store" });
  const result = await response.json().catch(() => null);
  return response.ok && esCatalogo(result) ? result : null;
}

// ¿El servidor rechazó la compra porque la oferta que se veía ya no es la vigente?
function esCatalogoActualizado(response: Response, result: unknown) {
  return (
    response.status === CATALOGO_ACTUALIZADO.status &&
    (result as { codigo?: unknown } | null)?.codigo === CATALOGO_ACTUALIZADO.codigo
  );
}

export default function ReservasPage() {
  const dateInputRef = useRef<HTMLInputElement | null>(null);

  // La oferta vigente que se está mostrando (catálogo + disponibilidad de la
  // fecha y duración elegidas), tal cual la devolvió el servidor.
  const [oferta, setOferta] = useState<Oferta | null>(null);
  const [errorCarga, setErrorCarga] = useState(false);
  const ofertaRef = useRef<Oferta | null>(null);
  // Cada carga tiene un número: una respuesta vieja nunca pisa a una nueva.
  const solicitudRef = useRef(0);

  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [duracion, setDuracion] = useState<number>(0);
  const [selectedTeams, setSelectedTeams] = useState<TeamKey[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [acceptedConditions, setAcceptedConditions] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingReservations, setIsLoadingReservations] = useState(false);

  const [codigoInput, setCodigoInput] = useState("");
  const [codigoAplicado, setCodigoAplicado] = useState<CodigoAplicado | null>(
    null
  );
  const [isApplyingCode, setIsApplyingCode] = useState(false);

  const [feedbackModal, setFeedbackModal] = useState<FeedbackModalState>({
    open: false,
    type: "success",
    title: "",
    message: "",
  });

  const minDate = oferta?.ventana[0] ?? "";
  const maxDate = oferta?.ventana[oferta.ventana.length - 1] ?? "";

  // Simuladores libres durante TODO el turno, por inicio (lo calcula el servidor).
  const libresPorHora = useMemo(
    () => new Map((oferta?.horarios ?? []).map((h) => [h.hora, h.libres])),
    [oferta]
  );

  const reservedForCurrentSelection = useMemo<TeamKey[]>(() => {
    const libres = libresPorHora.get(selectedTime) ?? [];
    return teams.map((t) => t.key).filter((key) => !libres.includes(key));
  }, [libresPorHora, selectedTime]);

  const availableTeams = useMemo(() => {
    return teams.map((team) => ({
      ...team,
      reserved: reservedForCurrentSelection.includes(team.key),
      selected: selectedTeams.includes(team.key),
    }));
  }, [reservedForCurrentSelection, selectedTeams]);

  const availableCount = availableTeams.filter((team) => !team.reserved).length;

  // Precio EFECTIVO por simulador (con precio especial si el admin cargó uno),
  // calculado por el servidor. Se manda como `precio_visto`: si al pagar ya no
  // es el vigente, el servidor responde 409 y no cobra.
  const pricePerSim = oferta?.precios[String(duracion)] ?? 0;
  const totalOriginal = selectedTeams.length * pricePerSim;
  const descuentoAplicado = codigoAplicado?.descuento || 0;
  const totalFinal = Math.max(totalOriginal - descuentoAplicado, 0);
  const selectedDateLabel = selectedDate ? formatFullDateLabel(selectedDate) : "";
  const phoneDigits = getPhoneDigits(phone);
  const isPhoneValid = phoneDigits.length >= 10;
  const horarioDelDia = oferta
    ? isWeekendDate(selectedDate)
      ? oferta.horario.fin_de_semana
      : oferta.horario.semana
    : null;

  // Analytics: vista del "producto" reserva (una vez al montar la página).
  useEffect(() => {
    gaEvent("view_item", { currency: "ARS", items: [{ item_id: "reserva", item_name: "Turno simulador", item_category: "reserva" }] });
  }, []);

  useEffect(() => {
    setCodigoAplicado(null);
  }, [selectedTeams, selectedDate, selectedTime, duracion]);

  // Muestra una oferta recién llegada y ajusta la selección a ella.
  function aplicarOferta(nueva: Oferta, motivo: Motivo, pref: Preferencia) {
    ofertaRef.current = nueva;
    setOferta(nueva);
    setErrorCarga(false);
    setSelectedDate(nueva.fecha);
    setDuracion(nueva.duracion);

    const libres = (hora: string) =>
      nueva.horarios.find((h) => h.hora === hora)?.libres ?? [];
    // El horario elegido se conserva si sigue en la grilla del día. Al abrir o
    // cambiar de fecha, si está lleno se pasa al primero con lugar; al cambiar
    // de duración se queda (sale "Sin lugares" si no entra), como siempre.
    let hora = nueva.grilla.includes(pref.hora) ? pref.hora : nueva.grilla[0] ?? "";
    if (motivo !== "duracion" && libres(hora).length === 0) {
      hora = nueva.horarios.find((h) => h.disponibles > 0)?.hora ?? hora;
    }
    setSelectedTime(hora);
    setSelectedTeams(pref.equipos.filter((t) => libres(hora).includes(t)));
  }

  // Pide la oferta al servidor. Si la oferta cambió con la página abierta —el
  // servidor lo avisó con un 409, ya responde otra modalidad (el corte) o la
  // fecha/duración elegidas dejaron de existir— recarga el catálogo vigente y
  // conserva lo que siga siendo válido. Los datos personales no se tocan.
  async function cargarOferta(
    pedido: { fecha: string | null; duracion: number | null },
    motivo: Motivo,
    pref: Preferencia
  ) {
    const id = ++solicitudRef.current;
    setIsLoadingReservations(true);

    try {
      const vista = ofertaRef.current?.modalidad ?? null;
      const primera: Respuesta<Oferta> | null =
        motivo === "catalogo_actualizado"
          ? null
          : await pedirOferta(pedido.fecha, pedido.duracion);
      let respuesta: Respuesta<Oferta>;
      let aviso: "catalogo" | "fecha" | null = null;

      if (
        primera === null ||
        (vista !== null && primera.ok && primera.data.modalidad !== vista) ||
        (vista !== null && !primera.ok && primera.status === 400)
      ) {
        const catalogo = await pedirCatalogo();
        if (!catalogo) {
          respuesta = { ok: false, status: 0, error: null };
        } else {
          const cambioModalidad = vista !== null && catalogo.modalidad !== vista;
          const fecha =
            pedido.fecha && catalogo.ventana.includes(pedido.fecha)
              ? pedido.fecha
              : catalogo.ventana[0];
          // Con otra modalidad la duración elegida era de la oferta anterior:
          // se vuelve a la inicial y la persona elige de nuevo.
          const nuevaDuracion =
            !cambioModalidad &&
            pedido.duracion !== null &&
            catalogo.duraciones.includes(pedido.duracion)
              ? pedido.duracion
              : catalogo.duracion_inicial;
          respuesta = await pedirOferta(fecha, nuevaDuracion);
          aviso =
            motivo === "catalogo_actualizado" || cambioModalidad
              ? "catalogo"
              : fecha !== pedido.fecha
              ? "fecha"
              : null;
        }
      } else {
        respuesta = primera;
      }

      if (id !== solicitudRef.current) return;

      if (!respuesta.ok) {
        if (!ofertaRef.current) {
          setErrorCarga(true);
          return;
        }
        // Se vuelve a mostrar lo último válido.
        setSelectedDate(ofertaRef.current.fecha);
        setDuracion(ofertaRef.current.duracion);
        openFeedbackModal(
          "error",
          "No se pudieron cargar las reservas",
          respuesta.error || "Ocurrió un problema al consultar la disponibilidad."
        );
        return;
      }

      aplicarOferta(respuesta.data, motivo, pref);

      if (aviso === "catalogo") {
        openFeedbackModal(
          "error",
          "Turnos y precios actualizados",
          CATALOGO_ACTUALIZADO.mensaje
        );
      } else if (aviso === "fecha") {
        openFeedbackModal(
          "error",
          "Fecha no válida",
          "Las reservas solo pueden hacerse desde mañana en adelante."
        );
      }
    } catch (error) {
      if (id !== solicitudRef.current) return;
      console.error("Error cargando reservas:", error);
      if (!ofertaRef.current) {
        setErrorCarga(true);
        return;
      }
      setSelectedDate(ofertaRef.current.fecha);
      setDuracion(ofertaRef.current.duracion);
      openFeedbackModal(
        "error",
        "Error al cargar reservas",
        "Ocurrió un error al consultar la disponibilidad."
      );
    } finally {
      if (id === solicitudRef.current) setIsLoadingReservations(false);
    }
  }

  // Primera carga: sin fecha ni duración, el servidor devuelve el primer día
  // reservable con la duración inicial, catálogo y disponibilidad resueltos en
  // el MISMO request.
  useEffect(() => {
    void cargarOferta({ fecha: null, duracion: null }, "inicio", { hora: "", equipos: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleChangeDuracion(next: number) {
    if (isSubmitting || isLoadingReservations) return;
    setSelectedTeams([]);
    if (next === duracion) return;
    setDuracion(next);
    void cargarOferta({ fecha: selectedDate, duracion: next }, "duracion", {
      hora: selectedTime,
      equipos: [],
    });
  }

  function openFeedbackModal(
    type: "success" | "error",
    title: string,
    message: string
  ) {
    setFeedbackModal({
      open: true,
      type,
      title,
      message,
    });
  }

  function closeFeedbackModal() {
    setFeedbackModal((prev) => ({
      ...prev,
      open: false,
    }));
  }

  function toggleTeam(teamKey: TeamKey) {
    if (reservedForCurrentSelection.includes(teamKey)) return;
    if (isSubmitting || isLoadingReservations) return;

    setSelectedTeams((prev) => {
      const next = prev.includes(teamKey)
        ? prev.filter((item) => item !== teamKey)
        : [...prev, teamKey];
      if (!prev.includes(teamKey)) {
        gaEvent("select_item", {
          item_list_name: "Simuladores",
          duration_minutes: duracion,
          items: [{ item_id: teamKey, item_name: "Turno simulador", item_category: "reserva", price: pricePerSim }],
        });
      }
      return next;
    });
  }

  function handleChangeDate(nextDate: string) {
    if (isSubmitting || isLoadingReservations || !oferta) return;
    // Fuera de la ventana (o vacío): el input vuelve a la fecha elegida.
    if (!oferta.ventana.includes(nextDate)) return;
    setSelectedDate(nextDate);
    setSelectedTeams([]);
    // Funnel: alcanzó la etapa "eligió fecha" (sin enviar la fecha concreta).
    trackSelectDate("reserva");
    void cargarOferta({ fecha: nextDate, duracion }, "fecha", {
      hora: selectedTime,
      equipos: [],
    });
  }

  function handleChangeTime(nextTime: string) {
    if (isSubmitting || isLoadingReservations) return;
    setSelectedTime(nextTime);
    setSelectedTeams([]);
    // Funnel: alcanzó la etapa "eligió horario" (sin enviar la hora concreta).
    if (nextTime) trackSelectTime("reserva");
  }

  async function aplicarCodigo() {
    const codigo = codigoInput.trim().toUpperCase();

    if (!codigo) {
      openFeedbackModal(
        "error",
        "Código vacío",
        "Ingresá un código promocional para aplicarlo."
      );
      return;
    }

    if (selectedTeams.length === 0 || totalOriginal <= 0) {
      openFeedbackModal(
        "error",
        "Seleccioná un simulador",
        "Primero tenés que seleccionar al menos un simulador para calcular el descuento."
      );
      return;
    }

    setIsApplyingCode(true);

    try {
      const response = await fetch("/api/codigos-descuento/validar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          codigo,
          total: totalOriginal,
          fecha: selectedDate,
          duracion,
        }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.valido) {
        setCodigoAplicado(null);
        openFeedbackModal(
          "error",
          "Código inválido",
          result?.error || "No se pudo aplicar el código."
        );
        return;
      }

      if (Number(result.totalFinal) <= 0) {
        setCodigoAplicado({
          codigo: result.codigo,
          descuento: Number(result.descuento || totalOriginal),
          totalOriginal: Number(result.totalOriginal || totalOriginal),
          totalFinal: 0,
        });

        setCodigoInput(result.codigo);
        trackApplyPromotion("reserva", Number(result.descuento || totalOriginal));

        openFeedbackModal(
          "success",
          "Código aplicado",
          `El código ${result.codigo} deja la reserva bonificada al 100%.`
        );

        return;
      }

      setCodigoAplicado({
        codigo: result.codigo,
        descuento: Number(result.descuento || 0),
        totalOriginal: Number(result.totalOriginal || totalOriginal),
        totalFinal: Number(result.totalFinal || totalOriginal),
      });

      setCodigoInput(result.codigo);
      trackApplyPromotion("reserva", Number(result.descuento || 0));

      openFeedbackModal(
        "success",
        "Código aplicado",
        `Se aplicó el código ${result.codigo} correctamente.`
      );
    } catch (error) {
      console.error("Error aplicando código:", error);
      openFeedbackModal(
        "error",
        "Error al aplicar código",
        "Ocurrió un problema al validar el código promocional."
      );
    } finally {
      setIsApplyingCode(false);
    }
  }

  function quitarCodigo() {
    setCodigoAplicado(null);
    setCodigoInput("");
  }

  async function handleReserve() {
    if (!name.trim() || !phone.trim() || selectedTeams.length === 0 || isSubmitting || !oferta) {
      return;
    }

    if (!isPhoneValid) {
      openFeedbackModal(
        "error",
        "Teléfono inválido",
        "Ingresá un número de teléfono con al menos 10 dígitos."
      );
      return;
    }

    if (!acceptedConditions) {
      openFeedbackModal(
        "error",
        "Condiciones de uso",
        "Para continuar con el pago, tenés que confirmar que leíste y aceptás las condiciones de uso."
      );
      return;
    }

    // (B3) La fecha, el horario y el precio los valida el servidor. Acá solo se
    // evita mandar algo que la oferta que se está mostrando ya descarta.
    if (!oferta.ventana.includes(selectedDate)) {
      openFeedbackModal(
        "error",
        "Fecha no válida",
        "Las reservas solo pueden hacerse desde mañana en adelante."
      );
      return;
    }

    const libres = libresPorHora.get(selectedTime) ?? [];
    if (
      oferta.fecha !== selectedDate ||
      oferta.duracion !== duracion ||
      !selectedTeams.every((team) => libres.includes(team))
    ) {
      openFeedbackModal(
        "error",
        "Horario no disponible",
        "Ese horario no está disponible para la fecha elegida."
      );
      return;
    }

    setIsSubmitting(true);

    const payload = {
      nombre: name.trim(),
      telefono: phone.trim(),
      fecha: selectedDate,
      hora: selectedTime,
      simuladores: selectedTeams,
      cantidad_turnos: selectedTeams.length,
      total: totalOriginal,
      codigo_descuento: codigoAplicado?.codigo || null,
      acepto_condiciones: acceptedConditions,
      duracion_minutos: duracion,
      // Lo que la persona VIO. Si el servidor ya ofrece otra modalidad u otro
      // precio, responde 409 sin crear nada ni cobrar.
      modalidad_vista: oferta.modalidad,
      precio_visto: pricePerSim,
    };

    // Lo elegido, para conservarlo si hay que recargar la oferta.
    const pedidoActual = { fecha: selectedDate, duracion };
    const preferencia: Preferencia = { hora: selectedTime, equipos: selectedTeams };

    // Funnel: configuración válida + decisión de iniciar la compra (vale para ambas
    // ramas: pago con Mercado Pago y reserva 100% bonificada).
    gaEvent("begin_checkout", {
      currency: "ARS",
      value: totalFinal,
      duration_minutes: duracion,
      items: [{ item_name: "Turno simulador", item_category: "reserva", quantity: selectedTeams.length, price: pricePerSim }],
    });

    if (totalFinal <= 0) {
      try {
        const response = await fetch("/api/reservas", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...payload,
            total: 0,
          }),
        });

        const result = await response.json().catch(() => null);

        if (!response.ok) {
          if (esCatalogoActualizado(response, result)) {
            await cargarOferta(pedidoActual, "catalogo_actualizado", preferencia);
            return;
          }
          openFeedbackModal(
            "error",
            "No se pudo confirmar la reserva",
            result?.error || "Ocurrió un problema al guardar la reserva bonificada."
          );
          if (response.status === 409) void cargarOferta(pedidoActual, "refresco", preferencia);
          return;
        }

        // Conversión de la reserva 100% bonificada: purchase value 0, id estable
        // (reserva_<id>) y dedupe. No pasa por /exito, así que se emite acá una vez.
        if (result?.id) {
          trackFreePurchase({ kind: "reserva", transactionId: `reserva_${result.id}`, coupon: codigoAplicado?.codigo });
        }

        openFeedbackModal(
          "success",
          "Reserva confirmada",
          "Tu reserva bonificada fue guardada correctamente. No tenés que pagar nada por Mercado Pago."
        );

        setName("");
        setPhone("");
        setSelectedTeams([]);
        setAcceptedConditions(false);
        setCodigoInput("");
        setCodigoAplicado(null);

        await cargarOferta(pedidoActual, "refresco", { hora: selectedTime, equipos: [] });
        return;
      } catch (error) {
        console.error("Error al guardar reserva bonificada:", error);
        openFeedbackModal(
          "error",
          "Error del sistema",
          "Ocurrió un error al guardar la reserva bonificada."
        );
        return;
      } finally {
        setIsSubmitting(false);
      }
    }

    try {
      const response = await fetch("/api/mercadopago/preference", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        // La oferta cambió (corte de modalidad o precio nuevo): no es un error
        // técnico. No se creó reserva ni preferencia; se muestra la vigente.
        if (esCatalogoActualizado(response, result)) {
          await cargarOferta(pedidoActual, "catalogo_actualizado", preferencia);
          return;
        }
        // Error técnico del checkout (no se pudo crear la preferencia).
        trackCheckoutError("reserva");
        openFeedbackModal(
          "error",
          "No se pudo iniciar el pago",
          result?.error || "Ocurrió un problema al generar el pago."
        );
        if (response.status === 409) void cargarOferta(pedidoActual, "refresco", preferencia);
        return;
      }

      const paymentUrl = result?.init_point;

      if (!paymentUrl) {
        trackCheckoutError("reserva");
        openFeedbackModal(
          "error",
          "Link de pago no disponible",
          "Mercado Pago no devolvió un enlace de pago válido."
        );
        return;
      }

      // Preferencia OK + init_point válido → redirección efectiva a Mercado Pago.
      trackPaymentRedirect({
        funnel: "reserva",
        value: totalFinal,
        duration_minutes: duracion,
        quantity: selectedTeams.length,
        transaction_id: result?.reserva_id ? `reserva_${result.reserva_id}` : null,
      });
      setPendingPurchase({ value: totalFinal, currency: "ARS", type: "reserva" });

      window.location.href = paymentUrl;
    } catch (error) {
      console.error("Error al crear preferencia de pago:", error);
      openFeedbackModal(
        "error",
        "Error del sistema",
        "Ocurrió un error al conectar con Mercado Pago."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!oferta || !horarioDelDia || !selectedDate || !selectedTime) {
    return (
      <main className="min-h-screen bg-black text-white">
        {errorCarga && (
          <section className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
            <CircleAlert className="h-8 w-8 text-red-400" />
            <p className="mt-4 text-lg font-bold">
              No pudimos cargar los turnos disponibles.
            </p>
            <button
              type="button"
              onClick={() => {
                setErrorCarga(false);
                void cargarOferta({ fecha: null, duracion: null }, "inicio", {
                  hora: "",
                  equipos: [],
                });
              }}
              className="mt-6 rounded-2xl bg-red-600 px-6 py-3 text-sm font-black text-white transition hover:bg-red-500"
            >
              Reintentar
            </button>
          </section>
        )}
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto max-w-7xl px-4 py-8 md:px-6 lg:px-8">
        <div className="overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-r from-red-950/40 via-zinc-950 to-zinc-900">
          <div className="grid gap-8 p-6 md:p-10 lg:grid-cols-[1.5fr_0.9fr]">
            <div>
              <p className="mb-4 text-xs font-bold uppercase tracking-[0.45em] text-red-500">
                Reservas SIM
              </p>

              <h1 className="max-w-3xl text-4xl font-black leading-tight md:text-6xl">
                Reservá tu escudería
              </h1>

              <p className="mt-5 max-w-2xl text-base leading-8 text-zinc-300 md:text-xl">
                Elegí una fecha, una duración ({listaDuraciones(oferta.duraciones)} minutos) y un
                horario, seleccioná una o varias escuderías disponibles y armá tu reserva. Las
                largadas salen cada {oferta.paso_min} minutos.
              </p>

              <div className="mt-7 flex flex-wrap gap-3">
                <div className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm text-zinc-200">
                  Lun a vie: {oferta.horario.semana.desde} a {oferta.horario.semana.hasta}
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm text-zinc-200">
                  Sáb y dom: {oferta.horario.fin_de_semana.desde} a {oferta.horario.fin_de_semana.hasta}
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm text-zinc-200">
                  Reservas desde mañana
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm text-zinc-200">
                  Hasta 15 días de anticipación
                </div>
                <div className="rounded-full border border-red-500/30 bg-red-500/10 px-5 py-3 text-sm font-medium text-red-300">
                  Desde {formatPrice(oferta.desde_precio)} por simulador
                </div>
              </div>
            </div>

            <div className="grid gap-4 self-start sm:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="mb-3 flex items-center gap-2 text-red-400">
                  <Clock3 className="h-4 w-4" />
                  <span className="text-sm">Disponibilidad</span>
                </div>
                <div className="text-4xl font-black">{availableCount}</div>
                <p className="mt-2 text-zinc-400">
                  simuladores libres en la selección actual
                </p>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="mb-3 flex items-center gap-2 text-red-400">
                  <ShieldCheck className="h-4 w-4" />
                  <span className="text-sm">Largadas</span>
                </div>
                <div className="text-4xl font-black">{oferta.paso_min} min</div>
                <p className="mt-2 text-zinc-400">entre cada salida</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1.45fr_0.95fr]">
          <section>
            <div className="mb-5">
              <h2 className="text-2xl font-black md:text-4xl">
                Elegí fecha, horario y escudería
              </h2>
              <p className="mt-2 text-zinc-400">
                Más claro, más limpio y más fácil de usar.
              </p>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5 shadow-xl">
              <div className="grid gap-5">
                <div className="rounded-[24px] border border-white/10 bg-black/40 p-4 md:p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="rounded-2xl bg-red-950/70 p-3 text-red-400">
                      <CalendarDays className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.32em] text-zinc-500">
                        Fecha
                      </div>
                      <div className="text-lg font-bold text-white">
                        Elegí el día de tu reserva
                      </div>
                    </div>
                  </div>

                  <div className="relative">
                    {/* Visual del botón (decorativo). El control real es el input
                        nativo que va por encima. */}
                    <div
                      aria-hidden="true"
                      className="flex w-full items-center justify-between rounded-[22px] border border-white/10 bg-zinc-900/70 px-4 py-4 text-left transition"
                    >
                      <div className="flex items-center gap-3">
                        <div className="rounded-xl bg-red-500/10 p-2 text-red-400">
                          <CalendarDays className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                            Día elegido
                          </div>
                          <div className="mt-1 text-base font-bold text-white md:text-lg">
                            {selectedDateLabel}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-zinc-400">
                        <span className="hidden text-sm sm:inline">Cambiar</span>
                        <ChevronDown className="h-5 w-5" />
                      </div>
                    </div>

                    {/* Input nativo real, transparente y tappable, por encima del
                        visual. En iOS/Safari `showPicker` no existe y un input
                        oculto no se puede abrir: al tocar el input real se abre el
                        selector nativo. En desktop, `showPicker` (si existe) abre
                        el calendario al hacer click. */}
                    <input
                      ref={dateInputRef}
                      type="date"
                      value={selectedDate}
                      min={minDate}
                      max={maxDate}
                      onChange={(e) => handleChangeDate(e.target.value)}
                      onClick={(e) => {
                        const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
                        try { el.showPicker?.(); } catch { /* no-op: iOS/no soportado */ }
                      }}
                      aria-label="Elegí la fecha de tu reserva"
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                  </div>
                </div>

                <div className="rounded-[24px] border border-white/10 bg-black/40 p-4 md:p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="rounded-2xl bg-red-950/70 p-3 text-red-400">
                      <Clock3 className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.32em] text-zinc-500">
                        Duración
                      </div>
                      <div className="text-lg font-bold text-white">
                        ¿Cuánto querés manejar?
                      </div>
                    </div>
                  </div>

                  <div
                    className={
                      oferta.duraciones.length >= 3
                        ? "grid grid-cols-3 gap-3"
                        : "grid grid-cols-2 gap-3"
                    }
                  >
                    {oferta.duraciones.map((d) => {
                      const isSel = duracion === d;
                      const precio = oferta.precios[String(d)] ?? 0;
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => handleChangeDuracion(d)}
                          disabled={isSubmitting || isLoadingReservations}
                          className={cn(
                            "rounded-[18px] border px-4 py-4 text-center transition",
                            isSel
                              ? "border-red-500/50 bg-red-500/10 shadow-[0_0_18px_rgba(239,68,68,0.10)]"
                              : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
                          )}
                        >
                          <div className="text-lg font-black text-white">
                            {d} min
                          </div>
                          <div
                            className={cn(
                              "mt-1 text-[11px]",
                              isSel ? "text-red-300" : "text-zinc-400"
                            )}
                          >
                            {formatPrice(precio)} por simulador
                          </div>
                        </button>
                      );
                    })}
                  </div>

                </div>

                <div className="rounded-[24px] border border-white/10 bg-black/40 p-4 md:p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="rounded-2xl bg-red-950/70 p-3 text-red-400">
                      <Clock3 className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.32em] text-zinc-500">
                        Horario
                      </div>
                      <div className="text-lg font-bold text-white">
                        Elegí una largada disponible
                      </div>
                    </div>
                  </div>

                  <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-300">
                    {isWeekendDate(selectedDate)
                      ? `Horario de sábado/domingo: ${horarioDelDia.desde} a ${horarioDelDia.hasta}`
                      : `Horario de lunes a viernes: ${horarioDelDia.desde} a ${horarioDelDia.hasta}`}
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {oferta.grilla.map((time) => {
                      const freeCount = (libresPorHora.get(time) ?? []).length;
                      const isSelected = selectedTime === time;
                      const isFull = freeCount === 0;

                      return (
                        <button
                          key={time}
                          type="button"
                          onClick={() => !isFull && handleChangeTime(time)}
                          disabled={isFull || isSubmitting || isLoadingReservations}
                          className={cn(
                            "rounded-[18px] border px-4 py-4 text-center transition",
                            isFull
                              ? "cursor-not-allowed border-white/5 bg-zinc-900/60"
                              : isSelected
                              ? "border-red-500/50 bg-red-500/10 shadow-[0_0_18px_rgba(239,68,68,0.10)]"
                              : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
                          )}
                        >
                          <div
                            className={cn(
                              "text-base font-black",
                              isFull ? "text-zinc-600" : "text-white"
                            )}
                          >
                            {time}
                          </div>
                          <div
                            className={cn(
                              "mt-1.5 text-[11px]",
                              isFull
                                ? "text-zinc-600"
                                : isSelected
                                ? "text-red-300"
                                : "text-zinc-400"
                            )}
                          >
                            {isFull ? "Sin lugares" : `${freeCount}/4 disponibles`}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-300">
                    Turno de {duracion} min · salida cada {oferta.paso_min} min
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-[1.2fr_auto]">
                <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-black/60 px-5 py-4">
                  <div className="rounded-2xl bg-red-950/70 p-3 text-red-400">
                    <Flag className="h-5 w-5" />
                  </div>

                  <div>
                    <div className="text-sm uppercase tracking-[0.28em] text-zinc-500">
                      Selección actual
                    </div>
                    <div className="mt-1 text-2xl font-black md:text-3xl">
                      {selectedTime}
                    </div>
                    <div className="mt-1 text-zinc-400">{selectedDateLabel}</div>
                  </div>
                </div>

                <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-sm font-medium text-white">
                  {availableCount}/4 disponibles
                </div>
              </div>

              <div className="mt-6 grid gap-5 md:grid-cols-2">
                {availableTeams.map((team) => (
                  <TeamCard
                    key={team.key}
                    name={team.key}
                    code={team.code}
                    car={team.car}
                    subtitle={team.subtitle}
                    time={`${selectedDateLabel} · ${selectedTime} · ${duracion} min`}
                    price={pricePerSim}
                    selected={team.selected}
                    reserved={team.reserved}
                    colorFrom={team.colorFrom}
                    colorTo={team.colorTo}
                    accent={team.accent}
                    logoSrc={team.logoSrc}
                    logoAlt={team.logoAlt}
                    onClick={() => toggleTeam(team.key)}
                  />
                ))}
              </div>
            </div>
          </section>

          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-[30px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl">
              <div className="mb-5 flex items-start gap-4">
                <div className="rounded-2xl bg-red-950/70 p-4 text-red-400">
                  <ShoppingCart className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-2xl font-black">Tu reserva</h2>
                  <p className="text-zinc-400">Podés sumar más de un simulador</p>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                {selectedTeams.length === 0 ? (
                  <p className="text-zinc-500">
                    No seleccionaste ningún simulador todavía.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {selectedTeams.map((teamKey) => (
                      <div
                        key={teamKey}
                        className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                      >
                        <div>
                          <div className="font-semibold text-white">{teamKey}</div>
                          <div className="text-sm text-zinc-400">
                            {selectedDateLabel} · {selectedTime}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleTeam(teamKey)}
                          disabled={isSubmitting || isLoadingReservations}
                          className="rounded-full bg-zinc-800 px-3 py-1 text-xs font-bold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Quitar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-5 rounded-[24px] border border-red-500/30 bg-gradient-to-b from-red-950/50 to-red-950/20 p-5">
                <div className="mb-4 text-lg font-medium">Resumen</div>

                <div className="space-y-3 text-base">
                  <div className="flex items-center justify-between gap-4 text-zinc-200">
                    <span>Fecha</span>
                    <span className="text-right">{selectedDateLabel}</span>
                  </div>
                  <div className="flex items-center justify-between text-zinc-200">
                    <span>Horario</span>
                    <span>{selectedTime}</span>
                  </div>
                  <div className="flex items-center justify-between text-zinc-200">
                    <span>Duración</span>
                    <span>{duracion} min</span>
                  </div>
                  <div className="flex items-center justify-between text-zinc-200">
                    <span>Simuladores</span>
                    <span>{selectedTeams.length}</span>
                  </div>
                  <div className="flex items-center justify-between text-zinc-200">
                    <span>Precio unitario</span>
                    <span>{formatPrice(pricePerSim)}</span>
                  </div>

                  {codigoAplicado && (
                    <>
                      <div className="flex items-center justify-between text-zinc-200">
                        <span>Subtotal</span>
                        <span>{formatPrice(totalOriginal)}</span>
                      </div>

                      <div className="flex items-center justify-between text-green-400">
                        <span>Descuento {codigoAplicado.codigo}</span>
                        <span>-{formatPrice(descuentoAplicado)}</span>
                      </div>
                    </>
                  )}
                </div>

                <div className="my-4 h-px bg-white/10" />

                <div className="flex items-center justify-between text-3xl font-black">
                  <span>Total</span>
                  <span>{formatPrice(totalFinal)}</span>
                </div>
              </div>

              <div className="mt-5 rounded-[22px] border border-white/10 bg-black/40 p-4">
                <label className="mb-2 block text-sm font-medium text-zinc-300">
                  Código promocional
                </label>

                <div className="flex gap-2">
                  <input
                    value={codigoInput}
                    onChange={(e) => {
                      setCodigoInput(e.target.value.toUpperCase());
                      setCodigoAplicado(null);
                    }}
                    placeholder="Ej: SIM-ABC123"
                    disabled={
                      isSubmitting ||
                      isLoadingReservations ||
                      isApplyingCode ||
                      selectedTeams.length === 0
                    }
                    className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black px-4 py-3 text-sm font-bold uppercase text-white outline-none transition placeholder:text-zinc-500 focus:border-red-500/50 disabled:cursor-not-allowed disabled:opacity-60"
                  />

                  {codigoAplicado ? (
                    <button
                      type="button"
                      onClick={quitarCodigo}
                      disabled={isSubmitting}
                      className="rounded-2xl bg-zinc-800 px-4 py-3 text-sm font-black text-white transition hover:bg-zinc-700 disabled:opacity-50"
                    >
                      Quitar
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={aplicarCodigo}
                      disabled={
                        isSubmitting ||
                        isApplyingCode ||
                        selectedTeams.length === 0 ||
                        !codigoInput.trim()
                      }
                      className="rounded-2xl bg-red-600 px-4 py-3 text-sm font-black text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                    >
                      {isApplyingCode ? "..." : "Aplicar"}
                    </button>
                  )}
                </div>

                {codigoAplicado ? (
                  <p className="mt-3 text-sm font-medium text-green-400">
                    Código aplicado: {codigoAplicado.codigo}
                  </p>
                ) : (
                  <p className="mt-3 text-xs text-zinc-500">
                    El descuento se valida antes de ir a Mercado Pago.
                  </p>
                )}
                <p className="mt-3 text-xs text-zinc-500">
                  ¿Tenés un <b className="text-zinc-300">código empresarial</b> (EMP-…)?{" "}
                  <a href="/reservas-empresa" className="font-semibold text-red-400 underline">Usalo acá</a>.
                </p>
              </div>

              <div className="mt-5 space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-zinc-300">
                    Nombre y apellido
                  </label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Tu nombre"
                    disabled={isSubmitting || isLoadingReservations}
                    className="w-full rounded-2xl border border-white/10 bg-black px-4 py-4 text-white outline-none transition placeholder:text-zinc-500 focus:border-red-500/50 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-zinc-300">
                    Teléfono
                  </label>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+54 9 351..."
                    disabled={isSubmitting || isLoadingReservations}
                    className={cn(
                      "w-full rounded-2xl border bg-black px-4 py-4 text-white outline-none transition placeholder:text-zinc-500 disabled:cursor-not-allowed disabled:opacity-60",
                      phone.trim().length > 0 && !isPhoneValid
                        ? "border-red-500/50 focus:border-red-500"
                        : "border-white/10 focus:border-red-500/50"
                    )}
                  />
                  {phone.trim().length > 0 && !isPhoneValid && (
                    <p className="mt-2 text-sm text-red-400">
                      El teléfono debe tener al menos 10 dígitos.
                    </p>
                  )}
                </div>

                <div className="rounded-[22px] border border-red-500/30 bg-red-950/20 p-4">
                  <div className="mb-3 flex items-start gap-3">
                    <div className="mt-0.5 rounded-xl bg-red-500/10 p-2 text-red-400">
                      <CircleAlert className="h-4 w-4" />
                    </div>

                    <div>
                      <p className="text-sm font-black uppercase tracking-[0.18em] text-red-300">
                        Condiciones de uso
                      </p>

                      <p className="mt-2 text-sm leading-6 text-zinc-300">
                        Antes de pagar, confirmá que leíste y aceptás las condiciones
                        de uso. Para utilizar los simuladores, la altura mínima es de{" "}
                        <span className="font-bold text-white">1.40 metros</span> y
                        el peso máximo permitido es de{" "}
                        <span className="font-bold text-white">110 kg</span>.
                      </p>
                    </div>
                  </div>

                  <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-black/30 p-3 text-sm text-zinc-200 transition hover:border-red-500/30">
                    <input
                      type="checkbox"
                      checked={acceptedConditions}
                      onChange={(e) => setAcceptedConditions(e.target.checked)}
                      disabled={isSubmitting || isLoadingReservations}
                      className="mt-1 h-4 w-4 accent-red-600 disabled:cursor-not-allowed"
                    />

                    <span>
                      Confirmo que leí, entiendo y respeto las condiciones de uso de
                      SIM, y que acepto los{" "}
                      <a
                        href="/legales/terminos"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-red-400 underline underline-offset-2 hover:text-red-300"
                      >
                        Términos y Condiciones
                      </a>{" "}
                      y la{" "}
                      <a
                        href="/legales/privacidad"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-red-400 underline underline-offset-2 hover:text-red-300"
                      >
                        Política de Privacidad
                      </a>
                      .
                    </span>
                  </label>
                </div>

                <button
                  type="button"
                  onClick={handleReserve}
                  disabled={
                    isSubmitting ||
                    isLoadingReservations ||
                    !name.trim() ||
                    !phone.trim() ||
                    !isPhoneValid ||
                    !acceptedConditions ||
                    selectedTeams.length === 0
                  }
                  className={cn(
                    "w-full rounded-2xl py-4 text-lg font-black transition",
                    isSubmitting ||
                      isLoadingReservations ||
                      !name.trim() ||
                      !phone.trim() ||
                      !isPhoneValid ||
                      !acceptedConditions ||
                      selectedTeams.length === 0
                      ? "cursor-not-allowed bg-zinc-800 text-zinc-500"
                      : "bg-red-600 text-white hover:bg-red-500"
                  )}
                >
                  {isSubmitting
                    ? totalFinal <= 0
                      ? "Confirmando reserva..."
                      : "Redirigiendo..."
                    : totalFinal <= 0
                    ? "Confirmar reserva bonificada"
                    : `Pagar ${formatPrice(totalFinal)}`}
                </button>
              </div>
            </div>
          </aside>
        </div>
      </section>

      {feedbackModal.open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-b from-zinc-950 via-black to-zinc-950 shadow-[0_20px_80px_rgba(0,0,0,0.55)]">
            <div className="border-b border-white/10 bg-white/[0.02] px-6 py-5">
              <div className="flex items-start gap-4">
                <div
                  className={cn(
                    "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border",
                    feedbackModal.type === "success"
                      ? "border-red-500/30 bg-red-500/10 text-red-400"
                      : "border-white/10 bg-white/5 text-white"
                  )}
                >
                  {feedbackModal.type === "success" ? (
                    <ShieldCheck className="h-6 w-6" />
                  ) : (
                    <CircleAlert className="h-6 w-6" />
                  )}
                </div>

                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.35em] text-red-500">
                    SIM Argentina
                  </p>
                  <h3 className="mt-2 text-2xl font-black text-white">
                    {feedbackModal.title}
                  </h3>
                </div>
              </div>
            </div>

            <div className="px-6 py-5">
              <p className="text-sm leading-7 text-zinc-300">
                {feedbackModal.message}
              </p>

              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={closeFeedbackModal}
                  className="rounded-2xl bg-red-600 px-6 py-3 text-sm font-black text-white transition hover:bg-red-500"
                >
                  Aceptar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
