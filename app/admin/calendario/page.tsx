"use client";

import { useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import type FullCalendarType from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";

export default function CalendarioAdminPage() {
  const calendarRef = useRef<FullCalendarType | null>(null);
  const [fechaBuscada, setFechaBuscada] = useState("");

  const eventos = [
    {
      title: "Juan Pérez • 2 Simus",
      start: "2026-05-18T14:00:00",
      end: "2026-05-18T14:20:00",
    },
    {
      title: "Martín Gómez • 1 Simu",
      start: "2026-05-18T15:00:00",
      end: "2026-05-18T15:20:00",
    },
    {
      title: "Lucas Fernández • 4 Simus",
      start: "2026-05-18T17:00:00",
      end: "2026-05-18T17:40:00",
    },
  ];

  function irAFecha() {
    if (!fechaBuscada) return;

    const calendarApi = calendarRef.current?.getApi();

    if (!calendarApi) return;

    calendarApi.gotoDate(fechaBuscada);
    calendarApi.changeView("timeGridDay");
  }

  function volverAHoy() {
    const calendarApi = calendarRef.current?.getApi();

    if (!calendarApi) return;

    calendarApi.today();
    calendarApi.changeView("timeGridDay");
    setFechaBuscada("");
  }

  return (
    <section className="min-h-screen bg-black text-white px-4 md:px-8 py-6">
      <div className="max-w-[1450px] mx-auto">
        <div className="mb-6 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-red-500 tracking-[0.35em] text-xs mb-2 uppercase">
              Panel Interno
            </p>

            <h1 className="text-3xl md:text-4xl font-bold">
              Calendario de Reservas
            </h1>

            <p className="text-zinc-400 mt-2 text-base">
              Gestión visual de reservas confirmadas.
            </p>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-3 flex flex-col sm:flex-row gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">
                Buscar fecha exacta
              </label>

              <input
                type="date"
                value={fechaBuscada}
                onChange={(e) => setFechaBuscada(e.target.value)}
                className="bg-black border border-zinc-800 rounded-xl px-4 py-2 text-white outline-none focus:border-red-600"
              />
            </div>

            <div className="flex items-end gap-2">
              <button
                onClick={irAFecha}
                className="bg-red-600 hover:bg-red-700 rounded-xl px-4 py-2 font-semibold transition"
              >
                Ir
              </button>

              <button
                onClick={volverAHoy}
                className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-xl px-4 py-2 font-semibold transition"
              >
                Hoy
              </button>
            </div>
          </div>
        </div>

        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 overflow-hidden shadow-2xl">
          <div className="calendar-wrapper">
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
              initialView="timeGridDay"
              locale="es"
              height={650}
              allDaySlot={false}
              slotMinTime="10:00:00"
              slotMaxTime="22:00:00"
              slotDuration="00:20:00"
              slotLabelInterval="01:00"
              expandRows={false}
              weekends={true}
              nowIndicator={true}
              headerToolbar={{
                left: "prev,next today",
                center: "title",
                right: "timeGridDay,timeGridWeek,dayGridMonth",
              }}
              buttonText={{
                today: "Hoy",
                month: "Mes",
                week: "Semana",
                day: "Día",
              }}
              events={eventos}
              eventBackgroundColor="#dc2626"
              eventBorderColor="#dc2626"
              eventTextColor="#ffffff"
            />
          </div>
        </div>
      </div>

      <style jsx global>{`
        .calendar-wrapper .fc {
          font-family: inherit;
          color: white;
          background: #09090b;
        }

        .calendar-wrapper .fc-toolbar {
          margin-bottom: 18px !important;
        }

        .calendar-wrapper .fc-toolbar-title {
          font-size: 1.6rem !important;
          font-weight: 800;
          color: white;
        }

        .calendar-wrapper .fc-button {
          background: #18181b !important;
          border: 1px solid #27272a !important;
          color: white !important;
          border-radius: 10px !important;
          padding: 8px 13px !important;
          font-size: 0.85rem !important;
          font-weight: 700 !important;
          box-shadow: none !important;
        }

        .calendar-wrapper .fc-button:hover,
        .calendar-wrapper .fc-button-active {
          background: #dc2626 !important;
          border-color: #dc2626 !important;
        }

        .calendar-wrapper .fc-scrollgrid,
        .calendar-wrapper .fc-theme-standard td,
        .calendar-wrapper .fc-theme-standard th {
          border-color: #27272a !important;
        }

        .calendar-wrapper .fc-col-header-cell {
          background: #111113 !important;
          color: #e4e4e7 !important;
          padding: 8px 0 !important;
          font-size: 0.85rem;
          font-weight: 700;
        }

        .calendar-wrapper .fc-col-header-cell-cushion {
          color: #e4e4e7 !important;
          text-decoration: none !important;
        }

        .calendar-wrapper .fc-timegrid-slot {
          background: #09090b !important;
          height: 42px !important;
        }

        .calendar-wrapper .fc-timegrid-axis,
        .calendar-wrapper .fc-timegrid-slot-label {
          background: #09090b !important;
          color: #a1a1aa !important;
          font-size: 0.8rem !important;
        }

        .calendar-wrapper .fc-event {
          border-radius: 8px !important;
          border: none !important;
          padding: 4px 8px !important;
          font-size: 0.8rem !important;
          font-weight: 700;
          min-height: 28px;
          display: flex;
          align-items: center;
        }

        .calendar-wrapper .fc-event-title {
          white-space: normal !important;
          overflow: visible !important;
        }

        .calendar-wrapper .fc-day-today {
          background: rgba(220, 38, 38, 0.06) !important;
        }

        .calendar-wrapper .fc-theme-standard .fc-scrollgrid {
          border-radius: 14px;
          overflow: hidden;
        }

        .calendar-wrapper .fc-timegrid-now-indicator-line {
          border-color: #ef4444 !important;
        }

        .calendar-wrapper .fc-timegrid-now-indicator-arrow {
          border-color: #ef4444 !important;
        }
      `}</style>
    </section>
  );
}