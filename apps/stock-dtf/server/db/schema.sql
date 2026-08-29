-- ============================================================================
-- Esquema: Stock de Estampas DTF - Incognito Indumentaria
-- SQLite (better-sqlite3). Escrito en un subconjunto compatible con Postgres
-- para facilitar una futura migracion a Supabase si se decide reutilizar esa
-- infraestructura (igual que las otras apps de Incognito).
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Usuarios (simple; solo para atribuir movimientos y correcciones)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  email TEXT UNIQUE,
  rol TEXT NOT NULL DEFAULT 'operador',   -- operador | admin
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------------
-- Disenos (agrupador de "diseno principal", derivado del prefijo de archivo)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS designs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo_prefijo TEXT NOT NULL UNIQUE,     -- ej "CZ", "NK"
  nombre TEXT,
  categoria TEXT,
  subcategoria TEXT,
  marca_tematica TEXT,
  observaciones TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------------
-- Variantes de estampa (la unidad real de stock -- lo que la app llama
-- "estampa" en las pantallas). Cada fila = una variante estampable concreta.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stamp_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  design_id INTEGER REFERENCES designs(id),
  codigo TEXT NOT NULL UNIQUE,             -- codigo unico visible, ej "CZ-01"
  nombre TEXT NOT NULL,
  variante TEXT NOT NULL DEFAULT 'unica',  -- "unica" | nombre de grupo/pagina/color/talle
  categoria TEXT,
  subcategoria TEXT,
  marca_tematica TEXT,
  color TEXT,
  talle_tamano TEXT,
  ubicacion_aplicacion TEXT,               -- frente | espalda | manga | pantalon | otra
  ancho REAL,
  alto REAL,
  unidad_medida TEXT NOT NULL DEFAULT 'px', -- px | cm
  cantidad_disponible INTEGER,              -- NULL = stock pendiente de carga (no inventar)
  stock_minimo INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'Pendiente de revision',
    -- Disponible | Stock bajo | Agotada | Pendiente de revision | Discontinuada
  archivo_original TEXT NOT NULL,
  carpeta_origen TEXT NOT NULL,
  formato_archivo TEXT NOT NULL,
  origen_tipo TEXT,                         -- imagen_simple | tiff_pagina_unica | tiff_multipagina | psd_sin_grupos | psd_grupo
  origen_capa_grupo_pagina TEXT,            -- nombre de capa/grupo/pagina de origen si aplica
  previsualizacion TEXT,                    -- ruta relativa al PNG de preview
  phash TEXT,
  observaciones TEXT,
  fecha_creacion_archivo TEXT,
  fecha_modificacion_archivo TEXT,
  origen_json TEXT,                         -- snapshot JSON del analisis (capas detectadas, etc.)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_stamp_variants_estado ON stamp_variants(estado);
CREATE INDEX IF NOT EXISTS idx_stamp_variants_design ON stamp_variants(design_id);
CREATE INDEX IF NOT EXISTS idx_stamp_variants_archivo ON stamp_variants(archivo_original);

-- ---------------------------------------------------------------------------
-- Productos vendidos (independiente del catalogo de ventas real; se cargan
-- o importan, y se referencian por SKU)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  variante TEXT,                            -- talle / color de la prenda
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------------
-- Recetas de estampado (composicion por producto)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_stamp_recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  stamp_variant_id INTEGER NOT NULL REFERENCES stamp_variants(id),
  cantidad_por_unidad INTEGER NOT NULL DEFAULT 1,
  ubicacion_aplicacion TEXT,                -- frente | espalda | manga | pantalon | otra
  vigente_desde TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  vigente_hasta TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  confirmado INTEGER NOT NULL DEFAULT 0,    -- 0 = sugerido/candidato, 1 = confirmado manualmente
  origen TEXT NOT NULL DEFAULT 'manual',    -- manual | sugerido_por_nombre
  observaciones TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_recipes_product ON product_stamp_recipes(product_id);
CREATE INDEX IF NOT EXISTS idx_recipes_stamp ON product_stamp_recipes(stamp_variant_id);

-- ---------------------------------------------------------------------------
-- Movimientos de stock (historico, NUNCA se borra)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stamp_variant_id INTEGER NOT NULL REFERENCES stamp_variants(id),
  tipo TEXT NOT NULL,
    -- ingreso | descuento_pedido | reintegro | correccion | perdida | dano | produccion | ajuste_inicial
  cantidad INTEGER NOT NULL,                -- siempre positivo; el signo lo da `direccion`
  direccion TEXT NOT NULL,                  -- 'entrada' | 'salida'
  stock_anterior INTEGER,
  stock_posterior INTEGER,
  pedido_id TEXT,                           -- id/numero de pedido de la app de ventas (si aplica)
  pedido_item_ref TEXT,                     -- linea de producto dentro del pedido (sku o indice)
  production_order_id INTEGER REFERENCES production_orders(id),
  usuario TEXT,
  motivo TEXT,
  idempotency_key TEXT UNIQUE,              -- clave de idempotencia (ver docs/INTEGRACION_VENTAS.md)
  movimiento_relacionado_id INTEGER REFERENCES movements(id), -- p.ej. reintegro -> movimiento original
  correccion_cantidad_anterior INTEGER,
  correccion_cantidad_nueva INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_movements_stamp ON movements(stamp_variant_id);
CREATE INDEX IF NOT EXISTS idx_movements_pedido ON movements(pedido_id);
CREATE INDEX IF NOT EXISTS idx_movements_created ON movements(created_at);

-- ---------------------------------------------------------------------------
-- Estado de consumo por pedido (motor idempotente). Guarda cuanto se aplico
-- HASTA AHORA para cada (pedido, item, estampa); permite recalcular por
-- diferencia sin importar cuantas veces se reciba el mismo evento.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_stamp_consumption (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id TEXT NOT NULL,
  pedido_item_ref TEXT NOT NULL,
  stamp_variant_id INTEGER NOT NULL REFERENCES stamp_variants(id),
  cantidad_aplicada INTEGER NOT NULL DEFAULT 0,   -- neto actualmente descontado
  last_movement_id INTEGER REFERENCES movements(id),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(pedido_id, pedido_item_ref, stamp_variant_id)
);
CREATE INDEX IF NOT EXISTS idx_osc_pedido ON order_stamp_consumption(pedido_id);

-- Log de cada transicion procesada por pedido (para diagnostico / soporte)
CREATE TABLE IF NOT EXISTS order_transition_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id TEXT NOT NULL,
  evento TEXT NOT NULL,                      -- preparacion_a_armado | armado_a_preparacion | cancelacion | modificacion
  resultado TEXT NOT NULL,                   -- ok | advertencia | error
  detalle_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_otl_pedido ON order_transition_log(pedido_id);

-- ---------------------------------------------------------------------------
-- Ordenes de produccion / reposicion
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS production_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stamp_variant_id INTEGER NOT NULL REFERENCES stamp_variants(id),
  cantidad_necesaria INTEGER NOT NULL,
  cantidad_recibida INTEGER,
  estado TEXT NOT NULL DEFAULT 'Pendiente',
    -- Pendiente | Preparando archivo | Enviado a imprimir | Impreso | Recibido | Cancelado
  notas TEXT,
  creado_por TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_prodorders_stamp ON production_orders(stamp_variant_id);
CREATE INDEX IF NOT EXISTS idx_prodorders_estado ON production_orders(estado);

-- ---------------------------------------------------------------------------
-- Archivos pendientes de revision (del analizador o de la sincronizacion)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pending_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archivo_original TEXT NOT NULL,
  carpeta_origen TEXT,
  motivo TEXT NOT NULL,
  detalle TEXT,
  resuelto INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pending_resuelto ON pending_files(resuelto);

-- ---------------------------------------------------------------------------
-- Posibles duplicados (deteccion automatica, requieren revision manual)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS possible_duplicates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stamp_variant_id_a INTEGER NOT NULL REFERENCES stamp_variants(id),
  stamp_variant_id_b INTEGER NOT NULL REFERENCES stamp_variants(id),
  motivos TEXT,
  resuelto INTEGER NOT NULL DEFAULT 0,
  resolucion TEXT,                          -- 'son_distintos' | 'fusionados_manualmente' | ...
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at TEXT
);

-- ---------------------------------------------------------------------------
-- Log de sincronizaciones de la carpeta de origen
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archivos_nuevos INTEGER NOT NULL DEFAULT 0,
  archivos_modificados INTEGER NOT NULL DEFAULT 0,
  archivos_eliminados INTEGER NOT NULL DEFAULT 0,
  resumen_json TEXT,
  aplicado INTEGER NOT NULL DEFAULT 0,
  usuario TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  applied_at TEXT
);
