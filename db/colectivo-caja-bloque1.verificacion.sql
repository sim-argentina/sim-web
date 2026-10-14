-- ============================================================================
-- Verificación de db/colectivo-caja-bloque1.sql — SOLO LECTURA.
-- Cada fila es un control; todas deben dar ok = true.
-- ============================================================================
select 'tabla colectivo_gastos' as control,
       to_regclass('public.colectivo_gastos') is not null as ok
union all select 'FK a colectivo_eventos',
       exists (select 1 from pg_constraint
               where conrelid = 'public.colectivo_gastos'::regclass and contype = 'f'
                 and confrelid = 'public.colectivo_eventos'::regclass)
union all select 'checks de monto, categoría, medio de pago, concepto y actor',
       (select count(*) from pg_constraint
        where conrelid = 'public.colectivo_gastos'::regclass and contype = 'c'
          and conname in ('colectivo_gastos_monto_chk', 'colectivo_gastos_categoria_chk',
                          'colectivo_gastos_medio_pago_chk', 'colectivo_gastos_concepto_chk',
                          'colectivo_gastos_actor_chk')) = 5
union all select 'índice por evento y fecha',
       exists (select 1 from pg_indexes where indexname = 'idx_colectivo_gastos_evento_fecha')
union all select 'RLS activo sin policies',
       (select relrowsecurity from pg_class where oid = 'public.colectivo_gastos'::regclass)
       and not exists (select 1 from pg_policies where tablename = 'colectivo_gastos')
union all select 'anon y authenticated sin privilegios',
       not has_table_privilege('anon', 'public.colectivo_gastos', 'select')
       and not has_table_privilege('authenticated', 'public.colectivo_gastos', 'select')
union all select 'Finanzas no referencia colectivo_gastos',
       not exists (select 1 from pg_views
                   where schemaname = 'public' and viewname like 'fin\_%' and definition ~* 'colectivo_gastos')
       and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.proname like 'fin\_%' and p.prosrc ~* 'colectivo_');
