-- ============================================================================
-- Mensualidades SIM · Bloque M2 — Modelo de datos y operación atómica de compra
-- ----------------------------------------------------------------------------
-- Fuente de verdad. Aplicado a SIM WEB (bcmoewwhsyxsiyvroarj). ADITIVO/IDEMPOTENTE.
-- NO toca reservas, reserva_slots, gift_cards, empresa_*, fin_* ni campeonato_*.
--
-- Modelo (5 tablas, cada una con un motivo distinto):
--   1. mensualidad_planes      → catálogo EDITABLE (precio/minutos/vigencia/etiqueta).
--   2. mensualidades           → BILLETERA del titular: saldo vivo + código + vigencia.
--                                Una fila por ciclo de vida (renovar reusa la fila y el
--                                código; comprar ya vencida crea fila y código nuevos).
--   3. mensualidad_compras     → cada compra/renovación como TRANSACCIÓN histórica con
--                                snapshot inmutable del plan + datos financieros de MP.
--                                Editar un plan NO reescribe compras anteriores.
--   4. mensualidad_movimientos → LIBRO MAYOR de minutos (saldo_anterior/posterior).
--   5. mensualidad_auditoria   → acciones administrativas sensibles.
--
-- Estados PERSISTIDOS (no derivables):
--   · mensualidades.bloqueada        → decisión explícita del admin.
--   · mensualidad_compras.estado_pago  (pendiente|aprobado|rechazado|cancelado)
--   · mensualidad_compras.procesamiento (pendiente|aplicado|ignorado)
-- Estado CALCULADO (nunca se persiste, no puede quedar desactualizado):
--   · estado de la mensualidad = mensualidad_estado(saldo, vence_el, bloqueada, hoy)
--     → bloqueada > vencida > agotada > vigente (en ese orden de precedencia).
--
-- Reglas de negocio cerradas:
--   · Saldo en MINUTOS de simulador. Consumo = duración × cantidad de simuladores.
--   · Vigencia: vence_el = fecha de aprobación (Córdoba) + vigencia_dias del plan.
--     Utilizable hasta las 23:59:59 de vence_el (por eso es date, no timestamptz).
--   · Renovación (compra con la mensualidad TODAVÍA vigente): mismo código, se
--     trasladan como máximo 60 minutos del saldo anterior, el resto se descarta y
--     queda registrado, y se suma el plan completo. La vigencia arranca de cero.
--   · Compra con la mensualidad vencida: código nuevo, saldo = plan. No se recupera
--     saldo vencido (la fila vieja queda intacta como historia).
-- ============================================================================

-- ── 0) Helpers de fecha, estado, código y teléfono ──────────────────────────

-- "Hoy" operativo de Mensualidades. Córdoba es UTC-3 sin DST.
create or replace function public.mensualidad_hoy()
returns date
language sql stable
set search_path = public
as $$
  select (now() at time zone 'America/Argentina/Cordoba')::date;
$$;

-- Estado derivado. IMMUTABLE porque recibe el "hoy" como parámetro: así se puede
-- usar en vistas y consultas sin sorpresas de estabilidad.
create or replace function public.mensualidad_estado(
  p_saldo integer, p_vence date, p_bloqueada boolean, p_hoy date
)
returns text
language sql immutable
set search_path = public
as $$
  select case
    when coalesce(p_bloqueada, false)   then 'bloqueada'
    when p_vence < p_hoy                then 'vencida'
    when coalesce(p_saldo, 0) <= 0      then 'agotada'
    else 'vigente'
  end;
$$;

-- Normalización ARGENTINA de teléfono (M2.1). Es la clave de identidad para
-- renovar: misma persona → misma billetera. Espejo exacto de normalizarTelefono()
-- en lib/mensualidades.ts.
--
-- Forma canónica: número nacional de 10 dígitos (código de área + local), sin 0,
-- sin 15 y sin +54 9. Ejemplo: 3515123456.
--
-- El plan de numeración argentino tiene tres largos de código de área:
--   · 2 dígitos → solo '11';
--   · 3 dígitos → conjunto fijo y conocido (la lista de abajo);
--   · 4 dígitos → todo el resto, que siempre empieza con 2 o 3.
-- Como área + local = 10 SIEMPRE, el largo del área dice exactamente dónde puede
-- estar el '15' histórico: pegado al final del código de área. La interpretación
-- es única (ningún código de 4 dígitos empieza con 1, y '11' es el único de 2),
-- así que no hay que elegir entre alternativas. Si el '15' no está en ese borde,
-- se RECHAZA en vez de reubicarlo: asociar la mensualidad a otra persona es peor
-- que pedir el número de nuevo. Devuelve NULL cuando no es interpretable.
create or replace function public.mensualidad_normalizar_telefono(p_tel text)
returns text
language plpgsql immutable
set search_path = public
as $$
declare
  c_areas3 constant text[] := array[
    '220','221','223','230','236','237','249',
    '260','261','263','264','266','280','291','294','297','299',
    '336','341','342','343','345','348','351','353','358',
    '362','364','370','376','379','380','381','383','385','387','388'];
  v_raw  text := btrim(coalesce(p_tel, ''));
  v_mas  boolean;
  d      text;
  v_area integer;
  v_out  text;
begin
  if v_raw = '' then return null; end if;

  -- 1) Solo dígitos y símbolos de presentación. Letras y demás → rechazo.
  if v_raw ~ '[^0-9+().\-[:space:]]' then return null; end if;
  v_mas := left(v_raw, 1) = '+';
  if length(v_raw) - length(replace(v_raw, '+', '')) > 1 then return null; end if;
  if position('+' in v_raw) > 1 then return null; end if;

  d := regexp_replace(v_raw, '[^0-9]', '', 'g');
  if d = '' then return null; end if;

  -- 2/3) Prefijo internacional: si viene explícito, tiene que ser Argentina (54).
  if v_mas then
    if left(d, 2) <> '54' then return null; end if;
    d := substr(d, 3);
  elsif left(d, 2) = '00' then
    d := substr(d, 3);
    if left(d, 2) <> '54' then return null; end if;
    d := substr(d, 3);
  elsif left(d, 2) = '54' and length(d) >= 12 then
    -- Ningún código de área argentino empieza con 5: solo puede ser el país.
    d := substr(d, 3);
  end if;

  -- 4/5) 9 móvil y 0 de trunk nacional. Ningún código de área empieza con 0 ni 9,
  -- y el corte nunca baja de 10 dígitos, así que no puede comerse un área válida.
  while length(d) > 10 and left(d, 1) in ('0', '9') loop
    d := substr(d, 2);
  end loop;

  -- 7) Canónico: exactamente 10 dígitos.
  if length(d) = 10 then
    if left(d, 2) = '11' then return d; end if;
    if left(d, 1) = '1' then return null; end if;   -- '11' es el único de 2 dígitos
    if left(d, 1) in ('2', '3') then return d; end if;
    return null;
  end if;

  -- 6) 12 dígitos = los 10 del número + el '15' histórico intercalado.
  if length(d) = 12 then
    if left(d, 2) = '11' then
      v_area := 2;
    elsif left(d, 1) = '1' then
      return null;
    elsif left(d, 3) = any (c_areas3) then
      v_area := 3;
    elsif left(d, 1) in ('2', '3') then
      v_area := 4;
    else
      return null;
    end if;

    if substr(d, v_area + 1, 2) <> '15' then return null; end if;
    v_out := left(d, v_area) || substr(d, v_area + 3);
    if length(v_out) <> 10 then return null; end if;
    if left(v_out, 2) <> '11' and left(v_out, 1) not in ('2', '3') then return null; end if;
    return v_out;
  end if;

  -- 8/9) Nada de "tomar los últimos 10": cualquier otro largo se rechaza.
  return null;
end;
$$;

-- Normalización de código: mayúsculas, sin separadores, formato MEN-XXXX-XXXX.
-- Devuelve NULL si tiene caracteres fuera del alfabeto (no adivina: 0/O y 1/I son
-- ambiguos y el alfabeto los excluye a propósito).
create or replace function public.mensualidad_normalizar_codigo(p_codigo text)
returns text
language plpgsql immutable
set search_path = public
as $$
declare
  v text := upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if v like 'MEN%' then v := substr(v, 4); end if;
  if length(v) <> 8 then return null; end if;
  if v !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$' then return null; end if;
  return 'MEN-' || substr(v, 1, 4) || '-' || substr(v, 5, 4);
end;
$$;

-- Código único MEN-XXXX-XXXX. Mismo alfabeto y calidad criptográfica que
-- generarCodigoGiftCard() (sin 0/O/1/I), pero entidad y prefijo propios: una
-- mensualidad NO es una gift card. 32 símbolos ⇒ 256 % 32 = 0 ⇒ sin sesgo.
create or replace function public.mensualidad_generar_codigo()
returns text
language plpgsql volatile
set search_path = public
as $$
declare
  v_alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_cod   text;
  i       integer;
begin
  for _intento in 1..20 loop
    v_cod   := '';
    v_bytes := extensions.gen_random_bytes(8);
    for i in 0..7 loop
      v_cod := v_cod || substr(v_alfabeto, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    v_cod := 'MEN-' || substr(v_cod, 1, 4) || '-' || substr(v_cod, 5, 4);
    if not exists (select 1 from public.mensualidades where codigo = v_cod) then
      return v_cod;
    end if;
  end loop;
  raise exception 'no_se_pudo_generar_codigo' using errcode = '55000';
end;
$$;

-- updated_at automático (mismo patrón que fin_set_updated_at).
create or replace function public.mensualidad_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── 1) Catálogo de planes ────────────────────────────────────────────────────

create table if not exists public.mensualidad_planes (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null,
  nombre         text not null,
  minutos        integer not null,
  precio         numeric(12,2) not null,
  vigencia_dias  integer not null default 30,
  etiqueta       text,
  orden          integer not null default 0,
  activo         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint mensualidad_planes_slug_uq       unique (slug),
  constraint mensualidad_planes_slug_chk      check (slug ~ '^[a-z0-9_-]{1,32}$'),
  constraint mensualidad_planes_nombre_chk    check (btrim(nombre) <> ''),
  -- Los minutos SIEMPRE son múltiplo de 15 (duraciones 15/30/45/60 × 1..4 sims).
  constraint mensualidad_planes_minutos_chk   check (minutos > 0 and minutos % 15 = 0),
  constraint mensualidad_planes_precio_chk    check (precio >= 0),
  constraint mensualidad_planes_vigencia_chk  check (vigencia_dias between 1 and 365),
  constraint mensualidad_planes_orden_chk     check (orden >= 0)
);

create index if not exists mensualidad_planes_activo_idx
  on public.mensualidad_planes (activo, orden);

drop trigger if exists trg_mensualidad_planes_updated on public.mensualidad_planes;
create trigger trg_mensualidad_planes_updated
  before update on public.mensualidad_planes
  for each row execute function public.mensualidad_set_updated_at();

-- ── 2) Billetera del titular ─────────────────────────────────────────────────

create table if not exists public.mensualidades (
  id                uuid primary key default gen_random_uuid(),
  codigo            text not null,
  titular_nombre    text not null,
  titular_apellido  text not null,
  titular_telefono  text not null,            -- tal como lo escribió el titular
  telefono_norm     text not null,            -- clave de identidad para renovar
  titular_email     text not null,
  saldo_minutos     integer not null default 0,
  vence_el          date not null,            -- utilizable hasta las 23:59:59 de este día
  bloqueada         boolean not null default false,
  bloqueo_motivo    text,
  observaciones     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint mensualidades_codigo_uq     unique (codigo),
  constraint mensualidades_codigo_chk    check (codigo ~ '^MEN-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$'),
  constraint mensualidades_nombre_chk    check (btrim(titular_nombre) <> ''),
  constraint mensualidades_apellido_chk  check (btrim(titular_apellido) <> ''),
  constraint mensualidades_telnorm_chk   check (telefono_norm ~ '^[0-9]{8,15}$'),
  constraint mensualidades_email_chk     check (position('@' in titular_email) > 1),
  -- El saldo NUNCA puede ser negativo y siempre es múltiplo de 15.
  constraint mensualidades_saldo_chk     check (saldo_minutos >= 0 and saldo_minutos % 15 = 0)
);

create index if not exists mensualidades_telefono_idx  on public.mensualidades (telefono_norm, vence_el desc);
create index if not exists mensualidades_vence_idx     on public.mensualidades (vence_el desc);
create index if not exists mensualidades_creadas_idx   on public.mensualidades (created_at desc);

drop trigger if exists trg_mensualidades_updated on public.mensualidades;
create trigger trg_mensualidades_updated
  before update on public.mensualidades
  for each row execute function public.mensualidad_set_updated_at();

-- ── 3) Compras / renovaciones (histórico inmutable) ─────────────────────────
-- La fila nace en 'pendiente' cuando se crea la preferencia de MP (M3): ahí
-- todavía NO se sabe si va a ser alta o renovación, así que las columnas del
-- resultado son NULL hasta que la RPC aplica el pago aprobado.

create table if not exists public.mensualidad_compras (
  id                   uuid primary key default gen_random_uuid(),
  mensualidad_id       uuid references public.mensualidades(id) on delete set null,
  plan_id              uuid references public.mensualidad_planes(id) on delete set null,

  -- Snapshot INMUTABLE del plan comprado (editar el catálogo no lo altera).
  plan_slug            text not null,
  plan_nombre          text not null,
  plan_minutos         integer not null,
  plan_precio          numeric(12,2) not null,
  plan_vigencia_dias   integer not null,
  plan_etiqueta        text,

  -- Datos del comprador en esta compra (el titular de la billetera puede cambiar).
  comprador_nombre     text not null,
  comprador_apellido   text not null,
  comprador_telefono   text not null,
  telefono_norm        text not null,        -- clave del advisory lock
  comprador_email      text not null,

  -- Resultado de aplicar el pago (NULL hasta procesamiento = 'aplicado').
  tipo                 text,                 -- 'alta' | 'renovacion'
  minutos_trasladados  integer,
  minutos_descartados  integer,
  saldo_resultante     integer,
  vence_el             date,

  -- Financiero (lo completa el webhook en M3; lo lee Finanzas en M7).
  importe_bruto        numeric(12,2) not null,
  comision_mp          numeric(12,2),
  importe_neto         numeric(12,2),
  estado_pago          text not null default 'pendiente',
  procesamiento        text not null default 'pendiente',
  mp_preference_id     text,
  mp_payment_id        text,
  external_reference   text,
  idempotency_key      text,
  created_at           timestamptz not null default now(),
  aprobado_at          timestamptz,
  updated_at           timestamptz not null default now(),

  constraint mensualidad_compras_plan_min_chk   check (plan_minutos > 0 and plan_minutos % 15 = 0),
  constraint mensualidad_compras_plan_prec_chk  check (plan_precio >= 0),
  constraint mensualidad_compras_plan_vig_chk   check (plan_vigencia_dias between 1 and 365),
  constraint mensualidad_compras_telnorm_chk    check (telefono_norm ~ '^[0-9]{8,15}$'),
  constraint mensualidad_compras_estado_chk     check (estado_pago in ('pendiente','aprobado','rechazado','cancelado')),
  constraint mensualidad_compras_proc_chk       check (procesamiento in ('pendiente','aplicado','ignorado')),
  constraint mensualidad_compras_tipo_chk       check (tipo is null or tipo in ('alta','renovacion')),
  constraint mensualidad_compras_montos_chk     check (
    importe_bruto >= 0
    and (comision_mp  is null or comision_mp  >= 0)
    and (importe_neto is null or importe_neto >= 0)
  ),
  constraint mensualidad_compras_minutos_chk    check (
    (minutos_trasladados is null or (minutos_trasladados >= 0 and minutos_trasladados % 15 = 0 and minutos_trasladados <= 60))
    and (minutos_descartados is null or (minutos_descartados >= 0 and minutos_descartados % 15 = 0))
    and (saldo_resultante    is null or (saldo_resultante    >= 0 and saldo_resultante    % 15 = 0))
  ),
  -- Una compra aplicada tiene SIEMPRE el resultado completo y el pago identificado.
  constraint mensualidad_compras_aplicada_chk   check (
    procesamiento <> 'aplicado'
    or (mensualidad_id is not null and tipo is not null and minutos_trasladados is not null
        and minutos_descartados is not null and saldo_resultante is not null and vence_el is not null
        and mp_payment_id is not null and aprobado_at is not null and estado_pago = 'aprobado')
  )
);

-- Idempotencia dura: un pago de MP se aplica UNA sola vez.
create unique index if not exists mensualidad_compras_payment_uq
  on public.mensualidad_compras (mp_payment_id) where mp_payment_id is not null;
create unique index if not exists mensualidad_compras_extref_uq
  on public.mensualidad_compras (external_reference) where external_reference is not null;
create unique index if not exists mensualidad_compras_idem_uq
  on public.mensualidad_compras (idempotency_key) where idempotency_key is not null;

create index if not exists mensualidad_compras_mens_idx     on public.mensualidad_compras (mensualidad_id, created_at desc);
create index if not exists mensualidad_compras_telnorm_idx  on public.mensualidad_compras (telefono_norm, created_at desc);
create index if not exists mensualidad_compras_estado_idx   on public.mensualidad_compras (estado_pago, procesamiento);
create index if not exists mensualidad_compras_aprob_idx    on public.mensualidad_compras (aprobado_at desc) where estado_pago = 'aprobado';

drop trigger if exists trg_mensualidad_compras_updated on public.mensualidad_compras;
create trigger trg_mensualidad_compras_updated
  before update on public.mensualidad_compras
  for each row execute function public.mensualidad_set_updated_at();

-- ── 4) Libro mayor de minutos ────────────────────────────────────────────────

create table if not exists public.mensualidad_movimientos (
  id               uuid primary key default gen_random_uuid(),
  mensualidad_id   uuid not null references public.mensualidades(id) on delete cascade,
  compra_id        uuid references public.mensualidad_compras(id) on delete set null,
  reserva_id       bigint references public.reservas(id) on delete set null,
  tipo             text not null,
  minutos          integer not null,   -- >0 acredita · <0 debita
  saldo_anterior   integer not null,
  saldo_posterior  integer not null,
  motivo           text,
  actor            text not null default 'sistema',
  idempotency_key  text,
  created_at       timestamptz not null default now(),
  constraint mensualidad_mov_tipo_chk    check (tipo in ('compra','renovacion','descarte','consumo','devolucion','ajuste_admin')),
  constraint mensualidad_mov_minutos_chk check (minutos <> 0 and minutos % 15 = 0),
  constraint mensualidad_mov_saldos_chk  check (
    saldo_anterior >= 0 and saldo_posterior >= 0
    and saldo_anterior % 15 = 0 and saldo_posterior % 15 = 0
    and saldo_posterior = saldo_anterior + minutos
  )
);

create index if not exists mensualidad_mov_mens_idx on public.mensualidad_movimientos (mensualidad_id, created_at desc);
create unique index if not exists mensualidad_mov_idem_uq
  on public.mensualidad_movimientos (idempotency_key) where idempotency_key is not null;
-- Una reserva consume saldo UNA sola vez (blindaje para M5).
create unique index if not exists mensualidad_mov_consumo_uq
  on public.mensualidad_movimientos (reserva_id) where tipo = 'consumo' and reserva_id is not null;

-- ── 5) Auditoría administrativa ──────────────────────────────────────────────

create table if not exists public.mensualidad_auditoria (
  id               uuid primary key default gen_random_uuid(),
  mensualidad_id   uuid references public.mensualidades(id) on delete cascade,
  accion           text not null,
  actor            text not null,
  actor_rol        text not null default 'admin',
  valor_anterior   jsonb,
  valor_nuevo      jsonb,
  motivo           text not null,
  referencia       text,
  created_at       timestamptz not null default now(),
  constraint mensualidad_aud_accion_chk check (btrim(accion) <> ''),
  constraint mensualidad_aud_actor_chk  check (btrim(actor) <> ''),
  constraint mensualidad_aud_rol_chk    check (actor_rol in ('admin','staff','sistema')),
  constraint mensualidad_aud_motivo_chk check (btrim(motivo) <> '')
);

create index if not exists mensualidad_aud_mens_idx on public.mensualidad_auditoria (mensualidad_id, created_at desc);
create index if not exists mensualidad_aud_fecha_idx on public.mensualidad_auditoria (created_at desc);

-- ── 6) RLS: deny-by-default en las cinco tablas ─────────────────────────────
-- Ninguna tiene policies: solo service_role (vía supabaseAdmin) puede tocarlas.
-- Los revoke explícitos cubren el caso de que la migración corra con un rol cuyos
-- default privileges otorguen permisos a anon/authenticated.

alter table public.mensualidad_planes      enable row level security;
alter table public.mensualidades           enable row level security;
alter table public.mensualidad_compras     enable row level security;
alter table public.mensualidad_movimientos enable row level security;
alter table public.mensualidad_auditoria   enable row level security;

revoke all on table public.mensualidad_planes      from public, anon, authenticated;
revoke all on table public.mensualidades           from public, anon, authenticated;
revoke all on table public.mensualidad_compras     from public, anon, authenticated;
revoke all on table public.mensualidad_movimientos from public, anon, authenticated;
revoke all on table public.mensualidad_auditoria   from public, anon, authenticated;

grant select, insert, update, delete on table public.mensualidad_planes      to service_role;
grant select, insert, update, delete on table public.mensualidades           to service_role;
grant select, insert, update, delete on table public.mensualidad_compras     to service_role;
grant select, insert, update, delete on table public.mensualidad_movimientos to service_role;
grant select, insert, update, delete on table public.mensualidad_auditoria   to service_role;

-- ── 7) Vista de lectura con el estado calculado ─────────────────────────────
-- security_invoker: la vista NO puede usarse para saltear el RLS de la tabla.

create or replace view public.mensualidades_estado
with (security_invoker = true) as
select
  m.*,
  public.mensualidad_estado(m.saldo_minutos, m.vence_el, m.bloqueada, public.mensualidad_hoy()) as estado,
  (m.vence_el - public.mensualidad_hoy()) as dias_restantes
from public.mensualidades m;

revoke all on public.mensualidades_estado from public, anon, authenticated;
grant select on public.mensualidades_estado to service_role;

-- ── 8) Operación atómica: aplicar una compra APROBADA ───────────────────────
-- La llama el webhook de MP (M3) con service_role. Todo o nada.
--
-- Concurrencia:
--   · Idempotencia por mp_payment_id (índice único + salida temprana estable).
--   · FOR UPDATE sobre la compra y sobre la billetera existente.
--   · pg_advisory_xact_lock por telefono_norm: serializa también el caso "todavía
--     no existe ninguna billetera para este teléfono", donde FOR UPDATE no tiene
--     fila que bloquear y dos altas simultáneas crearían dos billeteras.

create or replace function public.mensualidad_aplicar_compra(
  p_external_reference text,
  p_mp_payment_id      text,
  p_importe_bruto      numeric     default null,
  p_comision_mp        numeric     default null,
  p_importe_neto       numeric     default null,
  p_aprobado_at        timestamptz default now()
)
returns public.mensualidad_compras
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Tope de minutos que se arrastran al renovar (decisión de negocio cerrada).
  c_max_traslado constant integer := 60;
  v_compra    public.mensualidad_compras;
  v_mens      public.mensualidades;
  v_hoy       date;
  v_vence     date;
  v_traslado  integer := 0;
  v_descarte  integer := 0;
  v_saldo_ini integer := 0;
  v_saldo_fin integer;
  v_tipo      text;
  v_codigo    text;
begin
  if coalesce(btrim(p_external_reference), '') = '' then
    raise exception 'external_reference_requerida' using errcode = '22023';
  end if;
  if coalesce(btrim(p_mp_payment_id), '') = '' then
    raise exception 'payment_id_requerido' using errcode = '22023';
  end if;

  -- 1) Idempotencia por pago: si este payment_id ya se aplicó, devolver lo mismo.
  --    Si además viene con OTRA external_reference, es un error de datos (un pago
  --    de MP pertenece a una sola compra): se rechaza en vez de devolver la fila
  --    equivocada, que dejaría la compra nueva sin aplicar y sin aviso.
  select * into v_compra
    from public.mensualidad_compras
   where mp_payment_id = p_mp_payment_id and procesamiento = 'aplicado'
   limit 1;
  if found then
    if v_compra.external_reference is distinct from p_external_reference then
      raise exception 'payment_id_de_otra_compra' using errcode = '23505';
    end if;
    return v_compra;
  end if;

  -- 2) Tomar la compra pendiente y bloquearla.
  select * into v_compra
    from public.mensualidad_compras
   where external_reference = p_external_reference
   for update;
  if not found then
    raise exception 'compra_inexistente' using errcode = 'P0002';
  end if;

  -- 3) Reintento sobre una compra ya aplicada (mismo ext_ref): salida estable.
  if v_compra.procesamiento = 'aplicado' then
    return v_compra;
  end if;
  if v_compra.estado_pago <> 'pendiente' then
    raise exception 'compra_no_pendiente' using errcode = '22023';
  end if;

  -- (M2.1) La billetera se busca y se bloquea por telefono_norm: si no llegó en la
  -- forma canónica de 10 dígitos, la identidad del titular no es confiable y una
  -- renovación podría terminar en otra persona. Se corta acá.
  if v_compra.telefono_norm !~ '^[0-9]{10}$' then
    raise exception 'telefono_no_canonico' using errcode = '22023';
  end if;

  v_hoy   := (p_aprobado_at at time zone 'America/Argentina/Cordoba')::date;
  v_vence := v_hoy + v_compra.plan_vigencia_dias;

  -- 4) Serializar por titular ANTES de mirar la billetera (cubre el caso "no existe").
  perform pg_advisory_xact_lock(hashtext('mensualidad:' || v_compra.telefono_norm)::bigint);

  -- 5) Billetera más reciente del teléfono.
  select * into v_mens
    from public.mensualidades
   where telefono_norm = v_compra.telefono_norm
   order by vence_el desc, created_at desc
   limit 1
   for update;

  if found and v_mens.vence_el >= v_hoy then
    -- ── RENOVACIÓN: mismo código, se arrastran hasta 60 minutos ──
    v_tipo      := 'renovacion';
    v_saldo_ini := v_mens.saldo_minutos;
    v_traslado  := least(v_saldo_ini, c_max_traslado);
    v_descarte  := v_saldo_ini - v_traslado;
    v_saldo_fin := v_traslado + v_compra.plan_minutos;
    v_codigo    := v_mens.codigo;

    -- Lo que excede el tope se descarta y queda registrado (no se pierde en silencio).
    if v_descarte > 0 then
      insert into public.mensualidad_movimientos
        (mensualidad_id, compra_id, tipo, minutos, saldo_anterior, saldo_posterior, motivo)
      values
        (v_mens.id, v_compra.id, 'descarte', -v_descarte, v_saldo_ini, v_traslado,
         format('Excede el máximo trasladable de %s minutos al renovar', c_max_traslado));
    end if;

    insert into public.mensualidad_movimientos
      (mensualidad_id, compra_id, tipo, minutos, saldo_anterior, saldo_posterior, motivo, idempotency_key)
    values
      (v_mens.id, v_compra.id, 'renovacion', v_compra.plan_minutos, v_traslado, v_saldo_fin,
       format('Renovación con plan %s', v_compra.plan_slug), 'pago:' || p_mp_payment_id);

    -- Se refrescan nombre/apellido/email (misma persona, datos más nuevos). El
    -- teléfono NO se toca: es la identidad, y solo el admin lo cambia con auditoría.
    -- 'bloqueada' se preserva: un pago no levanta un bloqueo administrativo.
    update public.mensualidades
       set saldo_minutos    = v_saldo_fin,
           vence_el         = v_vence,
           titular_nombre   = v_compra.comprador_nombre,
           titular_apellido = v_compra.comprador_apellido,
           titular_email    = v_compra.comprador_email
     where id = v_mens.id
     returning * into v_mens;
  else
    -- ── ALTA: código nuevo, saldo = plan. El saldo vencido no se recupera ──
    v_tipo      := 'alta';
    v_saldo_ini := 0;
    v_traslado  := 0;
    v_descarte  := 0;
    v_saldo_fin := v_compra.plan_minutos;
    v_codigo    := public.mensualidad_generar_codigo();

    insert into public.mensualidades
      (codigo, titular_nombre, titular_apellido, titular_telefono, telefono_norm,
       titular_email, saldo_minutos, vence_el)
    values
      (v_codigo, v_compra.comprador_nombre, v_compra.comprador_apellido,
       v_compra.comprador_telefono, v_compra.telefono_norm, v_compra.comprador_email,
       v_saldo_fin, v_vence)
    returning * into v_mens;

    insert into public.mensualidad_movimientos
      (mensualidad_id, compra_id, tipo, minutos, saldo_anterior, saldo_posterior, motivo, idempotency_key)
    values
      (v_mens.id, v_compra.id, 'compra', v_compra.plan_minutos, 0, v_saldo_fin,
       format('Alta con plan %s', v_compra.plan_slug), 'pago:' || p_mp_payment_id);
  end if;

  -- 6) Cerrar la compra histórica con el resultado y los datos del pago.
  update public.mensualidad_compras
     set mensualidad_id      = v_mens.id,
         tipo                = v_tipo,
         minutos_trasladados = v_traslado,
         minutos_descartados = v_descarte,
         saldo_resultante    = v_saldo_fin,
         vence_el            = v_vence,
         estado_pago         = 'aprobado',
         procesamiento       = 'aplicado',
         mp_payment_id       = p_mp_payment_id,
         importe_bruto       = coalesce(p_importe_bruto, importe_bruto),
         comision_mp         = coalesce(p_comision_mp, comision_mp),
         importe_neto        = coalesce(p_importe_neto, importe_neto),
         aprobado_at         = p_aprobado_at
   where id = v_compra.id
   returning * into v_compra;

  return v_compra;
end;
$$;

-- Solo el backend con service_role. Nunca anon/authenticated.
revoke all on function public.mensualidad_aplicar_compra(text, text, numeric, numeric, numeric, timestamptz) from public, anon, authenticated;
grant execute on function public.mensualidad_aplicar_compra(text, text, numeric, numeric, numeric, timestamptz) to service_role;

-- Los helpers tampoco se exponen al cliente.
revoke all on function public.mensualidad_hoy()                          from public, anon, authenticated;
revoke all on function public.mensualidad_estado(integer, date, boolean, date) from public, anon, authenticated;
revoke all on function public.mensualidad_normalizar_telefono(text)      from public, anon, authenticated;
revoke all on function public.mensualidad_normalizar_codigo(text)        from public, anon, authenticated;
revoke all on function public.mensualidad_generar_codigo()               from public, anon, authenticated;
revoke all on function public.mensualidad_set_updated_at()               from public, anon, authenticated;

grant execute on function public.mensualidad_hoy()                          to service_role;
grant execute on function public.mensualidad_estado(integer, date, boolean, date) to service_role;
grant execute on function public.mensualidad_normalizar_telefono(text)      to service_role;
grant execute on function public.mensualidad_normalizar_codigo(text)        to service_role;
grant execute on function public.mensualidad_generar_codigo()               to service_role;

-- ── 9) Seed idempotente de los tres planes ──────────────────────────────────
-- Inserta si falta; NO pisa precio/minutos/etiqueta/orden/activo si el plan ya
-- existe (el admin va a poder editarlos en M8 y el seed no debe deshacerlo).

insert into public.mensualidad_planes (slug, nombre, minutos, precio, vigencia_dias, etiqueta, orden)
values
  ('1h', '1 hora',  60,  30000, 30, null,           1),
  ('2h', '2 horas', 120, 55000, 30, 'Más elegida',  2),
  ('4h', '4 horas', 240, 100000, 30, 'Mejor precio', 3)
on conflict (slug) do nothing;
