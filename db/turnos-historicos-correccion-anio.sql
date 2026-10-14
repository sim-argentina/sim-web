-- ============================================================================
-- Corrección del AÑO de los Excel históricos del stand (14/10/2026)
-- ----------------------------------------------------------------------------
-- CAUSA. El importador de Métricas armaba la fecha con new Date().getFullYear()
-- y el mes del nombre del archivo. Las plantillas de octubre, noviembre y
-- diciembre de 2025 se importaron el 20/05/2026 y quedaron como 2026-10/11/12:
-- meses que todavía no habían ocurrido. "Este mes" (octubre de 2026) sumaba esas
-- 891 ventas a las reales del turnero, y "Este año" incluía tres meses de 2025.
--
-- REGLA confirmada por el dueño, SOLO para este conjunto ya cargado:
--   octubre, noviembre y diciembre → 2025; los demás Excel → 2026 (no se tocan).
-- No es una regla permanente: desde este cambio cada importación confirma el año
-- de cada archivo (lib/historicosStand.ts) y la API rechaza fechas futuras.
--
-- QUÉ FILAS (por origen y evidencia; nunca "todo octubre a diciembre"):
--   · origen = 'excel' y archivo_key de una de las TRES plantillas;
--   · fecha en 2026 y en el mes de esa plantilla (10, 11 o 12);
--   · creada ANTES de que empezara ese mes de 2026 (hora argentina): una venta
--     registrada antes de que exista su mes no puede pertenecer a ese mes.
--   Si alguna fila de esas plantillas no cumple el criterio y no está ya en 2025,
--   la corrección ABORTA sin tocar nada: es una ambigüedad para revisar a mano.
--   Los registros operativos (turnos_stand, reservas) no se leen ni se tocan.
--
-- QUÉ CAMBIA. Solo `fecha` (2026-MM-DD → 2025-MM-DD) y el segmento de fecha de
-- `hash_unico`, que la incluye (archivo_key|fecha|horas|pago|monto|...). Así,
-- reimportar la plantilla con 2025 da el mismo hash y no duplica. Mes, día,
-- cantidades, minutos, turnos, importes y pagos quedan idénticos (se verifica).
--
-- RESPALDO. Cada fila se copia entera (jsonb) a turnos_historicos_correccion_anio
-- antes del cambio. Todo es UN bloque: si una verificación falla, no queda nada.
-- Idempotente: una segunda corrida no encuentra filas y no pisa el respaldo.
--
-- SIMULACRO sin huella (hace todo, verifica y se deshace con RAISE):
--   begin; set local sim.simulacro = 'on'; <este archivo>; rollback;
--
-- ROLLBACK (no se ejecuta acá):
--   update public.turnos_historicos t
--      set fecha = r.fecha_anterior, hash_unico = r.hash_anterior
--     from public.turnos_historicos_correccion_anio r
--    where r.correccion = 'excel-oct-dic-2025' and r.id = t.id
--      and t.fecha = r.fecha_nueva and t.hash_unico = r.hash_nuevo;
--   Antes, deshacer db/turnos-historicos-transferencias.sql: dos de estas filas
--   (noviembre y diciembre) cambiaron después su pago y su hash (TRASF → TRANSFERENCIA).
-- ============================================================================
do $correccion$
declare
  c_correccion constant text := 'excel-oct-dic-2025';
  c_claves constant text[] := array[
    'plantilla-turnos-nuevo-centro-octubre-xlsx',
    'plantilla-turnos-nuevo-centro-noviembre-xlsx',
    'plantilla-turnos-nuevo-centro-diciembre-xlsx'
  ];
  c_meses constant text[] := array['10', '11', '12'];
  v_simulacro boolean := coalesce(current_setting('sim.simulacro', true), '') = 'on';
  v_objetivo int;
  v_ambiguas int;
  v_otras_oct_dic int;
  v_respaldadas int;
  v_actualizadas int;
  v_huella_antes text;
  v_huella_despues text;
  v_antes record;
  v_despues record;
  v_por_mes text;
begin
  create table if not exists public.turnos_historicos_correccion_anio (
    correccion text not null,
    id bigint not null,
    archivo_key text not null,
    fecha_anterior text not null,
    fecha_nueva text not null,
    hash_anterior text not null,
    hash_nuevo text not null,
    fila_original jsonb not null,
    corregido_at timestamptz not null default now(),
    primary key (correccion, id)
  );
  alter table public.turnos_historicos_correccion_anio enable row level security;
  comment on table public.turnos_historicos_correccion_anio is
    'Respaldo de correcciones de año en turnos_historicos (fila original completa). '
    'Ver db/turnos-historicos-correccion-anio.sql para el rollback.';

  -- Nadie importa ni borra históricos mientras se corrige.
  lock table public.turnos_historicos in share row exclusive mode;

  drop table if exists pg_temp._correccion_objetivo;
  create temp table _correccion_objetivo on commit drop as
  select t.id,
         t.archivo_key,
         t.fecha as fecha_anterior,
         '2025' || substr(t.fecha, 5) as fecha_nueva,
         t.hash_unico as hash_anterior,
         t.archivo_key || '|2025' || substr(t.fecha, 5)
           || substr(t.hash_unico, length(t.archivo_key) + length(t.fecha) + 2) as hash_nuevo,
         to_jsonb(t) as fila_original
    from public.turnos_historicos t
    join unnest(c_claves, c_meses) as p(clave, mes) on p.clave = t.archivo_key
   where t.origen = 'excel'
     and t.fecha ~ ('^2026-' || p.mes || '-[0-9]{2}$')
     and left(t.hash_unico, length(t.archivo_key) + length(t.fecha) + 2)
         = t.archivo_key || '|' || t.fecha || '|'
     and t.created_at < (make_date(2026, p.mes::int, 1)::timestamp at time zone 'America/Argentina/Buenos_Aires');
  select count(*) into v_objetivo from _correccion_objetivo;

  -- Ambigüedad: filas de esas plantillas que no cumplen el criterio y no están en 2025.
  select count(*) into v_ambiguas
    from public.turnos_historicos t
   where t.archivo_key = any (c_claves)
     and left(t.fecha, 5) <> '2025-'
     and not exists (select 1 from _correccion_objetivo o where o.id = t.id);
  if v_ambiguas > 0 then
    raise exception 'CORRECCION ABORTADA: % filas de las plantillas de octubre a diciembre no cumplen el criterio (origen excel, mes de la plantilla, hash con su fecha, creadas antes de ese mes de 2026). Revisarlas a mano.', v_ambiguas;
  end if;

  -- Históricos de oct–dic de 2026 de OTROS archivos: fuera de este conjunto, no se tocan.
  select count(*) into v_otras_oct_dic
    from public.turnos_historicos t
   where left(t.fecha, 7) in ('2026-10', '2026-11', '2026-12')
     and not (t.archivo_key = any (c_claves));

  -- El hash nuevo no puede chocar con otra venta (hash_unico es UNIQUE).
  if exists (
    select 1
      from public.turnos_historicos h
      join _correccion_objetivo o on o.hash_nuevo = h.hash_unico and h.id <> o.id
  ) or (select count(distinct hash_nuevo) from _correccion_objetivo) <> v_objetivo then
    raise exception 'CORRECCION ABORTADA: un hash corregido ya existe en otra venta.';
  end if;

  -- Huella del resto de la tabla y totales generales, para comparar al final.
  select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), ''))
    into v_huella_antes
    from public.turnos_historicos t
   where not exists (select 1 from _correccion_objetivo o where o.id = t.id);
  select count(*) as n, coalesce(sum(total), 0) as total, coalesce(sum(cantidad_turnos), 0) as turnos,
         coalesce(sum(cantidad_simuladores), 0) as sims, coalesce(sum(duracion), 0) as minutos
    into v_antes
    from public.turnos_historicos;

  -- Respaldo (si ya existe de una corrida anterior, se conserva el original).
  insert into public.turnos_historicos_correccion_anio
         (correccion, id, archivo_key, fecha_anterior, fecha_nueva, hash_anterior, hash_nuevo, fila_original)
  select c_correccion, id, archivo_key, fecha_anterior, fecha_nueva, hash_anterior, hash_nuevo, fila_original
    from _correccion_objetivo
  on conflict (correccion, id) do nothing;
  get diagnostics v_respaldadas = row_count;

  update public.turnos_historicos t
     set fecha = o.fecha_nueva,
         hash_unico = o.hash_nuevo
    from _correccion_objetivo o
   where o.id = t.id
     and t.fecha = o.fecha_anterior
     and t.hash_unico = o.hash_anterior;
  get diagnostics v_actualizadas = row_count;

  -- ── Verificaciones: cualquier falla deshace todo ──────────────────────────
  if v_actualizadas <> v_objetivo then
    raise exception 'CORRECCION ABORTADA: se esperaban % filas y se actualizaron %.', v_objetivo, v_actualizadas;
  end if;

  if exists (
    select 1
      from _correccion_objetivo o
      left join public.turnos_historicos_correccion_anio r on r.correccion = c_correccion and r.id = o.id
     where r.id is null or r.fecha_anterior <> o.fecha_anterior or r.hash_nuevo <> o.hash_nuevo
  ) then
    raise exception 'CORRECCION ABORTADA: falta el respaldo de alguna fila.';
  end if;

  if exists (
    select 1
      from public.turnos_historicos t
      join _correccion_objetivo o on o.id = t.id
     where (to_jsonb(t) - 'fecha' - 'hash_unico') <> (o.fila_original - 'fecha' - 'hash_unico')
        or substr(t.fecha, 5) <> substr(o.fecha_anterior, 5)
        or left(t.fecha, 4) <> '2025'
        or t.hash_unico <> o.hash_nuevo
  ) then
    raise exception 'CORRECCION ABORTADA: cambió algo más que el año.';
  end if;

  select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), ''))
    into v_huella_despues
    from public.turnos_historicos t
   where not exists (select 1 from _correccion_objetivo o where o.id = t.id);
  if v_huella_despues <> v_huella_antes then
    raise exception 'CORRECCION ABORTADA: cambió una fila fuera de las plantillas de octubre a diciembre.';
  end if;

  select count(*) as n, coalesce(sum(total), 0) as total, coalesce(sum(cantidad_turnos), 0) as turnos,
         coalesce(sum(cantidad_simuladores), 0) as sims, coalesce(sum(duracion), 0) as minutos
    into v_despues
    from public.turnos_historicos;
  if v_despues.n <> v_antes.n or v_despues.total <> v_antes.total or v_despues.turnos <> v_antes.turnos
     or v_despues.sims <> v_antes.sims or v_despues.minutos <> v_antes.minutos then
    raise exception 'CORRECCION ABORTADA: cambiaron los totales de la tabla.';
  end if;

  if exists (
    select 1 from public.turnos_historicos t
     where t.archivo_key = any (c_claves) and left(t.fecha, 5) <> '2025-'
  ) then
    raise exception 'CORRECCION ABORTADA: quedaron filas de las plantillas fuera de 2025.';
  end if;

  select coalesce(string_agg(format('%s=%s', mes, n), ' ' order by mes), '-')
    into v_por_mes
    from (select left(fecha_nueva, 7) as mes, count(*) as n from _correccion_objetivo group by 1) m;

  if v_simulacro then
    raise exception 'SIMULACRO OK (se deshace) | corregirian=% respaldo_nuevo=% por_mes=% otras_oct_dic_2026=% tabla=% filas/$%',
      v_actualizadas, v_respaldadas, v_por_mes, v_otras_oct_dic, v_despues.n, v_despues.total;
  end if;

  raise notice 'CORRECCION OK | corregidas=% respaldo_nuevo=% por_mes=% otras_oct_dic_2026=% tabla=% filas/$%',
    v_actualizadas, v_respaldadas, v_por_mes, v_otras_oct_dic, v_despues.n, v_despues.total;
end
$correccion$;
