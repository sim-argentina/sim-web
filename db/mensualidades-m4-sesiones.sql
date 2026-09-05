-- ============================================================================
-- Mensualidades SIM · Bloque M4 — Sesión pública de consulta
-- ----------------------------------------------------------------------------
-- Fuente de verdad. Aplicado a SIM WEB (bcmoewwhsyxsiyvroarj). ADITIVO/IDEMPOTENTE.
-- Solo agrega la tabla de sesiones. NO toca el modelo de M2/M3, ni reservas,
-- gift_cards, empresa_*, fin_* ni campeonato_*.
--
-- QUÉ ES
-- El cliente se identifica con CÓDIGO + TELÉFONO (sin cuentas ni contraseñas) y
-- recibe una cookie HttpOnly con un token OPACO. Acá se guarda únicamente el
-- HASH SHA-256 de ese token: la base nunca ve el token completo, así que un
-- volcado de esta tabla no permite hacerse pasar por nadie.
--
-- SIN PII DUPLICADA
-- No hay nombre, teléfono, email ni código: solo el vínculo con la mensualidad.
-- Todo lo que se muestra se lee en el momento desde mensualidades.
--
-- CICLO DE VIDA
--  · expira_at    → duración ABSOLUTA (30 minutos). No se renueva consultando.
--  · ultimo_uso_at→ observabilidad; no extiende la sesión.
--  · revocada_at  → cierre de sesión explícito o reemplazo por una sesión nueva
--    del MISMO navegador (se revoca la que venía en la cookie, nunca las de
--    otros dispositivos).
-- ============================================================================

create table if not exists public.mensualidad_sesiones (
  id              uuid primary key default gen_random_uuid(),
  mensualidad_id  uuid not null references public.mensualidades(id) on delete cascade,
  token_hash      text not null,
  creada_at       timestamptz not null default now(),
  expira_at       timestamptz not null,
  ultimo_uso_at   timestamptz,
  revocada_at     timestamptz,
  constraint mensualidad_sesiones_hash_uq   unique (token_hash),
  -- SHA-256 en hexadecimal: 64 caracteres. Si no tiene esa forma, no es un hash.
  constraint mensualidad_sesiones_hash_chk  check (token_hash ~ '^[a-f0-9]{64}$'),
  -- Una sesión no puede vencer antes de existir.
  constraint mensualidad_sesiones_vig_chk   check (expira_at > creada_at)
);

create index if not exists mensualidad_sesiones_mens_idx
  on public.mensualidad_sesiones (mensualidad_id, creada_at desc);
-- Barrido de sesiones caducadas.
create index if not exists mensualidad_sesiones_expira_idx
  on public.mensualidad_sesiones (expira_at)
  where revocada_at is null;

-- Deny-by-default, igual que el resto del módulo: solo service_role.
alter table public.mensualidad_sesiones enable row level security;
revoke all on table public.mensualidad_sesiones from public, anon, authenticated;
grant select, insert, update, delete on table public.mensualidad_sesiones to service_role;
