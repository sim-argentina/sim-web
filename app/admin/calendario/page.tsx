"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";

export default function CalendarioAdminPage() {
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

  return (
    <section className="min-h-screen bg-black text-white px-4 md:px-8 py-8">
      <div className="max-w-[1700px] mx-auto">
        <div className="mb-8">
          <p className="text-red-500 tracking-[0.35em] text-xs mb-2 uppercase">
            Panel Interno
          </p>

          <h1 className="text-4xl md:text-5xl font-bold">
            Calendario de Reservas
          </h1>

          <p className="text-zinc-400 mt-3 text-lg">
            Gestión visual de reservas confirmadas.
          </p>
        </div>

        <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-4 md:p-6 overflow-hidden shadow-2xl">
          <div className="calendar-wrapper">
            <FullCalendar
              plugins={[
                dayGridPlugin,
                timeGridPlugin,
                interactionPlugin,
              ]}
              initialView="timeGridDay"
              locale="es"
              height="auto"
              allDaySlot={false}
              slotMinTime="10:00:00"
              slotMaxTime="22:00:00"
              slotDuration="00:20:00"
              expandRows={true}
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
        }

        .calendar-wrapper .fc-toolbar-title {
          font-size: 2rem;
          font-weight: 700;
          color: white;
        }

        .calendar-wrapper .fc-button {
          background: #18181b !important;
          border: 1px solid #27272a !important;
          color: white !important;
          border-radius: 14px !important;
          padding: 10px 18px !important;
          font-weight: 600 !important;
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
          background: #09090b !important;
          color: white !important;
          padding: 14px 0 !important;
          font-weight: 600;
        }

        .calendar-wrapper .fc-timegrid-slot {
          background: #09090b !important;
          height: 70px !important;
        }

        .calendar-wrapper .fc-timegrid-axis {
          background: #09090b !important;
          color: #a1a1aa !important;
          font-size: 0.95rem;
        }

        .calendar-wrapper .fc-event {
          border-radius: 14px !important;
          border: none !important;
          padding: 10px 12px !important;
          font-size: 0.95rem;
          font-weight: 700;
          min-height: 52px;
          display: flex;
          align-items: center;
        }

        .calendar-wrapper .fc-event-title {
          white-space: normal !important;
        }

        .calendar-wrapper .fc-day-today {
          background: rgba(220, 38, 38, 0.08) !important;
        }

        .calendar-wrapper .fc-theme-standard .fc-scrollgrid {
          border-radius: 18px;
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