-- ============================================================================
-- Cupones de usos limitados: retención atómica compartida por Reservas y
-- Gift Cards (Marketing · cupón de uso único).
-- ----------------------------------------------------------------------------
-- Problema: el código se validaba al crear el checkout y se consumía recién en
-- el webhook. Dos compras simultáneas (o una Reserva y una Gift Card) pasaban la
-- validación y las dos pagaban con descuento.
--
-- Ciclo de una retención (una por intento de compra, intento = clave que manda
-- el navegador y repite en cada reintento del mismo pedido):
--   retenido  → el cupón queda apartado ANTES de habilitar cualquier pago con
--               descuento. Cuenta contra el límite igual que un uso.
--   consumido → hubo un pago aprobado (o la compra era 100 % bonificada). Suma
--               usos_actuales. Nunca vuelve atrás: una devolución no restaura el
--               uso (no hay regla comercial que lo diga).
--   liberado  → solo si nunca existió una oportunidad de pago, o si la
--               preferencia ya venció (vence_en) Y la aplicación verificó en
--               Mercado Pago que no queda ningún pago aprobable. La base impide
--               liberar antes de vence_en una retención con oportunidad de pago.
-- Si igual llega un pago aprobado de una retención liberada, se consume si
-- todavía hay cupo; si no, queda anotado (nota 'aprobado_sin_cupo') para
-- resolverlo a mano: la compra pagada no se bloquea.
--
-- Exclusividad: codigo_retener y todo consumo toman la fila del código con
-- FOR UPDATE y recién después cuentan retenciones (en otra sentencia, que ve lo
-- confirmado por quien tenía el bloqueo). consumir_codigo_descuento (la RPC de
-- siempre, que siguen usando los códigos sin límite y las compras viejas) pasa
-- a contar también las retenciones: ningún camino supera usos_maximos.
--
-- Permisos: RLS sin policies; anon y authenticated nada; service_role SOLO lee
-- la tabla. Las transiciones pasan por las RPCs SECURITY DEFINER. Va en
-- db/orden.txt DESPUÉS de esquema-base-permisos.sql (que da DML a service_role
-- sobre todo public).
--
-- Aditivo e idempotente. Verificación sin huella:
-- db/cupones-retencion.verificacion.sql (solo stack local).
-- Los cuerpos de las funciones NO llevan comentarios: las explicaciones van arriba.
-- ============================================================================


-- ── 1. Retenciones ──────────────────────────────────────────────────────────
-- vence_en: antes de ese momento otra compra no puede pedir que se verifique y
-- libere. Arranca en creación + 2 minutos (el pedido que la tomó sigue en curso:
-- crea la compra y marca la oportunidad de pago en milisegundos) y se corre a
-- "vencimiento de la preferencia + 5 minutos" cuando se habilita el pago. Con
-- oportunidad de pago, la base además impide liberarla antes de vence_en.
create table if not exists public.codigo_retenciones (
  id                 uuid primary key default gen_random_uuid(),
  intento            uuid not null,
  huella             text not null,
  codigo_id          bigint not null references public.codigos_descuento(id),
  codigo             text not null,
  producto           text not null,
  estado             text not null default 'retenido',
  reserva_id         bigint references public.reservas(id) on delete set null,
  grupo_compra_id    uuid,
  external_reference text,
  con_pago           boolean not null default false,
  preferencia_id     text,
  init_point         text,
  total_original     numeric,
  descuento          numeric,
  total_final        numeric,
  pago_id            text,
  nota               text,
  retenido_en        timestamptz not null default clock_timestamp(),
  vence_en           timestamptz not null default (clock_timestamp() + interval '2 minutes'),
  consumido_en       timestamptz,
  liberado_en        timestamptz,
  motivo_liberacion  text,
  constraint codigo_retenciones_intento_key unique (intento),
  constraint codigo_retenciones_extref_key unique (external_reference),
  constraint codigo_retenciones_producto check (producto in ('reserva', 'gift_card')),
  constraint codigo_retenciones_estado check (estado in ('retenido', 'consumido', 'liberado')),
  constraint codigo_retenciones_compra check (
    (producto = 'reserva' and grupo_compra_id is null) or (producto = 'gift_card' and reserva_id is null))
);

-- Redeclarada por nombre (idempotente). Sin NULL en las ramas: un CHECK que da
-- NULL deja pasar la fila.
alter table public.codigo_retenciones drop constraint if exists codigo_retenciones_coherencia;
alter table public.codigo_retenciones add constraint codigo_retenciones_coherencia check (
  (estado = 'retenido' and consumido_en is null and liberado_en is null and motivo_liberacion is null)
  or (estado = 'consumido' and consumido_en is not null)
  or (estado = 'liberado' and consumido_en is null and liberado_en is not null and motivo_liberacion is not null
      and motivo_liberacion in ('sin_oportunidad_de_pago', 'sin_pago_tras_vencer')));

create index if not exists codigo_retenciones_retenidas_idx
  on public.codigo_retenciones (codigo_id) where estado = 'retenido';
create unique index if not exists codigo_retenciones_reserva_key
  on public.codigo_retenciones (reserva_id) where reserva_id is not null;
create unique index if not exists codigo_retenciones_grupo_key
  on public.codigo_retenciones (grupo_compra_id) where grupo_compra_id is not null;


-- ── 2. Retener ──────────────────────────────────────────────────────────────
-- Mismo intento → la retención existente (reutilizada), si es el mismo pedido.
-- Si no hay cupo y alguna retención ya pasó su vence_en, las devuelve en
-- 'vencidas' para que la aplicación las verifique en Mercado Pago.
create or replace function public.codigo_retener(p_intento uuid, p_codigo text, p_producto text, p_huella text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cod  text := upper(btrim(coalesce(p_codigo, '')));
  v_hoy  date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_r    public.codigo_retenciones;
  v_c    public.codigos_descuento;
  v_ret  integer;
  v_venc uuid[];
begin
  if p_intento is null or v_cod = '' or coalesce(p_producto, '') not in ('reserva', 'gift_card')
     or coalesce(btrim(p_huella), '') = '' then
    raise exception 'datos_invalidos' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('codigo_retencion'), hashtext(p_intento::text));
  select * into v_r from public.codigo_retenciones where intento = p_intento;
  if found then
    if v_r.huella <> p_huella or v_r.codigo <> v_cod or v_r.producto <> p_producto then
      raise exception 'intento_con_otro_pedido' using errcode = '23505';
    end if;
    select * into v_c from public.codigos_descuento where id = v_r.codigo_id;
    return jsonb_build_object('ok', true, 'reutilizada', true, 'retencion', to_jsonb(v_r), 'codigo', to_jsonb(v_c));
  end if;

  select * into v_c from public.codigos_descuento where codigo = v_cod for update;
  if not found or v_c.deleted_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'inexistente');
  end if;
  if v_c.usos_maximos is not null and coalesce(v_c.usos_actuales, 0) >= v_c.usos_maximos then
    return jsonb_build_object('ok', false, 'motivo', 'agotado');
  end if;
  if not v_c.activo then
    return jsonb_build_object('ok', false, 'motivo', 'inactivo');
  end if;
  if v_c.fecha_inicio is not null and v_hoy < v_c.fecha_inicio then
    return jsonb_build_object('ok', false, 'motivo', 'no_vigente');
  end if;
  if v_c.fecha_fin is not null and v_hoy > v_c.fecha_fin then
    return jsonb_build_object('ok', false, 'motivo', 'vencido');
  end if;
  if v_c.usos_maximos is null then
    return jsonb_build_object('ok', false, 'motivo', 'sin_limite');
  end if;

  select count(*), coalesce(array_agg(r.id order by r.vence_en) filter (where r.vence_en < clock_timestamp()), '{}')
    into v_ret, v_venc
    from public.codigo_retenciones r
   where r.codigo_id = v_c.id and r.estado = 'retenido';
  if coalesce(v_c.usos_actuales, 0) + v_ret >= v_c.usos_maximos then
    return jsonb_build_object('ok', false, 'motivo', 'en_uso', 'vencidas', to_jsonb(v_venc));
  end if;

  insert into public.codigo_retenciones (intento, huella, codigo_id, codigo, producto)
  values (p_intento, p_huella, v_c.id, v_c.codigo, p_producto)
  returning * into v_r;
  return jsonb_build_object('ok', true, 'reutilizada', false, 'retencion', to_jsonb(v_r), 'codigo', to_jsonb(v_c));
end;
$fn$;


-- ── 3. Vincular compra, importes y oportunidad de pago ──────────────────────
-- p_datos: reserva_id | grupo_compra_id, external_reference, total_original,
-- descuento, total_final (una vez fijados no cambian), con_pago + expira (el
-- vencimiento de la preferencia; se marca ANTES de crearla) y preferencia_id +
-- init_point (los de la última preferencia creada).
create or replace function public.codigo_retencion_vincular(p_id uuid, p_datos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_r     public.codigo_retenciones;
  v_k     text;
  v_txt   text;
  v_num   numeric;
  v_exp   timestamptz;
begin
  if p_id is null or p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'datos_invalidos' using errcode = '22023';
  end if;
  for v_k in select jsonb_object_keys(p_datos) loop
    if v_k not in ('reserva_id', 'grupo_compra_id', 'external_reference', 'total_original', 'descuento', 'total_final',
                   'con_pago', 'expira', 'preferencia_id', 'init_point') then
      raise exception 'campo_desconocido:%', v_k using errcode = '22023';
    end if;
  end loop;

  select * into v_r from public.codigo_retenciones where id = p_id for update;
  if not found then
    raise exception 'retencion_inexistente' using errcode = 'P0002';
  end if;
  if v_r.estado <> 'retenido' then
    raise exception 'retencion_no_retenida' using errcode = '55000';
  end if;

  if p_datos ? 'reserva_id' then
    if v_r.producto <> 'reserva' then raise exception 'campo_no_aplica:reserva_id' using errcode = '22023'; end if;
    v_num := (p_datos ->> 'reserva_id')::numeric;
    if v_r.reserva_id is not null and v_r.reserva_id <> v_num then
      raise exception 'retencion_ya_vinculada' using errcode = '55000';
    end if;
    v_r.reserva_id := v_num;
  end if;
  if p_datos ? 'grupo_compra_id' then
    if v_r.producto <> 'gift_card' then raise exception 'campo_no_aplica:grupo_compra_id' using errcode = '22023'; end if;
    if v_r.grupo_compra_id is not null and v_r.grupo_compra_id <> (p_datos ->> 'grupo_compra_id')::uuid then
      raise exception 'retencion_ya_vinculada' using errcode = '55000';
    end if;
    v_r.grupo_compra_id := (p_datos ->> 'grupo_compra_id')::uuid;
  end if;
  if p_datos ? 'external_reference' then
    v_txt := p_datos ->> 'external_reference';
    if coalesce(v_txt, '') = '' then raise exception 'campo_invalido:external_reference' using errcode = '22023'; end if;
    if v_r.external_reference is not null and v_r.external_reference <> v_txt then
      raise exception 'retencion_ya_vinculada' using errcode = '55000';
    end if;
    v_r.external_reference := v_txt;
  end if;
  foreach v_k in array array['total_original', 'descuento', 'total_final'] loop
    if p_datos ? v_k then
      v_num := (p_datos ->> v_k)::numeric;
      if v_num is null or v_num < 0 then raise exception 'campo_invalido:%', v_k using errcode = '22023'; end if;
      if v_k = 'total_original' then
        if v_r.total_original is not null and v_r.total_original <> v_num then raise exception 'retencion_ya_vinculada' using errcode = '55000'; end if;
        v_r.total_original := v_num;
      elsif v_k = 'descuento' then
        if v_r.descuento is not null and v_r.descuento <> v_num then raise exception 'retencion_ya_vinculada' using errcode = '55000'; end if;
        v_r.descuento := v_num;
      else
        if v_r.total_final is not null and v_r.total_final <> v_num then raise exception 'retencion_ya_vinculada' using errcode = '55000'; end if;
        v_r.total_final := v_num;
      end if;
    end if;
  end loop;
  if p_datos ? 'con_pago' then
    if (p_datos -> 'con_pago') <> 'true'::jsonb then raise exception 'campo_invalido:con_pago' using errcode = '22023'; end if;
    if not (p_datos ? 'expira') then raise exception 'falta_expira' using errcode = '22023'; end if;
    if v_r.external_reference is null then raise exception 'falta_external_reference' using errcode = '22023'; end if;
    v_r.con_pago := true;
  end if;
  if p_datos ? 'expira' then
    if not v_r.con_pago then raise exception 'campo_no_aplica:expira' using errcode = '22023'; end if;
    v_exp := (p_datos ->> 'expira')::timestamptz;
    if v_exp is null or v_exp < clock_timestamp() - interval '1 minute' or v_exp > clock_timestamp() + interval '1 day' then
      raise exception 'campo_invalido:expira' using errcode = '22023';
    end if;
    v_r.vence_en := greatest(v_r.vence_en, v_exp + interval '5 minutes');
  end if;
  if p_datos ? 'preferencia_id' or p_datos ? 'init_point' then
    if not v_r.con_pago then raise exception 'campo_no_aplica:preferencia_id' using errcode = '22023'; end if;
    if coalesce(p_datos ->> 'preferencia_id', '') = '' or coalesce(p_datos ->> 'init_point', '') = '' then
      raise exception 'campo_invalido:preferencia_id' using errcode = '22023';
    end if;
    v_r.preferencia_id := p_datos ->> 'preferencia_id';
    v_r.init_point := p_datos ->> 'init_point';
  end if;

  update public.codigo_retenciones
     set reserva_id = v_r.reserva_id, grupo_compra_id = v_r.grupo_compra_id, external_reference = v_r.external_reference,
         total_original = v_r.total_original, descuento = v_r.descuento, total_final = v_r.total_final,
         con_pago = v_r.con_pago, vence_en = v_r.vence_en, preferencia_id = v_r.preferencia_id, init_point = v_r.init_point
   where id = p_id
  returning * into v_r;
  return to_jsonb(v_r);
end;
$fn$;


-- ── 4. Consumir ─────────────────────────────────────────────────────────────
-- Idempotente: una retención consumida devuelve 'ya_consumida'. Registra el uso
-- en usos_codigos_descuento en la misma transacción.
create or replace function public.codigo_retencion_consumir(p_id uuid, p_pago_id text, p_contexto jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_r    public.codigo_retenciones;
  v_c    public.codigos_descuento;
  v_ret  integer;
  v_nota text;
  v_ctx  jsonb := coalesce(p_contexto, '{}'::jsonb);
begin
  select * into v_r from public.codigo_retenciones where id = p_id for update;
  if not found then
    raise exception 'retencion_inexistente' using errcode = 'P0002';
  end if;
  if v_r.estado = 'consumido' then
    return jsonb_build_object('resultado', 'ya_consumida', 'pago_id', v_r.pago_id);
  end if;

  select * into v_c from public.codigos_descuento where id = v_r.codigo_id for update;
  if v_r.estado = 'liberado' then
    if v_c.usos_maximos is not null then
      select count(*) into v_ret from public.codigo_retenciones r where r.codigo_id = v_c.id and r.estado = 'retenido';
      if coalesce(v_c.usos_actuales, 0) + v_ret >= v_c.usos_maximos then
        update public.codigo_retenciones
           set nota = 'aprobado_sin_cupo', pago_id = coalesce(nullif(p_pago_id, ''), pago_id)
         where id = p_id;
        return jsonb_build_object('resultado', 'sin_cupo');
      end if;
    end if;
    v_nota := 'consumida_tras_liberar';
  end if;

  update public.codigos_descuento c
     set usos_actuales = coalesce(c.usos_actuales, 0) + 1,
         activo = case when c.usos_maximos is not null and coalesce(c.usos_actuales, 0) + 1 >= c.usos_maximos
                       then false else c.activo end
   where c.id = v_c.id;
  update public.codigo_retenciones
     set estado = 'consumido', consumido_en = clock_timestamp(), pago_id = nullif(p_pago_id, ''), nota = coalesce(v_nota, nota)
   where id = p_id;
  insert into public.usos_codigos_descuento (
    codigo_id, codigo, reserva_id, nombre, telefono, fecha_reserva, hora_reserva,
    total_original, descuento_aplicado, total_final, mercado_pago_payment_id)
  values (
    v_c.id, v_c.codigo, v_r.reserva_id, left(v_ctx ->> 'nombre', 120), left(v_ctx ->> 'telefono', 40),
    case when (v_ctx ->> 'fecha_reserva') ~ '^\d{4}-\d{2}-\d{2}$' then (v_ctx ->> 'fecha_reserva')::date end,
    left(v_ctx ->> 'hora_reserva', 10), v_r.total_original, v_r.descuento, v_r.total_final, nullif(p_pago_id, ''));
  return jsonb_build_object('resultado', coalesce(v_nota, 'consumida'));
end;
$fn$;


-- ── 5. Liberar ──────────────────────────────────────────────────────────────
-- 'sin_oportunidad_de_pago': nunca se habilitó un pago (con_pago = false).
-- 'sin_pago_tras_vencer': hubo oportunidad, ya pasó vence_en y la aplicación
-- verificó en Mercado Pago que no queda pago aprobable. La base no puede mirar
-- Mercado Pago: lo que sí impide es liberar antes de tiempo.
create or replace function public.codigo_retencion_liberar(p_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_r public.codigo_retenciones;
begin
  if coalesce(p_motivo, '') not in ('sin_oportunidad_de_pago', 'sin_pago_tras_vencer') then
    raise exception 'motivo_invalido' using errcode = '22023';
  end if;
  select * into v_r from public.codigo_retenciones where id = p_id for update;
  if not found then
    raise exception 'retencion_inexistente' using errcode = 'P0002';
  end if;
  if v_r.estado = 'liberado' then
    return jsonb_build_object('resultado', 'ya_liberada');
  end if;
  if v_r.estado = 'consumido' then
    return jsonb_build_object('resultado', 'consumida');
  end if;
  if p_motivo = 'sin_oportunidad_de_pago' and v_r.con_pago then
    raise exception 'retencion_con_pago' using errcode = '55000';
  end if;
  if p_motivo = 'sin_pago_tras_vencer' and (not v_r.con_pago or clock_timestamp() < v_r.vence_en) then
    raise exception 'retencion_vigente' using errcode = '55000';
  end if;
  update public.codigo_retenciones
     set estado = 'liberado', liberado_en = clock_timestamp(), motivo_liberacion = p_motivo
   where id = p_id;
  return jsonb_build_object('resultado', 'liberada');
end;
$fn$;


-- ── 6. El consumo de siempre también respeta las retenciones ────────────────
create or replace function public.consumir_codigo_descuento(p_codigo text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_c codigos_descuento;
  v_retenidos integer;
  v_hoy text := to_char((now() at time zone 'America/Argentina/Buenos_Aires'), 'YYYY-MM-DD');
begin
  select * into v_c from codigos_descuento c
   where c.codigo = upper(trim(p_codigo))
     and c.activo = true
     and c.deleted_at is null
     and (c.fecha_inicio is null or c.fecha_inicio::text <= v_hoy)
     and (c.fecha_fin is null or c.fecha_fin::text >= v_hoy)
   for update;
  if not found then
    return false;
  end if;
  select count(*) into v_retenidos from codigo_retenciones r where r.codigo_id = v_c.id and r.estado = 'retenido';
  if v_c.usos_maximos is not null and coalesce(v_c.usos_actuales, 0) + v_retenidos >= v_c.usos_maximos then
    return false;
  end if;
  update codigos_descuento c
  set usos_actuales = coalesce(c.usos_actuales, 0) + 1,
      activo = case
                 when c.usos_maximos is not null
                      and coalesce(c.usos_actuales, 0) + 1 >= c.usos_maximos then false
                 else c.activo
               end
  where c.id = v_c.id;
  return true;
end;
$function$;


-- ── 7. Permisos ─────────────────────────────────────────────────────────────
alter table public.codigo_retenciones enable row level security;
revoke all on table public.codigo_retenciones from public, anon, authenticated, service_role;
grant select on table public.codigo_retenciones to service_role;

revoke all on function public.codigo_retener(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.codigo_retencion_vincular(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.codigo_retencion_consumir(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.codigo_retencion_liberar(uuid, text) from public, anon, authenticated;
revoke all on function public.consumir_codigo_descuento(text) from public, anon, authenticated;
grant execute on function public.codigo_retener(uuid, text, text, text) to service_role;
grant execute on function public.codigo_retencion_vincular(uuid, jsonb) to service_role;
grant execute on function public.codigo_retencion_consumir(uuid, text, jsonb) to service_role;
grant execute on function public.codigo_retencion_liberar(uuid, text) to service_role;
grant execute on function public.consumir_codigo_descuento(text) to service_role;
