-- ============================================================================
-- Marketing · Campañas de recuperación del stand — SIMULACIÓN persistente.
-- ----------------------------------------------------------------------------
-- Configurar → calcular audiencia → preparar beneficios FICTICIOS → ejecutar por
-- lotes con el proveedor FALSO → consultar resultados. Esta etapa no envía
-- WhatsApp, no crea códigos de descuento y no toca Reservas, Gift Cards,
-- Códigos (salvo reservar el prefijo SIMU-, ver 6) ni Finanzas.
--
-- Piezas:
--   · mkt_campanias               configuración, estado y resumen del cálculo de
--                                 audiencia (sin teléfonos). modo = 'simulacion'
--                                 es el ÚNICO valor admitido: no existe un modo real.
--   · mkt_campania_destinatarios  la cola persistente: un destinatario por teléfono
--                                 canónico y campaña, con su beneficio ficticio
--                                 ESTABLE (SIMU-XXXXXXXX), su estado de envío y el
--                                 turno del ejecutor que lo tiene tomado.
--   · mkt_campania_eventos        historial SOLO DE ALTA (acciones y lotes).
--   · mkt_campania_atribucion     vista campaña → destinatario → cupón → compra
--                                 y regreso al stand (para la futura atribución).
--
-- Ciclo de la campaña:
--   borrador → preparada → ejecutando ⇄ pausada → completada
--                     └──────┴──────────┴→ cancelada (los pendientes pasan a
--                                          'cancelado'; nada se borra)
-- Ciclo de un destinatario:
--   pendiente → enviando (tomado por un ejecutor, con vencimiento) →
--     aceptado (el proveedor lo recibió) → entregado | no_entregado
--     fallido   error definitivo o reintentos agotados (máx. 3 intentos)
--     pendiente error transitorio: vuelve con proximo_intento_en
--     incierto  no se sabe si salió (sin respuesta, o el ejecutor se cortó con
--               el turno tomado). NO se reintenta solo: la Cloud API no tiene
--               clave de idempotencia y reenviar podría duplicar. Lo decide un
--               admin (reintentar o dar por fallido). Si fue por un turno
--               vencido, la respuesta tardía del ejecutor que lo tomó lo resuelve.
--   excluido  al tomarlo para enviar: baja posterior, sin consentimiento vigente
--             o sin cupo de límite/presupuesto. cancelado: campaña cancelada.
--
-- Garantías:
--   · Un destinatario por teléfono y campaña (unique) y, al preparar, ninguno
--     que ya esté en curso en otra campaña (preparaciones serializadas).
--   · Beneficio ficticio único y estable: se genera UNA vez al preparar y no
--     existe en codigos_descuento (no se puede canjear en ninguna base).
--   · Doble clic y procesos concurrentes: versión optimista para editar y
--     preparar, clave de creación, transiciones idempotentes y toma de lotes
--     con la fila de la campaña bloqueada + SKIP LOCKED: cada destinatario lo
--     toma un solo ejecutor por vez.
--   · Reinicios: todo el progreso está en la base; un turno vencido pasa a
--     'incierto' (no se reenvía a ciegas) y el resto sigue en el próximo lote.
--   · Topes: al preparar, cantidad ≤ límite y cantidad × tarifa ≤ presupuesto;
--     al tomar cada lote se vuelven a aplicar sobre lo ya comprometido.
--   · Consentimiento y bajas: se revisan al preparar y otra vez al tomar cada
--     destinatario para enviar (mkt_consentimiento_estado).
--
-- Permisos: RLS sin policies; anon y authenticated nada; service_role SOLO lee
-- tablas y vistas. Toda escritura pasa por las RPCs SECURITY DEFINER; la
-- aplicación además solo las llama contra una base LOCAL de pruebas
-- (lib/marketing/campanias.ts, evaluarEntornoCampanias).
-- Va en db/orden.txt DESPUÉS de marketing-consentimiento.sql y de
-- cupones-retencion.sql. Necesita mensualidad_normalizar_telefono.
--
-- Aditivo e idempotente. Verificación sin huella:
-- db/marketing-campanias.verificacion.sql (solo stack local).
-- Los cuerpos de las funciones NO llevan comentarios: las explicaciones van arriba.
-- ============================================================================


-- ── 1. Campañas ─────────────────────────────────────────────────────────────
create table if not exists public.mkt_campanias (
  id                      uuid primary key default gen_random_uuid(),
  clave_creacion          uuid not null,
  modo                    text not null default 'simulacion',
  estado                  text not null default 'borrador',
  version                 integer not null default 1,
  nombre                  text not null,
  objetivo                text not null,
  ventana_dias            integer not null,
  solo_pagos              boolean not null default true,
  excluir_retornados      boolean not null default false,
  excluir_mensualidades   boolean not null default false,
  indicativos             text[] not null default '{}',
  mensaje                 text not null,
  productos               text[] not null,
  beneficio_tipo          text,
  beneficio_valor         numeric(12, 2),
  beneficio_vigencia_dias integer,
  limite_destinatarios    integer,
  tarifa                  numeric(12, 6),
  moneda                  text,
  presupuesto_maximo      numeric(12, 2),
  simulacion              jsonb not null default '{}'::jsonb,
  audiencia               jsonb,
  seleccionados           integer,
  costo_maximo            numeric(12, 2),
  preparada_en            timestamptz,
  iniciada_en             timestamptz,
  pausada_en              timestamptz,
  cancelada_en            timestamptz,
  completada_en           timestamptz,
  creada_por              text not null,
  creada_en               timestamptz not null default now(),
  actualizada_en          timestamptz not null default now(),
  constraint mkt_campanias_clave unique (clave_creacion),
  constraint mkt_campanias_modo check (modo = 'simulacion'),
  constraint mkt_campanias_estado check (estado in ('borrador', 'preparada', 'ejecutando', 'pausada', 'cancelada', 'completada')),
  constraint mkt_campanias_version check (version >= 1),
  constraint mkt_campanias_nombre check (char_length(btrim(nombre)) between 3 and 80),
  constraint mkt_campanias_objetivo check (char_length(btrim(objetivo)) between 3 and 300),
  constraint mkt_campanias_ventana check (ventana_dias in (14, 21)),
  constraint mkt_campanias_indicativos check (
    cardinality(indicativos) <= 50 and array_to_string(indicativos, ',') ~ '^([0-9]{2,4}(,[0-9]{2,4})*)?$'),
  constraint mkt_campanias_mensaje check (char_length(mensaje) between 10 and 1024),
  constraint mkt_campanias_productos check (
    cardinality(productos) between 1 and 2 and productos <@ array['reserva', 'gift_card']::text[]),
  constraint mkt_campanias_beneficio check (
    (beneficio_tipo is null or beneficio_tipo in ('porcentaje', 'monto_fijo'))
    and (beneficio_valor is null
         or (beneficio_tipo = 'porcentaje' and beneficio_valor between 1 and 100)
         or (beneficio_tipo = 'monto_fijo' and beneficio_valor between 1 and 1000000))
    and (beneficio_vigencia_dias is null or beneficio_vigencia_dias between 1 and 60)),
  constraint mkt_campanias_topes check (
    (limite_destinatarios is null or limite_destinatarios between 1 and 5000)
    and (tarifa is null or (tarifa > 0 and tarifa <= 100))
    and (moneda is null or moneda ~ '^[A-Z]{3}$')
    and (presupuesto_maximo is null or presupuesto_maximo between 0 and 1000000)),
  constraint mkt_campanias_simulacion check (jsonb_typeof(simulacion) = 'object'),
  constraint mkt_campanias_lista check (estado = 'borrador' or (
    beneficio_tipo is not null and beneficio_valor is not null and beneficio_vigencia_dias is not null
    and tarifa is not null and moneda is not null and preparada_en is not null
    and seleccionados is not null and audiencia is not null)),
  constraint mkt_campanias_autor check (creada_por in ('admin'))
);

create index if not exists mkt_campanias_estado_idx on public.mkt_campanias (estado, creada_en desc);


-- ── 2. Destinatarios: la cola persistente ───────────────────────────────────
create table if not exists public.mkt_campania_destinatarios (
  id                  uuid primary key default gen_random_uuid(),
  campania_id         uuid not null references public.mkt_campanias (id),
  orden               integer not null,
  telefono            text not null,
  nombre              text,
  indicativo          text,
  ultima_visita       date not null,
  turno_id            text,
  beneficio_codigo    text not null,
  codigo_id           bigint references public.codigos_descuento (id),
  estado              text not null default 'pendiente',
  intentos            integer not null default 0,
  proximo_intento_en  timestamptz,
  tomado_por          uuid,
  tomado_hasta        timestamptz,
  wamid               text,
  ultimo_codigo       text,
  ultimo_detalle      text,
  motivo              text,
  costo               numeric(12, 6),
  preparado_en        timestamptz not null default now(),
  aceptado_en         timestamptz,
  entregado_en        timestamptz,
  terminado_en        timestamptz,
  actualizado_en      timestamptz not null default now(),
  constraint mkt_dest_telefono_unico unique (campania_id, telefono),
  constraint mkt_dest_orden_unico unique (campania_id, orden),
  constraint mkt_dest_beneficio_unico unique (beneficio_codigo),
  constraint mkt_dest_telefono_canonico check (telefono ~ '^(11[0-9]{8}|[23][0-9]{9})$'),
  constraint mkt_dest_estado check (estado in (
    'pendiente', 'enviando', 'aceptado', 'entregado', 'no_entregado', 'fallido', 'incierto', 'excluido', 'cancelado')),
  constraint mkt_dest_beneficio_ficticio check (beneficio_codigo ~ '^SIMU-[A-HJ-NP-Z2-9]{8}$'),
  constraint mkt_dest_intentos check (intentos between 0 and 10),
  constraint mkt_dest_turno check (estado <> 'enviando' or (tomado_por is not null and tomado_hasta is not null)),
  constraint mkt_dest_wamid check (estado not in ('aceptado', 'entregado', 'no_entregado') or wamid is not null),
  constraint mkt_dest_nombre check (nombre is null or char_length(nombre) between 1 and 80),
  constraint mkt_dest_orden check (orden >= 1)
);

create index if not exists mkt_dest_cola_idx on public.mkt_campania_destinatarios (campania_id, estado, orden);
create index if not exists mkt_dest_telefono_idx on public.mkt_campania_destinatarios (telefono);


-- ── 3. Historial ────────────────────────────────────────────────────────────
create table if not exists public.mkt_campania_eventos (
  id          bigint generated always as identity primary key,
  campania_id uuid not null references public.mkt_campanias (id),
  tipo        text not null,
  actor       text not null,
  detalle     jsonb not null default '{}'::jsonb,
  creado_en   timestamptz not null default clock_timestamp(),
  constraint mkt_campania_eventos_actor check (actor in ('admin', 'ejecutor', 'sistema')),
  constraint mkt_campania_eventos_detalle check (jsonb_typeof(detalle) = 'object')
);
create index if not exists mkt_campania_eventos_idx on public.mkt_campania_eventos (campania_id, id desc);

create or replace function public.mkt_campanias_sin_borrar()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  raise exception 'historial_inmutable' using errcode = '55000';
end;
$fn$;

drop trigger if exists mkt_campanias_sin_borrar on public.mkt_campanias;
create trigger mkt_campanias_sin_borrar before delete on public.mkt_campanias
  for each row execute function public.mkt_campanias_sin_borrar();
drop trigger if exists mkt_dest_sin_borrar on public.mkt_campania_destinatarios;
create trigger mkt_dest_sin_borrar before delete on public.mkt_campania_destinatarios
  for each row execute function public.mkt_campanias_sin_borrar();
drop trigger if exists mkt_campania_eventos_inmutables on public.mkt_campania_eventos;
create trigger mkt_campania_eventos_inmutables before update or delete on public.mkt_campania_eventos
  for each row execute function public.mkt_campanias_sin_borrar();
drop trigger if exists mkt_campanias_sin_truncate on public.mkt_campanias;
create trigger mkt_campanias_sin_truncate before truncate on public.mkt_campanias
  for each statement execute function public.mkt_campanias_sin_borrar();
drop trigger if exists mkt_dest_sin_truncate on public.mkt_campania_destinatarios;
create trigger mkt_dest_sin_truncate before truncate on public.mkt_campania_destinatarios
  for each statement execute function public.mkt_campanias_sin_borrar();
drop trigger if exists mkt_campania_eventos_sin_truncate on public.mkt_campania_eventos;
create trigger mkt_campania_eventos_sin_truncate before truncate on public.mkt_campania_eventos
  for each statement execute function public.mkt_campanias_sin_borrar();


-- ── 4. Guardar un borrador (crear o editar) ─────────────────────────────────
-- p_id null = crear (p_clave: la misma clave devuelve la misma campaña: doble
-- clic; los pedidos simultáneos con la misma clave se serializan con un lock
-- de la transacción, así el segundo encuentra la que creó el primero).
-- Editar exige estado 'borrador' y la versión que vio el panel.
create or replace function public.mkt_campania_guardar(p_id uuid, p_version integer, p_clave uuid, p_datos jsonb, p_rol text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_c    public.mkt_campanias;
  v_ind  text[];
  v_prod text[];
begin
  if p_rol is distinct from 'admin' then
    raise exception 'solo_admin' using errcode = '42501';
  end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object'
     or jsonb_typeof(coalesce(p_datos -> 'indicativos', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_datos -> 'productos', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_datos -> 'simulacion', '{}'::jsonb)) <> 'object' then
    raise exception 'datos_invalidos' using errcode = '22023';
  end if;
  select coalesce(array_agg(x order by x), '{}') into v_ind
    from (select distinct btrim(jsonb_array_elements_text(coalesce(p_datos -> 'indicativos', '[]'::jsonb))) as x) s;
  select coalesce(array_agg(x order by x), '{}') into v_prod
    from (select distinct btrim(jsonb_array_elements_text(coalesce(p_datos -> 'productos', '[]'::jsonb))) as x) s;

  if p_id is null then
    if p_clave is null then
      raise exception 'datos_invalidos:clave' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtext('mkt_campania_guardar'), hashtext(p_clave::text));
    select * into v_c from public.mkt_campanias where clave_creacion = p_clave;
    if found then
      return jsonb_build_object('ok', true, 'repetida', true, 'campania', to_jsonb(v_c));
    end if;
    insert into public.mkt_campanias (
      clave_creacion, nombre, objetivo, ventana_dias, solo_pagos, excluir_retornados, excluir_mensualidades,
      indicativos, mensaje, productos, beneficio_tipo, beneficio_valor, beneficio_vigencia_dias,
      limite_destinatarios, tarifa, moneda, presupuesto_maximo, simulacion, creada_por)
    values (
      p_clave, btrim(p_datos ->> 'nombre'), btrim(p_datos ->> 'objetivo'), (p_datos ->> 'ventana_dias')::integer,
      coalesce((p_datos ->> 'solo_pagos')::boolean, true), coalesce((p_datos ->> 'excluir_retornados')::boolean, false),
      coalesce((p_datos ->> 'excluir_mensualidades')::boolean, false), v_ind, p_datos ->> 'mensaje', v_prod,
      nullif(p_datos ->> 'beneficio_tipo', ''), (p_datos ->> 'beneficio_valor')::numeric, (p_datos ->> 'beneficio_vigencia_dias')::integer,
      (p_datos ->> 'limite_destinatarios')::integer, (p_datos ->> 'tarifa')::numeric, nullif(upper(btrim(p_datos ->> 'moneda')), ''),
      (p_datos ->> 'presupuesto_maximo')::numeric, coalesce(p_datos -> 'simulacion', '{}'::jsonb), p_rol)
    returning * into v_c;
    insert into public.mkt_campania_eventos (campania_id, tipo, actor) values (v_c.id, 'creada', 'admin');
    return jsonb_build_object('ok', true, 'repetida', false, 'campania', to_jsonb(v_c));
  end if;

  select * into v_c from public.mkt_campanias where id = p_id for update;
  if not found then
    raise exception 'campania_inexistente' using errcode = 'P0002';
  end if;
  if v_c.estado <> 'borrador' then
    raise exception 'no_editable:%', v_c.estado using errcode = '55000';
  end if;
  if p_version is distinct from v_c.version then
    raise exception 'version_desactualizada' using errcode = '40001';
  end if;
  update public.mkt_campanias set
    nombre = btrim(p_datos ->> 'nombre'), objetivo = btrim(p_datos ->> 'objetivo'),
    ventana_dias = (p_datos ->> 'ventana_dias')::integer,
    solo_pagos = coalesce((p_datos ->> 'solo_pagos')::boolean, true),
    excluir_retornados = coalesce((p_datos ->> 'excluir_retornados')::boolean, false),
    excluir_mensualidades = coalesce((p_datos ->> 'excluir_mensualidades')::boolean, false),
    indicativos = v_ind, mensaje = p_datos ->> 'mensaje', productos = v_prod,
    beneficio_tipo = nullif(p_datos ->> 'beneficio_tipo', ''), beneficio_valor = (p_datos ->> 'beneficio_valor')::numeric,
    beneficio_vigencia_dias = (p_datos ->> 'beneficio_vigencia_dias')::integer,
    limite_destinatarios = (p_datos ->> 'limite_destinatarios')::integer, tarifa = (p_datos ->> 'tarifa')::numeric,
    moneda = nullif(upper(btrim(p_datos ->> 'moneda')), ''), presupuesto_maximo = (p_datos ->> 'presupuesto_maximo')::numeric,
    simulacion = coalesce(p_datos -> 'simulacion', '{}'::jsonb),
    version = version + 1, actualizada_en = clock_timestamp()
  where id = p_id
  returning * into v_c;
  insert into public.mkt_campania_eventos (campania_id, tipo, actor, detalle)
  values (v_c.id, 'editada', 'admin', jsonb_build_object('version', v_c.version));
  return jsonb_build_object('ok', true, 'repetida', false, 'campania', to_jsonb(v_c));
end;
$fn$;


-- ── 5. Preparar: fija la audiencia y genera los beneficios ficticios ────────
-- p_destinatarios: [{telefono, nombre, indicativo, ultima_visita, turno_id}] en
-- el orden de selección, YA recortado por los topes (la base los vuelve a
-- controlar y rechaza si se pasan). p_audiencia: resumen del cálculo, sin
-- teléfonos. Repite el chequeo de consentimiento y de otras campañas en curso;
-- lo que no pasa queda contado en audiencia.al_preparar.
create or replace function public.mkt_campania_preparar(p_id uuid, p_version integer, p_audiencia jsonb, p_destinatarios jsonb, p_rol text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_c     public.mkt_campanias;
  v_d     jsonb;
  v_tel   text;
  v_cod   text;
  v_n     integer := 0;
  v_sin   integer := 0;
  v_otra  integer := 0;
  v_total integer;
begin
  if p_rol is distinct from 'admin' then
    raise exception 'solo_admin' using errcode = '42501';
  end if;
  if p_audiencia is null or jsonb_typeof(p_audiencia) <> 'object' or p_destinatarios is null or jsonb_typeof(p_destinatarios) <> 'array' then
    raise exception 'datos_invalidos' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('mkt_campania_preparar'));
  select * into v_c from public.mkt_campanias where id = p_id for update;
  if not found then
    raise exception 'campania_inexistente' using errcode = 'P0002';
  end if;
  if v_c.estado <> 'borrador' then
    if v_c.preparada_en is not null and p_version is not null and v_c.version = p_version + 1 then
      return jsonb_build_object('ok', true, 'repetida', true, 'campania', to_jsonb(v_c));
    end if;
    raise exception 'no_editable:%', v_c.estado using errcode = '55000';
  end if;
  if p_version is distinct from v_c.version then
    raise exception 'version_desactualizada' using errcode = '40001';
  end if;
  if v_c.beneficio_tipo is null or v_c.beneficio_valor is null or v_c.beneficio_vigencia_dias is null
     or v_c.tarifa is null or v_c.moneda is null then
    raise exception 'campania_incompleta' using errcode = '22023';
  end if;

  v_total := jsonb_array_length(p_destinatarios);
  if v_c.limite_destinatarios is not null and v_total > v_c.limite_destinatarios then
    raise exception 'tope_excedido:limite' using errcode = '22023';
  end if;
  if v_c.presupuesto_maximo is not null and v_total * v_c.tarifa > v_c.presupuesto_maximo then
    raise exception 'tope_excedido:presupuesto' using errcode = '22023';
  end if;

  for v_d in select e from jsonb_array_elements(p_destinatarios) e loop
    v_tel := public.mensualidad_normalizar_telefono(v_d ->> 'telefono');
    if v_tel is null or v_tel is distinct from (v_d ->> 'telefono') then
      raise exception 'datos_invalidos:telefono' using errcode = '22023';
    end if;
    if exists (select 1 from public.mkt_campania_destinatarios where campania_id = p_id and telefono = v_tel) then
      raise exception 'destinatario_duplicado' using errcode = '23505';
    end if;
    if not exists (select 1 from public.mkt_consentimiento_estado e where e.telefono = v_tel and e.estado = 'alta') then
      v_sin := v_sin + 1;
      continue;
    end if;
    if exists (select 1 from public.mkt_campania_destinatarios d
                 join public.mkt_campanias c on c.id = d.campania_id
                where d.telefono = v_tel and c.id <> p_id
                  and c.estado in ('preparada', 'ejecutando', 'pausada')
                  and d.estado in ('pendiente', 'enviando', 'aceptado', 'incierto')) then
      v_otra := v_otra + 1;
      continue;
    end if;
    loop
      select 'SIMU-' || string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + get_byte(b.h, i) % 32, 1), '' order by i)
        into v_cod
        from (select decode(md5(gen_random_uuid()::text), 'hex') as h) b, generate_series(0, 7) i;
      exit when not exists (select 1 from public.mkt_campania_destinatarios where beneficio_codigo = v_cod);
    end loop;
    v_n := v_n + 1;
    insert into public.mkt_campania_destinatarios (campania_id, orden, telefono, nombre, indicativo, ultima_visita, turno_id, beneficio_codigo)
    values (p_id, v_n, v_tel, nullif(btrim(coalesce(v_d ->> 'nombre', '')), ''), nullif(v_d ->> 'indicativo', ''),
            (v_d ->> 'ultima_visita')::date, nullif(v_d ->> 'turno_id', ''), v_cod);
  end loop;

  if v_n = 0 then
    raise exception 'audiencia_vacia' using errcode = '22023';
  end if;

  update public.mkt_campanias set
    estado = 'preparada', preparada_en = clock_timestamp(), seleccionados = v_n,
    costo_maximo = round(v_n * tarifa, 2),
    audiencia = p_audiencia || jsonb_build_object('al_preparar', jsonb_build_object(
      'recibidos', v_total, 'preparados', v_n, 'sin_consentimiento', v_sin, 'en_otra_campania', v_otra)),
    version = version + 1, actualizada_en = clock_timestamp()
  where id = p_id
  returning * into v_c;
  insert into public.mkt_campania_eventos (campania_id, tipo, actor, detalle)
  values (p_id, 'preparada', 'admin', jsonb_build_object('preparados', v_n, 'sin_consentimiento', v_sin, 'en_otra_campania', v_otra));
  return jsonb_build_object('ok', true, 'repetida', false, 'campania', to_jsonb(v_c));
end;
$fn$;


-- ── 6. Iniciar, pausar, reanudar, cancelar (idempotentes) ───────────────────
create or replace function public.mkt_campania_cambiar(p_id uuid, p_accion text, p_rol text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_c        public.mkt_campanias;
  v_destino  text;
  v_desde    text[];
  v_cancel   integer := 0;
begin
  if p_rol is distinct from 'admin' then
    raise exception 'solo_admin' using errcode = '42501';
  end if;
  case p_accion
    when 'iniciar'  then v_destino := 'ejecutando'; v_desde := array['preparada'];
    when 'pausar'   then v_destino := 'pausada';    v_desde := array['ejecutando'];
    when 'reanudar' then v_destino := 'ejecutando'; v_desde := array['pausada'];
    when 'cancelar' then v_destino := 'cancelada';  v_desde := array['preparada', 'ejecutando', 'pausada'];
    else raise exception 'datos_invalidos:accion' using errcode = '22023';
  end case;
  select * into v_c from public.mkt_campanias where id = p_id for update;
  if not found then
    raise exception 'campania_inexistente' using errcode = 'P0002';
  end if;
  if v_c.estado = v_destino then
    return jsonb_build_object('ok', true, 'repetida', true, 'campania', to_jsonb(v_c));
  end if;
  if not (v_c.estado = any (v_desde)) then
    raise exception 'transicion_invalida:%', v_c.estado using errcode = '55000';
  end if;
  if p_accion = 'cancelar' then
    update public.mkt_campania_destinatarios
       set estado = 'cancelado', motivo = 'campania_cancelada', terminado_en = clock_timestamp(), actualizado_en = clock_timestamp()
     where campania_id = p_id and estado = 'pendiente';
    get diagnostics v_cancel = row_count;
  end if;
  update public.mkt_campanias set
    estado = v_destino,
    iniciada_en = case when p_accion = 'iniciar' then clock_timestamp() else iniciada_en end,
    pausada_en = case when p_accion = 'pausar' then clock_timestamp() else pausada_en end,
    cancelada_en = case when p_accion = 'cancelar' then clock_timestamp() else cancelada_en end,
    actualizada_en = clock_timestamp()
  where id = p_id
  returning * into v_c;
  insert into public.mkt_campania_eventos (campania_id, tipo, actor, detalle)
  values (p_id, p_accion, 'admin', case when p_accion = 'cancelar' then jsonb_build_object('pendientes_cancelados', v_cancel) else '{}'::jsonb end);
  return jsonb_build_object('ok', true, 'repetida', false, 'campania', to_jsonb(v_c), 'pendientes_cancelados', v_cancel);
end;
$fn$;


-- ── 7. Tomar un lote para enviar ────────────────────────────────────────────
-- Bloquea la fila de la campaña (un lote a la vez por campaña), pasa a
-- 'incierto' los turnos vencidos, vuelve a revisar consentimiento y topes por
-- destinatario y marca 'enviando' a los tomados con un turno de p_turno_s.
create or replace function public.mkt_campania_tomar_lote(p_id uuid, p_ejecutor uuid, p_tamano integer, p_turno_s integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_c          public.mkt_campanias;
  v_r          record;
  v_estado     text;
  v_cupo       integer;
  v_compr      integer;
  v_tomados    jsonb := '[]'::jsonb;
  v_baja       integer := 0;
  v_sin        integer := 0;
  v_tope       integer := 0;
  v_interr     integer := 0;
  v_quedan     integer;
begin
  if p_ejecutor is null or p_tamano is null or p_tamano not between 1 and 50 or p_turno_s is null or p_turno_s not between 1 and 600 then
    raise exception 'datos_invalidos' using errcode = '22023';
  end if;
  select * into v_c from public.mkt_campanias where id = p_id for update;
  if not found then
    raise exception 'campania_inexistente' using errcode = 'P0002';
  end if;

  update public.mkt_campania_destinatarios
     set estado = 'incierto', motivo = 'ejecutor_interrumpido', ultimo_codigo = 'sin_respuesta',
         tomado_hasta = null, actualizado_en = clock_timestamp()
   where campania_id = p_id and estado = 'enviando' and tomado_hasta < clock_timestamp();
  get diagnostics v_interr = row_count;

  if v_c.estado <> 'ejecutando' then
    if v_interr > 0 then
      insert into public.mkt_campania_eventos (campania_id, tipo, actor, detalle)
      values (p_id, 'lote', 'ejecutor', jsonb_build_object('ejecutor', p_ejecutor, 'interrumpidos', v_interr));
    end if;
    return jsonb_build_object('ok', false, 'motivo', v_c.estado, 'interrumpidos', v_interr, 'tomados', '[]'::jsonb);
  end if;

  select count(*) into v_compr from public.mkt_campania_destinatarios
   where campania_id = p_id and estado in ('enviando', 'aceptado', 'entregado', 'no_entregado', 'incierto');
  v_cupo := p_tamano;
  if v_c.limite_destinatarios is not null then v_cupo := least(v_cupo, v_c.limite_destinatarios - v_compr); end if;
  if v_c.presupuesto_maximo is not null then v_cupo := least(v_cupo, floor(v_c.presupuesto_maximo / v_c.tarifa)::integer - v_compr); end if;

  for v_r in
    select d.id, d.telefono from public.mkt_campania_destinatarios d
     where d.campania_id = p_id and d.estado = 'pendiente'
       and (d.proximo_intento_en is null or d.proximo_intento_en <= clock_timestamp())
     order by d.orden
     limit p_tamano
     for update skip locked
  loop
    select e.estado into v_estado from public.mkt_consentimiento_estado e where e.telefono = v_r.telefono;
    if v_estado is distinct from 'alta' then
      update public.mkt_campania_destinatarios
         set estado = 'excluido', motivo = case when v_estado = 'baja' then 'baja_posterior' else 'sin_consentimiento' end,
             terminado_en = clock_timestamp(), actualizado_en = clock_timestamp()
       where id = v_r.id;
      if v_estado = 'baja' then v_baja := v_baja + 1; else v_sin := v_sin + 1; end if;
    elsif v_cupo <= 0 then
      update public.mkt_campania_destinatarios
         set estado = 'excluido', motivo = 'sin_cupo', terminado_en = clock_timestamp(), actualizado_en = clock_timestamp()
       where id = v_r.id;
      v_tope := v_tope + 1;
    else
      update public.mkt_campania_destinatarios
         set estado = 'enviando', tomado_por = p_ejecutor, tomado_hasta = clock_timestamp() + make_interval(secs => p_turno_s),
             intentos = intentos + 1, proximo_intento_en = null, actualizado_en = clock_timestamp()
       where id = v_r.id;
      v_tomados := v_tomados || (select jsonb_build_object('id', d.id, 'telefono', d.telefono, 'nombre', d.nombre,
                                         'beneficio_codigo', d.beneficio_codigo, 'intentos', d.intentos, 'orden', d.orden)
                                   from public.mkt_campania_destinatarios d where d.id = v_r.id);
      v_cupo := v_cupo - 1;
    end if;
    v_estado := null;
  end loop;

  select count(*) into v_quedan from public.mkt_campania_destinatarios
   where campania_id = p_id and estado in ('pendiente', 'enviando');
  if v_quedan = 0 then
    update public.mkt_campanias set estado = 'completada', completada_en = clock_timestamp(), actualizada_en = clock_timestamp()
     where id = p_id;
    insert into public.mkt_campania_eventos (campania_id, tipo, actor) values (p_id, 'completada', 'sistema');
  end if;
  if jsonb_array_length(v_tomados) > 0 or v_baja + v_sin + v_tope + v_interr > 0 then
    insert into public.mkt_campania_eventos (campania_id, tipo, actor, detalle)
    values (p_id, 'lote', 'ejecutor', jsonb_build_object('ejecutor', p_ejecutor, 'tomados', jsonb_array_length(v_tomados),
            'baja_posterior', v_baja, 'sin_consentimiento', v_sin, 'sin_cupo', v_tope, 'interrumpidos', v_interr));
  end if;
  return jsonb_build_object('ok', true, 'tomados', v_tomados, 'interrumpidos', v_interr,
    'excluidos', jsonb_build_object('baja_posterior', v_baja, 'sin_consentimiento', v_sin, 'sin_cupo', v_tope),
    'completada', v_quedan = 0);
end;
$fn$;


-- ── 8. Resultado de un envío (lo informa el ejecutor que lo tomó) ───────────
-- p_resultado: aceptado (p_datos.wamid) · fallido · transitorio (vuelve a la cola
-- con espera, hasta 3 intentos) · incierto. p_datos: codigo, detalle,
-- reintentar_en_s. Solo vale para el ejecutor que lo tomó; repetir el mismo
-- 'aceptado' devuelve repetida.
create or replace function public.mkt_campania_registrar_envio(p_destinatario uuid, p_ejecutor uuid, p_resultado text, p_datos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_d       public.mkt_campania_destinatarios;
  v_wamid   text := p_datos ->> 'wamid';
  v_codigo  text := left(nullif(btrim(coalesce(p_datos ->> 'codigo', '')), ''), 60);
  v_detalle text := left(nullif(btrim(coalesce(p_datos ->> 'detalle', '')), ''), 300);
  v_espera  integer := least(greatest(coalesce((p_datos ->> 'reintentar_en_s')::integer, 30), 1), 3600);
begin
  if p_destinatario is null or p_ejecutor is null or p_datos is null or jsonb_typeof(p_datos) <> 'object'
     or coalesce(p_resultado, '') not in ('aceptado', 'fallido', 'transitorio', 'incierto') then
    raise exception 'datos_invalidos' using errcode = '22023';
  end if;
  if p_resultado = 'aceptado' and coalesce(v_wamid, '') !~ '^[A-Za-z0-9._:=-]{1,200}$' then
    raise exception 'datos_invalidos:wamid' using errcode = '22023';
  end if;
  select * into v_d from public.mkt_campania_destinatarios where id = p_destinatario for update;
  if not found then
    raise exception 'destinatario_inexistente' using errcode = 'P0002';
  end if;
  if v_d.tomado_por is distinct from p_ejecutor then
    return jsonb_build_object('ok', false, 'motivo', 'no_es_del_ejecutor', 'estado', v_d.estado);
  end if;
  if v_d.estado in ('aceptado', 'entregado', 'no_entregado') and p_resultado = 'aceptado' and v_d.wamid = v_wamid then
    return jsonb_build_object('ok', true, 'repetida', true, 'estado', v_d.estado);
  end if;
  if not (v_d.estado = 'enviando' or (v_d.estado = 'incierto' and v_d.motivo = 'ejecutor_interrumpido')) then
    return jsonb_build_object('ok', false, 'motivo', 'estado_' || v_d.estado, 'estado', v_d.estado);
  end if;

  if p_resultado = 'aceptado' then
    update public.mkt_campania_destinatarios
       set estado = 'aceptado', wamid = v_wamid, aceptado_en = clock_timestamp(), tomado_hasta = null,
           motivo = null, ultimo_codigo = null, ultimo_detalle = null, actualizado_en = clock_timestamp()
     where id = p_destinatario returning * into v_d;
  elsif p_resultado = 'fallido' or (p_resultado = 'transitorio' and v_d.intentos >= 3) then
    update public.mkt_campania_destinatarios
       set estado = 'fallido', motivo = case when p_resultado = 'fallido' then 'error_definitivo' else 'reintentos_agotados' end,
           ultimo_codigo = v_codigo, ultimo_detalle = v_detalle, tomado_hasta = null,
           terminado_en = clock_timestamp(), actualizado_en = clock_timestamp()
     where id = p_destinatario returning * into v_d;
  elsif p_resultado = 'transitorio' then
    update public.mkt_campania_destinatarios
       set estado = 'pendiente', motivo = 'error_transitorio', ultimo_codigo = v_codigo, ultimo_detalle = v_detalle,
           proximo_intento_en = clock_timestamp() + make_interval(secs => v_espera),
           tomado_por = null, tomado_hasta = null, actualizado_en = clock_timestamp()
     where id = p_destinatario returning * into v_d;
  else
    update public.mkt_campania_destinatarios
       set estado = 'incierto', motivo = 'respuesta_incierta', ultimo_codigo = v_codigo, ultimo_detalle = v_detalle,
           tomado_hasta = null, actualizado_en = clock_timestamp()
     where id = p_destinatario returning * into v_d;
  end if;
  return jsonb_build_object('ok', true, 'repetida', false, 'estado', v_d.estado, 'intentos', v_d.intentos);
end;
$fn$;


-- ── 9. Estado de entrega (en la etapa real llegará por webhook) ─────────────
create or replace function public.mkt_campania_registrar_entrega(p_destinatario uuid, p_estado text, p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_d public.mkt_campania_destinatarios;
begin
  if p_destinatario is null or coalesce(p_estado, '') not in ('entregado', 'no_entregado') then
    raise exception 'datos_invalidos' using errcode = '22023';
  end if;
  select * into v_d from public.mkt_campania_destinatarios where id = p_destinatario for update;
  if not found then
    raise exception 'destinatario_inexistente' using errcode = 'P0002';
  end if;
  if v_d.estado = p_estado then
    return jsonb_build_object('ok', true, 'repetida', true, 'estado', v_d.estado);
  end if;
  if v_d.estado <> 'aceptado' then
    return jsonb_build_object('ok', false, 'motivo', 'estado_' || v_d.estado, 'estado', v_d.estado);
  end if;
  update public.mkt_campania_destinatarios d
     set estado = p_estado,
         entregado_en = case when p_estado = 'entregado' then clock_timestamp() end,
         terminado_en = clock_timestamp(),
         costo = case when p_estado = 'entregado' then (select c.tarifa from public.mkt_campanias c where c.id = d.campania_id) else 0 end,
         ultimo_codigo = case when p_estado = 'no_entregado' then left(nullif(btrim(coalesce(p_codigo, '')), ''), 60) end,
         actualizado_en = clock_timestamp()
   where d.id = p_destinatario returning * into v_d;
  return jsonb_build_object('ok', true, 'repetida', false, 'estado', v_d.estado);
end;
$fn$;


-- ── 10. Resolver un envío incierto (decisión de un admin) ───────────────────
-- 'reintentar' lo devuelve a la cola (puede duplicar si en realidad salió: el
-- panel lo advierte); 'fallido' lo cierra. Si la campaña ya había terminado,
-- un reintento la vuelve a 'ejecutando'.
create or replace function public.mkt_campania_resolver_incierto(p_destinatario uuid, p_decision text, p_rol text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_campania uuid;
  v_c        public.mkt_campanias;
  v_d        public.mkt_campania_destinatarios;
begin
  if p_rol is distinct from 'admin' then
    raise exception 'solo_admin' using errcode = '42501';
  end if;
  if coalesce(p_decision, '') not in ('reintentar', 'fallido') then
    raise exception 'datos_invalidos:decision' using errcode = '22023';
  end if;
  select campania_id into v_campania from public.mkt_campania_destinatarios where id = p_destinatario;
  if not found then
    raise exception 'destinatario_inexistente' using errcode = 'P0002';
  end if;
  select * into v_c from public.mkt_campanias where id = v_campania for update;
  select * into v_d from public.mkt_campania_destinatarios where id = p_destinatario for update;
  if v_d.estado <> 'incierto' then
    return jsonb_build_object('ok', false, 'motivo', 'estado_' || v_d.estado, 'estado', v_d.estado);
  end if;
  if p_decision = 'reintentar' then
    if v_c.estado = 'cancelada' then
      raise exception 'transicion_invalida:cancelada' using errcode = '55000';
    end if;
    update public.mkt_campania_destinatarios
       set estado = 'pendiente', motivo = 'reintento_manual', tomado_por = null, tomado_hasta = null,
           proximo_intento_en = null, actualizado_en = clock_timestamp()
     where id = p_destinatario returning * into v_d;
    if v_c.estado = 'completada' then
      update public.mkt_campanias set estado = 'ejecutando', completada_en = null, actualizada_en = clock_timestamp() where id = v_campania;
    end if;
  else
    update public.mkt_campania_destinatarios
       set estado = 'fallido', motivo = 'incierto_descartado', terminado_en = clock_timestamp(), actualizado_en = clock_timestamp()
     where id = p_destinatario returning * into v_d;
  end if;
  insert into public.mkt_campania_eventos (campania_id, tipo, actor, detalle)
  values (v_campania, 'incierto_' || p_decision, 'admin', jsonb_build_object('orden', v_d.orden));
  return jsonb_build_object('ok', true, 'estado', v_d.estado);
end;
$fn$;


-- ── 11. Cierre: si no queda nada por enviar, la campaña termina ─────────────
create or replace function public.mkt_campania_verificar_fin(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_c public.mkt_campanias;
begin
  select * into v_c from public.mkt_campanias where id = p_id for update;
  if not found then
    raise exception 'campania_inexistente' using errcode = 'P0002';
  end if;
  if v_c.estado = 'ejecutando' and not exists (
       select 1 from public.mkt_campania_destinatarios where campania_id = p_id and estado in ('pendiente', 'enviando')) then
    update public.mkt_campanias set estado = 'completada', completada_en = clock_timestamp(), actualizada_en = clock_timestamp()
     where id = p_id returning * into v_c;
    insert into public.mkt_campania_eventos (campania_id, tipo, actor) values (p_id, 'completada', 'sistema');
  end if;
  return jsonb_build_object('ok', true, 'estado', v_c.estado);
end;
$fn$;


-- ── 12. Atribución: campaña → destinatario → cupón → compra · regreso ───────
-- Compra = una compra PAGADA con el cupón del destinatario (codigo_id, que en
-- la etapa real apuntará a un código de codigos_descuento; en simulación es
-- null y no hay compras: el cupón ficticio no se puede canjear). Reserva web y
-- Gift Card van por separado. Regreso al stand = un turno no cancelado en
-- turnos_stand con el mismo teléfono canónico desde el día del envío (por día:
-- turnos_stand no guarda la hora de carga como fecha). Una Gift Card canjeada
-- en el stand no se vincula a un teléfono: no cuenta como regreso.
create or replace view public.mkt_campania_atribucion
with (security_invoker = true) as
select d.campania_id, d.id as destinatario_id, d.orden, d.telefono, d.beneficio_codigo, d.codigo_id,
       (d.codigo_id is null) as beneficio_ficticio, d.estado, d.aceptado_en as enviado_en,
       rv.id as reserva_id, rv.created_at as reserva_creada_en,
       gc.grupo_compra_id, gc.fecha_pago as gift_card_pagada_en, gc.tarjetas as gift_card_tarjetas,
       st.id as regreso_turno_id, st.fecha as regreso_fecha
  from public.mkt_campania_destinatarios d
  left join public.codigos_descuento cd on cd.id = d.codigo_id
  left join lateral (
    select r.id, r.created_at from public.reservas r
     where cd.codigo is not null and r.codigo_descuento = cd.codigo
       and (r.mercado_pago_payment_id is not null or (coalesce(r.total, 0) = 0 and r.estado = 'activa'))
     order by r.created_at limit 1) rv on true
  left join lateral (
    select g.grupo_compra_id, min(g.fecha_pago) as fecha_pago, count(*) as tarjetas from public.gift_cards g
     where cd.codigo is not null and g.codigo_descuento = cd.codigo and g.estado_pago = 'pagado'
     group by g.grupo_compra_id order by min(g.fecha_pago) limit 1) gc on true
  left join lateral (
    select t.id, t.fecha from public.turnos_stand t
     where d.aceptado_en is not null
       and t.fecha >= (d.aceptado_en at time zone 'America/Argentina/Buenos_Aires')::date
       and lower(coalesce(t.estado, '')) <> 'cancelado'
       and public.mensualidad_normalizar_telefono(t.telefono) = d.telefono
     order by t.fecha, t.id limit 1) st on true;


-- ── 13. Prefijo reservado para los beneficios ficticios ─────────────────────
-- Ningún código real puede empezar con SIMU-: un beneficio de simulación nunca
-- coincide con un código canjeable (ni aunque alguien lo cargue a mano).
alter table public.codigos_descuento drop constraint if exists codigos_descuento_prefijo_simulacion;
alter table public.codigos_descuento add constraint codigos_descuento_prefijo_simulacion
  check (upper(btrim(codigo)) !~ '^SIMU-');


-- ── 14. Permisos ────────────────────────────────────────────────────────────
alter table public.mkt_campanias enable row level security;
alter table public.mkt_campania_destinatarios enable row level security;
alter table public.mkt_campania_eventos enable row level security;
revoke all on table public.mkt_campanias from public, anon, authenticated, service_role;
revoke all on table public.mkt_campania_destinatarios from public, anon, authenticated, service_role;
revoke all on table public.mkt_campania_eventos from public, anon, authenticated, service_role;
revoke all on table public.mkt_campania_atribucion from public, anon, authenticated, service_role;
grant select on table public.mkt_campanias to service_role;
grant select on table public.mkt_campania_destinatarios to service_role;
grant select on table public.mkt_campania_eventos to service_role;
grant select on table public.mkt_campania_atribucion to service_role;

revoke all on function public.mkt_campanias_sin_borrar() from public, anon, authenticated, service_role;
revoke all on function public.mkt_campania_guardar(uuid, integer, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.mkt_campania_preparar(uuid, integer, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.mkt_campania_cambiar(uuid, text, text) from public, anon, authenticated;
revoke all on function public.mkt_campania_tomar_lote(uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.mkt_campania_registrar_envio(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.mkt_campania_registrar_entrega(uuid, text, text) from public, anon, authenticated;
revoke all on function public.mkt_campania_resolver_incierto(uuid, text, text) from public, anon, authenticated;
revoke all on function public.mkt_campania_verificar_fin(uuid) from public, anon, authenticated;
grant execute on function public.mkt_campania_guardar(uuid, integer, uuid, jsonb, text) to service_role;
grant execute on function public.mkt_campania_preparar(uuid, integer, jsonb, jsonb, text) to service_role;
grant execute on function public.mkt_campania_cambiar(uuid, text, text) to service_role;
grant execute on function public.mkt_campania_tomar_lote(uuid, uuid, integer, integer) to service_role;
grant execute on function public.mkt_campania_registrar_envio(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.mkt_campania_registrar_entrega(uuid, text, text) to service_role;
grant execute on function public.mkt_campania_resolver_incierto(uuid, text, text) to service_role;
grant execute on function public.mkt_campania_verificar_fin(uuid) to service_role;
