-- ============================================================================
-- Consumo de Google Places (reseñas de la Home) — tope diario COMPARTIDO.
-- ----------------------------------------------------------------------------
-- Cuenta cada consulta REAL a Google Places (API nueva y respaldo legacy) por
-- fecha de negocio de Argentina, en una sola fila por día: el contador lo
-- comparten todas las instancias de Vercel. La aplicación reserva una llamada
-- ANTES de consultar a Google; si el tope del día ya se alcanzó, no consulta y
-- la Home muestra solo el enlace a Google Maps.
--
-- No guarda reseñas ni nada de Google: solo fecha y cantidad.
--
-- Idempotente. Sin datos iniciales. Se aplica en Supabase (SIM WEB) ANTES de
-- prender RESENAS_GOOGLE_PUBLICAS; sin esta migración la consulta pública
-- queda cerrada (contador "no operativo") y el diagnóstico admin funciona igual
-- pero avisa que su llamada no quedó contada.
-- ============================================================================

create table if not exists public.google_places_consumo (
  fecha date primary key,
  llamadas integer not null default 0 check (llamadas >= 0),
  actualizado_en timestamptz not null default now()
);

comment on table public.google_places_consumo is
  'Consultas reales a Google Places por fecha de negocio de Argentina (tope diario compartido de las reseñas de la Home). Sin contenido de Google.';

-- Reserva UNA llamada del día. Devuelve el número de llamada reservada (1, 2…)
-- o NULL si el tope ya se alcanzó (y entonces no incrementa).
--   · p_tope: tope diario (>= 0). Con 0 no se reserva nada.
--   · p_forzar: cuenta aunque se haya alcanzado el tope (diagnóstico admin:
--     una consulta controlada que igual tiene que quedar contada).
-- Atómico entre instancias: el INSERT … ON CONFLICT DO UPDATE … WHERE bloquea
-- la fila del día, así que dos reservas simultáneas nunca superan el tope.
create or replace function public.google_places_reservar_llamada(p_tope integer, p_forzar boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_llamada integer;
begin
  if p_tope is null or p_tope < 0 then
    raise exception 'tope_invalido' using errcode = '22023';
  end if;
  if not coalesce(p_forzar, false) and p_tope = 0 then
    return null;
  end if;

  insert into public.google_places_consumo as c (fecha, llamadas, actualizado_en)
  values (v_hoy, 1, now())
  on conflict (fecha) do update
    set llamadas = c.llamadas + 1, actualizado_en = now()
    where coalesce(p_forzar, false) or c.llamadas < p_tope
  returning c.llamadas into v_llamada;

  return v_llamada; -- NULL: el UPDATE no aplicó porque el tope ya se alcanzó
end;
$$;

-- Permisos: nadie escribe la tabla directo; service_role la lee y reserva por RPC.
alter table public.google_places_consumo enable row level security;
revoke all on table public.google_places_consumo from public, anon, authenticated, service_role;
grant select on table public.google_places_consumo to service_role;

revoke all on function public.google_places_reservar_llamada(integer, boolean) from public, anon, authenticated;
grant execute on function public.google_places_reservar_llamada(integer, boolean) to service_role;
