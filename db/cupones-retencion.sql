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
--               usos_actuales una sola vez (si el camino anterior ya lo había
--               contado para ese pago o esa reserva, no lo vuelve a sumar).
--               Nunca vuelve atrás: una devolución no restaura el uso.
--   liberado  → solo si nunca existió una oportunidad de pago, o si ya pasó
--               vence_en Y la aplicación verificó en Mercado Pago (consulta
--               completa) que no hay pago aprobado ni abierto y que ninguna
--               preferencia de esa compra se puede pagar. La base impide liberar
--               antes de vence_en una retención con oportunidad de pago.
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
-- Compras creadas ANTES de esta migración (sin retención): al aplicarla, cada
-- compra pendiente con un código limitado recibe una retención 'legado' con
-- oportunidad de pago (su preferencia puede no vencer nunca). codigo_retener
-- repite esa cobertura para el código que retiene, por si apareció alguna más.
-- Se liberan solo cuando Mercado Pago confirma que ya no se pueden pagar.
--
-- Turno de preparación: crear o recuperar la preferencia de una retención lo
-- hace un solo pedido a la vez (preparando_por / preparando_hasta). Guardar el
-- link exige el turno: dos pedidos del mismo intento nunca entregan dos links.
--
-- Permisos: RLS sin policies; anon y authenticated nada; service_role SOLO lee
-- la tabla. Las transiciones pasan por las RPCs SECURITY DEFINER. Va en
-- db/orden.txt DESPUÉS de esquema-base-permisos.sql (que da DML a service_role
-- sobre todo public).
--
-- Pausa: codigo_retenciones_pausar(true, motivo) frena las retenciones NUEVAS sin
-- tocar las existentes (sección 1b). Solo por SQL, con el rol dueño.
--
-- Aditivo e idempotente. Verificación sin huella:
-- db/cupones-retencion.verificacion.sql (solo stack local).
-- Rollback: db/cupones-retencion.rollback.sql, que exige pausa y 0 retenidas
-- (ver docs/marketing/cupones-retencion.md).
-- Los cuerpos de las funciones NO llevan comentarios: las explicaciones van arriba.
-- ============================================================================


-- ── 1. Retenciones ──────────────────────────────────────────────────────────
-- vence_en: antes de ese momento otra compra no puede pedir que se verifique y
-- libere. Arranca en creación + 2 minutos (el pedido que la tomó sigue en curso)
-- y se corre a "vencimiento de la preferencia + 15 minutos" cuando se habilita el
-- pago. Mercado Pago no documenta cuánto tarda un pago en aparecer en la
-- búsqueda: el margen es deliberadamente amplio.
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

-- Registro de la conciliación y turno de preparación.
alter table public.codigo_retenciones add column if not exists revisiones integer not null default 0;
alter table public.codigo_retenciones add column if not exists revisada_en timestamptz;
alter table public.codigo_retenciones add column if not exists revision_resultado text;
alter table public.codigo_retenciones add column if not exists revision_motivo text;
alter table public.codigo_retenciones add column if not exists preparando_por uuid;
alter table public.codigo_retenciones add column if not exists preparando_hasta timestamptz;

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
create index if not exists codigo_retenciones_vencidas_idx
  on public.codigo_retenciones (vence_en) where estado = 'retenido';
create unique index if not exists codigo_retenciones_reserva_key
  on public.codigo_retenciones (reserva_id) where reserva_id is not null;
create unique index if not exists codigo_retenciones_grupo_key
  on public.codigo_retenciones (grupo_compra_id) where grupo_compra_id is not null;


-- ── 1b. Pausa de NUEVAS retenciones (corrección hacia adelante) ─────────────
-- Una sola fila. Con nuevas_pausadas, codigo_retener no aparta un cupón
-- limitado para un pedido NUEVO (la aplicación responde 503, sin cobrar), pero
-- todo lo que ya existe sigue: el mismo intento recupera su retención y su link,
-- los webhooks consumen y la conciliación libera. Es el paso previo obligatorio
-- del rollback (db/cupones-retencion.rollback.sql exige pausa y 0 retenidas) y
-- la herramienta para frenar sin perder nada cuando hay que corregir algo.
-- Volver a aplicar esta migración NO quita una pausa: hay que reanudar a propósito.
create table if not exists public.codigo_retenciones_control (
  id              boolean primary key default true,
  nuevas_pausadas boolean not null default false,
  motivo          text,
  cambiado_en     timestamptz not null default now(),
  constraint codigo_retenciones_control_unica check (id),
  constraint codigo_retenciones_control_motivo check (motivo is null or char_length(motivo) between 3 and 300)
);
insert into public.codigo_retenciones_control (id) values (true) on conflict (id) do nothing;

create or replace function public.codigo_retenciones_pausar(p_pausar boolean, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_c public.codigo_retenciones_control;
begin
  if p_pausar is null or (p_pausar and char_length(btrim(coalesce(p_motivo, ''))) < 3) then
    raise exception 'datos_invalidos' using errcode = '22023';
  end if;
  update public.codigo_retenciones_control
     set nuevas_pausadas = p_pausar,
         motivo = case when p_pausar then btrim(p_motivo) else null end,
         cambiado_en = clock_timestamp()
   where id
  returning * into v_c;
  return jsonb_build_object(
    'nuevas_pausadas', v_c.nuevas_pausadas, 'motivo', v_c.motivo, 'cambiado_en', v_c.cambiado_en,
    'retenidas', (select count(*) from public.codigo_retenciones where estado = 'retenido'));
end;
$fn$;


-- ── 2. Compras anteriores sin retención (legado) ────────────────────────────
-- Una por compra pendiente (sin pago) con ese código limitado: reservas en
-- pendiente_pago o error_pago y grupos de Gift Cards sin pago en
-- pendiente_pago, rechazado o cancelado. vence_en = ahora: queda para verificar
-- en Mercado Pago de inmediato. p_antiguedad deja afuera las compras recién
-- creadas (un pedido nuevo en curso que todavía no vinculó su retención).
create or replace function public.codigo_retenciones_cubrir_legado(p_codigo_id bigint, p_antiguedad interval)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_c   public.codigos_descuento;
  v_n   integer := 0;
  v_m   integer;
begin
  select * into v_c from public.codigos_descuento where id = p_codigo_id;
  if not found or v_c.usos_maximos is null then
    return 0;
  end if;

  insert into public.codigo_retenciones (
    intento, huella, codigo_id, codigo, producto, reserva_id, external_reference, con_pago,
    total_original, descuento, total_final, vence_en, nota)
  select gen_random_uuid(), 'legado', v_c.id, v_c.codigo, 'reserva', r.id, 'reserva_' || r.id, true,
         r.total_original, r.descuento_aplicado, r.total, clock_timestamp(), 'legado'
    from public.reservas r
   where upper(btrim(r.codigo_descuento)) = v_c.codigo
     and r.mercado_pago_payment_id is null
     and r.estado in ('pendiente_pago', 'error_pago')
     and r.created_at < clock_timestamp() - coalesce(p_antiguedad, interval '0')
     and not exists (select 1 from public.codigo_retenciones x where x.reserva_id = r.id)
     and not exists (select 1 from public.codigo_retenciones x where x.external_reference = 'reserva_' || r.id);
  get diagnostics v_m = row_count;
  v_n := v_n + v_m;

  insert into public.codigo_retenciones (
    intento, huella, codigo_id, codigo, producto, grupo_compra_id, external_reference, con_pago,
    preferencia_id, total_original, descuento, total_final, vence_en, nota)
  select gen_random_uuid(), 'legado', v_c.id, v_c.codigo, 'gift_card', g.grupo_compra_id, 'gift_card_' || g.grupo_compra_id, true,
         max(g.mercado_pago_preference_id), sum(g.monto_original), sum(g.descuento_aplicado), sum(g.monto), clock_timestamp(), 'legado'
    from public.gift_cards g
   where upper(btrim(g.codigo_descuento)) = v_c.codigo
     and g.grupo_compra_id is not null
     and g.deleted_at is null
   group by g.grupo_compra_id
  having bool_and(g.mercado_pago_payment_id is null)
     and bool_and(g.estado_pago in ('pendiente_pago', 'rechazado', 'cancelado'))
     and min(g.created_at) < clock_timestamp() - coalesce(p_antiguedad, interval '0')
     and not exists (select 1 from public.codigo_retenciones x where x.grupo_compra_id = g.grupo_compra_id)
     and not exists (select 1 from public.codigo_retenciones x where x.external_reference = 'gift_card_' || g.grupo_compra_id);
  get diagnostics v_m = row_count;
  return v_n + v_m;
end;
$fn$;


-- ── 3. Retener ──────────────────────────────────────────────────────────────
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
  if exists (select 1 from public.codigo_retenciones_control where id and nuevas_pausadas) then
    return jsonb_build_object('ok', false, 'motivo', 'pausado');
  end if;

  perform public.codigo_retenciones_cubrir_legado(v_c.id, interval '2 minutes');

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


-- ── 4. Vincular compra, importes, oportunidad de pago y preferencia ─────────
-- p_datos: reserva_id | grupo_compra_id, external_reference, total_original,
-- descuento, total_final (una vez fijados no cambian), con_pago + expira (el
-- vencimiento de la preferencia; se marca ANTES de crearla), preparar
-- {token, segundos} (toma el turno de preparación; si otro lo tiene vigente,
-- 'preparacion_en_curso'), preferencia_id + init_point + preparacion (el token:
-- guardar el link exige tener el turno, y lo devuelve) y soltar (el token:
-- devuelve el turno sin guardar nada).
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
  v_tok   uuid;
  v_seg   integer;
begin
  if p_id is null or p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'datos_invalidos' using errcode = '22023';
  end if;
  for v_k in select jsonb_object_keys(p_datos) loop
    if v_k not in ('reserva_id', 'grupo_compra_id', 'external_reference', 'total_original', 'descuento', 'total_final',
                   'con_pago', 'expira', 'preferencia_id', 'init_point', 'preparar', 'preparacion', 'soltar') then
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

  if p_datos ? 'soltar' then
    if v_r.preparando_por = (p_datos ->> 'soltar')::uuid then
      v_r.preparando_por := null;
      v_r.preparando_hasta := null;
    end if;
  end if;

  if p_datos ? 'preparar' then
    v_tok := (p_datos -> 'preparar' ->> 'token')::uuid;
    v_seg := (p_datos -> 'preparar' ->> 'segundos')::integer;
    if v_tok is null or v_seg is null or v_seg < 5 or v_seg > 300 then
      raise exception 'campo_invalido:preparar' using errcode = '22023';
    end if;
    if v_r.preparando_hasta > clock_timestamp() and v_r.preparando_por is distinct from v_tok then
      raise exception 'preparacion_en_curso' using errcode = '55000';
    end if;
    v_r.preparando_por := v_tok;
    v_r.preparando_hasta := clock_timestamp() + make_interval(secs => v_seg);
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
    v_r.vence_en := greatest(v_r.vence_en, v_exp + interval '15 minutes');
  end if;
  if p_datos ? 'preferencia_id' or p_datos ? 'init_point' then
    if not v_r.con_pago then raise exception 'campo_no_aplica:preferencia_id' using errcode = '22023'; end if;
    if coalesce(p_datos ->> 'preferencia_id', '') = '' or coalesce(p_datos ->> 'init_point', '') = '' then
      raise exception 'campo_invalido:preferencia_id' using errcode = '22023';
    end if;
    if v_r.preparando_por is null or v_r.preparando_por is distinct from (p_datos ->> 'preparacion')::uuid then
      raise exception 'preparacion_perdida' using errcode = '55000';
    end if;
    v_r.preferencia_id := p_datos ->> 'preferencia_id';
    v_r.init_point := p_datos ->> 'init_point';
    v_r.preparando_por := null;
    v_r.preparando_hasta := null;
  end if;

  update public.codigo_retenciones
     set reserva_id = v_r.reserva_id, grupo_compra_id = v_r.grupo_compra_id, external_reference = v_r.external_reference,
         total_original = v_r.total_original, descuento = v_r.descuento, total_final = v_r.total_final,
         con_pago = v_r.con_pago, vence_en = v_r.vence_en, preferencia_id = v_r.preferencia_id, init_point = v_r.init_point,
         preparando_por = v_r.preparando_por, preparando_hasta = v_r.preparando_hasta
   where id = p_id
  returning * into v_r;
  return to_jsonb(v_r);
end;
$fn$;


-- ── 5. Consumir ─────────────────────────────────────────────────────────────
-- Idempotente: una retención consumida devuelve 'ya_consumida'. Registra el uso
-- en usos_codigos_descuento en la misma transacción. Si ese uso ya estaba
-- registrado por el camino anterior (mismo pago o misma reserva), la retención
-- queda consumida SIN volver a sumar ('ya_contado').
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
  v_pago text := nullif(btrim(coalesce(p_pago_id, '')), '');
begin
  select * into v_r from public.codigo_retenciones where id = p_id for update;
  if not found then
    raise exception 'retencion_inexistente' using errcode = 'P0002';
  end if;
  if v_r.estado = 'consumido' then
    return jsonb_build_object('resultado', 'ya_consumida', 'pago_id', v_r.pago_id);
  end if;

  select * into v_c from public.codigos_descuento where id = v_r.codigo_id for update;

  if exists (select 1 from public.usos_codigos_descuento u
              where u.codigo_id = v_c.id
                and ((v_pago is not null and u.mercado_pago_payment_id = v_pago)
                     or (v_r.reserva_id is not null and u.reserva_id = v_r.reserva_id))) then
    update public.codigo_retenciones
       set estado = 'consumido', consumido_en = clock_timestamp(), pago_id = coalesce(v_pago, pago_id), nota = 'ya_contado'
     where id = p_id;
    return jsonb_build_object('resultado', 'ya_contado');
  end if;

  if v_r.estado = 'liberado' then
    if v_c.usos_maximos is not null then
      select count(*) into v_ret from public.codigo_retenciones r where r.codigo_id = v_c.id and r.estado = 'retenido';
      if coalesce(v_c.usos_actuales, 0) + v_ret >= v_c.usos_maximos then
        update public.codigo_retenciones
           set nota = 'aprobado_sin_cupo', pago_id = coalesce(v_pago, pago_id)
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
     set estado = 'consumido', consumido_en = clock_timestamp(), pago_id = v_pago, nota = coalesce(v_nota, nota),
         preparando_por = null, preparando_hasta = null
   where id = p_id;
  insert into public.usos_codigos_descuento (
    codigo_id, codigo, reserva_id, nombre, telefono, fecha_reserva, hora_reserva,
    total_original, descuento_aplicado, total_final, mercado_pago_payment_id)
  values (
    v_c.id, v_c.codigo, v_r.reserva_id, left(v_ctx ->> 'nombre', 120), left(v_ctx ->> 'telefono', 40),
    case when (v_ctx ->> 'fecha_reserva') ~ '^\d{4}-\d{2}-\d{2}$' then (v_ctx ->> 'fecha_reserva')::date end,
    left(v_ctx ->> 'hora_reserva', 10), v_r.total_original, v_r.descuento, v_r.total_final, v_pago);
  return jsonb_build_object('resultado', coalesce(v_nota, 'consumida'));
end;
$fn$;


-- ── 6. Liberar ──────────────────────────────────────────────────────────────
-- 'sin_oportunidad_de_pago': nunca se habilitó un pago (con_pago = false).
-- 'sin_pago_tras_vencer': hubo oportunidad, ya pasó vence_en y la aplicación
-- verificó en Mercado Pago que nada se puede pagar ni se pagó. La base no puede
-- mirar Mercado Pago: lo que sí impide es liberar antes de tiempo o con el turno
-- de preparación tomado por otro pedido.
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
  if p_motivo = 'sin_pago_tras_vencer'
     and (not v_r.con_pago or clock_timestamp() < v_r.vence_en or v_r.preparando_hasta > clock_timestamp()) then
    raise exception 'retencion_vigente' using errcode = '55000';
  end if;
  update public.codigo_retenciones
     set estado = 'liberado', liberado_en = clock_timestamp(), motivo_liberacion = p_motivo,
         preparando_por = null, preparando_hasta = null
   where id = p_id;
  return jsonb_build_object('resultado', 'liberada');
end;
$fn$;


-- ── 7. Registro de cada revisión (conciliación) ─────────────────────────────
-- Lo que se verificó, cuándo y con qué resultado. No cambia el estado.
create or replace function public.codigo_retencion_anotar_revision(p_id uuid, p_resultado text, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if coalesce(p_resultado, '') not in ('retenida', 'consumida', 'liberada', 'no_retenida') then
    raise exception 'resultado_invalido' using errcode = '22023';
  end if;
  update public.codigo_retenciones
     set revisiones = revisiones + 1, revisada_en = clock_timestamp(),
         revision_resultado = p_resultado, revision_motivo = left(p_motivo, 80)
   where id = p_id;
end;
$fn$;


-- ── 8. El consumo de siempre también respeta las retenciones ────────────────
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


-- ── 9. Permisos ─────────────────────────────────────────────────────────────
alter table public.codigo_retenciones enable row level security;
revoke all on table public.codigo_retenciones from public, anon, authenticated, service_role;
grant select on table public.codigo_retenciones to service_role;
alter table public.codigo_retenciones_control enable row level security;
revoke all on table public.codigo_retenciones_control from public, anon, authenticated, service_role;
grant select on table public.codigo_retenciones_control to service_role;

revoke all on function public.codigo_retenciones_pausar(boolean, text) from public, anon, authenticated, service_role;
revoke all on function public.codigo_retenciones_cubrir_legado(bigint, interval) from public, anon, authenticated, service_role;
revoke all on function public.codigo_retener(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.codigo_retencion_vincular(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.codigo_retencion_consumir(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.codigo_retencion_liberar(uuid, text) from public, anon, authenticated;
revoke all on function public.codigo_retencion_anotar_revision(uuid, text, text) from public, anon, authenticated;
revoke all on function public.consumir_codigo_descuento(text) from public, anon, authenticated;
grant execute on function public.codigo_retener(uuid, text, text, text) to service_role;
grant execute on function public.codigo_retencion_vincular(uuid, jsonb) to service_role;
grant execute on function public.codigo_retencion_consumir(uuid, text, jsonb) to service_role;
grant execute on function public.codigo_retencion_liberar(uuid, text) to service_role;
grant execute on function public.codigo_retencion_anotar_revision(uuid, text, text) to service_role;
grant execute on function public.consumir_codigo_descuento(text) to service_role;


-- ── 10. Cobertura de las compras pendientes al aplicar la migración ─────────
-- Una sola vez por compra (idempotente). Sin antigüedad mínima: al migrar no
-- hay pedidos nuevos en curso (la aplicación nueva rechaza los cupones
-- limitados mientras falte esta migración; ver docs/marketing/cupones-retencion.md).
select public.codigo_retenciones_cubrir_legado(c.id, interval '0')
  from public.codigos_descuento c
 where c.usos_maximos is not null and c.deleted_at is null;
