-- ============================================================================
-- CRM B2B · Bloque 1 — Prospección presencial y registro de visitas.
-- ----------------------------------------------------------------------------
-- Negocios (empresas), rubros, zonas, contactos, jornadas, visitas, la
-- oportunidad mínima que entrega el lead a Administración y las revisitas.
-- Definiciones: docs/crm/b1-prospeccion.md. Necesita db/crm-b0-identidad.sql.
--
-- Qué NO hace: no toca Finanzas, Empresas (campañas/códigos), Turnero, Reservas,
-- Gift Cards, Mensualidades ni Marketing. No hay negociación, venta, cobro ni
-- comisión: la oportunidad solo tiene los estados iniciales 'contacto' e
-- 'interesado' y, si se anula la visita que la originó, puede cerrarse.
--
-- Reglas que viven acá (y no solo en la API):
--   · Actor: p_actor_rol 'admin' (sin usuario) o 'comercial' (con su id, activo).
--     El comercial solo ve y toca negocios con responsable_id = él y no
--     archivados; contactos, visitas, jornadas y tareas se validan contra eso.
--     Un ID ajeno responde "no encontrado", igual que uno inexistente.
--   · Visita: negocio + jornada del que la realizó + resultado básico (cerrado o
--     habló con alguien). Hechos separados: cerrado · habló con empleado · habló
--     con responsable · el responsable no estaba · contacto útil obtenido · habló
--     con el contacto · interés (NULL = no evaluado) · necesidades · pack ·
--     volver otro día. Quien la realizó (realizada_por_usuario) y quien la cargó
--     (registrada_por_*) se guardan por separado.
--   · Contacto útil = el registro de la visita dice que se obtuvo el contacto Y
--     ese contacto tiene un teléfono utilizable (8 a 15 dígitos normalizados).
--     Solo eso crea la oportunidad. Cargar un teléfono en la ficha, importar un
--     negocio o elegir un contacto sin marcarlo como obtenido no la crea.
--   · Decisor contactado = habló con ese contacto y el contacto era decisor ('si')
--     al momento de la visita (foto en contacto_es_decisor).
--   · Una sola oportunidad abierta por negocio (índice único parcial y bloqueo del
--     negocio). La atribución (visita y comercial de origen) no la cambia una visita
--     posterior; el estado solo avanza (contacto → interesado).
--   · Registro atómico e idempotente: clave + huella del contenido. La misma clave
--     con otro contenido se rechaza.
--   · Jornadas: varias por día, una sola abierta por comercial; kilómetros y gastos
--     NULL = sin cargar, 0 = cero confirmado. Nunca se cierran solas. Una visita
--     va a una jornada de su mismo día de negocio o del día anterior (cruce de
--     medianoche).
--
-- Permisos mínimos (mismo patrón que B0): RLS sin policies; anon y authenticated
-- sin acceso; service_role solo LEE; toda escritura por RPC SECURITY DEFINER.
-- Va en db/orden.txt DESPUÉS de crm-b0-identidad.sql. Aditivo e idempotente.
-- Verificación: db/crm-b1-prospeccion.verificacion.sql.
-- Los cuerpos de las funciones NO llevan comentarios.
-- ============================================================================

-- ── 0. Auditoría: las entidades y acciones de B1 ───────────────────────────
-- Patrón de la cadena CRM para restricciones que un bloque posterior amplía: se
-- agregan NOT VALID (rigen para toda fila nueva o modificada) y se intenta
-- validarlas. En una base nueva la validación pasa; al reaplicar la cadena sobre
-- una base con filas de bloques posteriores falla, la restricción queda NOT VALID
-- un instante y el bloque siguiente la reemplaza por su superconjunto y la valida.
-- Al terminar la cadena no queda ninguna sin validar
-- (db/crm-cadena.verificacion.sql lo comprueba).
alter table public.crm_auditoria drop constraint if exists crm_auditoria_entidad_chk;
alter table public.crm_auditoria add constraint crm_auditoria_entidad_chk check (entidad in (
  'crm_usuarios', 'crm_rubros', 'crm_zonas', 'crm_empresas', 'crm_contactos', 'crm_jornadas',
  'crm_visitas', 'crm_oportunidades', 'crm_tareas')) not valid;
alter table public.crm_auditoria drop constraint if exists crm_auditoria_accion_chk;
alter table public.crm_auditoria add constraint crm_auditoria_accion_chk check (accion in (
  'alta', 'desactivacion', 'reactivacion', 'restablecimiento_contrasena', 'revocacion_sesiones', 'ingreso', 'cierre_sesion',
  'creacion', 'actualizacion', 'asignacion', 'archivo', 'desarchivo', 'apertura', 'cierre', 'registro', 'correccion',
  'anulacion', 'nota', 'reprogramacion', 'cancelacion', 'reasignacion_origen', 'cierre_por_anulacion')) not valid;
do $$
begin
  alter table public.crm_auditoria validate constraint crm_auditoria_entidad_chk;
  alter table public.crm_auditoria validate constraint crm_auditoria_accion_chk;
exception when check_violation then
  raise notice 'crm_auditoria: quedan NOT VALID hasta el bloque siguiente (hay filas de bloques posteriores)';
end
$$;

-- ── 1. Funciones internas de normalización (sin EXECUTE para nadie) ────────
-- Texto para comparar: minúsculas, sin acentos, solo letras/dígitos y espacios simples.
-- Las mayúsculas acentuadas se traducen también: no depende del locale de lower().
create or replace function public.crm_normalizar_texto(p text)
returns text
language sql
immutable
set search_path = public
as $fn$
  select nullif(btrim(regexp_replace(translate(lower(coalesce(p, '')), 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ', 'aaaaaeeeeiiiiooooouuuuncaaaaaeeeeiiiiooooouuuunc'), '[^a-z0-9]+', ' ', 'g')), '')
$fn$;

-- Teléfono para comparar y para enlaces: solo dígitos; 00 → internacional; un 0
-- inicial o 10 dígitos sin país → +54. Heurística para coincidir, no validación.
create or replace function public.crm_normalizar_telefono(p text)
returns text
language plpgsql
immutable
set search_path = public
as $fn$
declare
  d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if d = '' then
    return null;
  end if;
  if left(d, 2) = '00' then
    d := substr(d, 3);
  elsif left(d, 1) = '0' then
    d := '54' || substr(d, 2);
  elsif char_length(d) = 10 then
    d := '54' || d;
  end if;
  return nullif(d, '');
end
$fn$;

-- Día de negocio de SIM (Córdoba, sin horario de verano) de un instante.
create or replace function public.crm_fecha_sim(p timestamptz)
returns date
language sql
immutable
strict
set search_path = public
as $fn$
  select (p at time zone 'America/Argentina/Cordoba')::date
$fn$;

-- Lectores de campos de un jsonb con validación (error = datos_invalidos:<campo>).
create or replace function public.crm_texto(p jsonb, p_clave text, p_max integer)
returns text
language plpgsql
immutable
set search_path = public
as $fn$
declare
  v text;
begin
  if p is null or not (p ? p_clave) or jsonb_typeof(p -> p_clave) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p -> p_clave) <> 'string' then
    raise exception 'datos_invalidos:%', p_clave using errcode = '22023';
  end if;
  v := nullif(btrim(regexp_replace(p ->> p_clave, '\s+', ' ', 'g')), '');
  if v is not null and char_length(v) > p_max then
    raise exception 'datos_invalidos:%', p_clave using errcode = '22023';
  end if;
  return v;
end
$fn$;

create or replace function public.crm_uuid(p jsonb, p_clave text)
returns uuid
language plpgsql
immutable
set search_path = public
as $fn$
begin
  if p is null or not (p ? p_clave) or jsonb_typeof(p -> p_clave) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p -> p_clave) <> 'string' or (p ->> p_clave) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'datos_invalidos:%', p_clave using errcode = '22023';
  end if;
  return (p ->> p_clave)::uuid;
end
$fn$;

create or replace function public.crm_bool(p jsonb, p_clave text)
returns boolean
language plpgsql
immutable
set search_path = public
as $fn$
begin
  if p is null or not (p ? p_clave) or jsonb_typeof(p -> p_clave) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p -> p_clave) <> 'boolean' then
    raise exception 'datos_invalidos:%', p_clave using errcode = '22023';
  end if;
  return (p ->> p_clave)::boolean;
end
$fn$;

create or replace function public.crm_numero(p jsonb, p_clave text, p_max numeric)
returns numeric
language plpgsql
immutable
set search_path = public
as $fn$
declare
  v numeric;
begin
  if p is null or not (p ? p_clave) or jsonb_typeof(p -> p_clave) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p -> p_clave) <> 'number' then
    raise exception 'datos_invalidos:%', p_clave using errcode = '22023';
  end if;
  v := (p ->> p_clave)::numeric;
  if v < 0 or v > p_max then
    raise exception 'datos_invalidos:%', p_clave using errcode = '22023';
  end if;
  return v;
end
$fn$;

create or replace function public.crm_fecha(p jsonb, p_clave text)
returns date
language plpgsql
immutable
set search_path = public
as $fn$
begin
  if p is null or not (p ? p_clave) or jsonb_typeof(p -> p_clave) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p -> p_clave) <> 'string' or (p ->> p_clave) !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'datos_invalidos:%', p_clave using errcode = '22023';
  end if;
  return (p ->> p_clave)::date;
exception when datetime_field_overflow or invalid_datetime_format then
  raise exception 'datos_invalidos:%', p_clave using errcode = '22023';
end
$fn$;

-- Claves permitidas de un jsonb de cambios (cualquier otra → datos_invalidos).
create or replace function public.crm_claves_permitidas(p jsonb, p_permitidas text[])
returns void
language plpgsql
immutable
set search_path = public
as $fn$
declare
  k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'datos_invalidos:cambios' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p) loop
    if not (k = any (p_permitidas)) then
      raise exception 'datos_invalidos:%', k using errcode = '22023';
    end if;
  end loop;
end
$fn$;

-- ── 2. Catálogos: rubros y zonas ───────────────────────────────────────────
create table if not exists public.crm_rubros (
  id                 uuid primary key default gen_random_uuid(),
  nombre             text not null,
  nombre_normalizado text not null,
  activo             boolean not null default true,
  orden              integer not null default 100,
  version            integer not null default 1,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  constraint crm_rubros_nombre_chk check (nombre = btrim(nombre) and char_length(nombre) between 1 and 60),
  constraint crm_rubros_orden_chk check (orden between 0 and 10000)
);
create unique index if not exists crm_rubros_nombre_uidx on public.crm_rubros (nombre_normalizado);

create table if not exists public.crm_zonas (
  id                 uuid primary key default gen_random_uuid(),
  nombre             text not null,
  nombre_normalizado text not null,
  activo             boolean not null default true,
  orden              integer not null default 100,
  version            integer not null default 1,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  constraint crm_zonas_nombre_chk check (nombre = btrim(nombre) and char_length(nombre) between 1 and 60),
  constraint crm_zonas_orden_chk check (orden between 0 and 10000)
);
create unique index if not exists crm_zonas_nombre_uidx on public.crm_zonas (nombre_normalizado);

-- Rubros iniciales (los del diseño + peluquerías). No es una lista cerrada: la
-- administración agrega los que hagan falta y un alta puede describir uno no listado.
insert into public.crm_rubros (nombre, nombre_normalizado, orden)
select v.nombre, public.crm_normalizar_texto(v.nombre), v.orden
  from (values ('Concesionarias', 10), ('Neumáticos', 20), ('Talleres', 30), ('Detailing', 40), ('Lubricentros', 50),
               ('Repuesteras', 60), ('Accesorios / performance', 70), ('Gimnasios', 80), ('Inmobiliarias', 90),
               ('Tecnología', 100), ('Servicios', 110), ('Oficinas', 120), ('Gastronomía', 130), ('Peluquerías', 140)) v(nombre, orden)
on conflict (nombre_normalizado) do nothing;

-- ── 3. Negocios ─────────────────────────────────────────────────────────────
-- origen: 'manual' (alta desde una pantalla), 'visita' (creado al registrar una
-- visita) o 'importacion' (reservado para una carga futura; origen_ref la hace
-- identificable e idempotente). Un negocio cargado para visitar NO genera visita,
-- jornada, lead ni interés. similar_a: posibles duplicados que se confirmaron
-- como distintos al crearlo (para revisión de la administración).
create table if not exists public.crm_empresas (
  id                    uuid primary key default gen_random_uuid(),
  nombre_comercial      text not null,
  nombre_normalizado    text not null,
  rubro_id              uuid references public.crm_rubros (id) on delete restrict,
  rubro_detalle         text,
  direccion             text,
  direccion_normalizada text,
  zona_id               uuid references public.crm_zonas (id) on delete restrict,
  instagram             text,
  web                   text,
  prioridad             text,
  responsable_id        uuid references public.crm_usuarios (id) on delete restrict,
  cliente_previo        boolean not null default false,
  origen                text not null default 'manual',
  origen_ref            text,
  similar_a             uuid[] not null default '{}',
  archivada_en          timestamptz,
  archivada_motivo      text,
  version               integer not null default 1,
  creada_en             timestamptz not null default now(),
  creada_por_rol        text not null,
  creada_por_usuario    uuid references public.crm_usuarios (id) on delete restrict,
  actualizada_en        timestamptz not null default now(),
  constraint crm_empresas_nombre_chk check (nombre_comercial = btrim(nombre_comercial) and char_length(nombre_comercial) between 1 and 120),
  constraint crm_empresas_rubro_chk check (rubro_detalle is null or (rubro_id is null and char_length(rubro_detalle) between 1 and 80)),
  constraint crm_empresas_textos_chk check (coalesce(char_length(direccion), 0) <= 200 and coalesce(char_length(instagram), 0) <= 100 and coalesce(char_length(web), 0) <= 200),
  constraint crm_empresas_prioridad_chk check (prioridad is null or prioridad in ('A', 'B', 'C')),
  constraint crm_empresas_origen_chk check (origen in ('manual', 'visita', 'importacion') and (origen_ref is null or (origen = 'importacion' and char_length(origen_ref) between 1 and 200))),
  constraint crm_empresas_archivo_chk check ((archivada_en is null) = (archivada_motivo is null)),
  constraint crm_empresas_actor_chk check ((creada_por_rol = 'admin' and creada_por_usuario is null) or (creada_por_rol = 'comercial' and creada_por_usuario is not null))
);
create unique index if not exists crm_empresas_importacion_uidx on public.crm_empresas (origen, origen_ref) where origen_ref is not null;
create index if not exists crm_empresas_responsable_idx on public.crm_empresas (responsable_id) where archivada_en is null;
create index if not exists crm_empresas_nombre_idx on public.crm_empresas (nombre_normalizado);
create index if not exists crm_empresas_direccion_idx on public.crm_empresas (direccion_normalizada) where direccion_normalizada is not null;

-- ── 4. Contactos ────────────────────────────────────────────────────────────
-- Un solo teléfono (sirve para WhatsApp si tiene_whatsapp no es false): se guarda
-- tal como se cargó y normalizado. SIN unicidad por teléfono: dos personas pueden
-- compartir el número central del negocio.
create table if not exists public.crm_contactos (
  id                    uuid primary key default gen_random_uuid(),
  empresa_id            uuid not null references public.crm_empresas (id) on delete restrict,
  nombre                text,
  cargo                 text,
  telefono              text,
  telefono_normalizado  text,
  tiene_whatsapp        boolean,
  es_decisor            text not null default 'no_sabe',
  archivado_en          timestamptz,
  version               integer not null default 1,
  creado_en             timestamptz not null default now(),
  creado_por_rol        text not null,
  creado_por_usuario    uuid references public.crm_usuarios (id) on delete restrict,
  actualizado_en        timestamptz not null default now(),
  constraint crm_contactos_dato_chk check (nombre is not null or telefono is not null),
  constraint crm_contactos_textos_chk check (coalesce(char_length(nombre), 0) <= 80 and coalesce(char_length(cargo), 0) <= 80 and coalesce(char_length(telefono), 0) <= 40),
  constraint crm_contactos_telefono_chk check ((telefono is null) = (telefono_normalizado is null) and (telefono_normalizado is null or telefono_normalizado ~ '^\d{6,15}$')),
  constraint crm_contactos_decisor_chk check (es_decisor in ('si', 'no', 'no_sabe')),
  constraint crm_contactos_actor_chk check ((creado_por_rol = 'admin' and creado_por_usuario is null) or (creado_por_rol = 'comercial' and creado_por_usuario is not null))
);
create index if not exists crm_contactos_empresa_idx on public.crm_contactos (empresa_id);
create index if not exists crm_contactos_telefono_idx on public.crm_contactos (telefono_normalizado) where telefono_normalizado is not null;

-- ── 5. Jornadas ─────────────────────────────────────────────────────────────
-- La jornada es lo que efectivamente se realizó (no un recorrido planificado).
-- Combustible cargado = lo que se cargó y pagó en esa jornada, no lo consumido.
create table if not exists public.crm_jornadas (
  id                       uuid primary key default gen_random_uuid(),
  usuario_id               uuid not null references public.crm_usuarios (id) on delete restrict,
  fecha                    date not null,
  nombre                   text,
  zona_id                  uuid references public.crm_zonas (id) on delete restrict,
  abierta_en               timestamptz not null default now(),
  cerrada_en               timestamptz,
  cerrada_por_rol          text,
  cerrada_por_usuario      uuid references public.crm_usuarios (id) on delete restrict,
  km_inicial               numeric(9, 1),
  km_final                 numeric(9, 1),
  km_recorridos            numeric(9, 1) generated always as (km_final - km_inicial) stored,
  combustible_cantidad     numeric(8, 2),
  combustible_unidad       text,
  combustible_importe      numeric(12, 2),
  estacionamiento_importe  numeric(12, 2),
  peajes_importe           numeric(12, 2),
  otros_importe            numeric(12, 2),
  otros_detalle            text,
  version                  integer not null default 1,
  creada_en                timestamptz not null default now(),
  creada_por_rol           text not null,
  creada_por_usuario       uuid references public.crm_usuarios (id) on delete restrict,
  actualizada_en           timestamptz not null default now(),
  constraint crm_jornadas_nombre_chk check (nombre is null or char_length(nombre) between 1 and 80),
  constraint crm_jornadas_km_chk check (coalesce(km_inicial, 0) >= 0 and coalesce(km_final, 0) >= 0 and (km_inicial is null or km_final is null or km_final >= km_inicial)),
  constraint crm_jornadas_combustible_chk check ((combustible_cantidad is null) = (combustible_unidad is null) and (combustible_unidad is null or combustible_unidad in ('litros', 'm3')) and coalesce(combustible_cantidad, 0) >= 0),
  constraint crm_jornadas_importes_chk check (coalesce(combustible_importe, 0) >= 0 and coalesce(estacionamiento_importe, 0) >= 0 and coalesce(peajes_importe, 0) >= 0 and coalesce(otros_importe, 0) >= 0),
  constraint crm_jornadas_detalle_chk check (otros_detalle is null or char_length(otros_detalle) <= 200),
  constraint crm_jornadas_cierre_chk check ((cerrada_en is null) = (cerrada_por_rol is null) and (cerrada_en is null or cerrada_en >= abierta_en)),
  constraint crm_jornadas_actor_chk check ((creada_por_rol = 'admin' and creada_por_usuario is null) or (creada_por_rol = 'comercial' and creada_por_usuario is not null))
);
create unique index if not exists crm_jornadas_una_abierta_uidx on public.crm_jornadas (usuario_id) where cerrada_en is null;
create index if not exists crm_jornadas_usuario_fecha_idx on public.crm_jornadas (usuario_id, fecha desc);

-- ── 6. Visitas, oportunidades, notas y tareas ───────────────────────────────
create table if not exists public.crm_visitas (
  id                      uuid primary key default gen_random_uuid(),
  clave                   uuid not null,
  huella                  text not null,
  empresa_id              uuid not null references public.crm_empresas (id) on delete restrict,
  jornada_id              uuid not null references public.crm_jornadas (id) on delete restrict,
  oportunidad_id          uuid,
  realizada_por_usuario   uuid not null references public.crm_usuarios (id) on delete restrict,
  registrada_por_rol      text not null,
  registrada_por_usuario  uuid references public.crm_usuarios (id) on delete restrict,
  ocurrida_en             timestamptz not null,
  fecha                   date not null,
  registrada_en           timestamptz not null default now(),
  cerrado                 boolean not null default false,
  hablo_con_empleado      boolean not null default false,
  hablo_con_responsable   boolean not null default false,
  responsable_ausente     boolean not null default false,
  contacto_id             uuid references public.crm_contactos (id) on delete restrict,
  contacto_obtenido       boolean not null default false,
  hablo_con_contacto      boolean not null default false,
  contacto_es_decisor     text,
  contacto_canal_util     boolean,
  contacto_util           boolean generated always as (contacto_obtenido and coalesce(contacto_canal_util, false)) stored,
  decisor_contactado      boolean generated always as (hablo_con_contacto and coalesce(contacto_es_decisor = 'si', false)) stored,
  interes                 text,
  necesidades             text[] not null default '{}',
  necesidad_otra          text,
  pack_potencial          text,
  volver_otro_dia         boolean not null default false,
  revisita_para           date,
  observacion             text,
  creo_empresa            boolean not null default false,
  creo_contacto           boolean not null default false,
  creo_oportunidad        boolean not null default false,
  anulada_en              timestamptz,
  anulada_motivo          text,
  version                 integer not null default 1,
  actualizada_en          timestamptz not null default now(),
  constraint crm_visitas_clave_uk unique (clave),
  constraint crm_visitas_huella_chk check (huella ~ '^[0-9a-f]{64}$'),
  constraint crm_visitas_resultado_chk check (cerrado or hablo_con_empleado or hablo_con_responsable),
  constraint crm_visitas_cerrado_chk check (not cerrado or (not hablo_con_empleado and not hablo_con_responsable and not responsable_ausente
    and contacto_id is null and interes is null and necesidades = '{}' and pack_potencial is null)),
  constraint crm_visitas_responsable_chk check (not (responsable_ausente and hablo_con_responsable)),
  constraint crm_visitas_contacto_chk check (((contacto_obtenido or hablo_con_contacto) <= (contacto_id is not null))
    and ((contacto_id is null) = (contacto_es_decisor is null)) and ((contacto_id is null) = (contacto_canal_util is null))),
  constraint crm_visitas_decisor_chk check (contacto_es_decisor is null or contacto_es_decisor in ('si', 'no', 'no_sabe')),
  constraint crm_visitas_interes_chk check (interes is null or interes in ('sin_interes', 'frio', 'tibio', 'caliente')),
  constraint crm_visitas_necesidades_chk check (necesidades <@ array['fidelizacion', 'premio_compra', 'referidos', 'sorteos', 'redes',
    'beneficios_empleados', 'incentivos_desempeno', 'premios_comerciales', 'regalos', 'relaciones_clientes', 'otra']::text[]
    and (necesidad_otra is not null) = ('otra' = any (necesidades)) and coalesce(char_length(necesidad_otra), 0) <= 120),
  constraint crm_visitas_pack_chk check (pack_potencial is null or pack_potencial in ('10', '25', 'personalizado', 'no_determinado')),
  constraint crm_visitas_revisita_chk check (revisita_para is null or volver_otro_dia),
  constraint crm_visitas_observacion_chk check (observacion is null or char_length(observacion) <= 1000),
  constraint crm_visitas_anulacion_chk check ((anulada_en is null) = (anulada_motivo is null)),
  constraint crm_visitas_actor_chk check ((registrada_por_rol = 'admin' and registrada_por_usuario is null) or (registrada_por_rol = 'comercial' and registrada_por_usuario is not null))
);
create index if not exists crm_visitas_empresa_idx on public.crm_visitas (empresa_id, ocurrida_en desc);
create index if not exists crm_visitas_jornada_idx on public.crm_visitas (jornada_id);
create index if not exists crm_visitas_realizada_idx on public.crm_visitas (realizada_por_usuario, fecha desc);
create index if not exists crm_visitas_oportunidad_idx on public.crm_visitas (oportunidad_id) where oportunidad_id is not null;

create table if not exists public.crm_oportunidades (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references public.crm_empresas (id) on delete restrict,
  estado             text not null,
  origen_visita_id   uuid not null references public.crm_visitas (id) on delete restrict,
  origen_usuario_id  uuid not null references public.crm_usuarios (id) on delete restrict,
  contacto_id        uuid references public.crm_contactos (id) on delete restrict,
  lead_en            timestamptz not null,
  interesado_en      timestamptz,
  cerrada_en         timestamptz,
  cierre_motivo      text,
  version            integer not null default 1,
  creada_en          timestamptz not null default now(),
  actualizada_en     timestamptz not null default now(),
  constraint crm_oportunidades_estado_chk check (estado in ('contacto', 'interesado') and ((estado = 'interesado') = (interesado_en is not null))),
  constraint crm_oportunidades_cierre_chk check ((cerrada_en is null) = (cierre_motivo is null) and (cierre_motivo is null or cierre_motivo in ('origen_anulado')))
);
create unique index if not exists crm_oportunidades_una_abierta_uidx on public.crm_oportunidades (empresa_id) where cerrada_en is null;
create index if not exists crm_oportunidades_origen_idx on public.crm_oportunidades (origen_usuario_id, lead_en desc);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_visitas_oportunidad_fk') then
    alter table public.crm_visitas add constraint crm_visitas_oportunidad_fk
      foreign key (oportunidad_id) references public.crm_oportunidades (id) on delete restrict;
  end if;
end $$;

-- Observaciones agregadas después del registro: no reemplazan la visita original.
create table if not exists public.crm_visita_notas (
  id                  uuid primary key default gen_random_uuid(),
  visita_id           uuid not null references public.crm_visitas (id) on delete restrict,
  texto               text not null,
  creada_en           timestamptz not null default now(),
  creada_por_rol      text not null,
  creada_por_usuario  uuid references public.crm_usuarios (id) on delete restrict,
  constraint crm_visita_notas_texto_chk check (texto = btrim(texto) and char_length(texto) between 1 and 1000),
  constraint crm_visita_notas_actor_chk check ((creada_por_rol = 'admin' and creada_por_usuario is null) or (creada_por_rol = 'comercial' and creada_por_usuario is not null))
);
create index if not exists crm_visita_notas_visita_idx on public.crm_visita_notas (visita_id, creada_en);

-- Revisitas (tarea mínima). Una sola pendiente por negocio; la próxima visita al
-- negocio la da por hecha. vence_el NULL = "volver otro día" sin fecha elegida.
create table if not exists public.crm_tareas (
  id                    uuid primary key default gen_random_uuid(),
  empresa_id            uuid not null references public.crm_empresas (id) on delete restrict,
  oportunidad_id        uuid references public.crm_oportunidades (id) on delete restrict,
  tipo                  text not null default 'revisita',
  responsable_id        uuid not null references public.crm_usuarios (id) on delete restrict,
  vence_el              date,
  estado                text not null default 'pendiente',
  origen_visita_id      uuid references public.crm_visitas (id) on delete restrict,
  resuelta_visita_id    uuid references public.crm_visitas (id) on delete restrict,
  resuelta_en           timestamptz,
  cancelada_motivo      text,
  version               integer not null default 1,
  creada_en             timestamptz not null default now(),
  creada_por_rol        text not null,
  creada_por_usuario    uuid references public.crm_usuarios (id) on delete restrict,
  actualizada_en        timestamptz not null default now(),
  constraint crm_tareas_tipo_chk check (tipo = 'revisita'),
  constraint crm_tareas_estado_chk check (estado in ('pendiente', 'hecha', 'cancelada')
    and ((estado = 'hecha') = (resuelta_en is not null))
    and ((estado = 'cancelada') = (cancelada_motivo is not null))
    and (resuelta_visita_id is null or estado = 'hecha')),
  constraint crm_tareas_motivo_chk check (cancelada_motivo is null or char_length(cancelada_motivo) between 1 and 200),
  constraint crm_tareas_actor_chk check ((creada_por_rol = 'admin' and creada_por_usuario is null) or (creada_por_rol = 'comercial' and creada_por_usuario is not null))
);
create unique index if not exists crm_tareas_una_pendiente_uidx on public.crm_tareas (empresa_id) where estado = 'pendiente';
create index if not exists crm_tareas_responsable_idx on public.crm_tareas (responsable_id, estado, vence_el);

-- ── 7. Funciones internas de dominio (sin EXECUTE para nadie) ──────────────
create or replace function public.crm_actor_validar(p_rol text, p_usuario uuid)
returns void
language plpgsql
stable
set search_path = public
as $fn$
begin
  if p_rol = 'admin' and p_usuario is null then
    return;
  end if;
  if p_rol = 'comercial' and p_usuario is not null and exists (select 1 from public.crm_usuarios u where u.id = p_usuario and u.activo) then
    return;
  end if;
  raise exception 'actor_invalido' using errcode = '42501';
end
$fn$;

create or replace function public.crm_exigir_admin(p_rol text, p_usuario uuid)
returns void
language plpgsql
stable
set search_path = public
as $fn$
begin
  perform public.crm_actor_validar(p_rol, p_usuario);
  if p_rol <> 'admin' then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
end
$fn$;

create or replace function public.crm_auditar_entidad(p_rol text, p_usuario uuid, p_entidad text, p_id uuid, p_accion text, p_datos jsonb)
returns void
language sql
volatile
set search_path = public
as $fn$
  insert into public.crm_auditoria (actor_rol, actor_usuario_id, entidad, entidad_id, accion, datos)
  values (p_rol, p_usuario, p_entidad, p_id, p_accion, coalesce(p_datos, '{}'::jsonb))
$fn$;

-- Negocio visible y bloqueado para el actor. Comercial: solo los suyos, no archivados.
create or replace function public.crm_empresa_para_actor(p_id uuid, p_rol text, p_usuario uuid)
returns public.crm_empresas
language plpgsql
volatile
set search_path = public
as $fn$
declare
  v public.crm_empresas%rowtype;
begin
  select * into v from public.crm_empresas where id = p_id for update;
  if not found or (p_rol = 'comercial' and (v.responsable_id is distinct from p_usuario or v.archivada_en is not null)) then
    raise exception 'empresa_no_encontrada' using errcode = 'P0002';
  end if;
  return v;
end
$fn$;

-- Posibles duplicados: mismo nombre normalizado, uno prefijo del otro (4+ letras) o
-- misma dirección normalizada. Solo avisa: no fusiona ni bloquea.
create or replace function public.crm_empresas_similares(p_nombre_norm text, p_direccion_norm text, p_excluir uuid)
returns table (id uuid, nombre_comercial text, zona text, rubro text, direccion text, responsable_id uuid)
language sql
stable
set search_path = public
as $fn$
  select e.id, e.nombre_comercial, z.nombre, coalesce(r.nombre, e.rubro_detalle), e.direccion, e.responsable_id
    from public.crm_empresas e
    left join public.crm_zonas z on z.id = e.zona_id
    left join public.crm_rubros r on r.id = e.rubro_id
   where e.archivada_en is null
     and (p_excluir is null or e.id <> p_excluir)
     and (e.nombre_normalizado = p_nombre_norm
          or (char_length(p_nombre_norm) >= 4 and char_length(e.nombre_normalizado) >= 4
              and (e.nombre_normalizado like p_nombre_norm || '%' or p_nombre_norm like e.nombre_normalizado || '%'))
          or (p_direccion_norm is not null and e.direccion_normalizada = p_direccion_norm))
   order by e.nombre_comercial
   limit 5
$fn$;

-- Alta de negocio (la usan crm_empresa_crear y crm_visita_registrar). Con posibles
-- duplicados y sin confirmación, no escribe nada y devuelve los candidatos: los
-- propios (o todos, para admin) con id; los ajenos solo con nombre, zona, rubro y
-- si están asignados, sin id, dirección, contactos ni responsable.
create or replace function public.crm_empresa_insertar(p_datos jsonb, p_confirmar boolean, p_rol text, p_usuario uuid,
  p_responsable uuid, p_origen text, p_cliente_previo boolean)
returns jsonb
language plpgsql
volatile
set search_path = public
as $fn$
declare
  v_nombre text := public.crm_texto(p_datos, 'nombre_comercial', 120);
  v_rubro uuid := public.crm_uuid(p_datos, 'rubro_id');
  v_rubro_detalle text := public.crm_texto(p_datos, 'rubro_detalle', 80);
  v_direccion text := public.crm_texto(p_datos, 'direccion', 200);
  v_zona uuid := public.crm_uuid(p_datos, 'zona_id');
  v_instagram text := public.crm_texto(p_datos, 'instagram', 100);
  v_web text := public.crm_texto(p_datos, 'web', 200);
  v_prioridad text := public.crm_texto(p_datos, 'prioridad', 1);
  v_norm text;
  v_dir_norm text;
  v_candidatos jsonb;
  v_ids uuid[];
  v_id uuid;
begin
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'datos_invalidos:empresa' using errcode = '22023';
  end if;
  v_norm := public.crm_normalizar_texto(v_nombre);
  if v_nombre is null or v_norm is null then
    raise exception 'datos_invalidos:nombre_comercial' using errcode = '22023';
  end if;
  if v_rubro is not null and v_rubro_detalle is not null then
    raise exception 'datos_invalidos:rubro_detalle' using errcode = '22023';
  end if;
  if v_rubro is not null and not exists (select 1 from public.crm_rubros where id = v_rubro and activo) then
    raise exception 'datos_invalidos:rubro_id' using errcode = '22023';
  end if;
  if v_zona is not null and not exists (select 1 from public.crm_zonas where id = v_zona and activo) then
    raise exception 'datos_invalidos:zona_id' using errcode = '22023';
  end if;
  if v_prioridad is not null and v_prioridad not in ('A', 'B', 'C') then
    raise exception 'datos_invalidos:prioridad' using errcode = '22023';
  end if;
  v_dir_norm := public.crm_normalizar_texto(v_direccion);
  select coalesce(jsonb_agg(case when p_rol = 'admin' or s.responsable_id = p_usuario then
           jsonb_build_object('id', s.id, 'nombre_comercial', s.nombre_comercial, 'zona', s.zona, 'rubro', s.rubro, 'direccion', s.direccion,
             'asignacion', case when s.responsable_id is null then 'sin_asignar' when s.responsable_id = p_usuario then 'vos' else 'otra_persona' end)
         else jsonb_build_object('nombre_comercial', s.nombre_comercial, 'zona', s.zona, 'rubro', s.rubro,
             'asignacion', case when s.responsable_id is null then 'sin_asignar' else 'otra_persona' end) end), '[]'::jsonb),
         coalesce(array_agg(s.id), '{}')
    into v_candidatos, v_ids
    from public.crm_empresas_similares(v_norm, v_dir_norm, null) s;
  if cardinality(v_ids) > 0 and not coalesce(p_confirmar, false) then
    return jsonb_build_object('resultado', 'posible_duplicado', 'candidatos', v_candidatos);
  end if;
  insert into public.crm_empresas (nombre_comercial, nombre_normalizado, rubro_id, rubro_detalle, direccion, direccion_normalizada, zona_id,
    instagram, web, prioridad, responsable_id, cliente_previo, origen, similar_a, creada_por_rol, creada_por_usuario)
  values (v_nombre, v_norm, v_rubro, v_rubro_detalle, v_direccion, v_dir_norm, v_zona, v_instagram, v_web, v_prioridad, p_responsable,
    coalesce(p_cliente_previo, false), p_origen, v_ids, p_rol, p_usuario)
  returning id into v_id;
  perform public.crm_auditar_entidad(p_rol, p_usuario, 'crm_empresas', v_id, 'creacion',
    jsonb_build_object('origen', p_origen, 'responsable_id', p_responsable, 'similares', cardinality(v_ids)));
  return jsonb_build_object('resultado', 'ok', 'id', v_id);
end
$fn$;

-- Alta de contacto (la usan crm_contacto_crear y crm_visita_registrar).
create or replace function public.crm_contacto_insertar(p_empresa uuid, p_datos jsonb, p_rol text, p_usuario uuid)
returns uuid
language plpgsql
volatile
set search_path = public
as $fn$
declare
  v_nombre text := public.crm_texto(p_datos, 'nombre', 80);
  v_cargo text := public.crm_texto(p_datos, 'cargo', 80);
  v_tel text := public.crm_texto(p_datos, 'telefono', 40);
  v_wa boolean := public.crm_bool(p_datos, 'tiene_whatsapp');
  v_dec text := coalesce(public.crm_texto(p_datos, 'es_decisor', 10), 'no_sabe');
  v_norm text;
  v_id uuid;
begin
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'datos_invalidos:contacto' using errcode = '22023';
  end if;
  if v_nombre is null and v_tel is null then
    raise exception 'datos_invalidos:contacto' using errcode = '22023';
  end if;
  if v_dec not in ('si', 'no', 'no_sabe') then
    raise exception 'datos_invalidos:es_decisor' using errcode = '22023';
  end if;
  v_norm := public.crm_normalizar_telefono(v_tel);
  if v_tel is not null and (v_norm is null or v_norm !~ '^\d{6,15}$') then
    raise exception 'datos_invalidos:telefono' using errcode = '22023';
  end if;
  insert into public.crm_contactos (empresa_id, nombre, cargo, telefono, telefono_normalizado, tiene_whatsapp, es_decisor, creado_por_rol, creado_por_usuario)
  values (p_empresa, v_nombre, v_cargo, v_tel, v_norm, v_wa, v_dec, p_rol, p_usuario)
  returning id into v_id;
  perform public.crm_auditar_entidad(p_rol, p_usuario, 'crm_contactos', v_id, 'creacion', jsonb_build_object('empresa_id', p_empresa));
  return v_id;
end
$fn$;

-- Estado de una oportunidad abierta a partir de sus visitas vigentes (lo usan la
-- corrección y la anulación administrativas, que sí pueden bajar el estado).
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
   where id = p_id and cerrada_en is null and interesado_en is distinct from v_interesado;
end
$fn$;

-- Resultado de un registro de visita (el mismo para el original y sus reintentos).
create or replace function public.crm_visita_resultado(p_id uuid, p_repetida boolean)
returns jsonb
language sql
stable
set search_path = public
as $fn$
  select jsonb_build_object(
    'resultado', 'ok', 'repetida', p_repetida,
    'visita', jsonb_build_object('id', v.id, 'empresa_id', v.empresa_id, 'jornada_id', v.jornada_id, 'ocurrida_en', v.ocurrida_en,
      'fecha', v.fecha, 'contacto_util', v.contacto_util, 'decisor_contactado', v.decisor_contactado, 'interes', v.interes, 'version', v.version),
    'empresa_creada', v.creo_empresa, 'contacto_id', v.contacto_id, 'contacto_creado', v.creo_contacto,
    'oportunidad', case when o.id is null then null else jsonb_build_object('id', o.id, 'estado', o.estado, 'creada', v.creo_oportunidad,
      'origen_es_esta_visita', o.origen_visita_id = v.id) end,
    'tarea', (select jsonb_build_object('id', t.id, 'vence_el', t.vence_el) from public.crm_tareas t where t.origen_visita_id = v.id order by t.creada_en limit 1))
    from public.crm_visitas v
    left join public.crm_oportunidades o on o.id = v.oportunidad_id
   where v.id = p_id
$fn$;

-- ── 8. RPCs: catálogos (admin) ─────────────────────────────────────────────
create or replace function public.crm_catalogo_guardar(p_tipo text, p_id uuid, p_version integer, p_datos jsonb, p_actor_rol text, p_actor_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_nombre text := public.crm_texto(p_datos, 'nombre', 60);
  v_activo boolean := public.crm_bool(p_datos, 'activo');
  v_orden numeric := public.crm_numero(p_datos, 'orden', 10000);
  v_norm text := public.crm_normalizar_texto(v_nombre);
  v_id uuid;
  v_version integer;
begin
  perform public.crm_exigir_admin(p_actor_rol, p_actor_usuario);
  if p_tipo not in ('rubro', 'zona') then
    raise exception 'datos_invalidos:tipo' using errcode = '22023';
  end if;
  perform public.crm_claves_permitidas(p_datos, array['nombre', 'activo', 'orden']);
  if v_nombre is not null and v_norm is null then
    raise exception 'datos_invalidos:nombre' using errcode = '22023';
  end if;
  if v_orden is not null and v_orden <> trunc(v_orden) then
    raise exception 'datos_invalidos:orden' using errcode = '22023';
  end if;
  begin
    if p_id is null then
      if v_nombre is null then
        raise exception 'datos_invalidos:nombre' using errcode = '22023';
      end if;
      if p_tipo = 'rubro' then
        insert into public.crm_rubros (nombre, nombre_normalizado, activo, orden)
        values (v_nombre, v_norm, coalesce(v_activo, true), coalesce(v_orden::integer, 100)) returning id, version into v_id, v_version;
      else
        insert into public.crm_zonas (nombre, nombre_normalizado, activo, orden)
        values (v_nombre, v_norm, coalesce(v_activo, true), coalesce(v_orden::integer, 100)) returning id, version into v_id, v_version;
      end if;
      perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, case when p_tipo = 'rubro' then 'crm_rubros' else 'crm_zonas' end, v_id, 'creacion',
        jsonb_build_object('nombre', v_nombre));
    else
      if p_tipo = 'rubro' then
        update public.crm_rubros set nombre = coalesce(v_nombre, nombre), nombre_normalizado = coalesce(v_norm, nombre_normalizado),
               activo = coalesce(v_activo, activo), orden = coalesce(v_orden::integer, orden), version = version + 1, actualizado_en = now()
         where id = p_id and version = p_version returning id, version into v_id, v_version;
      else
        update public.crm_zonas set nombre = coalesce(v_nombre, nombre), nombre_normalizado = coalesce(v_norm, nombre_normalizado),
               activo = coalesce(v_activo, activo), orden = coalesce(v_orden::integer, orden), version = version + 1, actualizado_en = now()
         where id = p_id and version = p_version returning id, version into v_id, v_version;
      end if;
      if v_id is null then
        if (p_tipo = 'rubro' and exists (select 1 from public.crm_rubros where id = p_id))
           or (p_tipo = 'zona' and exists (select 1 from public.crm_zonas where id = p_id)) then
          raise exception 'version_desactualizada' using errcode = '40001';
        end if;
        raise exception 'no_encontrado' using errcode = 'P0002';
      end if;
      perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, case when p_tipo = 'rubro' then 'crm_rubros' else 'crm_zonas' end, v_id, 'actualizacion',
        jsonb_build_object('nombre', v_nombre, 'activo', v_activo));
    end if;
  exception when unique_violation then
    raise exception 'nombre_existente' using errcode = '23505';
  end;
  return jsonb_build_object('id', v_id, 'version', v_version);
end
$fn$;

-- ── 9. RPCs: negocios y contactos ───────────────────────────────────────────
-- Comercial: el negocio queda asignado a él; no puede fijar responsable ni cliente previo.
create or replace function public.crm_empresa_crear(p_datos jsonb, p_confirmar_duplicado boolean, p_actor_rol text, p_actor_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_responsable uuid;
begin
  perform public.crm_actor_validar(p_actor_rol, p_actor_usuario);
  perform public.crm_claves_permitidas(p_datos, array['nombre_comercial', 'rubro_id', 'rubro_detalle', 'direccion', 'zona_id', 'instagram', 'web',
    'prioridad', 'responsable_id', 'cliente_previo']);
  if p_actor_rol = 'comercial' then
    if (p_datos ? 'responsable_id') or (p_datos ? 'cliente_previo') then
      raise exception 'no_autorizado' using errcode = '42501';
    end if;
    return public.crm_empresa_insertar(p_datos, p_confirmar_duplicado, p_actor_rol, p_actor_usuario, p_actor_usuario, 'manual', false);
  end if;
  v_responsable := public.crm_uuid(p_datos, 'responsable_id');
  if v_responsable is not null and not exists (select 1 from public.crm_usuarios where id = v_responsable and activo) then
    raise exception 'datos_invalidos:responsable_id' using errcode = '22023';
  end if;
  return public.crm_empresa_insertar(p_datos, p_confirmar_duplicado, p_actor_rol, p_actor_usuario, v_responsable, 'manual',
    coalesce(public.crm_bool(p_datos, 'cliente_previo'), false));
end
$fn$;

create or replace function public.crm_empresa_actualizar(p_id uuid, p_version integer, p_cambios jsonb, p_actor_rol text, p_actor_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v public.crm_empresas%rowtype;
  v_nombre text;
  v_rubro uuid;
  v_detalle text;
  v_zona uuid;
  v_prioridad text;
  v_responsable uuid;
  v_cambiados text[];
begin
  perform public.crm_actor_validar(p_actor_rol, p_actor_usuario);
  perform public.crm_claves_permitidas(p_cambios, array['nombre_comercial', 'rubro_id', 'rubro_detalle', 'direccion', 'zona_id', 'instagram', 'web',
    'prioridad', 'responsable_id', 'cliente_previo']);
  if p_actor_rol = 'comercial' and ((p_cambios ? 'responsable_id') or (p_cambios ? 'cliente_previo')) then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  v := public.crm_empresa_para_actor(p_id, p_actor_rol, p_actor_usuario);
  if v.version <> p_version then
    raise exception 'version_desactualizada' using errcode = '40001';
  end if;
  select array_agg(k) into v_cambiados from jsonb_object_keys(p_cambios) k;
  if p_cambios ? 'nombre_comercial' then
    v_nombre := public.crm_texto(p_cambios, 'nombre_comercial', 120);
    if v_nombre is null or public.crm_normalizar_texto(v_nombre) is null then
      raise exception 'datos_invalidos:nombre_comercial' using errcode = '22023';
    end if;
    v.nombre_comercial := v_nombre;
    v.nombre_normalizado := public.crm_normalizar_texto(v_nombre);
  end if;
  if p_cambios ? 'rubro_id' then
    v_rubro := public.crm_uuid(p_cambios, 'rubro_id');
    if v_rubro is not null and not exists (select 1 from public.crm_rubros where id = v_rubro and activo) then
      raise exception 'datos_invalidos:rubro_id' using errcode = '22023';
    end if;
    v.rubro_id := v_rubro;
    if v_rubro is not null then
      v.rubro_detalle := null;
    end if;
  end if;
  if p_cambios ? 'rubro_detalle' then
    v_detalle := public.crm_texto(p_cambios, 'rubro_detalle', 80);
    if v_detalle is not null and v.rubro_id is not null then
      raise exception 'datos_invalidos:rubro_detalle' using errcode = '22023';
    end if;
    v.rubro_detalle := v_detalle;
  end if;
  if p_cambios ? 'direccion' then
    v.direccion := public.crm_texto(p_cambios, 'direccion', 200);
    v.direccion_normalizada := public.crm_normalizar_texto(v.direccion);
  end if;
  if p_cambios ? 'zona_id' then
    v_zona := public.crm_uuid(p_cambios, 'zona_id');
    if v_zona is not null and not exists (select 1 from public.crm_zonas where id = v_zona and activo) then
      raise exception 'datos_invalidos:zona_id' using errcode = '22023';
    end if;
    v.zona_id := v_zona;
  end if;
  if p_cambios ? 'instagram' then
    v.instagram := public.crm_texto(p_cambios, 'instagram', 100);
  end if;
  if p_cambios ? 'web' then
    v.web := public.crm_texto(p_cambios, 'web', 200);
  end if;
  if p_cambios ? 'prioridad' then
    v_prioridad := public.crm_texto(p_cambios, 'prioridad', 1);
    if v_prioridad is not null and v_prioridad not in ('A', 'B', 'C') then
      raise exception 'datos_invalidos:prioridad' using errcode = '22023';
    end if;
    v.prioridad := v_prioridad;
  end if;
  if p_cambios ? 'cliente_previo' then
    v.cliente_previo := coalesce(public.crm_bool(p_cambios, 'cliente_previo'), false);
  end if;
  if p_cambios ? 'responsable_id' then
    v_responsable := public.crm_uuid(p_cambios, 'responsable_id');
    if v_responsable is not null and not exists (select 1 from public.crm_usuarios where id = v_responsable and activo) then
      raise exception 'datos_invalidos:responsable_id' using errcode = '22023';
    end if;
    if v_responsable is distinct from v.responsable_id then
      perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_empresas', p_id, 'asignacion',
        jsonb_build_object('antes', v.responsable_id, 'despues', v_responsable));
    end if;
    v.responsable_id := v_responsable;
  end if;
  update public.crm_empresas
     set nombre_comercial = v.nombre_comercial, nombre_normalizado = v.nombre_normalizado, rubro_id = v.rubro_id, rubro_detalle = v.rubro_detalle,
         direccion = v.direccion, direccion_normalizada = v.direccion_normalizada, zona_id = v.zona_id, instagram = v.instagram, web = v.web,
         prioridad = v.prioridad, cliente_previo = v.cliente_previo, responsable_id = v.responsable_id, version = version + 1, actualizada_en = now()
   where id = p_id
  returning version into v.version;
  perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_empresas', p_id, 'actualizacion', jsonb_build_object('campos', to_jsonb(v_cambiados)));
  return jsonb_build_object('id', p_id, 'version', v.version);
end
$fn$;

create or replace function public.crm_empresa_archivar(p_id uuid, p_version integer, p_archivar boolean, p_motivo text, p_actor_rol text, p_actor_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v public.crm_empresas%rowtype;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  perform public.crm_exigir_admin(p_actor_rol, p_actor_usuario);
  v := public.crm_empresa_para_actor(p_id, p_actor_rol, p_actor_usuario);
  if v.version <> p_version then
    raise exception 'version_desactualizada' using errcode = '40001';
  end if;
  if p_archivar is null or p_archivar = (v.archivada_en is not null) then
    raise exception 'sin_cambio' using errcode = '55000';
  end if;
  if p_archivar and (v_motivo is null or char_length(v_motivo) > 300) then
    raise exception 'datos_invalidos:motivo' using errcode = '22023';
  end if;
  update public.crm_empresas
     set archivada_en = case when p_archivar then now() end, archivada_motivo = case when p_archivar then v_motivo end,
         version = version + 1, actualizada_en = now()
   where id = p_id
  returning version into v.version;
  perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_empresas', p_id, case when p_archivar then 'archivo' else 'desarchivo' end,
    jsonb_build_object('motivo', v_motivo));
  return jsonb_build_object('id', p_id, 'version', v.version);
end
$fn$;

create or replace function public.crm_contacto_crear(p_empresa uuid, p_datos jsonb, p_actor_rol text, p_actor_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v public.crm_empresas%rowtype;
  v_id uuid;
begin
  perform public.crm_actor_validar(p_actor_rol, p_actor_usuario);
  perform public.crm_claves_permitidas(p_datos, array['nombre', 'cargo', 'telefono', 'tiene_whatsapp', 'es_decisor']);
  v := public.crm_empresa_para_actor(p_empresa, p_actor_rol, p_actor_usuario);
  if v.archivada_en is not null then
    raise exception 'empresa_archivada' using errcode = '55000';
  end if;
  v_id := public.crm_contacto_insertar(p_empresa, p_datos, p_actor_rol, p_actor_usuario);
  return jsonb_build_object('id', v_id, 'version', 1);
end
$fn$;

create or replace function public.crm_contacto_actualizar(p_id uuid, p_version integer, p_cambios jsonb, p_actor_rol text, p_actor_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c public.crm_contactos%rowtype;
  v_norm text;
  v_dec text;
  v_archivar boolean;
begin
  perform public.crm_actor_validar(p_actor_rol, p_actor_usuario);
  perform public.crm_claves_permitidas(p_cambios, array['nombre', 'cargo', 'telefono', 'tiene_whatsapp', 'es_decisor', 'archivado']);
  select * into c from public.crm_contactos where id = p_id for update;
  if not found then
    raise exception 'contacto_no_encontrado' using errcode = 'P0002';
  end if;
  begin
    perform public.crm_empresa_para_actor(c.empresa_id, p_actor_rol, p_actor_usuario);
  exception when others then
    raise exception 'contacto_no_encontrado' using errcode = 'P0002';
  end;
  if c.version <> p_version then
    raise exception 'version_desactualizada' using errcode = '40001';
  end if;
  if p_cambios ? 'nombre' then
    c.nombre := public.crm_texto(p_cambios, 'nombre', 80);
  end if;
  if p_cambios ? 'cargo' then
    c.cargo := public.crm_texto(p_cambios, 'cargo', 80);
  end if;
  if p_cambios ? 'telefono' then
    c.telefono := public.crm_texto(p_cambios, 'telefono', 40);
    v_norm := public.crm_normalizar_telefono(c.telefono);
    if c.telefono is not null and (v_norm is null or v_norm !~ '^\d{6,15}$') then
      raise exception 'datos_invalidos:telefono' using errcode = '22023';
    end if;
    c.telefono_normalizado := v_norm;
  end if;
  if p_cambios ? 'tiene_whatsapp' then
    c.tiene_whatsapp := public.crm_bool(p_cambios, 'tiene_whatsapp');
  end if;
  if p_cambios ? 'es_decisor' then
    v_dec := public.crm_texto(p_cambios, 'es_decisor', 10);
    if v_dec is null or v_dec not in ('si', 'no', 'no_sabe') then
      raise exception 'datos_invalidos:es_decisor' using errcode = '22023';
    end if;
    c.es_decisor := v_dec;
  end if;
  if p_cambios ? 'archivado' then
    v_archivar := public.crm_bool(p_cambios, 'archivado');
    if v_archivar is null then
      raise exception 'datos_invalidos:archivado' using errcode = '22023';
    end if;
    c.archivado_en := case when v_archivar then coalesce(c.archivado_en, now()) end;
  end if;
  if c.nombre is null and c.telefono is null then
    raise exception 'datos_invalidos:contacto' using errcode = '22023';
  end if;
  update public.crm_contactos
     set nombre = c.nombre, cargo = c.cargo, telefono = c.telefono, telefono_normalizado = c.telefono_normalizado, tiene_whatsapp = c.tiene_whatsapp,
         es_decisor = c.es_decisor, archivado_en = c.archivado_en, version = version + 1, actualizado_en = now()
   where id = p_id
  returning version into c.version;
  perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_contactos', p_id, 'actualizacion',
    jsonb_build_object('campos', (select to_jsonb(array_agg(k)) from jsonb_object_keys(p_cambios) k)));
  return jsonb_build_object('id', p_id, 'version', c.version);
end
$fn$;

-- ── 10. RPCs: jornadas ──────────────────────────────────────────────────────
-- Comercial: abre SU jornada hoy (día de SIM); una sola abierta. Admin: carga una
-- jornada ya realizada de un comercial (fecha elegida, queda cerrada).
create or replace function public.crm_jornada_crear(p_datos jsonb, p_actor_rol text, p_actor_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_usuario uuid;
  v_fecha date;
  v_id uuid;
  v_version integer;
begin
  perform public.crm_actor_validar(p_actor_rol, p_actor_usuario);
  perform public.crm_claves_permitidas(p_datos, array['usuario_id', 'fecha', 'nombre', 'zona_id', 'km_inicial', 'km_final', 'combustible_cantidad',
    'combustible_unidad', 'combustible_importe', 'estacionamiento_importe', 'peajes_importe', 'otros_importe', 'otros_detalle']);
  if p_actor_rol = 'comercial' then
    if (p_datos ? 'usuario_id') or (p_datos ? 'fecha') or (p_datos ? 'km_final') then
      raise exception 'datos_invalidos:jornada' using errcode = '22023';
    end if;
    v_usuario := p_actor_usuario;
    v_fecha := public.crm_fecha_sim(now());
  else
    v_usuario := public.crm_uuid(p_datos, 'usuario_id');
    v_fecha := public.crm_fecha(p_datos, 'fecha');
    if v_usuario is null or not exists (select 1 from public.crm_usuarios where id = v_usuario) then
      raise exception 'datos_invalidos:usuario_id' using errcode = '22023';
    end if;
    if v_fecha is null or v_fecha > public.crm_fecha_sim(now()) then
      raise exception 'datos_invalidos:fecha' using errcode = '22023';
    end if;
  end if;
  if public.crm_uuid(p_datos, 'zona_id') is not null and not exists (select 1 from public.crm_zonas where id = public.crm_uuid(p_datos, 'zona_id') and activo) then
    raise exception 'datos_invalidos:zona_id' using errcode = '22023';
  end if;
  if public.crm_numero(p_datos, 'combustible_cantidad', 1000) is not null and public.crm_texto(p_datos, 'combustible_unidad', 10) is null then
    raise exception 'datos_invalidos:combustible_unidad' using errcode = '22023';
  end if;
  begin
    insert into public.crm_jornadas (usuario_id, fecha, nombre, zona_id, km_inicial, km_final, combustible_cantidad, combustible_unidad,
      combustible_importe, estacionamiento_importe, peajes_importe, otros_importe, otros_detalle, cerrada_en, cerrada_por_rol, creada_por_rol, creada_por_usuario)
    values (v_usuario, v_fecha, public.crm_texto(p_datos, 'nombre', 80), public.crm_uuid(p_datos, 'zona_id'),
      public.crm_numero(p_datos, 'km_inicial', 9999999), public.crm_numero(p_datos, 'km_final', 9999999),
      public.crm_numero(p_datos, 'combustible_cantidad', 1000), public.crm_texto(p_datos, 'combustible_unidad', 10),
      public.crm_numero(p_datos, 'combustible_importe', 100000000), public.crm_numero(p_datos, 'estacionamiento_importe', 100000000),
      public.crm_numero(p_datos, 'peajes_importe', 100000000), public.crm_numero(p_datos, 'otros_importe', 100000000), public.crm_texto(p_datos, 'otros_detalle', 200),
      case when p_actor_rol = 'admin' then now() end, case when p_actor_rol = 'admin' then 'admin' end, p_actor_rol, p_actor_usuario)
    returning id, version into v_id, v_version;
  exception
    when unique_violation then
      raise exception 'jornada_abierta' using errcode = '23505';
    when check_violation then
      raise exception 'datos_invalidos:jornada' using errcode = '22023';
  end;
  perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_jornadas', v_id, case when p_actor_rol = 'comercial' then 'apertura' else 'creacion' end,
    jsonb_build_object('usuario_id', v_usuario, 'fecha', v_fecha));
  return jsonb_build_object('id', v_id, 'version', v_version);
end
$fn$;

-- Kilómetros y gastos: NULL = sin cargar, 0 = cero confirmado. Se pueden completar
-- con la jornada abierta o cerrada. p_cerrar cierra (no se cierra sola nunca).
create or replace function public.crm_jornada_actualizar(p_id uuid, p_version integer, p_cambios jsonb, p_cerrar boolean, p_actor_rol text, p_actor_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  j public.crm_jornadas%rowtype;
  v_zona uuid;
begin
  perform public.crm_actor_validar(p_actor_rol, p_actor_usuario);
  perform public.crm_claves_permitidas(coalesce(p_cambios, '{}'::jsonb), array['nombre', 'zona_id', 'km_inicial', 'km_final', 'combustible_cantidad',
    'combustible_unidad', 'combustible_importe', 'estacionamiento_importe', 'peajes_importe', 'otros_importe', 'otros_detalle']);
  select * into j from public.crm_jornadas where id = p_id for update;
  if not found or (p_actor_rol = 'comercial' and j.usuario_id <> p_actor_usuario) then
    raise exception 'jornada_no_encontrada' using errcode = 'P0002';
  end if;
  if j.version <> p_version then
    raise exception 'version_desactualizada' using errcode = '40001';
  end if;
  if coalesce(p_cerrar, false) and j.cerrada_en is not null then
    raise exception 'jornada_cerrada' using errcode = '55000';
  end if;
  p_cambios := coalesce(p_cambios, '{}'::jsonb);
  if p_cambios ? 'nombre' then j.nombre := public.crm_texto(p_cambios, 'nombre', 80); end if;
  if p_cambios ? 'zona_id' then
    v_zona := public.crm_uuid(p_cambios, 'zona_id');
    if v_zona is not null and not exists (select 1 from public.crm_zonas where id = v_zona and activo) then
      raise exception 'datos_invalidos:zona_id' using errcode = '22023';
    end if;
    j.zona_id := v_zona;
  end if;
  if p_cambios ? 'km_inicial' then j.km_inicial := public.crm_numero(p_cambios, 'km_inicial', 9999999); end if;
  if p_cambios ? 'km_final' then j.km_final := public.crm_numero(p_cambios, 'km_final', 9999999); end if;
  if p_cambios ? 'combustible_cantidad' then j.combustible_cantidad := public.crm_numero(p_cambios, 'combustible_cantidad', 1000); end if;
  if p_cambios ? 'combustible_unidad' then j.combustible_unidad := public.crm_texto(p_cambios, 'combustible_unidad', 10); end if;
  if p_cambios ? 'combustible_importe' then j.combustible_importe := public.crm_numero(p_cambios, 'combustible_importe', 100000000); end if;
  if p_cambios ? 'estacionamiento_importe' then j.estacionamiento_importe := public.crm_numero(p_cambios, 'estacionamiento_importe', 100000000); end if;
  if p_cambios ? 'peajes_importe' then j.peajes_importe := public.crm_numero(p_cambios, 'peajes_importe', 100000000); end if;
  if p_cambios ? 'otros_importe' then j.otros_importe := public.crm_numero(p_cambios, 'otros_importe', 100000000); end if;
  if p_cambios ? 'otros_detalle' then j.otros_detalle := public.crm_texto(p_cambios, 'otros_detalle', 200); end if;
  if j.km_inicial is not null and j.km_final is not null and j.km_final < j.km_inicial then
    raise exception 'km_final_menor' using errcode = '22023';
  end if;
  if (j.combustible_cantidad is null) <> (j.combustible_unidad is null) or (j.combustible_unidad is not null and j.combustible_unidad not in ('litros', 'm3')) then
    raise exception 'datos_invalidos:combustible_unidad' using errcode = '22023';
  end if;
  update public.crm_jornadas
     set nombre = j.nombre, zona_id = j.zona_id, km_inicial = j.km_inicial, km_final = j.km_final, combustible_cantidad = j.combustible_cantidad,
         combustible_unidad = j.combustible_unidad, combustible_importe = j.combustible_importe, estacionamiento_importe = j.estacionamiento_importe,
         peajes_importe = j.peajes_importe, otros_importe = j.otros_importe, otros_detalle = j.otros_detalle,
         cerrada_en = case when coalesce(p_cerrar, false) then now() else cerrada_en end,
         cerrada_por_rol = case when coalesce(p_cerrar, false) then p_actor_rol else cerrada_por_rol end,
         cerrada_por_usuario = case when coalesce(p_cerrar, false) then p_actor_usuario else cerrada_por_usuario end,
         version = version + 1, actualizada_en = now()
   where id = p_id
  returning version into j.version;
  if (select count(*) from jsonb_object_keys(p_cambios)) > 0 then
    perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_jornadas', p_id, 'actualizacion',
      jsonb_build_object('campos', (select to_jsonb(array_agg(k)) from jsonb_object_keys(p_cambios) k)));
  end if;
  if coalesce(p_cerrar, false) then
    perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_jornadas', p_id, 'cierre', '{}'::jsonb);
  end if;
  return jsonb_build_object('id', p_id, 'version', j.version);
end
$fn$;

-- ── 11. RPC: registrar una visita (atómica e idempotente) ──────────────────
-- p_huella = SHA-256 del contenido normalizado (la calcula el servidor). Reintento con
-- la misma clave y la misma huella del mismo actor → el mismo resultado; con otra
-- huella u otro actor → clave_reutilizada. Con posible duplicado de negocio y sin
-- confirmación, no escribe nada y devuelve los candidatos.
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
  if not v_hay_opp and v_obtenido and v_canal then
    insert into public.crm_oportunidades (empresa_id, estado, origen_visita_id, origen_usuario_id, contacto_id, lead_en, interesado_en)
    values (v_emp, case when v_interes in ('tibio', 'caliente') then 'interesado' else 'contacto' end, v_visita, v_realizada, v_contacto_id,
      v_ocurrida, case when v_interes in ('tibio', 'caliente') then v_ocurrida end)
    returning * into v_opp;
    v_hay_opp := true;
    v_creo_opp := true;
    perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_oportunidades', v_opp.id, 'creacion',
      jsonb_build_object('empresa_id', v_emp, 'origen_visita_id', v_visita, 'origen_usuario_id', v_realizada, 'estado', v_opp.estado));
  elsif v_hay_opp and v_opp.estado = 'contacto' and v_interes in ('tibio', 'caliente') then
    update public.crm_oportunidades set estado = 'interesado', interesado_en = v_ocurrida, version = version + 1, actualizada_en = now()
     where id = v_opp.id returning * into v_opp;
  end if;
  if v_hay_opp then
    update public.crm_visitas set oportunidad_id = v_opp.id, creo_oportunidad = v_creo_opp where id = v_visita;
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

-- ── 12. RPCs: correcciones (admin), notas y tareas ──────────────────────────
-- Corrección administrativa con motivo: interés, necesidades, pack, observación y
-- jornada. Lo que cambia quién obtuvo el contacto o el resultado no se corrige: se
-- anula y se vuelve a registrar.
create or replace function public.crm_visita_corregir(p_id uuid, p_version integer, p_cambios jsonb, p_motivo text, p_actor_rol text, p_actor_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v public.crm_visitas%rowtype;
  a public.crm_visitas%rowtype;
  j public.crm_jornadas%rowtype;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  perform public.crm_exigir_admin(p_actor_rol, p_actor_usuario);
  perform public.crm_claves_permitidas(p_cambios, array['interes', 'necesidades', 'necesidad_otra', 'pack_potencial', 'observacion', 'jornada_id']);
  if v_motivo is null or char_length(v_motivo) > 300 then
    raise exception 'datos_invalidos:motivo' using errcode = '22023';
  end if;
  select * into v from public.crm_visitas where id = p_id for update;
  if not found then
    raise exception 'visita_no_encontrada' using errcode = 'P0002';
  end if;
  if v.anulada_en is not null then
    raise exception 'visita_anulada' using errcode = '55000';
  end if;
  if v.version <> p_version then
    raise exception 'version_desactualizada' using errcode = '40001';
  end if;
  a := v;
  if p_cambios ? 'interes' then v.interes := public.crm_texto(p_cambios, 'interes', 20); end if;
  if p_cambios ? 'pack_potencial' then v.pack_potencial := public.crm_texto(p_cambios, 'pack_potencial', 20); end if;
  if p_cambios ? 'observacion' then v.observacion := public.crm_texto(p_cambios, 'observacion', 1000); end if;
  if p_cambios ? 'necesidades' then
    if jsonb_typeof(p_cambios -> 'necesidades') <> 'array' or exists (select 1 from jsonb_array_elements(p_cambios -> 'necesidades') e where jsonb_typeof(e) <> 'string') then
      raise exception 'datos_invalidos:necesidades' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct x order by x), '{}') into v.necesidades from jsonb_array_elements_text(p_cambios -> 'necesidades') x;
  end if;
  if p_cambios ? 'necesidad_otra' then v.necesidad_otra := public.crm_texto(p_cambios, 'necesidad_otra', 120); end if;
  if not ('otra' = any (v.necesidades)) then v.necesidad_otra := null; end if;
  if p_cambios ? 'jornada_id' then
    select * into j from public.crm_jornadas where id = public.crm_uuid(p_cambios, 'jornada_id') for update;
    if not found or j.usuario_id <> v.realizada_por_usuario then
      raise exception 'jornada_no_encontrada' using errcode = 'P0002';
    end if;
    if v.fecha < j.fecha or v.fecha > j.fecha + 1 then
      raise exception 'jornada_de_otra_fecha' using errcode = '55000';
    end if;
    v.jornada_id := j.id;
  end if;
  begin
    update public.crm_visitas
       set interes = v.interes, necesidades = v.necesidades, necesidad_otra = v.necesidad_otra, pack_potencial = v.pack_potencial,
           observacion = v.observacion, jornada_id = v.jornada_id, version = version + 1, actualizada_en = now()
     where id = p_id
    returning version into v.version;
  exception when check_violation then
    raise exception 'datos_invalidos:correccion' using errcode = '22023';
  end;
  if v.oportunidad_id is not null then
    perform public.crm_oportunidad_recalcular(v.oportunidad_id);
  end if;
  perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_visitas', p_id, 'correccion', jsonb_build_object(
    'motivo', v_motivo,
    'antes', jsonb_build_object('interes', a.interes, 'necesidades', a.necesidades, 'pack_potencial', a.pack_potencial, 'jornada_id', a.jornada_id),
    'despues', jsonb_build_object('interes', v.interes, 'necesidades', v.necesidades, 'pack_potencial', v.pack_potencial, 'jornada_id', v.jornada_id),
    'observacion_cambiada', a.observacion is distinct from v.observacion));
  return jsonb_build_object('id', p_id, 'version', v.version);
end
$fn$;

-- Anulación administrativa con motivo. Si la visita originó una oportunidad
-- abierta, hay que decir qué pasa con ella, en la misma operación:
--   'cerrar_oportunidad' → se cierra con motivo origen_anulado (no se borra);
--   'reasignar_origen'   → el origen pasa a otra visita vigente de esa misma
--                          oportunidad que tenga contacto útil (explícita).
-- Las revisitas que creó se cancelan; la que había resuelto vuelve a pendiente si
-- el negocio no tiene otra.
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
         set origen_visita_id = n.id, origen_usuario_id = n.realizada_por_usuario, lead_en = n.ocurrida_en, contacto_id = n.contacto_id,
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

-- Observación posterior: comercial sobre sus visitas en negocios suyos; admin sobre cualquiera.
create or replace function public.crm_visita_nota_agregar(p_visita uuid, p_texto text, p_actor_rol text, p_actor_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v public.crm_visitas%rowtype;
  v_texto text := nullif(btrim(coalesce(p_texto, '')), '');
  v_id uuid;
begin
  perform public.crm_actor_validar(p_actor_rol, p_actor_usuario);
  select * into v from public.crm_visitas where id = p_visita;
  if not found then
    raise exception 'visita_no_encontrada' using errcode = 'P0002';
  end if;
  if p_actor_rol = 'comercial' then
    if v.realizada_por_usuario <> p_actor_usuario then
      raise exception 'visita_no_encontrada' using errcode = 'P0002';
    end if;
    begin
      perform public.crm_empresa_para_actor(v.empresa_id, p_actor_rol, p_actor_usuario);
    exception when others then
      raise exception 'visita_no_encontrada' using errcode = 'P0002';
    end;
  end if;
  if v_texto is null or char_length(v_texto) > 1000 then
    raise exception 'datos_invalidos:texto' using errcode = '22023';
  end if;
  insert into public.crm_visita_notas (visita_id, texto, creada_por_rol, creada_por_usuario)
  values (p_visita, v_texto, p_actor_rol, p_actor_usuario) returning id into v_id;
  perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_visitas', p_visita, 'nota', jsonb_build_object('nota_id', v_id));
  return jsonb_build_object('id', v_id);
end
$fn$;

-- Revisita: reprogramar o cancelar. Comercial: solo las suyas en negocios suyos.
create or replace function public.crm_tarea_actualizar(p_id uuid, p_version integer, p_accion text, p_vence_el date, p_motivo text,
  p_actor_rol text, p_actor_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  t public.crm_tareas%rowtype;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  perform public.crm_actor_validar(p_actor_rol, p_actor_usuario);
  select * into t from public.crm_tareas where id = p_id for update;
  if not found or (p_actor_rol = 'comercial' and t.responsable_id <> p_actor_usuario) then
    raise exception 'tarea_no_encontrada' using errcode = 'P0002';
  end if;
  if p_actor_rol = 'comercial' then
    begin
      perform public.crm_empresa_para_actor(t.empresa_id, p_actor_rol, p_actor_usuario);
    exception when others then
      raise exception 'tarea_no_encontrada' using errcode = 'P0002';
    end;
  end if;
  if t.version <> p_version then
    raise exception 'version_desactualizada' using errcode = '40001';
  end if;
  if t.estado <> 'pendiente' then
    raise exception 'sin_cambio' using errcode = '55000';
  end if;
  if p_accion = 'reprogramar' then
    if p_vence_el is not null and p_vence_el < public.crm_fecha_sim(now()) then
      raise exception 'revisita_fecha_pasada' using errcode = '22023';
    end if;
    update public.crm_tareas set vence_el = p_vence_el, version = version + 1, actualizada_en = now() where id = p_id returning version into t.version;
    perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_tareas', p_id, 'reprogramacion', jsonb_build_object('vence_el', p_vence_el));
  elsif p_accion = 'cancelar' then
    if v_motivo is null or char_length(v_motivo) > 200 then
      raise exception 'datos_invalidos:motivo' using errcode = '22023';
    end if;
    update public.crm_tareas set estado = 'cancelada', cancelada_motivo = v_motivo, version = version + 1, actualizada_en = now()
     where id = p_id returning version into t.version;
    perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_tareas', p_id, 'cancelacion', '{}'::jsonb);
  else
    raise exception 'datos_invalidos:accion' using errcode = '22023';
  end if;
  return jsonb_build_object('id', p_id, 'version', t.version);
end
$fn$;

-- ── 13. Seguridad: RLS y privilegios explícitos ────────────────────────────
alter table public.crm_rubros enable row level security;
alter table public.crm_zonas enable row level security;
alter table public.crm_empresas enable row level security;
alter table public.crm_contactos enable row level security;
alter table public.crm_jornadas enable row level security;
alter table public.crm_visitas enable row level security;
alter table public.crm_oportunidades enable row level security;
alter table public.crm_visita_notas enable row level security;
alter table public.crm_tareas enable row level security;

revoke all on table public.crm_rubros, public.crm_zonas, public.crm_empresas, public.crm_contactos, public.crm_jornadas, public.crm_visitas,
  public.crm_oportunidades, public.crm_visita_notas, public.crm_tareas from public, anon, authenticated, service_role;
grant select on table public.crm_rubros, public.crm_zonas, public.crm_empresas, public.crm_contactos, public.crm_jornadas, public.crm_visitas,
  public.crm_oportunidades, public.crm_visita_notas, public.crm_tareas to service_role;

revoke all on function public.crm_normalizar_texto(text) from public, anon, authenticated, service_role;
revoke all on function public.crm_normalizar_telefono(text) from public, anon, authenticated, service_role;
revoke all on function public.crm_fecha_sim(timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.crm_texto(jsonb, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.crm_uuid(jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.crm_bool(jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.crm_numero(jsonb, text, numeric) from public, anon, authenticated, service_role;
revoke all on function public.crm_fecha(jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.crm_claves_permitidas(jsonb, text[]) from public, anon, authenticated, service_role;
revoke all on function public.crm_actor_validar(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.crm_exigir_admin(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.crm_auditar_entidad(text, uuid, text, uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.crm_empresa_para_actor(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.crm_empresas_similares(text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.crm_empresa_insertar(jsonb, boolean, text, uuid, uuid, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.crm_contacto_insertar(uuid, jsonb, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.crm_oportunidad_recalcular(uuid) from public, anon, authenticated, service_role;
revoke all on function public.crm_visita_resultado(uuid, boolean) from public, anon, authenticated, service_role;

revoke all on function public.crm_catalogo_guardar(text, uuid, integer, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.crm_empresa_crear(jsonb, boolean, text, uuid) from public, anon, authenticated;
revoke all on function public.crm_empresa_actualizar(uuid, integer, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.crm_empresa_archivar(uuid, integer, boolean, text, text, uuid) from public, anon, authenticated;
revoke all on function public.crm_contacto_crear(uuid, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.crm_contacto_actualizar(uuid, integer, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.crm_jornada_crear(jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.crm_jornada_actualizar(uuid, integer, jsonb, boolean, text, uuid) from public, anon, authenticated;
revoke all on function public.crm_visita_registrar(uuid, text, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.crm_visita_corregir(uuid, integer, jsonb, text, text, uuid) from public, anon, authenticated;
revoke all on function public.crm_visita_anular(uuid, integer, text, text, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.crm_visita_nota_agregar(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.crm_tarea_actualizar(uuid, integer, text, date, text, text, uuid) from public, anon, authenticated;

grant execute on function public.crm_catalogo_guardar(text, uuid, integer, jsonb, text, uuid) to service_role;
grant execute on function public.crm_empresa_crear(jsonb, boolean, text, uuid) to service_role;
grant execute on function public.crm_empresa_actualizar(uuid, integer, jsonb, text, uuid) to service_role;
grant execute on function public.crm_empresa_archivar(uuid, integer, boolean, text, text, uuid) to service_role;
grant execute on function public.crm_contacto_crear(uuid, jsonb, text, uuid) to service_role;
grant execute on function public.crm_contacto_actualizar(uuid, integer, jsonb, text, uuid) to service_role;
grant execute on function public.crm_jornada_crear(jsonb, text, uuid) to service_role;
grant execute on function public.crm_jornada_actualizar(uuid, integer, jsonb, boolean, text, uuid) to service_role;
grant execute on function public.crm_visita_registrar(uuid, text, jsonb, text, uuid) to service_role;
grant execute on function public.crm_visita_corregir(uuid, integer, jsonb, text, text, uuid) to service_role;
grant execute on function public.crm_visita_anular(uuid, integer, text, text, uuid, text, uuid) to service_role;
grant execute on function public.crm_visita_nota_agregar(uuid, text, text, uuid) to service_role;
grant execute on function public.crm_tarea_actualizar(uuid, integer, text, date, text, text, uuid) to service_role;
