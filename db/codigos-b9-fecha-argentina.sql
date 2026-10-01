-- ============================================================================
-- B9 — Consumo de códigos de descuento con la fecha comercial de Argentina.
-- ----------------------------------------------------------------------------
-- consumir_codigo_descuento medía la vigencia (fecha_inicio / fecha_fin) con la
-- fecha UTC: desde las 21:00 de Argentina ya era "mañana", así que un código que
-- vencía hoy dejaba de consumirse a la noche y uno que empezaba mañana ya se
-- consumía. Ahora usa la fecha de Argentina, igual que la validación previa en
-- TypeScript (hoyEnSim, lib/codigosDescuento.ts).
--
-- Además, un código eliminado desde el panel (soft delete, deleted_at) ya no se
-- consume aunque haya quedado activo: eliminado = como si no existiera (la
-- validación en TypeScript aplica la misma regla).
--
-- Misma firma, mismos permisos (create or replace conserva el EXECUTE solo para
-- postgres y service_role), mismo consumo atómico (UPDATE condicional). Sin
-- cambios de tablas ni de datos. Rollback: db/codigos-b9-fecha-argentina.previo.sql.
-- Verificación sin huella: db/codigos-b9-fecha-argentina.verificacion.sql.
-- El cuerpo NO lleva comentarios: así es idéntico al que queda en la base.
-- ============================================================================
create or replace function public.consumir_codigo_descuento(p_codigo text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_rows integer;
  v_hoy text := to_char((now() at time zone 'America/Argentina/Buenos_Aires'), 'YYYY-MM-DD');
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
    and c.deleted_at is null
    and (c.fecha_inicio is null or c.fecha_inicio::text <= v_hoy)
    and (c.fecha_fin is null or c.fecha_fin::text >= v_hoy)
    and (c.usos_maximos is null or coalesce(c.usos_actuales, 0) < c.usos_maximos);
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$function$;
