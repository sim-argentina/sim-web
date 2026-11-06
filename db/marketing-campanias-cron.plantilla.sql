-- ============================================================================
-- PLANTILLA · disparador de SERVIDOR del ejecutor de campañas (Supabase Cron).
-- NO está en db/orden.txt y NO activa nada por sí sola.
-- ----------------------------------------------------------------------------
-- Para qué: que la bandeja del webhook de WhatsApp y los lotes de campañas
-- avancen sin una pestaña abierta. Llama a
--   POST <URL>/api/admin/marketing/campanias/ejecutar
--   Authorization: Bearer <CRON_SECRET>
-- que procesa los eventos pendientes de WhatsApp (bajas y estados) y corre UN
-- lote breve por campaña en ejecución. El progreso vive en la base: si una
-- llamada falla o se corta, la siguiente sigue donde quedó.
--
-- Verificado en SOLO LECTURA el 27/10/2026 en Producción (proyecto SIM WEB):
--   Postgres 17.6 · pg_cron 1.6.4 y pg_net 0.20.0 DISPONIBLES, NO instalados ·
--   supabase_vault 0.3.1 instalado. (Supabase Cron admite intervalos en
--   segundos desde Postgres 15.1.1.61; recomienda ≤ 8 jobs simultáneos y < 10 min
--   por job: https://supabase.com/docs/guides/cron).
--
-- Pasos, en este orden y SOLO con la etapa real autorizada por el owner:
--   1. Habilitar las extensiones (Dashboard → Database → Extensions, o):
--        create extension if not exists pg_net;
--        create extension if not exists pg_cron;
--   2. Guardar en Vault la URL y el secreto (NUNCA en este archivo ni en el repo):
--        select vault.create_secret('<URL>/api/admin/marketing/campanias/ejecutar', 'mkt_campanias_ejecutar_url', 'Disparador de campañas');
--        select vault.create_secret('<el mismo CRON_SECRET de Vercel>', 'mkt_campanias_cron_secret', 'Secreto del disparador');
--   3. Crear la función de abajo (no hace nada hasta que alguien la llame).
--   4. Probarla una vez a mano y mirar la respuesta:
--        select public.mkt_campanias_disparar();
--        select status_code, content from net._http_response order by id desc limit 1;
--   5. Programar: es el ÚNICO paso que deja algo corriendo.
--        select cron.schedule('mkt-campanias-lotes', '*/2 * * * *', 'select public.mkt_campanias_disparar()');
--      Pausar o quitar:  select cron.unschedule('mkt-campanias-lotes');
--      Ver corridas:     select * from cron.job_run_details order by start_time desc limit 20;
--
-- Mientras las campañas sigan solo en simulación, en Producción el endpoint
-- procesa la bandeja de WhatsApp y omite los lotes (responde 200 con
-- campanias_omitidas): no hay envíos que disparar.
-- ============================================================================

create or replace function public.mkt_campanias_disparar()
returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_url     text;
  v_secreto text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'mkt_campanias_ejecutar_url';
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'mkt_campanias_cron_secret';
  if coalesce(v_url, '') !~ '^https?://[^ ]+/api/admin/marketing/campanias/ejecutar$' or coalesce(v_secreto, '') = '' then
    raise exception 'disparador_sin_configurar' using errcode = '55000';
  end if;
  return net.http_post(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secreto, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$fn$;

revoke all on function public.mkt_campanias_disparar() from public, anon, authenticated, service_role;
