-- ============================================================================
-- Mensualidades SIM · M2.2 — CHECK estricto de teléfono + indicativos ENACOM
-- ----------------------------------------------------------------------------
-- Fuente de verdad. Aplicado a SIM WEB (bcmoewwhsyxsiyvroarj). ADITIVO/IDEMPOTENTE.
-- Corrección mínima y exclusiva sobre M2/M2.1. NO toca el modelo (ninguna columna,
-- índice, trigger ni tabla nueva), NO toca datos, NO toca reservas, gift_cards,
-- empresa_*, fin_* ni campeonato_*. La RPC conserva su guarda telefono_no_canonico.
--
-- 1) CHECK ESTRICTO
--    Las DOS columnas telefono_norm del módulo (mensualidades y mensualidad_compras)
--    pasan de '^[0-9]{8,15}$' a '^[0-9]{10}$'. Se reemplazan POR NOMBRE y en la misma
--    transacción, así nunca coexisten el flojo y el estricto. Verificado antes de
--    aplicar: 0 filas en ambas tablas, así que no hay datos que migrar.
--    (La vista mensualidades_estado expone telefono_norm pero no define constraints.)
--
-- 2) INDICATIVOS VERIFICADOS CONTRA LA FUENTE OFICIAL
--    Verificación del 2026-09-05 contra ENACOM:
--      https://www.enacom.gob.ar/indicativos-interurbanos_p143
--      planilla 'archivo_20240521035456_1549.xls', hoja 'AREAS LOCALES 300'.
--    La planilla trae 300 indicativos: 1 de dos dígitos ('11'), 38 de tres y 261
--    de cuatro. Confirmado además que NINGÚN indicativo de cuatro dígitos empieza
--    con 1 y que todos arrancan con 1, 2 o 3 — que es exactamente lo que hace única
--    la lectura del '15' histórico.
--    DIFERENCIA ENCONTRADA (a): faltaba '298' (GENERAL ROCA, Río Negro). No
--    sobraba ninguno.
--
-- 3) DIFERENCIA ENCONTRADA (b) — corrección del algoritmo de M2.1
--    La comparación con la planilla mostró que 49 de los 261 indicativos de CUATRO
--    dígitos empiezan con un indicativo de TRES válido: 2202/220 (González Catán
--    vs Merlo), 3489/348 (Campana vs Zárate), 2945/294 (Esquel vs Bariloche),
--    3456/345, 3482/348, 2972/297… M2.1 elegía el largo del área ANTES de mirar el
--    '15', así que para esas 49 localidades el formato viejo '0AAAA 15-XXXXXX'
--    caía en la rama de 3 dígitos, el '15' no quedaba en el borde y devolvía NULL.
--    Modo de falla seguro (rechazo, nunca asignación equivocada), pero eran
--    titulares reales que no podían comprar.
--    Ahora los largos posibles son CANDIDATOS y decide dónde está efectivamente el
--    '15'. Dos lecturas simultáneas son imposibles —área 3 exige que el 5º dígito
--    sea '5' y área 4 exige que sea '1'—, y si alguna vez hubiera más de una, se
--    rechaza en vez de elegir en silencio.
--    El modo de falla seguro se mantiene: un área desconocida se rechaza.
-- ============================================================================

-- ── 1) CHECK estricto en las dos columnas telefono_norm del módulo ──────────

alter table public.mensualidades
  drop constraint if exists mensualidades_telnorm_chk;
alter table public.mensualidades
  add constraint mensualidades_telnorm_chk check (telefono_norm ~ '^[0-9]{10}$');

alter table public.mensualidad_compras
  drop constraint if exists mensualidad_compras_telnorm_chk;
alter table public.mensualidad_compras
  add constraint mensualidad_compras_telnorm_chk check (telefono_norm ~ '^[0-9]{10}$');

-- ── 2) Normalización con los 38 indicativos oficiales de 3 dígitos ──────────
-- Único cambio respecto de M2.1: se agrega '298'. El algoritmo no se toca.

create or replace function public.mensualidad_normalizar_telefono(p_tel text)
returns text
language plpgsql immutable
set search_path = public
as $$
declare
  -- ENACOM, hoja 'AREAS LOCALES 300' (verificado 2026-09-05): 38 indicativos.
  c_areas3 constant text[] := array[
    '220','221','223','230','236','237','249',
    '260','261','263','264','266','280','291','294','297','298','299',
    '336','341','342','343','345','348','351','353','358',
    '362','364','370','376','379','380','381','383','385','387','388'];
  v_raw   text := btrim(coalesce(p_tel, ''));
  v_mas   boolean;
  d       text;
  v_cands integer[];
  v_area  integer;
  v_out   text;
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
    -- Ningún indicativo argentino empieza con 5: solo puede ser el país.
    d := substr(d, 3);
  end if;

  -- 4/5) 9 móvil y 0 de trunk nacional. Ningún indicativo empieza con 0 ni 9, y el
  -- corte nunca baja de 10 dígitos, así que no puede comerse un área válida.
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
  -- Los largos de área son CANDIDATOS, no una decisión previa: 49 de los 261
  -- indicativos de 4 dígitos empiezan con uno de 3 válido (2202/220, 3489/348,
  -- 2945/294…), así que quedarse con el primero que matchea rompería justo esas
  -- localidades. Decide dónde cae el '15'. Dos lecturas simultáneas son
  -- imposibles (área 3 exige d[5]='5' y área 4 exige d[5]='1'), pero si alguna vez
  -- hubiera más de una, se rechaza en lugar de elegir en silencio.
  if length(d) = 12 then
    v_cands := '{}'::integer[];
    if left(d, 2) = '11'            and substr(d, 3, 2) = '15' then v_cands := v_cands || 2; end if;
    if left(d, 3) = any (c_areas3)  and substr(d, 4, 2) = '15' then v_cands := v_cands || 3; end if;
    if left(d, 1) in ('2', '3')     and substr(d, 5, 2) = '15' then v_cands := v_cands || 4; end if;
    if coalesce(array_length(v_cands, 1), 0) <> 1 then return null; end if;
    v_area := v_cands[1];

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
