-- ============================================================================
-- Colectivo — productos disponibles por evento + turnos = personas.
-- ----------------------------------------------------------------------------
-- 1. colectivo_evento_productos: qué productos del catálogo (colectivo_productos)
--    se venden en cada evento. Un producto se puede vender en un evento solo si
--    está ACTIVO en el catálogo Y HABILITADO en ese evento. Deshabilitarlo no toca
--    ninguna venta: colectivo_ventas guarda su propio producto, cantidad, precio
--    unitario y total, y su FK a colectivo_productos (sin ON DELETE) impide borrar
--    un producto que tenga ventas.
-- 2. Siembra única: los eventos que ya existen conservan lo que vendían hasta hoy
--    (todos los productos activos), así ningún evento en curso pierde productos.
--    Solo corre con la tabla vacía: volver a aplicar el archivo no habilita
--    productos nuevos en eventos viejos.
-- 3. colectivo_turnos: cantidad_turnos = cantidad_personas en cada alta y en cada
--    escritura que nombre personas o turnos. NO recalcula filas viejas: una
--    escritura que no toca esas columnas (p. ej. marcar "listo") no lo dispara.
--
-- Colectivo es un negocio separado: nada de esto toca Finanzas SIM (fin_*) ni el
-- Turnero del Stand. Deny by default: RLS sin policies; solo service_role.
-- Aditiva e idempotente. Verificación: db/colectivo-productos-por-evento.verificacion.sql.
-- ============================================================================

create table if not exists public.colectivo_evento_productos (
  id          uuid primary key default gen_random_uuid(),
  evento_id   uuid not null references public.colectivo_eventos(id) on delete cascade,
  producto_id uuid not null references public.colectivo_productos(id) on delete cascade,
  habilitado  boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint colectivo_evento_productos_evento_producto_key unique (evento_id, producto_id)
);

-- El unique (evento_id, producto_id) ya indexa por evento; falta el lado del producto.
create index if not exists idx_colectivo_evento_productos_producto
  on public.colectivo_evento_productos (producto_id);

comment on table public.colectivo_evento_productos is
  'Colectivo: productos del catálogo habilitados para la venta en cada evento. Vendible = producto activo y habilitado en el evento. No forma parte de Finanzas SIM.';

alter table public.colectivo_evento_productos enable row level security;
revoke all on table public.colectivo_evento_productos from public, anon, authenticated;
grant select, insert, update, delete on table public.colectivo_evento_productos to service_role;

insert into public.colectivo_evento_productos (evento_id, producto_id, habilitado)
select e.id, p.id, true
from public.colectivo_eventos e
cross join public.colectivo_productos p
where p.activo
  and not exists (select 1 from public.colectivo_evento_productos)
on conflict (evento_id, producto_id) do nothing;

create or replace function public.colectivo_turnos_turnos_igual_personas()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.cantidad_turnos := new.cantidad_personas;
  return new;
end;
$$;

revoke all on function public.colectivo_turnos_turnos_igual_personas() from public, anon, authenticated;

drop trigger if exists trg_colectivo_turnos_turnos_igual_personas on public.colectivo_turnos;
create trigger trg_colectivo_turnos_turnos_igual_personas
  before insert or update of cantidad_personas, cantidad_turnos on public.colectivo_turnos
  for each row execute function public.colectivo_turnos_turnos_igual_personas();
