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

type TeamKey = "Ferrari" | "McLaren" | "Red Bull" | "Alpine";
type ReservationMap = Record<string, TeamKey[]>;

type ReservaApi = {
  id: number;
  nombre: string;
  telefono: string;
  fecha: string;
  hora: string;
  simuladores: TeamKey[] | string[] | string | null;
  cantidad_turnos: number;
  total: number;
  estado?: string | null;
};

type FeedbackModalState = {
  open: boolean;
  type: "success" | "error";
  title: string;
  message: string;
};

const PRICE = 12000;
const MAX_BOOKING_DAYS = 15;

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

const weekdayTimeSlots = [
  "10:00",
  "10:20",
  "10:40",
  "11:00",
  "11:20",
  "11:40",
  "12:00",
  "12:20",
  "12:40",
  "13:00",
  "13:20",
  "13:40",
  "14:00",
  "14:20",
  "14:40",
  "15:00",
  "15:20",
  "15:40",
  "16:00",
  "16:20",
  "16:40",
  "17:00",
  "17:20",
  "17:40",
  "18:00",
  "18:20",
  "18:40",
  "19:00",
  "19:20",
  "19:40",
  "20:00",
  "20:20",
  "20:40",
  "21:00",
  "21:20",
  "21:40",
];

const weekendTimeSlots = [
  "10:00",
  "10:20",
  "10:40",
  "11:00",
  "11:20",
  "11:40",
  "12:00",
  "12:20",
  "12:40",
  "13:00",
  "13:20",
  "13:40",
  "14:00",
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

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function createReservationKey(date: string, time: string) {
  return `${date}__${time}`;
}

function isWeekendDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const dayOfWeek = date.getDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

function getTimeSlotsForDate(dateKey: string) {
  if (!dateKey) return [];
  return isWeekendDate(dateKey) ? weekendTimeSlots : weekdayTimeSlots;
}

function getAvailableDates() {
  const dates: {
    value: string;
    fullLabel: string;
  }[] = [];

  for (let i = 1; i <= MAX_BOOKING_DAYS; i++) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + i);

    const value = formatDateKey(date);
    const fullLabel = formatFullDateLabel(value);

    dates.push({
      value,
      fullLabel,
    });
  }

  return dates;
}

function getPhoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

function normalizeSimuladores(value: ReservaApi["simuladores"]): TeamKey[] {
  const validTeams: TeamKey[] = ["Ferrari", "McLaren", "Red Bull", "Alpine"];

  if (Array.isArray(value)) {
    return value.filter((sim) =>
      validTeams.includes(String(sim) as TeamKey)
    ) as TeamKey[];
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);

      if (Array.isArray(parsed)) {
        return parsed.filter((sim) =>
          validTeams.includes(String(sim) as TeamKey)
        ) as TeamKey[];
      }
    } catch {
      return [];
    }
  }

  return [];
}

export default function ReservasPage() {
  const [isMounted, setIsMounted] = useState(false);
  const [availableDates, setAvailableDates] = useState<
    { value: string; fullLabel: string }[]
  >([]);

  const dateInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [selectedTeams, setSelectedTeams] = useState<TeamKey[]>([]);
  const [reservations, setReservations] = useState<ReservationMap>({});
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [acceptedConditions, setAcceptedConditions] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingReservations, setIsLoadingReservations] = useState(false);
  const [feedbackModal, setFeedbackModal] = useState<FeedbackModalState>({
    open: false,
    type: "success",
    title: "",
    message: "",
  });

  useEffect(() => {
    const dates = getAvailableDates();
    setAvailableDates(dates);

    const firstDate = dates[0]?.value ?? "";
    const firstTime = getTimeSlotsForDate(firstDate)[0] ?? "";

    setSelectedDate(firstDate);
    setSelectedTime(firstTime);
    setIsMounted(true);
  }, []);

  const minDate = availableDates[0]?.value ?? "";
  const maxDate = availableDates[availableDates.length - 1]?.value ?? "";

  const availableTimeSlots = useMemo(
    () => getTimeSlotsForDate(selectedDate),
    [selectedDate]
  );

  const reservationKey = createReservationKey(selectedDate, selectedTime);
  const reservedForCurrentSelection = reservations[reservationKey] ?? [];

  const availableTeams = useMemo(() => {
    return teams.map((team) => ({
      ...team,
      reserved: reservedForCurrentSelection.includes(team.key),
      selected: selectedTeams.includes(team.key),
    }));
  }, [reservedForCurrentSelection, selectedTeams]);

  const availableCount = availableTeams.filter((team) => !team.reserved).length;
  const total = selectedTeams.length * PRICE;
  const selectedDateLabel = selectedDate ? formatFullDateLabel(selectedDate) : "";
  const phoneDigits = getPhoneDigits(phone);
  const isPhoneValid = phoneDigits.length >= 10;

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

  function getFreeCount(date: string, time: string) {
    const key = createReservationKey(date, time);
    const reserved = reservations[key] ?? [];
    return teams.length - reserved.length;
  }

  function toggleTeam(teamKey: TeamKey) {
    if (reservedForCurrentSelection.includes(teamKey)) return;
    if (isSubmitting || isLoadingReservations) return;

    setSelectedTeams((prev) =>
      prev.includes(teamKey)
        ? prev.filter((item) => item !== teamKey)
        : [...prev, teamKey]
    );
  }

  function handleChangeDate(nextDate: string) {
    if (isSubmitting || isLoadingReservations) return;
    setSelectedDate(nextDate);
    setSelectedTeams([]);
  }

  function handleChangeTime(nextTime: string) {
    if (isSubmitting || isLoadingReservations) return;
    setSelectedTime(nextTime);
    setSelectedTeams([]);
  }

  function openDatePicker() {
    if (!dateInputRef.current) return;

    const input = dateInputRef.current as HTMLInputElement & {
      showPicker?: () => void;
    };

    if (typeof input.showPicker === "function") {
      input.showPicker();
    } else {
      input.focus();
      input.click();
    }
  }

  async function loadReservations(date: string) {
    try {
      setIsLoadingReservations(true);

      const response = await fetch(`/api/reservas?fecha=${date}`, {
        cache: "no-store",
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        openFeedbackModal(
          "error",
          "No se pudieron cargar las reservas",
          result?.error || "Ocurrió un problema al consultar la disponibilidad."
        );
        return;
      }

      const reservasApi: ReservaApi[] = Array.isArray(result?.reservas)
        ? result.reservas
        : Array.isArray(result)
        ? result
        : [];

      const nextReservations: ReservationMap = {};

      reservasApi
        .filter((reserva) => reserva.estado !== "cancelada")
        .forEach((reserva) => {
          const key = createReservationKey(reserva.fecha, reserva.hora);

          if (!nextReservations[key]) {
            nextReservations[key] = [];
          }

          const simuladores = normalizeSimuladores(reserva.simuladores);

          simuladores.forEach((simulador) => {
            if (!nextReservations[key].includes(simulador)) {
              nextReservations[key].push(simulador);
            }
          });
        });

      setReservations(nextReservations);

      const currentTimeIsValid = getTimeSlotsForDate(date).includes(selectedTime);

      if (!currentTimeIsValid) {
        const firstValidTime = getTimeSlotsForDate(date)[0];
        if (firstValidTime) {
          setSelectedTime(firstValidTime);
        }
        return;
      }

      const currentFree =
        teams.length -
        (nextReservations[createReservationKey(date, selectedTime)]?.length ?? 0);

      if (currentFree === 0) {
        const firstAvailableTime = getTimeSlotsForDate(date).find((time) => {
          const reserved = nextReservations[createReservationKey(date, time)] ?? [];
          return reserved.length < teams.length;
        });

        if (firstAvailableTime) {
          setSelectedTime(firstAvailableTime);
        }
      }
    } catch (error) {
      console.error("Error cargando reservas:", error);
      openFeedbackModal(
        "error",
        "Error al cargar reservas",
        "Ocurrió un error al consultar la disponibilidad."
      );
    } finally {
      setIsLoadingReservations(false);
    }
  }

  useEffect(() => {
    if (!selectedDate) return;
    loadReservations(selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    if (!selectedDate) return;
    if (availableTimeSlots.length === 0) return;

    if (!availableTimeSlots.includes(selectedTime)) {
      setSelectedTime(availableTimeSlots[0]);
      setSelectedTeams([]);
    }
  }, [selectedDate, availableTimeSlots, selectedTime]);

  async function handleReserve() {
    if (!name.trim() || !phone.trim() || selectedTeams.length === 0 || isSubmitting) {
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

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [year, month, day] = selectedDate.split("-").map(Number);
    const selectedDateObj = new Date(year, month - 1, day);
    selectedDateObj.setHours(0, 0, 0, 0);

    if (selectedDateObj <= today) {
      openFeedbackModal(
        "error",
        "Fecha no válida",
        "Las reservas solo pueden hacerse desde mañana en adelante."
      );
      return;
    }

    if (!getTimeSlotsForDate(selectedDate).includes(selectedTime)) {
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
      total,
      acepto_condiciones: acceptedConditions,
    };

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
        openFeedbackModal(
          "error",
          "No se pudo iniciar el pago",
          result?.error || "Ocurrió un problema al generar el pago."
        );
        return;
      }

      const paymentUrl = result?.init_point || result?.sandbox_init_point;

      if (!paymentUrl) {
        openFeedbackModal(
          "error",
          "Link de pago no disponible",
          "Mercado Pago no devolvió un enlace de pago válido."
        );
        return;
      }

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

  if (!isMounted || availableDates.length === 0 || !selectedDate || !selectedTime) {
    return <main className="min-h-screen bg-black text-white" />;
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
                Elegí una fecha y un horario, seleccioná una o varias escuderías disponibles
                y armá tu reserva. Cada turno dura 15 minutos, sale cada 20 minutos y vale{" "}
                <span className="font-semibold text-white">{formatPrice(PRICE)}</span> por
                simulador/persona.
              </p>

              <div className="mt-7 flex flex-wrap gap-3">
                <div className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm text-zinc-200">
                  Lun a vie: 10:00 a 21:40
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm text-zinc-200">
                  Sáb y dom: 10:00 a 14:00
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm text-zinc-200">
                  Reservas desde mañana
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm text-zinc-200">
                  Hasta 15 días de anticipación
                </div>
                <div className="rounded-full border border-red-500/30 bg-red-500/10 px-5 py-3 text-sm font-medium text-red-300">
                  {formatPrice(PRICE)} por simulador
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
                <div className="text-4xl font-black">20 min</div>
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

                  <input
                    ref={dateInputRef}
                    type="date"
                    value={selectedDate}
                    min={minDate}
                    max={maxDate}
                    onChange={(e) => handleChangeDate(e.target.value)}
                    className="pointer-events-none absolute opacity-0"
                    tabIndex={-1}
                    aria-hidden="true"
                  />

                  <button
                    type="button"
                    onClick={openDatePicker}
                    className="flex w-full items-center justify-between rounded-[22px] border border-white/10 bg-zinc-900/70 px-4 py-4 text-left transition hover:border-white/20 hover:bg-zinc-900"
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
                  </button>
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
                      ? "Horario de sábado/domingo: 10:00 a 14:00"
                      : "Horario de lunes a viernes: 10:00 a 21:40"}
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {availableTimeSlots.map((time) => {
                      const freeCount = getFreeCount(selectedDate, time);
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
                    Turno de 15 min · salida cada 20 min
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
                    time={`${selectedDateLabel} · ${selectedTime}`}
                    price={PRICE}
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
                    <span>Simuladores</span>
                    <span>{selectedTeams.length}</span>
                  </div>
                  <div className="flex items-center justify-between text-zinc-200">
                    <span>Precio unitario</span>
                    <span>{formatPrice(PRICE)}</span>
                  </div>
                </div>

                <div className="my-4 h-px bg-white/10" />

                <div className="flex items-center justify-between text-3xl font-black">
                  <span>Total</span>
                  <span>{formatPrice(total)}</span>
                </div>
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
                      SIM.
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
                  {isSubmitting ? "Redirigiendo..." : `Pagar ${formatPrice(total)}`}
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