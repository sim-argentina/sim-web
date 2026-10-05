-- ============================================================================
-- FIXTURES de la base de PRUEBAS — configuración mínima, cero datos de negocio
-- ----------------------------------------------------------------------------
-- La base local arranca vacía, pero varias suites asumen que la CONFIGURACIÓN de
-- Finanzas ya existe: en Producción esas filas se cargaron a mano desde el panel y
-- nunca estuvieron versionadas. Sin ellas el código responde 'sin_config' y las
-- pruebas fallan por una razón que no tiene nada que ver con lo que verifican.
--
-- Qué hay acá: cuentas, categorías, clasificación de ingresos, configuración
-- operativa y las tasas de comisión de cobro. Es CONFIGURACIÓN COMERCIAL, la misma
-- categoría que los precios de planes que db/mensualidades-m2.sql ya versiona.
--
-- Qué NO hay acá, y no va a haber: clientes, teléfonos, correos, reservas, turnos,
-- pagos, inscripciones, mensualidades ni movimientos. Ni una fila de negocio. Cada
-- suite crea sus propios datos con su identificador de corrida.
--
-- Solo se aplica a la base local: el runner de pruebas lo incluye en db/orden.txt.
-- ============================================================================

-- ── Cuentas ─────────────────────────────────────────────────────────────────
-- El modelo de Finanzas tiene exactamente dos fuentes: Efectivo y Mercado Pago.
-- Todo lo que no es efectivo (transferencia, débito, crédito, QR) cae en la segunda.
insert into public.fin_cuentas (nombre, ambito, tipo, activa, orden) values
  ('Efectivo',     'sim', 'efectivo',     true, 1),
  ('Mercado Pago', 'sim', 'mercado_pago', true, 2)
on conflict (nombre) do nothing;

-- ── Categorías ──────────────────────────────────────────────────────────────
-- Una por tipo, con nombres neutros: alcanza para que la clasificación tenga a
-- dónde apuntar sin inventar un plan de cuentas.
insert into public.fin_categorias (nombre, ambito, tipo, activa, orden, descripcion) values
  ('Ingresos operativos',  'sim', 'ingreso',   true, 1, 'Categoría de pruebas'),
  ('Costos operativos',    'sim', 'costo',     true, 2, 'Categoría de pruebas'),
  ('Gastos operativos',    'sim', 'gasto',     true, 3, 'Categoría de pruebas'),
  ('Inversiones',          'sim', 'inversion', true, 4, 'Categoría de pruebas'),
  ('Retiros',              'sim', 'retiro',    true, 5, 'Categoría de pruebas'),
  ('Ajustes',              'sim', 'ajuste',    true, 6, 'Categoría de pruebas')
on conflict (nombre, ambito, tipo) do nothing;

-- ── Clasificación de ingresos por fuente ────────────────────────────────────
-- Las seis fuentes de la composición canónica de facturación.
insert into public.fin_clasificacion_ingresos (fuente, categoria_id, activa)
select f.fuente, c.id, true
from (values ('turnero'), ('reservas_online'), ('gift_cards'), ('campeonatos'), ('mensualidades'), ('manuales')) as f(fuente)
cross join (select id from public.fin_categorias where nombre = 'Ingresos operativos' and tipo = 'ingreso' limit 1) c
on conflict (fuente) do nothing;

-- ── Configuración operativa ─────────────────────────────────────────────────
insert into public.fin_configuracion (id, cantidad_simuladores, horas_operativas_dia, duracion_turno_min, dias_operativos_mes, mes_inicio)
values (1, 4, 12, 15, 30, '2026-07')
on conflict (id) do nothing;

-- ── Tasas de comisión de cobro ──────────────────────────────────────────────
-- Las seis combinaciones de procesador y método. Son las tasas comerciales
-- vigentes del modelo: varias suites calculan la comisión esperada leyendo esta
-- misma tabla, y mensualidadesM7_4 verifica el caso QR (0,80 % + IVA 21 % sobre
-- 55.000 = 532,40). Cambiarlas por valores inventados rompería esa aritmética.
insert into public.fin_comisiones_cobro (procesador, metodo_pago, porcentaje_base, aplica_iva, iva_porcentaje, acreditacion, activa) values
  ('mercado_pago', 'qr',      0.80, true, 21, 'inmediata', true),
  ('mercado_pago', 'debito',  3.25, true, 21, 'inmediata', true),
  ('mercado_pago', 'credito', 6.29, true, 21, 'inmediata', true),
  ('payway',       'qr',      0.80, true, 21, 'inmediata', true),
  ('payway',       'debito',  1.00, true, 21, '24_hs',     true),
  ('payway',       'credito', 1.80, true, 21, '24_hs',     true)
on conflict (procesador, metodo_pago) do nothing;
