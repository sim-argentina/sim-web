-- ============================================================================
-- Colectivo — Caja del evento (bloque 2): categorías administrables y costos
-- vs. gastos.
-- ----------------------------------------------------------------------------
-- La caja del Colectivo es interna al evento y NO forma parte de Finanzas SIM:
-- nada de esto toca, lee ni referencia tablas o funciones fin_*.
--
-- 1. colectivo_caja_categorias: catálogo que administra el admin. Cada categoría
--    tiene nombre, tipo ('costo' | 'gasto') y activo. Nombre único sin distinguir
--    mayúsculas ni espacios repetidos.
-- 2. Siembra única (solo con la tabla vacía): las seis categorías fijas del
--    bloque 1 con su clasificación inicial. Volver a aplicar el archivo no las
--    recrea si el admin las renombró o borró.
-- 3. colectivo_gastos (movimientos de la caja) pasa a usar categoria_id (FK sin
--    ON DELETE: una categoría usada no se puede borrar) y guarda, por movimiento,
--    lo que valía al registrarlo:
--      tipo              costo | gasto efectivo del movimiento
--      categoria_nombre  nombre de la categoría en ese momento
--    Cambiar el nombre o el tipo de una categoría, o desactivarla, no reescribe
--    movimientos viejos. La columna vieja `categoria` (slug del bloque 1) queda
--    como estaba, ya sin NOT NULL y sin uso en el flujo nuevo.
-- 4. Conversión de los movimientos del bloque 1: slug → categoría sembrada, con su
--    tipo y nombre. Idempotente (solo filas sin categoria_id).
-- 5. Cierre: todo movimiento tiene categoría, tipo y nombre (NOT NULL). Si algún
--    movimiento viejo no se pudiera convertir, este paso falla y no deja nada a
--    medias: no se pierde ni se inventa información.
--
-- Producción se aplicó en dos fases (1–4 antes del deploy, compatibles con el
-- código anterior; 4–5 después) para cubrir movimientos cargados en el medio.
-- Verificación: db/colectivo-caja-bloque2.verificacion.sql.
-- ============================================================================

create table if not exists public.colectivo_caja_categorias (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  tipo       text not null,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint colectivo_caja_categorias_tipo_chk check (tipo in ('costo', 'gasto')),
  constraint colectivo_caja_categorias_nombre_chk
    check (nombre = btrim(nombre) and char_length(nombre) between 1 and 60)
);

-- Un nombre por categoría, sin distinguir mayúsculas ni espacios repetidos.
create unique index if not exists colectivo_caja_categorias_nombre_key
  on public.colectivo_caja_categorias (lower(regexp_replace(nombre, '[[:space:]]+', ' ', 'g')));

comment on table public.colectivo_caja_categorias is
  'Colectivo: categorías de la caja del evento (costo o gasto), administradas por el admin. No forma parte de Finanzas SIM.';

alter table public.colectivo_caja_categorias enable row level security;
revoke all on table public.colectivo_caja_categorias from public, anon, authenticated;
grant select, insert, update, delete on table public.colectivo_caja_categorias to service_role;

insert into public.colectivo_caja_categorias (nombre, tipo)
select v.nombre, v.tipo
from (values
  ('Combustible', 'costo'),
  ('Peajes', 'costo'),
  ('Comida', 'costo'),
  ('Insumos', 'costo'),
  ('Estacionamiento', 'costo'),
  ('Otros', 'gasto')
) as v(nombre, tipo)
where not exists (select 1 from public.colectivo_caja_categorias);

alter table public.colectivo_gastos
  add column if not exists categoria_id uuid references public.colectivo_caja_categorias(id);
alter table public.colectivo_gastos add column if not exists tipo text;
alter table public.colectivo_gastos add column if not exists categoria_nombre text;
alter table public.colectivo_gastos alter column categoria drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'colectivo_gastos_tipo_chk') then
    alter table public.colectivo_gastos
      add constraint colectivo_gastos_tipo_chk check (tipo in ('costo', 'gasto'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'colectivo_gastos_categoria_nombre_chk') then
    alter table public.colectivo_gastos
      add constraint colectivo_gastos_categoria_nombre_chk check (char_length(categoria_nombre) between 1 and 60);
  end if;
end;
$$;

create index if not exists idx_colectivo_gastos_categoria
  on public.colectivo_gastos (categoria_id);

update public.colectivo_gastos g
set categoria_id = c.id, tipo = c.tipo, categoria_nombre = c.nombre
from (values
  ('combustible', 'Combustible'),
  ('peajes', 'Peajes'),
  ('comida', 'Comida'),
  ('insumos', 'Insumos'),
  ('estacionamiento', 'Estacionamiento'),
  ('otros', 'Otros')
) as m(slug, nombre)
join public.colectivo_caja_categorias c on lower(c.nombre) = lower(m.nombre)
where g.categoria_id is null and g.categoria = m.slug;

alter table public.colectivo_gastos alter column categoria_id set not null;
alter table public.colectivo_gastos alter column tipo set not null;
alter table public.colectivo_gastos alter column categoria_nombre set not null;
