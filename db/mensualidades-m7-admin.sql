-- ════════════════════════════════════════════════════════════════════════════
-- Mensualidades SIM · BLOQUE M7 — Administración integral
-- ════════════════════════════════════════════════════════════════════════════
--
-- Todo lo que un administrador puede hacer sobre una billetera, de forma
-- ATÓMICA, IDEMPOTENTE y AUDITADA. Ninguna de estas operaciones crea compras,
-- ingresos financieros ni pagos: son correcciones administrativas.
--
-- Reutiliza lo que M2 ya dejó puesto y nunca se usó:
--   · mensualidad_auditoria  → el registro de cada acción, con motivo obligatorio
--   · tipo de movimiento 'ajuste_admin' → el único que mueve saldo desde acá
--
-- Lo único que se agrega a las tablas existentes es una columna de idempotencia
-- en la auditoría: las acciones que NO mueven saldo no dejan movimiento, así que
-- necesitan su propia clave para que un doble clic no se aplique dos veces.
--
-- ORDEN DE LOCKS (global del módulo, para no generar deadlocks):
--   advisory 'mensualidad:<telefono_norm>' → FOR UPDATE mensualidades → advisory
--   'reserva-slot:<fecha>'
-- Las acciones de M7 solo llegan al segundo escalón; el cambio de teléfono toma
-- los dos advisory (viejo y nuevo) SIEMPRE en orden alfabético, así dos cambios
-- cruzados no pueden trabarse entre sí.
--
-- SOLO service_role. Ninguna función queda accesible a anon/authenticated.

-- ── 1) Idempotencia de las acciones que no mueven saldo ─────────────────────
-- `referencia` queda libre para lo que nombra: la referencia pública de una
-- reserva. La clave de idempotencia va en su propia columna.

alter table public.mensualidad_auditoria
  add column if not exists idempotency_key text;

create unique index if not exists mensualidad_aud_idem_uq
  on public.mensualidad_auditoria (idempotency_key)
  where idempotency_key is not null;

-- ── 2) Utilidad interna: revocar todas las sesiones vivas de Mi Plan ────────
-- Se usa al bloquear, al cambiar el teléfono y al regenerar el código: en los
-- tres casos la credencial con la que se abrió la sesión dejó de ser válida.
-- Devuelve cuántas cerró, para poder auditarlo sin exponer tokens.

create or replace function public.mensualidad_revocar_sesiones(p_mensualidad_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_n integer;
begin
  update public.mensualidad_sesiones s
     set revocada_at = now()
   where s.mensualidad_id = p_mensualidad_id
     and s.revocada_at is null;
  get diagnostics v_n = row_count;
  return coalesce(v_n, 0);
end;
$fn$;

-- ── 3) Utilidad interna: escribir la auditoría ──────────────────────────────
-- Un solo lugar que valida motivo y actor, para que ninguna acción pueda
-- quedar sin rastro. NO recibe nunca el código ni el teléfono completos.

create or replace function public.mensualidad_auditar(
  p_mensualidad_id  uuid,
  p_accion          text,
  p_actor           text,
  p_actor_rol       text,
  p_motivo          text,
  p_valor_anterior  jsonb,
  p_valor_nuevo     jsonb,
  p_referencia      text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
begin
  insert into public.mensualidad_auditoria (
    mensualidad_id, accion, actor, actor_rol, motivo,
    valor_anterior, valor_nuevo, referencia, idempotency_key
  ) values (
    p_mensualidad_id, p_accion, p_actor, coalesce(p_actor_rol, 'admin'), p_motivo,
    p_valor_anterior, p_valor_nuevo, p_referencia, p_idempotency_key
  )
  returning id into v_id;
  return v_id;
end;
$fn$;

-- ── 4) Validaciones compartidas ─────────────────────────────────────────────

create or replace function public.mensualidad_admin_validar_entrada(
  p_motivo text, p_actor text, p_idempotency_key text
)
returns void
language plpgsql
immutable
set search_path = public
as $fn$
begin
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'motivo_requerido' using errcode = '22023';
  end if;
  if length(btrim(p_motivo)) > 500 then
    raise exception 'motivo_demasiado_largo' using errcode = '22023';
  end if;
  if coalesce(btrim(p_actor), '') = '' then
    raise exception 'actor_requerido' using errcode = '22023';
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,64}$' then
    raise exception 'idempotency_key_invalida' using errcode = '22023';
  end if;
end;
$fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) EXTENDER VENCIMIENTO
-- ════════════════════════════════════════════════════════════════════════════
-- La billetera se usa hasta las 23:59 del día `vence_el` en Córdoba: eso ya lo
-- decide mensualidad_estado(), así que acá SOLO se mueve la fecha.
--
-- No crea compra, no toca saldo, no simula renovación y NO puede acortar.
-- El estado se recalcula solo: si estaba vencida y la fecha nueva es futura,
-- vuelve a 'vigente' o 'agotada' según el saldo; si sigue bloqueada, 'bloqueada'
-- gana, porque así está definido mensualidad_estado().

create or replace function public.mensualidad_admin_extender_vencimiento(
  p_mensualidad_id  uuid,
  p_nueva_fecha     date,
  p_motivo          text,
  p_actor           text,
  p_actor_rol       text,
  p_idempotency_key text
)
returns table (
  vence_anterior   date,
  vence_nuevo      date,
  estado_resultante text,
  saldo_actual     integer,
  idempotente      boolean
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_mens      public.mensualidades%rowtype;
  v_tel       text;
  v_hoy       date;
  v_previo    public.mensualidad_auditoria%rowtype;
begin
  perform public.mensualidad_admin_validar_entrada(p_motivo, p_actor, p_idempotency_key);
  if p_nueva_fecha is null then
    raise exception 'fecha_invalida' using errcode = '22023';
  end if;

  -- Reintento: se contesta lo que ya pasó, sin volver a aplicarlo.
  select * into v_previo from public.mensualidad_auditoria a
   where a.idempotency_key = p_idempotency_key limit 1;
  if found then
    if v_previo.mensualidad_id is distinct from p_mensualidad_id
       or v_previo.accion <> 'extender_vencimiento'
       or (v_previo.valor_nuevo ->> 'vence_el')::date is distinct from p_nueva_fecha then
      raise exception 'idempotency_key_con_otro_payload' using errcode = '23505';
    end if;
    select * into v_mens from public.mensualidades m where m.id = p_mensualidad_id;
    v_hoy := public.mensualidad_hoy();
    return query select
      (v_previo.valor_anterior ->> 'vence_el')::date,
      (v_previo.valor_nuevo ->> 'vence_el')::date,
      public.mensualidad_estado(v_mens.saldo_minutos, v_mens.vence_el, v_mens.bloqueada, v_hoy),
      v_mens.saldo_minutos,
      true;
    return;
  end if;

  select m.telefono_norm into v_tel from public.mensualidades m where m.id = p_mensualidad_id;
  if v_tel is null then
    raise exception 'mensualidad_inexistente' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('mensualidad:' || v_tel)::bigint);

  select * into v_mens from public.mensualidades m where m.id = p_mensualidad_id for update;
  if not found then
    raise exception 'mensualidad_inexistente' using errcode = 'P0002';
  end if;

  -- Desde acá SOLO se extiende. Acortar un vencimiento es otra decisión y no
  -- entra por esta puerta.
  if p_nueva_fecha <= v_mens.vence_el then
    raise exception 'fecha_no_posterior' using errcode = '22023';
  end if;

  update public.mensualidades m
     set vence_el = p_nueva_fecha
   where m.id = p_mensualidad_id;

  perform public.mensualidad_auditar(
    p_mensualidad_id, 'extender_vencimiento', p_actor, p_actor_rol, p_motivo,
    jsonb_build_object('vence_el', v_mens.vence_el),
    jsonb_build_object('vence_el', p_nueva_fecha),
    null, p_idempotency_key
  );

  v_hoy := public.mensualidad_hoy();
  return query select
    v_mens.vence_el,
    p_nueva_fecha,
    public.mensualidad_estado(v_mens.saldo_minutos, p_nueva_fecha, v_mens.bloqueada, v_hoy),
    v_mens.saldo_minutos,
    false;
end;
$fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) AGREGAR O DESCONTAR SALDO
-- ════════════════════════════════════════════════════════════════════════════
-- Un ajuste administrativo es EXACTAMENTE un movimiento 'ajuste_admin'. No es
-- una compra, no mueve el vencimiento y no genera ingresos ni egresos.
--
-- La cantidad siempre llega POSITIVA y la dirección viaja aparte: así no existe
-- forma de descontar por error de signo. El movimiento guarda el signo.
--
-- El modelo de M2 exige minutos múltiplos de 15 y saldo nunca negativo; las dos
-- cosas se validan acá con un error legible en vez de dejar reventar el check.

create or replace function public.mensualidad_admin_ajustar_saldo(
  p_mensualidad_id  uuid,
  p_operacion       text,      -- 'agregar' | 'descontar'
  p_minutos         integer,   -- SIEMPRE positivo
  p_motivo          text,
  p_actor           text,
  p_actor_rol       text,
  p_idempotency_key text
)
returns table (
  saldo_anterior  integer,
  saldo_posterior integer,
  minutos_aplicados integer,
  estado_resultante text,
  idempotente     boolean
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_mens    public.mensualidades%rowtype;
  v_tel     text;
  v_hoy     date;
  v_delta   integer;
  v_final   integer;
  v_prev    public.mensualidad_movimientos%rowtype;
begin
  perform public.mensualidad_admin_validar_entrada(p_motivo, p_actor, p_idempotency_key);

  if p_operacion is null or p_operacion not in ('agregar', 'descontar') then
    raise exception 'operacion_invalida' using errcode = '22023';
  end if;
  if p_minutos is null or p_minutos <= 0 then
    raise exception 'minutos_invalidos' using errcode = '22023';
  end if;
  if p_minutos % 15 <> 0 then
    raise exception 'minutos_no_multiplo_15' using errcode = '22023';
  end if;

  v_delta := case when p_operacion = 'agregar' then p_minutos else -p_minutos end;

  -- Reintento: el movimiento ya existe y no se escribe otro.
  select * into v_prev from public.mensualidad_movimientos mv
   where mv.idempotency_key = p_idempotency_key limit 1;
  if found then
    if v_prev.mensualidad_id is distinct from p_mensualidad_id
       or v_prev.tipo <> 'ajuste_admin'
       or v_prev.minutos is distinct from v_delta then
      raise exception 'idempotency_key_con_otro_payload' using errcode = '23505';
    end if;
    select * into v_mens from public.mensualidades m where m.id = p_mensualidad_id;
    v_hoy := public.mensualidad_hoy();
    return query select
      v_prev.saldo_anterior, v_prev.saldo_posterior, v_prev.minutos,
      public.mensualidad_estado(v_mens.saldo_minutos, v_mens.vence_el, v_mens.bloqueada, v_hoy),
      true;
    return;
  end if;

  select m.telefono_norm into v_tel from public.mensualidades m where m.id = p_mensualidad_id;
  if v_tel is null then
    raise exception 'mensualidad_inexistente' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('mensualidad:' || v_tel)::bigint);

  select * into v_mens from public.mensualidades m where m.id = p_mensualidad_id for update;
  if not found then
    raise exception 'mensualidad_inexistente' using errcode = 'P0002';
  end if;

  v_final := v_mens.saldo_minutos + v_delta;
  if v_final < 0 then
    raise exception 'saldo_insuficiente' using errcode = '22023';
  end if;

  update public.mensualidades m
     set saldo_minutos = v_final
   where m.id = p_mensualidad_id;

  insert into public.mensualidad_movimientos (
    mensualidad_id, tipo, minutos, saldo_anterior, saldo_posterior,
    motivo, actor, idempotency_key
  ) values (
    p_mensualidad_id, 'ajuste_admin', v_delta, v_mens.saldo_minutos, v_final,
    p_motivo, p_actor, p_idempotency_key
  );

  perform public.mensualidad_auditar(
    p_mensualidad_id, 'ajustar_saldo', p_actor, p_actor_rol, p_motivo,
    jsonb_build_object('saldo_minutos', v_mens.saldo_minutos),
    jsonb_build_object('saldo_minutos', v_final, 'minutos', v_delta),
    null, null
  );

  v_hoy := public.mensualidad_hoy();
  return query select
    v_mens.saldo_minutos, v_final, v_delta,
    public.mensualidad_estado(v_final, v_mens.vence_el, v_mens.bloqueada, v_hoy),
    false;
end;
$fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) BLOQUEAR Y REACTIVAR
-- ════════════════════════════════════════════════════════════════════════════
-- Bloquear NO toca saldo, vencimiento, compras, historial ni reservas vivas.
-- Lo único que cambia es que la billetera deja de poder OPERAR: mensualidad_estado()
-- devuelve 'bloqueada' y las funciones críticas ya la rechazan por ese estado
-- (crear reserva, reprogramar, y la creación de preferencias de pago en M3).
--
-- Las sesiones abiertas se revocan: si no, una pestaña ya autenticada seguiría
-- operando hasta que venza sola. El titular puede volver a identificarse y ver
-- que está bloqueada — consultar nunca se impide.
--
-- Reactivar no regala nada: ni saldo, ni vencimiento, ni minutos ya vencidos.

create or replace function public.mensualidad_admin_cambiar_bloqueo(
  p_mensualidad_id  uuid,
  p_bloquear        boolean,
  p_motivo          text,
  p_actor           text,
  p_actor_rol       text,
  p_idempotency_key text
)
returns table (
  bloqueada_antes   boolean,
  bloqueada_ahora   boolean,
  estado_resultante text,
  sesiones_cerradas integer,
  idempotente       boolean
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_mens   public.mensualidades%rowtype;
  v_tel    text;
  v_hoy    date;
  v_ses    integer := 0;
  v_previo public.mensualidad_auditoria%rowtype;
  v_accion text;
begin
  perform public.mensualidad_admin_validar_entrada(p_motivo, p_actor, p_idempotency_key);
  if p_bloquear is null then
    raise exception 'operacion_invalida' using errcode = '22023';
  end if;
  v_accion := case when p_bloquear then 'bloquear' else 'reactivar' end;

  select * into v_previo from public.mensualidad_auditoria a
   where a.idempotency_key = p_idempotency_key limit 1;
  if found then
    if v_previo.mensualidad_id is distinct from p_mensualidad_id
       or v_previo.accion <> v_accion then
      raise exception 'idempotency_key_con_otro_payload' using errcode = '23505';
    end if;
    select * into v_mens from public.mensualidades m where m.id = p_mensualidad_id;
    v_hoy := public.mensualidad_hoy();
    return query select
      (v_previo.valor_anterior ->> 'bloqueada')::boolean,
      (v_previo.valor_nuevo ->> 'bloqueada')::boolean,
      public.mensualidad_estado(v_mens.saldo_minutos, v_mens.vence_el, v_mens.bloqueada, v_hoy),
      0, true;
    return;
  end if;

  select m.telefono_norm into v_tel from public.mensualidades m where m.id = p_mensualidad_id;
  if v_tel is null then
    raise exception 'mensualidad_inexistente' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('mensualidad:' || v_tel)::bigint);

  select * into v_mens from public.mensualidades m where m.id = p_mensualidad_id for update;
  if not found then
    raise exception 'mensualidad_inexistente' using errcode = 'P0002';
  end if;

  if coalesce(v_mens.bloqueada, false) = p_bloquear then
    raise exception 'estado_sin_cambios' using errcode = '22023';
  end if;

  update public.mensualidades m
     set bloqueada = p_bloquear,
         -- El motivo vive mientras dura el bloqueo; el histórico queda en la
         -- auditoría, así que al reactivar se limpia.
         bloqueo_motivo = case when p_bloquear then p_motivo else null end
   where m.id = p_mensualidad_id;

  if p_bloquear then
    v_ses := public.mensualidad_revocar_sesiones(p_mensualidad_id);
  end if;

  perform public.mensualidad_auditar(
    p_mensualidad_id, v_accion, p_actor, p_actor_rol, p_motivo,
    jsonb_build_object('bloqueada', coalesce(v_mens.bloqueada, false)),
    jsonb_build_object('bloqueada', p_bloquear, 'sesiones_cerradas', v_ses),
    null, p_idempotency_key
  );

  v_hoy := public.mensualidad_hoy();
  return query select
    coalesce(v_mens.bloqueada, false), p_bloquear,
    public.mensualidad_estado(v_mens.saldo_minutos, v_mens.vence_el, p_bloquear, v_hoy),
    v_ses, false;
end;
$fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- 8) CAMBIO DE TELÉFONO
-- ════════════════════════════════════════════════════════════════════════════
-- El teléfono normalizado ES la identidad: con él se renueva y con él se entra
-- a Mi Plan. Cambiarlo es cambiar quién puede autenticarse, así que:
--   · el nuevo se normaliza con el MISMO helper que usa el alta;
--   · si ya pertenece a otra billetera se rechaza (fusionar cuentas NO es M7);
--   · todas las sesiones se revocan, así el teléfono viejo deja de servir YA;
--   · no se mueve ni una compra, ni un movimiento, ni una reserva.
--
-- La auditoría guarda solo los últimos cuatro dígitos: alcanza para reconstruir
-- qué pasó sin dejar dos teléfonos completos escritos en una tabla de registro.

create or replace function public.mensualidad_admin_cambiar_telefono(
  p_mensualidad_id  uuid,
  p_telefono        text,      -- como lo escribió el administrador
  p_motivo          text,
  p_actor           text,
  p_actor_rol       text,
  p_idempotency_key text
)
returns table (
  telefono_anterior_fin text,
  telefono_nuevo_fin    text,
  sesiones_cerradas     integer,
  idempotente           boolean
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_mens   public.mensualidades%rowtype;
  v_norm   text;
  v_hoy    date;
  v_ses    integer := 0;
  v_previo public.mensualidad_auditoria%rowtype;
  v_a      text;
  v_b      text;
begin
  perform public.mensualidad_admin_validar_entrada(p_motivo, p_actor, p_idempotency_key);

  v_norm := public.mensualidad_normalizar_telefono(p_telefono);
  if v_norm is null or v_norm !~ '^[0-9]{10}$' then
    raise exception 'telefono_invalido' using errcode = '22023';
  end if;

  select * into v_previo from public.mensualidad_auditoria a
   where a.idempotency_key = p_idempotency_key limit 1;
  if found then
    if v_previo.mensualidad_id is distinct from p_mensualidad_id
       or v_previo.accion <> 'cambiar_telefono'
       or (v_previo.valor_nuevo ->> 'telefono_fin') is distinct from right(v_norm, 4) then
      raise exception 'idempotency_key_con_otro_payload' using errcode = '23505';
    end if;
    return query select
      (v_previo.valor_anterior ->> 'telefono_fin'),
      (v_previo.valor_nuevo ->> 'telefono_fin'),
      0, true;
    return;
  end if;

  select m.telefono_norm into v_a from public.mensualidades m where m.id = p_mensualidad_id;
  if v_a is null then
    raise exception 'mensualidad_inexistente' using errcode = 'P0002';
  end if;

  -- Los DOS teléfonos se bloquean, y siempre en el mismo orden: un cambio
  -- A→B concurrente con otro B→A no puede quedar trabado.
  v_b := v_norm;
  if v_a <= v_b then
    perform pg_advisory_xact_lock(hashtext('mensualidad:' || v_a)::bigint);
    if v_b <> v_a then perform pg_advisory_xact_lock(hashtext('mensualidad:' || v_b)::bigint); end if;
  else
    perform pg_advisory_xact_lock(hashtext('mensualidad:' || v_b)::bigint);
    perform pg_advisory_xact_lock(hashtext('mensualidad:' || v_a)::bigint);
  end if;

  select * into v_mens from public.mensualidades m where m.id = p_mensualidad_id for update;
  if not found then
    raise exception 'mensualidad_inexistente' using errcode = 'P0002';
  end if;

  if v_mens.telefono_norm = v_norm then
    raise exception 'telefono_sin_cambios' using errcode = '22023';
  end if;

  -- Ya es de otra persona: no se fusiona nada en silencio.
  if exists (
    select 1 from public.mensualidades m
     where m.telefono_norm = v_norm and m.id <> p_mensualidad_id
  ) then
    raise exception 'telefono_en_uso' using errcode = '22023';
  end if;

  update public.mensualidades m
     set titular_telefono = btrim(p_telefono),
         telefono_norm    = v_norm
   where m.id = p_mensualidad_id;

  v_ses := public.mensualidad_revocar_sesiones(p_mensualidad_id);

  perform public.mensualidad_auditar(
    p_mensualidad_id, 'cambiar_telefono', p_actor, p_actor_rol, p_motivo,
    jsonb_build_object('telefono_fin', right(v_mens.telefono_norm, 4)),
    jsonb_build_object('telefono_fin', right(v_norm, 4), 'sesiones_cerradas', v_ses),
    null, p_idempotency_key
  );

  return query select right(v_mens.telefono_norm, 4), right(v_norm, 4), v_ses, false;
end;
$fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- 9) REGENERAR EL CÓDIGO DE ACCESO
-- ════════════════════════════════════════════════════════════════════════════
-- El código se guarda en claro (mensualidades.codigo, único, con formato), así
-- que RECUPERARLO es simplemente leerlo — eso lo resuelve la capa de aplicación,
-- que solo se lo muestra a un administrador.
--
-- Regenerar es para cuando el código se filtró. El anterior deja de existir en
-- el mismo instante y las sesiones se cierran. El código nuevo NO se escribe en
-- la auditoría: quedaría en claro en una tabla de registro, que es justamente lo
-- que se quiere evitar.

create or replace function public.mensualidad_admin_regenerar_codigo(
  p_mensualidad_id  uuid,
  p_motivo          text,
  p_actor           text,
  p_actor_rol       text,
  p_idempotency_key text
)
returns table (
  codigo_nuevo      text,
  sesiones_cerradas integer,
  idempotente       boolean
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_mens   public.mensualidades%rowtype;
  v_tel    text;
  v_nuevo  text;
  v_ses    integer := 0;
  v_previo public.mensualidad_auditoria%rowtype;
  v_i      integer := 0;
begin
  perform public.mensualidad_admin_validar_entrada(p_motivo, p_actor, p_idempotency_key);

  -- Un reintento NO devuelve el código: no quedó guardado en ningún lado más
  -- que en la propia billetera, y repetir la acción generaría otro distinto.
  select * into v_previo from public.mensualidad_auditoria a
   where a.idempotency_key = p_idempotency_key limit 1;
  if found then
    if v_previo.mensualidad_id is distinct from p_mensualidad_id
       or v_previo.accion <> 'regenerar_codigo' then
      raise exception 'idempotency_key_con_otro_payload' using errcode = '23505';
    end if;
    select m.codigo into v_nuevo from public.mensualidades m where m.id = p_mensualidad_id;
    return query select v_nuevo, 0, true;
    return;
  end if;

  select m.telefono_norm into v_tel from public.mensualidades m where m.id = p_mensualidad_id;
  if v_tel is null then
    raise exception 'mensualidad_inexistente' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('mensualidad:' || v_tel)::bigint);

  select * into v_mens from public.mensualidades m where m.id = p_mensualidad_id for update;
  if not found then
    raise exception 'mensualidad_inexistente' using errcode = 'P0002';
  end if;

  -- El generador ya evita el alfabeto ambiguo; el bucle cubre la colisión rara.
  loop
    v_i := v_i + 1;
    v_nuevo := public.mensualidad_generar_codigo();
    exit when not exists (select 1 from public.mensualidades m where m.codigo = v_nuevo);
    if v_i >= 20 then
      raise exception 'no_se_pudo_generar_codigo' using errcode = '22023';
    end if;
  end loop;

  update public.mensualidades m set codigo = v_nuevo where m.id = p_mensualidad_id;

  v_ses := public.mensualidad_revocar_sesiones(p_mensualidad_id);

  -- Sin el código viejo ni el nuevo: solo que la acción ocurrió.
  perform public.mensualidad_auditar(
    p_mensualidad_id, 'regenerar_codigo', p_actor, p_actor_rol, p_motivo,
    jsonb_build_object('codigo', 'rotado'),
    jsonb_build_object('codigo', 'rotado', 'sesiones_cerradas', v_ses),
    null, p_idempotency_key
  );

  return query select v_nuevo, v_ses, false;
end;
$fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- 10) LISTADO ADMINISTRATIVO: búsqueda, filtro, orden y paginación EN SERVIDOR
-- ════════════════════════════════════════════════════════════════════════════
-- Nunca se bajan todas las filas al navegador. La búsqueda es una sola: el
-- administrador escribe lo que tiene a mano (un código, un teléfono, un
-- apellido, un mail, o la referencia de una reserva que le dictó el cliente) y
-- la función decide contra qué campo comparar según la FORMA del texto.
--
-- El orden es estable y total: por última actividad y, a igualdad, por id. Sin
-- ese desempate, dos páginas consecutivas podrían repetir u omitir una fila.

create or replace function public.mensualidad_admin_listar(
  p_busqueda text,
  p_estado   text,      -- 'vigente' | 'agotada' | 'vencida' | 'bloqueada' | 'todas'
  p_limite   integer,
  p_offset   integer
)
returns table (
  id               uuid,
  nombre           text,
  apellido         text,
  telefono         text,
  email            text,
  codigo           text,
  saldo_minutos    integer,
  vence_el         date,
  estado           text,
  plan_nombre      text,
  plan_comprado_at timestamptz,
  proxima_fecha    text,
  proxima_hora     text,
  ultima_actividad timestamptz,
  total            bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
-- Los nombres de RETURNS TABLE son variables: que ganen las columnas.
#variable_conflict use_column
declare
  v_hoy    date := public.mensualidad_hoy();
  v_q      text := nullif(btrim(coalesce(p_busqueda, '')), '');
  v_estado text := coalesce(nullif(btrim(lower(coalesce(p_estado, ''))), ''), 'todas');
  -- Tope duro: ni siquiera pidiendo 10.000 se baja la tabla entera.
  v_lim    integer := least(greatest(coalesce(p_limite, 25), 1), 100);
  v_off    integer := greatest(coalesce(p_offset, 0), 0);
  v_codigo text;
  v_tel    text;
  v_ref    text;
  v_like   text;
begin
  if v_estado not in ('vigente', 'agotada', 'vencida', 'bloqueada', 'todas') then
    raise exception 'filtro_invalido' using errcode = '22023';
  end if;

  if v_q is not null then
    -- Cada forma reconocible se resuelve por su campo exacto; lo que no encaja
    -- en ninguna se busca como texto en nombre, apellido y correo.
    v_codigo := public.mensualidad_normalizar_codigo(v_q);
    v_tel    := public.mensualidad_normalizar_telefono(v_q);
    v_ref    := case when upper(btrim(v_q)) ~ '^RES-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$'
                     then upper(btrim(v_q)) else null end;
    v_like   := '%' || lower(v_q) || '%';
  end if;

  return query
  with base as (
    select
      m.id as m_id, m.titular_nombre, m.titular_apellido, m.telefono_norm,
      m.titular_email, m.codigo as m_codigo, m.saldo_minutos as m_saldo,
      m.vence_el as m_vence, m.updated_at,
      public.mensualidad_estado(m.saldo_minutos, m.vence_el, m.bloqueada, v_hoy) as estado_calc
      from public.mensualidades m
     where (
       v_q is null
       or (v_codigo is not null and m.codigo = v_codigo)
       or (v_tel    is not null and m.telefono_norm = v_tel)
       or (v_ref    is not null and exists (
             select 1 from public.reservas r
              where r.referencia_publica = v_ref and r.mensualidad_id = m.id))
       or lower(m.titular_nombre)   like v_like
       or lower(m.titular_apellido) like v_like
       or lower(m.titular_email)    like v_like
       or lower(m.titular_nombre || ' ' || m.titular_apellido) like v_like
     )
  ), filtrada as (
    select b.* from base b
     where v_estado = 'todas' or b.estado_calc = v_estado
  ), enriquecida as (
    select
      f.*,
      ult.plan_nombre as ult_plan,
      ult.aprobado_at as ult_plan_at,
      prox.fecha      as prox_fecha,
      prox.hora       as prox_hora,
      greatest(
        f.updated_at,
        coalesce(mov.ultimo, f.updated_at),
        coalesce(ult.aprobado_at, f.updated_at)
      ) as actividad
      from filtrada f
      left join lateral (
        select c.plan_nombre, c.aprobado_at
          from public.mensualidad_compras c
         where c.mensualidad_id = f.m_id and c.procesamiento = 'aplicado'
         order by c.aprobado_at desc nulls last
         limit 1
      ) ult on true
      left join lateral (
        -- reservas.fecha es text: se compara contra el hoy de Córdoba en text.
        select r.fecha, r.hora
          from public.reservas r
         where r.mensualidad_id = f.m_id
           and r.origen = 'mensualidad'
           and r.estado = 'activa'
           and r.fecha >= v_hoy::text
         order by r.fecha asc, r.hora asc
         limit 1
      ) prox on true
      left join lateral (
        select max(mv.created_at) as ultimo
          from public.mensualidad_movimientos mv
         where mv.mensualidad_id = f.m_id
      ) mov on true
  )
  select
    e.m_id, e.titular_nombre, e.titular_apellido, e.telefono_norm, e.titular_email,
    e.m_codigo, e.m_saldo, e.m_vence, e.estado_calc,
    e.ult_plan, e.ult_plan_at, e.prox_fecha, e.prox_hora, e.actividad,
    count(*) over () as total
    from enriquecida e
   -- Orden TOTAL: sin el desempate por id, dos páginas seguidas podrían
   -- repetir u omitir una fila cuando hay empates en la actividad.
   order by e.actividad desc, e.m_id desc
   limit v_lim offset v_off;
end;
$fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- 11) El bloqueo también tiene que cortar la REPROGRAMACIÓN del cliente
-- ════════════════════════════════════════════════════════════════════════════
-- Crear una reserva y comprar ya estaban cortados para una billetera bloqueada
-- (crear_reserva_mensualidad y lib/mensualidadesCompra.ts). Reprogramar no lo
-- estaba: quedaba el hueco de que un titular bloqueado moviera un turno.
--
-- Cancelar SÍ se sigue permitiendo, a propósito: liberar un turno que ya no se
-- va a usar le sirve a la operación, y los minutos que vuelven quedan en una
-- billetera que igual no puede reservar.
--
-- El administrador puede reprogramar igual (p_ignorar_bloqueo), porque el
-- bloqueo es contra el cliente, no contra la operación interna. Se recrea la
-- función con el parámetro nuevo y su default, así el llamador de M5C sigue
-- funcionando sin cambios.

drop function if exists public.reprogramar_reserva_mensualidad(uuid, text, date, text, text[], text);

create or replace function public.reprogramar_reserva_mensualidad(
  p_mensualidad_id  uuid,
  p_referencia      text,
  p_fecha           date,
  p_hora            text,
  p_slots           text[],
  p_idempotency_key text,
  -- (M7) Solo la administración lo pasa en true: el bloqueo es contra el
  -- titular, no contra la operación interna.
  p_ignorar_bloqueo boolean default false
)
returns table (
  reserva_id         bigint,
  referencia_publica text,
  fecha              text,
  hora               text,
  duracion_minutos   integer,
  minutos_consumidos integer,
  sin_cambios        boolean
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_telefono text;
  v_mens     public.mensualidades%rowtype;
  v_reserva  public.reservas%rowtype;
  v_inicio   timestamptz;
  v_hoy      date;
  v_sims     text[];
  v_slot     text;
  v_sim      text;
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,64}$' then
    raise exception 'idempotency_key_invalida' using errcode = '22023';
  end if;
  if p_referencia is null or p_referencia !~ '^RES-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$' then
    raise exception 'reserva_inexistente' using errcode = 'P0002';
  end if;
  if p_hora is null or p_hora !~ '^\d{2}:\d{2}$' then
    raise exception 'hora_invalida' using errcode = '22023';
  end if;

  select m.telefono_norm into v_telefono
    from public.mensualidades m where m.id = p_mensualidad_id;
  if v_telefono is null then
    raise exception 'mensualidad_inexistente' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('mensualidad:' || v_telefono)::bigint);

  select * into v_mens from public.mensualidades m
   where m.id = p_mensualidad_id for update;

  v_hoy := public.mensualidad_hoy();
  -- (M7) Una billetera bloqueada no mueve turnos. Cancelar SÍ se sigue
  -- permitiendo: liberar un turno que no se va a usar le sirve a la operación.
  if not coalesce(p_ignorar_bloqueo, false)
     and public.mensualidad_estado(v_mens.saldo_minutos, v_mens.vence_el, v_mens.bloqueada, v_hoy) = 'bloqueada'
  then
    raise exception 'mensualidad_bloqueada' using errcode = '22023';
  end if;

  select * into v_reserva from public.reservas r
   where r.referencia_publica = p_referencia
     and r.mensualidad_id = p_mensualidad_id
     and r.origen = 'mensualidad'
   for update;
  if not found then
    raise exception 'reserva_inexistente' using errcode = 'P0002';
  end if;

  if v_reserva.estado <> 'activa' then
    raise exception 'estado_no_reprogramable' using errcode = '22023';
  end if;
  if coalesce(v_reserva.no_show, false) then
    raise exception 'estado_no_reprogramable' using errcode = '22023';
  end if;

  v_inicio := (v_reserva.fecha || ' ' || v_reserva.hora)::timestamp
              at time zone 'America/Argentina/Cordoba';
  if v_inicio <= now() then
    raise exception 'reserva_ya_iniciada' using errcode = '22023';
  end if;
  if (v_inicio - now()) < interval '24 hours' then
    raise exception 'fuera_de_plazo' using errcode = '22023';
  end if;

  if v_reserva.fecha = p_fecha::text and v_reserva.hora = p_hora then
    return query
      select v_reserva.id, v_reserva.referencia_publica, v_reserva.fecha, v_reserva.hora,
             v_reserva.duracion_minutos, v_reserva.minutos_consumidos, true;
    return;
  end if;

  -- (M5C.1) El turno NUEVO tiene que ser de lunes a viernes y terminar 22:00 o
  -- antes, con la duración ORIGINAL de la reserva.
  if not public.mensualidad_dia_habilitado(p_fecha) then
    raise exception 'dia_no_habilitado' using errcode = '22023';
  end if;
  if not public.mensualidad_termina_antes_del_cierre(p_hora, v_reserva.duracion_minutos) then
    raise exception 'fuera_de_horario' using errcode = '22023';
  end if;

  if p_fecha <= v_hoy then
    raise exception 'fecha_fuera_de_ventana' using errcode = '22023';
  end if;
  if p_fecha > (v_hoy + 15) then
    raise exception 'fecha_fuera_de_ventana' using errcode = '22023';
  end if;
  if p_fecha > v_mens.vence_el then
    raise exception 'turno_posterior_al_vencimiento' using errcode = '22023';
  end if;

  if coalesce(array_length(p_slots, 1), 0) <> (v_reserva.duracion_minutos / 15) then
    raise exception 'bloques_incoherentes' using errcode = '22023';
  end if;
  if array_length(p_slots, 1) <> (select count(distinct s) from unnest(p_slots) s) then
    raise exception 'bloques_incoherentes' using errcode = '22023';
  end if;
  if p_slots[1] is distinct from p_hora then
    raise exception 'bloques_incoherentes' using errcode = '22023';
  end if;
  if p_slots <> (select array_agg(s order by s) from unnest(p_slots) s) then
    raise exception 'bloques_desordenados' using errcode = '22023';
  end if;

  select array_agg(x order by x) into v_sims
    from jsonb_array_elements_text(v_reserva.simuladores) x;
  if coalesce(array_length(v_sims, 1), 0) = 0 then
    raise exception 'reserva_sin_simuladores' using errcode = '22023';
  end if;
  -- (M5C.1) Una reserva vieja de 1 simulador no se puede mover. Las reglas
  -- nuevas no invalidan lo ya reservado, pero tampoco lo reprograman: se cancela.
  if array_length(v_sims, 1) < 2 or array_length(v_sims, 1) > 4 then
    raise exception 'cantidad_simuladores_invalida' using errcode = '22023';
  end if;

  update public.reserva_slots rs
     set estado = 'reprogramada'
   where rs.reserva_id = v_reserva.id and rs.estado = 'activa';

  foreach v_slot in array p_slots loop
    foreach v_sim in array v_sims loop
      insert into public.reserva_slots (reserva_id, fecha, hora, simulador, estado)
      values (v_reserva.id, p_fecha, v_slot, v_sim, 'activa');
    end loop;
  end loop;

  update public.reservas
     set fecha = p_fecha::text,
         hora = p_hora,
         reprogramada_at = now(),
         reprogramaciones = coalesce(reprogramaciones, 0) + 1
   where id = v_reserva.id;

  return query
    select v_reserva.id, v_reserva.referencia_publica, p_fecha::text, p_hora,
           v_reserva.duracion_minutos, v_reserva.minutos_consumidos, false;
end;
$fn$;

-- ── 12) Permisos: solo service_role ─────────────────────────────────────────

revoke all on function public.mensualidad_revocar_sesiones(uuid) from public, anon, authenticated;
revoke all on function public.mensualidad_auditar(uuid, text, text, text, text, jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.mensualidad_admin_validar_entrada(text, text, text) from public, anon, authenticated;
revoke all on function public.mensualidad_admin_extender_vencimiento(uuid, date, text, text, text, text) from public, anon, authenticated;
revoke all on function public.mensualidad_admin_ajustar_saldo(uuid, text, integer, text, text, text, text) from public, anon, authenticated;
revoke all on function public.mensualidad_admin_cambiar_bloqueo(uuid, boolean, text, text, text, text) from public, anon, authenticated;
revoke all on function public.mensualidad_admin_cambiar_telefono(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.mensualidad_admin_regenerar_codigo(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.mensualidad_admin_listar(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.reprogramar_reserva_mensualidad(uuid, text, date, text, text[], text, boolean) from public, anon, authenticated;

grant execute on function public.mensualidad_admin_extender_vencimiento(uuid, date, text, text, text, text) to service_role;
grant execute on function public.mensualidad_admin_ajustar_saldo(uuid, text, integer, text, text, text, text) to service_role;
grant execute on function public.mensualidad_admin_cambiar_bloqueo(uuid, boolean, text, text, text, text) to service_role;
grant execute on function public.mensualidad_admin_cambiar_telefono(uuid, text, text, text, text, text) to service_role;
grant execute on function public.mensualidad_admin_regenerar_codigo(uuid, text, text, text, text) to service_role;
grant execute on function public.mensualidad_admin_listar(text, text, integer, integer) to service_role;
grant execute on function public.reprogramar_reserva_mensualidad(uuid, text, date, text, text[], text, boolean) to service_role;
