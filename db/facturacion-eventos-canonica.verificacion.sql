-- ============================================================================
-- Verificación de la fuente canónica de facturación, contra la base REAL.
-- ----------------------------------------------------------------------------
-- SOLO LECTURA: no escribe, no borra, no deja huella. Devuelve una fila por
-- problema encontrado y una sola fila "OK: ..." si todo se cumple.
--
-- Cubre lo que la prueba de TypeScript todavía no puede cubrir con datos: que
-- mensualidades e ingresos manuales estén DENTRO de la composición aunque hoy
-- no haya ninguna mensualidad aplicada en la base. Es introspección de la
-- definición, así que falla con cualquier implementación de cuatro fuentes.
-- ============================================================================
with def as (
  select pg_get_functiondef(p.oid) d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'fin_eventos_facturacion'
),
tablas as (
  select t as tabla, (select position(t in d) from def) > 0 as presente
  from unnest(array[
    'turnos_stand', 'reservas', 'gift_cards',
    'campeonato_inscripciones', 'mensualidad_compras', 'fin_movimientos'
  ]) t
),
reglas as (
            select 'mensualidades procesamiento=aplicado'  r, (select position('aplicado' in d) from def) > 0 ok
  union all select 'mensualidades fecha de pago aprobado',     (select position('cobrado_at' in d) from def) > 0
  union all select 'manuales excluyen financiamiento',         (select position('financiamiento' in d) from def) > 0
  union all select 'manuales excluyen ajuste_inicial',         (select position('ajuste_inicial' in d) from def) > 0
  union all select 'manuales por mes_contable',                (select position('mes_contable' in d) from def) > 0
  union all select 'manuales solo tipo=ingreso',               (select position('mv.tipo = ''ingreso''' in d) from def) > 0
  union all select 'sin tablas del colectivo',                 (select d !~* 'colectivo_' from def)
  union all select 'sin SECURITY DEFINER',                     (select d !~* 'security\s+definer' from def)
),
paridad as (
  select m.mes,
         (select coalesce(sum(total), 0) from fin_ingresos_por_mes(m.mes)) finanzas,
         (select coalesce(sum(monto), 0)
            from fin_eventos_facturacion(
              (m.mes || '-01')::date,
              (((m.mes || '-01')::date + interval '1 month') - interval '1 day')::date)
           where clase = 'automatico') canonica
  from (
    select distinct to_char(fecha_contable, 'YYYY-MM') mes
    from fin_eventos_facturacion('2020-01-01', '2030-12-31')
  ) m
)
select 'FALLA - tabla ausente de la composicion: ' || tabla as resultado from tablas where not presente
union all
select 'FALLA - regla ausente: ' || r from reglas where not ok
union all
select 'FALLA - paridad con Finanzas: ' || mes || ' finanzas=' || finanzas || ' canonica=' || canonica
  from paridad where round(finanzas, 2) <> round(canonica, 2)
union all
select 'FALLA - la canonica emite una fuente fuera del catalogo declarado'
  where exists (
    select 1 from fin_eventos_facturacion('2020-01-01', '2030-12-31')
    where fuente not in ('turnero', 'reservas_online', 'gift_cards', 'campeonatos', 'mensualidades', 'manuales')
  )
union all
select 'OK: ' || (select count(*)::text from paridad)
       || ' mes(es) con paridad exacta, 6 fuentes en una sola composicion, 8 reglas intactas'
  where not exists (select 1 from tablas where not presente)
    and not exists (select 1 from reglas where not ok)
    and not exists (select 1 from paridad where round(finanzas, 2) <> round(canonica, 2));
