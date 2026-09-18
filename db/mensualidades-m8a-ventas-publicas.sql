-- ════════════════════════════════════════════════════════════════════════════
-- Mensualidades SIM · M8A — pausar y reanudar las ventas públicas
-- ════════════════════════════════════════════════════════════════════════════
--
-- Hasta acá había UNA sola llave, MENSUALIDADES_ENABLED, que es una variable de
-- entorno: cambiarla exige un redeploy. Sirve para "el producto todavía no
-- existe", pero no para "dejá de vender AHORA", que es una decisión comercial
-- que puede tener que tomarse en un minuto y sin tocar Vercel.
--
-- Así que a partir de M8A hay DOS llaves con responsabilidades distintas:
--
--   1. MENSUALIDADES_ENABLED (entorno) → ¿el módulo público EXISTE?
--      Apagada: las páginas y APIs públicas responden 404. Sigue siendo la
--      llave general y SIEMPRE prevalece.
--
--   2. ventas_publicas_habilitadas (esta tabla) → ¿se puede COMPRAR?
--      Apagada: no se crea ninguna preferencia de Mercado Pago. Todo lo demás
--      —sesión, saldo, reservas, cancelaciones, reprogramaciones, webhook,
--      resultado, alta administrativa— sigue funcionando igual.
--
-- La segunda NO puede encender lo que la primera apaga. Con el módulo oculto,
-- que las ventas figuren habilitadas es irrelevante: no hay superficie pública.
--
-- LO QUE LA PAUSA NO HACE
-- No invalida una obligación ya contraída. Si alguien creó una preferencia
-- ANTES de la pausa y paga DESPUÉS, ese pago se acredita: el webhook no consulta
-- esta configuración, a propósito. Pausar impide EMPEZAR ventas nuevas, no
-- quedarse con plata cobrada sin entregar la mensualidad.
--
-- POR QUÉ UNA TABLA PROPIA
-- El proyecto no tiene un almacén general de configuración: fin_configuracion es
-- un singleton de Finanzas (simuladores, horas operativas, metas) y meter una
-- llave comercial de Mensualidades ahí mezclaría dominios. La auditoría, en
-- cambio, SÍ se reutiliza: mensualidad_auditar acepta mensualidad_id nulo y su
-- índice único sobre idempotency_key ya garantiza que un doble clic no deje dos
-- registros.

-- ────────────────────────────────────────────────────────────────────────────
-- 1) La configuración del módulo
-- ────────────────────────────────────────────────────────────────────────────
-- Singleton: una sola fila, id = 1. El check lo vuelve imposible de violar, así
-- que no hace falta preguntarse nunca "¿cuál de las filas vale?".

create table if not exists public.mensualidad_config (
  id                          integer primary key default 1,
  -- Arranca en FALSE. Es el valor seguro: si algo saliera mal aplicando esta
  -- migración, el peor caso es que no se pueda vender, no que se venda solo.
  ventas_publicas_habilitadas boolean     not null default false,
  actualizado_at              timestamptz not null default now(),
  actualizado_por             text,
  constraint mensualidad_config_singleton_chk check (id = 1)
);

insert into public.mensualidad_config (id, ventas_publicas_habilitadas)
values (1, false)
on conflict (id) do nothing;

comment on table public.mensualidad_config is
  'Configuracion comercial de Mensualidades. Una sola fila (id=1). ventas_publicas_habilitadas pausa las compras y renovaciones publicas sin redeploy; NO afecta al webhook, a Mi Plan, a las reservas con saldo ni al alta administrativa.';

-- Deny by default, igual que el resto del modulo: solo service_role entra, y
-- entra por supabaseAdmin desde el servidor.
alter table public.mensualidad_config enable row level security;
revoke all on table public.mensualidad_config from public, anon, authenticated;
grant select, insert, update on table public.mensualidad_config to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Lectura
-- ────────────────────────────────────────────────────────────────────────────
-- Devuelve el valor efectivo. Si por lo que fuera la fila no existiera, el
-- coalesce deja las ventas PAUSADAS: ante la duda no se vende.

create or replace function public.mensualidad_ventas_habilitadas()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce((select c.ventas_publicas_habilitadas
                     from public.mensualidad_config c
                    where c.id = 1), false);
$fn$;

revoke all on function public.mensualidad_ventas_habilitadas() from public, anon, authenticated;
grant execute on function public.mensualidad_ventas_habilitadas() to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 3) Escritura
-- ────────────────────────────────────────────────────────────────────────────
-- Una sola puerta, con motivo obligatorio y auditoría. Exige rol 'admin' por su
-- cuenta, además del requireAdmin() de la ruta: staff no cambia el estado
-- comercial del producto por ningún camino.
--
-- Concurrencia: la fila se bloquea con FOR UPDATE, así que dos cambios
-- simultáneos se serializan y el estado final es el del segundo, con las dos
-- auditorías en orden. No puede quedar un estado incoherente.
--
-- Idempotencia: la clave tiene índice único sobre mensualidad_auditoria, así que
-- repetir la misma petición devuelve el resultado sin escribir de nuevo.

create or replace function public.mensualidad_admin_set_ventas(
  p_habilitadas     boolean,
  p_motivo          text,
  p_actor           text,
  p_actor_rol       text,
  p_idempotency_key text
)
returns table (
  estado_anterior boolean,
  estado_nuevo    boolean,
  sin_cambios     boolean,
  idempotente     boolean,
  actualizado_at  timestamptz
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_previo   boolean;
  v_fila     public.mensualidad_config;
  v_aud      public.mensualidad_auditoria;
begin
  -- Motivo no vacío, actor presente y clave con forma válida: las MISMAS reglas
  -- que el resto de las acciones administrativas del módulo.
  perform public.mensualidad_admin_validar_entrada(p_motivo, p_actor, p_idempotency_key);

  if coalesce(p_actor_rol, '') <> 'admin' then
    raise exception 'rol_no_autorizado' using errcode = '42501';
  end if;
  if p_habilitadas is null then
    raise exception 'estado_invalido' using errcode = '22023';
  end if;

  -- Reintento con la misma clave: se devuelve lo que pasó, sin escribir nada.
  select * into v_aud from public.mensualidad_auditoria
   where idempotency_key = p_idempotency_key;
  if found then
    if v_aud.accion <> 'config_ventas_publicas' then
      raise exception 'clave_de_otra_operacion' using errcode = '23505';
    end if;
    return query
      select (v_aud.valor_anterior->>'ventas_publicas_habilitadas')::boolean,
             (v_aud.valor_nuevo->>'ventas_publicas_habilitadas')::boolean,
             ((v_aud.valor_anterior->>'ventas_publicas_habilitadas')
              is not distinct from (v_aud.valor_nuevo->>'ventas_publicas_habilitadas')),
             true, v_aud.created_at;
    return;
  end if;

  -- Serializa dos cambios simultáneos.
  select * into v_fila from public.mensualidad_config where id = 1 for update;
  if not found then
    insert into public.mensualidad_config (id, ventas_publicas_habilitadas)
    values (1, false)
    returning * into v_fila;
  end if;
  v_previo := v_fila.ventas_publicas_habilitadas;

  update public.mensualidad_config
     set ventas_publicas_habilitadas = p_habilitadas,
         actualizado_at              = now(),
         actualizado_por             = p_actor
   where id = 1
   returning * into v_fila;

  -- Se audita SIEMPRE, incluso cuando el estado no cambia: que alguien haya
  -- intentado pausar algo que ya estaba pausado es información útil.
  perform public.mensualidad_auditar(
    null, 'config_ventas_publicas', p_actor, p_actor_rol, btrim(p_motivo),
    jsonb_build_object('ventas_publicas_habilitadas', v_previo),
    jsonb_build_object('ventas_publicas_habilitadas', p_habilitadas),
    null, p_idempotency_key
  );

  return query
    select v_previo, p_habilitadas, (v_previo is not distinct from p_habilitadas),
           false, v_fila.actualizado_at;
end;
$fn$;

revoke all on function public.mensualidad_admin_set_ventas(boolean, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.mensualidad_admin_set_ventas(boolean, text, text, text, text)
  to service_role;
