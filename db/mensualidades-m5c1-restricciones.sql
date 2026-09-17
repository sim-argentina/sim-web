-- ============================================================================
-- MENSUALIDADES SIM · BLOQUE M5C.1
-- Restricciones operativas EXCLUSIVAS de Mensualidades, también en la base.
-- ----------------------------------------------------------------------------
-- Migración ADITIVA e idempotente. No edita ninguna migración histórica y no
-- toca ninguna regla de Reservas normales: estas funciones son exclusivas del
-- producto Mensualidades.
--
-- QUÉ AGREGA
--   · Lunes a viernes. Sábado y domingo quedan fuera.
--   · De 2 a 4 simuladores. Uno solo deja de ser válido.
--   · La EXPERIENCIA tiene que terminar a las 22:00 o antes:
--         hora_inicio + duración <= 22:00
--
-- POR QUÉ TAMBIÉN ACÁ
-- La aplicación ya valida todo esto, pero la RPC es el último portón: si alguien
-- llamara a la función directamente con service_role, las reglas tienen que
-- seguir en pie. Es la misma disciplina de M5A/M5B.1/M5C.
--
-- SOBRE EL CIERRE A LAS 22:00
-- Con la grilla vigente (cadencia de 20 minutos, último inicio 21:40) este
-- chequeo no rechaza nada que la agenda ya acepte: para 60 minutos la grilla
-- corta en 20:40 —porque no entran los cuatro bloques— y 20:40 + 60 = 21:40.
-- Se deja explícito igual, para que el cierre sea una decisión verificable y no
-- una consecuencia accidental de la cadencia.
--
-- LAS RESERVAS YA EXISTENTES NO SE TOCAN. Las reglas rigen para reservas y
-- reprogramaciones NUEVAS: no se migra ni se invalida nada retroactivamente.
-- ============================================================================

-- ── Helpers compartidos por las dos RPC ─────────────────────────────────────

-- Lunes a viernes. isodow: 1 = lunes … 7 = domingo.
create or replace function public.mensualidad_dia_habilitado(p_fecha date)
returns boolean
language sql
immutable
set search_path = public
as $fn$
  select p_fecha is not null and extract(isodow from p_fecha) between 1 and 5;
$fn$;

-- La experiencia termina antes del cierre. p_hora es 'HH:MM'.
create or replace function public.mensualidad_termina_antes_del_cierre(
  p_hora text, p_duracion integer
)
returns boolean
language sql
immutable
set search_path = public
as $fn$
  select p_hora ~ '^\d{2}:\d{2}$'
     and p_duracion is not null
     and p_duracion > 0
     and (split_part(p_hora, ':', 1)::int * 60
          + split_part(p_hora, ':', 2)::int
          + p_duracion) <= 22 * 60;
$fn$;

revoke all on function public.mensualidad_dia_habilitado(date) from public, anon, authenticated;
revoke all on function public.mensualidad_termina_antes_del_cierre(text, integer) from public, anon, authenticated;
grant execute on function public.mensualidad_dia_habilitado(date) to service_role;
grant execute on function public.mensualidad_termina_antes_del_cierre(text, integer) to service_role;

-- ── 1) CREAR: se agregan las tres reglas ────────────────────────────────────
-- El resto de crear_reserva_mensualidad queda EXACTAMENTE como en M5A: mismos
-- locks, misma idempotencia, mismo consumo, mismo movimiento.

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
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,64}$' then
    raise exception 'idempotency_key_invalida' using errcode = '22023';
  end if;
  if p_duracion is null or p_duracion not in (15, 30, 45, 60) then
    raise exception 'duracion_invalida' using errcode = '22023';
  end if;
  if coalesce(btrim(p_condiciones_version), '') = '' then
    raise exception 'condiciones_requeridas' using errcode = '22023';
  end if;

  -- (M5C.1) Lunes a viernes.
  if not public.mensualidad_dia_habilitado(p_fecha) then
    raise exception 'dia_no_habilitado' using errcode = '22023';
  end if;
  -- (M5C.1) La experiencia termina 22:00 o antes.
  if not public.mensualidad_termina_antes_del_cierre(p_hora, p_duracion) then
    raise exception 'fuera_de_horario' using errcode = '22023';
  end if;

  v_n_sims := coalesce(array_length(p_simuladores, 1), 0);
  -- (M5C.1) De 2 a 4 simuladores: uno solo ya no es válido.
  if v_n_sims < 2 or v_n_sims > 4 then
    raise exception 'cantidad_simuladores_invalida' using errcode = '22023';
  end if;
  if v_n_sims <> (select count(distinct s) from unnest(p_simuladores) s) then
    raise exception 'simuladores_duplicados' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_simuladores) s
    where s not in ('Ferrari', 'McLaren', 'Red Bull', 'Alpine')
  ) then
    raise exception 'simulador_desconocido' using errcode = '22023';
  end if;

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

  select * into v_reserva from public.reservas r
   where r.idempotency_key = p_idempotency_key limit 1;
  if found then
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

  select m.telefono_norm into v_telefono
    from public.mensualidades m where m.id = p_mensualidad_id;
  if v_telefono is null then
    raise exception 'mensualidad_inexistente' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('mensualidad:' || v_telefono)::bigint);

  select * into v_mens from public.mensualidades m
   where m.id = p_mensualidad_id for update;
  if not found then
    raise exception 'mensualidad_inexistente' using errcode = 'P0002';
  end if;

  v_hoy    := public.mensualidad_hoy();
  v_estado := public.mensualidad_estado(v_mens.saldo_minutos, v_mens.vence_el, v_mens.bloqueada, v_hoy);
  if v_estado = 'bloqueada' then raise exception 'mensualidad_bloqueada' using errcode = '22023'; end if;
  if v_estado = 'vencida'   then raise exception 'mensualidad_vencida'   using errcode = '22023'; end if;
  if v_estado = 'agotada'   then raise exception 'mensualidad_agotada'   using errcode = '22023'; end if;

  if p_fecha > v_mens.vence_el then
    raise exception 'turno_posterior_al_vencimiento' using errcode = '22023';
  end if;
  if p_fecha <= v_hoy then
    raise exception 'fecha_fuera_de_ventana' using errcode = '22023';
  end if;

  v_minutos := p_duracion * v_n_sims;
  if v_minutos > v_mens.saldo_minutos then
    raise exception 'saldo_insuficiente' using errcode = '22023';
  end if;
  v_saldo_fin := v_mens.saldo_minutos - v_minutos;

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

  foreach v_slot in array p_slots loop
    foreach v_sim in array p_simuladores loop
      insert into public.reserva_slots (reserva_id, fecha, hora, simulador, estado)
      values (v_reserva.id, p_fecha, v_slot, v_sim, 'activa');
    end loop;
  end loop;

  update public.mensualidades set saldo_minutos = v_saldo_fin where id = v_mens.id;

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

-- ── 2) REPROGRAMAR: las mismas tres reglas sobre el turno NUEVO ─────────────
-- Todo lo demás de M5C queda igual: plazo de 24 h sobre el turno ORIGINAL,
-- misma duración, mismos simuladores, mismo consumo, saldo sin movimientos, y
-- la reserva original intacta si el horario nuevo falla.

create or replace function public.reprogramar_reserva_mensualidad(
  p_mensualidad_id  uuid,
  p_referencia      text,
  p_fecha           date,
  p_hora            text,
  p_slots           text[],
  p_idempotency_key text
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

  v_hoy := public.mensualidad_hoy();
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

-- Los grants no cambian: siguen siendo exclusivos de service_role.
revoke all on function public.crear_reserva_mensualidad(uuid, date, text, integer, text[], text[], text, text)
  from public, anon, authenticated;
grant execute on function public.crear_reserva_mensualidad(uuid, date, text, integer, text[], text[], text, text)
  to service_role;
revoke all on function public.reprogramar_reserva_mensualidad(uuid, text, date, text, text[], text)
  from public, anon, authenticated;
grant execute on function public.reprogramar_reserva_mensualidad(uuid, text, date, text, text[], text)
  to service_role;
