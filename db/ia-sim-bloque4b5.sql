-- ============================================================================
-- IA SIM · Bloque 4B.5 — Saldo restante de créditos prepagados de Anthropic
-- ----------------------------------------------------------------------------
-- Aplicar SOLO a SIM WEB (bcmoewwhsyxsiyvroarj). ADITIVO/IDEMPOTENTE.
-- Solo tablas ia_*. No toca datos de negocio. RLS deny-by-default (sin policies
-- → acceso solo con service_role). NUNCA se guarda la credencial administrativa
-- (ANTHROPIC_ADMIN_KEY): esta migración no tiene ninguna columna para secretos.
--
-- Fuentes SEPARADAS:
--   • Consumo interno estimado  → ia_consumo (por tokens; ya existe, bloque 4A/4B.4).
--   • Costos oficiales Anthropic → ia_costos_oficiales_snapshots (Cost Report).
-- Saldo calculado = Σ(movimientos confirmados) − costo oficial acumulado.
-- ============================================================================

-- ── 1) Libro auditable de movimientos de crédito ─────────────────────────────
-- importe_usd es el efecto CON SIGNO sobre el saldo (carga/ajuste+ → positivo;
-- ajuste−/crédito vencido → negativo; conciliación → diferencia con signo).
-- numeric SIN escala fija: dinero exacto, sin floating point.
create table if not exists public.ia_creditos_movimientos (
  id               uuid primary key default gen_random_uuid(),
  tipo             text not null check (tipo in ('carga','ajuste_positivo','ajuste_negativo','credito_vencido','conciliacion')),
  importe_usd      numeric not null,
  fecha            date not null,                 -- fecha real del movimiento (p. ej. compra)
  descripcion      text not null,
  actor            text not null,                 -- identidad server-side (no la sesión)
  referencia       text,                          -- opcional (factura, nota)
  idempotency_key  text,                          -- evita duplicar la misma carga
  estado           text not null default 'confirmado' check (estado in ('confirmado','anulado')),
  motivo_anulacion text,
  anulado_por      text,
  anulado_at       timestamptz,
  created_at       timestamptz not null default now()
);
create unique index if not exists ia_creditos_mov_idem_uq on public.ia_creditos_movimientos (idempotency_key) where idempotency_key is not null;
create index if not exists ia_creditos_mov_estado_idx on public.ia_creditos_movimientos (estado, fecha desc);

-- ── 2) Snapshots de costos oficiales (Cost Report) ───────────────────────────
-- Cada sync recalcula el TOTAL del rango completo (desde→hasta). El snapshot más
-- reciente es la autoridad del costo acumulado: NO se suman snapshots entre sí
-- (así se evita el doble conteo). por_mes guarda el desglose para la UI.
create table if not exists public.ia_costos_oficiales_snapshots (
  id              uuid primary key default gen_random_uuid(),
  sincronizado_at timestamptz not null default now(),
  desde           date not null,
  hasta           date not null,
  costo_total_usd numeric not null default 0,     -- USD exactos (convertidos de centavos)
  moneda          text not null default 'USD',
  buckets         integer not null default 0,
  paginas         integer not null default 0,
  por_mes         jsonb,                           -- { "2026-08": "0.058...", ... } USD
  estado          text not null default 'ok' check (estado in ('ok','parcial','error','no_configurada')),
  actor           text not null,
  advertencias    text[],
  created_at      timestamptz not null default now()
);
create index if not exists ia_costos_snap_fecha_idx on public.ia_costos_oficiales_snapshots (sincronizado_at desc);

-- ── 3) Conciliaciones con el saldo observado en Anthropic Console ─────────────
create table if not exists public.ia_saldo_conciliaciones (
  id                  uuid primary key default gen_random_uuid(),
  saldo_calculado_usd numeric not null,
  saldo_observado_usd numeric not null,
  diferencia_usd      numeric not null,           -- observado − calculado
  motivo              text,
  actor               text not null,
  movimiento_ajuste_id uuid references public.ia_creditos_movimientos(id),
  created_at          timestamptz not null default now()
);

alter table public.ia_creditos_movimientos        enable row level security;
alter table public.ia_costos_oficiales_snapshots   enable row level security;
alter table public.ia_saldo_conciliaciones         enable row level security;
-- Deny-by-default: SIN policies. Acceso solo con service_role.

-- ── RPC: registrar movimiento (idempotente por idempotency_key) ──────────────
create or replace function public.ia_creditos_registrar_movimiento(
  p_tipo text, p_importe numeric, p_fecha date, p_desc text, p_actor text, p_ref text, p_idem text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_row public.ia_creditos_movimientos;
begin
  if p_idem is not null then
    select * into v_row from public.ia_creditos_movimientos where idempotency_key = p_idem;
    if found then
      return jsonb_build_object('ok', true, 'duplicado', true, 'id', v_row.id, 'tipo', v_row.tipo, 'importe_usd', v_row.importe_usd::text);
    end if;
  end if;
  insert into public.ia_creditos_movimientos (tipo, importe_usd, fecha, descripcion, actor, referencia, idempotency_key)
  values (p_tipo, p_importe, p_fecha, p_desc, p_actor, p_ref, p_idem)
  returning * into v_row;
  return jsonb_build_object('ok', true, 'duplicado', false, 'id', v_row.id, 'tipo', v_row.tipo, 'importe_usd', v_row.importe_usd::text);
exception when unique_violation then
  -- Carrera con el mismo idempotency_key: devolver el existente (no duplica).
  select * into v_row from public.ia_creditos_movimientos where idempotency_key = p_idem;
  return jsonb_build_object('ok', true, 'duplicado', true, 'id', v_row.id, 'tipo', v_row.tipo, 'importe_usd', v_row.importe_usd::text);
end;
$$;

-- ── RPC: anular un movimiento confirmado (conserva historial; no borra) ──────
create or replace function public.ia_creditos_anular_movimiento(p_id uuid, p_motivo text, p_actor text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_estado text;
begin
  update public.ia_creditos_movimientos
     set estado = 'anulado', motivo_anulacion = p_motivo, anulado_por = p_actor, anulado_at = now()
   where id = p_id and estado = 'confirmado'
   returning estado into v_estado;
  if v_estado is null then
    return jsonb_build_object('ok', false, 'motivo', 'no_confirmado_o_inexistente');
  end if;
  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

-- ── RPC: saldo exacto (resta en numeric, sin floating point) ─────────────────
create or replace function public.ia_creditos_saldo()
returns jsonb
language sql security definer set search_path = public
as $$
  with mov as (
    select coalesce(sum(importe_usd) filter (where estado = 'confirmado'), 0) as cargas
      from public.ia_creditos_movimientos
  ),
  snap as (
    select costo_total_usd, sincronizado_at, estado, desde, hasta, moneda, por_mes
      from public.ia_costos_oficiales_snapshots
     order by sincronizado_at desc limit 1
  )
  select jsonb_build_object(
    'cargas_total_usd',    (select cargas from mov)::text,
    'costo_oficial_usd',   coalesce((select costo_total_usd from snap), 0)::text,
    'saldo_calculado_usd', ((select cargas from mov) - coalesce((select costo_total_usd from snap), 0))::text,
    'hay_snapshot',        exists(select 1 from snap),
    'ultima_sync',         (select sincronizado_at from snap),
    'sync_estado',         (select estado from snap),
    'sync_desde',          (select desde from snap),
    'sync_hasta',          (select hasta from snap),
    'sync_moneda',         (select moneda from snap),
    'costos_por_mes',      (select por_mes from snap)
  );
$$;

revoke all on function public.ia_creditos_registrar_movimiento(text, numeric, date, text, text, text, text) from public, anon, authenticated;
revoke all on function public.ia_creditos_anular_movimiento(uuid, text, text) from public, anon, authenticated;
revoke all on function public.ia_creditos_saldo() from public, anon, authenticated;
grant execute on function public.ia_creditos_registrar_movimiento(text, numeric, date, text, text, text, text) to service_role;
grant execute on function public.ia_creditos_anular_movimiento(uuid, text, text) to service_role;
grant execute on function public.ia_creditos_saldo() to service_role;
