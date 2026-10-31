-- ============================================================================
-- Control de SOLO LECTURA del esquema del CRM (B0 → B3), para después de aplicar
-- la cadena en una base real. No escribe nada ni crea objetos: solo SELECT.
-- ----------------------------------------------------------------------------
-- Las verificaciones completas (crm-*.verificacion.sql) escriben dentro de un
-- bloque que se deshace: corren en la instancia local. En una base real se usa
-- este control, y su resultado se compara con el de la instancia local recién
-- armada con la misma cadena (ver docs/crm/cierre-mvp.md).
--   node scripts/pruebas/crm-local.mjs sql db/crm-poscontrol.sql
--
-- Esperado (cadena B0 → B3 del cierre del MVP):
--   P1 tablas|19|rls=true|politicas=0
--   P2 sin_validar|0
--   P3 anon_auth|0
--   P4 service_role|SELECT
--   P5 hash_legible|false
--   P6 definer_sin_path|0
--   P7 exec_anon_auth|0
--   P8 funciones|57|service_role_exec=26 (57 funciones crm_*, sin sobrecargas;
--      26 son las RPC que llama el servidor; las demás son internas)
--   P9 rubros|14 (la configuración inicial; Administración puede agregar más)
--   P10 productos|pack_10:150000.00:40000.00,pack_25:360000.00:90000.00,personalizado:-:-
--   P11 datos|… todo 0 en una base recién migrada (ningún dato copiado)
-- ============================================================================

-- P1. Las 19 tablas crm_* con RLS activa y sin políticas (nadie lee con la clave pública).
select 'P1 tablas|' || count(*) || '|rls=' || bool_and(c.relrowsecurity)
       || '|politicas=' || (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename like 'crm\_%')
  from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'crm\_%';

-- P2. Ninguna restricción de una tabla crm_* quedó sin validar (estado final de la cadena).
select 'P2 sin_validar|' || count(*)
  from pg_constraint
 where connamespace = 'public'::regnamespace and conrelid::regclass::text like 'crm\_%' and not convalidated;

-- P3. anon, authenticated y PUBLIC sin privilegios sobre las tablas.
select 'P3 anon_auth|' || count(*)
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name like 'crm\_%' and grantee in ('anon', 'authenticated', 'PUBLIC');

-- P4. service_role solo lee (toda escritura pasa por las RPC).
select 'P4 service_role|' || coalesce(string_agg(distinct privilege_type, ','), '-')
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name like 'crm\_%' and grantee = 'service_role';

-- P5. El hash de la contraseña no es legible ni para service_role.
select 'P5 hash_legible|' || has_column_privilege('service_role', 'public.crm_usuarios', 'password_hash', 'select');

-- P6. Toda función SECURITY DEFINER del CRM fija search_path = public.
select 'P6 definer_sin_path|' || count(*)
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname like 'crm\_%' and p.prosecdef
   and not (coalesce(p.proconfig, '{}') @> array['search_path=public']);

-- P7. Ninguna función del CRM ejecutable por anon ni authenticated.
select 'P7 exec_anon_auth|' || count(*)
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname like 'crm\_%'
   and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));

-- P8. Cantidad de funciones y cuántas puede ejecutar service_role (las RPC públicas).
select 'P8 funciones|' || count(*) || '|service_role_exec='
       || count(*) filter (where has_function_privilege('service_role', p.oid, 'execute'))
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname like 'crm\_%';

-- P9 y P10. Configuración inicial que siembran los SQL (rubros de B1, productos de B3).
select 'P9 rubros|' || count(*) from public.crm_rubros;
select 'P10 productos|' || string_agg(codigo || ':' || coalesce(precio::text, '-') || ':' || coalesce(comision_estandar::text, '-'), ',' order by orden)
  from public.crm_productos;

-- P11. Datos operativos: en una base recién migrada, todo 0 (nada se copia de la base local).
select 'P11 datos|usuarios=' || (select count(*) from public.crm_usuarios)
       || '|zonas=' || (select count(*) from public.crm_zonas)
       || '|negocios=' || (select count(*) from public.crm_empresas)
       || '|jornadas=' || (select count(*) from public.crm_jornadas)
       || '|visitas=' || (select count(*) from public.crm_visitas)
       || '|oportunidades=' || (select count(*) from public.crm_oportunidades)
       || '|ventas=' || (select count(*) from public.crm_ventas)
       || '|cobros=' || (select count(*) from public.crm_cobros)
       || '|pagos_comision=' || (select count(*) from public.crm_comision_pagos);
