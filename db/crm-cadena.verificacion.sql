-- ============================================================================
-- Verificación de la CADENA del CRM (B0 → B1 → B2 …), después de aplicarla entera.
-- ----------------------------------------------------------------------------
-- Las restricciones que un bloque posterior amplía se agregan NOT VALID y se
-- intenta validarlas (ver la sección 0 de crm-b1-prospeccion.sql). Esta
-- verificación exige el estado final:
--   T1 ninguna restricción de una tabla crm_* queda sin validar;
--   T2 la auditoría acepta todas las entidades y acciones legítimas de cada bloque;
--   T3 y rechaza entidades y acciones inexistentes, actores incoherentes y datos
--      con material de autenticación.
-- Todo corre dentro de un bloque que termina en RAISE: se deshace entero.
--   node scripts/pruebas/crm-local.mjs sql db/crm-cadena.verificacion.sql
-- Resultado: "RESULTADO CRM-CADENA|OK n" o la lista de "FALLA:".
-- ============================================================================
do $crmcadena$
declare
  v_fallas text := '';
  v_ok integer := 0;
  v_sin_validar text;
  x text;
  entidades text[] := array[
    -- B0
    'crm_usuarios',
    -- B1
    'crm_rubros', 'crm_zonas', 'crm_empresas', 'crm_contactos', 'crm_jornadas', 'crm_visitas', 'crm_oportunidades', 'crm_tareas',
    -- B2
    'crm_actividades', 'crm_seguimientos'];
  acciones text[] := array[
    -- B0
    'alta', 'desactivacion', 'reactivacion', 'restablecimiento_contrasena', 'revocacion_sesiones', 'ingreso', 'cierre_sesion',
    -- B1
    'creacion', 'actualizacion', 'asignacion', 'archivo', 'desarchivo', 'apertura', 'cierre', 'registro', 'correccion',
    'anulacion', 'nota', 'reprogramacion', 'cancelacion', 'reasignacion_origen', 'cierre_por_anulacion',
    -- B2
    'gestion', 'cambio_estado', 'retroceso', 'pausa', 'reanudacion', 'perdida', 'reapertura',
    'seguimiento_programado', 'seguimiento_reprogramado', 'seguimiento_resuelto', 'seguimiento_cancelado', 'contacto_principal'];
begin
  -- ── T1. Ninguna restricción sin validar en las tablas del CRM ──────────────
  select string_agg(c.conrelid::regclass::text || '.' || c.conname, ', ') into v_sin_validar
    from pg_constraint c join pg_class t on t.oid = c.conrelid
   where t.relnamespace = 'public'::regnamespace and t.relname like 'crm\_%' and not c.convalidated;
  if v_sin_validar is null then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T1 sin validar: ' || v_sin_validar; end if;

  -- ── T2. Entidades y acciones legítimas ────────────────────────────────────
  foreach x in array entidades loop
    begin
      insert into public.crm_auditoria (actor_rol, actor_usuario_id, entidad, entidad_id, accion, datos)
      values ('admin', null, x, gen_random_uuid(), 'creacion', '{}');
      v_ok := v_ok + 1;
    exception when others then v_fallas := v_fallas || ' FALLA:T2 entidad ' || x || ' ' || sqlerrm; end;
  end loop;
  foreach x in array acciones loop
    begin
      insert into public.crm_auditoria (actor_rol, actor_usuario_id, entidad, entidad_id, accion, datos)
      values ('admin', null, 'crm_oportunidades', gen_random_uuid(), x, '{}');
      v_ok := v_ok + 1;
    exception when others then v_fallas := v_fallas || ' FALLA:T2 acción ' || x || ' ' || sqlerrm; end;
  end loop;

  -- ── T3. Lo inválido se rechaza ─────────────────────────────────────────────
  begin
    insert into public.crm_auditoria (actor_rol, actor_usuario_id, entidad, entidad_id, accion, datos)
    values ('admin', null, 'crm_oportunidades', gen_random_uuid(), 'accion_inventada', '{}');
    v_fallas := v_fallas || ' FALLA:T3 aceptó una acción inexistente';
  exception when check_violation then v_ok := v_ok + 1; end;
  begin
    insert into public.crm_auditoria (actor_rol, actor_usuario_id, entidad, entidad_id, accion, datos)
    values ('admin', null, 'crm_inexistente', gen_random_uuid(), 'creacion', '{}');
    v_fallas := v_fallas || ' FALLA:T3 aceptó una entidad inexistente';
  exception when check_violation then v_ok := v_ok + 1; end;
  begin
    insert into public.crm_auditoria (actor_rol, actor_usuario_id, entidad, entidad_id, accion, datos)
    values ('comercial', null, 'crm_visitas', gen_random_uuid(), 'registro', '{}');
    v_fallas := v_fallas || ' FALLA:T3 aceptó un comercial sin usuario';
  exception when check_violation then v_ok := v_ok + 1; end;
  begin
    insert into public.crm_auditoria (actor_rol, actor_usuario_id, entidad, entidad_id, accion, datos)
    values ('staff', null, 'crm_visitas', gen_random_uuid(), 'registro', '{}');
    v_fallas := v_fallas || ' FALLA:T3 aceptó un rol inexistente';
  exception when check_violation then v_ok := v_ok + 1; end;
  begin
    insert into public.crm_auditoria (actor_rol, actor_usuario_id, entidad, entidad_id, accion, datos)
    values ('admin', null, 'crm_usuarios', gen_random_uuid(), 'alta', '{"password_hash":"x"}');
    v_fallas := v_fallas || ' FALLA:T3 aceptó material de autenticación en los datos';
  exception when check_violation then v_ok := v_ok + 1; end;

  if v_fallas = '' then
    raise exception 'RESULTADO CRM-CADENA|OK %', v_ok;
  end if;
  raise exception 'RESULTADO CRM-CADENA|% bien;%', v_ok, v_fallas;
end
$crmcadena$;
