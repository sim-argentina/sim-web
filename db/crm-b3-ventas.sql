-- ============================================================================
-- CRM B2B · Bloque 3 — Ventas, cobros, comisiones y recompras.
-- ----------------------------------------------------------------------------
-- Definiciones: docs/crm/b3-ventas-cobros-comisiones.md. Necesita B0, B1 y B2
-- (db/orden.txt, en ese orden). Aditivo e idempotente.
--
-- Qué NO hace: no escribe en Finanzas (fin_*), no crea ni modifica campañas ni
-- códigos de Empresas (solo se LEEN por su id), no calcula IVA ni emite
-- comprobantes, no ejecuta cobros ni reembolsos reales, no automatiza entregas.
--
-- Reglas que viven acá:
--   · Venta: desde una oportunidad abierta en una etapa (no pausada, perdida ni
--     ganada). Registrarla la pasa a "ganada" en la MISMA operación: cierra el
--     ciclo (cierre_motivo 'ganada'), cancela su próxima acción y deja una
--     actividad. Una venta vigente por oportunidad; "ganada" ⇔ venta vigente
--     (trigger de restricción diferido). Cada venta guarda la copia de las
--     condiciones (producto, cantidad, duración, precio y comisión de catálogo).
--   · Importes: numeric(12,2) con validación de centavos (crm_importe); nada se
--     compara en coma flotante.
--   · Cobros: registros con fecha efectiva ≠ fecha de carga; lo cobrado vigente
--     nunca supera el importe (venta bloqueada + trigger). El estado de cobro se
--     calcula; no hay casillas de "pagado".
--   · Comisión: pactada (importe > 0 y beneficiario) o "no corresponde", siempre
--     con fundamento: origen_comercial (venta nueva: el comercial que ORIGINÓ el
--     lead, no el responsable actual), recompra_trabajada (con la visita o la
--     actividad de esa oportunidad que lo prueba), recompra_espontanea (no
--     corresponde) o acuerdo_especial (con detalle). Un importe distinto del de
--     catálogo, o un personalizado, exige confirmar la comisión. Los pagos solo
--     con la operación totalmente cobrada y sin superar lo pactado.
--   · Recompra: mismo negocio, oportunidad nueva, venta nueva. Administración la
--     crea con un contacto existente (origen 'recompra_admin'); una visita de un
--     comercial a un cliente con contacto útil también la abre (origen visita).
--   · Correcciones y anulaciones: solo admin, con motivo y auditoría; nada se
--     borra. Una venta se anula sin cobros ni pagos de comisión vigentes; la
--     oportunidad vuelve a su etapa (o conflicto si el negocio ya tiene otra).
--
-- Permisos: RLS sin policies; service_role solo lee; escrituras por RPC
-- SECURITY DEFINER (solo admin). Las tablas de Empresas solo se leen desde el
-- servidor. Verificación: db/crm-b3-ventas.verificacion.sql y
-- db/crm-cadena.verificacion.sql. Los cuerpos de las funciones NO llevan comentarios.
-- ============================================================================

-- ── 0. Auditoría: entidades y acciones de B3 (superconjunto) ───────────────
alter table public.crm_auditoria drop constraint if exists crm_auditoria_entidad_chk;
alter table public.crm_auditoria add constraint crm_auditoria_entidad_chk check (entidad in (
  'crm_usuarios', 'crm_rubros', 'crm_zonas', 'crm_empresas', 'crm_contactos', 'crm_jornadas',
  'crm_visitas', 'crm_oportunidades', 'crm_tareas', 'crm_actividades', 'crm_seguimientos',
  'crm_productos', 'crm_ventas', 'crm_cobros', 'crm_comision_pagos')) not valid;
alter table public.crm_auditoria drop constraint if exists crm_auditoria_accion_chk;
alter table public.crm_auditoria add constraint crm_auditoria_accion_chk check (accion in (
  'alta', 'desactivacion', 'reactivacion', 'restablecimiento_contrasena', 'revocacion_sesiones', 'ingreso', 'cierre_sesion',
  'creacion', 'actualizacion', 'asignacion', 'archivo', 'desarchivo', 'apertura', 'cierre', 'registro', 'correccion',
  'anulacion', 'nota', 'reprogramacion', 'cancelacion', 'reasignacion_origen', 'cierre_por_anulacion',
  'gestion', 'cambio_estado', 'retroceso', 'pausa', 'reanudacion', 'perdida', 'reapertura',
  'seguimiento_programado', 'seguimiento_reprogramado', 'seguimiento_resuelto', 'seguimiento_cancelado', 'contacto_principal',
  'ganada', 'cobro', 'pago_comision', 'entrega', 'vinculo_campania')) not valid;
do $$
begin
  alter table public.crm_auditoria validate constraint crm_auditoria_entidad_chk;
  alter table public.crm_auditoria validate constraint crm_auditoria_accion_chk;
exception when check_violation then
  raise notice 'crm_auditoria: quedan NOT VALID hasta el bloque siguiente (hay filas de bloques posteriores)';
end
$$;

-- ── 1. Catálogo de productos (las ventas guardan su copia) ─────────────────
create table if not exists public.crm_productos (
  codigo                text primary key,
  nombre                text not null,
  experiencias          integer,
  minimo_experiencias   integer,
  duracion_minutos      integer not null,
  precio                numeric(12,2),
  comision_estandar     numeric(12,2),
  activo                boolean not null default true,
  orden                 integer not null default 0,
  version               integer not null default 1,
  actualizado_en        timestamptz not null default now(),
  constraint crm_productos_codigo_chk check (codigo in ('pack_10', 'pack_25', 'personalizado')),
  constraint crm_productos_valores_chk check (duracion_minutos > 0
    and ((codigo = 'personalizado') = (experiencias is null and precio is null and comision_estandar is null and minimo_experiencias is not null))
    and (experiencias is null or experiencias > 0) and (precio is null or precio > 0) and (comision_estandar is null or comision_estandar >= 0)
    and (minimo_experiencias is null or minimo_experiencias > 0))
);
insert into public.crm_productos (codigo, nombre, experiencias, minimo_experiencias, duracion_minutos, precio, comision_estandar, orden)
values ('pack_10', 'Pack 10', 10, null, 20, 150000.00, 40000.00, 10),
       ('pack_25', 'Pack 25', 25, null, 20, 360000.00, 90000.00, 20),
       ('personalizado', 'Personalizado (más de 25)', null, 26, 20, null, null, 30)
on conflict (codigo) do nothing;

-- ── 2. Oportunidad: estado "ganada" y origen de recompra ───────────────────
alter table public.crm_oportunidades add column if not exists origen_tipo text not null default 'visita';
alter table public.crm_oportunidades add column if not exists ganada_en timestamptz;
alter table public.crm_oportunidades add column if not exists estado_al_ganar text;
alter table public.crm_oportunidades alter column origen_visita_id drop not null;
alter table public.crm_oportunidades alter column origen_usuario_id drop not null;
alter table public.crm_oportunidades drop constraint if exists crm_oportunidades_origen_b3_chk;
alter table public.crm_oportunidades add constraint crm_oportunidades_origen_b3_chk check (
  origen_tipo in ('visita', 'recompra_admin')
  and ((origen_tipo = 'visita') = (origen_visita_id is not null and origen_usuario_id is not null))
  and (origen_tipo = 'visita' or (origen_visita_id is null and origen_usuario_id is null))) not valid;
alter table public.crm_oportunidades drop constraint if exists crm_oportunidades_estado_b2_chk;
alter table public.crm_oportunidades drop constraint if exists crm_oportunidades_cierre_b2_chk;
alter table public.crm_oportunidades drop constraint if exists crm_oportunidades_estado_b3_chk;
alter table public.crm_oportunidades add constraint crm_oportunidades_estado_b3_chk check (
  estado in ('contacto', 'conversacion', 'interesado', 'negociacion', 'pausada', 'perdida', 'ganada')
  and ciclo >= 1
  and ciclo_estado_inicial in ('contacto', 'conversacion', 'interesado', 'negociacion')
  and ((estado = 'pausada') = (estado_previo is not null))
  and ((estado = 'pausada') = (retomar_el is not null))
  and ((estado = 'pausada') = (pausada_en is not null))
  and (estado_previo is null or estado_previo in ('contacto', 'conversacion', 'interesado', 'negociacion'))
  and ((estado = 'perdida') = (perdida_en is not null))
  and ((estado = 'perdida') = (perdida_motivo is not null))
  and ((estado = 'perdida') = (estado_al_perder is not null))
  and (estado_al_perder is null or estado_al_perder in ('contacto', 'conversacion', 'interesado', 'negociacion'))
  and (perdida_motivo is null or perdida_motivo in ('precio', 'sin_presupuesto', 'sin_utilidad', 'no_le_interesa', 'otro_sistema',
       'no_prioridad', 'sin_decisor', 'dejo_de_responder', 'condiciones', 'otro'))
  and (perdida_motivo is distinct from 'otro' or perdida_detalle is not null)
  and (perdida_detalle is null or (perdida_motivo is not null and char_length(perdida_detalle) between 1 and 300))
  and ((estado = 'ganada') = (ganada_en is not null))
  and ((estado = 'ganada') = (estado_al_ganar is not null))
  and (estado_al_ganar is null or estado_al_ganar in ('contacto', 'conversacion', 'interesado', 'negociacion'))) not valid;
alter table public.crm_oportunidades drop constraint if exists crm_oportunidades_cierre_b3_chk;
alter table public.crm_oportunidades add constraint crm_oportunidades_cierre_b3_chk check (
  (cerrada_en is null) = (cierre_motivo is null)
  and (cierre_motivo is null or cierre_motivo in ('origen_anulado', 'perdida', 'ganada'))
  and ((estado = 'perdida') = (cierre_motivo is not distinct from 'perdida'))
  and ((estado = 'ganada') = (cierre_motivo is not distinct from 'ganada'))) not valid;
do $$
begin
  alter table public.crm_oportunidades validate constraint crm_oportunidades_origen_b3_chk;
  alter table public.crm_oportunidades validate constraint crm_oportunidades_estado_b3_chk;
  alter table public.crm_oportunidades validate constraint crm_oportunidades_cierre_b3_chk;
exception when check_violation then
  raise notice 'crm_oportunidades: restricciones de B3 NOT VALID hasta el bloque siguiente';
end
$$;

-- Actividades y próximas acciones admiten el cierre por venta.
alter table public.crm_actividades drop constraint if exists crm_actividades_estado_chk;
alter table public.crm_actividades add constraint crm_actividades_estado_chk check ((estado_antes is null) = (estado_despues is null)
  and (tipo <> 'cambio_estado' or estado_despues is not null)
  and (estado_despues is null or estado_despues in ('contacto', 'conversacion', 'interesado', 'negociacion', 'pausada', 'perdida', 'ganada'))) not valid;
alter table public.crm_seguimientos drop constraint if exists crm_seguimientos_estado_chk;
alter table public.crm_seguimientos add constraint crm_seguimientos_estado_chk check (estado in ('pendiente', 'hecha', 'reprogramada', 'cancelada')
  and ((estado = 'pendiente') = (cerrada_en is null))
  and ((estado = 'hecha') = (resuelta_por_actividad_id is not null))
  and ((estado = 'cancelada') = (cancelada_motivo is not null))
  and (cancelada_motivo is null or cancelada_motivo in ('pausa', 'perdida', 'ganada'))) not valid;
do $$
begin
  alter table public.crm_actividades validate constraint crm_actividades_estado_chk;
  alter table public.crm_seguimientos validate constraint crm_seguimientos_estado_chk;
exception when check_violation then
  raise notice 'actividades/seguimientos: NOT VALID hasta el bloque siguiente';
end
$$;

-- ── 3. Ventas ──────────────────────────────────────────────────────────────
create table if not exists public.crm_ventas (
  id                                  uuid primary key default gen_random_uuid(),
  oportunidad_id                      uuid not null references public.crm_oportunidades (id) on delete restrict,
  empresa_id                          uuid not null references public.crm_empresas (id) on delete restrict,
  ciclo                               integer not null,
  es_recompra                         boolean not null,
  fecha_acuerdo                       date not null,
  producto_codigo                     text not null,
  producto_nombre                     text not null,
  experiencias                        integer not null,
  duracion_minutos                    integer not null,
  importe                             numeric(12,2) not null,
  precio_catalogo                     numeric(12,2),
  comision_catalogo                   numeric(12,2),
  comision_tipo                       text not null,
  comision_importe                    numeric(12,2),
  comision_beneficiario_id            uuid references public.crm_usuarios (id) on delete restrict,
  comision_fundamento                 text not null,
  comision_detalle                    text,
  comision_intervencion_visita_id     uuid references public.crm_visitas (id) on delete restrict,
  comision_intervencion_actividad_id  uuid references public.crm_actividades (id) on delete restrict,
  observacion                         text,
  entrega_estado                      text not null default 'pendiente',
  entrega_fecha                       date,
  entrega_detalle                     text,
  campania_id                         uuid,
  campania_vinculada_en               timestamptz,
  registrada_en                       timestamptz not null default now(),
  anulada_en                          timestamptz,
  anulada_motivo                      text,
  operacion_clave                     uuid not null,
  version                             integer not null default 1,
  actualizada_en                      timestamptz not null default now(),
  constraint crm_ventas_producto_chk check (producto_codigo in ('pack_10', 'pack_25', 'personalizado')
    and experiencias > 0 and duracion_minutos > 0 and importe > 0
    and ((producto_codigo = 'personalizado') = (precio_catalogo is null and comision_catalogo is null))),
  constraint crm_ventas_comision_chk check (comision_tipo in ('pactada', 'no_corresponde')
    and comision_fundamento in ('origen_comercial', 'recompra_trabajada', 'recompra_espontanea', 'acuerdo_especial')
    and ((comision_tipo = 'pactada') = (comision_importe is not null))
    and ((comision_tipo = 'pactada') = (comision_beneficiario_id is not null))
    and (comision_importe is null or (comision_importe > 0 and comision_importe <= importe))
    and (comision_fundamento <> 'origen_comercial' or comision_tipo = 'pactada')
    and (comision_fundamento <> 'recompra_espontanea' or comision_tipo = 'no_corresponde')
    and (comision_fundamento <> 'recompra_trabajada' or (comision_tipo = 'pactada'
         and (comision_intervencion_visita_id is not null or comision_intervencion_actividad_id is not null)))
    and (comision_fundamento <> 'acuerdo_especial' or comision_detalle is not null)
    and (comision_detalle is null or char_length(comision_detalle) between 1 and 300)),
  constraint crm_ventas_entrega_chk check (entrega_estado in ('pendiente', 'entregada')
    and ((entrega_estado = 'entregada') = (entrega_fecha is not null))
    and (entrega_detalle is null or char_length(entrega_detalle) between 1 and 300)),
  constraint crm_ventas_campania_chk check ((campania_id is null) = (campania_vinculada_en is null)),
  constraint crm_ventas_anulada_chk check ((anulada_en is null) = (anulada_motivo is null)),
  constraint crm_ventas_texto_chk check (observacion is null or char_length(observacion) between 1 and 1000)
);
create unique index if not exists crm_ventas_una_vigente_uidx on public.crm_ventas (oportunidad_id) where anulada_en is null;
create unique index if not exists crm_ventas_campania_uidx on public.crm_ventas (campania_id) where anulada_en is null and campania_id is not null;
create index if not exists crm_ventas_empresa_idx on public.crm_ventas (empresa_id, fecha_acuerdo desc);

-- ── 4. Cobros y pagos de comisión (se anulan, nunca se borran) ─────────────
create table if not exists public.crm_cobros (
  id                uuid primary key default gen_random_uuid(),
  venta_id          uuid not null references public.crm_ventas (id) on delete restrict,
  fecha_efectiva    date not null,
  importe           numeric(12,2) not null,
  medio             text not null,
  referencia        text,
  concepto          text not null,
  registrado_en     timestamptz not null default now(),
  anulado_en        timestamptz,
  anulado_motivo    text,
  operacion_clave   uuid not null,
  constraint crm_cobros_valores_chk check (importe > 0
    and medio in ('transferencia', 'efectivo', 'mercadopago', 'tarjeta', 'otro')
    and concepto in ('anticipo', 'saldo', 'otro')
    and (referencia is null or char_length(referencia) between 1 and 120)
    and ((anulado_en is null) = (anulado_motivo is null)))
);
create index if not exists crm_cobros_venta_idx on public.crm_cobros (venta_id, fecha_efectiva);

create table if not exists public.crm_comision_pagos (
  id                uuid primary key default gen_random_uuid(),
  venta_id          uuid not null references public.crm_ventas (id) on delete restrict,
  beneficiario_id   uuid not null references public.crm_usuarios (id) on delete restrict,
  fecha             date not null,
  importe           numeric(12,2) not null,
  referencia        text,
  registrado_en     timestamptz not null default now(),
  anulado_en        timestamptz,
  anulado_motivo    text,
  operacion_clave   uuid not null,
  constraint crm_comision_pagos_valores_chk check (importe > 0
    and (referencia is null or char_length(referencia) between 1 and 120)
    and ((anulado_en is null) = (anulado_motivo is null)))
);
create index if not exists crm_comision_pagos_venta_idx on public.crm_comision_pagos (venta_id, fecha);

-- ── 5. Invariantes al confirmar la transacción ─────────────────────────────
-- "ganada" ⇔ una venta vigente; lo cobrado vigente ≤ importe. Se verifican al
-- COMMIT (diferidas) para que una operación compuesta pase por estados intermedios.
create or replace function public.crm_ventas_verificar()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  v_opp uuid;
  v_venta uuid;
begin
  if tg_table_name = 'crm_oportunidades' then
    v_opp := new.id;
  elsif tg_table_name = 'crm_ventas' then
    v_opp := new.oportunidad_id;
    v_venta := new.id;
  else
    v_venta := new.venta_id;
  end if;
  if v_opp is not null and (select estado = 'ganada' from public.crm_oportunidades where id = v_opp)
     is distinct from exists (select 1 from public.crm_ventas where oportunidad_id = v_opp and anulada_en is null) then
    raise exception 'integridad_ventas:ganada' using errcode = '23514';
  end if;
  if v_venta is not null and (select coalesce(sum(importe), 0) from public.crm_cobros where venta_id = v_venta and anulado_en is null)
     > (select importe from public.crm_ventas where id = v_venta) then
    raise exception 'integridad_ventas:cobros' using errcode = '23514';
  end if;
  return null;
end
$fn$;
drop trigger if exists crm_ventas_verificar_oportunidad on public.crm_oportunidades;
create constraint trigger crm_ventas_verificar_oportunidad after update of estado on public.crm_oportunidades
  deferrable initially deferred for each row when (new.estado = 'ganada' or old.estado = 'ganada') execute function public.crm_ventas_verificar();
drop trigger if exists crm_ventas_verificar_venta on public.crm_ventas;
create constraint trigger crm_ventas_verificar_venta after insert or update on public.crm_ventas
  deferrable initially deferred for each row execute function public.crm_ventas_verificar();
drop trigger if exists crm_ventas_verificar_cobro on public.crm_cobros;
create constraint trigger crm_ventas_verificar_cobro after insert or update on public.crm_cobros
  deferrable initially deferred for each row execute function public.crm_ventas_verificar();

-- ── 6. Funciones internas ──────────────────────────────────────────────────
-- Importe con centavos exactos: número JSON o texto "123456.78"; nunca más de dos
-- decimales, nunca negativo, nunca por encima del máximo.
create or replace function public.crm_importe(p jsonb, p_clave text, p_minimo numeric, p_maximo numeric)
returns numeric
language plpgsql
immutable
set search_path = public
as $fn$
declare
  t text;
  v numeric;
begin
  if p is null or not (p ? p_clave) or jsonb_typeof(p -> p_clave) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p -> p_clave) not in ('number', 'string') then
    raise exception 'datos_invalidos:%', p_clave using errcode = '22023';
  end if;
  t := btrim(p ->> p_clave);
  if t !~ '^\d{1,10}(\.\d{1,2})?$' then
    raise exception 'datos_invalidos:%', p_clave using errcode = '22023';
  end if;
  v := t::numeric;
  if v < p_minimo or v > p_maximo then
    raise exception 'datos_invalidos:%', p_clave using errcode = '22023';
  end if;
  return round(v, 2);
end
$fn$;

-- Entero estricto (cantidades y minutos): sin decimales ni redondeos silenciosos.
create or replace function public.crm_entero(p jsonb, p_clave text, p_maximo integer)
returns integer
language plpgsql
immutable
set search_path = public
as $fn$
declare
  v numeric;
begin
  v := public.crm_numero(p, p_clave, p_maximo);
  if v is null then
    return null;
  end if;
  if v <> trunc(v) or v < 1 then
    raise exception 'datos_invalidos:%', p_clave using errcode = '22023';
  end if;
  return v::integer;
end
$fn$;

create or replace function public.crm_venta_cobrado(p_venta uuid)
returns numeric
language sql
stable
set search_path = public
as $fn$
  select coalesce(sum(importe), 0)::numeric(12,2) from public.crm_cobros where venta_id = p_venta and anulado_en is null
$fn$;

create or replace function public.crm_venta_comision_pagada(p_venta uuid)
returns numeric
language sql
stable
set search_path = public
as $fn$
  select coalesce(sum(importe), 0)::numeric(12,2) from public.crm_comision_pagos where venta_id = p_venta and anulado_en is null
$fn$;

-- Comisión de una venta (la usan el registro y la corrección). Devuelve los campos
-- validados; levanta un error si la combinación no respeta las reglas.
create or replace function public.crm_venta_comision(p_c jsonb, o public.crm_oportunidades, p_es_recompra boolean, p_producto public.crm_productos,
  p_importe numeric)
returns jsonb
language plpgsql
volatile
set search_path = public
as $fn$
declare
  v_tipo text;
  v_fund text;
  v_det text;
  v_imp numeric;
  v_ben uuid;
  v_vis uuid;
  v_act uuid;
  v_conf boolean;
  v_estandar boolean;
begin
  if p_c is null or jsonb_typeof(p_c) <> 'object' then
    raise exception 'datos_invalidos:comision' using errcode = '22023';
  end if;
  perform public.crm_claves_permitidas(p_c, array['tipo', 'fundamento', 'detalle', 'importe', 'beneficiario_id', 'intervencion_visita_id',
    'intervencion_actividad_id', 'confirmada']);
  v_tipo := public.crm_texto(p_c, 'tipo', 20);
  v_fund := public.crm_texto(p_c, 'fundamento', 30);
  v_det := public.crm_texto(p_c, 'detalle', 300);
  begin
    v_imp := public.crm_importe(p_c, 'importe', 0.01, 9999999999.99);
  exception when sqlstate '22023' then
    raise exception 'datos_invalidos:comision_importe' using errcode = '22023';
  end;
  v_ben := public.crm_uuid(p_c, 'beneficiario_id');
  v_vis := public.crm_uuid(p_c, 'intervencion_visita_id');
  v_act := public.crm_uuid(p_c, 'intervencion_actividad_id');
  v_conf := coalesce(public.crm_bool(p_c, 'confirmada'), false);
  if v_tipo is null or v_tipo not in ('pactada', 'no_corresponde') then
    raise exception 'datos_invalidos:comision_tipo' using errcode = '22023';
  end if;
  if v_fund is null or v_fund not in ('origen_comercial', 'recompra_trabajada', 'recompra_espontanea', 'acuerdo_especial') then
    raise exception 'datos_invalidos:comision_fundamento' using errcode = '22023';
  end if;
  if v_tipo = 'no_corresponde' then
    if v_imp is not null or v_ben is not null or v_vis is not null or v_act is not null then
      raise exception 'datos_invalidos:comision_no_corresponde' using errcode = '22023';
    end if;
  else
    if v_imp is null then
      raise exception 'datos_invalidos:comision_importe' using errcode = '22023';
    end if;
    if v_imp > p_importe then
      raise exception 'datos_invalidos:comision_importe' using errcode = '22023';
    end if;
    if v_ben is null or not exists (select 1 from public.crm_usuarios where id = v_ben) then
      raise exception 'datos_invalidos:comision_beneficiario' using errcode = '22023';
    end if;
  end if;
  if v_fund = 'origen_comercial' then
    if p_es_recompra then
      raise exception 'comision_recompra' using errcode = '55000';
    end if;
    if v_tipo <> 'pactada' or o.origen_tipo <> 'visita' or v_ben is distinct from o.origen_usuario_id then
      raise exception 'comision_origen' using errcode = '55000';
    end if;
  elsif v_fund = 'recompra_trabajada' then
    if not p_es_recompra then
      raise exception 'comision_no_es_recompra' using errcode = '55000';
    end if;
    if v_tipo <> 'pactada' or (v_vis is null and v_act is null) then
      raise exception 'datos_invalidos:comision_intervencion' using errcode = '22023';
    end if;
    if v_vis is not null and not exists (select 1 from public.crm_visitas
       where id = v_vis and oportunidad_id = o.id and anulada_en is null and realizada_por_usuario = v_ben) then
      raise exception 'datos_invalidos:comision_intervencion' using errcode = '22023';
    end if;
    if v_act is not null and not exists (select 1 from public.crm_actividades where id = v_act and oportunidad_id = o.id) then
      raise exception 'datos_invalidos:comision_intervencion' using errcode = '22023';
    end if;
  elsif v_fund = 'recompra_espontanea' then
    if not p_es_recompra then
      raise exception 'comision_no_es_recompra' using errcode = '55000';
    end if;
    if v_tipo <> 'no_corresponde' then
      raise exception 'datos_invalidos:comision_tipo' using errcode = '22023';
    end if;
  elsif v_det is null then
    raise exception 'datos_invalidos:comision_detalle' using errcode = '22023';
  end if;
  v_estandar := v_tipo = 'pactada' and p_producto.codigo <> 'personalizado' and v_fund in ('origen_comercial', 'recompra_trabajada')
    and v_imp = p_producto.comision_estandar and p_importe = p_producto.precio;
  -- Lo que se aparta de la regla (importe distinto del estándar, personalizado o un
  -- acuerdo especial, con o sin comisión) se confirma explícitamente.
  if ((v_tipo = 'pactada' and not v_estandar) or v_fund = 'acuerdo_especial') and not v_conf then
    raise exception 'confirmar_comision' using errcode = '55000';
  end if;
  return jsonb_build_object('tipo', v_tipo, 'fundamento', v_fund, 'detalle', v_det, 'importe', v_imp, 'beneficiario_id', v_ben,
    'intervencion_visita_id', v_vis, 'intervencion_actividad_id', v_act);
end
$fn$;

-- Operación idempotente (crm_operaciones de B2): si la clave ya existe devuelve el
-- resultado guardado; con otro contenido u otro actor, clave_reutilizada.
create or replace function public.crm_operacion_previa(p_clave uuid, p_huella text, p_actor_rol text)
returns jsonb
language plpgsql
volatile
set search_path = public
as $fn$
declare
  v public.crm_operaciones%rowtype;
begin
  if p_clave is null or p_huella is null or p_huella !~ '^[0-9a-f]{64}$' then
    raise exception 'datos_invalidos:clave' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('crm_operacion:' || p_clave::text, 0));
  select * into v from public.crm_operaciones where clave = p_clave;
  if not found then
    return null;
  end if;
  if v.huella <> p_huella or v.actor_rol <> p_actor_rol then
    raise exception 'clave_reutilizada' using errcode = '22023';
  end if;
  return v.resultado || jsonb_build_object('repetida', true);
end
$fn$;

-- ── 7. RPC: registrar la venta y marcar "ganada" (una operación) ───────────
create or replace function public.crm_venta_registrar(p_clave uuid, p_huella text, p_oportunidad uuid, p_version integer, p_datos jsonb,
  p_actor_rol text, p_actor_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  o public.crm_oportunidades%rowtype;
  e public.crm_empresas%rowtype;
  p public.crm_productos%rowtype;
  v_previa jsonb;
  v_datos jsonb := coalesce(p_datos, '{}'::jsonb);
  v_ahora timestamptz := now();
  v_hoy date;
  v_fecha date;
  v_exp integer;
  v_dur integer;
  v_importe numeric;
  v_recompra boolean;
  c jsonb;
  v_venta uuid;
  v_actividad uuid;
  v_pend uuid;
  v_resultado jsonb;
begin
  perform public.crm_exigir_admin(p_actor_rol, p_actor_usuario);
  v_previa := public.crm_operacion_previa(p_clave, p_huella, p_actor_rol);
  if v_previa is not null then
    if v_previa -> 'oportunidad' ->> 'id' is distinct from p_oportunidad::text then
      raise exception 'clave_reutilizada' using errcode = '22023';
    end if;
    return v_previa;
  end if;
  if jsonb_typeof(v_datos) <> 'object' then
    raise exception 'datos_invalidos:datos' using errcode = '22023';
  end if;
  perform public.crm_claves_permitidas(v_datos, array['producto', 'fecha_acuerdo', 'experiencias', 'duracion_minutos', 'importe',
    'importe_confirmado', 'comision', 'observacion']);
  select * into o from public.crm_oportunidades where id = p_oportunidad for update;
  if not found then
    raise exception 'oportunidad_no_encontrada' using errcode = 'P0002';
  end if;
  if p_version is null or o.version <> p_version then
    raise exception 'version_desactualizada' using errcode = '40001';
  end if;
  if o.estado = 'ganada' then
    raise exception 'oportunidad_ganada' using errcode = '55000';
  elsif o.estado = 'pausada' then
    raise exception 'oportunidad_pausada' using errcode = '55000';
  elsif o.estado = 'perdida' then
    raise exception 'oportunidad_perdida' using errcode = '55000';
  elsif o.cerrada_en is not null then
    raise exception 'oportunidad_cerrada' using errcode = '55000';
  end if;
  e := public.crm_empresa_para_actor(o.empresa_id, p_actor_rol, p_actor_usuario);
  v_hoy := public.crm_fecha_sim(v_ahora);
  select * into p from public.crm_productos where codigo = public.crm_texto(v_datos, 'producto', 20) and activo;
  if not found then
    raise exception 'datos_invalidos:producto' using errcode = '22023';
  end if;
  v_fecha := coalesce(public.crm_fecha(v_datos, 'fecha_acuerdo'), v_hoy);
  if v_fecha > v_hoy or v_fecha < public.crm_fecha_sim(o.ciclo_inicio_en) then
    raise exception 'datos_invalidos:fecha_acuerdo' using errcode = '22023';
  end if;
  v_exp := coalesce(public.crm_entero(v_datos, 'experiencias', 100000), p.experiencias);
  v_dur := coalesce(public.crm_entero(v_datos, 'duracion_minutos', 600), p.duracion_minutos);
  if p.codigo <> 'personalizado' and (v_exp is distinct from p.experiencias or v_dur is distinct from p.duracion_minutos) then
    raise exception 'datos_invalidos:experiencias' using errcode = '22023';
  end if;
  if p.codigo = 'personalizado' and (v_exp is null or v_exp < p.minimo_experiencias or v_dur is null or v_dur < 1) then
    raise exception 'datos_invalidos:experiencias' using errcode = '22023';
  end if;
  v_importe := coalesce(public.crm_importe(v_datos, 'importe', 0.01, 9999999999.99), p.precio);
  if v_importe is null then
    raise exception 'datos_invalidos:importe' using errcode = '22023';
  end if;
  if p.codigo <> 'personalizado' and v_importe <> p.precio and not coalesce(public.crm_bool(v_datos, 'importe_confirmado'), false) then
    raise exception 'confirmar_importe' using errcode = '55000';
  end if;
  v_recompra := e.cliente_previo or exists (select 1 from public.crm_ventas where empresa_id = o.empresa_id and anulada_en is null);
  c := public.crm_venta_comision(v_datos -> 'comision', o, v_recompra, p, v_importe);
  insert into public.crm_ventas (oportunidad_id, empresa_id, ciclo, es_recompra, fecha_acuerdo, producto_codigo, producto_nombre, experiencias,
    duracion_minutos, importe, precio_catalogo, comision_catalogo, comision_tipo, comision_importe, comision_beneficiario_id, comision_fundamento,
    comision_detalle, comision_intervencion_visita_id, comision_intervencion_actividad_id, observacion, operacion_clave)
  values (o.id, o.empresa_id, o.ciclo, v_recompra, v_fecha, p.codigo, p.nombre, v_exp, v_dur, v_importe, p.precio, p.comision_estandar,
    c ->> 'tipo', (c ->> 'importe')::numeric, (c ->> 'beneficiario_id')::uuid, c ->> 'fundamento', c ->> 'detalle',
    (c ->> 'intervencion_visita_id')::uuid, (c ->> 'intervencion_actividad_id')::uuid, public.crm_texto(v_datos, 'observacion', 1000), p_clave)
  returning id into v_venta;
  insert into public.crm_actividades (oportunidad_id, ciclo, tipo, ocurrida_en, actor_rol, actor_usuario_id, observacion, estado_antes,
    estado_despues, operacion_clave)
  values (o.id, o.ciclo, 'cambio_estado', v_ahora, 'admin', null, 'Venta registrada: ' || p.nombre, o.estado, 'ganada', p_clave)
  returning id into v_actividad;
  update public.crm_seguimientos set estado = 'cancelada', cancelada_motivo = 'ganada', cerrada_en = v_ahora, version = version + 1
   where oportunidad_id = o.id and estado = 'pendiente'
  returning id into v_pend;
  update public.crm_oportunidades
     set estado = 'ganada', estado_al_ganar = o.estado, ganada_en = v_ahora, cerrada_en = v_ahora, cierre_motivo = 'ganada',
         gestionada_en = coalesce(gestionada_en, v_ahora), version = version + 1, actualizada_en = v_ahora
   where id = o.id;
  perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_ventas', v_venta, 'creacion', jsonb_build_object(
    'oportunidad_id', o.id, 'producto', p.codigo, 'importe', v_importe, 'es_recompra', v_recompra,
    'comision_tipo', c ->> 'tipo', 'comision_fundamento', c ->> 'fundamento', 'comision_importe', c ->> 'importe',
    'comision_beneficiario_id', c ->> 'beneficiario_id'));
  perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_oportunidades', o.id, 'ganada', jsonb_build_object(
    'venta_id', v_venta, 'estado_antes', o.estado, 'actividad_id', v_actividad, 'seguimiento_cancelado', v_pend));
  select jsonb_build_object('resultado', 'ok', 'repetida', false,
           'venta', jsonb_build_object('id', v_venta, 'version', 1),
           'oportunidad', jsonb_build_object('id', o.id, 'estado', 'ganada', 'version', x.version))
    into v_resultado from public.crm_oportunidades x where x.id = o.id;
  insert into public.crm_operaciones (clave, huella, actor_rol, actor_usuario_id, oportunidad_id, accion, resultado)
  values (p_clave, p_huella, p_actor_rol, p_actor_usuario, o.id, 'venta', v_resultado);
  return v_resultado;
end
$fn$;

-- ── 8. RPC: todo lo que se hace sobre una venta (solo admin) ───────────────
-- p_accion: cobro · anular_cobro · pago_comision · anular_pago_comision ·
-- corregir · anular · entrega · vincular_campania. Los cobros y pagos no exigen
-- la versión (son sumas protegidas por el bloqueo de la venta); el resto, sí.
create or replace function public.crm_venta_gestionar(p_clave uuid, p_huella text, p_venta uuid, p_version integer, p_accion text,
  p_datos jsonb, p_actor_rol text, p_actor_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  s public.crm_ventas%rowtype;
  o public.crm_oportunidades%rowtype;
  p public.crm_productos%rowtype;
  x public.crm_cobros%rowtype;
  y public.crm_comision_pagos%rowtype;
  v_previa jsonb;
  v_datos jsonb := coalesce(p_datos, '{}'::jsonb);
  v_ahora timestamptz := now();
  v_hoy date;
  v_fecha date;
  v_importe numeric;
  v_cobrado numeric;
  v_pagado numeric;
  v_motivo text;
  v_id uuid;
  v_texto text;
  v_cambios jsonb;
  c jsonb;
  v_exp integer;
  v_dur integer;
  v_campania uuid;
  v_actividad uuid;
  v_resultado jsonb;
begin
  perform public.crm_exigir_admin(p_actor_rol, p_actor_usuario);
  v_previa := public.crm_operacion_previa(p_clave, p_huella, p_actor_rol);
  if v_previa is not null then
    if v_previa -> 'venta' ->> 'id' is distinct from p_venta::text then
      raise exception 'clave_reutilizada' using errcode = '22023';
    end if;
    return v_previa;
  end if;
  if jsonb_typeof(v_datos) <> 'object' then
    raise exception 'datos_invalidos:datos' using errcode = '22023';
  end if;
  select * into s from public.crm_ventas where id = p_venta for update;
  if not found then
    raise exception 'venta_no_encontrada' using errcode = 'P0002';
  end if;
  if s.anulada_en is not null then
    raise exception 'venta_anulada' using errcode = '55000';
  end if;
  if p_accion not in ('cobro', 'pago_comision') and (p_version is null or s.version <> p_version) then
    raise exception 'version_desactualizada' using errcode = '40001';
  end if;
  v_hoy := public.crm_fecha_sim(v_ahora);
  v_cobrado := public.crm_venta_cobrado(s.id);
  v_pagado := public.crm_venta_comision_pagada(s.id);
  v_motivo := public.crm_texto(v_datos, 'motivo', 300);

  if p_accion = 'cobro' then
    perform public.crm_claves_permitidas(v_datos, array['fecha_efectiva', 'importe', 'medio', 'referencia', 'concepto', 'confirmar_duplicado']);
    v_fecha := public.crm_fecha(v_datos, 'fecha_efectiva');
    if v_fecha is null or v_fecha > v_hoy or v_fecha < s.fecha_acuerdo then
      raise exception 'datos_invalidos:fecha_efectiva' using errcode = '22023';
    end if;
    v_importe := public.crm_importe(v_datos, 'importe', 0.01, 9999999999.99);
    if v_importe is null then
      raise exception 'datos_invalidos:importe' using errcode = '22023';
    end if;
    if v_cobrado + v_importe > s.importe then
      raise exception 'cobro_excede_saldo' using errcode = '55000';
    end if;
    if public.crm_texto(v_datos, 'medio', 20) is null or public.crm_texto(v_datos, 'concepto', 20) is null then
      raise exception 'datos_invalidos:medio' using errcode = '22023';
    end if;
    if not coalesce(public.crm_bool(v_datos, 'confirmar_duplicado'), false) and exists (select 1 from public.crm_cobros
       where venta_id = s.id and anulado_en is null and importe = v_importe and fecha_efectiva = v_fecha) then
      return jsonb_build_object('resultado', 'posible_duplicado', 'venta', jsonb_build_object('id', s.id, 'version', s.version));
    end if;
    begin
      insert into public.crm_cobros (venta_id, fecha_efectiva, importe, medio, referencia, concepto, operacion_clave)
      values (s.id, v_fecha, v_importe, public.crm_texto(v_datos, 'medio', 20), public.crm_texto(v_datos, 'referencia', 120),
        public.crm_texto(v_datos, 'concepto', 20), p_clave)
      returning id into v_id;
    exception when check_violation then
      raise exception 'datos_invalidos:medio' using errcode = '22023';
    end;
    perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_cobros', v_id, 'cobro', jsonb_build_object(
      'venta_id', s.id, 'importe', v_importe, 'fecha_efectiva', v_fecha, 'concepto', public.crm_texto(v_datos, 'concepto', 20)));

  elsif p_accion = 'anular_cobro' then
    perform public.crm_claves_permitidas(v_datos, array['cobro_id', 'motivo']);
    if v_motivo is null then
      raise exception 'datos_invalidos:motivo' using errcode = '22023';
    end if;
    select * into x from public.crm_cobros where id = public.crm_uuid(v_datos, 'cobro_id') and venta_id = s.id for update;
    if not found then
      raise exception 'cobro_no_encontrado' using errcode = 'P0002';
    end if;
    if x.anulado_en is not null then
      raise exception 'sin_cambio' using errcode = '55000';
    end if;
    update public.crm_cobros set anulado_en = v_ahora, anulado_motivo = v_motivo where id = x.id;
    v_id := x.id;
    perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_cobros', x.id, 'anulacion', jsonb_build_object(
      'venta_id', s.id, 'importe', x.importe, 'motivo', v_motivo, 'pagos_comision_vigentes', v_pagado));

  elsif p_accion = 'pago_comision' then
    perform public.crm_claves_permitidas(v_datos, array['fecha', 'importe', 'referencia']);
    if s.comision_tipo <> 'pactada' then
      raise exception 'comision_no_corresponde' using errcode = '55000';
    end if;
    if v_cobrado < s.importe then
      raise exception 'comision_no_generada' using errcode = '55000';
    end if;
    if v_pagado > s.comision_importe or exists (select 1 from public.crm_comision_pagos
       where venta_id = s.id and anulado_en is null and beneficiario_id <> s.comision_beneficiario_id) then
      raise exception 'comision_a_revisar' using errcode = '55000';
    end if;
    v_fecha := public.crm_fecha(v_datos, 'fecha');
    if v_fecha is null or v_fecha > v_hoy or v_fecha < s.fecha_acuerdo then
      raise exception 'datos_invalidos:fecha' using errcode = '22023';
    end if;
    v_importe := public.crm_importe(v_datos, 'importe', 0.01, 9999999999.99);
    if v_importe is null then
      raise exception 'datos_invalidos:importe' using errcode = '22023';
    end if;
    if v_pagado + v_importe > s.comision_importe then
      raise exception 'pago_excede_comision' using errcode = '55000';
    end if;
    insert into public.crm_comision_pagos (venta_id, beneficiario_id, fecha, importe, referencia, operacion_clave)
    values (s.id, s.comision_beneficiario_id, v_fecha, v_importe, public.crm_texto(v_datos, 'referencia', 120), p_clave)
    returning id into v_id;
    perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_comision_pagos', v_id, 'pago_comision', jsonb_build_object(
      'venta_id', s.id, 'importe', v_importe, 'fecha', v_fecha, 'beneficiario_id', s.comision_beneficiario_id));

  elsif p_accion = 'anular_pago_comision' then
    perform public.crm_claves_permitidas(v_datos, array['pago_id', 'motivo']);
    if v_motivo is null then
      raise exception 'datos_invalidos:motivo' using errcode = '22023';
    end if;
    select * into y from public.crm_comision_pagos where id = public.crm_uuid(v_datos, 'pago_id') and venta_id = s.id for update;
    if not found then
      raise exception 'pago_no_encontrado' using errcode = 'P0002';
    end if;
    if y.anulado_en is not null then
      raise exception 'sin_cambio' using errcode = '55000';
    end if;
    update public.crm_comision_pagos set anulado_en = v_ahora, anulado_motivo = v_motivo where id = y.id;
    v_id := y.id;
    perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_comision_pagos', y.id, 'anulacion', jsonb_build_object(
      'venta_id', s.id, 'importe', y.importe, 'motivo', v_motivo));

  elsif p_accion = 'corregir' then
    perform public.crm_claves_permitidas(v_datos, array['motivo', 'cambios']);
    if v_motivo is null then
      raise exception 'datos_invalidos:motivo' using errcode = '22023';
    end if;
    v_cambios := coalesce(v_datos -> 'cambios', '{}'::jsonb);
    perform public.crm_claves_permitidas(v_cambios, array['fecha_acuerdo', 'experiencias', 'duracion_minutos', 'importe', 'importe_confirmado',
      'comision', 'observacion']);
    if (select count(*) from jsonb_object_keys(v_cambios)) = 0 then
      raise exception 'sin_cambio' using errcode = '55000';
    end if;
    select * into o from public.crm_oportunidades where id = s.oportunidad_id;
    p := (s.producto_codigo, s.producto_nombre, s.experiencias, null, s.duracion_minutos, s.precio_catalogo, s.comision_catalogo, true, 0, 1, now())::public.crm_productos;
    if s.producto_codigo = 'personalizado' then
      p.minimo_experiencias := (select minimo_experiencias from public.crm_productos where codigo = 'personalizado');
      p.experiencias := null;
    end if;
    v_fecha := case when v_cambios ? 'fecha_acuerdo' then public.crm_fecha(v_cambios, 'fecha_acuerdo') else s.fecha_acuerdo end;
    if v_fecha is null or v_fecha > v_hoy or v_fecha > coalesce((select min(fecha_efectiva) from public.crm_cobros where venta_id = s.id and anulado_en is null), v_fecha) then
      raise exception 'datos_invalidos:fecha_acuerdo' using errcode = '22023';
    end if;
    v_exp := case when v_cambios ? 'experiencias' then public.crm_entero(v_cambios, 'experiencias', 100000) else s.experiencias end;
    v_dur := case when v_cambios ? 'duracion_minutos' then public.crm_entero(v_cambios, 'duracion_minutos', 600) else s.duracion_minutos end;
    if s.producto_codigo <> 'personalizado' and (v_exp is distinct from s.experiencias or v_dur is distinct from s.duracion_minutos) then
      raise exception 'datos_invalidos:experiencias' using errcode = '22023';
    end if;
    if s.producto_codigo = 'personalizado' and (v_exp is null or v_exp < p.minimo_experiencias or v_dur is null or v_dur < 1) then
      raise exception 'datos_invalidos:experiencias' using errcode = '22023';
    end if;
    v_importe := case when v_cambios ? 'importe' then public.crm_importe(v_cambios, 'importe', 0.01, 9999999999.99) else s.importe end;
    if v_importe is null then
      raise exception 'datos_invalidos:importe' using errcode = '22023';
    end if;
    if v_importe < v_cobrado then
      raise exception 'importe_menor_que_cobrado' using errcode = '55000';
    end if;
    if s.producto_codigo <> 'personalizado' and v_importe <> s.precio_catalogo and v_importe <> s.importe
       and not coalesce(public.crm_bool(v_cambios, 'importe_confirmado'), false) then
      raise exception 'confirmar_importe' using errcode = '55000';
    end if;
    if v_importe <> s.importe and not (v_cambios ? 'comision') then
      raise exception 'confirmar_comision' using errcode = '55000';
    end if;
    if v_cambios ? 'comision' then
      c := public.crm_venta_comision(v_cambios -> 'comision', o, s.es_recompra, p, v_importe);
      if not coalesce(public.crm_bool(v_cambios -> 'comision', 'confirmada'), false) then
        raise exception 'confirmar_comision' using errcode = '55000';
      end if;
    else
      c := jsonb_build_object('tipo', s.comision_tipo, 'fundamento', s.comision_fundamento, 'detalle', s.comision_detalle,
        'importe', s.comision_importe, 'beneficiario_id', s.comision_beneficiario_id, 'intervencion_visita_id', s.comision_intervencion_visita_id,
        'intervencion_actividad_id', s.comision_intervencion_actividad_id);
    end if;
    update public.crm_ventas
       set fecha_acuerdo = v_fecha, experiencias = v_exp, duracion_minutos = v_dur, importe = v_importe,
           comision_tipo = c ->> 'tipo', comision_importe = (c ->> 'importe')::numeric, comision_beneficiario_id = (c ->> 'beneficiario_id')::uuid,
           comision_fundamento = c ->> 'fundamento', comision_detalle = c ->> 'detalle',
           comision_intervencion_visita_id = (c ->> 'intervencion_visita_id')::uuid,
           comision_intervencion_actividad_id = (c ->> 'intervencion_actividad_id')::uuid,
           observacion = case when v_cambios ? 'observacion' then public.crm_texto(v_cambios, 'observacion', 1000) else observacion end,
           version = version + 1, actualizada_en = v_ahora
     where id = s.id;
    perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_ventas', s.id, 'correccion', jsonb_build_object(
      'motivo', v_motivo,
      'antes', jsonb_build_object('fecha_acuerdo', s.fecha_acuerdo, 'experiencias', s.experiencias, 'duracion_minutos', s.duracion_minutos,
        'importe', s.importe, 'comision_tipo', s.comision_tipo, 'comision_importe', s.comision_importe,
        'comision_beneficiario_id', s.comision_beneficiario_id, 'comision_fundamento', s.comision_fundamento),
      'despues', jsonb_build_object('fecha_acuerdo', v_fecha, 'experiencias', v_exp, 'duracion_minutos', v_dur, 'importe', v_importe,
        'comision_tipo', c ->> 'tipo', 'comision_importe', c ->> 'importe', 'comision_beneficiario_id', c ->> 'beneficiario_id',
        'comision_fundamento', c ->> 'fundamento'),
      'pagos_comision_vigentes', v_pagado));

  elsif p_accion = 'anular' then
    perform public.crm_claves_permitidas(v_datos, array['motivo']);
    if v_motivo is null then
      raise exception 'datos_invalidos:motivo' using errcode = '22023';
    end if;
    if v_cobrado > 0 then
      raise exception 'venta_con_cobros' using errcode = '55000';
    end if;
    if v_pagado > 0 then
      raise exception 'venta_con_pagos_comision' using errcode = '55000';
    end if;
    select * into o from public.crm_oportunidades where id = s.oportunidad_id for update;
    perform public.crm_empresa_para_actor(o.empresa_id, p_actor_rol, p_actor_usuario);
    if exists (select 1 from public.crm_oportunidades where empresa_id = o.empresa_id and cerrada_en is null and id <> o.id) then
      raise exception 'otra_oportunidad_abierta' using errcode = '55000';
    end if;
    update public.crm_ventas set anulada_en = v_ahora, anulada_motivo = v_motivo, version = version + 1, actualizada_en = v_ahora where id = s.id;
    update public.crm_oportunidades
       set estado = o.estado_al_ganar, estado_al_ganar = null, ganada_en = null, cerrada_en = null, cierre_motivo = null,
           version = version + 1, actualizada_en = v_ahora
     where id = o.id;
    insert into public.crm_actividades (oportunidad_id, ciclo, tipo, ocurrida_en, actor_rol, actor_usuario_id, estado_antes, estado_despues,
      motivo, operacion_clave)
    values (o.id, o.ciclo, 'cambio_estado', v_ahora, 'admin', null, 'ganada', o.estado_al_ganar, 'Venta anulada: ' || v_motivo, p_clave)
    returning id into v_actividad;
    perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_ventas', s.id, 'anulacion', jsonb_build_object(
      'motivo', v_motivo, 'oportunidad_id', o.id, 'estado_restituido', o.estado_al_ganar, 'campania_id', s.campania_id));
    perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_oportunidades', o.id, 'cambio_estado', jsonb_build_object(
      'antes', 'ganada', 'despues', o.estado_al_ganar, 'motivo', 'venta anulada', 'actividad_id', v_actividad));

  elsif p_accion = 'entrega' then
    perform public.crm_claves_permitidas(v_datos, array['estado', 'fecha', 'detalle']);
    v_texto := public.crm_texto(v_datos, 'estado', 20);
    if v_texto = 'entregada' then
      v_fecha := public.crm_fecha(v_datos, 'fecha');
      if v_fecha is null or v_fecha > v_hoy or v_fecha < s.fecha_acuerdo then
        raise exception 'datos_invalidos:fecha' using errcode = '22023';
      end if;
    elsif v_texto = 'pendiente' then
      v_fecha := null;
    else
      raise exception 'datos_invalidos:estado' using errcode = '22023';
    end if;
    update public.crm_ventas set entrega_estado = v_texto, entrega_fecha = v_fecha, entrega_detalle = public.crm_texto(v_datos, 'detalle', 300),
           version = version + 1, actualizada_en = v_ahora
     where id = s.id;
    perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_ventas', s.id, 'entrega', jsonb_build_object(
      'antes', s.entrega_estado, 'despues', v_texto, 'fecha', v_fecha));

  elsif p_accion = 'vincular_campania' then
    perform public.crm_claves_permitidas(v_datos, array['campania_id']);
    v_campania := public.crm_uuid(v_datos, 'campania_id');
    if v_campania is not null then
      if not exists (select 1 from public.empresa_campanias where id = v_campania and deleted_at is null) then
        raise exception 'campania_no_encontrada' using errcode = 'P0002';
      end if;
      if exists (select 1 from public.crm_ventas where campania_id = v_campania and anulada_en is null and id <> s.id) then
        raise exception 'campania_vinculada' using errcode = '55000';
      end if;
    end if;
    if v_campania is not distinct from s.campania_id then
      raise exception 'sin_cambio' using errcode = '55000';
    end if;
    update public.crm_ventas set campania_id = v_campania, campania_vinculada_en = case when v_campania is null then null else v_ahora end,
           version = version + 1, actualizada_en = v_ahora
     where id = s.id;
    perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_ventas', s.id, 'vinculo_campania', jsonb_build_object(
      'antes', s.campania_id, 'despues', v_campania));

  else
    raise exception 'datos_invalidos:accion' using errcode = '22023';
  end if;

  select jsonb_build_object('resultado', 'ok', 'repetida', false, 'id', v_id,
           'venta', jsonb_build_object('id', z.id, 'version', z.version, 'cobrado', public.crm_venta_cobrado(z.id),
             'comision_pagada', public.crm_venta_comision_pagada(z.id), 'anulada', z.anulada_en is not null))
    into v_resultado from public.crm_ventas z where z.id = s.id;
  insert into public.crm_operaciones (clave, huella, actor_rol, actor_usuario_id, oportunidad_id, accion, resultado)
  values (p_clave, p_huella, p_actor_rol, p_actor_usuario, s.oportunidad_id, p_accion, v_resultado);
  return v_resultado;
end
$fn$;

-- ── 9. RPC: oportunidad de recompra con un contacto existente (solo admin) ─
create or replace function public.crm_oportunidad_recompra(p_clave uuid, p_huella text, p_empresa uuid, p_datos jsonb,
  p_actor_rol text, p_actor_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  e public.crm_empresas%rowtype;
  v_previa jsonb;
  v_datos jsonb := coalesce(p_datos, '{}'::jsonb);
  v_ahora timestamptz := now();
  v_contacto uuid;
  v_vence date;
  v_obs text;
  v_opp uuid;
  v_resultado jsonb;
begin
  perform public.crm_exigir_admin(p_actor_rol, p_actor_usuario);
  v_previa := public.crm_operacion_previa(p_clave, p_huella, p_actor_rol);
  if v_previa is not null then
    if v_previa ->> 'empresa_id' is distinct from p_empresa::text then
      raise exception 'clave_reutilizada' using errcode = '22023';
    end if;
    return v_previa;
  end if;
  if jsonb_typeof(v_datos) <> 'object' then
    raise exception 'datos_invalidos:datos' using errcode = '22023';
  end if;
  perform public.crm_claves_permitidas(v_datos, array['contacto_id', 'observacion', 'proxima']);
  e := public.crm_empresa_para_actor(p_empresa, p_actor_rol, p_actor_usuario);
  if e.archivada_en is not null then
    raise exception 'empresa_archivada' using errcode = '55000';
  end if;
  if not e.cliente_previo and not exists (select 1 from public.crm_ventas where empresa_id = e.id and anulada_en is null) then
    raise exception 'sin_compras_previas' using errcode = '55000';
  end if;
  if exists (select 1 from public.crm_oportunidades where empresa_id = e.id and cerrada_en is null) then
    raise exception 'otra_oportunidad_abierta' using errcode = '55000';
  end if;
  v_contacto := public.crm_uuid(v_datos, 'contacto_id');
  if v_contacto is null or not exists (select 1 from public.crm_contactos where id = v_contacto and empresa_id = e.id and archivado_en is null) then
    raise exception 'contacto_no_encontrado' using errcode = 'P0002';
  end if;
  v_obs := public.crm_texto(v_datos, 'observacion', 1000);
  if v_datos ? 'proxima' and jsonb_typeof(v_datos -> 'proxima') <> 'null' then
    perform public.crm_claves_permitidas(v_datos -> 'proxima', array['vence_el', 'descripcion']);
    v_vence := public.crm_fecha(v_datos -> 'proxima', 'vence_el');
    if v_vence is null or v_vence < public.crm_fecha_sim(v_ahora) then
      raise exception 'datos_invalidos:vence_el' using errcode = '22023';
    end if;
  end if;
  insert into public.crm_oportunidades (empresa_id, estado, origen_tipo, origen_visita_id, origen_usuario_id, contacto_id, lead_en,
    ciclo, ciclo_inicio_en, ciclo_estado_inicial, gestionada_en)
  values (e.id, 'contacto', 'recompra_admin', null, null, v_contacto, v_ahora, 1, v_ahora, 'contacto', v_ahora)
  returning id into v_opp;
  if v_obs is not null then
    insert into public.crm_actividades (oportunidad_id, ciclo, tipo, contacto_id, ocurrida_en, actor_rol, actor_usuario_id, observacion, operacion_clave)
    values (v_opp, 1, 'nota', v_contacto, v_ahora, 'admin', null, v_obs, p_clave);
  end if;
  if v_vence is not null then
    insert into public.crm_seguimientos (oportunidad_id, ciclo, tipo, vence_el, descripcion, operacion_clave)
    values (v_opp, 1, 'seguimiento', v_vence, public.crm_texto(v_datos -> 'proxima', 'descripcion', 140), p_clave);
  end if;
  perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_oportunidades', v_opp, 'creacion', jsonb_build_object(
    'empresa_id', e.id, 'origen', 'recompra_admin', 'contacto_id', v_contacto));
  v_resultado := jsonb_build_object('resultado', 'ok', 'repetida', false, 'empresa_id', e.id,
    'oportunidad', jsonb_build_object('id', v_opp, 'estado', 'contacto', 'version', 1));
  insert into public.crm_operaciones (clave, huella, actor_rol, actor_usuario_id, oportunidad_id, accion, resultado)
  values (p_clave, p_huella, p_actor_rol, p_actor_usuario, v_opp, 'recompra', v_resultado);
  return v_resultado;
end
$fn$;

-- ── 10. RPC: catálogo de productos (solo admin; no toca ventas anteriores) ─
create or replace function public.crm_producto_actualizar(p_codigo text, p_version integer, p_cambios jsonb, p_actor_rol text, p_actor_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  p public.crm_productos%rowtype;
  v_cambios jsonb := coalesce(p_cambios, '{}'::jsonb);
begin
  perform public.crm_exigir_admin(p_actor_rol, p_actor_usuario);
  perform public.crm_claves_permitidas(v_cambios, array['nombre', 'precio', 'comision_estandar', 'activo']);
  select * into p from public.crm_productos where codigo = p_codigo for update;
  if not found then
    raise exception 'no_encontrado' using errcode = 'P0002';
  end if;
  if p.version <> p_version then
    raise exception 'version_desactualizada' using errcode = '40001';
  end if;
  if p.codigo = 'personalizado' and (v_cambios ? 'precio' or v_cambios ? 'comision_estandar') then
    raise exception 'datos_invalidos:precio' using errcode = '22023';
  end if;
  update public.crm_productos
     set nombre = coalesce(public.crm_texto(v_cambios, 'nombre', 60), nombre),
         precio = case when v_cambios ? 'precio' then public.crm_importe(v_cambios, 'precio', 0.01, 9999999999.99) else precio end,
         comision_estandar = case when v_cambios ? 'comision_estandar' then public.crm_importe(v_cambios, 'comision_estandar', 0, 9999999999.99) else comision_estandar end,
         activo = coalesce(public.crm_bool(v_cambios, 'activo'), activo),
         version = version + 1, actualizado_en = now()
   where codigo = p.codigo
  returning * into p;
  if p.codigo <> 'personalizado' and (p.precio is null or p.comision_estandar is null) then
    raise exception 'datos_invalidos:precio' using errcode = '22023';
  end if;
  perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_productos', gen_random_uuid(), 'actualizacion', jsonb_build_object(
    'codigo', p.codigo, 'cambios', v_cambios));
  return jsonb_build_object('codigo', p.codigo, 'version', p.version);
end
$fn$;

-- ── 11. Redefinidas de B2: gestión, visitas y anulación de visitas ─────────
-- La gestión no toca una oportunidad ganada (salvo una nota o el contacto principal).
create or replace function public.crm_oportunidad_gestionar(p_clave uuid, p_huella text, p_oportunidad uuid, p_version integer, p_accion text,
  p_datos jsonb, p_actor_rol text, p_actor_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  o public.crm_oportunidades%rowtype;
  v_op public.crm_operaciones%rowtype;
  v_pend public.crm_seguimientos%rowtype;
  v_hay_pend boolean;
  v_ahora timestamptz := now();
  v_hoy date;
  v_datos jsonb := coalesce(p_datos, '{}'::jsonb);
  v_tipo text;
  v_ocurrida timestamptz;
  v_obs text;
  v_motivo text;
  v_detalle text;
  v_contacto uuid;
  v_nuevo text;
  v_destino text;
  v_actividad uuid;
  v_resolver uuid;
  v_vence date;
  v_desc text;
  v_seg uuid;
  v_resultado jsonb;
begin
  perform public.crm_exigir_admin(p_actor_rol, p_actor_usuario);
  if p_clave is null or p_huella is null or p_huella !~ '^[0-9a-f]{64}$' or p_oportunidad is null then
    raise exception 'datos_invalidos:clave' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('crm_operacion:' || p_clave::text, 0));
  select * into v_op from public.crm_operaciones where clave = p_clave;
  if found then
    if v_op.huella <> p_huella or v_op.actor_rol <> p_actor_rol or v_op.oportunidad_id <> p_oportunidad then
      raise exception 'clave_reutilizada' using errcode = '22023';
    end if;
    return v_op.resultado || jsonb_build_object('repetida', true);
  end if;
  if jsonb_typeof(v_datos) <> 'object' then
    raise exception 'datos_invalidos:datos' using errcode = '22023';
  end if;
  select * into o from public.crm_oportunidades where id = p_oportunidad for update;
  if not found then
    raise exception 'oportunidad_no_encontrada' using errcode = 'P0002';
  end if;
  if p_version is null or o.version <> p_version then
    raise exception 'version_desactualizada' using errcode = '40001';
  end if;
  if o.estado = 'ganada' and not (p_accion = 'contacto_principal' or (p_accion = 'gestion' and v_datos ->> 'tipo' = 'nota'
     and not (v_datos ? 'proxima' and jsonb_typeof(v_datos -> 'proxima') <> 'null') and not (v_datos ? 'resolver'))) then
    raise exception 'oportunidad_ganada' using errcode = '55000';
  end if;
  v_hoy := public.crm_fecha_sim(v_ahora);
  select * into v_pend from public.crm_seguimientos where oportunidad_id = o.id and estado = 'pendiente' for update;
  v_hay_pend := found;

  if p_accion = 'gestion' then
    perform public.crm_claves_permitidas(v_datos, array['tipo', 'contacto_id', 'ocurrida_en', 'observacion', 'estado', 'motivo', 'resolver', 'proxima']);
    v_tipo := public.crm_texto(v_datos, 'tipo', 30);
    if v_tipo is null or v_tipo not in ('whatsapp_enviado', 'respondio', 'no_respondio', 'llamada', 'nota', 'propuesta_enviada',
       'inicio_negociacion', 'cambio_estado') then
      raise exception 'datos_invalidos:tipo' using errcode = '22023';
    end if;
    if o.estado = 'perdida' and (v_tipo <> 'nota' or (v_datos ? 'proxima' and jsonb_typeof(v_datos -> 'proxima') <> 'null')) then
      raise exception 'oportunidad_perdida' using errcode = '55000';
    end if;
    if o.estado = 'pausada' and (v_tipo in ('inicio_negociacion', 'cambio_estado') or (v_datos ? 'proxima' and jsonb_typeof(v_datos -> 'proxima') <> 'null')) then
      raise exception 'oportunidad_pausada' using errcode = '55000';
    end if;
    v_obs := public.crm_texto(v_datos, 'observacion', 1000);
    if v_tipo = 'nota' and v_obs is null then
      raise exception 'datos_invalidos:observacion' using errcode = '22023';
    end if;
    begin
      v_ocurrida := coalesce((v_datos ->> 'ocurrida_en')::timestamptz, v_ahora);
    exception when others then
      raise exception 'datos_invalidos:ocurrida_en' using errcode = '22023';
    end;
    if v_ocurrida > v_ahora + interval '2 minutes' or v_ocurrida < o.ciclo_inicio_en then
      raise exception 'datos_invalidos:ocurrida_en' using errcode = '22023';
    end if;
    v_contacto := public.crm_uuid(v_datos, 'contacto_id');
    if v_contacto is not null and not exists (select 1 from public.crm_contactos where id = v_contacto and empresa_id = o.empresa_id) then
      raise exception 'contacto_no_encontrado' using errcode = 'P0002';
    end if;
    v_motivo := public.crm_texto(v_datos, 'motivo', 300);
    v_nuevo := o.estado;
    if v_tipo = 'respondio' and o.estado = 'contacto' then
      v_nuevo := 'conversacion';
    elsif v_tipo = 'inicio_negociacion' and public.crm_rango_estado(o.estado) < 4 then
      v_nuevo := 'negociacion';
    elsif v_tipo = 'cambio_estado' then
      v_destino := public.crm_texto(v_datos, 'estado', 20);
      if v_destino is null or public.crm_rango_estado(v_destino) is null then
        raise exception 'datos_invalidos:estado' using errcode = '22023';
      end if;
      if v_destino = o.estado then
        raise exception 'sin_cambio' using errcode = '55000';
      end if;
      if public.crm_rango_estado(v_destino) < public.crm_rango_estado(o.estado) and v_motivo is null then
        raise exception 'datos_invalidos:motivo' using errcode = '22023';
      end if;
      v_nuevo := v_destino;
    elsif v_datos ? 'estado' then
      raise exception 'datos_invalidos:estado' using errcode = '22023';
    end if;
    v_resolver := public.crm_uuid(v_datos, 'resolver');
    if v_resolver is not null then
      if not v_hay_pend or v_pend.id <> v_resolver then
        raise exception 'seguimiento_no_vigente' using errcode = '55000';
      end if;
      if v_tipo = 'nota' or v_pend.tipo = 'retomar' then
        raise exception 'datos_invalidos:resolver' using errcode = '22023';
      end if;
    end if;
    if v_datos ? 'proxima' and jsonb_typeof(v_datos -> 'proxima') <> 'null' then
      perform public.crm_claves_permitidas(v_datos -> 'proxima', array['vence_el', 'descripcion']);
      v_vence := public.crm_fecha(v_datos -> 'proxima', 'vence_el');
      if v_vence is null or v_vence < v_hoy then
        raise exception 'datos_invalidos:vence_el' using errcode = '22023';
      end if;
      if v_hay_pend and v_resolver is null then
        raise exception 'seguimiento_pendiente' using errcode = '55000';
      end if;
      v_desc := public.crm_texto(v_datos -> 'proxima', 'descripcion', 140);
    end if;
    insert into public.crm_actividades (oportunidad_id, ciclo, tipo, contacto_id, ocurrida_en, actor_rol, actor_usuario_id, observacion,
      estado_antes, estado_despues, motivo, operacion_clave)
    values (o.id, o.ciclo, v_tipo, v_contacto, v_ocurrida, 'admin', null, v_obs,
      case when v_nuevo <> o.estado then o.estado end, case when v_nuevo <> o.estado then v_nuevo end, v_motivo, p_clave)
    returning id into v_actividad;
    update public.crm_oportunidades
       set estado = v_nuevo,
           conversacion_en = case when v_nuevo = 'conversacion' and v_nuevo <> o.estado then least(conversacion_en, v_ocurrida) else conversacion_en end,
           interesado_en = case when v_nuevo = 'interesado' and v_nuevo <> o.estado then least(interesado_en, v_ocurrida) else interesado_en end,
           negociacion_en = case when v_nuevo = 'negociacion' and v_nuevo <> o.estado then least(negociacion_en, v_ocurrida) else negociacion_en end,
           propuesta_en = case when v_tipo = 'propuesta_enviada' then least(propuesta_en, v_ocurrida) else propuesta_en end,
           gestionada_en = coalesce(gestionada_en, v_ahora), version = version + 1, actualizada_en = v_ahora
     where id = o.id;
    perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_actividades', v_actividad, 'gestion', jsonb_build_object(
      'oportunidad_id', o.id, 'tipo', v_tipo, 'estado_antes', o.estado, 'estado_despues', v_nuevo));
    if v_nuevo <> o.estado then
      perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_oportunidades', o.id,
        case when public.crm_rango_estado(v_nuevo) < public.crm_rango_estado(o.estado) then 'retroceso' else 'cambio_estado' end,
        jsonb_build_object('antes', o.estado, 'despues', v_nuevo, 'motivo', v_motivo, 'actividad_id', v_actividad));
    end if;
    if v_resolver is not null then
      update public.crm_seguimientos set estado = 'hecha', cerrada_en = v_ahora, resuelta_por_actividad_id = v_actividad, version = version + 1
       where id = v_resolver;
      perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_seguimientos', v_resolver, 'seguimiento_resuelto',
        jsonb_build_object('oportunidad_id', o.id, 'actividad_id', v_actividad));
    end if;
    if v_vence is not null then
      insert into public.crm_seguimientos (oportunidad_id, ciclo, tipo, vence_el, descripcion, operacion_clave)
      values (o.id, o.ciclo, 'seguimiento', v_vence, v_desc, p_clave) returning id into v_seg;
      perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_seguimientos', v_seg, 'seguimiento_programado',
        jsonb_build_object('oportunidad_id', o.id, 'vence_el', v_vence));
    end if;

  elsif p_accion = 'programar' then
    perform public.crm_claves_permitidas(v_datos, array['vence_el', 'descripcion']);
    if o.estado = 'perdida' then
      raise exception 'oportunidad_perdida' using errcode = '55000';
    end if;
    if o.estado = 'pausada' then
      raise exception 'oportunidad_pausada' using errcode = '55000';
    end if;
    if v_hay_pend then
      raise exception 'seguimiento_pendiente' using errcode = '55000';
    end if;
    v_vence := public.crm_fecha(v_datos, 'vence_el');
    if v_vence is null or v_vence < v_hoy then
      raise exception 'datos_invalidos:vence_el' using errcode = '22023';
    end if;
    insert into public.crm_seguimientos (oportunidad_id, ciclo, tipo, vence_el, descripcion, operacion_clave)
    values (o.id, o.ciclo, 'seguimiento', v_vence, public.crm_texto(v_datos, 'descripcion', 140), p_clave) returning id into v_seg;
    update public.crm_oportunidades set gestionada_en = coalesce(gestionada_en, v_ahora), version = version + 1, actualizada_en = v_ahora
     where id = o.id;
    perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_seguimientos', v_seg, 'seguimiento_programado',
      jsonb_build_object('oportunidad_id', o.id, 'vence_el', v_vence));

  elsif p_accion = 'reprogramar' then
    perform public.crm_claves_permitidas(v_datos, array['vence_el', 'descripcion', 'motivo']);
    if not v_hay_pend then
      raise exception 'seguimiento_no_vigente' using errcode = '55000';
    end if;
    v_vence := public.crm_fecha(v_datos, 'vence_el');
    if v_vence is null or v_vence < v_hoy or (v_pend.tipo = 'retomar' and v_vence <= v_hoy) then
      raise exception 'datos_invalidos:vence_el' using errcode = '22023';
    end if;
    v_desc := case when v_datos ? 'descripcion' then public.crm_texto(v_datos, 'descripcion', 140) else v_pend.descripcion end;
    if v_vence = v_pend.vence_el and v_desc is not distinct from v_pend.descripcion then
      raise exception 'sin_cambio' using errcode = '55000';
    end if;
    update public.crm_seguimientos set estado = 'reprogramada', cerrada_en = v_ahora, version = version + 1 where id = v_pend.id;
    insert into public.crm_seguimientos (oportunidad_id, ciclo, tipo, vence_el, descripcion, anterior_id, operacion_clave)
    values (o.id, o.ciclo, v_pend.tipo, v_vence, v_desc, v_pend.id, p_clave) returning id into v_seg;
    update public.crm_oportunidades
       set retomar_el = case when v_pend.tipo = 'retomar' then v_vence else retomar_el end,
           gestionada_en = coalesce(gestionada_en, v_ahora), version = version + 1, actualizada_en = v_ahora
     where id = o.id;
    perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_seguimientos', v_seg, 'seguimiento_reprogramado', jsonb_build_object(
      'oportunidad_id', o.id, 'anterior_id', v_pend.id, 'antes', v_pend.vence_el, 'despues', v_vence, 'motivo', public.crm_texto(v_datos, 'motivo', 300)));

  elsif p_accion = 'pausar' then
    perform public.crm_claves_permitidas(v_datos, array['retomar_el', 'motivo', 'observacion']);
    if o.estado = 'perdida' then
      raise exception 'oportunidad_perdida' using errcode = '55000';
    end if;
    if o.estado = 'pausada' then
      raise exception 'oportunidad_pausada' using errcode = '55000';
    end if;
    v_vence := public.crm_fecha(v_datos, 'retomar_el');
    if v_vence is null or v_vence <= v_hoy then
      raise exception 'datos_invalidos:retomar_el' using errcode = '22023';
    end if;
    insert into public.crm_actividades (oportunidad_id, ciclo, tipo, ocurrida_en, actor_rol, actor_usuario_id, observacion, estado_antes,
      estado_despues, motivo, operacion_clave)
    values (o.id, o.ciclo, 'cambio_estado', v_ahora, 'admin', null, public.crm_texto(v_datos, 'observacion', 1000), o.estado, 'pausada',
      public.crm_texto(v_datos, 'motivo', 300), p_clave)
    returning id into v_actividad;
    if v_hay_pend then
      update public.crm_seguimientos set estado = 'cancelada', cancelada_motivo = 'pausa', cerrada_en = v_ahora, version = version + 1
       where id = v_pend.id;
      perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_seguimientos', v_pend.id, 'seguimiento_cancelado',
        jsonb_build_object('oportunidad_id', o.id, 'motivo', 'pausa'));
    end if;
    insert into public.crm_seguimientos (oportunidad_id, ciclo, tipo, vence_el, operacion_clave)
    values (o.id, o.ciclo, 'retomar', v_vence, p_clave) returning id into v_seg;
    update public.crm_oportunidades
       set estado = 'pausada', estado_previo = o.estado, retomar_el = v_vence, pausada_en = v_ahora,
           gestionada_en = coalesce(gestionada_en, v_ahora), version = version + 1, actualizada_en = v_ahora
     where id = o.id;
    perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_oportunidades', o.id, 'pausa', jsonb_build_object(
      'estado_previo', o.estado, 'retomar_el', v_vence, 'actividad_id', v_actividad));

  elsif p_accion = 'retomar' then
    perform public.crm_claves_permitidas(v_datos, array['observacion', 'proxima']);
    if o.estado <> 'pausada' then
      raise exception 'oportunidad_no_pausada' using errcode = '55000';
    end if;
    if v_datos ? 'proxima' and jsonb_typeof(v_datos -> 'proxima') <> 'null' then
      perform public.crm_claves_permitidas(v_datos -> 'proxima', array['vence_el', 'descripcion']);
      v_vence := public.crm_fecha(v_datos -> 'proxima', 'vence_el');
      if v_vence is null or v_vence < v_hoy then
        raise exception 'datos_invalidos:vence_el' using errcode = '22023';
      end if;
      v_desc := public.crm_texto(v_datos -> 'proxima', 'descripcion', 140);
    end if;
    insert into public.crm_actividades (oportunidad_id, ciclo, tipo, ocurrida_en, actor_rol, actor_usuario_id, observacion, estado_antes,
      estado_despues, operacion_clave)
    values (o.id, o.ciclo, 'cambio_estado', v_ahora, 'admin', null, public.crm_texto(v_datos, 'observacion', 1000), 'pausada', o.estado_previo, p_clave)
    returning id into v_actividad;
    if v_hay_pend then
      update public.crm_seguimientos set estado = 'hecha', cerrada_en = v_ahora, resuelta_por_actividad_id = v_actividad, version = version + 1
       where id = v_pend.id;
    end if;
    update public.crm_oportunidades
       set estado = o.estado_previo, estado_previo = null, retomar_el = null, pausada_en = null, version = version + 1, actualizada_en = v_ahora
     where id = o.id;
    if v_vence is not null then
      insert into public.crm_seguimientos (oportunidad_id, ciclo, tipo, vence_el, descripcion, operacion_clave)
      values (o.id, o.ciclo, 'seguimiento', v_vence, v_desc, p_clave) returning id into v_seg;
      perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_seguimientos', v_seg, 'seguimiento_programado',
        jsonb_build_object('oportunidad_id', o.id, 'vence_el', v_vence));
    end if;
    perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_oportunidades', o.id, 'reanudacion', jsonb_build_object(
      'estado', o.estado_previo, 'retomar_el', o.retomar_el, 'actividad_id', v_actividad));

  elsif p_accion = 'perder' then
    perform public.crm_claves_permitidas(v_datos, array['motivo', 'detalle']);
    if o.estado = 'perdida' then
      raise exception 'sin_cambio' using errcode = '55000';
    end if;
    v_motivo := public.crm_texto(v_datos, 'motivo', 30);
    if v_motivo is null or v_motivo not in ('precio', 'sin_presupuesto', 'sin_utilidad', 'no_le_interesa', 'otro_sistema', 'no_prioridad',
       'sin_decisor', 'dejo_de_responder', 'condiciones', 'otro') then
      raise exception 'datos_invalidos:motivo' using errcode = '22023';
    end if;
    v_detalle := public.crm_texto(v_datos, 'detalle', 300);
    if v_motivo = 'otro' and v_detalle is null then
      raise exception 'datos_invalidos:detalle' using errcode = '22023';
    end if;
    insert into public.crm_actividades (oportunidad_id, ciclo, tipo, ocurrida_en, actor_rol, actor_usuario_id, observacion, estado_antes,
      estado_despues, motivo, operacion_clave)
    values (o.id, o.ciclo, 'cambio_estado', v_ahora, 'admin', null, v_detalle, o.estado, 'perdida', v_motivo, p_clave)
    returning id into v_actividad;
    if v_hay_pend then
      update public.crm_seguimientos set estado = 'cancelada', cancelada_motivo = 'perdida', cerrada_en = v_ahora, version = version + 1
       where id = v_pend.id;
      perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_seguimientos', v_pend.id, 'seguimiento_cancelado',
        jsonb_build_object('oportunidad_id', o.id, 'motivo', 'perdida'));
    end if;
    update public.crm_oportunidades
       set estado = 'perdida', estado_al_perder = case when o.estado = 'pausada' then o.estado_previo else o.estado end,
           perdida_en = v_ahora, perdida_motivo = v_motivo, perdida_detalle = v_detalle, cerrada_en = v_ahora, cierre_motivo = 'perdida',
           estado_previo = null, retomar_el = null, pausada_en = null,
           gestionada_en = coalesce(gestionada_en, v_ahora), version = version + 1, actualizada_en = v_ahora
     where id = o.id;
    perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_oportunidades', o.id, 'perdida', jsonb_build_object(
      'estado_antes', o.estado, 'motivo', v_motivo, 'actividad_id', v_actividad));

  elsif p_accion = 'reabrir' then
    perform public.crm_claves_permitidas(v_datos, array['motivo', 'estado']);
    if o.estado <> 'perdida' then
      raise exception 'oportunidad_no_perdida' using errcode = '55000';
    end if;
    v_motivo := public.crm_texto(v_datos, 'motivo', 300);
    if v_motivo is null then
      raise exception 'datos_invalidos:motivo' using errcode = '22023';
    end if;
    v_destino := coalesce(public.crm_texto(v_datos, 'estado', 20), o.estado_al_perder);
    if public.crm_rango_estado(v_destino) is null then
      raise exception 'datos_invalidos:estado' using errcode = '22023';
    end if;
    perform public.crm_empresa_para_actor(o.empresa_id, p_actor_rol, p_actor_usuario);
    if exists (select 1 from public.crm_oportunidades where empresa_id = o.empresa_id and cerrada_en is null and id <> o.id) then
      raise exception 'otra_oportunidad_abierta' using errcode = '55000';
    end if;
    insert into public.crm_oportunidad_ciclos (oportunidad_id, ciclo, inicio_en, estado_inicial, conversacion_en, interesado_en, propuesta_en,
      negociacion_en, estado_al_perder, perdida_en, perdida_motivo, perdida_detalle, reabierta_en, reapertura_motivo)
    values (o.id, o.ciclo, o.ciclo_inicio_en, o.ciclo_estado_inicial, o.conversacion_en, o.interesado_en, o.propuesta_en, o.negociacion_en,
      o.estado_al_perder, o.perdida_en, o.perdida_motivo, o.perdida_detalle, v_ahora, v_motivo);
    update public.crm_oportunidades
       set ciclo = ciclo + 1, ciclo_inicio_en = v_ahora, ciclo_estado_inicial = v_destino, estado = v_destino,
           conversacion_en = null, interesado_en = null, propuesta_en = null, negociacion_en = null,
           perdida_en = null, perdida_motivo = null, perdida_detalle = null, estado_al_perder = null, cerrada_en = null, cierre_motivo = null,
           version = version + 1, actualizada_en = v_ahora
     where id = o.id;
    insert into public.crm_actividades (oportunidad_id, ciclo, tipo, ocurrida_en, actor_rol, actor_usuario_id, estado_antes, estado_despues,
      motivo, operacion_clave)
    values (o.id, o.ciclo + 1, 'cambio_estado', v_ahora, 'admin', null, 'perdida', v_destino, v_motivo, p_clave)
    returning id into v_actividad;
    perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_oportunidades', o.id, 'reapertura', jsonb_build_object(
      'ciclo_anterior', o.ciclo, 'ciclo', o.ciclo + 1, 'estado', v_destino, 'motivo', v_motivo, 'actividad_id', v_actividad));

  elsif p_accion = 'contacto_principal' then
    perform public.crm_claves_permitidas(v_datos, array['contacto_id']);
    v_contacto := public.crm_uuid(v_datos, 'contacto_id');
    if v_contacto is null or not exists (select 1 from public.crm_contactos where id = v_contacto and empresa_id = o.empresa_id and archivado_en is null) then
      raise exception 'contacto_no_encontrado' using errcode = 'P0002';
    end if;
    if v_contacto is not distinct from o.contacto_id then
      raise exception 'sin_cambio' using errcode = '55000';
    end if;
    update public.crm_oportunidades set contacto_id = v_contacto, version = version + 1, actualizada_en = v_ahora where id = o.id;
    perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_oportunidades', o.id, 'contacto_principal', jsonb_build_object(
      'antes', o.contacto_id, 'despues', v_contacto));

  else
    raise exception 'datos_invalidos:accion' using errcode = '22023';
  end if;

  select * into o from public.crm_oportunidades where id = p_oportunidad;
  v_resultado := jsonb_build_object(
    'resultado', 'ok', 'repetida', false,
    'oportunidad', jsonb_build_object('id', o.id, 'estado', o.estado, 'version', o.version, 'ciclo', o.ciclo),
    'actividad_id', v_actividad,
    'seguimiento', (select jsonb_build_object('id', s.id, 'tipo', s.tipo, 'vence_el', s.vence_el, 'descripcion', s.descripcion)
                      from public.crm_seguimientos s where s.oportunidad_id = o.id and s.estado = 'pendiente'));
  insert into public.crm_operaciones (clave, huella, actor_rol, actor_usuario_id, oportunidad_id, accion, resultado)
  values (p_clave, p_huella, p_actor_rol, p_actor_usuario, o.id, p_accion, v_resultado);
  return v_resultado;
end
$fn$;

-- Una visita a un cliente (última oportunidad cerrada por venta) con contacto útil
-- abre una oportunidad nueva (recompra trabajada por el comercial); tras una
-- pérdida sigue la regla de B2.
create or replace function public.crm_visita_registrar(p_clave uuid, p_huella text, p_datos jsonb, p_actor_rol text, p_actor_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_existente public.crm_visitas%rowtype;
  v_jornada public.crm_jornadas%rowtype;
  v_empresa public.crm_empresas%rowtype;
  v_contacto public.crm_contactos%rowtype;
  v_opp public.crm_oportunidades%rowtype;
  v_hay_opp boolean;
  v_realizada uuid;
  v_ocurrida timestamptz;
  v_fecha date;
  v_emp uuid;
  v_res jsonb;
  v_creo_empresa boolean := false;
  v_contacto_id uuid;
  v_creo_contacto boolean := false;
  v_cerrado boolean;
  v_empleado boolean;
  v_responsable boolean;
  v_ausente boolean;
  v_obtenido boolean;
  v_hablo boolean;
  v_interes text;
  v_necesidades text[];
  v_otra text;
  v_pack text;
  v_volver boolean;
  v_revisita date;
  v_obs text;
  v_canal boolean;
  v_decisor text;
  v_visita uuid;
  v_creo_opp boolean := false;
  v_tarea uuid;
  v_tarea_resuelta uuid;
  v_perdida public.crm_oportunidades%rowtype;
  v_hay_perdida boolean := false;
begin
  perform public.crm_actor_validar(p_actor_rol, p_actor_usuario);
  if p_clave is null or p_huella is null or p_huella !~ '^[0-9a-f]{64}$' then
    raise exception 'datos_invalidos:clave' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('crm_visita:' || p_clave::text, 0));
  select * into v_existente from public.crm_visitas where clave = p_clave;
  if found then
    if v_existente.huella <> p_huella or v_existente.registrada_por_rol <> p_actor_rol
       or v_existente.registrada_por_usuario is distinct from p_actor_usuario then
      raise exception 'clave_reutilizada' using errcode = '22023';
    end if;
    return public.crm_visita_resultado(v_existente.id, true);
  end if;
  perform public.crm_claves_permitidas(p_datos, array['jornada_id', 'empresa_id', 'empresa_nueva', 'confirmar_duplicado', 'realizada_por', 'ocurrida_en',
    'cerrado', 'hablo_con_empleado', 'hablo_con_responsable', 'responsable_ausente', 'contacto_id', 'contacto_nuevo', 'contacto_obtenido',
    'hablo_con_contacto', 'interes', 'necesidades', 'necesidad_otra', 'pack_potencial', 'volver_otro_dia', 'revisita_para', 'observacion']);

  v_cerrado := coalesce(public.crm_bool(p_datos, 'cerrado'), false);
  v_empleado := coalesce(public.crm_bool(p_datos, 'hablo_con_empleado'), false);
  v_responsable := coalesce(public.crm_bool(p_datos, 'hablo_con_responsable'), false);
  v_ausente := coalesce(public.crm_bool(p_datos, 'responsable_ausente'), false);
  v_obtenido := coalesce(public.crm_bool(p_datos, 'contacto_obtenido'), false);
  v_hablo := coalesce(public.crm_bool(p_datos, 'hablo_con_contacto'), false);
  v_interes := public.crm_texto(p_datos, 'interes', 20);
  v_otra := public.crm_texto(p_datos, 'necesidad_otra', 120);
  v_pack := public.crm_texto(p_datos, 'pack_potencial', 20);
  v_volver := coalesce(public.crm_bool(p_datos, 'volver_otro_dia'), false);
  v_revisita := public.crm_fecha(p_datos, 'revisita_para');
  v_obs := public.crm_texto(p_datos, 'observacion', 1000);
  if p_datos ? 'necesidades' and jsonb_typeof(p_datos -> 'necesidades') = 'array' then
    if exists (select 1 from jsonb_array_elements(p_datos -> 'necesidades') e where jsonb_typeof(e) <> 'string') then
      raise exception 'datos_invalidos:necesidades' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct x order by x), '{}') into v_necesidades from jsonb_array_elements_text(p_datos -> 'necesidades') x;
  elsif p_datos ? 'necesidades' and jsonb_typeof(p_datos -> 'necesidades') <> 'null' then
    raise exception 'datos_invalidos:necesidades' using errcode = '22023';
  else
    v_necesidades := '{}';
  end if;

  if not (v_cerrado or v_empleado or v_responsable) then
    raise exception 'datos_invalidos:resultado' using errcode = '22023';
  end if;
  if v_cerrado and (v_empleado or v_responsable or v_ausente or v_obtenido or v_hablo or v_interes is not null or cardinality(v_necesidades) > 0
     or v_pack is not null or (p_datos ? 'contacto_id' and jsonb_typeof(p_datos -> 'contacto_id') <> 'null')
     or (p_datos ? 'contacto_nuevo' and jsonb_typeof(p_datos -> 'contacto_nuevo') <> 'null')) then
    raise exception 'datos_invalidos:cerrado' using errcode = '22023';
  end if;
  if v_ausente and v_responsable then
    raise exception 'datos_invalidos:responsable_ausente' using errcode = '22023';
  end if;
  if v_interes is not null and v_interes not in ('sin_interes', 'frio', 'tibio', 'caliente') then
    raise exception 'datos_invalidos:interes' using errcode = '22023';
  end if;
  if not (v_necesidades <@ array['fidelizacion', 'premio_compra', 'referidos', 'sorteos', 'redes', 'beneficios_empleados', 'incentivos_desempeno',
     'premios_comerciales', 'regalos', 'relaciones_clientes', 'otra']::text[]) then
    raise exception 'datos_invalidos:necesidades' using errcode = '22023';
  end if;
  if ('otra' = any (v_necesidades)) <> (v_otra is not null) then
    raise exception 'datos_invalidos:necesidad_otra' using errcode = '22023';
  end if;
  if v_pack is not null and v_pack not in ('10', '25', 'personalizado', 'no_determinado') then
    raise exception 'datos_invalidos:pack_potencial' using errcode = '22023';
  end if;
  if v_revisita is not null and not v_volver then
    raise exception 'datos_invalidos:revisita_para' using errcode = '22023';
  end if;

  if p_actor_rol = 'comercial' then
    if (p_datos ? 'realizada_por') or (p_datos ? 'ocurrida_en') then
      raise exception 'no_autorizado' using errcode = '42501';
    end if;
    v_realizada := p_actor_usuario;
    v_ocurrida := now();
  else
    v_realizada := public.crm_uuid(p_datos, 'realizada_por');
    if v_realizada is null or not exists (select 1 from public.crm_usuarios where id = v_realizada) then
      raise exception 'datos_invalidos:realizada_por' using errcode = '22023';
    end if;
    begin
      v_ocurrida := coalesce((p_datos ->> 'ocurrida_en')::timestamptz, now());
    exception when others then
      raise exception 'datos_invalidos:ocurrida_en' using errcode = '22023';
    end;
    if v_ocurrida > now() + interval '2 minutes' then
      raise exception 'datos_invalidos:ocurrida_en' using errcode = '22023';
    end if;
  end if;
  v_fecha := public.crm_fecha_sim(v_ocurrida);
  if v_revisita is not null and v_revisita < v_fecha then
    raise exception 'revisita_fecha_pasada' using errcode = '22023';
  end if;

  select * into v_jornada from public.crm_jornadas where id = public.crm_uuid(p_datos, 'jornada_id') for update;
  if not found or v_jornada.usuario_id <> v_realizada then
    raise exception 'jornada_no_encontrada' using errcode = 'P0002';
  end if;
  if p_actor_rol = 'comercial' and v_jornada.cerrada_en is not null then
    raise exception 'jornada_cerrada' using errcode = '55000';
  end if;
  if v_fecha < v_jornada.fecha or v_fecha > v_jornada.fecha + 1 then
    raise exception 'jornada_de_otra_fecha' using errcode = '55000';
  end if;

  if p_datos ? 'empresa_id' and jsonb_typeof(p_datos -> 'empresa_id') <> 'null' then
    if p_datos ? 'empresa_nueva' and jsonb_typeof(p_datos -> 'empresa_nueva') <> 'null' then
      raise exception 'datos_invalidos:empresa' using errcode = '22023';
    end if;
    v_empresa := public.crm_empresa_para_actor(public.crm_uuid(p_datos, 'empresa_id'), p_actor_rol, p_actor_usuario);
    if v_empresa.archivada_en is not null then
      raise exception 'empresa_archivada' using errcode = '55000';
    end if;
    v_emp := v_empresa.id;
  elsif jsonb_typeof(p_datos -> 'empresa_nueva') = 'object' then
    perform public.crm_claves_permitidas(p_datos -> 'empresa_nueva', array['nombre_comercial', 'rubro_id', 'rubro_detalle', 'direccion', 'zona_id',
      'instagram', 'web', 'prioridad']);
    v_res := public.crm_empresa_insertar(p_datos -> 'empresa_nueva', coalesce(public.crm_bool(p_datos, 'confirmar_duplicado'), false),
      p_actor_rol, p_actor_usuario, v_realizada, 'visita', false);
    if v_res ->> 'resultado' = 'posible_duplicado' then
      return v_res;
    end if;
    v_emp := (v_res ->> 'id')::uuid;
    v_creo_empresa := true;
  else
    raise exception 'datos_invalidos:empresa' using errcode = '22023';
  end if;

  if p_datos ? 'contacto_id' and jsonb_typeof(p_datos -> 'contacto_id') <> 'null' then
    if p_datos ? 'contacto_nuevo' and jsonb_typeof(p_datos -> 'contacto_nuevo') <> 'null' then
      raise exception 'datos_invalidos:contacto' using errcode = '22023';
    end if;
    select * into v_contacto from public.crm_contactos
     where id = public.crm_uuid(p_datos, 'contacto_id') and empresa_id = v_emp and archivado_en is null for update;
    if not found then
      raise exception 'contacto_no_encontrado' using errcode = 'P0002';
    end if;
    v_contacto_id := v_contacto.id;
  elsif jsonb_typeof(p_datos -> 'contacto_nuevo') = 'object' then
    perform public.crm_claves_permitidas(p_datos -> 'contacto_nuevo', array['nombre', 'cargo', 'telefono', 'tiene_whatsapp', 'es_decisor']);
    v_contacto_id := public.crm_contacto_insertar(v_emp, p_datos -> 'contacto_nuevo', p_actor_rol, p_actor_usuario);
    v_creo_contacto := true;
    select * into v_contacto from public.crm_contactos where id = v_contacto_id;
  elsif p_datos ? 'contacto_nuevo' and jsonb_typeof(p_datos -> 'contacto_nuevo') <> 'null' then
    raise exception 'datos_invalidos:contacto' using errcode = '22023';
  end if;
  if (v_obtenido or v_hablo) and v_contacto_id is null then
    raise exception 'datos_invalidos:contacto' using errcode = '22023';
  end if;
  if v_contacto_id is not null then
    v_canal := coalesce(v_contacto.telefono_normalizado ~ '^\d{8,15}$', false);
    v_decisor := v_contacto.es_decisor;
  end if;
  if v_obtenido and not v_canal then
    raise exception 'contacto_sin_canal' using errcode = '22023';
  end if;

  insert into public.crm_visitas (clave, huella, empresa_id, jornada_id, realizada_por_usuario, registrada_por_rol, registrada_por_usuario,
    ocurrida_en, fecha, cerrado, hablo_con_empleado, hablo_con_responsable, responsable_ausente, contacto_id, contacto_obtenido, hablo_con_contacto,
    contacto_es_decisor, contacto_canal_util, interes, necesidades, necesidad_otra, pack_potencial, volver_otro_dia, revisita_para, observacion,
    creo_empresa, creo_contacto)
  values (p_clave, p_huella, v_emp, v_jornada.id, v_realizada, p_actor_rol, p_actor_usuario, v_ocurrida, v_fecha, v_cerrado, v_empleado,
    v_responsable, v_ausente, v_contacto_id, v_obtenido, v_hablo, v_decisor, v_canal, v_interes, v_necesidades, v_otra, v_pack, v_volver,
    v_revisita, v_obs, v_creo_empresa, v_creo_contacto)
  returning id into v_visita;

  select * into v_opp from public.crm_oportunidades where empresa_id = v_emp and cerrada_en is null for update;
  v_hay_opp := found;
  if not v_hay_opp then
    select * into v_perdida from public.crm_oportunidades
     where empresa_id = v_emp and cierre_motivo in ('perdida', 'ganada') order by cerrada_en desc limit 1;
    v_hay_perdida := found and v_perdida.cierre_motivo = 'perdida';
    if v_obtenido and v_canal and (not v_hay_perdida or v_creo_contacto) then
      insert into public.crm_oportunidades (empresa_id, estado, origen_visita_id, origen_usuario_id, contacto_id, lead_en, interesado_en,
        ciclo, ciclo_inicio_en, ciclo_estado_inicial)
      values (v_emp, case when v_interes in ('tibio', 'caliente') then 'interesado' else 'contacto' end, v_visita, v_realizada, v_contacto_id,
        v_ocurrida, case when v_interes in ('tibio', 'caliente') then v_ocurrida end,
        1, v_ocurrida, case when v_interes in ('tibio', 'caliente') then 'interesado' else 'contacto' end)
      returning * into v_opp;
      v_hay_opp := true;
      v_creo_opp := true;
      perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_oportunidades', v_opp.id, 'creacion',
        jsonb_build_object('empresa_id', v_emp, 'origen_visita_id', v_visita, 'origen_usuario_id', v_realizada, 'estado', v_opp.estado,
          'tras_perdida', case when v_hay_perdida then v_perdida.id end));
    end if;
  elsif v_opp.estado in ('contacto', 'conversacion') and v_interes in ('tibio', 'caliente') then
    update public.crm_oportunidades set estado = 'interesado', interesado_en = least(interesado_en, v_ocurrida), version = version + 1,
           actualizada_en = now()
     where id = v_opp.id returning * into v_opp;
  end if;
  if v_hay_opp then
    update public.crm_visitas set oportunidad_id = v_opp.id, creo_oportunidad = v_creo_opp where id = v_visita;
  elsif v_hay_perdida then
    update public.crm_visitas set oportunidad_id = v_perdida.id where id = v_visita;
  end if;

  update public.crm_tareas
     set estado = 'hecha', resuelta_visita_id = v_visita, resuelta_en = now(), version = version + 1, actualizada_en = now()
   where empresa_id = v_emp and estado = 'pendiente'
  returning id into v_tarea_resuelta;
  if v_volver then
    insert into public.crm_tareas (empresa_id, oportunidad_id, responsable_id, vence_el, origen_visita_id, creada_por_rol, creada_por_usuario)
    values (v_emp, case when v_hay_opp then v_opp.id end, v_realizada, v_revisita, v_visita, p_actor_rol, p_actor_usuario)
    returning id into v_tarea;
  end if;

  perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_visitas', v_visita, 'registro', jsonb_build_object(
    'empresa_id', v_emp, 'jornada_id', v_jornada.id, 'realizada_por', v_realizada, 'oportunidad_id', case when v_hay_opp then v_opp.id end,
    'empresa_creada', v_creo_empresa, 'contacto_creado', v_creo_contacto, 'oportunidad_creada', v_creo_opp,
    'tarea_resuelta', v_tarea_resuelta, 'tarea_creada', v_tarea));
  return public.crm_visita_resultado(v_visita, false);
end
$fn$;

-- No se anula una visita que sustenta una venta vigente (origen del lead o
-- intervención de la comisión): primero se corrige o anula la venta.
create or replace function public.crm_visita_anular(p_id uuid, p_version integer, p_motivo text, p_resolucion text, p_nuevo_origen uuid,
  p_actor_rol text, p_actor_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v public.crm_visitas%rowtype;
  o public.crm_oportunidades%rowtype;
  n public.crm_visitas%rowtype;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_es_origen boolean := false;
begin
  perform public.crm_exigir_admin(p_actor_rol, p_actor_usuario);
  if v_motivo is null or char_length(v_motivo) > 300 then
    raise exception 'datos_invalidos:motivo' using errcode = '22023';
  end if;
  select * into v from public.crm_visitas where id = p_id for update;
  if not found then
    raise exception 'visita_no_encontrada' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.crm_ventas s join public.crm_oportunidades o2 on o2.id = s.oportunidad_id
     where s.anulada_en is null and (o2.origen_visita_id = p_id or s.comision_intervencion_visita_id = p_id)) then
    raise exception 'visita_con_venta' using errcode = '55000';
  end if;
  if v.anulada_en is not null then
    raise exception 'sin_cambio' using errcode = '55000';
  end if;
  if v.version <> p_version then
    raise exception 'version_desactualizada' using errcode = '40001';
  end if;
  if v.oportunidad_id is not null then
    select * into o from public.crm_oportunidades where id = v.oportunidad_id for update;
    v_es_origen := o.origen_visita_id = v.id and o.cerrada_en is null;
  end if;
  if v_es_origen then
    if p_resolucion = 'cerrar_oportunidad' then
      if o.gestionada_en is not null then
        raise exception 'oportunidad_gestionada' using errcode = '55000';
      end if;
      update public.crm_oportunidades set cerrada_en = now(), cierre_motivo = 'origen_anulado', version = version + 1, actualizada_en = now()
       where id = o.id;
      perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_oportunidades', o.id, 'cierre_por_anulacion',
        jsonb_build_object('visita_anulada', v.id, 'motivo', v_motivo));
    elsif p_resolucion = 'reasignar_origen' then
      select * into n from public.crm_visitas
       where id = p_nuevo_origen and oportunidad_id = o.id and id <> v.id and anulada_en is null and contacto_util;
      if not found then
        raise exception 'datos_invalidos:nuevo_origen' using errcode = '22023';
      end if;
      update public.crm_oportunidades
         set origen_visita_id = n.id, origen_usuario_id = n.realizada_por_usuario, lead_en = n.ocurrida_en,
             ciclo_inicio_en = case when ciclo = 1 then n.ocurrida_en else ciclo_inicio_en end,
             contacto_id = case when contacto_id is null or contacto_id is not distinct from v.contacto_id then n.contacto_id else contacto_id end,
             version = version + 1, actualizada_en = now()
       where id = o.id;
      perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_oportunidades', o.id, 'reasignacion_origen', jsonb_build_object(
        'antes', jsonb_build_object('origen_visita_id', o.origen_visita_id, 'origen_usuario_id', o.origen_usuario_id),
        'despues', jsonb_build_object('origen_visita_id', n.id, 'origen_usuario_id', n.realizada_por_usuario), 'motivo', v_motivo));
    else
      raise exception 'resolucion_requerida' using errcode = '55000';
    end if;
  elsif p_resolucion is not null or p_nuevo_origen is not null then
    raise exception 'datos_invalidos:resolucion' using errcode = '22023';
  end if;
  update public.crm_visitas set anulada_en = now(), anulada_motivo = v_motivo, version = version + 1, actualizada_en = now()
   where id = p_id
  returning version into v.version;
  if v.oportunidad_id is not null then
    perform public.crm_oportunidad_recalcular(v.oportunidad_id);
  end if;
  update public.crm_tareas set estado = 'cancelada', cancelada_motivo = 'visita_anulada', version = version + 1, actualizada_en = now()
   where origen_visita_id = p_id and estado = 'pendiente';
  update public.crm_tareas t set estado = 'pendiente', resuelta_visita_id = null, resuelta_en = null, version = version + 1, actualizada_en = now()
   where t.resuelta_visita_id = p_id
     and not exists (select 1 from public.crm_tareas o2 where o2.empresa_id = t.empresa_id and o2.estado = 'pendiente');
  perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_visitas', p_id, 'anulacion', jsonb_build_object(
    'motivo', v_motivo, 'oportunidad_id', v.oportunidad_id, 'era_origen', v_es_origen, 'resolucion', p_resolucion));
  return jsonb_build_object('id', p_id, 'version', v.version);
end
$fn$;

-- ── 12. Seguridad: RLS y privilegios explícitos ────────────────────────────
alter table public.crm_productos enable row level security;
alter table public.crm_ventas enable row level security;
alter table public.crm_cobros enable row level security;
alter table public.crm_comision_pagos enable row level security;

revoke all on table public.crm_productos, public.crm_ventas, public.crm_cobros, public.crm_comision_pagos from public, anon, authenticated, service_role;
grant select on table public.crm_productos, public.crm_ventas, public.crm_cobros, public.crm_comision_pagos to service_role;

revoke all on function public.crm_ventas_verificar() from public, anon, authenticated, service_role;
revoke all on function public.crm_importe(jsonb, text, numeric, numeric) from public, anon, authenticated, service_role;
revoke all on function public.crm_entero(jsonb, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.crm_venta_cobrado(uuid) from public, anon, authenticated, service_role;
revoke all on function public.crm_venta_comision_pagada(uuid) from public, anon, authenticated, service_role;
revoke all on function public.crm_venta_comision(jsonb, public.crm_oportunidades, boolean, public.crm_productos, numeric) from public, anon, authenticated, service_role;
revoke all on function public.crm_operacion_previa(uuid, text, text) from public, anon, authenticated, service_role;

revoke all on function public.crm_venta_registrar(uuid, text, uuid, integer, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.crm_venta_gestionar(uuid, text, uuid, integer, text, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.crm_oportunidad_recompra(uuid, text, uuid, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.crm_producto_actualizar(text, integer, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.crm_oportunidad_gestionar(uuid, text, uuid, integer, text, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.crm_visita_registrar(uuid, text, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.crm_visita_anular(uuid, integer, text, text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.crm_venta_registrar(uuid, text, uuid, integer, jsonb, text, uuid) to service_role;
grant execute on function public.crm_venta_gestionar(uuid, text, uuid, integer, text, jsonb, text, uuid) to service_role;
grant execute on function public.crm_oportunidad_recompra(uuid, text, uuid, jsonb, text, uuid) to service_role;
grant execute on function public.crm_producto_actualizar(text, integer, jsonb, text, uuid) to service_role;
grant execute on function public.crm_oportunidad_gestionar(uuid, text, uuid, integer, text, jsonb, text, uuid) to service_role;
grant execute on function public.crm_visita_registrar(uuid, text, jsonb, text, uuid) to service_role;
grant execute on function public.crm_visita_anular(uuid, integer, text, text, uuid, text, uuid) to service_role;
