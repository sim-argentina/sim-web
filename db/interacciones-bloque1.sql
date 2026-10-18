-- ============================================================================
-- Interacciones del stand · Bloque 1 — Esquema, integridad y RPCs.
-- ----------------------------------------------------------------------------
-- Registra lo que pasó con cada visita espontánea al stand (una fila = un grupo)
-- DESPUÉS de atenderla, y la vincula con los turnos que ya existen en el Turnero.
-- Definiciones y decisiones: docs/interacciones.md.
--
-- Qué NO hace (y no puede hacer): no crea ni modifica turnos, reservas, pagos,
-- movimientos ni nada de Finanzas. Ninguna función de este archivo escribe en
-- turnos_stand, reservas, reserva_operacion ni fin_*. Las reservas web quedan
-- fuera del embudo del stand: no hay forma de vincularlas.
--
-- Piezas:
--   · interacciones_config        una fila; inicio_registro = lanzamiento real.
--                                  NULL hasta el lanzamiento: sin inicio no se
--                                  puede registrar nada.
--   · interacciones_stand          la visita. Sin nombre, teléfono ni otro dato
--                                  personal del visitante. Baja lógica (anulada).
--   · interaccion_turnos           el vínculo: FK real a turnos_stand(id) con
--                                  ON DELETE CASCADE y UNIQUE(turno_stand_id):
--                                  un turno pertenece a una sola interacción.
--                                  Guarda los datos mínimos del turno al vincular
--                                  (sin nombre ni teléfono) para detectar cambios.
--   · interacciones_stand_eventos  historial solo de alta (append-only).
--   · 3 vistas de lectura (estado, control de vínculos, cobertura).
--
-- Límites: interacciones_limites() es la ÚNICA fuente; las RPCs y los triggers la
-- leen y la API (Bloque 2) debe usar los mismos valores. Los CHECK de la tabla
-- repiten personas_grupo_max (50) y los largos máximos: si cambian, cambian juntos
-- (la verificación lo controla).
--
-- Quién registró: la sesión del panel solo firma el ROL, así que se guarda el rol
-- ('admin' | 'staff'). "Atendió" es una atribución DECLARADA (empleados activos al
-- elegirla; se conserva si el empleado se archiva). Iniciador es otra cosa.
--
-- Permisos mínimos: RLS sin policies y, además, service_role SOLO puede leer
-- tablas y vistas; toda escritura pasa por las RPCs SECURITY DEFINER. El borrado
-- de un turno desde el Turnero sigue funcionando: el CASCADE corre con el dueño de
-- la tabla hija (verificado), y los triggers son SECURITY DEFINER.
--
-- Va en db/orden.txt DESPUÉS de esquema-base-permisos.sql: ese archivo vuelve a
-- dar DML a service_role sobre TODAS las tablas; acá se lo recorta a lectura.
--
-- Aditivo e idempotente. Verificación sin huella:
-- db/interacciones-bloque1.verificacion.sql (+ scripts/pruebas/interacciones-bloque1.mjs
-- para la concurrencia real, solo contra el stack local).
-- Los cuerpos de las funciones NO llevan comentarios: así son idénticos a los de
-- la base. Las explicaciones van arriba de cada una.
-- ============================================================================


-- ── 1. Límites y fecha de negocio ───────────────────────────────────────────
-- Fuente única de los límites de esta versión. Zona de SIM: Córdoba (mismo huso y
-- reglas que Buenos Aires, sin horario de verano).
--   max_turnos_por_interaccion  vínculos por visita (grupos de 5+ o recompra).
--   tolerancia_dias_turno       |fecha del turno − fecha de la interacción| máx.
--   staff_dias_retro            staff: desde el día CALENDARIO anterior al del alta.
--   staff_horas_correccion      staff: editar/anular/desvincular hasta 48 h exactas
--                               después del alta (registrada_en + 48 h, inclusive).
--   margen_futuro_minutos       tolerancia de reloj para ocurrida_en.
create or replace function public.interacciones_limites()
returns jsonb
language sql
immutable
set search_path = public
as $fn$
  select jsonb_build_object(
    'zona', 'America/Argentina/Cordoba',
    'max_turnos_por_interaccion', 4,
    'tolerancia_dias_turno', 1,
    'staff_dias_retro', 1,
    'staff_horas_correccion', 48,
    'margen_futuro_minutos', 2,
    'personas_grupo_max', 50,
    'observaciones_max', 500,
    'nota_cierre_max', 300,
    'motivo_anulacion_max', 200
  )
$fn$;

-- Fecha calendario de SIM de un instante.
create or replace function public.interacciones_fecha_sim(p_ts timestamptz)
returns date
language sql
immutable
strict
set search_path = public
as $fn$
  select (p_ts at time zone 'America/Argentina/Cordoba')::date
$fn$;


-- Datos de pago CONTRADICTORIOS en un turno: total positivo con método 'gratis', o
-- total cero/nulo con un método que no es 'gratis'. Solo se SEÑALAN: la regla de
-- pago (total > 0) no cambia por esto.
create or replace function public.interacciones_pago_contradictorio(p_total numeric, p_metodo text)
returns boolean
language sql
immutable
set search_path = public
as $fn$
  select (coalesce(p_total, 0) > 0 and p_metodo = 'gratis')
      or (coalesce(p_total, 0) <= 0 and p_metodo is distinct from 'gratis')
$fn$;


-- ── 2. Configuración ────────────────────────────────────────────────────────
create table if not exists public.interacciones_config (
  id                  boolean primary key default true,
  inicio_registro     timestamptz,
  actualizado_en      timestamptz not null default now(),
  actualizado_por_rol text,
  constraint interacciones_config_unica_chk check (id),
  constraint interacciones_config_actor_chk
    check (actualizado_por_rol is null or actualizado_por_rol = 'admin')
);

comment on table public.interacciones_config is
  'Interacciones del stand: configuración (una fila). inicio_registro = lanzamiento real del módulo; NULL = todavía no se puede registrar.';

insert into public.interacciones_config (id) values (true) on conflict (id) do nothing;


-- ── 3. Interacciones ────────────────────────────────────────────────────────
create table if not exists public.interacciones_stand (
  id                  uuid primary key default gen_random_uuid(),
  idempotency_key     uuid not null,
  alta_huella         text not null,
  ocurrida_en         timestamptz not null,
  fecha_negocio       date generated always as ((ocurrida_en at time zone 'America/Argentina/Cordoba')::date) stored,
  hora_negocio        time generated always as ((ocurrida_en at time zone 'America/Argentina/Cordoba')::time) stored,
  registrada_en       timestamptz not null default now(),
  registrada_por_rol  text not null,
  actualizada_en      timestamptz,
  actualizada_por_rol text,
  version             integer not null default 1,
  resultado           text not null,
  personas_grupo      smallint not null,
  hombres             smallint,
  mujeres             smallint,
  rango_etario        text,
  conocia_sim         text,
  se_subio_antes      text,
  iniciador           text,
  atendio_empleado_id uuid references public.empleados(id) on delete restrict,
  motivo              text,
  observaciones       text,
  cierre_motivo       text,
  cierre_nota         text,
  cerrada_en          timestamptz,
  cerrada_por_rol     text,
  anulada_en          timestamptz,
  anulada_por_rol     text,
  anulada_motivo      text,
  constraint interacciones_stand_idempotency_key unique (idempotency_key),
  constraint interacciones_stand_huella_chk check (alta_huella ~ '^[0-9a-f]{32}$'),
  constraint interacciones_stand_resultado_chk check (resultado in ('miro', 'pregunto', 'subio')),
  constraint interacciones_stand_personas_chk check (personas_grupo between 1 and 50),
  constraint interacciones_stand_desglose_chk check (
    (hombres is null and mujeres is null)
    or (hombres is not null and mujeres is not null and hombres >= 0 and mujeres >= 0
        and hombres + mujeres = personas_grupo)
  ),
  constraint interacciones_stand_rango_chk check (
    rango_etario is null or rango_etario in ('menos_14', '14_17', '18_24', '25_34', '35_49', '50_mas')
  ),
  constraint interacciones_stand_conocia_chk check (conocia_sim is null or conocia_sim in ('si', 'no', 'no_sabe')),
  constraint interacciones_stand_subio_antes_chk check (se_subio_antes is null or se_subio_antes in ('si', 'no', 'no_sabe')),
  constraint interacciones_stand_iniciador_chk check (iniciador is null or iniciador in ('cliente', 'empleado')),
  constraint interacciones_stand_motivo_chk check (
    motivo is null
    or (resultado <> 'subio'
        and motivo in ('precio', 'tiempo', 'espera', 'vuelve_despues', 'no_interesa', 'requisitos', 'acompanantes', 'otro'))
  ),
  constraint interacciones_stand_observaciones_chk check (
    observaciones is null or (char_length(observaciones) between 1 and 500 and observaciones !~ '^\s|\s$')
  ),
  constraint interacciones_stand_cierre_chk check (
    (cierre_motivo is null and cierre_nota is null and cerrada_en is null and cerrada_por_rol is null)
    or (resultado = 'subio' and cerrada_en is not null and cerrada_por_rol = 'admin'
        and cierre_motivo in ('sin_turno_en_turnero', 'turno_no_identificable', 'otro')
        and (cierre_nota is null or (char_length(cierre_nota) between 1 and 300 and cierre_nota !~ '^\s|\s$'))
        and (cierre_motivo <> 'otro' or cierre_nota is not null))
  ),
  constraint interacciones_stand_anulada_chk check (
    (anulada_en is null and anulada_por_rol is null and anulada_motivo is null)
    or (anulada_en is not null and anulada_por_rol in ('admin', 'staff')
        and (anulada_motivo is null or (char_length(anulada_motivo) between 1 and 200 and anulada_motivo !~ '^\s|\s$')))
  ),
  constraint interacciones_stand_actores_chk check (
    registrada_por_rol in ('admin', 'staff')
    and (actualizada_por_rol is null or actualizada_por_rol in ('admin', 'staff', 'sistema'))
    and ((actualizada_en is null) = (actualizada_por_rol is null))
  ),
  constraint interacciones_stand_version_chk check (version >= 1)
);

comment on table public.interacciones_stand is
  'Interacciones del stand: una fila por visita/grupo espontáneo, cargada después de atender. Resultado máximo (miro/pregunto/subio), perfil aproximado y opcional, sin datos personales. No es una venta: las ventas viven en turnos_stand.';
comment on column public.interacciones_stand.registrada_por_rol is
  'Rol de la sesión que cargó la fila. La sesión del panel no identifica personas.';
comment on column public.interacciones_stand.atendio_empleado_id is
  'Atribución DECLARADA (opcional) de quién atendió. No es el registrador ni el iniciador.';
comment on column public.interacciones_stand.cierre_motivo is
  'Solo admin: subida declarada que se cierra sin turno. Sigue siendo declarada; no la verifica.';

create index if not exists interacciones_stand_fecha_idx
  on public.interacciones_stand (fecha_negocio) where anulada_en is null;
create index if not exists interacciones_stand_subio_idx
  on public.interacciones_stand (registrada_en) where resultado = 'subio' and anulada_en is null;
create index if not exists interacciones_stand_empleado_idx
  on public.interacciones_stand (atendio_empleado_id) where atendio_empleado_id is not null;


-- ── 4. Vínculos con el Turnero ──────────────────────────────────────────────
-- fuente explícita para poder sumar otra en el futuro sin migrar datos; hoy solo
-- 'turno_stand'. turno_* = datos del turno AL VINCULAR (no se actualizan): sirven
-- para detectar cambios posteriores del turno y quedan en el evento si el turno se
-- borra. Las métricas usan siempre el valor vivo de turnos_stand.
create table if not exists public.interaccion_turnos (
  id                uuid primary key default gen_random_uuid(),
  interaccion_id    uuid not null references public.interacciones_stand(id) on delete restrict,
  fuente            text not null default 'turno_stand',
  turno_stand_id    bigint not null references public.turnos_stand(id) on delete cascade,
  vinculado_en      timestamptz not null default now(),
  vinculado_por_rol text not null,
  turno_fecha       date not null,
  turno_hora        text,
  turno_personas    integer,
  turno_minutos     integer,
  turno_total       numeric,
  turno_metodo_pago text,
  turno_modalidad   text,
  constraint interaccion_turnos_turno_key unique (turno_stand_id),
  constraint interaccion_turnos_fuente_chk check (fuente = 'turno_stand'),
  constraint interaccion_turnos_actor_chk check (vinculado_por_rol in ('admin', 'staff'))
);

comment on table public.interaccion_turnos is
  'Interacciones del stand: vínculo verificado con turnos_stand por ID real. Un turno, una interacción. Borrar el turno en el Turnero borra el vínculo (CASCADE) y deja el evento turno_eliminado.';

create index if not exists interaccion_turnos_interaccion_idx
  on public.interaccion_turnos (interaccion_id);


-- ── 5. Historial ────────────────────────────────────────────────────────────
-- Solo se agregan filas. rol NULL = lo hizo el sistema (p. ej. el CASCADE de un
-- turno borrado). turno_stand_id sin FK a propósito: el turno puede ya no existir.
create table if not exists public.interacciones_stand_eventos (
  id             uuid primary key default gen_random_uuid(),
  interaccion_id uuid not null references public.interacciones_stand(id) on delete restrict,
  tipo           text not null,
  rol            text,
  turno_stand_id bigint,
  datos          jsonb not null default '{}'::jsonb,
  en             timestamptz not null default clock_timestamp(),
  constraint interacciones_stand_eventos_tipo_chk check (tipo in (
    'alta', 'edicion', 'vinculo', 'desvinculo', 'anulacion', 'cierre_sin_vinculo',
    'cierre_retirado', 'turno_eliminado', 'vinculo_eliminado_externo')),
  constraint interacciones_stand_eventos_rol_chk check (rol is null or rol in ('admin', 'staff'))
);

comment on table public.interacciones_stand_eventos is
  'Interacciones del stand: historial (append-only) de altas, ediciones, vínculos, cierres, anulaciones y turnos borrados en el Turnero. Sin nombre ni teléfono.';

create index if not exists interacciones_stand_eventos_interaccion_idx
  on public.interacciones_stand_eventos (interaccion_id, en);


-- ── 6. Vistas de lectura (security_invoker: respetan los permisos de quien lee) ──
-- Estado del vínculo, derivado (nunca guardado):
--   anulada · no_aplica (miro/pregunto) · con_turno (≥1 turno activo vinculado: NO
--   significa que todos los turnos de la visita estén registrados) · turno_no_activo
--   · cerrada_sin_turno (declarada) · pendiente.
-- Pago = total del turno > 0 (valor vivo); gratis = total 0. venta_verificada = al
-- menos un turno activo vinculado con total positivo: NO verifica acreditación ni
-- conciliación. Los turnos con total y método contradictorios se cuentan aparte
-- (turnos_pago_contradictorio) sin cambiar esa regla. participaciones = Σ
-- cantidad_personas de los turnos vinculados: participaciones, NO personas únicas.
-- ocurrida_en va al final para ordenar/paginar listados.
create or replace view public.interacciones_stand_estado
with (security_invoker = true) as
select
  i.id as interaccion_id,
  i.fecha_negocio,
  i.hora_negocio,
  i.resultado,
  i.personas_grupo,
  i.anulada_en is not null as anulada,
  coalesce(v.turnos_vinculados, 0)::integer as turnos_vinculados,
  coalesce(v.turnos_activos, 0)::integer as turnos_activos,
  coalesce(v.turnos_pagos, 0)::integer as turnos_pagos,
  coalesce(v.turnos_gratis, 0)::integer as turnos_gratis,
  coalesce(v.participaciones, 0)::integer as participaciones,
  case
    when i.anulada_en is not null then 'anulada'
    when i.resultado <> 'subio' then 'no_aplica'
    when coalesce(v.turnos_activos, 0) > 0 then 'con_turno'
    when coalesce(v.turnos_vinculados, 0) > 0 then 'turno_no_activo'
    when i.cierre_motivo is not null then 'cerrada_sin_turno'
    else 'pendiente'
  end as vinculo_estado,
  (i.anulada_en is null and coalesce(v.turnos_pagos, 0) > 0) as venta_verificada,
  i.ocurrida_en,
  coalesce(v.turnos_pago_contradictorio, 0)::integer as turnos_pago_contradictorio
from public.interacciones_stand i
left join lateral (
  select
    count(*) as turnos_vinculados,
    count(*) filter (where coalesce(t.estado, 'activo') = 'activo') as turnos_activos,
    count(*) filter (where coalesce(t.estado, 'activo') = 'activo' and coalesce(t.total, 0) > 0) as turnos_pagos,
    count(*) filter (where coalesce(t.estado, 'activo') = 'activo' and coalesce(t.total, 0) <= 0) as turnos_gratis,
    sum(coalesce(t.cantidad_personas, 0)) filter (where coalesce(t.estado, 'activo') = 'activo') as participaciones,
    count(*) filter (where public.interacciones_pago_contradictorio(t.total, t.metodo_pago)) as turnos_pago_contradictorio
  from public.interaccion_turnos it
  join public.turnos_stand t on t.id = it.turno_stand_id
  where it.interaccion_id = i.id
) v on true;

-- Control de cada vínculo contra el turno VIVO: diferencia de fecha y cambios del
-- turno desde que se vinculó. Detecta, no bloquea: el Turnero se sigue corrigiendo
-- como siempre.
create or replace view public.interacciones_vinculos_control
with (security_invoker = true) as
select
  it.id as vinculo_id,
  it.interaccion_id,
  it.turno_stand_id,
  it.vinculado_en,
  it.vinculado_por_rol,
  i.fecha_negocio as interaccion_fecha,
  t.fecha as turno_fecha,
  t.hora as turno_hora,
  t.hora_subida as turno_hora_subida,
  t.cantidad_personas as turno_personas,
  t.cantidad_minutos as turno_minutos,
  t.modalidad as turno_modalidad,
  coalesce(t.total, 0) as turno_total,
  coalesce(t.total, 0) > 0 as turno_pago,
  coalesce(t.estado, 'activo') = 'activo' as turno_activo,
  (t.fecha - i.fecha_negocio) as dias_diferencia,
  abs(t.fecha - i.fecha_negocio) > (public.interacciones_limites() ->> 'tolerancia_dias_turno')::integer as fuera_de_tolerancia,
  (t.fecha, t.hora, t.cantidad_personas, t.cantidad_minutos, t.total, t.metodo_pago, t.modalidad)
    is distinct from
  (it.turno_fecha, it.turno_hora, it.turno_personas, it.turno_minutos, it.turno_total, it.turno_metodo_pago, it.turno_modalidad)
    as turno_modificado,
  t.metodo_pago as turno_metodo_pago,
  public.interacciones_pago_contradictorio(t.total, t.metodo_pago) as pago_contradictorio
from public.interaccion_turnos it
join public.interacciones_stand i on i.id = it.interaccion_id
join public.turnos_stand t on t.id = it.turno_stand_id;

-- Cobertura del registro, por TURNO y por la fecha ACTUAL del turno (no por la de
-- la interacción: un vínculo que cruza la medianoche no se pierde). Elegible =
-- turno activo. Pago/gratis distinguibles. No es conversión.
create or replace view public.interacciones_cobertura_turnos
with (security_invoker = true) as
select
  t.id as turno_stand_id,
  t.fecha,
  t.hora,
  coalesce(t.total, 0) > 0 as es_pago,
  t.cantidad_personas,
  v.interaccion_id,
  v.interaccion_id is not null as vinculado,
  public.interacciones_pago_contradictorio(t.total, t.metodo_pago) as pago_contradictorio
from public.turnos_stand t
left join (
  select it.turno_stand_id, it.interaccion_id
  from public.interaccion_turnos it
  join public.interacciones_stand i on i.id = it.interaccion_id and i.anulada_en is null
) v on v.turno_stand_id = t.id
where coalesce(t.estado, 'activo') = 'activo';

-- (Bloque 4) Base del análisis: una fila por interacción NO anulada (las
-- anuladas no cuentan en ninguna métrica), con el perfil y el estado del
-- vínculo. Solo columnas que usan las métricas: sin observaciones ni auditoría.
create or replace view public.interacciones_analisis
with (security_invoker = true) as
select
  i.id as interaccion_id,
  i.fecha_negocio,
  i.hora_negocio,
  i.resultado,
  i.personas_grupo,
  i.hombres,
  i.mujeres,
  i.rango_etario,
  i.conocia_sim,
  i.se_subio_antes,
  i.iniciador,
  i.atendio_empleado_id,
  i.motivo,
  e.vinculo_estado,
  e.turnos_vinculados,
  e.turnos_activos,
  e.turnos_pagos,
  e.turnos_gratis,
  e.turnos_pago_contradictorio,
  e.participaciones,
  e.venta_verificada
from public.interacciones_stand i
join public.interacciones_stand_estado e on e.interaccion_id = i.id
where i.anulada_en is null;


-- ── 7. Validación pura ──────────────────────────────────────────────────────
-- Normaliza y valida los datos de una interacción. Rechaza campos desconocidos
-- (nombre, teléfono o cualquier otro): no se ignora nada en silencio. Todo es
-- opcional salvo resultado y personas_grupo. ocurrida_en: ISO con zona explícita
-- (Z u offset) o null (= ahora); se devuelve en UTC canónico para la huella.
-- Errores: 22023 'campo_invalido:<campo>', 'desglose_incompleto',
-- 'desglose_no_suma', 'motivo_no_aplica', 'datos_invalidos', 'campo_desconocido:<campo>'.
create or replace function public.interaccion_normalizar(p_datos jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $fn$
declare
  v_lim  jsonb := public.interacciones_limites();
  v_k    text;
  v_res  text;
  v_pers numeric;
  v_h    numeric;
  v_m    numeric;
  v_txt  text;
  v_obs  text;
  v_ocu  timestamptz;
  v_emp  uuid;
begin
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'datos_invalidos' using errcode = '22023';
  end if;
  for v_k in select jsonb_object_keys(p_datos) loop
    if v_k not in ('ocurrida_en', 'resultado', 'personas_grupo', 'hombres', 'mujeres', 'rango_etario',
                   'conocia_sim', 'se_subio_antes', 'iniciador', 'atendio_empleado_id', 'motivo', 'observaciones') then
      raise exception 'campo_desconocido:%', v_k using errcode = '22023';
    end if;
  end loop;
  foreach v_k in array array['ocurrida_en', 'resultado', 'rango_etario', 'conocia_sim', 'se_subio_antes',
                             'iniciador', 'atendio_empleado_id', 'motivo', 'observaciones'] loop
    if jsonb_typeof(p_datos -> v_k) not in ('string', 'null') then
      raise exception 'campo_invalido:%', v_k using errcode = '22023';
    end if;
  end loop;
  foreach v_k in array array['hombres', 'mujeres'] loop
    if jsonb_typeof(p_datos -> v_k) not in ('number', 'null') then
      raise exception 'campo_invalido:%', v_k using errcode = '22023';
    end if;
  end loop;

  v_res := p_datos ->> 'resultado';
  if v_res is null or v_res not in ('miro', 'pregunto', 'subio') then
    raise exception 'campo_invalido:resultado' using errcode = '22023';
  end if;

  if jsonb_typeof(p_datos -> 'personas_grupo') is distinct from 'number' then
    raise exception 'campo_invalido:personas_grupo' using errcode = '22023';
  end if;
  v_pers := (p_datos ->> 'personas_grupo')::numeric;
  if v_pers <> trunc(v_pers) or v_pers < 1 or v_pers > (v_lim ->> 'personas_grupo_max')::int then
    raise exception 'campo_invalido:personas_grupo' using errcode = '22023';
  end if;

  v_h := (p_datos ->> 'hombres')::numeric;
  v_m := (p_datos ->> 'mujeres')::numeric;
  if (v_h is null) <> (v_m is null) then
    raise exception 'desglose_incompleto' using errcode = '22023';
  end if;
  if v_h is not null then
    if v_h <> trunc(v_h) or v_h < 0 then
      raise exception 'campo_invalido:hombres' using errcode = '22023';
    end if;
    if v_m <> trunc(v_m) or v_m < 0 then
      raise exception 'campo_invalido:mujeres' using errcode = '22023';
    end if;
    if v_h + v_m <> v_pers then
      raise exception 'desglose_no_suma' using errcode = '22023';
    end if;
  end if;

  if (p_datos ->> 'rango_etario') is not null
     and (p_datos ->> 'rango_etario') not in ('menos_14', '14_17', '18_24', '25_34', '35_49', '50_mas') then
    raise exception 'campo_invalido:rango_etario' using errcode = '22023';
  end if;
  if (p_datos ->> 'conocia_sim') is not null and (p_datos ->> 'conocia_sim') not in ('si', 'no', 'no_sabe') then
    raise exception 'campo_invalido:conocia_sim' using errcode = '22023';
  end if;
  if (p_datos ->> 'se_subio_antes') is not null and (p_datos ->> 'se_subio_antes') not in ('si', 'no', 'no_sabe') then
    raise exception 'campo_invalido:se_subio_antes' using errcode = '22023';
  end if;
  if (p_datos ->> 'iniciador') is not null and (p_datos ->> 'iniciador') not in ('cliente', 'empleado') then
    raise exception 'campo_invalido:iniciador' using errcode = '22023';
  end if;

  v_txt := p_datos ->> 'motivo';
  if v_txt is not null then
    if v_txt not in ('precio', 'tiempo', 'espera', 'vuelve_despues', 'no_interesa', 'requisitos', 'acompanantes', 'otro') then
      raise exception 'campo_invalido:motivo' using errcode = '22023';
    end if;
    if v_res = 'subio' then
      raise exception 'motivo_no_aplica' using errcode = '22023';
    end if;
  end if;

  v_obs := nullif(btrim(p_datos ->> 'observaciones', E' \t\r\n'), '');
  if v_obs is not null and char_length(v_obs) > (v_lim ->> 'observaciones_max')::int then
    raise exception 'campo_invalido:observaciones' using errcode = '22023';
  end if;

  v_txt := p_datos ->> 'atendio_empleado_id';
  if v_txt is not null then
    if v_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'campo_invalido:atendio_empleado_id' using errcode = '22023';
    end if;
    v_emp := v_txt::uuid;
  end if;

  v_txt := p_datos ->> 'ocurrida_en';
  if v_txt is not null then
    if v_txt !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}(:?\d{2})?)$' then
      raise exception 'campo_invalido:ocurrida_en' using errcode = '22023';
    end if;
    begin
      v_ocu := v_txt::timestamptz;
    exception when others then
      raise exception 'campo_invalido:ocurrida_en' using errcode = '22023';
    end;
  end if;

  return jsonb_build_object(
    'ocurrida_en', case when v_ocu is null then null
                        else to_char(v_ocu at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
    'resultado', v_res,
    'personas_grupo', v_pers::int,
    'hombres', v_h::int,
    'mujeres', v_m::int,
    'rango_etario', p_datos ->> 'rango_etario',
    'conocia_sim', p_datos ->> 'conocia_sim',
    'se_subio_antes', p_datos ->> 'se_subio_antes',
    'iniciador', p_datos ->> 'iniciador',
    'atendio_empleado_id', v_emp,
    'motivo', p_datos ->> 'motivo',
    'observaciones', v_obs
  );
end;
$fn$;

-- Lista de turnos a vincular: sin nulos ni repetidos, ordenada, hasta el máximo.
create or replace function public.interacciones_normalizar_turnos(p_turnos bigint[])
returns bigint[]
language plpgsql
immutable
set search_path = public
as $fn$
declare
  v_out bigint[];
begin
  if p_turnos is null then
    return '{}'::bigint[];
  end if;
  if array_position(p_turnos, null) is not null then
    raise exception 'campo_invalido:turnos' using errcode = '22023';
  end if;
  select coalesce(array_agg(s.t order by s.t), '{}'::bigint[]) into v_out
    from (select distinct unnest(p_turnos) as t) s;
  if cardinality(v_out) <> cardinality(p_turnos) then
    raise exception 'turnos_repetidos' using errcode = '22023';
  end if;
  if cardinality(v_out) > (public.interacciones_limites() ->> 'max_turnos_por_interaccion')::int then
    raise exception 'maximo_turnos_por_interaccion' using errcode = '23514';
  end if;
  return v_out;
end;
$fn$;

-- ¿Puede este rol declarar que la interacción ocurrió en p_ocurrida?
-- p_referencia = instante del alta (al registrar, ahora; al editar, registrada_en).
-- Devuelve NULL si es válida o el código de error.
--   · sin inicio_registro            → registro_no_iniciado
--   · después de ahora + margen      → ocurrida_en_futura
--   · antes del inicio del registro  → ocurrida_en_antes_del_inicio (también admin)
--   · staff: fecha SIM anterior al día calendario previo al del alta → fuera_de_ventana
--     (alta el 19/10 00:05 → vale desde el 18/10 00:00:00 de Córdoba; no es 24 h móviles)
create or replace function public.interacciones_validar_ocurrida(
  p_rol        text,
  p_ocurrida   timestamptz,
  p_referencia timestamptz,
  p_ahora      timestamptz,
  p_inicio     timestamptz
)
returns text
language plpgsql
immutable
set search_path = public
as $fn$
declare
  v_lim jsonb := public.interacciones_limites();
begin
  if p_inicio is null then
    return 'registro_no_iniciado';
  end if;
  if p_ocurrida is null or p_referencia is null or p_ahora is null then
    return 'campo_invalido:ocurrida_en';
  end if;
  if p_ocurrida > p_ahora + make_interval(mins => (v_lim ->> 'margen_futuro_minutos')::int) then
    return 'ocurrida_en_futura';
  end if;
  if p_ocurrida < p_inicio then
    return 'ocurrida_en_antes_del_inicio';
  end if;
  if p_rol = 'staff'
     and public.interacciones_fecha_sim(p_ocurrida)
         < public.interacciones_fecha_sim(p_referencia) - (v_lim ->> 'staff_dias_retro')::int then
    return 'fuera_de_ventana';
  end if;
  return null;
end;
$fn$;

-- Staff corrige (edita, anula, desvincula) hasta registrada_en + 48 h, inclusive.
create or replace function public.interacciones_staff_puede_corregir(
  p_registrada timestamptz,
  p_ahora      timestamptz
)
returns boolean
language sql
immutable
set search_path = public
as $fn$
  select p_ahora <= p_registrada + make_interval(hours => (public.interacciones_limites() ->> 'staff_horas_correccion')::int)
$fn$;

-- Lanza el error de interacciones_validar_ocurrida con su código SQL.
create or replace function public.interacciones_exigir_ocurrida(
  p_rol        text,
  p_ocurrida   timestamptz,
  p_referencia timestamptz
)
returns void
language plpgsql
stable
set search_path = public
as $fn$
declare
  v_inicio timestamptz;
  v_err    text;
begin
  select c.inicio_registro into v_inicio from public.interacciones_config c where c.id;
  v_err := public.interacciones_validar_ocurrida(p_rol, p_ocurrida, p_referencia, now(), v_inicio);
  if v_err is not null then
    raise exception '%', v_err using errcode = case
      when v_err = 'fuera_de_ventana' then '42501'
      when v_err = 'registro_no_iniciado' then '55000'
      else '22023' end;
  end if;
end;
$fn$;

-- Datos de una interacción para devolver desde las RPCs (sin la huella interna).
-- Los IDs bigint de turnos viajan como TEXTO: JSON no los garantiza como número.
create or replace function public.interaccion_detalle(p_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $fn$
  select jsonb_build_object(
    'interaccion', to_jsonb(i) - 'alta_huella',
    'estado', to_jsonb(e) - 'interaccion_id',
    'turnos', coalesce((
      select jsonb_agg(to_jsonb(c) || jsonb_build_object('turno_stand_id', c.turno_stand_id::text)
                       order by c.vinculado_en, c.turno_stand_id)
        from public.interacciones_vinculos_control c
       where c.interaccion_id = i.id), '[]'::jsonb)
  )
  from public.interacciones_stand i
  join public.interacciones_stand_estado e on e.interaccion_id = i.id
  where i.id = p_id
$fn$;

-- Datos mínimos de un turno para el historial: nunca nombre ni teléfono.
create or replace function public.interacciones_resumen_vinculo(p public.interaccion_turnos)
returns jsonb
language sql
immutable
set search_path = public
as $fn$
  select jsonb_build_object(
    'turno_stand_id', p.turno_stand_id,
    'vinculado_en', p.vinculado_en,
    'vinculado_por_rol', p.vinculado_por_rol,
    'al_vincular', jsonb_build_object(
      'fecha', p.turno_fecha, 'hora', p.turno_hora, 'personas', p.turno_personas,
      'minutos', p.turno_minutos, 'total', p.turno_total, 'metodo_pago', p.turno_metodo_pago,
      'modalidad', p.turno_modalidad))
$fn$;


-- ── 8. Triggers de integridad e historial ──────────────────────────────────
-- Las RPCs marcan la operación con dos variables LOCALES a la transacción
-- (sim.interacciones_rol y sim.interacciones_causa) y las limpian al terminar.
-- Si un vínculo se agrega o se borra SIN esas marcas (el CASCADE de un turno
-- borrado en el Turnero), el trigger lo registra como obra del sistema y sube la
-- versión de la interacción.

-- Antes de vincular: la interacción tiene que estar viva, con resultado 'subio',
-- sin cierre vigente y por debajo del máximo; el turno tiene que existir, estar
-- activo y caer dentro de la tolerancia. Bloquea la fila de la interacción
-- (FOR UPDATE), así el conteo es exacto aun con vinculaciones simultáneas. Copia
-- los datos mínimos del turno.
create or replace function public.interaccion_turnos_validar()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_lim jsonb := public.interacciones_limites();
  v_i   public.interacciones_stand;
  v_t   public.turnos_stand;
  v_n   integer;
begin
  select * into v_i from public.interacciones_stand where id = new.interaccion_id for update;
  if not found then
    raise exception 'interaccion_inexistente' using errcode = 'P0002';
  end if;
  if v_i.anulada_en is not null then
    raise exception 'interaccion_anulada' using errcode = '55000';
  end if;
  if v_i.resultado <> 'subio' then
    raise exception 'resultado_no_admite_vinculos' using errcode = '55000';
  end if;
  if v_i.cierre_motivo is not null then
    raise exception 'cierre_vigente' using errcode = '55000';
  end if;
  select count(*) into v_n from public.interaccion_turnos where interaccion_id = new.interaccion_id;
  if v_n >= (v_lim ->> 'max_turnos_por_interaccion')::int then
    raise exception 'maximo_turnos_por_interaccion' using errcode = '23514';
  end if;
  select * into v_t from public.turnos_stand where id = new.turno_stand_id;
  if not found then
    raise exception 'turno_inexistente:%', new.turno_stand_id using errcode = 'P0002';
  end if;
  if coalesce(v_t.estado, 'activo') <> 'activo' then
    raise exception 'turno_no_activo:%', new.turno_stand_id using errcode = '55000';
  end if;
  if abs(v_t.fecha - v_i.fecha_negocio) > (v_lim ->> 'tolerancia_dias_turno')::int then
    raise exception 'turno_fuera_de_tolerancia:%', new.turno_stand_id using errcode = '22023';
  end if;
  new.fuente := 'turno_stand';
  new.turno_fecha := v_t.fecha;
  new.turno_hora := v_t.hora;
  new.turno_personas := v_t.cantidad_personas;
  new.turno_minutos := v_t.cantidad_minutos;
  new.turno_total := v_t.total;
  new.turno_metodo_pago := v_t.metodo_pago;
  new.turno_modalidad := v_t.modalidad;
  return new;
end;
$fn$;

drop trigger if exists interaccion_turnos_validar on public.interaccion_turnos;
create trigger interaccion_turnos_validar
  before insert on public.interaccion_turnos
  for each row execute function public.interaccion_turnos_validar();

-- Un vínculo no se edita: se borra y se crea otro.
create or replace function public.interaccion_turnos_inmutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  raise exception 'vinculo_inmutable' using errcode = '55000';
end;
$fn$;

drop trigger if exists interaccion_turnos_inmutable on public.interaccion_turnos;
create trigger interaccion_turnos_inmutable
  before update on public.interaccion_turnos
  for each row execute function public.interaccion_turnos_inmutable();

create or replace function public.interaccion_turnos_registrar_alta()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_rol   text := nullif(current_setting('sim.interacciones_rol', true), '');
  v_causa text := nullif(current_setting('sim.interacciones_causa', true), '');
begin
  insert into public.interacciones_stand_eventos (interaccion_id, tipo, rol, turno_stand_id, datos)
  values (new.interaccion_id, 'vinculo', v_rol, new.turno_stand_id,
          jsonb_build_object('causa', coalesce(v_causa, 'externa')) || public.interacciones_resumen_vinculo(new));
  if v_causa is null then
    update public.interacciones_stand
       set version = version + 1, actualizada_en = now(), actualizada_por_rol = 'sistema'
     where id = new.interaccion_id;
  end if;
  return null;
end;
$fn$;

drop trigger if exists interaccion_turnos_registrar_alta on public.interaccion_turnos;
create trigger interaccion_turnos_registrar_alta
  after insert on public.interaccion_turnos
  for each row execute function public.interaccion_turnos_registrar_alta();

-- Al borrarse un vínculo: con marca de RPC es un 'desvinculo' (causa: desvinculo,
-- cambio_resultado o anulacion); sin marca, 'turno_eliminado' si el turno ya no
-- existe (CASCADE desde el Turnero) o 'vinculo_eliminado_externo' si existe.
-- Si era el último, la interacción queda pendiente: el cierre ya se había retirado
-- al vincular, así que no lo oculta.
create or replace function public.interaccion_turnos_registrar_baja()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_rol   text := nullif(current_setting('sim.interacciones_rol', true), '');
  v_causa text := nullif(current_setting('sim.interacciones_causa', true), '');
  v_tipo  text;
begin
  if v_causa is not null then
    v_tipo := 'desvinculo';
  elsif exists (select 1 from public.turnos_stand where id = old.turno_stand_id) then
    v_tipo := 'vinculo_eliminado_externo';
  else
    v_tipo := 'turno_eliminado';
  end if;
  insert into public.interacciones_stand_eventos (interaccion_id, tipo, rol, turno_stand_id, datos)
  values (old.interaccion_id, v_tipo, v_rol, old.turno_stand_id,
          jsonb_build_object('causa', coalesce(v_causa, 'externa')) || public.interacciones_resumen_vinculo(old));
  if v_causa is null then
    update public.interacciones_stand
       set version = version + 1, actualizada_en = now(), actualizada_por_rol = 'sistema'
     where id = old.interaccion_id;
  end if;
  return null;
end;
$fn$;

drop trigger if exists interaccion_turnos_registrar_baja on public.interaccion_turnos;
create trigger interaccion_turnos_registrar_baja
  after delete on public.interaccion_turnos
  for each row execute function public.interaccion_turnos_registrar_baja();

-- Protege la interacción en cualquier camino de escritura:
--   · campos del alta inmutables; una anulada no se modifica;
--   · toda modificación sube la versión (una versión vieja no puede pisar);
--   · con vínculos, la fila tiene que seguir siendo 'subio', viva y sin cierre.
create or replace function public.interacciones_stand_proteger()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.id <> old.id or new.idempotency_key <> old.idempotency_key or new.alta_huella <> old.alta_huella
     or new.registrada_en <> old.registrada_en or new.registrada_por_rol <> old.registrada_por_rol then
    raise exception 'campo_inmutable' using errcode = '55000';
  end if;
  if old.anulada_en is not null then
    raise exception 'interaccion_anulada' using errcode = '55000';
  end if;
  if new.version <= old.version then
    raise exception 'version_no_incrementada' using errcode = '55000';
  end if;
  if (new.resultado <> 'subio' or new.anulada_en is not null or new.cierre_motivo is not null)
     and exists (select 1 from public.interaccion_turnos where interaccion_id = new.id) then
    raise exception 'tiene_turnos_vinculados' using errcode = '55000';
  end if;
  return new;
end;
$fn$;

drop trigger if exists interacciones_stand_proteger on public.interacciones_stand;
create trigger interacciones_stand_proteger
  before update on public.interacciones_stand
  for each row execute function public.interacciones_stand_proteger();

-- Inserta vínculos traduciendo los choques a errores con el ID del turno.
create or replace function public.interacciones_insertar_vinculos(
  p_interaccion uuid,
  p_turnos      bigint[],
  p_rol         text
)
returns void
language plpgsql
set search_path = public
as $fn$
declare
  v_t bigint;
begin
  foreach v_t in array p_turnos loop
    begin
      insert into public.interaccion_turnos (interaccion_id, turno_stand_id, vinculado_por_rol)
      values (p_interaccion, v_t, p_rol);
    exception
      when unique_violation then
        raise exception 'turno_ya_vinculado:%', v_t using errcode = '23505';
      when foreign_key_violation then
        raise exception 'turno_inexistente:%', v_t using errcode = 'P0002';
    end;
  end loop;
end;
$fn$;


-- ── 9. RPCs (solo service_role; el rol lo pasa la API desde la sesión firmada) ──
-- Errores comunes: 42501 actor_invalido / solo_admin / fuera_de_ventana;
-- P0002 interaccion_inexistente; 55000 interaccion_anulada / version_desactualizada;
-- 23505 idempotency_key_con_otro_payload / turno_ya_vinculado:<id>.
-- Todas devuelven interaccion_detalle(id) y, cuando no cambió nada,
-- 'sin_cambios': true (sin subir la versión).

-- Alta. Idempotente por p_idempotency_key (la genera el cliente al abrir el
-- formulario): misma clave y mismo contenido → la fila original ('repetida': true),
-- aunque llegue en paralelo; misma clave con otro contenido → 23505. La huella es
-- de los datos normalizados y los turnos pedidos, no del rol. Si un turno ya está
-- vinculado o es inválido, no se guarda NADA.
create or replace function public.interaccion_registrar(
  p_idempotency_key uuid,
  p_datos           jsonb,
  p_turnos          bigint[],
  p_rol             text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_rol    text := btrim(coalesce(p_rol, ''));
  v_norm   jsonb;
  v_turnos bigint[];
  v_huella text;
  v_prev   public.interacciones_stand;
  v_id     uuid;
  v_ocu    timestamptz;
  v_emp    uuid;
begin
  if v_rol not in ('admin', 'staff') then
    raise exception 'actor_invalido' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'campo_invalido:idempotency_key' using errcode = '22023';
  end if;
  v_norm := public.interaccion_normalizar(p_datos);
  v_turnos := public.interacciones_normalizar_turnos(p_turnos);
  v_huella := md5(jsonb_build_object('datos', v_norm, 'turnos', to_jsonb(v_turnos))::text);

  select * into v_prev from public.interacciones_stand where idempotency_key = p_idempotency_key;
  if found then
    if v_prev.alta_huella <> v_huella then
      raise exception 'idempotency_key_con_otro_payload' using errcode = '23505';
    end if;
    return public.interaccion_detalle(v_prev.id) || jsonb_build_object('repetida', true);
  end if;

  if v_norm ->> 'resultado' <> 'subio' and cardinality(v_turnos) > 0 then
    raise exception 'resultado_no_admite_vinculos' using errcode = '55000';
  end if;
  v_ocu := coalesce((v_norm ->> 'ocurrida_en')::timestamptz, now());
  perform public.interacciones_exigir_ocurrida(v_rol, v_ocu, now());
  v_emp := (v_norm ->> 'atendio_empleado_id')::uuid;
  if v_emp is not null and not exists (select 1 from public.empleados e where e.id = v_emp and e.activo) then
    raise exception 'empleado_no_disponible' using errcode = '22023';
  end if;

  insert into public.interacciones_stand as s (
    idempotency_key, alta_huella, ocurrida_en, registrada_por_rol, resultado, personas_grupo,
    hombres, mujeres, rango_etario, conocia_sim, se_subio_antes, iniciador, atendio_empleado_id,
    motivo, observaciones)
  values (
    p_idempotency_key, v_huella, v_ocu, v_rol, v_norm ->> 'resultado', (v_norm ->> 'personas_grupo')::smallint,
    (v_norm ->> 'hombres')::smallint, (v_norm ->> 'mujeres')::smallint, v_norm ->> 'rango_etario',
    v_norm ->> 'conocia_sim', v_norm ->> 'se_subio_antes', v_norm ->> 'iniciador', v_emp,
    v_norm ->> 'motivo', v_norm ->> 'observaciones')
  on conflict (idempotency_key) do nothing
  returning s.id into v_id;

  if v_id is null then
    select * into v_prev from public.interacciones_stand where idempotency_key = p_idempotency_key;
    if v_prev.alta_huella <> v_huella then
      raise exception 'idempotency_key_con_otro_payload' using errcode = '23505';
    end if;
    return public.interaccion_detalle(v_prev.id) || jsonb_build_object('repetida', true);
  end if;

  insert into public.interacciones_stand_eventos (interaccion_id, tipo, rol, datos)
  values (v_id, 'alta', v_rol,
          jsonb_build_object('datos', v_norm || jsonb_build_object('ocurrida_en', v_ocu), 'turnos', to_jsonb(v_turnos)));

  perform set_config('sim.interacciones_rol', v_rol, true);
  perform set_config('sim.interacciones_causa', 'alta', true);
  perform public.interacciones_insertar_vinculos(v_id, v_turnos, v_rol);
  perform set_config('sim.interacciones_rol', '', true);
  perform set_config('sim.interacciones_causa', '', true);

  return public.interaccion_detalle(v_id) || jsonb_build_object('repetida', false);
end;
$fn$;

-- Edición parcial: las claves presentes en p_cambios reemplazan (null borra), las
-- ausentes quedan. Se valida la fila completa resultante. Control optimista por
-- p_version. Staff: hasta 48 h después del alta y, si cambia ocurrida_en, dentro
-- de su ventana contada desde el día del alta. Admin: siempre, desde el inicio.
-- "Atendió" solo exige empleado activo si CAMBIA (uno archivado se conserva).
-- Si deja de ser 'subio': libera los turnos y retira el cierre en la misma
-- transacción, con historial. Pasar a 'subio' exige motivo null (explícito).
-- Si cambia la FECHA de una 'subio' con turnos, todos tienen que seguir dentro
-- de la tolerancia (si no: turno_fuera_de_tolerancia:<id>). La respuesta agrega
-- 'turnos_liberados' (IDs como texto) y 'cierre_retirado'.
create or replace function public.interaccion_editar(
  p_id      uuid,
  p_version integer,
  p_cambios jsonb,
  p_rol     text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_rol      text := btrim(coalesce(p_rol, ''));
  v_row      public.interacciones_stand;
  v_actual   jsonb;
  v_base     jsonb;
  v_norm     jsonb;
  v_antes    jsonb;
  v_despues  jsonb;
  v_ocu      timestamptz;
  v_emp      uuid;
  v_liberados jsonb := '[]'::jsonb;
  v_cierre   jsonb;
  v_fuera    bigint;
begin
  if v_rol not in ('admin', 'staff') then
    raise exception 'actor_invalido' using errcode = '42501';
  end if;
  select * into v_row from public.interacciones_stand where id = p_id for update;
  if not found then
    raise exception 'interaccion_inexistente' using errcode = 'P0002';
  end if;
  if v_row.anulada_en is not null then
    raise exception 'interaccion_anulada' using errcode = '55000';
  end if;
  if p_version is null or v_row.version <> p_version then
    raise exception 'version_desactualizada' using errcode = '55000';
  end if;
  if v_rol = 'staff' and not public.interacciones_staff_puede_corregir(v_row.registrada_en, now()) then
    raise exception 'fuera_de_ventana' using errcode = '42501';
  end if;
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'object' then
    raise exception 'datos_invalidos' using errcode = '22023';
  end if;

  v_actual := jsonb_build_object(
    'ocurrida_en', to_char(v_row.ocurrida_en at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'resultado', v_row.resultado, 'personas_grupo', v_row.personas_grupo,
    'hombres', v_row.hombres, 'mujeres', v_row.mujeres, 'rango_etario', v_row.rango_etario,
    'conocia_sim', v_row.conocia_sim, 'se_subio_antes', v_row.se_subio_antes, 'iniciador', v_row.iniciador,
    'atendio_empleado_id', v_row.atendio_empleado_id, 'motivo', v_row.motivo, 'observaciones', v_row.observaciones);
  v_base := public.interaccion_normalizar(v_actual);
  v_norm := public.interaccion_normalizar(v_actual || p_cambios);

  if v_norm ->> 'ocurrida_en' is null then
    raise exception 'campo_invalido:ocurrida_en' using errcode = '22023';
  end if;
  if v_norm = v_base then
    return public.interaccion_detalle(p_id) || jsonb_build_object('sin_cambios', true);
  end if;

  select jsonb_object_agg(k.k, v_base -> k.k), jsonb_object_agg(k.k, v_norm -> k.k)
    into v_antes, v_despues
    from jsonb_object_keys(v_norm) as k(k)
   where v_norm -> k.k is distinct from v_base -> k.k;

  v_ocu := (v_norm ->> 'ocurrida_en')::timestamptz;
  if v_ocu <> v_row.ocurrida_en then
    perform public.interacciones_exigir_ocurrida(v_rol, v_ocu, v_row.registrada_en);
  end if;
  if v_norm ->> 'resultado' = 'subio' and public.interacciones_fecha_sim(v_ocu) <> v_row.fecha_negocio then
    select it.turno_stand_id into v_fuera
      from public.interaccion_turnos it
      join public.turnos_stand t on t.id = it.turno_stand_id
     where it.interaccion_id = p_id
       and abs(t.fecha - public.interacciones_fecha_sim(v_ocu))
           > (public.interacciones_limites() ->> 'tolerancia_dias_turno')::int
     order by it.turno_stand_id
     limit 1;
    if v_fuera is not null then
      raise exception 'turno_fuera_de_tolerancia:%', v_fuera using errcode = '22023';
    end if;
  end if;
  v_emp := (v_norm ->> 'atendio_empleado_id')::uuid;
  if v_emp is distinct from v_row.atendio_empleado_id and v_emp is not null
     and not exists (select 1 from public.empleados e where e.id = v_emp and e.activo) then
    raise exception 'empleado_no_disponible' using errcode = '22023';
  end if;

  if v_row.resultado = 'subio' and v_norm ->> 'resultado' <> 'subio' then
    select coalesce(jsonb_agg(it.turno_stand_id order by it.turno_stand_id), '[]'::jsonb) into v_liberados
      from public.interaccion_turnos it where it.interaccion_id = p_id;
    if v_row.cierre_motivo is not null then
      v_cierre := jsonb_build_object('motivo', v_row.cierre_motivo, 'nota', v_row.cierre_nota,
                                     'cerrada_en', v_row.cerrada_en);
    end if;
    perform set_config('sim.interacciones_rol', v_rol, true);
    perform set_config('sim.interacciones_causa', 'cambio_resultado', true);
    delete from public.interaccion_turnos where interaccion_id = p_id;
    perform set_config('sim.interacciones_rol', '', true);
    perform set_config('sim.interacciones_causa', '', true);
  end if;

  update public.interacciones_stand set
    ocurrida_en         = v_ocu,
    resultado           = v_norm ->> 'resultado',
    personas_grupo      = (v_norm ->> 'personas_grupo')::smallint,
    hombres             = (v_norm ->> 'hombres')::smallint,
    mujeres             = (v_norm ->> 'mujeres')::smallint,
    rango_etario        = v_norm ->> 'rango_etario',
    conocia_sim         = v_norm ->> 'conocia_sim',
    se_subio_antes      = v_norm ->> 'se_subio_antes',
    iniciador           = v_norm ->> 'iniciador',
    atendio_empleado_id = v_emp,
    motivo              = v_norm ->> 'motivo',
    observaciones       = v_norm ->> 'observaciones',
    cierre_motivo       = case when v_norm ->> 'resultado' = 'subio' then cierre_motivo end,
    cierre_nota         = case when v_norm ->> 'resultado' = 'subio' then cierre_nota end,
    cerrada_en          = case when v_norm ->> 'resultado' = 'subio' then cerrada_en end,
    cerrada_por_rol     = case when v_norm ->> 'resultado' = 'subio' then cerrada_por_rol end,
    version             = version + 1,
    actualizada_en      = now(),
    actualizada_por_rol = v_rol
  where id = p_id;

  insert into public.interacciones_stand_eventos (interaccion_id, tipo, rol, datos)
  values (p_id, 'edicion', v_rol,
          jsonb_build_object('antes', v_antes, 'despues', v_despues)
          || case when jsonb_array_length(v_liberados) > 0
                  then jsonb_build_object('turnos_liberados', v_liberados) else '{}'::jsonb end
          || case when v_cierre is not null
                  then jsonb_build_object('cierre_retirado', v_cierre) else '{}'::jsonb end);

  return public.interaccion_detalle(p_id) || jsonb_build_object(
    'turnos_liberados', (select coalesce(jsonb_agg(e.valor order by e.n), '[]'::jsonb)
                           from jsonb_array_elements_text(v_liberados) with ordinality as e(valor, n)),
    'cierre_retirado', v_cierre is not null);
end;
$fn$;

-- Vincular uno o más turnos a una interacción 'subio' (también completar una
-- pendiente). Staff y admin, sin ventana de tiempo. Si había un cierre sin turno,
-- se retira en la misma transacción (evento cierre_retirado): ya no es declarada.
-- Un turno que ya pertenece a ESTA interacción se ignora; a otra → 23505.
create or replace function public.interaccion_vincular(
  p_id      uuid,
  p_version integer,
  p_turnos  bigint[],
  p_rol     text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_rol     text := btrim(coalesce(p_rol, ''));
  v_row     public.interacciones_stand;
  v_turnos  bigint[];
  v_nuevos  bigint[];
begin
  if v_rol not in ('admin', 'staff') then
    raise exception 'actor_invalido' using errcode = '42501';
  end if;
  select * into v_row from public.interacciones_stand where id = p_id for update;
  if not found then
    raise exception 'interaccion_inexistente' using errcode = 'P0002';
  end if;
  if v_row.anulada_en is not null then
    raise exception 'interaccion_anulada' using errcode = '55000';
  end if;
  if p_version is null or v_row.version <> p_version then
    raise exception 'version_desactualizada' using errcode = '55000';
  end if;
  if v_row.resultado <> 'subio' then
    raise exception 'resultado_no_admite_vinculos' using errcode = '55000';
  end if;
  v_turnos := public.interacciones_normalizar_turnos(p_turnos);
  if cardinality(v_turnos) = 0 then
    raise exception 'campo_invalido:turnos' using errcode = '22023';
  end if;
  select coalesce(array_agg(t order by t), '{}'::bigint[]) into v_nuevos
    from unnest(v_turnos) as t
   where not exists (select 1 from public.interaccion_turnos it
                      where it.interaccion_id = p_id and it.turno_stand_id = t);
  if cardinality(v_nuevos) = 0 then
    return public.interaccion_detalle(p_id) || jsonb_build_object('sin_cambios', true);
  end if;

  update public.interacciones_stand set
    cierre_motivo = null, cierre_nota = null, cerrada_en = null, cerrada_por_rol = null,
    version = version + 1, actualizada_en = now(), actualizada_por_rol = v_rol
  where id = p_id;

  if v_row.cierre_motivo is not null then
    insert into public.interacciones_stand_eventos (interaccion_id, tipo, rol, datos)
    values (p_id, 'cierre_retirado', v_rol,
            jsonb_build_object('motivo', v_row.cierre_motivo, 'nota', v_row.cierre_nota,
                               'cerrada_en', v_row.cerrada_en, 'por', 'vinculo'));
  end if;

  perform set_config('sim.interacciones_rol', v_rol, true);
  perform set_config('sim.interacciones_causa', 'vinculo', true);
  perform public.interacciones_insertar_vinculos(p_id, v_nuevos, v_rol);
  perform set_config('sim.interacciones_rol', '', true);
  perform set_config('sim.interacciones_causa', '', true);

  return public.interaccion_detalle(p_id) || jsonb_build_object('cierre_retirado', v_row.cierre_motivo is not null);
end;
$fn$;

-- Desvincular un turno. Staff: hasta 48 h después del alta. Admin: siempre.
-- Si era el último, la interacción queda pendiente.
create or replace function public.interaccion_desvincular(
  p_id      uuid,
  p_version integer,
  p_turno   bigint,
  p_rol     text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_rol text := btrim(coalesce(p_rol, ''));
  v_row public.interacciones_stand;
begin
  if v_rol not in ('admin', 'staff') then
    raise exception 'actor_invalido' using errcode = '42501';
  end if;
  select * into v_row from public.interacciones_stand where id = p_id for update;
  if not found then
    raise exception 'interaccion_inexistente' using errcode = 'P0002';
  end if;
  if v_row.anulada_en is not null then
    raise exception 'interaccion_anulada' using errcode = '55000';
  end if;
  if p_version is null or v_row.version <> p_version then
    raise exception 'version_desactualizada' using errcode = '55000';
  end if;
  if v_rol = 'staff' and not public.interacciones_staff_puede_corregir(v_row.registrada_en, now()) then
    raise exception 'fuera_de_ventana' using errcode = '42501';
  end if;
  if not exists (select 1 from public.interaccion_turnos
                  where interaccion_id = p_id and turno_stand_id = p_turno) then
    raise exception 'vinculo_inexistente' using errcode = 'P0002';
  end if;

  perform set_config('sim.interacciones_rol', v_rol, true);
  perform set_config('sim.interacciones_causa', 'desvinculo', true);
  delete from public.interaccion_turnos where interaccion_id = p_id and turno_stand_id = p_turno;
  perform set_config('sim.interacciones_rol', '', true);
  perform set_config('sim.interacciones_causa', '', true);

  update public.interacciones_stand
     set version = version + 1, actualizada_en = now(), actualizada_por_rol = v_rol
   where id = p_id;

  return public.interaccion_detalle(p_id);
end;
$fn$;

-- Anulación (baja lógica): libera los turnos y deja de contar en todo. Repetirla
-- devuelve la misma fila sin cambios. Staff: hasta 48 h después del alta.
create or replace function public.interaccion_anular(
  p_id      uuid,
  p_version integer,
  p_motivo  text,
  p_rol     text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_rol       text := btrim(coalesce(p_rol, ''));
  v_row       public.interacciones_stand;
  v_motivo    text := nullif(btrim(coalesce(p_motivo, ''), E' \t\r\n'), '');
  v_liberados jsonb;
begin
  if v_rol not in ('admin', 'staff') then
    raise exception 'actor_invalido' using errcode = '42501';
  end if;
  select * into v_row from public.interacciones_stand where id = p_id for update;
  if not found then
    raise exception 'interaccion_inexistente' using errcode = 'P0002';
  end if;
  if v_row.anulada_en is not null then
    return public.interaccion_detalle(p_id) || jsonb_build_object('sin_cambios', true);
  end if;
  if p_version is null or v_row.version <> p_version then
    raise exception 'version_desactualizada' using errcode = '55000';
  end if;
  if v_rol = 'staff' and not public.interacciones_staff_puede_corregir(v_row.registrada_en, now()) then
    raise exception 'fuera_de_ventana' using errcode = '42501';
  end if;
  if v_motivo is not null and char_length(v_motivo) > (public.interacciones_limites() ->> 'motivo_anulacion_max')::int then
    raise exception 'campo_invalido:motivo_anulacion' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(it.turno_stand_id order by it.turno_stand_id), '[]'::jsonb) into v_liberados
    from public.interaccion_turnos it where it.interaccion_id = p_id;

  perform set_config('sim.interacciones_rol', v_rol, true);
  perform set_config('sim.interacciones_causa', 'anulacion', true);
  delete from public.interaccion_turnos where interaccion_id = p_id;
  perform set_config('sim.interacciones_rol', '', true);
  perform set_config('sim.interacciones_causa', '', true);

  update public.interacciones_stand set
    anulada_en = now(), anulada_por_rol = v_rol, anulada_motivo = v_motivo,
    version = version + 1, actualizada_en = now(), actualizada_por_rol = v_rol
  where id = p_id;

  insert into public.interacciones_stand_eventos (interaccion_id, tipo, rol, datos)
  values (p_id, 'anulacion', v_rol, jsonb_build_object('motivo', v_motivo, 'turnos_liberados', v_liberados));

  return public.interaccion_detalle(p_id) || jsonb_build_object(
    'turnos_liberados', (select coalesce(jsonb_agg(e.valor order by e.n), '[]'::jsonb)
                           from jsonb_array_elements_text(v_liberados) with ordinality as e(valor, n)));
end;
$fn$;

-- Cierre sin vínculo: SOLO admin, motivo obligatorio ('otro' exige nota). Solo
-- sobre una 'subio' viva y sin turnos. Sigue siendo una subida DECLARADA: no la
-- verifica ni la convierte en venta. Vincular después la retira.
create or replace function public.interaccion_cerrar_sin_vinculo(
  p_id      uuid,
  p_version integer,
  p_motivo  text,
  p_nota    text,
  p_rol     text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_rol  text := btrim(coalesce(p_rol, ''));
  v_row  public.interacciones_stand;
  v_nota text := nullif(btrim(coalesce(p_nota, ''), E' \t\r\n'), '');
begin
  if v_rol not in ('admin', 'staff') then
    raise exception 'actor_invalido' using errcode = '42501';
  end if;
  if v_rol <> 'admin' then
    raise exception 'solo_admin' using errcode = '42501';
  end if;
  if p_motivo is null or p_motivo not in ('sin_turno_en_turnero', 'turno_no_identificable', 'otro') then
    raise exception 'campo_invalido:cierre_motivo' using errcode = '22023';
  end if;
  if v_nota is not null and char_length(v_nota) > (public.interacciones_limites() ->> 'nota_cierre_max')::int then
    raise exception 'campo_invalido:cierre_nota' using errcode = '22023';
  end if;
  if p_motivo = 'otro' and v_nota is null then
    raise exception 'campo_invalido:cierre_nota' using errcode = '22023';
  end if;
  select * into v_row from public.interacciones_stand where id = p_id for update;
  if not found then
    raise exception 'interaccion_inexistente' using errcode = 'P0002';
  end if;
  if v_row.anulada_en is not null then
    raise exception 'interaccion_anulada' using errcode = '55000';
  end if;
  if p_version is null or v_row.version <> p_version then
    raise exception 'version_desactualizada' using errcode = '55000';
  end if;
  if v_row.resultado <> 'subio' then
    raise exception 'resultado_no_admite_cierre' using errcode = '55000';
  end if;
  if exists (select 1 from public.interaccion_turnos where interaccion_id = p_id) then
    raise exception 'tiene_turnos_vinculados' using errcode = '55000';
  end if;
  if v_row.cierre_motivo is not distinct from p_motivo and v_row.cierre_nota is not distinct from v_nota then
    return public.interaccion_detalle(p_id) || jsonb_build_object('sin_cambios', true);
  end if;

  update public.interacciones_stand set
    cierre_motivo = p_motivo, cierre_nota = v_nota, cerrada_en = now(), cerrada_por_rol = 'admin',
    version = version + 1, actualizada_en = now(), actualizada_por_rol = v_rol
  where id = p_id;

  insert into public.interacciones_stand_eventos (interaccion_id, tipo, rol, datos)
  values (p_id, 'cierre_sin_vinculo', v_rol,
          jsonb_build_object('motivo', p_motivo, 'nota', v_nota)
          || case when v_row.cierre_motivo is not null
                  then jsonb_build_object('reemplaza', jsonb_build_object('motivo', v_row.cierre_motivo, 'nota', v_row.cierre_nota))
                  else '{}'::jsonb end);

  return public.interaccion_detalle(p_id);
end;
$fn$;

-- Inicio del registro: SOLO admin. Se expresa en hora de SIM (Córdoba), p. ej.
-- '2026-10-25 10:00'. No puede quedar después de una interacción viva ya
-- registrada. Se fija al lanzar en Producción; nunca se infiere de la primera fila.
create or replace function public.interacciones_definir_inicio(
  p_inicio_local timestamp,
  p_rol          text
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_rol    text := btrim(coalesce(p_rol, ''));
  v_inicio timestamptz;
begin
  if v_rol <> 'admin' then
    raise exception 'solo_admin' using errcode = '42501';
  end if;
  if p_inicio_local is null then
    raise exception 'campo_invalido:inicio' using errcode = '22023';
  end if;
  v_inicio := p_inicio_local at time zone 'America/Argentina/Cordoba';
  if exists (select 1 from public.interacciones_stand where anulada_en is null and ocurrida_en < v_inicio) then
    raise exception 'inicio_posterior_a_registros' using errcode = '55000';
  end if;
  update public.interacciones_config
     set inicio_registro = v_inicio, actualizado_en = now(), actualizado_por_rol = 'admin'
   where id;
  return v_inicio;
end;
$fn$;


-- ── 10. Permisos ────────────────────────────────────────────────────────────
-- Tablas y vistas: RLS sin policies + nada para anon/authenticated + service_role
-- SOLO lectura. Escribir = llamar a una RPC.
alter table public.interacciones_config enable row level security;
alter table public.interacciones_stand enable row level security;
alter table public.interaccion_turnos enable row level security;
alter table public.interacciones_stand_eventos enable row level security;

revoke all on table public.interacciones_config from public, anon, authenticated, service_role;
revoke all on table public.interacciones_stand from public, anon, authenticated, service_role;
revoke all on table public.interaccion_turnos from public, anon, authenticated, service_role;
revoke all on table public.interacciones_stand_eventos from public, anon, authenticated, service_role;
revoke all on table public.interacciones_stand_estado from public, anon, authenticated, service_role;
revoke all on table public.interacciones_vinculos_control from public, anon, authenticated, service_role;
revoke all on table public.interacciones_cobertura_turnos from public, anon, authenticated, service_role;
revoke all on table public.interacciones_analisis from public, anon, authenticated, service_role;

grant select on table public.interacciones_config to service_role;
grant select on table public.interacciones_stand to service_role;
grant select on table public.interaccion_turnos to service_role;
grant select on table public.interacciones_stand_eventos to service_role;
grant select on table public.interacciones_stand_estado to service_role;
grant select on table public.interacciones_vinculos_control to service_role;
grant select on table public.interacciones_cobertura_turnos to service_role;
grant select on table public.interacciones_analisis to service_role;

-- Funciones internas: nadie más que el dueño.
revoke all on function public.interacciones_fecha_sim(timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.interaccion_normalizar(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.interacciones_normalizar_turnos(bigint[]) from public, anon, authenticated, service_role;
revoke all on function public.interacciones_validar_ocurrida(text, timestamptz, timestamptz, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.interacciones_staff_puede_corregir(timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.interacciones_exigir_ocurrida(text, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.interacciones_resumen_vinculo(public.interaccion_turnos) from public, anon, authenticated, service_role;
revoke all on function public.interacciones_insertar_vinculos(uuid, bigint[], text) from public, anon, authenticated, service_role;
revoke all on function public.interaccion_turnos_validar() from public, anon, authenticated, service_role;
revoke all on function public.interaccion_turnos_inmutable() from public, anon, authenticated, service_role;
revoke all on function public.interaccion_turnos_registrar_alta() from public, anon, authenticated, service_role;
revoke all on function public.interaccion_turnos_registrar_baja() from public, anon, authenticated, service_role;
revoke all on function public.interacciones_stand_proteger() from public, anon, authenticated, service_role;

-- Lo que usa la API: límites, detalle y las RPCs. interacciones_pago_contradictorio
-- también: las vistas son security_invoker y la llaman con los permisos de quien lee.
revoke all on function public.interacciones_pago_contradictorio(numeric, text) from public, anon, authenticated;
grant execute on function public.interacciones_pago_contradictorio(numeric, text) to service_role;
revoke all on function public.interacciones_limites() from public, anon, authenticated;
revoke all on function public.interaccion_detalle(uuid) from public, anon, authenticated;
revoke all on function public.interaccion_registrar(uuid, jsonb, bigint[], text) from public, anon, authenticated;
revoke all on function public.interaccion_editar(uuid, integer, jsonb, text) from public, anon, authenticated;
revoke all on function public.interaccion_vincular(uuid, integer, bigint[], text) from public, anon, authenticated;
revoke all on function public.interaccion_desvincular(uuid, integer, bigint, text) from public, anon, authenticated;
revoke all on function public.interaccion_anular(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.interaccion_cerrar_sin_vinculo(uuid, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.interacciones_definir_inicio(timestamp, text) from public, anon, authenticated;

grant execute on function public.interacciones_limites() to service_role;
grant execute on function public.interaccion_detalle(uuid) to service_role;
grant execute on function public.interaccion_registrar(uuid, jsonb, bigint[], text) to service_role;
grant execute on function public.interaccion_editar(uuid, integer, jsonb, text) to service_role;
grant execute on function public.interaccion_vincular(uuid, integer, bigint[], text) to service_role;
grant execute on function public.interaccion_desvincular(uuid, integer, bigint, text) to service_role;
grant execute on function public.interaccion_anular(uuid, integer, text, text) to service_role;
grant execute on function public.interaccion_cerrar_sin_vinculo(uuid, integer, text, text, text) to service_role;
grant execute on function public.interacciones_definir_inicio(timestamp, text) to service_role;
