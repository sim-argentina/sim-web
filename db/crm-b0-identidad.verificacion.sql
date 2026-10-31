-- ============================================================================
-- Verificación del CRM B2B · Bloque 0 (identidad comercial).
-- ----------------------------------------------------------------------------
-- Todo corre dentro de un bloque que termina en RAISE: se deshace entero, no
-- deja usuarios ni auditoría. Pensada para el stack LOCAL, ejecutada como
-- postgres:
--   docker exec -i supabase_db_sim-web-pruebas psql -U postgres -d postgres -X -q -f - \
--     < db/crm-b0-identidad.verificacion.sql
-- Resultado en el mensaje final: "RESULTADO CRM-B0|OK n" si todo se cumplió, o
-- la lista de "FALLA:" con lo que no se cumplió.
-- ============================================================================
do $crmb0$
declare
  v_fallas  text := '';
  v_ok      integer := 0;
  v_hash1   text := 'scrypt$17$8$1$' || repeat('A', 22) || '$' || repeat('B', 43);
  v_hash2   text := 'scrypt$17$8$1$' || repeat('C', 22) || '$' || repeat('D', 43);
  v_dto     jsonb;
  v_id      uuid;
  v_j       jsonb;
  v_b       boolean;
  v_n       integer;
  v_e       text;
  v_t       text;
  v_rpcs    text[] := array[
    'crm_usuario_crear(text,text,text,text)',
    'crm_usuario_restablecer_contrasena(uuid,text,text)',
    'crm_usuario_desactivar(uuid,text)',
    'crm_usuario_reactivar(uuid,text)',
    'crm_usuario_revocar_sesiones(uuid,text)',
    'crm_login_credencial(text)',
    'crm_login_confirmar(uuid,text,integer)',
    'crm_sesion_cerrar(uuid,integer)'];
  v_internas text[] := array[
    'crm_normalizar_usuario(text)',
    'crm_hash_valido(text)',
    'crm_usuario_auditable(crm_usuarios)',
    'crm_usuario_dto(crm_usuarios)',
    'crm_auditar(text,uuid,uuid,text,jsonb)'];
  v_f       text;
  v_rol     text;
  v_col     text;
begin
  -- ── T1. Tablas con RLS y sin policies ─────────────────────────────────────
  foreach v_t in array array['crm_usuarios', 'crm_auditoria'] loop
    select c.relrowsecurity into v_b from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = v_t;
    if v_b is true then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T1 rls ' || v_t; end if;
    select count(*) into v_n from pg_policies where schemaname = 'public' and tablename = v_t;
    if v_n = 0 then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T1 policies ' || v_t; end if;
  end loop;

  -- ── T2. Privilegios de tablas y columnas ──────────────────────────────────
  foreach v_rol in array array['anon', 'authenticated'] loop
    foreach v_t in array array['crm_usuarios', 'crm_auditoria'] loop
      if has_table_privilege(v_rol, 'public.' || v_t, 'select, insert, update, delete, truncate, references, trigger') then
        v_fallas := v_fallas || ' FALLA:T2 ' || v_rol || ' tiene privilegios en ' || v_t;
      else v_ok := v_ok + 1; end if;
      if has_any_column_privilege(v_rol, 'public.' || v_t, 'select, insert, update, references') then
        v_fallas := v_fallas || ' FALLA:T2 ' || v_rol || ' tiene privilegio de columna en ' || v_t;
      else v_ok := v_ok + 1; end if;
    end loop;
  end loop;
  foreach v_t in array array['crm_usuarios', 'crm_auditoria'] loop
    if has_table_privilege('service_role', 'public.' || v_t, 'insert, update, delete, truncate, references, trigger') then
      v_fallas := v_fallas || ' FALLA:T2 service_role escribe en ' || v_t;
    else v_ok := v_ok + 1; end if;
  end loop;
  if has_table_privilege('service_role', 'public.crm_auditoria', 'select') then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T2 service_role no lee crm_auditoria'; end if;
  if has_column_privilege('service_role', 'public.crm_usuarios', 'password_hash', 'select') then
    v_fallas := v_fallas || ' FALLA:T2 service_role lee password_hash';
  else v_ok := v_ok + 1; end if;
  if has_table_privilege('service_role', 'public.crm_usuarios', 'select') then
    v_fallas := v_fallas || ' FALLA:T2 service_role tiene SELECT de tabla completa en crm_usuarios';
  else v_ok := v_ok + 1; end if;
  foreach v_col in array array['id', 'usuario', 'nombre', 'rol', 'activo', 'sesion_version', 'creado_en',
                               'actualizado_en', 'contrasena_cambiada_en', 'desactivado_en', 'ultimo_ingreso_en'] loop
    if has_column_privilege('service_role', 'public.crm_usuarios', v_col, 'select') then v_ok := v_ok + 1;
    else v_fallas := v_fallas || ' FALLA:T2 service_role no lee ' || v_col; end if;
  end loop;

  -- ── T3. Funciones: definer, search_path y EXECUTE ─────────────────────────
  foreach v_f in array v_rpcs loop
    select p.prosecdef and coalesce('search_path=public' = any (p.proconfig), false) into v_b
      from pg_proc p where p.oid = ('public.' || v_f)::regprocedure;
    if v_b then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T3 definer/search_path ' || v_f; end if;
    if has_function_privilege('service_role', 'public.' || v_f, 'execute') then v_ok := v_ok + 1;
    else v_fallas := v_fallas || ' FALLA:T3 service_role no ejecuta ' || v_f; end if;
    foreach v_rol in array array['anon', 'authenticated'] loop
      if has_function_privilege(v_rol, 'public.' || v_f, 'execute') then
        v_fallas := v_fallas || ' FALLA:T3 ' || v_rol || ' ejecuta ' || v_f;
      else v_ok := v_ok + 1; end if;
    end loop;
    select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                    where p.oid = ('public.' || v_f)::regprocedure and a.grantee = 0) into v_b;
    if v_b then v_fallas := v_fallas || ' FALLA:T3 PUBLIC ejecuta ' || v_f; else v_ok := v_ok + 1; end if;
  end loop;
  foreach v_f in array v_internas loop
    select coalesce('search_path=public' = any (p.proconfig), false) and not p.prosecdef into v_b
      from pg_proc p where p.oid = ('public.' || v_f)::regprocedure;
    if v_b then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T3 interna sin search_path o definer ' || v_f; end if;
    foreach v_rol in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(v_rol, 'public.' || v_f, 'execute') then
        v_fallas := v_fallas || ' FALLA:T3 ' || v_rol || ' ejecuta la interna ' || v_f;
      else v_ok := v_ok + 1; end if;
    end loop;
    select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                    where p.oid = ('public.' || v_f)::regprocedure and a.grantee = 0) into v_b;
    if v_b then v_fallas := v_fallas || ' FALLA:T3 PUBLIC ejecuta la interna ' || v_f; else v_ok := v_ok + 1; end if;
  end loop;

  -- ── T4. Restricciones presentes ───────────────────────────────────────────
  foreach v_t in array array['crm_usuarios_usuario_chk', 'crm_usuarios_nombre_chk', 'crm_usuarios_rol_chk',
                             'crm_usuarios_hash_chk', 'crm_usuarios_version_chk', 'crm_usuarios_activo_chk',
                             'crm_auditoria_actor_chk', 'crm_auditoria_entidad_chk', 'crm_auditoria_accion_chk',
                             'crm_auditoria_datos_chk'] loop
    if exists (select 1 from pg_constraint where conname = v_t) then v_ok := v_ok + 1;
    else v_fallas := v_fallas || ' FALLA:T4 falta ' || v_t; end if;
  end loop;
  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'crm_usuarios_usuario_uidx') then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T4 falta el índice único de usuario'; end if;

  -- ── T5. Comportamiento (todo se revierte al final) ────────────────────────
  begin
    perform public.crm_usuario_crear('zzcrmb0.verif', 'Prueba', v_hash1, 'comercial');
    v_fallas := v_fallas || ' FALLA:T5 crear con actor comercial';
  exception when others then
    if sqlerrm = 'actor_invalido' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 actor ' || sqlerrm; end if;
  end;
  begin
    perform public.crm_usuario_crear('zzcrmb0.verif', 'Prueba', 'contraseña-en-texto-plano', 'admin');
    v_fallas := v_fallas || ' FALLA:T5 aceptó un hash con formato inválido';
  exception when others then
    if sqlerrm = 'hash_invalido' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 hash ' || sqlerrm; end if;
  end;
  begin
    perform public.crm_usuario_crear('ab', 'Prueba', v_hash1, 'admin');
    v_fallas := v_fallas || ' FALLA:T5 aceptó un usuario de 2 caracteres';
  exception when others then
    if sqlerrm = 'usuario_invalido' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 usuario ' || sqlerrm; end if;
  end;

  v_dto := public.crm_usuario_crear('  ZZcrmB0.Verif ', '  Prueba   Verificación ', v_hash1, 'admin');
  v_id := (v_dto ->> 'id')::uuid;
  if v_dto ->> 'usuario' = 'zzcrmb0.verif' and v_dto ->> 'nombre' = 'Prueba Verificación'
     and (v_dto ->> 'activo')::boolean then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T5 normalización del alta ' || v_dto::text; end if;
  if v_dto ? 'password_hash' or v_dto ? 'sesion_version' or v_dto::text like '%scrypt%' then
    v_fallas := v_fallas || ' FALLA:T5 el DTO expone material de autenticación';
  else v_ok := v_ok + 1; end if;

  begin
    perform public.crm_usuario_crear('ZZCRMB0.VERIF', 'Otra', v_hash2, 'admin');
    v_fallas := v_fallas || ' FALLA:T5 duplicó el usuario';
  exception when others then
    if sqlerrm = 'usuario_existente' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 duplicado ' || sqlerrm; end if;
  end;

  select count(*) into v_n from public.crm_login_credencial(' ZZCRMB0.verif ') c where c.sesion_version = 1 and c.activo;
  if v_n = 1 then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 credencial'; end if;
  select count(*) into v_n from public.crm_login_credencial('zzcrmb0.inexistente');
  if v_n = 0 then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 credencial inexistente'; end if;

  v_j := public.crm_login_confirmar(v_id, v_hash1, 1);
  if (v_j ->> 'sesion_version')::int = 1 then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 confirmar válido'; end if;
  if public.crm_login_confirmar(v_id, v_hash1, 0) is null and public.crm_login_confirmar(v_id, v_hash2, 1) is null then
    v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T5 confirmó con versión u hash viejos'; end if;

  v_dto := public.crm_usuario_desactivar(v_id, 'admin');
  if public.crm_login_confirmar(v_id, v_hash1, 2) is null and not (v_dto ->> 'activo')::boolean then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T5 ingresó desactivado'; end if;
  begin
    perform public.crm_usuario_desactivar(v_id, 'admin');
    v_fallas := v_fallas || ' FALLA:T5 desactivó dos veces';
  exception when others then
    if sqlerrm = 'sin_cambio' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 sin_cambio ' || sqlerrm; end if;
  end;

  perform public.crm_usuario_reactivar(v_id, 'admin');
  if public.crm_login_confirmar(v_id, v_hash1, 2) is null and public.crm_login_confirmar(v_id, v_hash1, 1) is null then
    v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T5 reactivar revivió una sesión anterior'; end if;
  if (public.crm_login_confirmar(v_id, v_hash1, 3) ->> 'sesion_version')::int = 3 then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T5 no ingresa tras reactivar'; end if;

  perform public.crm_usuario_restablecer_contrasena(v_id, v_hash2, 'admin');
  if public.crm_login_confirmar(v_id, v_hash1, 4) is null and (public.crm_login_confirmar(v_id, v_hash2, 4) ->> 'sesion_version')::int = 4 then
    v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T5 restablecimiento'; end if;

  perform public.crm_usuario_revocar_sesiones(v_id, 'admin');
  if public.crm_login_confirmar(v_id, v_hash2, 4) is null then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T5 revocación'; end if;

  -- Sentencias separadas: una subconsulta de la misma sentencia no ve lo que
  -- escribió la función llamada en ella.
  v_b := public.crm_sesion_cerrar(v_id, 4);
  if v_b then v_fallas := v_fallas || ' FALLA:T5 una sesión vieja cerró la vigente'; else v_ok := v_ok + 1; end if;
  v_b := public.crm_sesion_cerrar(v_id, 5);
  select sesion_version into v_n from public.crm_usuarios where id = v_id;
  if v_b and v_n = 6 then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T5 cierre de sesión (versión ' || v_n || ')'; end if;

  begin
    perform public.crm_usuario_desactivar(gen_random_uuid(), 'admin');
    v_fallas := v_fallas || ' FALLA:T5 desactivó un usuario inexistente';
  exception when others then
    if sqlerrm = 'usuario_inexistente' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 inexistente ' || sqlerrm; end if;
  end;

  -- Auditoría: una fila por acción, sin material de autenticación.
  select string_agg(accion || '=' || n, ',' order by accion) into v_e from (
    select accion, count(*) n from public.crm_auditoria where entidad_id = v_id group by accion) s;
  if v_e = 'alta=1,cierre_sesion=1,desactivacion=1,ingreso=3,reactivacion=1,restablecimiento_contrasena=1,revocacion_sesiones=1' then
    v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T5 auditoría ' || coalesce(v_e, '(vacía)'); end if;
  select count(*) into v_n from public.crm_auditoria
   where entidad_id = v_id and (datos::text like '%scrypt%' or datos::text like '%' || repeat('A', 22) || '%');
  if v_n = 0 then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 la auditoría contiene el hash'; end if;
  select count(*) into v_n from public.crm_auditoria
   where entidad_id = v_id and ((accion = 'ingreso' and actor_rol = 'comercial' and actor_usuario_id = v_id)
                                or (accion <> 'ingreso' and accion <> 'cierre_sesion' and actor_rol = 'admin' and actor_usuario_id is null)
                                or (accion = 'cierre_sesion' and actor_rol = 'comercial' and actor_usuario_id = v_id));
  if v_n = 9 then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 actores de la auditoría ' || v_n; end if;

  begin
    insert into public.crm_auditoria (actor_rol, entidad, entidad_id, accion, datos)
    values ('admin', 'crm_usuarios', v_id, 'alta', jsonb_build_object('password_hash', 'x'));
    v_fallas := v_fallas || ' FALLA:T5 la auditoría aceptó password_hash';
  exception when check_violation then v_ok := v_ok + 1;
  end;
  begin
    insert into public.crm_auditoria (actor_rol, actor_usuario_id, entidad, entidad_id, accion)
    values ('admin', v_id, 'crm_usuarios', v_id, 'alta');
    v_fallas := v_fallas || ' FALLA:T5 auditoría admin con usuario';
  exception when check_violation then v_ok := v_ok + 1;
  end;
  begin
    update public.crm_usuarios set password_hash = 'texto plano' where id = v_id;
    v_fallas := v_fallas || ' FALLA:T5 la tabla aceptó un hash inválido';
  exception when check_violation then v_ok := v_ok + 1;
  end;

  if v_fallas = '' then
    raise exception 'RESULTADO CRM-B0|OK %', v_ok;
  end if;
  raise exception 'RESULTADO CRM-B0|% bien;%', v_ok, v_fallas;
end
$crmb0$;
