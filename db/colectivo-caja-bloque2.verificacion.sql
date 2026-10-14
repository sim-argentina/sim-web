-- ============================================================================
-- Verificación de db/colectivo-caja-bloque2.sql — SOLO LECTURA.
-- Cada fila es un control; todas deben dar ok = true.
-- ============================================================================
select 'tabla colectivo_caja_categorias' as control,
       to_regclass('public.colectivo_caja_categorias') is not null as ok
union all select 'tipo costo | gasto y nombre válido',
       (select count(*) from pg_constraint
        where conrelid = 'public.colectivo_caja_categorias'::regclass and contype = 'c'
          and conname in ('colectivo_caja_categorias_tipo_chk', 'colectivo_caja_categorias_nombre_chk')) = 2
union all select 'nombre único sin mayúsculas ni espacios repetidos',
       exists (select 1 from pg_indexes where indexname = 'colectivo_caja_categorias_nombre_key'
               and indexdef ilike '%unique%lower%regexp_replace%')
union all select 'RLS activo sin policies en categorías',
       (select relrowsecurity from pg_class where oid = 'public.colectivo_caja_categorias'::regclass)
       and not exists (select 1 from pg_policies where tablename = 'colectivo_caja_categorias')
union all select 'anon y authenticated sin privilegios en categorías',
       not has_table_privilege('anon', 'public.colectivo_caja_categorias', 'select')
       and not has_table_privilege('authenticated', 'public.colectivo_caja_categorias', 'select')
union all select 'movimientos: FK a la categoría sin ON DELETE',
       exists (select 1 from pg_constraint
               where conrelid = 'public.colectivo_gastos'::regclass and contype = 'f'
                 and confrelid = 'public.colectivo_caja_categorias'::regclass and confdeltype = 'a')
union all select 'movimientos: categoría, tipo y nombre obligatorios',
       (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'colectivo_gastos'
          and column_name in ('categoria_id', 'tipo', 'categoria_nombre') and is_nullable = 'NO') = 3
union all select 'movimientos: tipo costo | gasto',
       exists (select 1 from pg_constraint where conname = 'colectivo_gastos_tipo_chk')
union all select 'columna vieja categoria conservada y opcional',
       exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'colectivo_gastos'
                 and column_name = 'categoria' and is_nullable = 'YES')
union all select 'índice por categoría',
       exists (select 1 from pg_indexes where indexname = 'idx_colectivo_gastos_categoria')
union all select 'ningún movimiento sin categoría',
       not exists (select 1 from public.colectivo_gastos where categoria_id is null)
union all select 'sin dependencias con Finanzas',
       not exists (select 1 from pg_constraint
                   where contype = 'f'
                     and conrelid in ('public.colectivo_caja_categorias'::regclass, 'public.colectivo_gastos'::regclass)
                     and confrelid::regclass::text like 'fin\_%')
       and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.proname like 'fin\_%' and p.prosrc ~* 'colectivo_');
