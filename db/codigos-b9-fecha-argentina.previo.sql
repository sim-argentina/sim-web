-- ============================================================================
-- RESPALDO (rollback) de B9 — consumir_codigo_descuento tal como estaba antes de
-- db/codigos-b9-fecha-argentina.sql. Copia exacta de pg_get_functiondef.
-- Para volver atrás: aplicar este archivo. Los permisos (EXECUTE solo para
-- postgres y service_role) no cambian con create or replace.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.consumir_codigo_descuento(p_codigo text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rows integer;
  v_hoy text := to_char((now() at time zone 'utc'), 'YYYY-MM-DD');
begin
  update codigos_descuento c
  set usos_actuales = coalesce(c.usos_actuales, 0) + 1,
      activo = case
                 when c.usos_maximos is not null
                      and coalesce(c.usos_actuales, 0) + 1 >= c.usos_maximos then false
                 else c.activo
               end
  where c.codigo = upper(trim(p_codigo))
    and c.activo = true
    and (c.fecha_inicio is null or c.fecha_inicio::text <= v_hoy)
    and (c.fecha_fin is null or c.fecha_fin::text >= v_hoy)
    and (c.usos_maximos is null or coalesce(c.usos_actuales, 0) < c.usos_maximos);
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$function$;
