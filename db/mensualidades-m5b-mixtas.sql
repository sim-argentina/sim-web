-- ============================================================================
-- MENSUALIDADES SIM · BLOQUE M5B
-- Reservas mixtas: saldo + complemento pagado con Mercado Pago.
-- ----------------------------------------------------------------------------
-- Migración ADITIVA. No toca filas históricas, no cambia ningún otro origen de
-- reserva y no modifica las vistas financieras (eso es M7).
--
-- ── DECISIÓN CENTRAL: CÓMO SE CONTABILIZAN LOS MINUTOS ──────────────────────
-- El prompt ofrece dos estrategias. Se elige DESCUENTO INMEDIATO con movimiento
-- compensatorio, y además se reutiliza el movimiento 'consumo' de M5A en vez de
-- inventar un tipo 'retencion'. O sea:
--
--   · Al crear la retención se descuenta el saldo YA y se escribe UN movimiento
--     'consumo' (el mismo que haría M5A). La reserva nace 'pendiente_pago'.
--   · Aprobar el pago NO toca minutos: solo cambia estados. Por construcción es
--     imposible descontar dos veces.
--   · Liberar una retención vencida escribe UN movimiento 'devolucion' positivo.
--
-- Por qué es la opción segura:
--   · `mensualidades.saldo_minutos` sigue significando exactamente "lo que se
--     puede gastar ahora". M5A y M2 respetan las retenciones sin una sola línea
--     nueva: leen el saldo y ya está descontado.
--   · `mensualidad_mov_consumo_uq` (M2: único 'consumo' por reserva) hace que un
--     segundo consumo de la misma reserva sea imposible a nivel de base.
--   · La historia no se muta: el consumo queda, y la devolución se agrega.
--
-- ── INVARIANTE DE CARRY-OVER (renovación + retención) ───────────────────────
-- Riesgo del prompt: saldo 90, se retienen 60, el titular renueva (tope de
-- traslado 60) y después la retención se libera. Con el descuento inmediato la
-- renovación ve saldo 30 y traslada 30, que es lo correcto: los otros 60 están
-- comprometidos, no ociosos. Pero si después se liberan, devolverlos al ciclo
-- NUEVO haría que el titular termine con más de 60 minutos del ciclo viejo.
--
-- Se resuelve con dos defensas, no con la UI:
--   1) GUARD: mientras la billetera tenga una retención pendiente no se puede
--      INICIAR una compra/renovación (mensualidad_puede_comprar()). Mensaje
--      claro en la app; verificado también acá.
--   2) INVARIANTE EN LA LIBERACIÓN: la retención guarda el `vence_el` que tenía
--      la billetera. Si al liberar ese `vence_el` cambió, hubo una renovación en
--      el medio (carrera que el guard no llegó a cubrir) y los minutos NO se
--      devuelven al ciclo nuevo: se registra un 'descarte' explicando por qué y
--      el pago queda 'requiere_revision'. Nunca se pierde en silencio ni se
--      supera el tope de traslado.
--
-- ── ORDEN DE LOCKS (sigue siendo el de M2/M5A) ─────────────────────────────
--     1) advisory  'mensualidad:<telefono_norm>'
--     2) FOR UPDATE sobre mensualidades
--     3) advisory  'reserva-slot:<fecha>'   (lo toma trg_reserva_slot_bloqueo)
--   Las tres RPC nuevas toman (1) y (2) en ese orden; la de retención llega a
--   (3) al insertar los slots. Ninguna toma (3) antes que (1): no hay ciclo.
-- ============================================================================

-- ── 1) Estado de una reserva mixta ──────────────────────────────────────────
-- Se AMPLÍA reservas_mensualidad_chk (M5A) para admitir cobertura 'mixta'.
-- El brazo 'saldo' queda EXACTAMENTE como estaba: las reservas de M5A ya
-- creadas siguen validando igual.

alter table public.reservas drop constraint if exists reservas_mensualidad_chk;

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
    and (
      -- M5A: el saldo cubrió todo. Sin dinero de por medio.
      (cobertura = 'saldo' and total = 0 and importe_complementario = 0)
      or
      -- M5B: parte con saldo, parte pagada. `total` es el dinero que se cobró y
      -- coincide siempre con el complemento: la parte cubierta con minutos vale
      -- $0 y no se contabiliza como ingreso.
      (cobertura = 'mixta' and importe_complementario > 0 and total = importe_complementario)
    )
  else
    mensualidad_id is null
    and minutos_consumidos is null
    and cobertura is null
    and importe_complementario = 0
  end
);

-- ── 2) Pagos complementarios ────────────────────────────────────────────────
-- Tabla propia, no columnas nuevas en `reservas`: comprar el plan y pagar el
-- complemento de un turno son transacciones distintas, con ciclos de vida
-- distintos, y mezclarlas en mensualidad_compras obligaría a aflojar sus CHECK.
--
-- MÁQUINA DE ESTADOS (columna `estado`):
--
--   pendiente ──aprobado en MP──────────────► aprobado      (reserva 'activa')
--       │
--       ├──rechazado/cancelado en MP───────► rechazado      (sigue pagable
--       │                                     mientras no venza la retención;
--       │                                     vuelve a 'pendiente' si se paga)
--       │
--       ├──venció y no hay pago aprobado───► vencido        (slots liberados,
--       │                                     minutos devueltos 1 sola vez)
--       │
--       └──pago aprobado que no se puede
--          aplicar (slots ya vendidos, o
--          renovación en el medio)─────────► requiere_revision
--                                            (NUNCA se oculta: hay plata
--                                             cobrada sin turno confirmado)
--
-- 'requiere_revision' es terminal para el sistema y abierto para la operación.

create table if not exists public.mensualidad_reserva_pagos (
  id                     uuid primary key default gen_random_uuid(),

  -- Vínculos. La reserva es 1:1 con su intento de pago.
  reserva_id             bigint not null references public.reservas(id) on delete cascade,
  mensualidad_id         uuid   not null references public.mensualidades(id) on delete restrict,

  estado                 text   not null default 'pendiente',

  -- Desglose de minutos (todo recalculado en el servidor).
  minutos_requeridos     integer not null,
  minutos_saldo          integer not null,
  minutos_faltantes      integer not null,

  -- Desglose cobrado: el faltante se arma priorizando bloques de 30.
  bloques_30             integer not null,
  bloques_15             integer not null,

  -- SNAPSHOT de precios. Un cambio posterior de tarifas no mueve un importe ya
  -- ofrecido: lo que se cobra sale de acá, nunca del catálogo vigente.
  precio_15_snapshot     numeric not null,
  precio_30_snapshot     numeric not null,
  origen_precio          text    not null,
  importe_bruto          numeric not null,

  -- Lo que informa Mercado Pago cuando el pago existe.
  mp_comision            numeric,
  mp_neto                numeric,
  mp_status              text,
  mp_status_detail       text,
  mp_preference_id       text,
  mp_payment_id          text,
  external_reference     text   not null,

  -- Credencial de la pantalla de resultado. Se guarda HASHEADA (sha256 hex):
  -- un volcado de la tabla no permite abrir el resultado de nadie.
  token_hash             text   not null,

  -- Retención: hasta cuándo valen los slots y los minutos comprometidos.
  retencion_vence_at     timestamptz not null,
  -- `vence_el` de la billetera al momento de retener (invariante de carry-over).
  vence_el_snapshot      date   not null,

  idempotency_key        text   not null,

  aprobado_at            timestamptz,
  liberado_at            timestamptz,
  reconciliado_at        timestamptz,
  revision_motivo        text,
  created_at             timestamptz not null default now(),

  constraint mrp_estado_chk check (estado in
    ('pendiente','aprobado','rechazado','vencido','requiere_revision')),
  constraint mrp_minutos_chk check (
    minutos_requeridos > 0 and (minutos_requeridos % 15) = 0
    and minutos_saldo   > 0 and (minutos_saldo   % 15) = 0
    and minutos_faltantes > 0 and (minutos_faltantes % 15) = 0
    -- Saldo 0 NO entra por este flujo, y saldo >= requerido tampoco: eso es M5A.
    and minutos_saldo < minutos_requeridos
    and minutos_faltantes = minutos_requeridos - minutos_saldo
  ),
  constraint mrp_bloques_chk check (
    bloques_30 >= 0 and bloques_15 >= 0 and bloques_15 <= 1
    and minutos_faltantes = bloques_30 * 30 + bloques_15 * 15
  ),
  constraint mrp_precios_chk check (
    precio_15_snapshot >= 0 and precio_30_snapshot >= 0 and importe_bruto > 0
    and importe_bruto = bloques_30 * precio_30_snapshot + bloques_15 * precio_15_snapshot
  ),
  constraint mrp_origen_precio_chk check (origen_precio in ('normal_semana','normal_finde','especial')),
  constraint mrp_extref_chk check (external_reference ~ '^mensualidad_reserva_[A-Za-z0-9_-]{8,64}$'),
  constraint mrp_token_chk check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint mrp_idem_chk check (idempotency_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  constraint mrp_montos_mp_chk check (
    (mp_comision is null or mp_comision >= 0) and (mp_neto is null or mp_neto >= 0)
  ),
  -- Un pago aprobado tiene que tener con qué demostrarlo.
  constraint mrp_aprobado_chk check (
    estado <> 'aprobado' or (mp_payment_id is not null and aprobado_at is not null)
  )
);

comment on table public.mensualidad_reserva_pagos is
  'Complemento en dinero de una reserva mixta de Mensualidades (M5B). Separado de mensualidad_compras: comprar el plan y pagar un turno son transacciones distintas.';

create unique index if not exists mrp_reserva_uq   on public.mensualidad_reserva_pagos (reserva_id);
create unique index if not exists mrp_extref_uq    on public.mensualidad_reserva_pagos (external_reference);
create unique index if not exists mrp_token_uq     on public.mensualidad_reserva_pagos (token_hash);
create unique index if not exists mrp_idem_uq      on public.mensualidad_reserva_pagos (idempotency_key);
-- Un payment_id de Mercado Pago no puede acreditar dos intentos distintos.
create unique index if not exists mrp_payment_uq
  on public.mensualidad_reserva_pagos (mp_payment_id) where mp_payment_id is not null;
-- Barrido de vencidas y guard de renovación: las dos buscan por estado.
create index if not exists mrp_pendientes_idx
  on public.mensualidad_reserva_pagos (retencion_vence_at)
  where estado in ('pendiente','rechazado');
create index if not exists mrp_mens_idx
  on public.mensualidad_reserva_pagos (mensualidad_id, created_at desc);

alter table public.mensualidad_reserva_pagos enable row level security;
revoke all on public.mensualidad_reserva_pagos from public, anon, authenticated;
grant select, insert, update, delete on public.mensualidad_reserva_pagos to service_role;

-- ── 3) ¿La billetera puede iniciar una compra/renovación? ───────────────────
-- Guard del invariante de carry-over: con una retención viva no se arranca una
-- renovación. Se expone como función para que la app dé un mensaje claro y para
-- que la propia creación de la retención lo verifique.

create or replace function public.mensualidad_tiene_retencion_viva(p_mensualidad_id uuid)
returns boolean
language sql
stable
set search_path = public
as $fn$
  select exists (
    select 1 from public.mensualidad_reserva_pagos
     where mensualidad_id = p_mensualidad_id
       and estado in ('pendiente','rechazado')
       and retencion_vence_at > now()
  );
$fn$;

-- ── 4) RETENCIÓN ATÓMICA ────────────────────────────────────────────────────
-- Crea, en una sola transacción: la reserva pendiente, TODOS sus slots (para que
-- nadie más pueda venderlos), el descuento del saldo, el movimiento 'consumo' y
-- la fila de pago con el snapshot de precios.
--
-- No hay ventana entre "comprobar disponibilidad" y "bloquear slots": los slots
-- se insertan acá adentro y quien decide es reserva_slots_activa_uq.
--
-- Los precios llegan calculados por el servidor (lib/reservasPricing.ts, la
-- MISMA fuente que Reservas normales) y se revalidan: la RPC recomputa minutos,
-- bloques e importe y rechaza cualquier incoherencia.

create or replace function public.crear_retencion_reserva_mensualidad(
  p_mensualidad_id      uuid,
  p_fecha               date,
  p_hora                text,
  p_duracion            integer,
  p_simuladores         text[],
  p_slots               text[],
  p_idempotency_key     text,
  p_condiciones_version text,
  p_precio_15           numeric,
  p_precio_30           numeric,
  p_origen_precio       text,
  p_external_reference  text,
  p_token_hash          text,
  p_retencion_minutos   integer
)
returns table (
  pago_id            uuid,
  reserva_id         bigint,
  referencia_publica text,
  minutos_requeridos integer,
  minutos_saldo      integer,
  minutos_faltantes  integer,
  bloques_30         integer,
  bloques_15         integer,
  importe_bruto      numeric,
  retencion_vence_at timestamptz,
  external_reference text,
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
  v_req       integer;
  v_falt      integer;
  v_b30       integer;
  v_b15       integer;
  v_importe   numeric;
  v_saldo_fin integer;
  v_reserva   public.reservas%rowtype;
  v_pago      public.mensualidad_reserva_pagos%rowtype;
  v_ref       text;
  v_slot      text;
  v_sim       text;
  v_n_sims    integer;
  v_sims_prev text[];
  v_sims_new  text[];
  v_vence     timestamptz;
begin
  -- ── 0) Forma. Igual de estricto que M5A. ──
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,64}$' then
    raise exception 'idempotency_key_invalida' using errcode = '22023';
  end if;
  if p_duracion is null or p_duracion not in (15, 30, 45, 60) then
    raise exception 'duracion_invalida' using errcode = '22023';
  end if;
  if coalesce(btrim(p_condiciones_version), '') = '' then
    raise exception 'condiciones_requeridas' using errcode = '22023';
  end if;
  if p_origen_precio is null or p_origen_precio not in ('normal_semana','normal_finde','especial') then
    raise exception 'origen_precio_invalido' using errcode = '22023';
  end if;
  if p_precio_15 is null or p_precio_15 < 0 or p_precio_30 is null or p_precio_30 < 0 then
    raise exception 'precio_invalido' using errcode = '22023';
  end if;
  if p_external_reference is null or p_external_reference !~ '^mensualidad_reserva_[A-Za-z0-9_-]{8,64}$' then
    raise exception 'external_reference_invalida' using errcode = '22023';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'token_invalido' using errcode = '22023';
  end if;
  if p_retencion_minutos is null or p_retencion_minutos < 5 or p_retencion_minutos > 120 then
    raise exception 'retencion_invalida' using errcode = '22023';
  end if;

  v_n_sims := coalesce(array_length(p_simuladores, 1), 0);
  if v_n_sims < 1 or v_n_sims > 4 then
    raise exception 'cantidad_simuladores_invalida' using errcode = '22023';
  end if;
  if v_n_sims <> (select count(distinct s) from unnest(p_simuladores) s) then
    raise exception 'simuladores_duplicados' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_simuladores) s
             where s not in ('Ferrari','McLaren','Red Bull','Alpine')) then
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

  -- ── 1) Idempotencia antes de mutar ──
  select * into v_reserva from public.reservas
   where idempotency_key = p_idempotency_key limit 1;
  if found then
    select array_agg(x order by x) into v_sims_prev
      from jsonb_array_elements_text(v_reserva.simuladores) x;
    select array_agg(s order by s) into v_sims_new from unnest(p_simuladores) s;
    if v_reserva.mensualidad_id   is distinct from p_mensualidad_id
       or v_reserva.fecha            is distinct from p_fecha::text
       or v_reserva.hora             is distinct from p_hora
       or v_reserva.duracion_minutos is distinct from p_duracion
       or v_sims_prev                is distinct from v_sims_new then
      raise exception 'idempotency_key_con_otro_payload' using errcode = '23505';
    end if;
    -- Reintento legítimo: se devuelve el MISMO intento, con su misma preferencia
    -- y su mismo external_reference. No se crea un segundo pago.
    -- El alias es obligatorio: esta función devuelve una columna `reserva_id`, y
    -- sin calificar, PL/pgSQL no sabe si es la de salida o la de la tabla.
    select * into v_pago from public.mensualidad_reserva_pagos mrp
     where mrp.reserva_id = v_reserva.id;
    if not found then
      -- La clave existe pero pertenece a una reserva de M5A (100% saldo).
      raise exception 'idempotency_key_con_otro_payload' using errcode = '23505';
    end if;
    return query select v_pago.id, v_reserva.id, v_reserva.referencia_publica,
                        v_pago.minutos_requeridos, v_pago.minutos_saldo, v_pago.minutos_faltantes,
                        v_pago.bloques_30, v_pago.bloques_15, v_pago.importe_bruto,
                        v_pago.retencion_vence_at, v_pago.external_reference, true;
    return;
  end if;

  -- ── 2) Lock de billetera: mismo orden que M2 y M5A ──
  select telefono_norm into v_telefono from public.mensualidades where id = p_mensualidad_id;
  if v_telefono is null then
    raise exception 'mensualidad_inexistente' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('mensualidad:' || v_telefono)::bigint);

  select * into v_mens from public.mensualidades where id = p_mensualidad_id for update;
  if not found then
    raise exception 'mensualidad_inexistente' using errcode = 'P0002';
  end if;

  -- ── 3) Guard de carry-over ANTES de mirar el saldo ──
  -- Va primero a propósito: con una retención viva el saldo está en 0, así que
  -- si se chequeara después el titular recibiría "no tenés saldo" en vez de
  -- "tenés una reserva esperando el pago", que es lo que realmente pasa.
  if public.mensualidad_tiene_retencion_viva(p_mensualidad_id) then
    raise exception 'retencion_en_curso' using errcode = '22023';
  end if;

  -- ── 4) Estado y vigencia, con la fecha de Córdoba ──
  v_hoy    := public.mensualidad_hoy();
  v_estado := public.mensualidad_estado(v_mens.saldo_minutos, v_mens.vence_el, v_mens.bloqueada, v_hoy);
  if v_estado = 'bloqueada' then raise exception 'mensualidad_bloqueada' using errcode = '22023'; end if;
  if v_estado = 'vencida'   then raise exception 'mensualidad_vencida'   using errcode = '22023'; end if;
  -- Saldo 0 => estado 'agotada' => este flujo NO aplica: hay que renovar o hacer
  -- una reserva normal. Es la decisión cerrada del bloque.
  if v_estado = 'agotada'   then raise exception 'saldo_cero' using errcode = '22023'; end if;

  if p_fecha > v_mens.vence_el then
    raise exception 'turno_posterior_al_vencimiento' using errcode = '22023';
  end if;
  if p_fecha <= v_hoy then
    raise exception 'fecha_fuera_de_ventana' using errcode = '22023';
  end if;

  -- ── 5) Minutos e importe, RECALCULADOS ──
  v_req  := p_duracion * v_n_sims;
  if v_mens.saldo_minutos >= v_req then
    -- Alcanza el saldo: no corresponde cobrar nada. Lo resuelve M5A.
    raise exception 'saldo_suficiente' using errcode = '22023';
  end if;
  v_falt := v_req - v_mens.saldo_minutos;
  v_b30  := v_falt / 30;
  v_b15  := (v_falt % 30) / 15;
  v_importe := v_b30 * p_precio_30 + v_b15 * p_precio_15;
  if v_importe <= 0 then
    raise exception 'importe_invalido' using errcode = '22023';
  end if;

  v_saldo_fin := 0;               -- se usa TODO el saldo disponible
  v_vence     := now() + make_interval(mins => p_retencion_minutos);
  v_ref       := public.reserva_generar_referencia();

  -- ── 6) Reserva PENDIENTE con los datos del titular de la billetera ──
  insert into public.reservas
    (nombre, apellido, telefono, email, fecha, hora, simuladores, cantidad_turnos,
     total, total_original, descuento_aplicado, estado, acepto_condiciones,
     duracion_minutos, origen, mensualidad_id, minutos_consumidos,
     importe_complementario, cobertura, idempotency_key,
     condiciones_version, condiciones_at, referencia_publica)
  values
    (v_mens.titular_nombre, v_mens.titular_apellido, v_mens.titular_telefono,
     v_mens.titular_email, p_fecha, p_hora, to_jsonb(p_simuladores), v_n_sims,
     v_importe, v_importe, 0, 'pendiente_pago', true,
     p_duracion, 'mensualidad', v_mens.id, v_mens.saldo_minutos,
     v_importe, 'mixta', p_idempotency_key,
     btrim(p_condiciones_version), now(), v_ref)
  returning * into v_reserva;

  -- ── 7) Slots REALES ya: acá deciden reserva_slots_activa_uq y el trigger ──
  foreach v_slot in array p_slots loop
    foreach v_sim in array p_simuladores loop
      insert into public.reserva_slots (reserva_id, fecha, hora, simulador, estado)
      values (v_reserva.id, p_fecha, v_slot, v_sim, 'activa');
    end loop;
  end loop;

  -- ── 8) Se compromete TODO el saldo, con su movimiento 'consumo' ──
  -- Aprobar después no vuelve a tocar minutos: no hay forma de gastarlos dos
  -- veces. Si esto se libera, se compensa con una 'devolucion'.
  update public.mensualidades set saldo_minutos = v_saldo_fin where id = v_mens.id;

  insert into public.mensualidad_movimientos
    (mensualidad_id, reserva_id, tipo, minutos, saldo_anterior, saldo_posterior,
     motivo, actor, idempotency_key)
  values
    (v_mens.id, v_reserva.id, 'consumo', -v_mens.saldo_minutos, v_mens.saldo_minutos, v_saldo_fin,
     format('Reserva mixta %s %s - %s min x %s simulador(es); faltan %s min a pagar',
            p_fecha, p_hora, p_duracion, v_n_sims, v_falt),
     'titular', 'reserva:' || p_idempotency_key);

  -- ── 9) Intento de pago con el snapshot ──
  insert into public.mensualidad_reserva_pagos
    (reserva_id, mensualidad_id, estado, minutos_requeridos, minutos_saldo, minutos_faltantes,
     bloques_30, bloques_15, precio_15_snapshot, precio_30_snapshot, origen_precio,
     importe_bruto, external_reference, token_hash, retencion_vence_at, vence_el_snapshot,
     idempotency_key)
  values
    (v_reserva.id, v_mens.id, 'pendiente', v_req, v_mens.saldo_minutos, v_falt,
     v_b30, v_b15, p_precio_15, p_precio_30, p_origen_precio,
     v_importe, p_external_reference, p_token_hash, v_vence, v_mens.vence_el,
     p_idempotency_key)
  returning * into v_pago;

  return query select v_pago.id, v_reserva.id, v_ref, v_req, v_pago.minutos_saldo, v_falt,
                      v_b30, v_b15, v_importe, v_vence, p_external_reference, false;
end;
$fn$;

-- ── 5) CONFIRMACIÓN DEL PAGO ────────────────────────────────────────────────
-- La llama el procesador de pagos (webhook o reconciliación) DESPUÉS de haber
-- verificado contra Mercado Pago moneda, importe, referencia y estado.
-- Idempotente por p_payment_id: dos webhooks o un webhook + una reconciliación
-- simultánea confirman una sola vez.

create or replace function public.confirmar_reserva_mensualidad_pagada(
  p_external_reference text,
  p_mp_payment_id      text,
  p_importe_bruto      numeric,
  p_comision_mp        numeric     default null,
  p_importe_neto       numeric     default null,
  p_aprobado_at        timestamptz default now()
)
returns public.mensualidad_reserva_pagos
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_pago    public.mensualidad_reserva_pagos%rowtype;
  v_reserva public.reservas%rowtype;
  v_slots   integer;
begin
  if coalesce(btrim(p_external_reference), '') = '' then
    raise exception 'external_reference_requerida' using errcode = '22023';
  end if;
  if coalesce(btrim(p_mp_payment_id), '') = '' then
    raise exception 'payment_id_requerido' using errcode = '22023';
  end if;

  -- 1) Idempotencia por pago: si este payment_id ya se aplicó, devolver lo mismo.
  --    Con otra external_reference es un error de datos, no un reintento.
  select * into v_pago from public.mensualidad_reserva_pagos
   where mp_payment_id = p_mp_payment_id limit 1;
  if found then
    if v_pago.external_reference is distinct from p_external_reference then
      raise exception 'payment_id_de_otro_intento' using errcode = '23505';
    end if;
    return v_pago;
  end if;

  select * into v_pago from public.mensualidad_reserva_pagos
   where external_reference = p_external_reference for update;
  if not found then
    raise exception 'intento_inexistente' using errcode = 'P0002';
  end if;
  if v_pago.estado = 'aprobado' then
    return v_pago;  -- ya estaba, con otro payment_id ya registrado
  end if;

  -- El importe es el del SNAPSHOT y no se sobrescribe nunca: si lo que cobró
  -- Mercado Pago no coincide, no se acredita. (La capa TS ya lo verifica contra
  -- el pago real; esto es la misma defensa a nivel de base, para que la RPC sea
  -- segura aunque se la llame desde otro lado.)
  if p_importe_bruto is not null
     and abs(p_importe_bruto - v_pago.importe_bruto) > 0.01 then
    raise exception 'importe_no_coincide' using errcode = '22023';
  end if;

  select * into v_reserva from public.reservas where id = v_pago.reserva_id for update;
  if not found then
    raise exception 'reserva_inexistente' using errcode = 'P0002';
  end if;

  -- 2) PAGO TARDÍO. Dos situaciones bien distintas:
  --
  --    a) La retención NO se liberó todavía (estado 'pendiente'/'rechazado') y
  --       los slots siguen activos. No importa que retencion_vence_at ya haya
  --       pasado: el barrido no llegó, el turno sigue siendo suyo y los minutos
  --       siguen consumidos. Se confirma. Éste es el caso "aprobado antes de
  --       vencer y webhook tardío", que TIENE que confirmarse.
  --
  --    b) La retención YA se liberó ('vencido'): los slots se soltaron y los
  --       minutos se reintegraron con un movimiento 'devolucion'. Reactivar acá
  --       le daría el turno Y los minutos, y encima el turno pudo venderse a
  --       otro. Nunca se reactiva: se registra el pago —que existe y está
  --       cobrado— y queda para revisión y devolución. No se oculta jamás.
  select count(*) into v_slots from public.reserva_slots
   where reserva_id = v_reserva.id and estado = 'activa';

  if v_pago.estado = 'vencido' or v_slots = 0 then
    update public.mensualidad_reserva_pagos
       set estado = 'requiere_revision',
           mp_payment_id = p_mp_payment_id,
           mp_status = 'approved',
           mp_comision = p_comision_mp,
           mp_neto = p_importe_neto,
           aprobado_at = p_aprobado_at,
           revision_motivo = case
             when v_pago.estado = 'vencido'
               then 'pago aprobado despues de liberar la retencion: minutos ya reintegrados, corresponde devolver el dinero'
             else 'pago aprobado sin slots activos: revisar y devolver'
           end
     where id = v_pago.id
     returning * into v_pago;
    return v_pago;
  end if;

  -- 3) Aprobación normal. Los minutos NO se tocan: ya se consumieron al retener.
  update public.reservas
     set estado = 'activa',
         mercado_pago_payment_id = p_mp_payment_id
   where id = v_reserva.id;

  update public.mensualidad_reserva_pagos
     set estado = 'aprobado',
         mp_payment_id = p_mp_payment_id,
         mp_status = 'approved',
         mp_comision = p_comision_mp,
         mp_neto = p_importe_neto,
         aprobado_at = p_aprobado_at
   where id = v_pago.id
   returning * into v_pago;

  return v_pago;
end;
$fn$;

-- ── 6) LIBERACIÓN DE UNA RETENCIÓN VENCIDA ──────────────────────────────────
-- La llama el barrido. NUNCA libera por su cuenta un intento con pago aprobado:
-- quien llama tiene que haberle preguntado a Mercado Pago primero, y si MP no
-- responde no llama (mejor demorar la liberación que vender dos veces el turno).
--
-- Restaura los minutos EXACTAMENTE UNA VEZ, protegido por el estado de la fila
-- (solo 'pendiente'/'rechazado' → 'vencido', bajo FOR UPDATE).

create or replace function public.liberar_retencion_reserva_mensualidad(
  p_pago_id uuid
)
returns table (liberado boolean, minutos_devueltos integer, motivo text)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_pago      public.mensualidad_reserva_pagos%rowtype;
  v_telefono  text;
  v_mens      public.mensualidades%rowtype;
  v_saldo_fin integer;
begin
  select * into v_pago from public.mensualidad_reserva_pagos where id = p_pago_id;
  if not found then
    return query select false, 0, 'intento_inexistente'; return;
  end if;
  if v_pago.estado not in ('pendiente','rechazado') then
    -- Ya resuelto (aprobado, vencido o en revisión): nada que hacer. Que dos
    -- barridos simultáneos lleguen acá es normal y no duplica nada.
    return query select false, 0, 'estado_' || v_pago.estado; return;
  end if;
  if v_pago.retencion_vence_at > now() then
    return query select false, 0, 'todavia_vigente'; return;
  end if;

  -- Mismo orden de locks de siempre: billetera primero.
  select telefono_norm into v_telefono from public.mensualidades where id = v_pago.mensualidad_id;
  if v_telefono is null then
    return query select false, 0, 'mensualidad_inexistente'; return;
  end if;
  perform pg_advisory_xact_lock(hashtext('mensualidad:' || v_telefono)::bigint);

  -- Releer bajo lock: entre la primera lectura y el lock pudo aprobarse.
  select * into v_pago from public.mensualidad_reserva_pagos where id = p_pago_id for update;
  if v_pago.estado not in ('pendiente','rechazado') then
    return query select false, 0, 'estado_' || v_pago.estado; return;
  end if;

  select * into v_mens from public.mensualidades where id = v_pago.mensualidad_id for update;

  -- Liberar slots y marcar la reserva. 'cancelada' es el estado que ya entiende
  -- todo el sistema (índice parcial, calendario, métricas): no se inventa uno.
  update public.reserva_slots set estado = 'cancelada' where reserva_id = v_pago.reserva_id;
  update public.reservas set estado = 'cancelada' where id = v_pago.reserva_id;

  if v_mens.vence_el is distinct from v_pago.vence_el_snapshot then
    -- INVARIANTE DE CARRY-OVER: hubo una renovación entre la retención y esta
    -- liberación. Devolver los minutos al ciclo nuevo dejaría al titular con más
    -- traslado del permitido, así que NO se reintegran.
    --
    -- Acá NO se escribe ningún movimiento, y es a propósito. El libro es
    -- estricto: mensualidad_mov_saldos_chk exige saldo_posterior = saldo_anterior
    -- + minutos, y mensualidad_mov_minutos_chk prohíbe un movimiento de 0. O sea
    -- que un asiento "se descartan minutos pero el saldo no cambia" es
    -- literalmente irrepresentable — y está bien que lo sea, porque el saldo
    -- efectivamente no cambia.
    --
    -- El libro igual explica el resultado sin ambigüedad: quedó el 'consumo' de
    -- la retención y nunca hubo una 'devolucion'. Los minutos se gastaron y no
    -- volvieron, que es exactamente lo que pasó. El porqué queda en
    -- revision_motivo del intento, visible para la operación.

    update public.mensualidad_reserva_pagos
       set estado = 'requiere_revision', liberado_at = now(),
           revision_motivo = 'retencion vencida sobre un ciclo ya renovado: los minutos NO se reintegraron para no exceder el tope de traslado de 60; revisar si corresponde un ajuste manual'
     where id = v_pago.id;

    return query select true, 0, 'renovacion_intermedia'; return;
  end if;

  -- Devolución normal: exactamente los minutos comprometidos, una sola vez.
  v_saldo_fin := v_mens.saldo_minutos + v_pago.minutos_saldo;
  update public.mensualidades set saldo_minutos = v_saldo_fin where id = v_mens.id;

  insert into public.mensualidad_movimientos
    (mensualidad_id, reserva_id, tipo, minutos, saldo_anterior, saldo_posterior,
     motivo, actor, idempotency_key)
  values
    (v_mens.id, v_pago.reserva_id, 'devolucion', v_pago.minutos_saldo,
     v_mens.saldo_minutos, v_saldo_fin,
     'Reserva mixta no pagada dentro del plazo: se reintegran los minutos comprometidos',
     'sistema', 'libera:' || v_pago.idempotency_key);

  update public.mensualidad_reserva_pagos
     set estado = 'vencido', liberado_at = now()
   where id = v_pago.id;

  return query select true, v_pago.minutos_saldo, 'liberada';
end;
$fn$;

-- ── 7) Grants: nada fuera de service_role ───────────────────────────────────
revoke all on function public.crear_retencion_reserva_mensualidad(
  uuid, date, text, integer, text[], text[], text, text, numeric, numeric, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.crear_retencion_reserva_mensualidad(
  uuid, date, text, integer, text[], text[], text, text, numeric, numeric, text, text, text, integer)
  to service_role;

revoke all on function public.confirmar_reserva_mensualidad_pagada(text, text, numeric, numeric, numeric, timestamptz)
  from public, anon, authenticated;
grant execute on function public.confirmar_reserva_mensualidad_pagada(text, text, numeric, numeric, numeric, timestamptz)
  to service_role;

revoke all on function public.liberar_retencion_reserva_mensualidad(uuid) from public, anon, authenticated;
grant execute on function public.liberar_retencion_reserva_mensualidad(uuid) to service_role;

revoke all on function public.mensualidad_tiene_retencion_viva(uuid) from public, anon, authenticated;
grant execute on function public.mensualidad_tiene_retencion_viva(uuid) to service_role;

-- ── 8) FINANZAS (preparación, no integración) ───────────────────────────────
-- M7 tendrá que:
--   · sumar como "Reservas online" el importe_bruto de mensualidad_reserva_pagos
--     con estado = 'aprobado' (bruto, comisión y neto ya están en la tabla);
--   · NO sumar nada por la parte cubierta con saldo: esa ya se cobró al comprar
--     el plan y vale $0 acá;
--   · NO contar intentos 'pendiente', 'rechazado', 'vencido' ni
--     'requiere_revision';
--   · seguir excluyendo origen = 'mensualidad' de `reservas` (M5A ya lo hace en
--     fin_ingresos_por_mes y fin_serie_ingresos), para que el complemento se
--     cuente UNA sola vez y desde esta tabla, nunca desde reservas.total.
-- Mientras tanto, y como la feature está apagada, las vistas actuales no
-- cambian: reservas de origen 'mensualidad' ya están excluidas desde M5A.
