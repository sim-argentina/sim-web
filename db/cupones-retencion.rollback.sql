-- ============================================================================
-- ROLLBACK de db/cupones-retencion.sql — solo cuando ya no queda nada retenido.
-- ----------------------------------------------------------------------------
-- NO es el camino para "frenar" un problema: para eso está la pausa de nuevas
-- retenciones (corrección hacia adelante), que no pierde nada:
--   select public.codigo_retenciones_pausar(true, 'motivo');
-- Volver al comportamiento anterior con retenciones vigentes dejaría compras
-- que todavía pueden aprobarse sin su cupo apartado (el cupón podría superar su
-- límite) y retenciones que nadie resolvería. Por eso este archivo SE NIEGA a
-- correr si:
--   · las nuevas retenciones no están pausadas (sin la pausa, entre el chequeo
--     y el despliegue podría aparecer otra), o
--   · queda alguna retención en 'retenido' (con o sin oportunidad de pago).
-- Toma la tabla en modo EXCLUSIVE (frena altas y cambios, deja leer) antes de
-- contar, así ninguna retención nueva se cuela entre el chequeo y el cambio. Es
-- UN SOLO bloque: o se aplica entero o no cambia nada (con psql o por MCP).
--
-- Procedimiento completo (docs/marketing/cupones-retencion.md, "Rollback"):
--   1. Pausar las nuevas retenciones (arriba). Los cupones limitados responden
--      503 en compras nuevas; lo existente sigue: pagos, webhooks, conciliación.
--   2. Esperar a que se resuelvan: con la versión nueva, cada link vence a los
--      30 min y se concilia 15 min después (compra siguiente, panel o cron).
--      Las retenciones 'legado' con un link que no vence pueden no resolverse
--      nunca: en ese caso NO corresponde el rollback (mantener el esquema y
--      corregir hacia adelante).
--   3. Con 0 retenidas: volver a desplegar la aplicación anterior y esperar a
--      que el dominio la sirva. Contra esta base funciona igual que antes (sin
--      retenciones vigentes, el consumo de siempre cuenta lo mismo).
--   4. Correr este archivo. Si falla con 'rollback_bloqueado', no se cambió nada.
--
-- Qué hace (si pasa los chequeos):
--   · consumir_codigo_descuento vuelve al cuerpo de B9 (no mira retenciones).
--   · Quita las RPCs de retención: si quedara alguna instancia nueva, falla
--     cerrada (no retiene, no cobra con cupón limitado) en vez de a medias.
--   · CONSERVA codigo_retenciones y codigo_retenciones_control: registro de solo
--     lectura de qué compra tuvo qué cupón, con qué pago, por qué se liberó y
--     cada revisión. La pausa queda puesta: si un día se vuelve a aplicar la
--     migración, las retenciones nuevas siguen pausadas hasta reanudarlas.
--
-- Para mirar ANTES (sin teléfonos ni nombres):
--   select nuevas_pausadas, motivo, cambiado_en from public.codigo_retenciones_control;
--   select codigo, producto, reserva_id, grupo_compra_id, external_reference,
--          retenido_en, vence_en, nota, revision_motivo
--     from public.codigo_retenciones where estado = 'retenido' order by retenido_en;
-- ============================================================================

do $rollback$
declare
  v_pausada  boolean;
  v_retenidas integer;
begin
  lock table public.codigo_retenciones in exclusive mode;
  lock table public.codigo_retenciones_control in exclusive mode;

  select nuevas_pausadas into v_pausada from public.codigo_retenciones_control where id;
  if not coalesce(v_pausada, false) then
    raise exception 'rollback_bloqueado: las nuevas retenciones no están pausadas (select public.codigo_retenciones_pausar(true, ''motivo'');)'
      using errcode = '55000';
  end if;

  select count(*) into v_retenidas from public.codigo_retenciones where estado = 'retenido';
  if v_retenidas > 0 then
    raise exception 'rollback_bloqueado: quedan % retenciones vigentes; conciliarlas antes o mantener el esquema y corregir hacia adelante', v_retenidas
      using errcode = '55000';
  end if;

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
  drop function if exists public.codigo_retenciones_pausar(boolean, text);
end;
$rollback$;
