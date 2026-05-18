export default function CalendarioAdminPage() {
  return (
    <section className="min-h-screen bg-zinc-950 text-white px-6 py-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <p className="text-red-500 tracking-[0.3em] text-xs mb-2">
            PANEL INTERNO
          </p>

          <h1 className="text-3xl md:text-4xl font-bold">
            Calendario de reservas
          </h1>

          <p className="text-zinc-400 mt-3">
            Acá se van a visualizar las reservas confirmadas para que el equipo del stand pueda organizar los turnos.
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-black p-6">
          <p className="text-zinc-400">
            Próximo paso: conectar esta pantalla con las reservas guardadas en Supabase.
          </p>
        </div>
      </div>
    </section>
  );
}