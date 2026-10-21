-- ============================================================================
-- ROLLBACK de db/cupones-retencion.sql — solo si hay que volver atrás.
-- ----------------------------------------------------------------------------
-- Orden: PRIMERO volver a desplegar la aplicación anterior (sin retenciones) y
-- esperar a que no queden instancias nuevas; RECIÉN DESPUÉS correr esto.
-- (Al revés, la aplicación nueva quedaría sin sus RPCs: con cupones limitados
-- responde 503 y no cobra nada, pero ese rato no se vende con esos cupones.)
--
-- Qué hace:
--   · consumir_codigo_descuento vuelve al cuerpo de B9 (no mira retenciones).
--   · Quita las RPCs de retención: si quedara alguna instancia nueva, falla
--     cerrada (no retiene, no cobra con cupón limitado) en vez de a medias.
--   · NO borra codigo_retenciones: queda como registro (solo lectura) de qué
--     compra tuvo qué cupón, con qué pago y por qué se liberó.
--
-- Limitación (ver docs/marketing/cupones-retencion.md): las retenciones que
-- estaban en 'retenido' dejan de contar. Si esas compras se pagan después, el
-- webhook anterior consume con el contador de siempre; si el cupón ya llegó a su
-- máximo, ese uso no se cuenta (la compra igual queda paga). Antes de correr
-- esto, listar las retenidas (consulta al final) y revisarlas.
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

revoke all on function public.consumir_codigo_descuento(text) from public, anon, authenticated;
grant execute on function public.consumir_codigo_descuento(text) to service_role;

drop function if exists public.codigo_retener(uuid, text, text, text);
drop function if exists public.codigo_retencion_vincular(uuid, jsonb);
drop function if exists public.codigo_retencion_consumir(uuid, text, jsonb);
drop function if exists public.codigo_retencion_liberar(uuid, text);
drop function if exists public.codigo_retencion_anotar_revision(uuid, text, text);
drop function if exists public.codigo_retenciones_cubrir_legado(bigint, interval);

-- Para revisar ANTES de correr lo de arriba (sin teléfonos ni nombres):
-- select codigo, producto, reserva_id, grupo_compra_id, external_reference, retenido_en, vence_en, nota
--   from public.codigo_retenciones where estado = 'retenido' order by retenido_en;
