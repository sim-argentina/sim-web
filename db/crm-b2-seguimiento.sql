-- ============================================================================
-- CRM B2B · Bloque 2 — Seguimiento comercial de Administración.
-- ----------------------------------------------------------------------------
-- La bandeja "Contactos para seguir": Administración gestiona a mano los leads
-- que deja la prospección (B1). Definiciones: docs/crm/b2-seguimiento.md.
-- Necesita db/crm-b0-identidad.sql y db/crm-b1-prospeccion.sql (en ese orden).
--
-- Qué NO hace: ventas, cobros, comisiones, códigos de Empresas, Finanzas ni
-- mensajes automáticos. "Ganado" queda reservado para B3 (no existe acá).
--
-- Reglas que viven acá:
--   · Reutiliza crm_oportunidades (sin pipeline paralelo). Estados: contacto
--     (contacto conseguido) · conversacion · interesado · negociacion · pausada
--     (retomar más adelante; guarda estado_previo y retomar_el) · perdida
--     (cerrada, con motivo). Rango de avance: contacto < conversacion <
--     interesado < negociacion. "Seguimiento pendiente" no es un estado: es una
--     fila pendiente en crm_seguimientos.
--   · Actividades manuales en crm_actividades (solo admin): momento de la
--     actividad (ocurrida_en) ≠ momento de registro (registrada_en). "Respondió"
--     avanza contacto → conversacion; "Inicio de negociación" avanza a
--     negociacion; "Propuesta enviada" es un hecho (propuesta_en) y no cambia el
--     estado; una nota no cambia nada ni completa seguimientos. Los avances nunca
--     retroceden; un retroceso manual exige motivo y se audita. Nada se deduce
--     del texto libre.
--   · Próxima acción: una sola pendiente por oportunidad (índice único parcial).
--     Reprogramar deja la anterior como 'reprogramada' y crea otra (historia).
--     Las revisitas de B1 (crm_tareas, de Tobías) son otra cosa y no se tocan.
--   · Pausa: fecha de recontacto > hoy (fecha de negocio de Córdoba); el
--     seguimiento pendiente se cancela y lo reemplaza una acción 'retomar'.
--     Retomar es explícito y vuelve al estado previo.
--   · Pérdida: motivo de una lista (con detalle obligatorio si es 'otro'); cierra
--     la oportunidad y cancela SOLO sus seguimientos pendientes.
--   · Reapertura: solo admin, con motivo y sin otra oportunidad abierta en el
--     negocio (bloquea el negocio). El ciclo perdido queda en
--     crm_oportunidad_ciclos; el nuevo ciclo empieza con sus hitos en NULL.
--     lead_en y la atribución de origen no cambian nunca por gestión.
--   · Toda acción pasa por crm_oportunidad_gestionar: atómica, idempotente
--     (crm_operaciones: misma clave → mismo resultado; otro contenido →
--     clave_reutilizada), con la oportunidad bloqueada (FOR UPDATE) y versión.
--   · Compatibilidad con B1 (se redefinen crm_visita_registrar,
--     crm_oportunidad_recalcular y crm_visita_anular): una visita solo hace
--     avanzar contacto/conversacion → interesado; no saca de pausa, no reabre una
--     perdida y, si el negocio tiene una perdida, solo crea una oportunidad nueva
--     con un contacto útil NUEVO (cargado en esa visita); si no, la visita queda
--     ligada a la perdida como historia. Corregir o anular visitas no recalcula
--     una oportunidad gestionada; cerrar una gestionada por anulación de su origen
--     se rechaza (oportunidad_gestionada).
--
-- Permisos: igual que B0/B1 (RLS sin policies, service_role solo lee, escrituras
-- por RPC SECURITY DEFINER, funciones internas sin EXECUTE). crm_operaciones no
-- la lee nadie. Va en db/orden.txt DESPUÉS de crm-b1-prospeccion.sql. Aditivo e
-- idempotente. Verificación: db/crm-b2-seguimiento.verificacion.sql.
-- Los cuerpos de las funciones NO llevan comentarios.
-- ============================================================================

-- ── 0. Auditoría: entidades y acciones de B2 (superconjunto de B1) ─────────
alter table public.crm_auditoria drop constraint if exists crm_auditoria_entidad_chk;
alter table public.crm_auditoria add constraint crm_auditoria_entidad_chk check (entidad in (
  'crm_usuarios', 'crm_rubros', 'crm_zonas', 'crm_empresas', 'crm_contactos', 'crm_jornadas',
  'crm_visitas', 'crm_oportunidades', 'crm_tareas', 'crm_actividades', 'crm_seguimientos'));
alter table public.crm_auditoria drop constraint if exists crm_auditoria_accion_chk;
alter table public.crm_auditoria add constraint crm_auditoria_accion_chk check (accion in (
  'alta', 'desactivacion', 'reactivacion', 'restablecimiento_contrasena', 'revocacion_sesiones', 'ingreso', 'cierre_sesion',
  'creacion', 'actualizacion', 'asignacion', 'archivo', 'desarchivo', 'apertura', 'cierre', 'registro', 'correccion',
  'anulacion', 'nota', 'reprogramacion', 'cancelacion', 'reasignacion_origen', 'cierre_por_anulacion',
  'gestion', 'cambio_estado', 'retroceso', 'pausa', 'reanudacion', 'perdida', 'reapertura',
  'seguimiento_programado', 'seguimiento_reprogramado', 'seguimiento_resuelto', 'seguimiento_cancelado', 'contacto_principal'));

-- ── 1. Oportunidad: estados de B2, ciclo e hitos ───────────────────────────
-- Hitos del ciclo vigente (primera vez que llegó a cada etapa, con el momento de
-- la actividad, no el del registro): conversacion_en, interesado_en,
-- propuesta_en, negociacion_en. gestionada_en = primera gestión de
-- Administración (nunca cambia después). lead_en y origen_* = adquisición del
-- lead (ciclo 1), nunca los cambia la gestión.
alter table public.crm_oportunidades add column if not exists ciclo integer not null default 1;
alter table public.crm_oportunidades add column if not exists ciclo_inicio_en timestamptz;
alter table public.crm_oportunidades add column if not exists ciclo_estado_inicial text;
alter table public.crm_oportunidades add column if not exists conversacion_en timestamptz;
alter table public.crm_oportunidades add column if not exists propuesta_en timestamptz;
alter table public.crm_oportunidades add column if not exists negociacion_en timestamptz;
alter table public.crm_oportunidades add column if not exists gestionada_en timestamptz;
alter table public.crm_oportunidades add column if not exists estado_previo text;
alter table public.crm_oportunidades add column if not exists retomar_el date;
alter table public.crm_oportunidades add column if not exists pausada_en timestamptz;
alter table public.crm_oportunidades add column if not exists perdida_en timestamptz;
alter table public.crm_oportunidades add column if not exists perdida_motivo text;
alter table public.crm_oportunidades add column if not exists perdida_detalle text;
alter table public.crm_oportunidades add column if not exists estado_al_perder text;

update public.crm_oportunidades
   set ciclo_inicio_en = coalesce(ciclo_inicio_en, lead_en),
       ciclo_estado_inicial = coalesce(ciclo_estado_inicial,
         case when interesado_en is not null and interesado_en <= lead_en then 'interesado' else 'contacto' end)
 where ciclo_inicio_en is null or ciclo_estado_inicial is null;
alter table public.crm_oportunidades alter column ciclo_inicio_en set default now();
alter table public.crm_oportunidades alter column ciclo_inicio_en set not null;
alter table public.crm_oportunidades alter column ciclo_estado_inicial set default 'contacto';
alter table public.crm_oportunidades alter column ciclo_estado_inicial set not null;

alter table public.crm_oportunidades drop constraint if exists crm_oportunidades_estado_chk;
alter table public.crm_oportunidades drop constraint if exists crm_oportunidades_cierre_chk;
alter table public.crm_oportunidades drop constraint if exists crm_oportunidades_estado_b2_chk;
alter table public.crm_oportunidades add constraint crm_oportunidades_estado_b2_chk check (
  estado in ('contacto', 'conversacion', 'interesado', 'negociacion', 'pausada', 'perdida')
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
  and (perdida_detalle is null or (perdida_motivo is not null and char_length(perdida_detalle) between 1 and 300)));
alter table public.crm_oportunidades drop constraint if exists crm_oportunidades_cierre_b2_chk;
alter table public.crm_oportunidades add constraint crm_oportunidades_cierre_b2_chk check (
  (cerrada_en is null) = (cierre_motivo is null)
  and (cierre_motivo is null or cierre_motivo in ('origen_anulado', 'perdida'))
  and ((estado = 'perdida') = (cierre_motivo is not distinct from 'perdida')));
create index if not exists crm_oportunidades_perdidas_idx on public.crm_oportunidades (empresa_id, perdida_en desc) where cierre_motivo = 'perdida';

comment on column public.crm_oportunidades.lead_en is
  'Adquisición del lead (visita de origen). No lo cambia la gestión ni una reapertura; solo la reasignación del origen por anulación.';
comment on column public.crm_oportunidades.ciclo_inicio_en is
  'Inicio del ciclo vigente: lead_en en el ciclo 1; el momento de la reapertura en los siguientes.';

-- ── 2. Ciclos cerrados por pérdida y luego reabiertos (inmutables) ─────────
create table if not exists public.crm_oportunidad_ciclos (
  id                uuid primary key default gen_random_uuid(),
  oportunidad_id    uuid not null references public.crm_oportunidades (id) on delete restrict,
  ciclo             integer not null,
  inicio_en         timestamptz not null,
  estado_inicial    text not null,
  conversacion_en   timestamptz,
  interesado_en     timestamptz,
  propuesta_en      timestamptz,
  negociacion_en    timestamptz,
  estado_al_perder  text not null,
  perdida_en        timestamptz not null,
  perdida_motivo    text not null,
  perdida_detalle   text,
  reabierta_en      timestamptz not null default now(),
  reapertura_motivo text not null,
  constraint crm_oportunidad_ciclos_uq unique (oportunidad_id, ciclo)
);

-- ── 3. Actividades de Administración ───────────────────────────────────────
create table if not exists public.crm_actividades (
  id                uuid primary key default gen_random_uuid(),
  oportunidad_id    uuid not null references public.crm_oportunidades (id) on delete restrict,
  ciclo             integer not null,
  tipo              text not null,
  contacto_id       uuid references public.crm_contactos (id) on delete restrict,
  ocurrida_en       timestamptz not null,
  registrada_en     timestamptz not null default now(),
  actor_rol         text not null,
  actor_usuario_id  uuid references public.crm_usuarios (id) on delete restrict,
  observacion       text,
  estado_antes      text,
  estado_despues    text,
  motivo            text,
  operacion_clave   uuid not null,
  constraint crm_actividades_tipo_chk check (tipo in ('whatsapp_enviado', 'respondio', 'no_respondio', 'llamada', 'nota',
    'propuesta_enviada', 'inicio_negociacion', 'cambio_estado')),
  constraint crm_actividades_actor_chk check (actor_rol = 'admin' and actor_usuario_id is null),
  constraint crm_actividades_estado_chk check ((estado_antes is null) = (estado_despues is null)
    and (tipo <> 'cambio_estado' or estado_despues is not null)
    and (estado_despues is null or estado_despues in ('contacto', 'conversacion', 'interesado', 'negociacion', 'pausada', 'perdida'))),
  constraint crm_actividades_texto_chk check ((observacion is null or char_length(observacion) between 1 and 1000)
    and (motivo is null or char_length(motivo) between 1 and 300) and (tipo <> 'nota' or observacion is not null))
);
create index if not exists crm_actividades_oportunidad_idx on public.crm_actividades (oportunidad_id, ocurrida_en desc);

-- ── 4. Próximas acciones de Administración ─────────────────────────────────
create table if not exists public.crm_seguimientos (
  id                        uuid primary key default gen_random_uuid(),
  oportunidad_id            uuid not null references public.crm_oportunidades (id) on delete restrict,
  ciclo                     integer not null,
  tipo                      text not null,
  vence_el                  date not null,
  descripcion               text,
  estado                    text not null default 'pendiente',
  anterior_id               uuid references public.crm_seguimientos (id) on delete restrict,
  creada_en                 timestamptz not null default now(),
  cerrada_en                timestamptz,
  resuelta_por_actividad_id uuid references public.crm_actividades (id) on delete restrict,
  cancelada_motivo          text,
  operacion_clave           uuid not null,
  version                   integer not null default 1,
  constraint crm_seguimientos_tipo_chk check (tipo in ('seguimiento', 'retomar')),
  constraint crm_seguimientos_estado_chk check (estado in ('pendiente', 'hecha', 'reprogramada', 'cancelada')
    and ((estado = 'pendiente') = (cerrada_en is null))
    and ((estado = 'hecha') = (resuelta_por_actividad_id is not null))
    and ((estado = 'cancelada') = (cancelada_motivo is not null))
    and (cancelada_motivo is null or cancelada_motivo in ('pausa', 'perdida'))),
  constraint crm_seguimientos_texto_chk check (descripcion is null or char_length(descripcion) between 1 and 140)
);
create unique index if not exists crm_seguimientos_un_pendiente_uidx on public.crm_seguimientos (oportunidad_id) where estado = 'pendiente';
create index if not exists crm_seguimientos_vence_idx on public.crm_seguimientos (vence_el) where estado = 'pendiente';

-- ── 5. Idempotencia de las acciones de gestión ─────────────────────────────
create table if not exists public.crm_operaciones (
  clave             uuid primary key,
  huella            text not null,
  actor_rol         text not null,
  actor_usuario_id  uuid,
  oportunidad_id    uuid not null references public.crm_oportunidades (id) on delete restrict,
  accion            text not null,
  resultado         jsonb not null,
  creada_en         timestamptz not null default now(),
  constraint crm_operaciones_huella_chk check (huella ~ '^[0-9a-f]{64}$')
);

-- ── 6. Funciones internas ──────────────────────────────────────────────────
create or replace function public.crm_rango_estado(p text)
returns integer
language sql
immutable
set search_path = public
as $fn$
  select case p when 'contacto' then 1 when 'conversacion' then 2 when 'interesado' then 3 when 'negociacion' then 4 end
$fn$;

-- B1 recalculaba el estado desde las visitas al corregir o anular. Desde B2 solo
-- lo hace mientras la oportunidad no tiene gestión de Administración (ciclo 1,
-- contacto/interesado): después manda la gestión y una corrección no la mueve.
create or replace function public.crm_oportunidad_recalcular(p_id uuid)
returns void
language plpgsql
volatile
set search_path = public
as $fn$
declare
  v_interesado timestamptz;
begin
  select min(v.ocurrida_en) into v_interesado
    from public.crm_visitas v
   where v.oportunidad_id = p_id and v.anulada_en is null and v.interes in ('tibio', 'caliente');
  update public.crm_oportunidades
     set estado = case when v_interesado is null then 'contacto' else 'interesado' end,
         interesado_en = v_interesado, version = version + 1, actualizada_en = now()
   where id = p_id and cerrada_en is null and gestionada_en is null and ciclo = 1 and estado in ('contacto', 'interesado')
     and interesado_en is distinct from v_interesado;
end
$fn$;

-- ── 7. RPC: registrar una visita (redefinida para B2) ──────────────────────
-- Igual que en B1, salvo la oportunidad: con una abierta (cualquier estado,
-- incluida la pausa) la visita se liga y solo puede hacerla avanzar de
-- contacto/conversacion a interesado; sin abierta y con una perdida, solo un
-- contacto útil cargado en ESTA visita crea una nueva (lead realmente nuevo); si
-- no, la visita queda ligada a la perdida, sin reabrirla.
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
     where empresa_id = v_emp and cierre_motivo = 'perdida' order by perdida_en desc limit 1;
    v_hay_perdida := found;
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

-- ── 8. RPC: anular una visita (redefinida para B2) ─────────────────────────
-- Igual que en B1, salvo: cerrar por anulación una oportunidad que ya tiene
-- gestión de Administración se rechaza (oportunidad_gestionada: reasignar el
-- origen o marcarla perdida); reasignar el origen no pisa un contacto principal
-- elegido por Administración.
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

-- ── 9. RPC: toda la gestión de una oportunidad (solo admin) ────────────────
-- p_accion: gestion · programar · reprogramar · pausar · retomar · perder ·
-- reabrir · contacto_principal. Ver el encabezado y docs/crm/b2-seguimiento.md.
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

-- ── 10. Seguridad: RLS y privilegios explícitos ────────────────────────────
alter table public.crm_oportunidad_ciclos enable row level security;
alter table public.crm_actividades enable row level security;
alter table public.crm_seguimientos enable row level security;
alter table public.crm_operaciones enable row level security;

revoke all on table public.crm_oportunidad_ciclos, public.crm_actividades, public.crm_seguimientos, public.crm_operaciones
  from public, anon, authenticated, service_role;
grant select on table public.crm_oportunidad_ciclos, public.crm_actividades, public.crm_seguimientos to service_role;

revoke all on function public.crm_rango_estado(text) from public, anon, authenticated, service_role;
revoke all on function public.crm_oportunidad_recalcular(uuid) from public, anon, authenticated, service_role;

revoke all on function public.crm_visita_registrar(uuid, text, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.crm_visita_anular(uuid, integer, text, text, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.crm_oportunidad_gestionar(uuid, text, uuid, integer, text, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.crm_visita_registrar(uuid, text, jsonb, text, uuid) to service_role;
grant execute on function public.crm_visita_anular(uuid, integer, text, text, uuid, text, uuid) to service_role;
grant execute on function public.crm_oportunidad_gestionar(uuid, text, uuid, integer, text, jsonb, text, uuid) to service_role;
