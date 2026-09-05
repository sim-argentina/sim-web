-- ============================================================================
-- Mensualidades SIM · M2.1 — Normalización argentina de teléfonos
-- ----------------------------------------------------------------------------
-- Fuente de verdad. Aplicado a SIM WEB (bcmoewwhsyxsiyvroarj). ADITIVO/IDEMPOTENTE.
-- Reemplaza (create or replace) DOS funciones de M2; no toca tablas, índices,
-- constraints, datos ni ningún otro módulo. db/mensualidades-m2.sql ya contiene
-- estas mismas versiones, así que volver a correr M2 entero también es correcto.
--
-- QUÉ CORRIGE
-- La versión de M2 hacía "quitar prefijos y tomar los últimos 10 dígitos", así que
-- "0351 15-5123456" daba 5155123456 y "+54 9 351 512-3456" daba 3515123456: la
-- misma persona con dos billeteras distintas, y una renovación que en vez de
-- renovar creaba una mensualidad nueva. Ahora se interpreta el "15" histórico.
--
-- REGLA
-- Canónico = número nacional argentino de 10 dígitos (área + local), sin 0, sin 15
-- y sin +54 9. El plan de numeración tiene tres largos de código de área:
--   · 2 dígitos → solo '11';
--   · 3 dígitos → conjunto fijo (c_areas3);
--   · 4 dígitos → el resto, siempre empezando con 2 o 3.
-- Como área + local = 10 SIEMPRE, el largo del área determina el único borde donde
-- puede estar el '15'. La interpretación es ÚNICA por construcción: '11' es el
-- único código de 2 dígitos y ninguno de 4 empieza con 1, así que dos lecturas
-- distintas del mismo número son imposibles. Si el '15' no está en ese borde, se
-- devuelve NULL en lugar de reubicarlo: pedir el número de nuevo es preferible a
-- asociar la mensualidad a otra persona.
--
-- Si la lista c_areas3 tuviera un faltante, ese número se leería como área de 4
-- dígitos, el '15' no caería en el borde y la función devolvería NULL. El modo de
-- falla es RECHAZAR, nunca asignar mal.
--
-- Espejo exacto de normalizarTelefono() en lib/mensualidades.ts. La paridad se
-- verifica caso por caso en lib/mensualidades.integration.ts.
-- ============================================================================

create or replace function public.mensualidad_normalizar_telefono(p_tel text)
returns text
language plpgsql immutable
set search_path = public
as $$
declare
  c_areas3 constant text[] := array[
    '220','221','223','230','236','237','249',
    '260','261','263','264','266','280','291','294','297','299',
    '336','341','342','343','345','348','351','353','358',
    '362','364','370','376','379','380','381','383','385','387','388'];
  v_raw  text := btrim(coalesce(p_tel, ''));
  v_mas  boolean;
  d      text;
  v_area integer;
  v_out  text;
begin
  if v_raw = '' then return null; end if;

  -- 1) Solo dígitos y símbolos de presentación. Letras y demás → rechazo.
  if v_raw ~ '[^0-9+().\-[:space:]]' then return null; end if;
  v_mas := left(v_raw, 1) = '+';
  if length(v_raw) - length(replace(v_raw, '+', '')) > 1 then return null; end if;
  if position('+' in v_raw) > 1 then return null; end if;

  d := regexp_replace(v_raw, '[^0-9]', '', 'g');
  if d = '' then return null; end if;

  -- 2/3) Prefijo internacional: si viene explícito, tiene que ser Argentina (54).
  if v_mas then
    if left(d, 2) <> '54' then return null; end if;
    d := substr(d, 3);
  elsif left(d, 2) = '00' then
    d := substr(d, 3);
    if left(d, 2) <> '54' then return null; end if;
    d := substr(d, 3);
  elsif left(d, 2) = '54' and length(d) >= 12 then
    -- Ningún código de área argentino empieza con 5: solo puede ser el país.
    d := substr(d, 3);
  end if;

  -- 4/5) 9 móvil y 0 de trunk nacional. Ningún código de área empieza con 0 ni 9,
  -- y el corte nunca baja de 10 dígitos, así que no puede comerse un área válida.
  while length(d) > 10 and left(d, 1) in ('0', '9') loop
    d := substr(d, 2);
  end loop;

  -- 7) Canónico: exactamente 10 dígitos.
  if length(d) = 10 then
    if left(d, 2) = '11' then return d; end if;
    if left(d, 1) = '1' then return null; end if;   -- '11' es el único de 2 dígitos
    if left(d, 1) in ('2', '3') then return d; end if;
    return null;
  end if;

  -- 6) 12 dígitos = los 10 del número + el '15' histórico intercalado.
  if length(d) = 12 then
    if left(d, 2) = '11' then
      v_area := 2;
    elsif left(d, 1) = '1' then
      return null;
    elsif left(d, 3) = any (c_areas3) then
      v_area := 3;
    elsif left(d, 1) in ('2', '3') then
      v_area := 4;
    else
      return null;
    end if;

    if substr(d, v_area + 1, 2) <> '15' then return null; end if;
    v_out := left(d, v_area) || substr(d, v_area + 3);
    if length(v_out) <> 10 then return null; end if;
    if left(v_out, 2) <> '11' and left(v_out, 1) not in ('2', '3') then return null; end if;
    return v_out;
  end if;

  -- 8/9) Nada de "tomar los últimos 10": cualquier otro largo se rechaza.
  return null;
end;
$$;

revoke all on function public.mensualidad_normalizar_telefono(text) from public, anon, authenticated;
grant execute on function public.mensualidad_normalizar_telefono(text) to service_role;

-- ── RPC: guarda de identidad canónica ───────────────────────────────────────
-- La billetera se busca y se bloquea por telefono_norm. Si no llega en la forma
-- canónica de 10 dígitos, la identidad del titular no es confiable y una
-- renovación podría terminar en la persona equivocada: se corta antes de tocar
-- nada. Único cambio respecto de M2; el resto del cuerpo es idéntico.

create or replace function public.mensualidad_aplicar_compra(
  p_external_reference text,
  p_mp_payment_id      text,
  p_importe_bruto      numeric     default null,
  p_comision_mp        numeric     default null,
  p_importe_neto       numeric     default null,
  p_aprobado_at        timestamptz default now()
) returns public.mensualidad_compras
language plpgsql security definer set search_path = public as $f$
declare
  c_max_traslado constant integer := 60;
  v_compra    public.mensualidad_compras;
  v_mens      public.mensualidades;
  v_hoy       date;
  v_vence     date;
  v_traslado  integer := 0;
  v_descarte  integer := 0;
  v_saldo_ini integer := 0;
  v_saldo_fin integer;
  v_tipo      text;
  v_codigo    text;
begin
  if coalesce(btrim(p_external_reference), '') = '' then
    raise exception 'external_reference_requerida' using errcode = '22023';
  end if;
  if coalesce(btrim(p_mp_payment_id), '') = '' then
    raise exception 'payment_id_requerido' using errcode = '22023';
  end if;

  select * into v_compra from public.mensualidad_compras
   where mp_payment_id = p_mp_payment_id and procesamiento = 'aplicado' limit 1;
  if found then
    if v_compra.external_reference is distinct from p_external_reference then
      raise exception 'payment_id_de_otra_compra' using errcode = '23505';
    end if;
    return v_compra;
  end if;

  select * into v_compra from public.mensualidad_compras
   where external_reference = p_external_reference for update;
  if not found then raise exception 'compra_inexistente' using errcode = 'P0002'; end if;
  if v_compra.procesamiento = 'aplicado' then return v_compra; end if;
  if v_compra.estado_pago <> 'pendiente' then
    raise exception 'compra_no_pendiente' using errcode = '22023';
  end if;

  -- (M2.1) Identidad canónica obligatoria.
  if v_compra.telefono_norm !~ '^[0-9]{10}$' then
    raise exception 'telefono_no_canonico' using errcode = '22023';
  end if;

  v_hoy   := (p_aprobado_at at time zone 'America/Argentina/Cordoba')::date;
  v_vence := v_hoy + v_compra.plan_vigencia_dias;

  perform pg_advisory_xact_lock(hashtext('mensualidad:' || v_compra.telefono_norm)::bigint);

  select * into v_mens from public.mensualidades
   where telefono_norm = v_compra.telefono_norm
   order by vence_el desc, created_at desc limit 1
   for update;

  if found and v_mens.vence_el >= v_hoy then
    v_tipo      := 'renovacion';
    v_saldo_ini := v_mens.saldo_minutos;
    v_traslado  := least(v_saldo_ini, c_max_traslado);
    v_descarte  := v_saldo_ini - v_traslado;
    v_saldo_fin := v_traslado + v_compra.plan_minutos;
    v_codigo    := v_mens.codigo;

    if v_descarte > 0 then
      insert into public.mensualidad_movimientos
        (mensualidad_id, compra_id, tipo, minutos, saldo_anterior, saldo_posterior, motivo)
      values
        (v_mens.id, v_compra.id, 'descarte', -v_descarte, v_saldo_ini, v_traslado,
         format('Excede el máximo trasladable de %s minutos al renovar', c_max_traslado));
    end if;

    insert into public.mensualidad_movimientos
      (mensualidad_id, compra_id, tipo, minutos, saldo_anterior, saldo_posterior, motivo, idempotency_key)
    values
      (v_mens.id, v_compra.id, 'renovacion', v_compra.plan_minutos, v_traslado, v_saldo_fin,
       format('Renovación con plan %s', v_compra.plan_slug), 'pago:' || p_mp_payment_id);

    -- El bloqueo administrativo NO se levanta al renovar (decisión aprobada).
    update public.mensualidades
       set saldo_minutos    = v_saldo_fin,
           vence_el         = v_vence,
           titular_nombre   = v_compra.comprador_nombre,
           titular_apellido = v_compra.comprador_apellido,
           titular_email    = v_compra.comprador_email
     where id = v_mens.id
     returning * into v_mens;
  else
    v_tipo      := 'alta';
    v_saldo_ini := 0;
    v_traslado  := 0;
    v_descarte  := 0;
    v_saldo_fin := v_compra.plan_minutos;
    v_codigo    := public.mensualidad_generar_codigo();

    insert into public.mensualidades
      (codigo, titular_nombre, titular_apellido, titular_telefono, telefono_norm,
       titular_email, saldo_minutos, vence_el)
    values
      (v_codigo, v_compra.comprador_nombre, v_compra.comprador_apellido,
       v_compra.comprador_telefono, v_compra.telefono_norm, v_compra.comprador_email,
       v_saldo_fin, v_vence)
    returning * into v_mens;

    insert into public.mensualidad_movimientos
      (mensualidad_id, compra_id, tipo, minutos, saldo_anterior, saldo_posterior, motivo, idempotency_key)
    values
      (v_mens.id, v_compra.id, 'compra', v_compra.plan_minutos, 0, v_saldo_fin,
       format('Alta con plan %s', v_compra.plan_slug), 'pago:' || p_mp_payment_id);
  end if;

  update public.mensualidad_compras
     set mensualidad_id      = v_mens.id,
         tipo                = v_tipo,
         minutos_trasladados = v_traslado,
         minutos_descartados = v_descarte,
         saldo_resultante    = v_saldo_fin,
         vence_el            = v_vence,
         estado_pago         = 'aprobado',
         procesamiento       = 'aplicado',
         mp_payment_id       = p_mp_payment_id,
         importe_bruto       = coalesce(p_importe_bruto, importe_bruto),
         comision_mp         = coalesce(p_comision_mp, comision_mp),
         importe_neto        = coalesce(p_importe_neto, importe_neto),
         aprobado_at         = p_aprobado_at
   where id = v_compra.id
   returning * into v_compra;

  return v_compra;
end;
$f$;

revoke all on function public.mensualidad_aplicar_compra(text, text, numeric, numeric, numeric, timestamptz) from public, anon, authenticated;
grant execute on function public.mensualidad_aplicar_compra(text, text, numeric, numeric, numeric, timestamptz) to service_role;
