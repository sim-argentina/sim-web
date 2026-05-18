"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";

export default function CalendarioAdminPage() {
  const eventos = [
    {
      title: "Juan Pérez - 2 Simus",
      start: "2026-05-18T14:00:00",
      end: "2026-05-18T14:20:00",
    },
    {
      title: "Martín Gómez - 1 Simu",
      start: "2026-05-18T15:00:00",
      end: "2026-05-18T15:20:00",
    },
    {
      title: "Lucas Fernández - 4 Simus",
      start: "2026-05-18T17:00:00",
      end: "2026-05-18T17:40:00",
    },
  ];

  return (
    <section className="min-h-screen bg-zinc-950 text-white px-6 py-8">
      <div className="max-w-[1600px] mx-auto">
        <div className="mb-8">
          <p className="text-red-500 tracking-[0.3em] text-xs mb-2">
            PANEL INTERNO
          </p>

          <h1 className="text-4xl font-bold">
            Calendario de Reservas
          </h1>

          <p className="text-zinc-400 mt-3">
            Visualización interna de reservas confirmadas.
          </p>
        </div>

        <div className="bg-black border border-zinc-800 rounded-2xl p-4 overflow-hidden">
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
            expandRows={true}
            weekends={true}
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
            eventColor="#dc2626"
          />
        </div>
      </div>
    </section>
  );
}