-- ============================================================================
-- CIERRE del esquema base: lo que depende de dos módulos a la vez
-- ----------------------------------------------------------------------------
-- reservas.mensualidad_id apunta a mensualidades, pero `reservas` es del esquema
-- base y `mensualidades` la crea db/mensualidades-m2.sql. Esta FK solo se puede
-- agregar cuando las dos tablas existen, así que va al final del orden.
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reservas_mensualidad_id_fkey'
  ) then
    alter table public.reservas
      add constraint reservas_mensualidad_id_fkey
      foreign key (mensualidad_id) references public.mensualidades(id) on delete restrict;
  end if;
end $$;

-- El trigger que aplica trg_reserva_slot_bloqueo() sobre reserva_slots existía SOLO
-- en Producción: el repositorio crea la función pero nunca llegó a versionar el
-- `create trigger`. Sin él, una base nueva acepta reservas sobre un horario
-- bloqueado y sobre un bloque ya ocupado, y las suites de disponibilidad y de
-- bloqueos pasarían por la razón equivocada.
-- Depende de reserva_slots (esquema base) y de reserva_hhmm_a_minutos
-- (modalidad-comercial-b1), así que también va al final.
drop trigger if exists reserva_slot_bloqueo on public.reserva_slots;
create trigger reserva_slot_bloqueo
  before insert on public.reserva_slots
  for each row execute function public.trg_reserva_slot_bloqueo();

-- ── Buckets de Storage ──────────────────────────────────────────────────────
-- El repositorio solo creaba `ia-sim-informes` (db/ia-sim-bloque4c.sql). Los otros
-- tres existían SOLO en Producción, creados desde el panel de Supabase. Sin
-- `ia-sim-docs` el módulo de conocimiento no puede subir un documento y cuatro
-- suites de IA fallan en "documento creado" / "adjunto creado".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('ia-sim-docs',  'ia-sim-docs',  false, 26214400, null),
  ('campeonatos',  'campeonatos',  true,   5242880, array['image/jpeg','image/png','image/webp']),
  ('sorteos',      'sorteos',      true,   5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
