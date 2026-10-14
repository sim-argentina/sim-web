-- ============================================================================
-- Transferencias históricas guardadas como TRASF / TRANF (14/10/2026)
-- ----------------------------------------------------------------------------
-- CAUSA. Los Excel históricos del stand se importaron el 20/05/2026 con un
-- normalizador de pagos que no reconocía "Trasf" ni "Tranf": esas ventas
-- quedaron con metodo_pago TRASF / TRANF y ese texto dentro de hash_unico
-- (archivo_key|fecha|horas|PAGO|monto|...). Hoy el importador normaliza las dos
-- variantes a TRANSFERENCIA, igual en el navegador y en el servidor
-- (lib/historicosStand.ts). Reimportar esas ventas calculaba otro hash y las
-- habría duplicado.
--
-- QUÉ FILAS. turnos_historicos con origen 'excel', metodo_pago TRASF o TRANF y
-- ese mismo texto en el segmento de pago del hash. Al 14/10/2026 son 4: dos de
-- las plantillas de noviembre y diciembre de 2025 y dos de marzo de 2026. Si
-- aparece otra variante no canónica de transferencia, o una de estas filas con
-- el hash desalineado, la corrección ABORTA sin tocar nada. turnos_stand y
-- reservas no se leen ni se tocan.
--
-- QUÉ CAMBIA. Solo metodo_pago (→ 'TRANSFERENCIA', el valor canónico vigente)
-- y el segmento de pago de hash_unico. Fecha, cantidades, minutos, turnos e
-- importes quedan idénticos (se verifica).
--
-- COLISIONES. Si el hash canónico ya existe en otra venta, ABORTA: no se
-- fusionan ni se borran ventas automáticamente.
--
-- RESPALDO e IDEMPOTENCIA. Cada fila se copia entera a
-- turnos_historicos_correccion_pago antes del cambio. Todo es UN bloque; una
-- segunda corrida no encuentra filas y no pisa el respaldo.
--
-- SIMULACRO sin huella:
--   begin; set local sim.simulacro = 'on'; <este archivo>; rollback;
--
-- ROLLBACK (no se ejecuta acá):
--   update public.turnos_historicos t
--      set metodo_pago = r.metodo_anterior, hash_unico = r.hash_anterior
--     from public.turnos_historicos_correccion_pago r
--    where r.correccion = 'transferencias-canonicas' and r.id = t.id
--      and t.metodo_pago = r.metodo_nuevo and t.hash_unico = r.hash_nuevo;
--
-- ORDEN CON LA CORRECCIÓN DE AÑO. Dos de estas filas (noviembre y diciembre de
-- 2025) también están en turnos_historicos_correccion_anio, cuyo hash_nuevo
-- todavía dice TRASF. Para deshacer la corrección de año hay que deshacer
-- primero ésta; si no, su rollback no encuentra esas dos filas.
-- ============================================================================
do $transferencias$
declare
  c_correccion constant text := 'transferencias-canonicas';
  c_canonico constant text := 'TRANSFERENCIA';
  v_simulacro boolean := coalesce(current_setting('sim.simulacro', true), '') = 'on';
  v_objetivo int;
  v_ambiguas int;
  v_respaldadas int;
  v_actualizadas int;
  v_huella_antes text;
  v_huella_despues text;
  v_antes record;
  v_despues record;
  v_detalle text;
begin
  create table if not exists public.turnos_historicos_correccion_pago (
    correccion text not null,
    id bigint not null,
    archivo_key text not null,
    metodo_anterior text not null,
    metodo_nuevo text not null,
    hash_anterior text not null,
    hash_nuevo text not null,
    fila_original jsonb not null,
    corregido_at timestamptz not null default now(),
    primary key (correccion, id)
  );
  alter table public.turnos_historicos_correccion_pago enable row level security;
  comment on table public.turnos_historicos_correccion_pago is
    'Respaldo de correcciones del medio de pago en turnos_historicos (fila original completa). '
    'Ver db/turnos-historicos-transferencias.sql para el rollback.';

  lock table public.turnos_historicos in share row exclusive mode;

  drop table if exists pg_temp._pago_objetivo;
  create temp table _pago_objetivo on commit drop as
  select t.id,
         t.archivo_key,
         t.metodo_pago as metodo_anterior,
         c_canonico as metodo_nuevo,
         t.hash_unico as hash_anterior,
         array_to_string(
           (string_to_array(t.hash_unico, '|'))[1:5] || array[c_canonico] || (string_to_array(t.hash_unico, '|'))[7:11],
           '|'
         ) as hash_nuevo,
         to_jsonb(t) as fila_original
    from public.turnos_historicos t
   where t.origen = 'excel'
     and t.metodo_pago in ('TRASF', 'TRANF')
     and array_length(string_to_array(t.hash_unico, '|'), 1) = 11
     and split_part(t.hash_unico, '|', 6) = t.metodo_pago
     and left(t.hash_unico, length(t.archivo_key) + length(t.fecha) + 2) = t.archivo_key || '|' || t.fecha || '|';
  select count(*) into v_objetivo from _pago_objetivo;

  -- Ambigüedad: otra variante de transferencia no canónica, o una TRASF/TRANF
  -- con el hash desalineado, que este criterio no cubre.
  select count(*) into v_ambiguas
    from public.turnos_historicos t
   where upper(t.metodo_pago) ~ '(TRASF|TRANF|TRANSF)'
     and t.metodo_pago <> c_canonico
     and not exists (select 1 from _pago_objetivo o where o.id = t.id);
  if v_ambiguas > 0 then
    raise exception 'CORRECCION ABORTADA: % ventas con una variante de transferencia que este criterio no cubre. Revisarlas a mano.', v_ambiguas;
  end if;

  -- Colisión: el hash canónico ya es de otra venta. No se fusiona ni se borra nada.
  if exists (
    select 1
      from public.turnos_historicos h
      join _pago_objetivo o on o.hash_nuevo = h.hash_unico and h.id <> o.id
  ) or (select count(distinct hash_nuevo) from _pago_objetivo) <> v_objetivo then
    raise exception 'CORRECCION ABORTADA: el hash canónico de alguna transferencia ya existe en otra venta.';
  end if;

  select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), ''))
    into v_huella_antes
    from public.turnos_historicos t
   where not exists (select 1 from _pago_objetivo o where o.id = t.id);
  select count(*) as n, coalesce(sum(total), 0) as total, coalesce(sum(cantidad_turnos), 0) as turnos,
         coalesce(sum(cantidad_simuladores), 0) as sims, coalesce(sum(duracion), 0) as minutos
    into v_antes
    from public.turnos_historicos;

  insert into public.turnos_historicos_correccion_pago
         (correccion, id, archivo_key, metodo_anterior, metodo_nuevo, hash_anterior, hash_nuevo, fila_original)
  select c_correccion, id, archivo_key, metodo_anterior, metodo_nuevo, hash_anterior, hash_nuevo, fila_original
    from _pago_objetivo
  on conflict (correccion, id) do nothing;
  get diagnostics v_respaldadas = row_count;

  update public.turnos_historicos t
     set metodo_pago = o.metodo_nuevo,
         hash_unico = o.hash_nuevo
    from _pago_objetivo o
   where o.id = t.id
     and t.metodo_pago = o.metodo_anterior
     and t.hash_unico = o.hash_anterior;
  get diagnostics v_actualizadas = row_count;

  -- ── Verificaciones: cualquier falla deshace todo ──────────────────────────
  if v_actualizadas <> v_objetivo then
    raise exception 'CORRECCION ABORTADA: se esperaban % filas y se actualizaron %.', v_objetivo, v_actualizadas;
  end if;

  if exists (
    select 1
      from _pago_objetivo o
      left join public.turnos_historicos_correccion_pago r on r.correccion = c_correccion and r.id = o.id
     where r.id is null or r.metodo_anterior <> o.metodo_anterior or r.hash_nuevo <> o.hash_nuevo
  ) then
    raise exception 'CORRECCION ABORTADA: falta el respaldo de alguna fila.';
  end if;

  if exists (
    select 1
      from public.turnos_historicos t
      join _pago_objetivo o on o.id = t.id
     where (to_jsonb(t) - 'metodo_pago' - 'hash_unico') <> (o.fila_original - 'metodo_pago' - 'hash_unico')
        or t.metodo_pago <> c_canonico
        or t.hash_unico <> o.hash_nuevo
        or split_part(t.hash_unico, '|', 6) <> c_canonico
  ) then
    raise exception 'CORRECCION ABORTADA: cambió algo más que el medio de pago.';
  end if;

  select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), ''))
    into v_huella_despues
    from public.turnos_historicos t
   where not exists (select 1 from _pago_objetivo o where o.id = t.id);
  if v_huella_despues <> v_huella_antes then
    raise exception 'CORRECCION ABORTADA: cambió una venta que no era una transferencia a corregir.';
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
     where upper(t.metodo_pago) ~ '(TRASF|TRANF|TRANSF)' and t.metodo_pago <> c_canonico
  ) then
    raise exception 'CORRECCION ABORTADA: quedaron variantes de transferencia sin unificar.';
  end if;

  select coalesce(string_agg(format('%s:%s→%s', id, metodo_anterior, metodo_nuevo), ' ' order by id), '-')
    into v_detalle
    from _pago_objetivo;

  if v_simulacro then
    raise exception 'SIMULACRO OK (se deshace) | corregirian=% respaldo_nuevo=% filas=% tabla=% filas/$%',
      v_actualizadas, v_respaldadas, v_detalle, v_despues.n, v_despues.total;
  end if;

  raise notice 'CORRECCION OK | corregidas=% respaldo_nuevo=% filas=% tabla=% filas/$%',
    v_actualizadas, v_respaldadas, v_detalle, v_despues.n, v_despues.total;
end
$transferencias$;
