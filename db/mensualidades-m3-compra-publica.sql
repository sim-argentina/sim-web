-- ============================================================================
-- Mensualidades SIM · Bloque M3 — Compra pública y Mercado Pago
-- ----------------------------------------------------------------------------
-- Fuente de verdad. Aplicado a SIM WEB (bcmoewwhsyxsiyvroarj). ADITIVO/IDEMPOTENTE.
-- Solo agrega columnas e índices a mensualidad_compras. NO toca el resto del
-- modelo de M2, ni reservas, gift_cards, empresa_*, fin_* ni campeonato_*.
--
-- COLUMNAS NUEVAS
--  · token_publico            → credencial de la PANTALLA DE RESULTADO. Aleatoria,
--    no predecible, distinta del id interno, del código de mensualidad y del
--    teléfono. Es lo único que viaja en la URL de vuelta de Mercado Pago: los
--    query params de MP (collection_status y compañía) NO son prueba de pago.
--  · mp_init_point            → se guarda para que un reintento con la misma
--    idempotency_key devuelva la MISMA preferencia en vez de crear otra.
--  · mp_status/mp_status_detail → último estado REAL informado por Mercado Pago
--    (consultado con credenciales del servidor, nunca el del webhook).
--  · condiciones_version / condiciones_aceptadas_at → qué texto aceptó y cuándo.
--  · reconciliado_at          → cooldown de la reconciliación server-side, para no
--    pegarle a Mercado Pago en cada refresh del comprador.
--
-- CICLO DE VIDA (importante)
--  · estado_pago es el ciclo INTERNO: 'pendiente' hasta que la RPC la aplica y
--    entonces 'aprobado'. Un pago rechazado NO pasa la compra a 'rechazado': la
--    preferencia de Mercado Pago sigue siendo pagable y, si después entra un pago
--    aprobado, tiene que poder acreditarse. El rechazo queda en mp_status.
--    Así "apagar la venta" o "un intento fallido" nunca dejan sin acreditar a
--    alguien que efectivamente pagó.
--  · procesamiento sigue siendo 'pendiente' | 'aplicado' | 'ignorado'.
-- ============================================================================

alter table public.mensualidad_compras add column if not exists token_publico            text;
alter table public.mensualidad_compras add column if not exists mp_init_point            text;
alter table public.mensualidad_compras add column if not exists mp_status                text;
alter table public.mensualidad_compras add column if not exists mp_status_detail         text;
alter table public.mensualidad_compras add column if not exists condiciones_version      text;
alter table public.mensualidad_compras add column if not exists condiciones_aceptadas_at timestamptz;
alter table public.mensualidad_compras add column if not exists reconciliado_at          timestamptz;

-- El token es la llave pública de la pantalla de resultado: único y con entropía
-- suficiente (24 bytes base64url = 32 caracteres).
create unique index if not exists mensualidad_compras_token_uq
  on public.mensualidad_compras (token_publico) where token_publico is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mensualidad_compras_token_chk'
      and conrelid = 'public.mensualidad_compras'::regclass
  ) then
    alter table public.mensualidad_compras
      add constraint mensualidad_compras_token_chk
      check (token_publico is null or token_publico ~ '^[A-Za-z0-9_-]{24,64}$');
  end if;
end;
$$;

-- Cola de reconciliación: compras que siguen sin aplicar y ya tienen preferencia.
create index if not exists mensualidad_compras_pendientes_idx
  on public.mensualidad_compras (created_at desc)
  where procesamiento = 'pendiente' and mp_preference_id is not null;

-- Las columnas nuevas heredan el RLS y los grants de la tabla (deny-by-default,
-- solo service_role). Se reafirma por si la migración corre con otro rol.
revoke all on table public.mensualidad_compras from public, anon, authenticated;
grant select, insert, update, delete on table public.mensualidad_compras to service_role;
