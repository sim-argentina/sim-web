-- ============================================================================
-- Marketing · WhatsApp Cloud API — bandeja PERSISTENTE del webhook, estados de
-- entrega, bajas por WhatsApp y diagnóstico.
-- ----------------------------------------------------------------------------
-- La ruta /api/whatsapp/webhook valida la firma (X-Hub-Signature-256) y la
-- cuenta (entry.id = WABA de SIM, metadata.phone_number_id = número de SIM),
-- normaliza cada novedad y la GUARDA acá antes de responder 200. Si la base
-- falla, responde 500 y Meta reintenta (hasta 7 días): no se pierde nada. El
-- procesamiento va aparte y se puede repetir (webhook siguiente, ejecutor de
-- lotes, disparador de servidor o el botón del panel).
--
--   · mkt_whatsapp_eventos   una fila por novedad, con CLAVE ÚNICA (los
--                            reintentos y duplicados de Meta no se repiten):
--                              estado:<wamid>:<status>
--                              mensaje:<id del mensaje entrante>
--                              preferencia:<wa_id>:<stop|resume>:<timestamp>
--                            NO guarda textos de conversación: de un mensaje
--                            entrante solo su intención (baja_texto, baja_boton
--                            u otro) y a qué mensaje responde.
--   · mkt_whatsapp_estado    una fila: verificación del webhook, último evento
--                            firmado de la cuenta de SIM y rechazos por motivo.
--   · mkt_whatsapp_preferencia_meta  vista: última preferencia de marketing que
--                            informó Meta por teléfono, al lado del estado local.
--
-- Reglas al procesar:
--   · Estados (sent, delivered, read, failed): solo para envíos 'real' de
--     mkt_whatsapp_envios (por wamid, o por biz_opaque_callback_data =
--     "<destinatario>:<intento>" cuando el envío quedó incierto sin wamid). No
--     retroceden: sin_estado → enviado → entregado → leido; 'fallido' solo antes
--     de entregado. Un repetido o tardío no cambia fechas ya puestas ni cuenta
--     dos veces. delivered/read pasan el destinatario a 'entregado' (aunque
--     estuviera 'incierto': así se resuelve); failed a 'no_entregado'. 131050
--     (la persona frenó el marketing) registra además la baja.
--   · Mensaje entrante: solo una intención INEQUÍVOCA de baja (el mensaje
--     entero, o el botón de baja de la plantilla) registra una baja. Cualquier
--     otro mensaje se ignora: escribirle a SIM NO es autorización promocional.
--   · user_preferences: 'stop' registra la baja; 'resume' queda registrado
--     APARTE y NO borra ni revierte una baja local (solo el titular, desde el
--     formulario web o la casilla del checkout, puede volver a anotarse).
--   · Las bajas pasan por mkt_wa_registrar_baja (db/marketing-consentimiento.sql)
--     con la fecha de Meta: una baja vieja que llega tarde no pisa un alta
--     posterior del titular. El trigger de db/marketing-campanias.sql excluye
--     al instante los pendientes de toda campaña.
--   · Un evento que falla al procesar queda pendiente con su error y se
--     reintenta; después de 5 intentos queda 'error' para revisar.
--
-- Permisos: RLS sin policies; service_role SOLO lee. Escrituras por RPCs.
-- Va en db/orden.txt DESPUÉS de marketing-campanias.sql.
-- Aditivo e idempotente. Verificación: db/marketing-whatsapp.verificacion.sql.
-- Los cuerpos de las funciones NO llevan comentarios: las explicaciones van arriba.
-- ============================================================================


-- ── 1. Estado de la integración (diagnóstico) ───────────────────────────────
create table if not exists public.mkt_whatsapp_estado (
  id                        boolean primary key default true,
  webhook_verificado_en     timestamptz,
  ultimo_evento_firmado_en  timestamptz,
  rechazos                  jsonb not null default '{}'::jsonb,
  ultimo_error              text,
  ultimo_error_en           timestamptz,
  constraint mkt_whatsapp_estado_unica check (id),
  constraint mkt_whatsapp_estado_rechazos check (jsonb_typeof(rechazos) = 'object')
);
insert into public.mkt_whatsapp_estado (id) values (true) on conflict (id) do nothing;

create or replace function public.mkt_wa_anotar(p_tipo text, p_detalle text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_motivo text;
begin
  if p_tipo = 'webhook_verificado' then
    update public.mkt_whatsapp_estado set webhook_verificado_en = clock_timestamp() where id;
  elsif p_tipo = 'evento_firmado' then
    update public.mkt_whatsapp_estado set ultimo_evento_firmado_en = clock_timestamp() where id;
  elsif p_tipo = 'error' then
    update public.mkt_whatsapp_estado
       set ultimo_error = left(coalesce(p_detalle, 'sin detalle'), 300), ultimo_error_en = clock_timestamp() where id;
  elsif p_tipo like 'rechazo:%' then
    v_motivo := substr(p_tipo, 9);
    if v_motivo !~ '^[a-z_]{3,40}$' then
      raise exception 'datos_invalidos' using errcode = '22023';
    end if;
    update public.mkt_whatsapp_estado
       set rechazos = rechazos || jsonb_build_object(v_motivo, jsonb_build_object(
             'n', coalesce((rechazos -> v_motivo ->> 'n')::bigint, 0) + 1, 'ultimo_en', clock_timestamp()))
     where id;
  else
    raise exception 'datos_invalidos' using errcode = '22023';
  end if;
end;
$fn$;


-- ── 2. Bandeja de eventos del webhook ───────────────────────────────────────
create table if not exists public.mkt_whatsapp_eventos (
  id              bigint generated always as identity primary key,
  clave           text not null,
  tipo            text not null,
  wamid           text,
  contexto_wamid  text,
  biz_opaque      text,
  wa_id           text,
  estado_meta     text,
  intencion       text,
  preferencia     text,
  error_codigo    text,
  pricing         jsonb,
  ocurrido_en     timestamptz not null,
  recibido_en     timestamptz not null default clock_timestamp(),
  procesado_en    timestamptz,
  resultado       text,
  intentos        integer not null default 0,
  ultimo_error    text,
  constraint mkt_wa_eventos_clave unique (clave),
  constraint mkt_wa_eventos_tipo check (tipo in ('estado', 'mensaje', 'preferencia')),
  constraint mkt_wa_eventos_clave_forma check (clave ~ '^(estado|mensaje|preferencia):[A-Za-z0-9._:=+/-]{1,255}$'),
  constraint mkt_wa_eventos_ids check (
    (wamid is null or wamid ~ '^[A-Za-z0-9._:=+/-]{1,200}$')
    and (contexto_wamid is null or contexto_wamid ~ '^[A-Za-z0-9._:=+/-]{1,200}$')
    and (biz_opaque is null or biz_opaque ~ '^[A-Za-z0-9._:=+/-]{1,200}$')
    and (wa_id is null or wa_id ~ '^[0-9]{6,20}$')),
  constraint mkt_wa_eventos_estado check (estado_meta is null or estado_meta in ('sent', 'delivered', 'read', 'failed', 'played')),
  constraint mkt_wa_eventos_intencion check (intencion is null or intencion in ('baja_texto', 'baja_boton', 'otro')),
  constraint mkt_wa_eventos_preferencia check (preferencia is null or preferencia in ('stop', 'resume')),
  constraint mkt_wa_eventos_forma check (
       (tipo = 'estado' and wamid is not null and estado_meta is not null)
    or (tipo = 'mensaje' and wamid is not null and wa_id is not null and intencion is not null)
    or (tipo = 'preferencia' and wa_id is not null and preferencia is not null)),
  constraint mkt_wa_eventos_error check (error_codigo is null or error_codigo ~ '^[0-9]{1,10}$'),
  constraint mkt_wa_eventos_pricing check (pricing is null or jsonb_typeof(pricing) = 'object')
);
create index if not exists mkt_wa_eventos_pendientes_idx on public.mkt_whatsapp_eventos (ocurrido_en, id) where procesado_en is null;
create index if not exists mkt_wa_eventos_wamid_idx on public.mkt_whatsapp_eventos (wamid);
create index if not exists mkt_wa_eventos_recibido_idx on public.mkt_whatsapp_eventos (recibido_en desc);

drop trigger if exists mkt_wa_eventos_sin_borrar on public.mkt_whatsapp_eventos;
create trigger mkt_wa_eventos_sin_borrar before delete on public.mkt_whatsapp_eventos
  for each row execute function public.mkt_campanias_sin_borrar();
drop trigger if exists mkt_wa_eventos_sin_truncate on public.mkt_whatsapp_eventos;
create trigger mkt_wa_eventos_sin_truncate before truncate on public.mkt_whatsapp_eventos
  for each statement execute function public.mkt_campanias_sin_borrar();


-- ── 3. Guardar las novedades de un webhook (idempotente) ────────────────────
-- p_eventos: [{clave, tipo, wamid, contexto_wamid, biz_opaque, wa_id,
-- estado_meta, intencion, preferencia, error_codigo, pricing, ocurrido_en}] ya
-- normalizado por lib/marketing/whatsappWebhook.ts. Todo o nada: si una fila es
-- inválida, nada se guarda y la ruta responde 500 (Meta reintenta).
create or replace function public.mkt_wa_registrar_eventos(p_eventos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_e      jsonb;
  v_nuevos integer := 0;
  v_rep    integer := 0;
  v_n      integer;
begin
  if p_eventos is null or jsonb_typeof(p_eventos) <> 'array' or jsonb_array_length(p_eventos) > 1000 then
    raise exception 'datos_invalidos' using errcode = '22023';
  end if;
  for v_e in select e from jsonb_array_elements(p_eventos) e loop
    insert into public.mkt_whatsapp_eventos (clave, tipo, wamid, contexto_wamid, biz_opaque, wa_id, estado_meta, intencion,
                                             preferencia, error_codigo, pricing, ocurrido_en)
    values (v_e ->> 'clave', v_e ->> 'tipo', v_e ->> 'wamid', v_e ->> 'contexto_wamid', v_e ->> 'biz_opaque', v_e ->> 'wa_id',
            v_e ->> 'estado_meta', v_e ->> 'intencion', v_e ->> 'preferencia', v_e ->> 'error_codigo',
            case when jsonb_typeof(v_e -> 'pricing') = 'object' then v_e -> 'pricing' end,
            (v_e ->> 'ocurrido_en')::timestamptz)
    on conflict (clave) do nothing;
    get diagnostics v_n = row_count;
    if v_n = 1 then v_nuevos := v_nuevos + 1; else v_rep := v_rep + 1; end if;
  end loop;
  update public.mkt_whatsapp_estado set ultimo_evento_firmado_en = clock_timestamp() where id;
  return jsonb_build_object('nuevos', v_nuevos, 'repetidos', v_rep);
end;
$fn$;


-- ── 4. Procesar un evento ───────────────────────────────────────────────────
create or replace function public.mkt_wa_procesar_uno(p_id bigint)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_e      public.mkt_whatsapp_eventos;
  v_env    public.mkt_whatsapp_envios;
  v_d      public.mkt_campania_destinatarios;
  v_rango  integer;
  v_nuevo  integer;
  v_ts     timestamptz;
  v_r      jsonb;
  v_res    text;
  v_dest   uuid;
  v_int    integer;
begin
  select * into v_e from public.mkt_whatsapp_eventos where id = p_id;
  v_ts := v_e.ocurrido_en;

  if v_e.tipo = 'estado' then
    select * into v_env from public.mkt_whatsapp_envios where wamid = v_e.wamid and origen = 'real' for update;
    if not found and coalesce(v_e.biz_opaque, '') ~ '^[0-9a-f-]{36}:[0-9]{1,2}$' then
      v_dest := split_part(v_e.biz_opaque, ':', 1)::uuid;
      v_int := split_part(v_e.biz_opaque, ':', 2)::integer;
      select * into v_env from public.mkt_whatsapp_envios
       where destinatario_id = v_dest and intento = v_int and origen = 'real' and wamid is null for update;
      if found then
        update public.mkt_whatsapp_envios set wamid = v_e.wamid, actualizado_en = clock_timestamp()
         where id = v_env.id returning * into v_env;
      end if;
    end if;
    if v_env.id is null then
      return 'sin_envio';
    end if;
    if v_e.estado_meta = 'played' then
      return 'ignorado';
    end if;
    v_rango := case v_env.estado_meta when 'sin_estado' then 0 when 'enviado' then 1 when 'fallido' then 1 when 'entregado' then 2 else 3 end;
    v_nuevo := case v_e.estado_meta when 'sent' then 1 when 'failed' then 1 when 'delivered' then 2 else 3 end;
    update public.mkt_whatsapp_envios set
      enviado_en   = case when v_e.estado_meta = 'sent' then coalesce(enviado_en, v_ts) else enviado_en end,
      entregado_en = case when v_e.estado_meta in ('delivered', 'read') then coalesce(entregado_en, v_ts) else entregado_en end,
      leido_en     = case when v_e.estado_meta = 'read' then coalesce(leido_en, v_ts) else leido_en end,
      fallido_en   = case when v_e.estado_meta = 'failed' and v_rango <= 1 then coalesce(fallido_en, v_ts) else fallido_en end,
      error_codigo = case when v_e.estado_meta = 'failed' and v_rango <= 1 then coalesce(error_codigo, v_e.error_codigo) else error_codigo end,
      cobrable     = case when v_e.pricing is not null and cobrable is null
                          then coalesce(v_e.pricing ->> 'type' = 'regular', (v_e.pricing ->> 'billable')::boolean) else cobrable end,
      pricing_categoria = coalesce(pricing_categoria, v_e.pricing ->> 'category'),
      pricing_tipo      = coalesce(pricing_tipo, v_e.pricing ->> 'type'),
      estado_meta  = case
                       when v_e.estado_meta = 'failed' and v_rango <= 1 and estado_meta <> 'fallido' then 'fallido'
                       when v_e.estado_meta = 'sent' and v_rango = 0 then 'enviado'
                       when v_e.estado_meta = 'delivered' and v_rango < 2 then 'entregado'
                       when v_e.estado_meta = 'read' and v_rango < 3 then 'leido'
                       else estado_meta end,
      actualizado_en = clock_timestamp()
    where id = v_env.id
    returning * into v_env;

    select * into v_d from public.mkt_campania_destinatarios where id = v_env.destinatario_id for update;
    if v_env.estado_meta in ('entregado', 'leido') then
      update public.mkt_campania_destinatarios d set
        estado = case when d.estado in ('aceptado', 'incierto', 'no_entregado', 'entregado') then 'entregado' else d.estado end,
        wamid = coalesce(d.wamid, v_env.wamid),
        aceptado_en = coalesce(d.aceptado_en, v_env.aceptado_en, v_env.entregado_en),
        entregado_en = coalesce(d.entregado_en, v_env.entregado_en),
        leido_en = coalesce(d.leido_en, v_env.leido_en),
        terminado_en = coalesce(d.terminado_en, v_env.entregado_en),
        motivo = case when d.estado in ('incierto', 'no_entregado') then null else d.motivo end,
        costo = case when v_env.cobrable then (select c.tarifa from public.mkt_campanias c where c.id = d.campania_id) else 0 end,
        actualizado_en = clock_timestamp()
      where d.id = v_d.id;
      v_res := 'estado_' || v_env.estado_meta;
    elsif v_env.estado_meta = 'fallido' then
      update public.mkt_campania_destinatarios d set
        estado = case when d.estado in ('aceptado', 'incierto') then 'no_entregado' else d.estado end,
        ultimo_codigo = coalesce(v_env.error_codigo, d.ultimo_codigo),
        terminado_en = coalesce(d.terminado_en, v_env.fallido_en),
        costo = 0, actualizado_en = clock_timestamp()
      where d.id = v_d.id;
      v_res := 'estado_fallido';
      if v_env.error_codigo = '131050' then
        v_r := public.mkt_wa_registrar_baja(v_d.telefono, 'error_131050', v_env.wamid, v_ts);
        v_res := 'estado_fallido_baja';
      end if;
    else
      v_res := 'estado_' || v_env.estado_meta;
    end if;
    return v_res;
  end if;

  if v_e.tipo = 'mensaje' then
    if v_e.intencion = 'otro' then
      return 'ignorado';
    end if;
    v_r := public.mkt_wa_registrar_baja(v_e.wa_id, case when v_e.intencion = 'baja_boton' then 'boton' else 'texto' end, v_e.wamid, v_ts);
    if not (v_r ->> 'ok')::boolean then
      return v_r ->> 'motivo';
    end if;
    return case when (v_r ->> 'repetida')::boolean then 'baja_repetida' else 'baja_registrada' end;
  end if;

  if v_e.preferencia = 'stop' then
    v_r := public.mkt_wa_registrar_baja(v_e.wa_id, 'preferencia_meta', substr(v_e.clave, 13), v_ts);
    if not (v_r ->> 'ok')::boolean then
      return v_r ->> 'motivo';
    end if;
    return case when (v_r ->> 'repetida')::boolean then 'baja_repetida' else 'baja_registrada' end;
  end if;
  return 'reanudacion_registrada';
end;
$fn$;


-- ── 5. Procesar los pendientes (repetible, concurrente) ─────────────────────
-- En orden de ocurrencia, de a p_limite, con SKIP LOCKED: dos procesos no toman
-- el mismo evento. Cada evento en su propio sub-bloque: uno que falla no frena a
-- los demás; queda pendiente con su error (hasta 5 intentos).
create or replace function public.mkt_wa_procesar_eventos(p_limite integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id    bigint;
  v_res   text;
  v_ok    integer := 0;
  v_err   integer := 0;
begin
  if p_limite is null or p_limite not between 1 and 500 then
    raise exception 'datos_invalidos' using errcode = '22023';
  end if;
  for v_id in
    select id from public.mkt_whatsapp_eventos
     where procesado_en is null
     order by ocurrido_en, id
     limit p_limite
     for update skip locked
  loop
    begin
      v_res := public.mkt_wa_procesar_uno(v_id);
      update public.mkt_whatsapp_eventos
         set procesado_en = clock_timestamp(), resultado = v_res, intentos = intentos + 1, ultimo_error = null
       where id = v_id;
      v_ok := v_ok + 1;
    exception when others then
      update public.mkt_whatsapp_eventos
         set intentos = intentos + 1, ultimo_error = left(sqlstate || ':' || sqlerrm, 300),
             procesado_en = case when intentos + 1 >= 5 then clock_timestamp() end,
             resultado = case when intentos + 1 >= 5 then 'error' end
       where id = v_id;
      perform public.mkt_wa_anotar('error', 'evento ' || v_id || ': ' || sqlstate);
      v_err := v_err + 1;
    end;
  end loop;
  return jsonb_build_object('procesados', v_ok, 'con_error', v_err,
    'pendientes', (select count(*) from public.mkt_whatsapp_eventos where procesado_en is null));
end;
$fn$;


-- ── 6. Preferencia de marketing que informó Meta, al lado del estado local ──
create or replace view public.mkt_whatsapp_preferencia_meta
with (security_invoker = true) as
select distinct on (e.wa_id)
       e.wa_id, public.mensualidad_normalizar_telefono(e.wa_id) as telefono,
       e.preferencia as ultima_preferencia, e.ocurrido_en,
       (select s.estado from public.mkt_consentimiento_estado s where s.telefono = public.mensualidad_normalizar_telefono(e.wa_id)) as estado_local
  from public.mkt_whatsapp_eventos e
 where e.tipo = 'preferencia'
 order by e.wa_id, e.ocurrido_en desc, e.id desc;


-- ── 7. Permisos ─────────────────────────────────────────────────────────────
alter table public.mkt_whatsapp_estado enable row level security;
alter table public.mkt_whatsapp_eventos enable row level security;
revoke all on table public.mkt_whatsapp_estado from public, anon, authenticated, service_role;
revoke all on table public.mkt_whatsapp_eventos from public, anon, authenticated, service_role;
revoke all on table public.mkt_whatsapp_preferencia_meta from public, anon, authenticated, service_role;
grant select on table public.mkt_whatsapp_estado to service_role;
grant select on table public.mkt_whatsapp_eventos to service_role;
grant select on table public.mkt_whatsapp_preferencia_meta to service_role;

revoke all on function public.mkt_wa_anotar(text, text) from public, anon, authenticated;
revoke all on function public.mkt_wa_registrar_eventos(jsonb) from public, anon, authenticated;
revoke all on function public.mkt_wa_procesar_uno(bigint) from public, anon, authenticated, service_role;
revoke all on function public.mkt_wa_procesar_eventos(integer) from public, anon, authenticated;
grant execute on function public.mkt_wa_anotar(text, text) to service_role;
grant execute on function public.mkt_wa_registrar_eventos(jsonb) to service_role;
grant execute on function public.mkt_wa_procesar_eventos(integer) to service_role;
