-- ============================================================================
-- IA SIM · Bloque 4B.5.1 — Saldo estimado dinámico sin Admin API
-- ----------------------------------------------------------------------------
-- Aplicar SOLO a SIM WEB (bcmoewwhsyxsiyvroarj). ADITIVO/IDEMPOTENTE.
-- Solo tablas ia_*. No borra ni recrea movimientos/conciliaciones. RLS deny-by-default.
-- ============================================================================

-- 1) Conciliaciones: snapshot inmutable del baseline de costo interno al conciliar.
alter table public.ia_saldo_conciliaciones add column if not exists costo_interno_baseline numeric;
alter table public.ia_saldo_conciliaciones add column if not exists fuente text not null default 'anthropic_console_manual';
alter table public.ia_saldo_conciliaciones add column if not exists estado text not null default 'ok';
alter table public.ia_saldo_conciliaciones add column if not exists baseline_reconstruido boolean not null default false;
alter table public.ia_saldo_conciliaciones add column if not exists notas text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ia_conc_estado_chk') then
    alter table public.ia_saldo_conciliaciones add constraint ia_conc_estado_chk check (estado in ('ok','pendiente_recalibracion'));
  end if;
end $$;

-- 2) Ejecuciones de chat: costo por ejecución (congelado) + versión de precios usada.
--    Permite reconstruir el costo interno acumulado a cualquier instante sin recalcular
--    el histórico con precios futuros.
alter table public.ia_ejecuciones add column if not exists costo_estimado numeric;
alter table public.ia_ejecuciones add column if not exists precios_version text;

-- 3) Estado de la sincronización oficial (Cost Report). Guarda un estado seguro tras
--    un 401/403 conocido; no se llama al Cost Report en cada carga de página.
create table if not exists public.ia_creditos_sync_estado (
  owner             text primary key,
  estado            text not null default 'sin_sincronizacion_oficial'
                      check (estado in ('sin_sincronizacion_oficial','ok','error')),
  ultimo_error      text,                -- sanitizado (sin credenciales ni cuerpos completos)
  ultimo_intento_at timestamptz,
  ultimo_exito_at   timestamptz,
  updated_at        timestamptz not null default now()
);
alter table public.ia_creditos_sync_estado enable row level security;
-- Deny-by-default: sin policies → solo service_role.

-- 4) Costo interno acumulado (real, no fake) hasta un instante (o total si null).
--    Fuente COMPLETA: chat (ia_ejecuciones) + OCR/visión (ia_ocr_resultados). Excluye
--    proveedor fake. NO incluye render local de 4C (no genera ejecuciones ni OCR).
create or replace function public.ia_costo_interno_acumulado(p_hasta timestamptz default null)
returns numeric
language sql security definer set search_path = public
as $$
  select
    coalesce((
      select sum(coalesce(costo_estimado, 0))
        from public.ia_ejecuciones
       where coalesce(proveedor,'') <> 'fake'
         and (p_hasta is null or created_at <= p_hasta)
    ), 0)
    +
    coalesce((
      select sum(coalesce(costo_estimado, 0))
        from public.ia_ocr_resultados
       where coalesce(proveedor,'') <> 'fake'
         and (p_hasta is null or created_at <= p_hasta)
    ), 0);
$$;

revoke all on function public.ia_costo_interno_acumulado(timestamptz) from public, anon, authenticated;
grant execute on function public.ia_costo_interno_acumulado(timestamptz) to service_role;
