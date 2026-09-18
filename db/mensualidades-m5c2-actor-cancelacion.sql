-- ════════════════════════════════════════════════════════════════════════════
-- Mensualidades SIM · M5C.2 — el libro mayor dice quién canceló de verdad
-- ════════════════════════════════════════════════════════════════════════════
--
-- Lo detectó la validación visual de M7: cuando un administrador cancelaba una
-- reserva desde el panel, la auditoría registraba 'admin' correctamente, pero el
-- movimiento de devolución quedaba atribuido a 'titular' porque el actor estaba
-- escrito a mano en el INSERT.
--
-- Esta migración es ADITIVA: no edita M5C, copia su función y le agrega un
-- parámetro FINAL con default 'titular'. Cualquier llamador que no lo pase se
-- comporta exactamente como antes.
--
-- El actor NUNCA llega del navegador. Lo fija el servidor según la puerta:
--   · /api/mensualidades/reservas/cancelar   (sesión de M4)  → 'titular'
--   · /api/admin/mensualidades/[id]/acciones (requireAdmin)  → 'admin'
-- staff no puede cancelar, así que no puede generar ningún movimiento.
--
-- NADA MÁS cambia: ni el plazo de 24 h, ni la restitución, ni los slots, ni el
-- bloqueo, ni la auditoría, ni la idempotencia. La clave del movimiento sigue
-- siendo 'cancel:<reserva_id>', única en toda la tabla, así que una cancelación
-- repetida o dos concurrentes siguen dejando UN solo movimiento.
--
-- Se hace DROP + CREATE en vez de CREATE OR REPLACE porque agregar un parámetro
-- crearía una SOBRECARGA, no un reemplazo, y quedarían dos versiones ambiguas.

drop function if exists public.cancelar_reserva_mensualidad(uuid, text, text);

create or replace function public.cancelar_reserva_mensualidad(
  p_mensualidad_id  uuid,
  p_referencia      text,
  p_idempotency_key text,
  -- (M5C.2) Quién originó la cancelación. Va al final y con default para que el
  -- llamador público de M5C siga funcionando sin tocarlo. NUNCA llega del
  -- navegador: lo fija el servidor según por qué puerta entró la solicitud.
  p_actor text default 'titular'
)
returns table (
  reserva_id          bigint,
  referencia_publica  text,
  estado              text,
  restituyo           boolean,
  minutos_restituidos integer,
  saldo_anterior      integer,
  saldo_posterior     integer,
  idempotente         boolean
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_telefono  text;
  v_mens      public.mensualidades%rowtype;
  v_reserva   public.reservas%rowtype;
  v_inicio    timestamptz;
  v_restituye boolean;
  v_minutos   integer;
  v_saldo_fin integer;
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,64}$' then
    raise exception 'idempotency_key_invalida' using errcode = '22023';
  end if;
  if p_referencia is null or p_referencia !~ '^RES-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$' then
    raise exception 'reserva_inexistente' using errcode = 'P0002';
  end if;
  -- (M5C.2) Lista cerrada: solo el titular o la administración cancelan. Staff
  -- no puede, y no existe ningún otro valor que pueda escribirse en el libro.
  if p_actor is null or p_actor not in ('titular', 'admin') then
    raise exception 'actor_invalido' using errcode = '22023';
  end if;

  -- Orden de locks: billetera primero, siempre.
  select m.telefono_norm into v_telefono
    from public.mensualidades m where m.id = p_mensualidad_id;
  if v_telefono is null then
    raise exception 'mensualidad_inexistente' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('mensualidad:' || v_telefono)::bigint);

  select * into v_mens from public.mensualidades m
   where m.id = p_mensualidad_id for update;

  -- PERTENENCIA: la reserva tiene que ser de ESTA billetera y de Mensualidades.
  -- Si no, para quien llama es indistinguible de una referencia inexistente.
  select * into v_reserva from public.reservas r
   where r.referencia_publica = p_referencia
     and r.mensualidad_id = p_mensualidad_id
     and r.origen = 'mensualidad'
   for update;
  if not found then
    raise exception 'reserva_inexistente' using errcode = 'P0002';
  end if;

  -- Reintento sobre una reserva YA cancelada: se devuelve lo que pasó la vez
  -- anterior. No se escribe nada, no se devuelve saldo otra vez.
  if v_reserva.estado = 'cancelada' then
    return query
      select v_reserva.id, v_reserva.referencia_publica, v_reserva.estado,
             (v_reserva.cancelacion_resultado = 'restituida'),
             case when v_reserva.cancelacion_resultado = 'restituida'
                  then v_reserva.minutos_consumidos else 0 end,
             v_mens.saldo_minutos, v_mens.saldo_minutos, true;
    return;
  end if;

  -- Solo una reserva viva se puede cancelar. 'reembolsada', 'conflicto_pago' y
  -- cualquier estado futuro quedan fuera por no estar en la lista.
  if v_reserva.estado <> 'activa' then
    raise exception 'estado_no_cancelable' using errcode = '22023';
  end if;
  if coalesce(v_reserva.no_show, false) then
    raise exception 'estado_no_cancelable' using errcode = '22023';
  end if;

  -- Instante real de inicio en Córdoba.
  v_inicio := (v_reserva.fecha || ' ' || v_reserva.hora)::timestamp
              at time zone 'America/Argentina/Cordoba';
  if v_inicio <= now() then
    raise exception 'reserva_ya_iniciada' using errcode = '22023';
  end if;

  -- El corte es inclusivo: faltando exactamente 24 h todavía se restituye.
  v_restituye := (v_inicio - now()) >= interval '24 hours';
  v_minutos   := coalesce(v_reserva.minutos_consumidos, 0);

  update public.reservas
     set estado = 'cancelada',
         cancelada_at = now(),
         cancelacion_resultado = case when v_restituye then 'restituida' else 'sin_restitucion' end
   where id = v_reserva.id;

  -- Liberar TODOS los slots: al dejar de estar 'activa' salen del índice único
  -- parcial y el turno queda disponible para cualquiera.
  update public.reserva_slots rs
     set estado = 'cancelada'
   where rs.reserva_id = v_reserva.id and rs.estado = 'activa';

  if not v_restituye or v_minutos <= 0 then
    return query
      select v_reserva.id, v_reserva.referencia_publica, 'cancelada'::text,
             false, 0, v_mens.saldo_minutos, v_mens.saldo_minutos, false;
    return;
  end if;

  v_saldo_fin := v_mens.saldo_minutos + v_minutos;
  update public.mensualidades set saldo_minutos = v_saldo_fin where id = v_mens.id;

  -- UN solo movimiento, garantizado por mensualidad_mov_idem_uq: la clave
  -- 'cancel:<reserva_id>' es única en toda la tabla.
  insert into public.mensualidad_movimientos
    (mensualidad_id, reserva_id, tipo, minutos, saldo_anterior, saldo_posterior,
     motivo, actor, idempotency_key)
  values
    (v_mens.id, v_reserva.id, 'devolucion', v_minutos, v_mens.saldo_minutos, v_saldo_fin,
     format('Cancelacion con 24 h o mas de anticipacion de la reserva %s (%s %s)',
            v_reserva.referencia_publica, v_reserva.fecha, v_reserva.hora),
     p_actor, 'cancel:' || v_reserva.id);

  return query
    select v_reserva.id, v_reserva.referencia_publica, 'cancelada'::text,
           true, v_minutos, v_mens.saldo_minutos, v_saldo_fin, false;
end;
$fn$;

-- Permisos: exactamente los mismos que tenía, sobre la firma nueva.
revoke all on function public.cancelar_reserva_mensualidad(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.cancelar_reserva_mensualidad(uuid, text, text, text)
  to service_role;
