-- ============================================================================
-- Marketing · Etapa 3 — Consentimiento promocional y bajas.
-- ----------------------------------------------------------------------------
-- Registro con evidencia de quién aceptó recibir promociones de SIM Argentina y
-- de quién pidió no recibirlas. Lo lee la audiencia de campañas
-- (lib/marketing/audiencia.ts). No envía nada, no crea códigos y no toca el
-- Turnero, Reservas, Gift Cards, Códigos ni Finanzas: ninguna función de este
-- archivo escribe fuera de las tablas mkt_*.
--
-- Piezas:
--   · mkt_textos_consentimiento   versiones del texto que la persona acepta. Nacen
--                                 'borrador' (editables solo por SQL), las publica
--                                 un admin después de la revisión legal y, una vez
--                                 publicadas, su texto no cambia nunca. Una sola
--                                 'vigente' a la vez: sin vigente no hay altas
--                                 públicas (retirarla es la pausa inmediata).
--   · mkt_consentimiento_eventos  historial SOLO DE ALTA de altas y bajas, con
--                                 fuente, actor, evidencia y versión del texto.
--   · mkt_consentimiento_estado   vista: estado vigente por teléfono.
--
-- Reglas:
--   · Teléfono = número nacional canónico de 10 dígitos, normalizado por la base
--     con public.mensualidad_normalizar_telefono (lo que no normaliza se rechaza).
--   · Un alta pública exige la versión VIGENTE y la huella (sha256) del texto tal
--     como se mostró; si cambió en el medio, 'texto_desactualizado'.
--   · Una baja se acepta siempre, aunque no haya alta ni texto vigente: es lista
--     de supresión.
--   · Estado = el evento más reciente por fecha de origen (ocurrido_en); en un
--     empate gana la baja. Después de una baja, solo un alta del PROPIO titular
--     (formulario web o casilla del checkout) la revierte: una carga
--     administrativa no.
--   · Alta pública = una autorización explícita NUEVA: lleva solicitado_en, el
--     momento (firmado por el servidor) en que se le mostró el texto, y esa es su
--     fecha de origen. Un formulario mostrado ANTES de una baja se registra igual
--     (queda la evidencia de que llegó), pero su fecha de origen es anterior a la
--     baja y la vista no lo cuenta: no reactiva nada. NO se rechaza: el rechazo
--     dependía del historial del número y le contaba a cualquiera que esa línea
--     había pedido la baja hacía poco. La respuesta pública es la misma en los
--     dos casos; volver a suscribirse exige un texto mostrado después de la baja.
--   · Fuentes: formulario_web (alta y baja, público), checkout_reserva y
--     checkout_gift_card (alta desde la casilla voluntaria de esas compras,
--     público), admin_evidencia (alta con evidencia escrita, solo admin),
--     admin_pedido (baja pedida por otro canal, staff o admin) y whatsapp
--     (SOLO baja, del propio titular por la Cloud API; la escribe
--     mkt_wa_registrar_baja, sección 6b, nunca la RPC general).
--   · Idempotente por clave: el mismo pedido devuelve el evento original; la
--     misma clave con otro contenido, conflicto.
--
-- Permisos: RLS sin policies; anon y authenticated no tienen nada; service_role
-- SOLO lee tablas y vista. Toda escritura pasa por las RPCs SECURITY DEFINER.
-- Va en db/orden.txt DESPUÉS de esquema-base-permisos.sql (que da DML a
-- service_role sobre todo public) y de mensualidades-m2-1-telefono.sql.
--
-- Aditivo e idempotente. Verificación sin huella:
-- db/marketing-consentimiento.verificacion.sql (solo stack local).
-- Los cuerpos de las funciones NO llevan comentarios: las explicaciones van arriba.
-- ============================================================================


-- ── 1. Textos de consentimiento ─────────────────────────────────────────────
create table if not exists public.mkt_textos_consentimiento (
  version            text primary key,
  titulo             text not null,
  texto              text not null,
  huella             text not null,
  estado             text not null default 'borrador',
  creado_en          timestamptz not null default now(),
  publicado_en       timestamptz,
  publicado_por_rol  text,
  retirado_en        timestamptz,
  retirado_por_rol   text,
  constraint mkt_textos_version_formato check (version ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  constraint mkt_textos_titulo_largo check (char_length(btrim(titulo)) between 3 and 120),
  constraint mkt_textos_texto_largo check (char_length(btrim(texto)) between 40 and 2000),
  constraint mkt_textos_huella_formato check (huella ~ '^[0-9a-f]{64}$'),
  constraint mkt_textos_estado_valido check (estado in ('borrador', 'vigente', 'retirado')),
  constraint mkt_textos_publicacion check (
    (estado = 'borrador') = (publicado_en is null) and (publicado_en is null) = (publicado_por_rol is null)),
  constraint mkt_textos_retiro check (
    (estado = 'retirado') = (retirado_en is not null) and (retirado_en is null) = (retirado_por_rol is null))
);

create unique index if not exists mkt_textos_un_solo_vigente
  on public.mkt_textos_consentimiento ((true)) where estado = 'vigente';

-- La huella la calcula la base. Un borrador se puede corregir (por SQL) y se
-- recalcula; publicado o retirado, nada cambia salvo la transición
-- borrador → vigente → retirado. No se borra nunca.
create or replace function public.mkt_textos_proteger()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'texto_inmutable' using errcode = '55000';
  end if;
  if tg_op = 'INSERT' then
    if new.estado <> 'borrador' or new.publicado_en is not null or new.retirado_en is not null then
      raise exception 'texto_nace_borrador' using errcode = '55000';
    end if;
    new.creado_en := now();
    new.huella := encode(sha256(convert_to(new.texto, 'UTF8')), 'hex');
    return new;
  end if;
  if new.version <> old.version or new.creado_en <> old.creado_en then
    raise exception 'texto_inmutable' using errcode = '55000';
  end if;
  if old.estado = 'borrador' and new.estado = 'borrador' then
    new.huella := encode(sha256(convert_to(new.texto, 'UTF8')), 'hex');
    return new;
  end if;
  if new.titulo <> old.titulo or new.texto <> old.texto or new.huella <> old.huella then
    raise exception 'texto_inmutable' using errcode = '55000';
  end if;
  if not ((old.estado = 'borrador' and new.estado = 'vigente') or (old.estado = 'vigente' and new.estado = 'retirado')
          or (old.estado = new.estado and old.publicado_en is not distinct from new.publicado_en
              and old.retirado_en is not distinct from new.retirado_en)) then
    raise exception 'transicion_invalida' using errcode = '55000';
  end if;
  return new;
end;
$fn$;

drop trigger if exists mkt_textos_proteger on public.mkt_textos_consentimiento;
create trigger mkt_textos_proteger
  before insert or update or delete on public.mkt_textos_consentimiento
  for each row execute function public.mkt_textos_proteger();

-- BORRADOR inicial. NO se publica solo: lo publica un admin desde el panel,
-- después de que un abogado valide el texto. Corregirlo antes de publicar:
--   update public.mkt_textos_consentimiento set texto = '…' where version = 'promos-v1';
insert into public.mkt_textos_consentimiento (version, titulo, texto, huella)
values (
  'promos-v1',
  'Promociones de SIM Argentina por WhatsApp',
  'Acepto recibir por WhatsApp, en el número que indiqué, promociones, descuentos y novedades de SIM Argentina. Puedo dejar de recibirlas cuando quiera desde simexperience.com.ar/promos/baja o pidiéndolo por WhatsApp. Mis datos se tratan según la Política de Privacidad de SIM Argentina (Ley 25.326).',
  ''
)
on conflict (version) do nothing;


-- ── 2. Eventos de consentimiento (solo de alta) ─────────────────────────────
create table if not exists public.mkt_consentimiento_eventos (
  id               uuid primary key default gen_random_uuid(),
  idempotency_key  uuid not null,
  huella           text not null,
  telefono         text not null,
  tipo             text not null,
  fuente           text not null,
  actor_rol        text not null,
  texto_version    text references public.mkt_textos_consentimiento (version),
  texto_huella     text,
  nombre           text,
  localidad        text,
  evidencia        jsonb not null default '{}'::jsonb,
  ocurrido_en      timestamptz not null,
  registrado_en    timestamptz not null default now(),
  solicitado_en    timestamptz,
  constraint mkt_eventos_clave_unica unique (idempotency_key),
  constraint mkt_eventos_telefono_canonico check (telefono ~ '^(11[0-9]{8}|[23][0-9]{9})$'),
  constraint mkt_eventos_tipo check (tipo in ('alta', 'baja')),
  constraint mkt_eventos_fuente check (fuente in ('formulario_web', 'checkout_reserva', 'checkout_gift_card', 'admin_evidencia', 'admin_pedido', 'whatsapp')),
  constraint mkt_eventos_actor check (actor_rol in ('publico', 'staff', 'admin')),
  constraint mkt_eventos_combinacion check (
       (fuente = 'formulario_web' and actor_rol = 'publico')
    or (fuente in ('checkout_reserva', 'checkout_gift_card') and tipo = 'alta' and actor_rol = 'publico')
    or (fuente = 'admin_evidencia' and tipo = 'alta' and actor_rol = 'admin')
    or (fuente = 'admin_pedido' and tipo = 'baja' and actor_rol in ('staff', 'admin'))
    or (fuente = 'whatsapp' and tipo = 'baja' and actor_rol = 'publico')),
  constraint mkt_eventos_solicitud check (
    ((actor_rol = 'publico' and tipo = 'alta') = (solicitado_en is not null))
    and (solicitado_en is null or ocurrido_en = solicitado_en)),
  constraint mkt_eventos_texto check (
    (tipo = 'alta') = (texto_version is not null) and (texto_version is null) = (texto_huella is null)),
  constraint mkt_eventos_datos_solo_alta check (tipo = 'alta' or (nombre is null and localidad is null)),
  constraint mkt_eventos_nombre_largo check (nombre is null or char_length(nombre) between 1 and 80),
  constraint mkt_eventos_localidad_largo check (localidad is null or char_length(localidad) between 2 and 80),
  constraint mkt_eventos_evidencia_objeto check (jsonb_typeof(evidencia) = 'object'),
  constraint mkt_eventos_ocurrido check (ocurrido_en <= registrado_en + interval '2 minutes')
);

-- Para una base que ya tenía la versión anterior de esta tabla (stack local): las
-- mismas reglas de arriba, re-declaradas por nombre. En una base nueva no cambian nada.
alter table public.mkt_consentimiento_eventos add column if not exists solicitado_en timestamptz;
alter table public.mkt_consentimiento_eventos drop constraint if exists mkt_eventos_fuente;
alter table public.mkt_consentimiento_eventos add constraint mkt_eventos_fuente
  check (fuente in ('formulario_web', 'checkout_reserva', 'checkout_gift_card', 'admin_evidencia', 'admin_pedido', 'whatsapp'));
alter table public.mkt_consentimiento_eventos drop constraint if exists mkt_eventos_combinacion;
alter table public.mkt_consentimiento_eventos add constraint mkt_eventos_combinacion check (
       (fuente = 'formulario_web' and actor_rol = 'publico')
    or (fuente in ('checkout_reserva', 'checkout_gift_card') and tipo = 'alta' and actor_rol = 'publico')
    or (fuente = 'admin_evidencia' and tipo = 'alta' and actor_rol = 'admin')
    or (fuente = 'admin_pedido' and tipo = 'baja' and actor_rol in ('staff', 'admin'))
    or (fuente = 'whatsapp' and tipo = 'baja' and actor_rol = 'publico'));
alter table public.mkt_consentimiento_eventos drop constraint if exists mkt_eventos_solicitud;
alter table public.mkt_consentimiento_eventos add constraint mkt_eventos_solicitud check (
    ((actor_rol = 'publico' and tipo = 'alta') = (solicitado_en is not null))
    and (solicitado_en is null or ocurrido_en = solicitado_en));

create index if not exists mkt_eventos_telefono_idx
  on public.mkt_consentimiento_eventos (telefono, ocurrido_en desc, registrado_en desc);
create index if not exists mkt_eventos_registrado_idx
  on public.mkt_consentimiento_eventos (registrado_en desc);

-- Historial: no se modifica ni se borra por ningún camino.
create or replace function public.mkt_eventos_inmutables()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  raise exception 'evento_inmutable' using errcode = '55000';
end;
$fn$;

drop trigger if exists mkt_eventos_inmutables on public.mkt_consentimiento_eventos;
create trigger mkt_eventos_inmutables
  before update or delete on public.mkt_consentimiento_eventos
  for each row execute function public.mkt_eventos_inmutables();

drop trigger if exists mkt_eventos_sin_truncate on public.mkt_consentimiento_eventos;
create trigger mkt_eventos_sin_truncate
  before truncate on public.mkt_consentimiento_eventos
  for each statement execute function public.mkt_eventos_inmutables();


-- ── 3. Estado vigente por teléfono ──────────────────────────────────────────
-- 'alta' si hay un alta posterior a la última baja (y, si hubo baja, esa alta
-- es del propio titular: formulario web o casilla del checkout); si no, 'baja'.
-- Empate → baja. Un alta pública tiene como fecha el momento en que se mostró el
-- texto, así que una baja hecha mientras el formulario estaba abierto gana.
create or replace view public.mkt_consentimiento_estado
with (security_invoker = true) as
with b as (
  select e.telefono, max(e.ocurrido_en) as baja_en, count(*) as bajas
    from public.mkt_consentimiento_eventos e
   where e.tipo = 'baja'
   group by e.telefono
),
a as (
  select distinct on (e.telefono)
         e.telefono, e.id as alta_id, e.ocurrido_en as alta_en, e.fuente as alta_fuente,
         e.texto_version as alta_texto_version, e.nombre, e.localidad
    from public.mkt_consentimiento_eventos e
    left join b on b.telefono = e.telefono
   where e.tipo = 'alta'
     and (b.baja_en is null
          or (e.ocurrido_en > b.baja_en and e.fuente in ('formulario_web', 'checkout_reserva', 'checkout_gift_card')))
   order by e.telefono, e.ocurrido_en desc, e.registrado_en desc, e.id desc
),
t as (
  select e.telefono, count(*) as eventos, max(e.registrado_en) as ultimo_registro
    from public.mkt_consentimiento_eventos e
   group by e.telefono
)
select t.telefono,
       case when a.alta_id is not null then 'alta' else 'baja' end as estado,
       a.alta_en, a.alta_fuente, a.alta_texto_version, a.nombre, a.localidad,
       b.baja_en, coalesce(b.bajas, 0)::integer as bajas,
       t.eventos::integer as eventos, t.ultimo_registro
  from t
  left join a on a.telefono = t.telefono
  left join b on b.telefono = t.telefono;


-- ── 4. Registrar un alta o una baja ─────────────────────────────────────────
-- p_datos: tipo, fuente, telefono y, según el caso, texto_version, texto_huella,
-- nombre, localidad, evidencia (objeto), ocurrido_en (solo cargas del panel) y
-- solicitado_en (solo altas públicas: lo pone la ruta desde el token firmado del
-- formulario, nunca el navegador).
-- p_rol: 'publico' (rutas públicas) o el rol de la sesión firmada del panel.
-- La huella de idempotencia sale de los datos NORMALIZADOS (sin la hora del
-- servidor ni la huella de IP, que es evidencia y no contenido: un reintento
-- desde otra red es el mismo pedido), así un reintento idéntico devuelve el
-- evento original aunque el texto vigente haya cambiado en el medio. La hora es clock_timestamp(), no
-- now(): dos eventos de una misma transacción no quedan empatados.
create or replace function public.mkt_consentimiento_registrar(
  p_idempotency_key uuid,
  p_datos           jsonb,
  p_rol             text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_rol      text := btrim(coalesce(p_rol, ''));
  v_k        text;
  v_tipo     text;
  v_fuente   text;
  v_tel      text;
  v_nombre   text;
  v_local    text;
  v_version  text;
  v_htexto   text;
  v_ev_in    jsonb;
  v_ev       jsonb := '{}'::jsonb;
  v_ocu_in   text;
  v_ocu      timestamptz;
  v_huella   text;
  v_prev     public.mkt_consentimiento_eventos;
  v_nuevo    public.mkt_consentimiento_eventos;
  v_texto    public.mkt_textos_consentimiento;
  v_estado   text;
  v_repetida boolean := false;
  v_publica  boolean;
  v_sol      timestamptz;
  v_sol_in   text;
begin
  if v_rol not in ('publico', 'staff', 'admin') then
    raise exception 'actor_invalido' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'campo_invalido:idempotency_key' using errcode = '22023';
  end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'datos_invalidos' using errcode = '22023';
  end if;
  for v_k in select jsonb_object_keys(p_datos) loop
    if v_k not in ('tipo', 'fuente', 'telefono', 'texto_version', 'texto_huella', 'nombre', 'localidad', 'evidencia', 'ocurrido_en', 'solicitado_en') then
      raise exception 'campo_desconocido:%', v_k using errcode = '22023';
    end if;
  end loop;

  v_tipo := p_datos ->> 'tipo';
  v_fuente := p_datos ->> 'fuente';
  if v_tipo is null or v_tipo not in ('alta', 'baja') then
    raise exception 'campo_invalido:tipo' using errcode = '22023';
  end if;
  if v_fuente is null or v_fuente not in ('formulario_web', 'checkout_reserva', 'checkout_gift_card', 'admin_evidencia', 'admin_pedido') then
    raise exception 'campo_invalido:fuente' using errcode = '22023';
  end if;
  if not ((v_rol = 'publico' and v_fuente = 'formulario_web')
       or (v_rol = 'publico' and v_fuente in ('checkout_reserva', 'checkout_gift_card') and v_tipo = 'alta')
       or (v_rol = 'admin' and v_fuente = 'admin_evidencia' and v_tipo = 'alta')
       or (v_rol in ('staff', 'admin') and v_fuente = 'admin_pedido' and v_tipo = 'baja')) then
    raise exception 'fuente_no_permitida' using errcode = '42501';
  end if;
  v_publica := v_rol = 'publico' and v_tipo = 'alta';

  if jsonb_typeof(p_datos -> 'telefono') is distinct from 'string' then
    raise exception 'telefono_invalido' using errcode = '22023';
  end if;
  v_tel := public.mensualidad_normalizar_telefono(p_datos ->> 'telefono');
  if v_tel is null or v_tel !~ '^(11[0-9]{8}|[23][0-9]{9})$' then
    raise exception 'telefono_invalido' using errcode = '22023';
  end if;

  if v_tipo = 'baja' then
    foreach v_k in array array['texto_version', 'texto_huella', 'nombre', 'localidad'] loop
      if p_datos ? v_k and jsonb_typeof(p_datos -> v_k) <> 'null' then
        raise exception 'campo_no_aplica:%', v_k using errcode = '22023';
      end if;
    end loop;
  else
    foreach v_k in array array['nombre', 'localidad'] loop
      if p_datos ? v_k and jsonb_typeof(p_datos -> v_k) not in ('null', 'string') then
        raise exception 'campo_invalido:%', v_k using errcode = '22023';
      end if;
    end loop;
    v_nombre := nullif(regexp_replace(btrim(coalesce(p_datos ->> 'nombre', '')), '\s+', ' ', 'g'), '');
    v_local := nullif(regexp_replace(btrim(coalesce(p_datos ->> 'localidad', '')), '\s+', ' ', 'g'), '');
    if v_nombre is not null and char_length(v_nombre) > 80 then
      raise exception 'campo_invalido:nombre' using errcode = '22023';
    end if;
    if v_local is not null and char_length(v_local) not between 2 and 80 then
      raise exception 'campo_invalido:localidad' using errcode = '22023';
    end if;
    if jsonb_typeof(p_datos -> 'texto_version') is distinct from 'string' then
      raise exception 'campo_invalido:texto_version' using errcode = '22023';
    end if;
    v_version := p_datos ->> 'texto_version';
    if p_datos ? 'texto_huella' and jsonb_typeof(p_datos -> 'texto_huella') not in ('null', 'string') then
      raise exception 'campo_invalido:texto_huella' using errcode = '22023';
    end if;
    v_htexto := nullif(p_datos ->> 'texto_huella', '');
    if v_publica and v_htexto is null then
      raise exception 'campo_invalido:texto_huella' using errcode = '22023';
    end if;
  end if;

  v_ev_in := coalesce(p_datos -> 'evidencia', '{}'::jsonb);
  if jsonb_typeof(v_ev_in) <> 'object' then
    raise exception 'campo_invalido:evidencia' using errcode = '22023';
  end if;
  for v_k in select jsonb_object_keys(v_ev_in) loop
    if not ((v_fuente = 'formulario_web' and v_k in ('pagina', 'ip_hash'))
         or (v_fuente = 'checkout_reserva' and v_k in ('pagina', 'ip_hash', 'reserva_id'))
         or (v_fuente = 'checkout_gift_card' and v_k in ('pagina', 'ip_hash', 'grupo_compra_id'))
         or (v_fuente = 'admin_evidencia' and v_k in ('tipo', 'referencia', 'nota'))
         or (v_fuente = 'admin_pedido' and v_k in ('canal', 'nota'))) then
      raise exception 'campo_desconocido:evidencia.%', v_k using errcode = '22023';
    end if;
    if jsonb_typeof(v_ev_in -> v_k) <> 'string' then
      raise exception 'campo_invalido:evidencia.%', v_k using errcode = '22023';
    end if;
    if nullif(btrim(v_ev_in ->> v_k), '') is not null then
      v_ev := v_ev || jsonb_build_object(v_k, btrim(v_ev_in ->> v_k));
    end if;
  end loop;
  if v_fuente in ('formulario_web', 'checkout_reserva', 'checkout_gift_card') then
    if v_ev ? 'pagina' and (v_ev ->> 'pagina') !~ '^/[a-z0-9/_-]{0,59}$' then
      raise exception 'campo_invalido:evidencia.pagina' using errcode = '22023';
    end if;
    if v_ev ? 'ip_hash' and (v_ev ->> 'ip_hash') !~ '^[0-9a-f]{16,64}$' then
      raise exception 'campo_invalido:evidencia.ip_hash' using errcode = '22023';
    end if;
    if v_fuente = 'checkout_reserva' and coalesce(v_ev ->> 'reserva_id', '') !~ '^[1-9][0-9]{0,18}$' then
      raise exception 'campo_invalido:evidencia.reserva_id' using errcode = '22023';
    end if;
    if v_fuente = 'checkout_gift_card'
       and coalesce(v_ev ->> 'grupo_compra_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'campo_invalido:evidencia.grupo_compra_id' using errcode = '22023';
    end if;
  elsif v_fuente = 'admin_evidencia' then
    if coalesce(v_ev ->> 'tipo', '') not in ('papel_firmado', 'mensaje_del_titular', 'email_del_titular') then
      raise exception 'campo_invalido:evidencia.tipo' using errcode = '22023';
    end if;
    if char_length(coalesce(v_ev ->> 'referencia', '')) not between 3 and 200 then
      raise exception 'campo_invalido:evidencia.referencia' using errcode = '22023';
    end if;
  else
    if coalesce(v_ev ->> 'canal', '') not in ('presencial', 'whatsapp', 'telefono', 'email', 'otro') then
      raise exception 'campo_invalido:evidencia.canal' using errcode = '22023';
    end if;
  end if;
  if char_length(coalesce(v_ev ->> 'nota', '')) > 300 then
    raise exception 'campo_invalido:evidencia.nota' using errcode = '22023';
  end if;

  v_ocu_in := null;
  if p_datos ? 'ocurrido_en' and jsonb_typeof(p_datos -> 'ocurrido_en') <> 'null' then
    if v_fuente in ('formulario_web', 'checkout_reserva', 'checkout_gift_card') then
      raise exception 'campo_no_aplica:ocurrido_en' using errcode = '22023';
    end if;
    if jsonb_typeof(p_datos -> 'ocurrido_en') <> 'string' then
      raise exception 'campo_invalido:ocurrido_en' using errcode = '22023';
    end if;
    begin
      v_ocu := (p_datos ->> 'ocurrido_en')::timestamptz;
    exception when others then
      raise exception 'campo_invalido:ocurrido_en' using errcode = '22023';
    end;
    if v_ocu > clock_timestamp() + interval '2 minutes' or v_ocu < clock_timestamp() - interval '366 days' then
      raise exception 'campo_invalido:ocurrido_en' using errcode = '22023';
    end if;
    v_ocu_in := to_char(v_ocu at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  end if;

  v_sol_in := null;
  if p_datos ? 'solicitado_en' and jsonb_typeof(p_datos -> 'solicitado_en') <> 'null' then
    if not v_publica then
      raise exception 'campo_no_aplica:solicitado_en' using errcode = '22023';
    end if;
    if jsonb_typeof(p_datos -> 'solicitado_en') <> 'string' then
      raise exception 'campo_invalido:solicitado_en' using errcode = '22023';
    end if;
    begin
      v_sol := (p_datos ->> 'solicitado_en')::timestamptz;
    exception when others then
      raise exception 'campo_invalido:solicitado_en' using errcode = '22023';
    end;
    if v_sol > clock_timestamp() + interval '2 minutes' or v_sol < clock_timestamp() - interval '3 hours' then
      raise exception 'campo_invalido:solicitado_en' using errcode = '22023';
    end if;
    v_sol_in := to_char(v_sol at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  elsif v_publica then
    raise exception 'campo_invalido:solicitado_en' using errcode = '22023';
  end if;

  v_huella := md5(jsonb_build_object(
    'rol', v_rol, 'tipo', v_tipo, 'fuente', v_fuente, 'telefono', v_tel, 'texto_version', v_version,
    'texto_huella', v_htexto, 'nombre', v_nombre, 'localidad', v_local, 'evidencia', v_ev - 'ip_hash',
    'ocurrido_en', v_ocu_in, 'solicitado_en', v_sol_in)::text);

  perform pg_advisory_xact_lock(hashtext('mkt_consentimiento'), hashtext(p_idempotency_key::text));
  select * into v_prev from public.mkt_consentimiento_eventos where idempotency_key = p_idempotency_key;
  if found then
    if v_prev.huella <> v_huella then
      raise exception 'idempotency_key_con_otro_payload' using errcode = '23505';
    end if;
    v_nuevo := v_prev;
    v_repetida := true;
  else
    if v_tipo = 'alta' then
      if v_publica then
        select * into v_texto from public.mkt_textos_consentimiento where estado = 'vigente';
        if not found then
          raise exception 'consentimiento_no_habilitado' using errcode = '55000';
        end if;
        if v_version <> v_texto.version or v_htexto <> v_texto.huella then
          raise exception 'texto_desactualizado' using errcode = '55000';
        end if;
      else
        select * into v_texto from public.mkt_textos_consentimiento where version = v_version;
        if not found or v_texto.estado = 'borrador' then
          raise exception 'texto_no_publicado' using errcode = '22023';
        end if;
        if v_htexto is not null and v_htexto <> v_texto.huella then
          raise exception 'texto_desactualizado' using errcode = '55000';
        end if;
        v_htexto := v_texto.huella;
        perform pg_advisory_xact_lock(hashtext('mkt_consentimiento_tel'), hashtext(v_tel));
        select s.estado into v_estado from public.mkt_consentimiento_estado s where s.telefono = v_tel;
        if v_estado = 'baja' then
          raise exception 'baja_vigente' using errcode = '55000';
        end if;
      end if;
    end if;

    insert into public.mkt_consentimiento_eventos (
      idempotency_key, huella, telefono, tipo, fuente, actor_rol, texto_version, texto_huella,
      nombre, localidad, evidencia, ocurrido_en, registrado_en, solicitado_en)
    values (
      p_idempotency_key, v_huella, v_tel, v_tipo, v_fuente, v_rol, v_version, v_htexto,
      v_nombre, v_local, v_ev, coalesce(v_sol, v_ocu, clock_timestamp()), clock_timestamp(), v_sol)
    returning * into v_nuevo;
  end if;

  select s.estado into v_estado from public.mkt_consentimiento_estado s where s.telefono = v_nuevo.telefono;
  return jsonb_build_object(
    'evento', jsonb_build_object(
      'id', v_nuevo.id, 'tipo', v_nuevo.tipo, 'fuente', v_nuevo.fuente, 'actor_rol', v_nuevo.actor_rol,
      'texto_version', v_nuevo.texto_version, 'ocurrido_en', v_nuevo.ocurrido_en, 'registrado_en', v_nuevo.registrado_en),
    'telefono', v_nuevo.telefono,
    'estado', v_estado,
    'repetida', v_repetida);
end;
$fn$;


-- ── 5. Publicar y retirar textos (solo admin) ───────────────────────────────
-- Publicar retira el vigente anterior en la misma transacción. Retirar sin
-- publicar otro deja las altas públicas cerradas (las bajas siguen).
-- Repetir sobre el mismo estado no cambia nada (sin_cambios).
create or replace function public.mkt_texto_publicar(p_version text, p_rol text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_t      public.mkt_textos_consentimiento;
  v_previo text;
begin
  if btrim(coalesce(p_rol, '')) <> 'admin' then
    raise exception 'solo_admin' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('mkt_textos'));
  select * into v_t from public.mkt_textos_consentimiento where version = p_version for update;
  if not found then
    raise exception 'texto_inexistente' using errcode = 'P0002';
  end if;
  if v_t.estado = 'vigente' then
    return jsonb_build_object('version', v_t.version, 'estado', v_t.estado, 'publicado_en', v_t.publicado_en,
                              'retirado', null, 'sin_cambios', true);
  end if;
  if v_t.estado <> 'borrador' then
    raise exception 'texto_no_borrador' using errcode = '55000';
  end if;
  update public.mkt_textos_consentimiento
     set estado = 'retirado', retirado_en = now(), retirado_por_rol = 'admin'
   where estado = 'vigente'
  returning version into v_previo;
  update public.mkt_textos_consentimiento
     set estado = 'vigente', publicado_en = now(), publicado_por_rol = 'admin'
   where version = p_version
  returning * into v_t;
  return jsonb_build_object('version', v_t.version, 'estado', v_t.estado, 'publicado_en', v_t.publicado_en,
                            'retirado', v_previo, 'sin_cambios', false);
end;
$fn$;

create or replace function public.mkt_texto_retirar(p_version text, p_rol text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_t public.mkt_textos_consentimiento;
begin
  if btrim(coalesce(p_rol, '')) <> 'admin' then
    raise exception 'solo_admin' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('mkt_textos'));
  select * into v_t from public.mkt_textos_consentimiento where version = p_version for update;
  if not found then
    raise exception 'texto_inexistente' using errcode = 'P0002';
  end if;
  if v_t.estado = 'retirado' then
    return jsonb_build_object('version', v_t.version, 'estado', v_t.estado, 'retirado_en', v_t.retirado_en, 'sin_cambios', true);
  end if;
  if v_t.estado <> 'vigente' then
    raise exception 'texto_no_vigente' using errcode = '55000';
  end if;
  update public.mkt_textos_consentimiento
     set estado = 'retirado', retirado_en = now(), retirado_por_rol = 'admin'
   where version = p_version
  returning * into v_t;
  return jsonb_build_object('version', v_t.version, 'estado', v_t.estado, 'retirado_en', v_t.retirado_en, 'sin_cambios', false);
end;
$fn$;


-- ── 6. Resumen de lectura para el panel ─────────────────────────────────────
-- Conteos sin datos personales: estado vigente por fuente y eventos desde p_desde.
create or replace function public.mkt_consentimiento_resumen(p_desde timestamptz)
returns jsonb
language sql
stable
set search_path = public
as $fn$
  select jsonb_build_object(
    'telefonos', (select count(*) from public.mkt_consentimiento_estado),
    'altas_vigentes', (select count(*) from public.mkt_consentimiento_estado where estado = 'alta'),
    'bajas_vigentes', (select count(*) from public.mkt_consentimiento_estado where estado = 'baja'),
    'altas_por_fuente', coalesce((select jsonb_object_agg(alta_fuente, n) from (
        select alta_fuente, count(*) as n from public.mkt_consentimiento_estado where estado = 'alta' group by alta_fuente) x), '{}'::jsonb),
    'desde', p_desde,
    'altas_desde', (select count(*) from public.mkt_consentimiento_eventos where tipo = 'alta' and registrado_en >= p_desde),
    'bajas_desde', (select count(*) from public.mkt_consentimiento_eventos where tipo = 'baja' and registrado_en >= p_desde));
$fn$;


-- ── 6b. Bajas recibidas por WhatsApp (webhook de la Cloud API) ──────────────
-- Fuente 'whatsapp', siempre de BAJA y del propio titular (actor 'publico'):
--   origen 'texto'            el mensaje entero es un pedido inequívoco (BAJA, STOP…)
--   origen 'boton'            tocó el botón de baja de una plantilla
--   origen 'preferencia_meta' webhook user_preferences con value 'stop'
--   origen 'error_131050'     Meta informó que la persona frenó el marketing
-- p_telefono: el wa_id de Meta (549 + número) o cualquier forma que normalice.
-- p_referencia: el id del mensaje o del evento de Meta; con el origen arma la
-- clave de idempotencia (el mismo evento reintentado no duplica la baja).
-- p_ocurrido_en: la fecha que informa Meta (su timestamp). Con el orden de la
-- vista, una baja vieja que llega tarde no pisa un alta del titular posterior a
-- ella, y nada de esta función da un alta: un 'resume' de Meta o un mensaje
-- común NO son consentimiento. Meta reintenta hasta 7 días: se admite hasta 40.
create or replace function public.mkt_wa_registrar_baja(p_telefono text, p_origen text, p_referencia text, p_ocurrido_en timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_tel   text := public.mensualidad_normalizar_telefono(p_telefono);
  v_clave uuid;
  v_ev    public.mkt_consentimiento_eventos;
begin
  if coalesce(p_origen, '') not in ('texto', 'boton', 'preferencia_meta', 'error_131050')
     or coalesce(p_referencia, '') !~ '^[A-Za-z0-9._:=+/-]{1,200}$'
     or p_ocurrido_en is null
     or p_ocurrido_en > clock_timestamp() + interval '2 minutes'
     or p_ocurrido_en < clock_timestamp() - interval '40 days' then
    raise exception 'datos_invalidos' using errcode = '22023';
  end if;
  if v_tel is null then
    return jsonb_build_object('ok', false, 'motivo', 'telefono_no_normalizable');
  end if;
  v_clave := md5('wa-baja:' || p_origen || ':' || p_referencia)::uuid;
  perform pg_advisory_xact_lock(hashtext('mkt_consentimiento'), hashtext(v_clave::text));
  select * into v_ev from public.mkt_consentimiento_eventos where idempotency_key = v_clave;
  if found then
    return jsonb_build_object('ok', true, 'repetida', true, 'telefono', v_ev.telefono,
      'estado', (select estado from public.mkt_consentimiento_estado where telefono = v_ev.telefono));
  end if;
  insert into public.mkt_consentimiento_eventos (idempotency_key, huella, telefono, tipo, fuente, actor_rol, evidencia, ocurrido_en)
  values (v_clave, md5('whatsapp|baja|' || v_tel || '|' || p_origen || '|' || p_referencia), v_tel, 'baja', 'whatsapp', 'publico',
          jsonb_build_object('canal', 'whatsapp', 'origen', p_origen, 'referencia', p_referencia), p_ocurrido_en)
  returning * into v_ev;
  return jsonb_build_object('ok', true, 'repetida', false, 'telefono', v_tel,
    'estado', (select estado from public.mkt_consentimiento_estado where telefono = v_tel));
end;
$fn$;


-- ── 7. Permisos ─────────────────────────────────────────────────────────────
alter table public.mkt_textos_consentimiento enable row level security;
alter table public.mkt_consentimiento_eventos enable row level security;

revoke all on table public.mkt_textos_consentimiento from public, anon, authenticated, service_role;
revoke all on table public.mkt_consentimiento_eventos from public, anon, authenticated, service_role;
revoke all on table public.mkt_consentimiento_estado from public, anon, authenticated, service_role;

grant select on table public.mkt_textos_consentimiento to service_role;
grant select on table public.mkt_consentimiento_eventos to service_role;
grant select on table public.mkt_consentimiento_estado to service_role;

revoke all on function public.mkt_textos_proteger() from public, anon, authenticated, service_role;
revoke all on function public.mkt_eventos_inmutables() from public, anon, authenticated, service_role;

revoke all on function public.mkt_consentimiento_registrar(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.mkt_texto_publicar(text, text) from public, anon, authenticated;
revoke all on function public.mkt_texto_retirar(text, text) from public, anon, authenticated;
revoke all on function public.mkt_consentimiento_resumen(timestamptz) from public, anon, authenticated;
revoke all on function public.mkt_wa_registrar_baja(text, text, text, timestamptz) from public, anon, authenticated;

grant execute on function public.mkt_wa_registrar_baja(text, text, text, timestamptz) to service_role;
grant execute on function public.mkt_consentimiento_registrar(uuid, jsonb, text) to service_role;
grant execute on function public.mkt_texto_publicar(text, text) to service_role;
grant execute on function public.mkt_texto_retirar(text, text) to service_role;
grant execute on function public.mkt_consentimiento_resumen(timestamptz) to service_role;
