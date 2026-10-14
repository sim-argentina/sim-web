-- ============================================================================
-- Colectivo — Caja del evento (bloque 1): gastos del evento.
-- ----------------------------------------------------------------------------
-- La caja del Colectivo es interna al evento y NO forma parte de Finanzas SIM:
-- no crea fin_movimientos, no toca saldos, cierres, categorías ni funciones fin_*,
-- y ninguna consulta de Finanzas lee esta tabla.
--
--   · Un gasto pertenece a un evento (FK; si se borra el evento, se borran sus
--     gastos, igual que turnos y ventas — la ruta de eliminar evento lo impide
--     mientras tenga gastos vigentes).
--   · Categorías y medios de pago: listas fijas del bloque 1 (lib/colectivo.ts).
--   · monto: pesos con hasta 2 decimales, mayor a 0.
--   · Eliminar es lógico (eliminado_at / eliminado_por): el gasto deja de contar
--     y de listarse, pero queda en la base. Lo puede hacer staff, por eso no se
--     borra físicamente.
--   · created_by / eliminado_por: lo único que firma la sesión, el rol.
--   · Deny by default: RLS sin policies; solo service_role (supabaseAdmin).
-- Aditiva e idempotente. Verificación: db/colectivo-caja-bloque1.verificacion.sql.
-- ============================================================================

create table if not exists public.colectivo_gastos (
  id            uuid primary key default gen_random_uuid(),
  evento_id     uuid not null references public.colectivo_eventos(id) on delete cascade,
  fecha         date not null,
  categoria     text not null,
  concepto      text not null,
  monto         numeric(14, 2) not null,
  medio_pago    text not null,
  observaciones text,
  created_by    text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  eliminado_at  timestamptz,
  eliminado_por text,
  constraint colectivo_gastos_monto_chk check (monto > 0),
  constraint colectivo_gastos_categoria_chk
    check (categoria in ('combustible', 'peajes', 'comida', 'insumos', 'estacionamiento', 'otros')),
  constraint colectivo_gastos_medio_pago_chk
    check (medio_pago in ('efectivo', 'transferencia', 'tarjeta', 'otro')),
  constraint colectivo_gastos_concepto_chk check (char_length(btrim(concepto)) between 1 and 120),
  constraint colectivo_gastos_actor_chk
    check (created_by in ('admin', 'staff') and (eliminado_por is null or eliminado_por in ('admin', 'staff')))
);

-- Por evento y fecha (cubre también la búsqueda solo por evento).
create index if not exists idx_colectivo_gastos_evento_fecha
  on public.colectivo_gastos (evento_id, fecha);

comment on table public.colectivo_gastos is
  'Colectivo: gastos de la caja de cada evento (uso interno del Colectivo). No forma parte de Finanzas SIM.';

alter table public.colectivo_gastos enable row level security;
revoke all on table public.colectivo_gastos from public, anon, authenticated;
grant select, insert, update, delete on table public.colectivo_gastos to service_role;
