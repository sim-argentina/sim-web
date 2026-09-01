-- ============================================================================
-- IA SIM · Bloque 4B.2 — Corrección de recuperación global + categoría obligatoria
-- Aditiva/idempotente. Solo tablas ia_*. No toca datos de negocio.
-- ============================================================================

-- 1) Backfill: documentos activos sin categoría → General (no se recrea nada).
update public.ia_documentos
   set categoria_id = (select id from public.ia_conocimiento_categorias where nombre_norm = 'general' limit 1),
       updated_at = now()
 where categoria_id is null;

-- 2) Backfill de la categoría en los fragmentos (para el filtro por categoría).
update public.ia_documento_fragmentos f
   set categoria_id = d.categoria_id
  from public.ia_documentos d
 where f.documento_id = d.id and f.categoria_id is null and d.categoria_id is not null;

-- 3) Auditoría de la búsqueda previa determinística en cada ejecución.
alter table public.ia_ejecuciones add column if not exists busqueda_previa jsonb;

-- 4) Restricción: un documento ACTIVO no puede quedar sin categoría (tras el backfill).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ia_doc_activo_con_categoria') then
    alter table public.ia_documentos
      add constraint ia_doc_activo_con_categoria
      check (estado <> 'activo' or categoria_id is not null);
  end if;
end $$;
