-- ============================================================================
-- MENSUALIDADES SIM · BLOQUE M5A
-- Reserva cubierta completamente con saldo.
-- ----------------------------------------------------------------------------
-- Migración ADITIVA. No modifica ni una fila histórica, no toca ningún otro
-- origen de reserva y no cambia ninguna vista financiera existente salvo para
-- EXCLUIR el origen nuevo (ver punto 6), que de otro modo se contaría como una
-- reserva online paga.
--
-- QUÉ ENCONTRÓ LA AUDITORÍA (y por eso no está acá):
--   · `reservas` NO tiene ningún CHECK sobre duracion_minutos, estado ni origen.
--     No hay nada que "ampliar" para 45/60: la restricción a 15/30 vive solo en
--     la aplicación (DURACIONES_POR_PRODUCTO de lib/agenda.ts, M6). Por eso el
--     CHECK que se agrega acá es NUEVO y está condicionado a origen
--     'mensualidad': los orígenes 'web' y 'empresa' quedan exactamente como hoy.
--   · `mensualidad_movimientos` YA tiene reserva_id, el índice único
--     mensualidad_mov_consumo_uq (un solo 'consumo' por reserva) y
--     mensualidad_mov_idem_uq. M2 dejó el lado del movimiento listo.
--   · `reserva_slots_activa_uq` y trg_reserva_slot_bloqueo ya garantizan
--     no-solapamiento y respeto de bloqueos. M5A los reutiliza tal cual.
--   · `reservas` no tenía ningún concepto de referencia pública: se crea.
--
-- ORDEN DE LOCKS (global del sistema, para que no haya deadlocks):
--     1) advisory  'mensualidad:<telefono_norm>'   <- M2 (compra) y M5A (consumo)
--     2) FOR UPDATE sobre mensualidades            <- M2 y M5A
--     3) advisory  'reserva-slot:<fecha>'          <- trg_reserva_slot_bloqueo
--                                                     y crear_bloqueo_reserva
--   M2 toma (1)+(2) y nunca (3). crear_bloqueo_reserva toma solo (3).
--   M5A toma (1)+(2) y después (3) al insertar los slots. Como nadie toma (3)
--   antes que (1), no hay ciclo posible.
-- ============================================================================

-- ── 1) Columnas nuevas en reservas ──────────────────────────────────────────
-- Todas anulables (salvo importe_complementario, que tiene default) para no
-- tocar las filas existentes de 'web' y 'empresa'.

alter table public.reservas
  add column if not exists mensualidad_id         uuid,
  add column if not exists minutos_consumidos     integer,
  add column if not exists importe_complementario numeric not null default 0,
  add column if not exists cobertura              text,
  add column if not exists idempotency_key        text,
  add column if not exists condiciones_version    text,
  add column if not exists condiciones_at         timestamptz,
  add column if not exists referencia_publica     text;

comment on column public.reservas.mensualidad_id is
  'Billetera que pagó la reserva. Solo para origen = mensualidad (M5A).';
comment on column public.reservas.minutos_consumidos is
  'Minutos descontados del saldo = duracion_minutos x cantidad de simuladores.';
comment on column public.reservas.importe_complementario is
  'Diferencia abonada en dinero. Siempre 0 en M5A; M5B lo usara para pagos mixtos.';
comment on column public.reservas.cobertura is
  'Como se cubrio: saldo (M5A). M5B agregara mixta.';
comment on column public.reservas.referencia_publica is
  'Referencia que se le muestra al cliente. No es una credencial: no autentica nada.';

-- FK con RESTRICT a propósito: una billetera con reservas hechas no se borra en
-- silencio. Un SET NULL dejaría la reserva violando reservas_mensualidad_chk.
do $mig$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reservas_mensualidad_id_fkey' and conrelid = 'public.reservas'::regclass
  ) then
    alter table public.reservas
      add constraint reservas_mensualidad_id_fkey
      foreign key (mensualidad_id) references public.mensualidades(id) on delete restrict;
  end if;
end $mig$;

-- ── 2) Invariantes de una reserva de mensualidad ────────────────────────────
-- El CHECK es una implicación: si el origen NO es 'mensualidad', no exige nada
-- sobre la reserva en sí, así que ninguna fila existente ni futura de otro
-- origen se ve afectada. Al revés también: los campos nuevos no se pueden usar
-- desde otro origen.

do $mig$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reservas_mensualidad_chk' and conrelid = 'public.reservas'::regclass
  ) then
    alter table public.reservas add constraint reservas_mensualidad_chk check (
      case when origen = 'mensualidad' then
        mensualidad_id is not null
        and duracion_minutos in (15, 30, 45, 60)
        and minutos_consumidos is not null
        and minutos_consumidos > 0
        and (minutos_consumidos % 15) = 0
        and condiciones_version is not null
        and condiciones_at is not null
        and referencia_publica is not null
        -- M5A solo conoce la cobertura total con saldo. M5B ampliará este
        -- brazo con 'mixta' e importe_complementario > 0.
        and cobertura = 'saldo'
        and total = 0
        and importe_complementario = 0
      else
        -- Los campos de mensualidad no se cuelan en web, empresa ni nada nuevo.
        mensualidad_id is null
        and minutos_consumidos is null
        and cobertura is null
        and importe_complementario = 0
      end
    );
  end if;
end $mig$;

-- ── 3) Índices ──────────────────────────────────────────────────────────────

-- Historial de "Mi mensualidad": próximas y anteriores de UNA billetera.
create index if not exists reservas_mensualidad_idx
  on public.reservas (mensualidad_id, fecha, hora)
  where mensualidad_id is not null;

-- Idempotencia del intento de reserva. Parcial: no molesta a los otros orígenes,
-- que no usan la columna.
create unique index if not exists reservas_idem_uq
  on public.reservas (idempotency_key)
  where idempotency_key is not null;

create unique index if not exists reservas_referencia_uq
  on public.reservas (referencia_publica)
  where referencia_publica is not null;

-- ── 4) Referencia pública de reserva ────────────────────────────────────────
-- Mismo estilo y alfabeto sin ambiguos (sin 0/O/1/I) que el código de
-- mensualidad, para que un cliente pueda dictarla por teléfono sin errores.

create or replace function public.reserva_generar_referencia()
returns text
language plpgsql volatile
set search_path = public
as $fn$
declare
  v_alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_ref   text;
  i       integer;
begin
  for _intento in 1..20 loop
    v_ref   := '';
    v_bytes := extensions.gen_random_bytes(8);
    for i in 0..7 loop
      v_ref := v_ref || substr(v_alfabeto, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    v_ref := 'RES-' || substr(v_ref, 1, 4) || '-' || substr(v_ref, 5, 4);
    if not exists (select 1 from public.reservas where referencia_publica = v_ref) then
      return v_ref;
    end if;
  end loop;
  raise exception 'no_se_pudo_generar_referencia' using errcode = '55000';
end;
$fn$;

do $mig$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reservas_referencia_chk' and conrelid = 'public.reservas'::regclass
  ) then
    alter table public.reservas add constraint reservas_referencia_chk check (
      referencia_publica is null
      or referencia_publica ~ '^RES-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$'
    );
  end if;
end $mig$;

-- ── 5) Operación atómica: reservar consumiendo saldo ────────────────────────
-- La llama el endpoint con service_role, con datos YA identificados por el
-- backend. NO recibe nombre, teléfono, email, saldo, precio, minutos calculados
-- por el cliente ni estado de la mensualidad: todo eso lo resuelve acá adentro.
--
-- p_slots son los bloques de agenda que calculó lib/agenda.ts (fuente única de
-- M6). No se recalculan en SQL para no tener una segunda definición del
-- calendario; lo que sí se verifica es que la CANTIDAD de bloques coincida con
-- la duración, que empiecen en p_hora, que estén ordenados y que no se repitan.

create or replace function public.crear_reserva_mensualidad(
  p_mensualidad_id       uuid,
  p_fecha                date,
  p_hora                 text,
  p_duracion             integer,
  p_simuladores          text[],
  p_slots                text[],
  p_idempotency_key      text,
  p_condiciones_version  text
)
returns table (
  reserva_id         bigint,
  referencia_publica text,
  minutos_consumidos integer,
  saldo_anterior     integer,
  saldo_posterior    integer,
  idempotente        boolean
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_telefono  text;
  v_mens      public.mensualidades%rowtype;
  v_hoy       date;
  v_estado    text;
  v_minutos   integer;
  v_saldo_fin integer;
  v_reserva   public.reservas%rowtype;
  v_ref       text;
  v_slot      text;
  v_sim       text;
  v_n_sims    integer;
  v_sims_prev text[];
  v_sims_new  text[];
begin
  -- ── 0) Validación de forma (barata, antes de cualquier lock) ──
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,64}$' then
    raise exception 'idempotency_key_invalida' using errcode = '22023';
  end if;
  if p_duracion is null or p_duracion not in (15, 30, 45, 60) then
    raise exception 'duracion_invalida' using errcode = '22023';
  end if;
  if coalesce(btrim(p_condiciones_version), '') = '' then
    raise exception 'condiciones_requeridas' using errcode = '22023';
  end if;

  v_n_sims := coalesce(array_length(p_simuladores, 1), 0);
  if v_n_sims < 1 or v_n_sims > 4 then
    raise exception 'cantidad_simuladores_invalida' using errcode = '22023';
  end if;
  -- Sin repetidos: dos veces Ferrari descontaría el doble por un solo asiento.
  if v_n_sims <> (select count(distinct s) from unnest(p_simuladores) s) then
    raise exception 'simuladores_duplicados' using errcode = '22023';
  end if;
  -- Solo escuderías reconocidas. La lista vive también en la app; acá está para
  -- que la RPC no dependa de que el que llama haya validado.
  if exists (
    select 1 from unnest(p_simuladores) s
    where s not in ('Ferrari', 'McLaren', 'Red Bull', 'Alpine')
  ) then
    raise exception 'simulador_desconocido' using errcode = '22023';
  end if;

  -- Los bloques tienen que ser exactamente los que pide la duración, empezar en
  -- p_hora, no repetirse y venir ordenados. No se reconstruye la agenda acá: se
  -- comprueba que lo que mandó el servidor sea coherente.
  if coalesce(array_length(p_slots, 1), 0) <> (p_duracion / 15) then
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

  -- ── 1) Idempotencia ANTES de mutar nada ──
  select * into v_reserva
    from public.reservas
   where idempotency_key = p_idempotency_key
   limit 1;
  if found then
    -- La misma clave con OTRA selección es un error del cliente, no un reintento:
    -- devolver la reserva vieja haría creer que se guardó la nueva.
    select array_agg(x order by x) into v_sims_prev
      from jsonb_array_elements_text(v_reserva.simuladores) x;
    select array_agg(s order by s) into v_sims_new from unnest(p_simuladores) s;
    if v_reserva.mensualidad_id   is distinct from p_mensualidad_id
       or v_reserva.fecha            is distinct from p_fecha::text
       or v_reserva.hora             is distinct from p_hora
       or v_reserva.duracion_minutos is distinct from p_duracion
       or v_sims_prev                is distinct from v_sims_new
    then
      raise exception 'idempotency_key_con_otro_payload' using errcode = '23505';
    end if;
    return query
      select v_reserva.id, v_reserva.referencia_publica, v_reserva.minutos_consumidos,
             mv.saldo_anterior, mv.saldo_posterior, true
        from public.mensualidad_movimientos mv
       where mv.reserva_id = v_reserva.id and mv.tipo = 'consumo'
       limit 1;
    return;
  end if;

  -- ── 2) Lock de la billetera (pasos 1 y 2 del orden global de arriba) ──
  -- El advisory usa la MISMA clave que mensualidad_aplicar_compra, así que una
  -- renovación concurrente y este consumo se serializan entre sí: ninguno de los
  -- dos puede leer un saldo viejo y pisar al otro.
  select telefono_norm into v_telefono
    from public.mensualidades where id = p_mensualidad_id;
  if v_telefono is null then
    raise exception 'mensualidad_inexistente' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('mensualidad:' || v_telefono)::bigint);

  select * into v_mens
    from public.mensualidades where id = p_mensualidad_id for update;
  if not found then
    raise exception 'mensualidad_inexistente' using errcode = 'P0002';
  end if;

  -- ── 3) Estado recalculado con la fecha de Córdoba, nunca con la del cliente ──
  v_hoy    := public.mensualidad_hoy();
  v_estado := public.mensualidad_estado(v_mens.saldo_minutos, v_mens.vence_el, v_mens.bloqueada, v_hoy);
  if v_estado = 'bloqueada' then raise exception 'mensualidad_bloqueada' using errcode = '22023'; end if;
  if v_estado = 'vencida'   then raise exception 'mensualidad_vencida'   using errcode = '22023'; end if;
  if v_estado = 'agotada'   then raise exception 'mensualidad_agotada'   using errcode = '22023'; end if;

  -- La experiencia tiene que caer dentro de la vigencia. Si vence ESE día, el
  -- turno vale todo el día: por eso es > y no >=.
  if p_fecha > v_mens.vence_el then
    raise exception 'turno_posterior_al_vencimiento' using errcode = '22023';
  end if;
  -- Nunca hoy ni el pasado: la ventana pública empieza mañana (M6).
  if p_fecha <= v_hoy then
    raise exception 'fecha_fuera_de_ventana' using errcode = '22023';
  end if;

  -- ── 4) Consumo recalculado en el servidor ──
  v_minutos := p_duracion * v_n_sims;
  if v_minutos > v_mens.saldo_minutos then
    raise exception 'saldo_insuficiente' using errcode = '22023';
  end if;
  v_saldo_fin := v_mens.saldo_minutos - v_minutos;

  -- ── 5) Reserva con los datos del titular que YA están en la billetera ──
  v_ref := public.reserva_generar_referencia();

  insert into public.reservas
    (nombre, apellido, telefono, email, fecha, hora, simuladores, cantidad_turnos,
     total, total_original, descuento_aplicado, estado, acepto_condiciones,
     duracion_minutos, origen, mensualidad_id, minutos_consumidos,
     importe_complementario, cobertura, idempotency_key,
     condiciones_version, condiciones_at, referencia_publica)
  values
    (v_mens.titular_nombre, v_mens.titular_apellido, v_mens.titular_telefono,
     v_mens.titular_email, p_fecha, p_hora, to_jsonb(p_simuladores), v_n_sims,
     0, 0, 0, 'activa', true,
     p_duracion, 'mensualidad', v_mens.id, v_minutos,
     0, 'saldo', p_idempotency_key,
     btrim(p_condiciones_version), now(), v_ref)
  returning * into v_reserva;

  -- ── 6) Slots: acá actúan reserva_slots_activa_uq y trg_reserva_slot_bloqueo ──
  foreach v_slot in array p_slots loop
    foreach v_sim in array p_simuladores loop
      insert into public.reserva_slots (reserva_id, fecha, hora, simulador, estado)
      values (v_reserva.id, p_fecha, v_slot, v_sim, 'activa');
    end loop;
  end loop;

  -- ── 7) Descuento + movimiento. Un solo 'consumo' por reserva lo garantiza
  --       mensualidad_mov_consumo_uq, que ya existía desde M2. ──
  update public.mensualidades
     set saldo_minutos = v_saldo_fin
   where id = v_mens.id;

  insert into public.mensualidad_movimientos
    (mensualidad_id, reserva_id, tipo, minutos, saldo_anterior, saldo_posterior,
     motivo, actor, idempotency_key)
  values
    (v_mens.id, v_reserva.id, 'consumo', -v_minutos, v_mens.saldo_minutos, v_saldo_fin,
     format('Reserva %s %s - %s min x %s simulador(es)', p_fecha, p_hora, p_duracion, v_n_sims),
     'titular', 'reserva:' || p_idempotency_key);

  return query select v_reserva.id, v_ref, v_minutos, v_mens.saldo_minutos, v_saldo_fin, false;
end;
$fn$;

revoke all on function public.crear_reserva_mensualidad(uuid, date, text, integer, text[], text[], text, text)
  from public, anon, authenticated;
grant execute on function public.crear_reserva_mensualidad(uuid, date, text, integer, text[], text[], text, text)
  to service_role;

revoke all on function public.reserva_generar_referencia() from public, anon, authenticated;
grant execute on function public.reserva_generar_referencia() to service_role;

-- ── 6) Finanzas: que el origen nuevo no se cuente como reserva online paga ──
-- No se cambia ninguna vista ni ningún cálculo existente: se agrega el mismo
-- tipo de exclusión que 'empresa' ya tenía, para el origen nuevo. El monto de
-- una reserva de mensualidad es 0, así que la plata no se movía igual; lo que se
-- evita es que la CANTIDAD de reservas online la incluya.
-- La integración real (ingreso diferido, ocupación, minutos) es M7.

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
  group by 2;
$fn$;

-- fin_serie_ingresos no filtraba por origen en absoluto (ya incluía 'empresa',
-- comportamiento preexistente que NO se toca en este bloque). Se excluye
-- únicamente el origen nuevo, para no inventar reservas online que no existen.
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
  group by 1;
$fn$;

-- ── 7) RLS ──────────────────────────────────────────────────────────────────
-- reservas y reserva_slots ya están en deny-by-default (RLS activo, 0 políticas,
-- grants solo a service_role). Las columnas nuevas no abren nada: quedan bajo la
-- misma política. No se agrega ni se afloja ningún grant.
