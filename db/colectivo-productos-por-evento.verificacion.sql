-- ============================================================================
-- Verificación de db/colectivo-productos-por-evento.sql — SOLO LECTURA.
-- Cada fila es un control; todas deben dar ok = true.
-- ============================================================================
select 'tabla colectivo_evento_productos' as control,
       to_regclass('public.colectivo_evento_productos') is not null as ok
union all select 'unique (evento_id, producto_id)',
       exists (select 1 from pg_constraint
               where conname = 'colectivo_evento_productos_evento_producto_key' and contype = 'u')
union all select 'FK a colectivo_eventos y a colectivo_productos',
       (select count(*) from pg_constraint
        where conrelid = 'public.colectivo_evento_productos'::regclass and contype = 'f') = 2
union all select 'índice por producto',
       exists (select 1 from pg_indexes where indexname = 'idx_colectivo_evento_productos_producto')
union all select 'RLS activo sin policies',
       (select relrowsecurity from pg_class where oid = 'public.colectivo_evento_productos'::regclass)
       and not exists (select 1 from pg_policies where tablename = 'colectivo_evento_productos')
union all select 'anon y authenticated sin privilegios',
       not has_table_privilege('anon', 'public.colectivo_evento_productos', 'select')
       and not has_table_privilege('authenticated', 'public.colectivo_evento_productos', 'select')
union all select 'trigger turnos = personas',
       exists (select 1 from pg_trigger
               where tgname = 'trg_colectivo_turnos_turnos_igual_personas' and not tgisinternal)
union all select 'ventas conservan la FK sin ON DELETE (no se borra un producto vendido)',
       exists (select 1 from pg_constraint
               where conname = 'colectivo_ventas_producto_id_fkey' and confdeltype = 'a')
union all select 'Finanzas no referencia colectivo_*',
       not exists (select 1 from pg_views
                   where schemaname = 'public' and viewname like 'fin\_%' and definition ~* 'colectivo_')
       and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.proname like 'fin\_%' and p.prosrc ~* 'colectivo_');
