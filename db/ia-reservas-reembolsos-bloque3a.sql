-- ============================================================================
-- IA SIM · Bloque 3A — Reembolsos completos de Reservas web
-- ----------------------------------------------------------------------------
-- Fuente de verdad. Aplicado a SIM WEB (bcmoewwhsyxsiyvroarj). ADITIVO/IDEMPOTENTE.
-- SIM solo REGISTRA que el dinero ya fue devuelto por fuera (Mercado Pago). No
-- ejecuta reembolsos en MP. Solo reembolsos COMPLETOS (no parciales).
--
-- Modelo elegido (una sola fuente de verdad):
--  · Tabla reservas_reembolsos (detalle/auditoría, UNIQUE por reserva).
--  · La RPC pone reservas.estado='reembolsada' (terminal, NO 'activa') → se
--    auto-excluye de Turnero/disponibilidad/métricas (todo filtra ='activa') y
--    libera el cupo borrando reserva_slots (igual que una cancelación).
--  · Finanzas: el INGRESO del cobro se mantiene en el mes de created_at contando
--    estado in ('activa','reembolsada') → NO se reescribe el mes original. El
--    reembolso impacta como negativo en el mes de fecha_reembolso (Finanzas lo
--    lee aparte). Los meses cerrados se respetan (la RPC rechaza si el mes del
--    reembolso está cerrado).
-- ============================================================================

create table if not exists public.reservas_reembolsos (
  id                 uuid primary key default gen_random_uuid(),
  reserva_id         bigint not null references public.reservas(id),
  monto_reembolsado  numeric not null,
  fecha_reembolso    date not null,
  origen_registro    text not null default 'manual_externo',
  motivo             text,
  actor              text not null default 'Administrador',
  reserva_snapshot   jsonb,
  created_at         timestamptz not null default now(),
  constraint reservas_reembolsos_reserva_uq unique (reserva_id),   -- máximo un reembolso completo
  constraint reservas_reembolsos_monto_chk  check (monto_reembolsado >= 0)
);
create index if not exists reservas_reembolsos_fecha_idx on public.reservas_reembolsos (fecha_reembolso);
alter table public.reservas_reembolsos enable row level security;
-- Deny-by-default: SIN policies (solo service_role).

-- ── fin_ingresos_por_mes: el ingreso de reservas cuenta activa + reembolsada ──
-- Así el mes del cobro (created_at) NO se reescribe al reembolsar. El reembolso se
-- muestra por separado en el mes de su fecha_reembolso (ver lib/reservasReembolsos).
create or replace function public.fin_ingresos_por_mes(p_mes text)
 returns table(fuente text, metodo text, total numeric, cantidad numeric)
 language sql stable
as $function$
  with ts as (
    select * from turnos_stand
    where to_char(fecha, 'YYYY-MM') = p_mes
      and (estado is null or estado <> 'cancelado')
  ),
  ts_montos as (
    select
      case
        when jsonb_typeof(t.pagos_detalle) = 'array' and jsonb_array_length(t.pagos_detalle) > 0
          then coalesce(nullif(trim(p.value->>'metodo_pago'), ''), 'desconocido')
        else coalesce(nullif(trim(t.metodo_pago), ''), 'desconocido')
      end as metodo,
      case
        when jsonb_typeof(t.pagos_detalle) = 'array' and jsonb_array_length(t.pagos_detalle) > 0
          then coalesce((p.value->>'monto')::numeric, 0)
        else coalesce(t.total, 0)
      end as monto
    from ts t
    left join lateral jsonb_array_elements(
      case when jsonb_typeof(t.pagos_detalle) = 'array' then t.pagos_detalle else '[]'::jsonb end
    ) p on jsonb_typeof(t.pagos_detalle) = 'array' and jsonb_array_length(t.pagos_detalle) > 0
  ),
  ts_turnos as (
    select coalesce(sum(coalesce(cantidad_turnos, 1)), 0) as turnos from ts
  )

  select 'turnero'::text, m.metodo, coalesce(sum(m.monto), 0), (select turnos from ts_turnos)
  from ts_montos m group by m.metodo

  union all

  select 'reservas_online'::text, 'mercadopago'::text,
         coalesce(sum(total), 0), count(*)::numeric
  from reservas
  where to_char(created_at at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') = p_mes
    and estado in ('activa','reembolsada')   -- reembolsada SIGUE contando el cobro en su mes original
    and (origen is null or origen <> 'empresa')

  union all

  select 'gift_cards'::text, 'mercadopago'::text,
         coalesce(sum(monto), 0), count(*)::numeric
  from gift_cards
  where estado_pago = 'pagado'
    and fecha_pago is not null
    and to_char(fecha_pago at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') = p_mes

  union all

  select 'campeonatos'::text,
         coalesce(nullif(trim(metodo_pago), ''), 'mercadopago'),
         coalesce(sum(monto), 0), count(*)::numeric
  from campeonato_inscripciones
  where estado_pago = 'pagado'
    and eliminada_at is null
    and to_char(created_at at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') = p_mes
  group by 2;
$function$;

-- ── RPC: registrar reembolso completo (ATÓMICA) ───────────────────────────────
create or replace function public.reservas_registrar_reembolso(p_reserva_id bigint, p_fecha_reembolso date, p_motivo text)
returns public.reservas_reembolsos
language plpgsql security definer set search_path = public
as $$
declare
  v_res   public.reservas;
  v_ref   public.reservas_reembolsos;
  v_hoy   date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_cobro date;
  v_mes   text := to_char(p_fecha_reembolso, 'YYYY-MM');
begin
  -- 1) Bloquear la reserva.
  select * into v_res from public.reservas where id = p_reserva_id for update;
  if v_res.id is null then
    raise exception 'reserva_inexistente' using errcode = 'P0002';
  end if;

  -- 2/3) Debe estar pagada/aprobada (activa) y no reembolsada.
  if v_res.estado = 'reembolsada' or exists (select 1 from public.reservas_reembolsos where reserva_id = p_reserva_id) then
    raise exception 'ya_reembolsada' using errcode = '23505';
  end if;
  if v_res.estado <> 'activa' then
    raise exception 'reserva_no_pagada' using errcode = '22023';
  end if;

  -- 4) Monto SIEMPRE del servidor (importe efectivamente pagado).
  -- 5) Validar fecha del reembolso: no futura, no anterior al cobro.
  v_cobro := (v_res.created_at at time zone 'America/Argentina/Buenos_Aires')::date;
  if p_fecha_reembolso > v_hoy then
    raise exception 'fecha_futura' using errcode = '22007';
  end if;
  if p_fecha_reembolso < v_cobro then
    raise exception 'fecha_anterior_cobro' using errcode = '22007';
  end if;

  -- 6) Mes financiero del reembolso no puede estar cerrado.
  if exists (select 1 from public.fin_cierres_mensuales c where c.mes = v_mes and c.estado <> 'abierto') then
    raise exception 'mes_cerrado:%', v_mes using errcode = '22023';
  end if;

  -- 7) Insertar reembolso (snapshot mínimo para auditoría).
  insert into public.reservas_reembolsos (reserva_id, monto_reembolsado, fecha_reembolso, motivo, reserva_snapshot)
  values (
    p_reserva_id, coalesce(v_res.total, 0), p_fecha_reembolso, nullif(btrim(coalesce(p_motivo, '')), ''),
    jsonb_build_object('estado_anterior', v_res.estado, 'total', v_res.total, 'fecha', v_res.fecha, 'hora', v_res.hora,
                       'created_at', v_res.created_at, 'payment_id', v_res.mercado_pago_payment_id)
  )
  returning * into v_ref;

  -- 8) Estado terminal + liberar cupo (borrar slots activos como en una cancelación).
  update public.reservas set estado = 'reembolsada' where id = p_reserva_id;
  delete from public.reserva_slots where reserva_id = p_reserva_id;

  return v_ref;
end;
$$;

revoke all on function public.reservas_registrar_reembolso(bigint, date, text) from public, anon, authenticated;
grant execute on function public.reservas_registrar_reembolso(bigint, date, text) to service_role;
