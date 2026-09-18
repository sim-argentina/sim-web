-- ════════════════════════════════════════════════════════════════════════════
-- Mensualidades SIM · M7.4 — alta y renovación administrativa
-- ════════════════════════════════════════════════════════════════════════════
--
-- Un administrador puede crear o renovar una mensualidad desde el panel, en dos
-- modalidades que NO se distinguen por el precio sino por una columna:
--
--   · venta administrativa  → se cobró fuera del checkout público. Genera ingreso.
--   · cortesía/compensación → no se cobró nada. NUNCA genera ingreso.
--
-- Una cortesía no se registra como "compra pagada a precio cero": se marca con
-- canal = 'admin_cortesia' y Finanzas filtra POR CANAL, no por importe. Así una
-- cortesía no puede colarse como venta ni aunque su precio fuera distinto de 0.
--
-- REUTILIZACIÓN, no reimplementación
-- La regla de alta/renovación (carry-over con tope de 60 min, conservación del
-- código, vencimiento, advisory lock por titular) estaba dentro de
-- mensualidad_aplicar_compra. Se EXTRAE a mensualidad_aplicar_compra_interna,
-- copiada literalmente, y ahora la usan los dos caminos: el webhook público y el
-- alta administrativa. No hay dos copias de esas reglas.
--
-- Esta migración es ADITIVA: agrega columnas, reemplaza dos constraints por
-- versiones más permisivas SOLO para los canales nuevos, y crea funciones. No
-- edita ninguna migración histórica.
--
-- FINANZAS
-- Hasta hoy Mensualidades no existía en Finanzas: ni fin_ingresos_por_mes ni
-- fin_serie_ingresos leían mensualidad_compras, así que ni siquiera la compra
-- web generaba ingreso (la integración estaba diferida desde M5A). Se agrega la
-- fuente 'mensualidades' cubriendo web Y venta administrativa, con el mismo
-- criterio para las dos. La cortesía queda excluida por canal.
--
-- Medios de pago habilitados: efectivo, y qr/débito/crédito con procesador
-- mercado_pago. Son los únicos con cuenta inequívoca en el modelo vigente
-- (metodoACuentaTipo: efectivo → Efectivo, resto → Mercado Pago). Payway y
-- transferencia quedan fuera a propósito: Payway no acredita en Mercado Pago y
-- la cuenta Banco está inactiva, así que no hay imputación contable defendible.
-- No se inventa ninguna cuenta ni ninguna regla nueva.

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Columnas nuevas en mensualidad_compras
-- ────────────────────────────────────────────────────────────────────────────

alter table public.mensualidad_compras
  add column if not exists canal          text not null default 'web',
  add column if not exists medio_pago     text,
  add column if not exists procesador     text,
  add column if not exists cortesia_tipo  text,
  add column if not exists motivo_admin   text,
  add column if not exists registrado_por text,
  add column if not exists cobrado_at     timestamptz;

comment on column public.mensualidad_compras.canal is
  'web = checkout público; admin_venta = cobrada fuera del checkout; admin_cortesia = otorgada sin cobro. Finanzas filtra por esta columna, nunca por el importe.';
comment on column public.mensualidad_compras.cobrado_at is
  'Fecha EFECTIVA del cobro administrativo. Es la fecha contable: el ingreso se imputa acá, no en created_at.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mensualidad_compras_canal_valor_chk') then
    alter table public.mensualidad_compras
      add constraint mensualidad_compras_canal_valor_chk
      check (canal in ('web', 'admin_venta', 'admin_cortesia'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'mensualidad_compras_medio_chk') then
    alter table public.mensualidad_compras
      add constraint mensualidad_compras_medio_chk
      check (medio_pago is null or medio_pago in ('efectivo', 'qr', 'debito', 'credito'));
  end if;

  -- Solo mercado_pago: es el único procesador con cuenta inequívoca hoy.
  if not exists (select 1 from pg_constraint where conname = 'mensualidad_compras_proc_valor_chk') then
    alter table public.mensualidad_compras
      add constraint mensualidad_compras_proc_valor_chk
      check (procesador is null or procesador in ('mercado_pago'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'mensualidad_compras_cortesia_tipo_chk') then
    alter table public.mensualidad_compras
      add constraint mensualidad_compras_cortesia_tipo_chk
      check (cortesia_tipo is null
             or cortesia_tipo in ('cortesia_comercial', 'compensacion', 'correccion_autorizada'));
  end if;

  -- Coherencia por canal. Es lo que impide que una cortesía tenga medio de pago
  -- o que una venta administrativa quede sin él.
  if not exists (select 1 from pg_constraint where conname = 'mensualidad_compras_canal_coherencia_chk') then
    alter table public.mensualidad_compras
      add constraint mensualidad_compras_canal_coherencia_chk
      check (
        case canal
          when 'web' then
            medio_pago is null and procesador is null and cortesia_tipo is null and cobrado_at is null
          when 'admin_venta' then
            medio_pago is not null and cortesia_tipo is null and cobrado_at is not null
            and (procesador is null) = (medio_pago = 'efectivo')
          when 'admin_cortesia' then
            medio_pago is null and procesador is null and cobrado_at is null
            and cortesia_tipo is not null and importe_bruto = 0
          else false
        end
      );
  end if;
end $$;

-- La constraint original exigía mp_payment_id para TODA compra aplicada. Esa
-- exigencia es justamente la que impide fabricar un payment_id inexistente, así
-- que se conserva intacta para el canal web y se levanta solo para los canales
-- administrativos, que no tienen pago de Mercado Pago que identificar.
alter table public.mensualidad_compras
  drop constraint if exists mensualidad_compras_aplicada_chk;

alter table public.mensualidad_compras
  add constraint mensualidad_compras_aplicada_chk check (
    procesamiento <> 'aplicado'
    or (mensualidad_id is not null and tipo is not null and minutos_trasladados is not null
        and minutos_descartados is not null and saldo_resultante is not null and vence_el is not null
        and aprobado_at is not null and estado_pago = 'aprobado'
        and (canal <> 'web' or mp_payment_id is not null))
  );

create index if not exists mensualidad_compras_canal_idx
  on public.mensualidad_compras (canal, aprobado_at desc);

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Operación autoritativa común: aplicar una compra sobre la billetera
-- ────────────────────────────────────────────────────────────────────────────
-- Cuerpo COPIADO literalmente de mensualidad_aplicar_compra (pasos 4 a 6). Lo
-- único que cambia: la fecha efectiva, la clave del movimiento y los datos del
-- pago llegan por parámetro, y el motivo del movimiento agrega el canal.
--
-- NO valida nada del pago: eso es responsabilidad de cada llamador, que sabe si
-- su origen es un pago de Mercado Pago o una operación administrativa.

create or replace function public.mensualidad_aplicar_compra_interna(
  p_compra_id       uuid,
  p_efectiva_at     timestamptz,
  p_idem_movimiento text,
  p_mp_payment_id   text    default null,
  p_importe_bruto   numeric default null,
  p_comision_mp     numeric default null,
  p_importe_neto    numeric default null
)
returns public.mensualidad_compras
language plpgsql
security definer
set search_path = public
as $fn$
declare
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
  v_sufijo    text;
begin
  select * into v_compra from public.mensualidad_compras
   where id = p_compra_id for update;
  if not found then raise exception 'compra_inexistente' using errcode = 'P0002'; end if;
  if v_compra.procesamiento = 'aplicado' then return v_compra; end if;

  -- (M2.1) Identidad canónica obligatoria: la billetera se busca y se bloquea por
  -- telefono_norm; si no es canónico, una renovación podría ir a otra persona.
  if v_compra.telefono_norm !~ '^[0-9]{10}$' then
    raise exception 'telefono_no_canonico' using errcode = '22023';
  end if;

  -- El canal queda escrito en el libro mayor: leyendo un movimiento se sabe si
  -- vino del checkout, de una venta de mostrador o de una cortesía.
  v_sufijo := case v_compra.canal
                when 'admin_venta'    then ' (venta administrativa)'
                when 'admin_cortesia' then ' (cortesía sin cobro)'
                else '' end;

  v_hoy   := (p_efectiva_at at time zone 'America/Argentina/Cordoba')::date;
  v_vence := v_hoy + v_compra.plan_vigencia_dias;

  perform pg_advisory_xact_lock(hashtext('mensualidad:' || v_compra.telefono_norm)::bigint);

  select * into v_mens from public.mensualidades
   where telefono_norm = v_compra.telefono_norm
   order by vence_el desc, created_at desc limit 1
   for update;

  if found and v_mens.vence_el >= v_hoy then
    v_tipo      := 'renovacion';
    v_saldo_ini := v_mens.saldo_minutos;
    v_traslado  := least(v_saldo_ini, c_max_traslado);
    v_descarte  := v_saldo_ini - v_traslado;
    v_saldo_fin := v_traslado + v_compra.plan_minutos;
    v_codigo    := v_mens.codigo;

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
       format('Renovación con plan %s%s', v_compra.plan_slug, v_sufijo), p_idem_movimiento);

    update public.mensualidades
       set saldo_minutos    = v_saldo_fin,
           vence_el         = v_vence,
           titular_nombre   = v_compra.comprador_nombre,
           titular_apellido = v_compra.comprador_apellido,
           titular_email    = v_compra.comprador_email
     where id = v_mens.id
     returning * into v_mens;
  else
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
       format('Alta con plan %s%s', v_compra.plan_slug, v_sufijo), p_idem_movimiento);
  end if;

  update public.mensualidad_compras
     set mensualidad_id      = v_mens.id,
         tipo                = v_tipo,
         minutos_trasladados = v_traslado,
         minutos_descartados = v_descarte,
         saldo_resultante    = v_saldo_fin,
         vence_el            = v_vence,
         estado_pago         = 'aprobado',
         procesamiento       = 'aplicado',
         mp_payment_id       = coalesce(p_mp_payment_id, mp_payment_id),
         importe_bruto       = coalesce(p_importe_bruto, importe_bruto),
         comision_mp         = coalesce(p_comision_mp, comision_mp),
         importe_neto        = coalesce(p_importe_neto, importe_neto),
         aprobado_at         = p_efectiva_at
   where id = v_compra.id
   returning * into v_compra;

  return v_compra;
end;
$fn$;

revoke all on function public.mensualidad_aplicar_compra_interna(uuid, timestamptz, text, text, numeric, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.mensualidad_aplicar_compra_interna(uuid, timestamptz, text, text, numeric, numeric, numeric)
  to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 3) El camino público delega en la operación común
-- ────────────────────────────────────────────────────────────────────────────
-- Misma firma y mismo comportamiento observable que antes: conserva sus
-- validaciones de pago (idempotencia por payment_id, compra pendiente, etc.) y
-- delega la parte de billetera. No cambia ni un mensaje de error.

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
as $fn$
declare
  v_compra public.mensualidad_compras;
begin
  if coalesce(btrim(p_external_reference), '') = '' then
    raise exception 'external_reference_requerida' using errcode = '22023';
  end if;
  if coalesce(btrim(p_mp_payment_id), '') = '' then
    raise exception 'payment_id_requerido' using errcode = '22023';
  end if;

  select * into v_compra from public.mensualidad_compras
   where mp_payment_id = p_mp_payment_id and procesamiento = 'aplicado' limit 1;
  if found then
    if v_compra.external_reference is distinct from p_external_reference then
      raise exception 'payment_id_de_otra_compra' using errcode = '23505';
    end if;
    return v_compra;
  end if;

  select * into v_compra from public.mensualidad_compras
   where external_reference = p_external_reference for update;
  if not found then raise exception 'compra_inexistente' using errcode = 'P0002'; end if;
  if v_compra.procesamiento = 'aplicado' then return v_compra; end if;
  if v_compra.estado_pago <> 'pendiente' then
    raise exception 'compra_no_pendiente' using errcode = '22023';
  end if;

  -- Un pago de Mercado Pago solo puede acreditar una compra del canal web.
  if v_compra.canal <> 'web' then
    raise exception 'compra_no_web' using errcode = '22023';
  end if;

  return public.mensualidad_aplicar_compra_interna(
    v_compra.id, p_aprobado_at, 'pago:' || p_mp_payment_id,
    p_mp_payment_id, p_importe_bruto, p_comision_mp, p_importe_neto
  );
end;
$fn$;

revoke all on function public.mensualidad_aplicar_compra(text, text, numeric, numeric, numeric, timestamptz)
  from public, anon, authenticated;
grant execute on function public.mensualidad_aplicar_compra(text, text, numeric, numeric, numeric, timestamptz)
  to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 4) Alta / renovación administrativa
-- ────────────────────────────────────────────────────────────────────────────
-- TODO lo sensible se resuelve acá adentro: precio y minutos salen del plan
-- activo, el vencimiento lo calcula la operación común, el código lo genera la
-- base y la comisión sale de fin_comisiones_cobro. Nada de eso puede llegar del
-- navegador.
--
-- Idempotencia: mensualidad_compras_idem_uq es único sobre idempotency_key, así
-- que dos peticiones con la misma clave no pueden crear dos compras. La segunda
-- encuentra la primera y devuelve su resultado sin escribir nada.

create or replace function public.mensualidad_admin_alta(
  p_plan_slug       text,
  p_nombre          text,
  p_apellido        text,
  p_telefono        text,
  p_email           text,
  p_modalidad       text,     -- 'venta' | 'cortesia'
  p_medio_pago      text,     -- venta: efectivo|qr|debito|credito · cortesía: null
  p_cortesia_tipo   text,     -- cortesía: cortesia_comercial|compensacion|correccion_autorizada
  p_motivo          text,
  p_actor           text,
  p_actor_rol       text,
  p_idempotency_key text,
  p_declaracion     boolean,  -- el admin declara que informó las condiciones
  p_cobrado_el      date default null
)
returns table (
  compra_id       uuid,
  mensualidad_id  uuid,
  codigo          text,
  tipo            text,       -- 'alta' | 'renovacion'
  canal           text,
  minutos_plan    integer,
  saldo_anterior  integer,
  saldo_posterior integer,
  vence_anterior  date,
  vence_el        date,
  codigo_conservado boolean,
  importe_bruto   numeric,
  comision        numeric,
  importe_neto    numeric,
  idempotente     boolean
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_tel        text;
  v_plan       public.mensualidad_planes%rowtype;
  v_canal      text;
  v_proc       text;
  v_bruto      numeric;
  v_comision   numeric;
  v_neto       numeric;
  v_pct        numeric;
  v_cfg        public.fin_comisiones_cobro%rowtype;
  v_compra     public.mensualidad_compras;
  v_previa     public.mensualidad_compras;
  v_mens       public.mensualidades;
  v_saldo_ant  integer := 0;
  v_vence_ant  date;
  v_cod_ant    text;
  v_efectiva   timestamptz;
  v_email      text;
begin
  -- Motivo no vacío, actor presente y clave idempotente con forma válida.
  perform public.mensualidad_admin_validar_entrada(p_motivo, p_actor, p_idempotency_key);

  -- Solo admin. staff es de consulta: no puede dar de alta ni renovar.
  if coalesce(p_actor_rol, '') <> 'admin' then
    raise exception 'rol_no_autorizado' using errcode = '42501';
  end if;

  if p_declaracion is not true then
    raise exception 'declaracion_requerida' using errcode = '22023';
  end if;

  if p_modalidad is null or p_modalidad not in ('venta', 'cortesia') then
    raise exception 'modalidad_invalida' using errcode = '22023';
  end if;
  v_canal := case p_modalidad when 'venta' then 'admin_venta' else 'admin_cortesia' end;

  -- Una fecha de cobro futura imputaría el ingreso en un mes que todavía no pasó.
  if p_cobrado_el is not null and p_cobrado_el > (now() at time zone 'America/Argentina/Cordoba')::date then
    raise exception 'fecha_cobro_futura' using errcode = '22023';
  end if;

  -- Identidad: el teléfono se normaliza con la MISMA función que usa la compra
  -- pública y Mi Plan. El correo no alcanza como identidad.
  v_tel := public.mensualidad_normalizar_telefono(p_telefono);
  if v_tel is null or v_tel !~ '^[0-9]{10}$' then
    raise exception 'telefono_invalido' using errcode = '22023';
  end if;

  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
    raise exception 'email_invalido' using errcode = '22023';
  end if;
  if coalesce(btrim(p_nombre), '') = '' or coalesce(btrim(p_apellido), '') = '' then
    raise exception 'nombre_invalido' using errcode = '22023';
  end if;

  -- ── Reintento con la misma clave: se devuelve lo que pasó, sin escribir ──
  -- El saldo y el vencimiento ANTERIORES se leen de la auditoría de aquella
  -- operación, que los guardó exactos. Derivarlos de saldo_resultante daría mal
  -- en una renovación con descarte.
  select * into v_previa from public.mensualidad_compras
   where idempotency_key = p_idempotency_key;
  if found then
    if v_previa.canal = 'web' then
      raise exception 'clave_de_otra_compra' using errcode = '23505';
    end if;
    select * into v_mens from public.mensualidades where id = v_previa.mensualidad_id;
    select (a.valor_anterior->>'saldo')::integer,
           nullif(a.valor_anterior->>'vence_el', '')::date
      into v_saldo_ant, v_vence_ant
      from public.mensualidad_auditoria a
     where a.idempotency_key = p_idempotency_key
     order by a.created_at asc limit 1;
    return query
      select v_previa.id, v_previa.mensualidad_id, v_mens.codigo, v_previa.tipo, v_previa.canal,
             v_previa.plan_minutos, coalesce(v_saldo_ant, 0), v_previa.saldo_resultante,
             v_vence_ant, v_previa.vence_el,
             (v_previa.tipo = 'renovacion'),
             v_previa.importe_bruto, v_previa.comision_mp, v_previa.importe_neto,
             true;
    return;
  end if;

  -- ── Plan ACTIVO: precio, minutos y vigencia salen de acá, nunca del cliente ──
  select * into v_plan from public.mensualidad_planes
   where slug = p_plan_slug and activo = true;
  if not found then
    raise exception 'plan_inexistente' using errcode = 'P0002';
  end if;
  if v_plan.minutos <= 0 or v_plan.precio <= 0 or v_plan.vigencia_dias <= 0 then
    raise exception 'plan_inexistente' using errcode = 'P0002';
  end if;

  -- ── Modalidad: importes y medio de pago ──
  if p_modalidad = 'venta' then
    if p_medio_pago is null or p_medio_pago not in ('efectivo', 'qr', 'debito', 'credito') then
      raise exception 'medio_pago_invalido' using errcode = '22023';
    end if;
    if p_cortesia_tipo is not null then
      raise exception 'cortesia_tipo_no_corresponde' using errcode = '22023';
    end if;
    v_proc  := case when p_medio_pago = 'efectivo' then null else 'mercado_pago' end;
    v_bruto := v_plan.precio;

    -- Comisión con la MISMA configuración vigente que usa el turnero. Si no hay
    -- config activa, la comisión queda NULL: es "no disponible", nunca cero.
    if v_proc is not null then
      select * into v_cfg from public.fin_comisiones_cobro
       where procesador = v_proc and metodo_pago = p_medio_pago and activa = true;
      if found then
        v_pct := case when v_cfg.aplica_iva
                      then v_cfg.porcentaje_base * (1 + coalesce(v_cfg.iva_porcentaje, 0) / 100.0)
                      else v_cfg.porcentaje_base end;
        v_comision := round(v_bruto * v_pct / 100.0, 2);
        v_neto     := round(v_bruto - v_comision, 2);
      end if;
    else
      v_comision := 0;          -- efectivo no tiene comisión de cobro
      v_neto     := v_bruto;
    end if;
    -- El INSTANTE lleva la hora real, no medianoche. Si se normalizara al
    -- comienzo del día, dos ventas del mismo titular en la misma jornada
    -- quedarían con el mismo aprobado_at y el panel no podría decir cuál fue la
    -- última: el "último plan" del listado se ordena por esta columna.
    -- El MES contable no cambia, que es lo único que mira Finanzas.
    v_efectiva := case
      when p_cobrado_el is null then now()
      else (p_cobrado_el::timestamp + (now() at time zone 'America/Argentina/Cordoba')::time)
             at time zone 'America/Argentina/Cordoba'
    end;
  else
    if p_medio_pago is not null then
      raise exception 'medio_pago_no_corresponde' using errcode = '22023';
    end if;
    if p_cortesia_tipo is null
       or p_cortesia_tipo not in ('cortesia_comercial', 'compensacion', 'correccion_autorizada') then
      raise exception 'cortesia_tipo_invalido' using errcode = '22023';
    end if;
    v_proc     := null;
    v_bruto    := 0;            -- sin cobro: no hay bruto, no hay comisión, no hay neto
    v_comision := null;
    v_neto     := null;
    v_efectiva := now();
  end if;

  -- ── Estado previo del titular, ya bajo el lock que usará la operación común ──
  perform pg_advisory_xact_lock(hashtext('mensualidad:' || v_tel)::bigint);

  select * into v_mens from public.mensualidades
   where telefono_norm = v_tel
   order by vence_el desc, created_at desc limit 1
   for update;

  if found then
    -- Una billetera bloqueada NO se reactiva por una venta. El admin tiene que
    -- desbloquearla explícitamente, que es una acción auditada aparte.
    if v_mens.bloqueada then
      raise exception 'mensualidad_bloqueada' using errcode = '22023';
    end if;
    v_saldo_ant := v_mens.saldo_minutos;
    v_vence_ant := v_mens.vence_el;
    v_cod_ant   := v_mens.codigo;
  end if;

  -- ── Compra administrativa. external_reference lleva un prefijo propio para
  --    que NINGÚN pago de Mercado Pago pueda encontrarla jamás. ──
  insert into public.mensualidad_compras (
    plan_id, plan_slug, plan_nombre, plan_minutos, plan_precio, plan_vigencia_dias, plan_etiqueta,
    comprador_nombre, comprador_apellido, comprador_telefono, telefono_norm, comprador_email,
    importe_bruto, external_reference, idempotency_key,
    canal, medio_pago, procesador, cortesia_tipo, motivo_admin, registrado_por,
    cobrado_at
  ) values (
    v_plan.id, v_plan.slug, v_plan.nombre, v_plan.minutos, v_plan.precio, v_plan.vigencia_dias, v_plan.etiqueta,
    btrim(p_nombre), btrim(p_apellido), btrim(p_telefono), v_tel, v_email,
    v_bruto, 'admin_' || replace(gen_random_uuid()::text, '-', ''), p_idempotency_key,
    v_canal, p_medio_pago, v_proc, p_cortesia_tipo, btrim(p_motivo), p_actor,
    case when p_modalidad = 'venta' then v_efectiva else null end
  )
  returning * into v_compra;

  -- ── Misma operación autoritativa que usa el webhook público ──
  v_compra := public.mensualidad_aplicar_compra_interna(
    v_compra.id, v_efectiva, 'admin:' || p_idempotency_key,
    null, v_bruto, v_comision, v_neto
  );

  select * into v_mens from public.mensualidades where id = v_compra.mensualidad_id;

  perform public.mensualidad_auditar(
    v_compra.mensualidad_id,
    case when v_compra.tipo = 'alta' then 'alta_administrativa' else 'renovacion_administrativa' end,
    p_actor, p_actor_rol, btrim(p_motivo),
    jsonb_build_object('saldo', v_saldo_ant, 'vence_el', v_vence_ant, 'codigo_previo', v_cod_ant is not null),
    jsonb_build_object(
      'modalidad', p_modalidad, 'canal', v_canal, 'plan', v_plan.slug,
      'minutos_plan', v_plan.minutos, 'saldo', v_compra.saldo_resultante,
      'vence_el', v_compra.vence_el, 'codigo_conservado', (v_compra.tipo = 'renovacion'),
      'medio_pago', p_medio_pago, 'procesador', v_proc,
      'cortesia_tipo', p_cortesia_tipo,
      'importe_bruto', v_bruto, 'comision', v_comision, 'importe_neto', v_neto,
      'cobrado_el', case when p_modalidad = 'venta' then v_efectiva::date else null end,
      'declaracion_condiciones', true
    ),
    v_compra.id::text, p_idempotency_key
  );

  return query
    select v_compra.id, v_compra.mensualidad_id, v_mens.codigo, v_compra.tipo, v_compra.canal,
           v_plan.minutos, v_saldo_ant, v_compra.saldo_resultante, v_vence_ant, v_compra.vence_el,
           (v_compra.tipo = 'renovacion'),
           v_compra.importe_bruto, v_compra.comision_mp, v_compra.importe_neto,
           false;
end;
$fn$;

revoke all on function public.mensualidad_admin_alta(text, text, text, text, text, text, text, text, text, text, text, text, boolean, date)
  from public, anon, authenticated;
grant execute on function public.mensualidad_admin_alta(text, text, text, text, text, text, text, text, text, text, text, text, boolean, date)
  to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 5) Finanzas: la fuente 'mensualidades'
-- ────────────────────────────────────────────────────────────────────────────
-- Se reescriben las dos funciones completas porque son SQL plano y no admiten
-- extenderlas por partes. Todo lo anterior queda IDÉNTICO: lo único que se
-- agrega es la rama final.
--
--   · Cuenta el bruto de las compras APLICADAS de canal 'web' y 'admin_venta'.
--   · 'admin_cortesia' queda afuera POR CANAL, no por importe.
--   · Fecha contable: cobrado_at para la venta administrativa (la fecha efectiva
--     del cobro) y aprobado_at para la web.
--   · El método determina la cuenta con la regla vigente (metodoACuentaTipo):
--     'efectivo' → Efectivo, el resto → Mercado Pago. La web es 'mercadopago',
--     igual que las otras fuentes online.

create or replace function public.fin_ingresos_por_mes(p_mes text)
returns table(fuente text, metodo text, total numeric, cantidad numeric)
language sql
stable
as $fn$
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
    and estado in ('activa','reembolsada')
    and (origen is null or origen not in ('empresa','mensualidad'))
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
  group by 2
  union all
  -- (M7.4) Mensualidades: compra web + venta administrativa. La cortesía NO.
  select 'mensualidades'::text,
         case when c.canal = 'web' then 'mercadopago'
              else coalesce(nullif(trim(c.medio_pago), ''), 'desconocido') end,
         coalesce(sum(c.importe_bruto), 0), count(*)::numeric
  from mensualidad_compras c
  where c.procesamiento = 'aplicado'
    and c.canal in ('web', 'admin_venta')
    and to_char(coalesce(c.cobrado_at, c.aprobado_at) at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') = p_mes
  group by 2;
$fn$;

create or replace function public.fin_serie_ingresos(p_desde text, p_hasta text)
returns table(mes text, fuente text, total numeric, turnos numeric)
language sql
stable
as $fn$
  select to_char(fecha, 'YYYY-MM'), 'turnero'::text,
         coalesce(sum(total), 0), coalesce(sum(coalesce(cantidad_turnos, 1)), 0)
  from turnos_stand
  where to_char(fecha, 'YYYY-MM') between p_desde and p_hasta
    and (estado is null or estado <> 'cancelado')
  group by 1
  union all
  select to_char(created_at at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM'),
         'reservas_online'::text, coalesce(sum(total), 0), count(*)::numeric
  from reservas
  where to_char(created_at at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') between p_desde and p_hasta
    and estado = 'activa'
    and (origen is null or origen <> 'mensualidad')
  group by 1
  union all
  select to_char(fecha_pago at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM'),
         'gift_cards'::text, coalesce(sum(monto), 0), count(*)::numeric
  from gift_cards
  where estado_pago = 'pagado' and fecha_pago is not null
    and to_char(fecha_pago at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') between p_desde and p_hasta
  group by 1
  union all
  select to_char(created_at at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM'),
         'campeonatos'::text, coalesce(sum(monto), 0), count(*)::numeric
  from campeonato_inscripciones
  where estado_pago = 'pagado' and eliminada_at is null
    and to_char(created_at at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') between p_desde and p_hasta
  group by 1
  union all
  -- (M7.4) Misma regla que fin_ingresos_por_mes: cortesía excluida por canal.
  select to_char(coalesce(cobrado_at, aprobado_at) at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM'),
         'mensualidades'::text, coalesce(sum(importe_bruto), 0), count(*)::numeric
  from mensualidad_compras
  where procesamiento = 'aplicado'
    and canal in ('web', 'admin_venta')
    and to_char(coalesce(cobrado_at, aprobado_at) at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') between p_desde and p_hasta
  group by 1;
$fn$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6) Métricas: mensualidades otorgadas sin cobro
-- ────────────────────────────────────────────────────────────────────────────
-- La cortesía no es un ingreso, pero tiene que poder contarse. Se expone aparte
-- para que nunca se sume por accidente a la facturación.

create or replace function public.mensualidad_resumen_altas_mes(p_mes text)
returns table(canal text, tipo text, cantidad bigint, bruto numeric)
language sql
stable
set search_path = public
as $fn$
  select c.canal, c.tipo, count(*)::bigint,
         coalesce(sum(case when c.canal = 'admin_cortesia' then 0 else c.importe_bruto end), 0)
  from public.mensualidad_compras c
  where c.procesamiento = 'aplicado'
    and to_char(coalesce(c.cobrado_at, c.aprobado_at) at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') = p_mes
  group by c.canal, c.tipo
  order by c.canal, c.tipo;
$fn$;

revoke all on function public.mensualidad_resumen_altas_mes(text) from public, anon, authenticated;
grant execute on function public.mensualidad_resumen_altas_mes(text) to service_role;
