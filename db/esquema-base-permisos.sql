-- ============================================================================
-- PERMISOS — réplica de los de Producción
-- ----------------------------------------------------------------------------
-- En Producción solo `postgres` y `service_role` tienen privilegios sobre las
-- tablas de public: anon y authenticated NO tienen ninguno. Sumado a RLS activo
-- sin policies, eso es deny-by-default en dos capas. La aplicación siempre entra
-- con la service role desde el servidor.
--
-- Hace falta aplicarlo explícitamente en una base nueva: las tablas creadas por
-- `postgres` fuera del flujo de migraciones de Supabase no heredan estos grants,
-- y sin ellos la service role recibe "permission denied for table ...".
-- ============================================================================
grant usage on schema public to postgres, anon, authenticated, service_role;

grant delete, insert, references, select, trigger, truncate, update
  on all tables in schema public to postgres, service_role;
grant all on all sequences in schema public to postgres, service_role;
grant all on all functions in schema public to postgres, service_role;

-- Lo que se cree de acá en adelante también.
alter default privileges in schema public
  grant delete, insert, references, select, trigger, truncate, update on tables to postgres, service_role;
alter default privileges in schema public grant all on sequences to postgres, service_role;
alter default privileges in schema public grant all on functions to postgres, service_role;
