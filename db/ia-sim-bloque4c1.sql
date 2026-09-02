-- ============================================================================
-- IA SIM · Bloque 4C.1 — Terminalidad de preparar_informe + recuperación e
-- idempotencia del borrador. Aditiva/idempotente. Solo SIM WEB. No recrea tablas
-- de 4C ni borra evidencia. RLS ya está en deny-by-default sobre ia_informes.
-- ============================================================================

-- Vincular el borrador al MENSAJE de usuario que lo originó (para idempotencia:
-- un pedido de informe = un borrador; reintentos/refresh no duplican).
alter table public.ia_informes add column if not exists mensaje_usuario_id uuid;

-- Idempotencia: un solo borrador ACTIVO por (conversación, mensaje de usuario).
-- Los estados removidos (descartado/papelera/eliminado) no bloquean uno nuevo.
create unique index if not exists ia_informes_conv_msg_uq
  on public.ia_informes (conversacion_id, mensaje_usuario_id)
  where mensaje_usuario_id is not null and estado not in ('descartado','papelera','eliminado');

create index if not exists ia_informes_msg_idx on public.ia_informes (mensaje_usuario_id);
