-- ============================================================================
-- Turnero del Stand — Cambio diario de caja.
-- ----------------------------------------------------------------------------
-- Nota operativa: al cerrar, quien está en el stand anota cuánto efectivo queda
-- físicamente en la caja como cambio; al día siguiente el Turnero muestra el del
-- cierre anterior. NADA MÁS.
--
-- NO es Finanzas: no crea ingresos, egresos ni fin_movimientos, no toca saldos,
-- conciliaciones ni arqueos, no se compara con las ventas en efectivo y no entra
-- en métricas ni en la IA.
--
--   · Una fila por fecha comercial de Argentina (UNIQUE(fecha)). Guardar de nuevo
--     el mismo día actualiza ESA fila: upsert atómico en la RPC (dos guardados
--     simultáneos dejan una sola fila; prevalece el último).
--   · monto: pesos enteros, de 0 a 10.000.000.
--   · creado_por / actualizado_por: lo único que firma la sesión, el rol
--     ('admin' o 'staff'). No hay identidad nominal que guardar.
--   · Deny by default: RLS sin policies; solo service_role (supabaseAdmin).
-- Aditiva: no toca ninguna tabla existente. Verificación sin huella:
-- db/turnero-cambio-diario.verificacion.sql.
-- El cuerpo de la función NO lleva comentarios: así es idéntico al de la base.
-- ============================================================================

create table if not exists public.turnero_cambio_diario (
  id              uuid primary key default gen_random_uuid(),
  fecha           date not null,
  monto           integer not null,
  creado_por      text not null,
  actualizado_por text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint turnero_cambio_diario_fecha_key unique (fecha),
  constraint turnero_cambio_diario_monto_chk check (monto >= 0 and monto <= 10000000),
  constraint turnero_cambio_diario_actor_chk
    check (creado_por in ('admin', 'staff') and actualizado_por in ('admin', 'staff'))
);

comment on table public.turnero_cambio_diario is
  'Turnero del Stand: efectivo que quedó en la caja como cambio al cierre de cada día (fecha comercial de Argentina). Nota operativa: no es un movimiento financiero ni entra en Finanzas, Métricas ni IA.';

alter table public.turnero_cambio_diario enable row level security;
revoke all on table public.turnero_cambio_diario from public, anon, authenticated;
grant select, insert, update on table public.turnero_cambio_diario to service_role;

-- Escritura. Valida actor, fecha y monto por su cuenta (además de la ruta) y
-- hace el upsert en UNA sentencia: INSERT ... ON CONFLICT (fecha) DO UPDATE.
-- Al actualizar conserva created_at y creado_por.
create or replace function public.turnero_cambio_guardar(
  p_fecha date,
  p_monto integer,
  p_actor text
)
returns public.turnero_cambio_diario
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_actor text := btrim(coalesce(p_actor, ''));
  v_fila  public.turnero_cambio_diario;
begin
  if v_actor not in ('admin', 'staff') then
    raise exception 'actor_invalido' using errcode = '42501';
  end if;
  if p_fecha is null then
    raise exception 'fecha_requerida' using errcode = '22023';
  end if;
  if p_monto is null or p_monto < 0 or p_monto > 10000000 then
    raise exception 'monto_invalido' using errcode = '22023';
  end if;

  insert into public.turnero_cambio_diario as t (fecha, monto, creado_por, actualizado_por)
  values (p_fecha, p_monto, v_actor, v_actor)
  on conflict (fecha) do update
     set monto           = excluded.monto,
         actualizado_por = excluded.actualizado_por,
         updated_at      = now()
  returning t.* into v_fila;

  return v_fila;
end;
$fn$;

revoke all on function public.turnero_cambio_guardar(date, integer, text)
  from public, anon, authenticated;
grant execute on function public.turnero_cambio_guardar(date, integer, text)
  to service_role;
