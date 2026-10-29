-- ============================================================================
-- CRM B2B · Bloque 0 — Identidad comercial (usuarios comerciales y auditoría).
-- ----------------------------------------------------------------------------
-- Usuarios individuales para la interfaz comercial (/comercial). NO es un rol
-- del panel: la sesión del panel (admin/staff, lib/adminSession.ts) no cambia y
-- no conoce a estos usuarios. Definiciones: docs/crm/b0-identidad.md.
--
-- Qué NO hace: no toca reservas, turnero, gift cards, empresas, mensualidades,
-- colectivo, finanzas, marketing ni cupones. Ninguna función de este archivo
-- escribe fuera de crm_usuarios y crm_auditoria.
--
-- Piezas:
--   · crm_usuarios   un usuario comercial. password_hash = scrypt con sal
--                    (lo calcula el servidor; la base solo valida el formato).
--                    sesion_version = versión vigente de sus sesiones: cada
--                    desactivación, reactivación, restablecimiento, revocación
--                    o cierre de sesión la incrementa, y una sesión solo vale
--                    con la versión vigente. Reactivar NO revive sesiones.
--   · crm_auditoria  historial de solo agregado. Guarda una lista EXPLÍCITA de
--                    campos (usuario, nombre, activo): nunca el hash ni la
--                    versión de sesión. Un CHECK rechaza claves sensibles.
--
-- Actor: las RPCs reciben el rol que autenticó la API (p_actor_rol). La base no
-- puede verificar la sesión; por eso solo service_role ejecuta, y cada función
-- exige el actor que le corresponde (administración para gestionar usuarios; el
-- propio usuario comercial para su ingreso y su cierre de sesión). La
-- administración es la credencial compartida del panel: se registra como
-- 'admin' ("Administración"), no como una persona.
--
-- Permisos mínimos: RLS sin policies; anon y authenticated sin acceso; service_role
-- solo LEE crm_auditoria y las columnas NO sensibles de crm_usuarios (no tiene
-- SELECT sobre password_hash: un select * falla en vez de filtrar el hash). Toda
-- escritura pasa por las RPCs SECURITY DEFINER de este archivo.
--
-- Va en db/orden.txt DESPUÉS de esquema-base-permisos.sql: ese archivo vuelve a
-- dar DML y EXECUTE a service_role sobre todo public; acá se lo recorta.
--
-- Aditivo e idempotente. Verificación: db/crm-b0-identidad.verificacion.sql.
-- Los cuerpos de las funciones NO llevan comentarios: las explicaciones van
-- arriba de cada una.
-- ============================================================================

-- ── 1. Usuarios comerciales ─────────────────────────────────────────────────
-- usuario: minúsculas, 3 a 40 caracteres, letras/dígitos y . _ -; empieza con
-- letra o dígito. Formato del hash: scrypt$<log2 N>$<r>$<p>$<sal>$<clave>, sal de
-- 16 bytes y clave de 32 en base64url sin relleno (lib/crmContrasena.ts).
create table if not exists public.crm_usuarios (
  id                      uuid primary key default gen_random_uuid(),
  usuario                 text not null,
  nombre                  text not null,
  rol                     text not null default 'comercial',
  activo                  boolean not null default true,
  password_hash           text not null,
  sesion_version          integer not null default 1,
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now(),
  contrasena_cambiada_en  timestamptz not null default now(),
  desactivado_en          timestamptz,
  ultimo_ingreso_en       timestamptz,
  constraint crm_usuarios_usuario_chk check (usuario ~ '^[a-z0-9][a-z0-9._-]{2,39}$'),
  constraint crm_usuarios_nombre_chk check (nombre = btrim(nombre) and char_length(nombre) between 1 and 80),
  constraint crm_usuarios_rol_chk check (rol = 'comercial'),
  constraint crm_usuarios_hash_chk check (password_hash ~ '^scrypt\$1[4-9]\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$'),
  constraint crm_usuarios_version_chk check (sesion_version >= 1),
  constraint crm_usuarios_activo_chk check (activo = (desactivado_en is null))
);
create unique index if not exists crm_usuarios_usuario_uidx on public.crm_usuarios (usuario);

comment on table public.crm_usuarios is
  '(CRM B0) Usuarios comerciales individuales. Escritura solo por RPC; service_role no lee password_hash.';
comment on column public.crm_usuarios.password_hash is
  'scrypt con sal (lib/crmContrasena.ts). Nunca se expone: service_role no tiene SELECT sobre esta columna.';
comment on column public.crm_usuarios.sesion_version is
  'Versión vigente de las sesiones. Cada desactivación, reactivación, restablecimiento, revocación o cierre la incrementa.';

-- ── 2. Auditoría ────────────────────────────────────────────────────────────
-- Solo agregado: service_role lee; nadie actualiza ni borra (sin privilegios ni
-- RPC para eso). en = clock_timestamp() para ordenar varias filas de una misma
-- transacción.
create table if not exists public.crm_auditoria (
  id                uuid primary key default gen_random_uuid(),
  en                timestamptz not null default clock_timestamp(),
  actor_rol         text not null,
  actor_usuario_id  uuid references public.crm_usuarios (id) on delete restrict,
  entidad           text not null,
  entidad_id        uuid not null,
  accion            text not null,
  datos             jsonb not null default '{}'::jsonb,
  constraint crm_auditoria_actor_chk check (
    (actor_rol = 'admin' and actor_usuario_id is null)
    or (actor_rol = 'comercial' and actor_usuario_id is not null)),
  constraint crm_auditoria_entidad_chk check (entidad = 'crm_usuarios'),
  constraint crm_auditoria_accion_chk check (accion in (
    'alta', 'desactivacion', 'reactivacion', 'restablecimiento_contrasena',
    'revocacion_sesiones', 'ingreso', 'cierre_sesion')),
  constraint crm_auditoria_datos_chk check (
    jsonb_typeof(datos) = 'object'
    and not (datos ?| array['password_hash', 'password', 'contrasena', 'hash', 'sal', 'token', 'sesion_version']))
);
create index if not exists crm_auditoria_entidad_idx on public.crm_auditoria (entidad, entidad_id, en desc);

comment on table public.crm_auditoria is
  '(CRM B0) Auditoría de solo agregado. datos lleva campos explícitos; nunca material de autenticación.';

-- ── 3. Funciones internas (sin EXECUTE para nadie) ─────────────────────────
-- Normalización del nombre de usuario (la misma que hace el servidor).
create or replace function public.crm_normalizar_usuario(p_usuario text)
returns text
language sql
immutable
set search_path = public
as $fn$
  select lower(btrim(coalesce(p_usuario, '')))
$fn$;

-- Formato de hash aceptado (igual al CHECK de la tabla).
create or replace function public.crm_hash_valido(p_hash text)
returns boolean
language sql
immutable
set search_path = public
as $fn$
  select coalesce(p_hash ~ '^scrypt\$1[4-9]\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$', false)
$fn$;

-- Campos AUDITABLES de un usuario: lista explícita, sin hash ni versión.
create or replace function public.crm_usuario_auditable(p public.crm_usuarios)
returns jsonb
language sql
immutable
set search_path = public
as $fn$
  select jsonb_build_object('usuario', p.usuario, 'nombre', p.nombre, 'activo', p.activo)
$fn$;

-- Lo que la administración ve de un usuario (DTO): lista explícita.
create or replace function public.crm_usuario_dto(p public.crm_usuarios)
returns jsonb
language sql
immutable
set search_path = public
as $fn$
  select jsonb_build_object(
    'id', p.id, 'usuario', p.usuario, 'nombre', p.nombre, 'activo', p.activo,
    'creado_en', p.creado_en, 'desactivado_en', p.desactivado_en,
    'contrasena_cambiada_en', p.contrasena_cambiada_en, 'ultimo_ingreso_en', p.ultimo_ingreso_en)
$fn$;

-- Alta de una fila de auditoría (la llaman las RPCs de este archivo).
create or replace function public.crm_auditar(
  p_actor_rol text, p_actor_usuario uuid, p_entidad_id uuid, p_accion text, p_datos jsonb)
returns void
language sql
volatile
set search_path = public
as $fn$
  insert into public.crm_auditoria (actor_rol, actor_usuario_id, entidad, entidad_id, accion, datos)
  values (p_actor_rol, p_actor_usuario, 'crm_usuarios', p_entidad_id, p_accion, coalesce(p_datos, '{}'::jsonb))
$fn$;

-- ── 4. Administración de usuarios (actor: 'admin') ─────────────────────────
-- Errores (mensaje = código; lib/crmUsuarios.ts los traduce):
--   actor_invalido · usuario_invalido · nombre_invalido · hash_invalido ·
--   usuario_existente · usuario_inexistente · sin_cambio.

-- Alta. Nace activo, con sesion_version 1 y sin sesiones (nadie ingresó).
create or replace function public.crm_usuario_crear(
  p_usuario text, p_nombre text, p_password_hash text, p_actor_rol text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_usuario text := public.crm_normalizar_usuario(p_usuario);
  v_nombre  text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_fila    public.crm_usuarios%rowtype;
begin
  if p_actor_rol is distinct from 'admin' then
    raise exception 'actor_invalido' using errcode = '42501';
  end if;
  if v_usuario !~ '^[a-z0-9][a-z0-9._-]{2,39}$' then
    raise exception 'usuario_invalido' using errcode = '22023';
  end if;
  if char_length(v_nombre) < 1 or char_length(v_nombre) > 80 then
    raise exception 'nombre_invalido' using errcode = '22023';
  end if;
  if not public.crm_hash_valido(p_password_hash) then
    raise exception 'hash_invalido' using errcode = '22023';
  end if;
  begin
    insert into public.crm_usuarios (usuario, nombre, password_hash)
    values (v_usuario, v_nombre, p_password_hash)
    returning * into v_fila;
  exception when unique_violation then
    raise exception 'usuario_existente' using errcode = '23505';
  end;
  perform public.crm_auditar('admin', null, v_fila.id, 'alta',
    jsonb_build_object('despues', public.crm_usuario_auditable(v_fila)));
  return public.crm_usuario_dto(v_fila);
end
$fn$;

-- Restablecer contraseña: hash nuevo y todas las sesiones anteriores revocadas.
-- Vale también para un usuario desactivado (sigue desactivado).
create or replace function public.crm_usuario_restablecer_contrasena(
  p_id uuid, p_password_hash text, p_actor_rol text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_fila public.crm_usuarios%rowtype;
begin
  if p_actor_rol is distinct from 'admin' then
    raise exception 'actor_invalido' using errcode = '42501';
  end if;
  if not public.crm_hash_valido(p_password_hash) then
    raise exception 'hash_invalido' using errcode = '22023';
  end if;
  select * into v_fila from public.crm_usuarios where id = p_id for update;
  if not found then
    raise exception 'usuario_inexistente' using errcode = 'P0002';
  end if;
  update public.crm_usuarios
     set password_hash = p_password_hash, sesion_version = sesion_version + 1,
         contrasena_cambiada_en = now(), actualizado_en = now()
   where id = p_id
  returning * into v_fila;
  perform public.crm_auditar('admin', null, v_fila.id, 'restablecimiento_contrasena',
    jsonb_build_object('sesiones_revocadas', true));
  return public.crm_usuario_dto(v_fila);
end
$fn$;

-- Desactivar: deja de poder ingresar y sus sesiones se revocan en el acto.
create or replace function public.crm_usuario_desactivar(p_id uuid, p_actor_rol text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_antes public.crm_usuarios%rowtype;
  v_fila  public.crm_usuarios%rowtype;
begin
  if p_actor_rol is distinct from 'admin' then
    raise exception 'actor_invalido' using errcode = '42501';
  end if;
  select * into v_antes from public.crm_usuarios where id = p_id for update;
  if not found then
    raise exception 'usuario_inexistente' using errcode = 'P0002';
  end if;
  if not v_antes.activo then
    raise exception 'sin_cambio' using errcode = '55000';
  end if;
  update public.crm_usuarios
     set activo = false, desactivado_en = now(), sesion_version = sesion_version + 1, actualizado_en = now()
   where id = p_id
  returning * into v_fila;
  perform public.crm_auditar('admin', null, v_fila.id, 'desactivacion',
    jsonb_build_object('antes', public.crm_usuario_auditable(v_antes),
                       'despues', public.crm_usuario_auditable(v_fila),
                       'sesiones_revocadas', true));
  return public.crm_usuario_dto(v_fila);
end
$fn$;

-- Reactivar: vuelve a poder ingresar con su contraseña. La versión sube otra
-- vez: ninguna sesión anterior a la desactivación recupera validez.
create or replace function public.crm_usuario_reactivar(p_id uuid, p_actor_rol text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_antes public.crm_usuarios%rowtype;
  v_fila  public.crm_usuarios%rowtype;
begin
  if p_actor_rol is distinct from 'admin' then
    raise exception 'actor_invalido' using errcode = '42501';
  end if;
  select * into v_antes from public.crm_usuarios where id = p_id for update;
  if not found then
    raise exception 'usuario_inexistente' using errcode = 'P0002';
  end if;
  if v_antes.activo then
    raise exception 'sin_cambio' using errcode = '55000';
  end if;
  update public.crm_usuarios
     set activo = true, desactivado_en = null, sesion_version = sesion_version + 1, actualizado_en = now()
   where id = p_id
  returning * into v_fila;
  perform public.crm_auditar('admin', null, v_fila.id, 'reactivacion',
    jsonb_build_object('antes', public.crm_usuario_auditable(v_antes),
                       'despues', public.crm_usuario_auditable(v_fila)));
  return public.crm_usuario_dto(v_fila);
end
$fn$;

-- Revocar sesiones: cierra todas las sesiones abiertas; la contraseña no cambia.
create or replace function public.crm_usuario_revocar_sesiones(p_id uuid, p_actor_rol text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_fila public.crm_usuarios%rowtype;
begin
  if p_actor_rol is distinct from 'admin' then
    raise exception 'actor_invalido' using errcode = '42501';
  end if;
  update public.crm_usuarios
     set sesion_version = sesion_version + 1, actualizado_en = now()
   where id = p_id
  returning * into v_fila;
  if not found then
    raise exception 'usuario_inexistente' using errcode = 'P0002';
  end if;
  perform public.crm_auditar('admin', null, v_fila.id, 'revocacion_sesiones',
    jsonb_build_object('sesiones_revocadas', true));
  return public.crm_usuario_dto(v_fila);
end
$fn$;

-- ── 5. Ingreso y cierre de sesión (actor: el propio usuario comercial) ──────
-- Credencial para verificar una contraseña (solo lectura). La API compara el
-- hash fuera de la base y después confirma con crm_login_confirmar.
create or replace function public.crm_login_credencial(p_usuario text)
returns table (id uuid, password_hash text, sesion_version integer, activo boolean)
language sql
stable
security definer
set search_path = public
as $fn$
  select u.id, u.password_hash, u.sesion_version, u.activo
    from public.crm_usuarios u
   where u.usuario = public.crm_normalizar_usuario(p_usuario)
$fn$;

-- Confirmación ATÓMICA del ingreso. Bloquea la fila y exige que sigan iguales el
-- hash verificado y la versión leída: si entre la lectura y la confirmación hubo
-- un restablecimiento, una desactivación o una revocación, devuelve NULL y no se
-- emite sesión. Devuelve la versión con la que se firma la sesión nueva.
create or replace function public.crm_login_confirmar(
  p_id uuid, p_password_hash text, p_sesion_version integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_fila public.crm_usuarios%rowtype;
begin
  select * into v_fila from public.crm_usuarios where id = p_id for update;
  if not found or not v_fila.activo
     or v_fila.password_hash is distinct from p_password_hash
     or v_fila.sesion_version is distinct from p_sesion_version then
    return null;
  end if;
  update public.crm_usuarios set ultimo_ingreso_en = now() where id = p_id
  returning * into v_fila;
  perform public.crm_auditar('comercial', v_fila.id, v_fila.id, 'ingreso', '{}'::jsonb);
  return jsonb_build_object('id', v_fila.id, 'nombre', v_fila.nombre, 'sesion_version', v_fila.sesion_version);
end
$fn$;

-- Cierre de sesión: revoca TODAS las sesiones del usuario (no hay sesiones por
-- dispositivo). Solo si la versión es la vigente: una sesión ya revocada no
-- revoca otra vez a una más nueva.
create or replace function public.crm_sesion_cerrar(p_id uuid, p_sesion_version integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_fila public.crm_usuarios%rowtype;
begin
  update public.crm_usuarios
     set sesion_version = sesion_version + 1, actualizado_en = now()
   where id = p_id and activo and sesion_version = p_sesion_version
  returning * into v_fila;
  if not found then
    return false;
  end if;
  perform public.crm_auditar('comercial', v_fila.id, v_fila.id, 'cierre_sesion',
    jsonb_build_object('sesiones_revocadas', true));
  return true;
end
$fn$;

-- ── 6. Seguridad: RLS y privilegios explícitos ─────────────────────────────
alter table public.crm_usuarios enable row level security;
alter table public.crm_auditoria enable row level security;

revoke all on table public.crm_usuarios from public, anon, authenticated, service_role;
revoke all on table public.crm_auditoria from public, anon, authenticated, service_role;
grant select (id, usuario, nombre, rol, activo, sesion_version, creado_en, actualizado_en,
              contrasena_cambiada_en, desactivado_en, ultimo_ingreso_en)
  on public.crm_usuarios to service_role;
grant select on public.crm_auditoria to service_role;

revoke all on function public.crm_normalizar_usuario(text) from public, anon, authenticated, service_role;
revoke all on function public.crm_hash_valido(text) from public, anon, authenticated, service_role;
revoke all on function public.crm_usuario_auditable(public.crm_usuarios) from public, anon, authenticated, service_role;
revoke all on function public.crm_usuario_dto(public.crm_usuarios) from public, anon, authenticated, service_role;
revoke all on function public.crm_auditar(text, uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;

revoke all on function public.crm_usuario_crear(text, text, text, text) from public, anon, authenticated;
revoke all on function public.crm_usuario_restablecer_contrasena(uuid, text, text) from public, anon, authenticated;
revoke all on function public.crm_usuario_desactivar(uuid, text) from public, anon, authenticated;
revoke all on function public.crm_usuario_reactivar(uuid, text) from public, anon, authenticated;
revoke all on function public.crm_usuario_revocar_sesiones(uuid, text) from public, anon, authenticated;
revoke all on function public.crm_login_credencial(text) from public, anon, authenticated;
revoke all on function public.crm_login_confirmar(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.crm_sesion_cerrar(uuid, integer) from public, anon, authenticated;

grant execute on function public.crm_usuario_crear(text, text, text, text) to service_role;
grant execute on function public.crm_usuario_restablecer_contrasena(uuid, text, text) to service_role;
grant execute on function public.crm_usuario_desactivar(uuid, text) to service_role;
grant execute on function public.crm_usuario_reactivar(uuid, text) to service_role;
grant execute on function public.crm_usuario_revocar_sesiones(uuid, text) to service_role;
grant execute on function public.crm_login_credencial(text) to service_role;
grant execute on function public.crm_login_confirmar(uuid, text, integer) to service_role;
grant execute on function public.crm_sesion_cerrar(uuid, integer) to service_role;
