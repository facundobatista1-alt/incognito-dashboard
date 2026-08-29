'use strict';
/**
 * Copia la base local PGlite actual a una base Postgres/Supabase.
 *
 * Uso:
 *   TARGET_DATABASE_URL="postgresql://..." CONFIRM_COPY=YES node db/copy_pglite_to_postgres.js
 *
 * La base destino se vacia para las tablas stamp_* y se cargan los IDs
 * originales, movimientos, recetas, ordenes y stock actual.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { PGlite } = require('@electric-sql/pglite');

const SOURCE_PGLITE_DATA_DIR = process.env.SOURCE_PGLITE_DATA_DIR || path.join(__dirname, '..', 'data', 'pglite');
const TARGET_DATABASE_URL = process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL || '';
const CONFIRM_COPY = process.env.CONFIRM_COPY || '';

const TABLES = [
  {
    name: 'stamp_designs',
    columns: ['id', 'codigo_prefijo', 'nombre', 'categoria', 'subcategoria', 'marca_tematica', 'observaciones', 'created_at', 'updated_at'],
  },
  {
    name: 'stamp_variants',
    columns: ['id', 'design_id', 'codigo', 'nombre', 'variante', 'categoria', 'subcategoria', 'marca_tematica', 'color', 'talle_tamano', 'ubicacion_aplicacion', 'ancho', 'alto', 'unidad_medida', 'estado', 'observaciones', 'legacy_sqlite_id', 'created_at', 'updated_at'],
  },
  {
    name: 'stamp_files',
    columns: ['id', 'stamp_variant_id', 'archivo_original', 'carpeta_origen', 'formato_archivo', 'origen_tipo', 'origen_capa_grupo_pagina', 'previsualizacion', 'phash', 'fecha_creacion_archivo', 'fecha_modificacion_archivo', 'origen_json', 'created_at'],
    jsonColumns: ['origen_json'],
  },
  {
    name: 'stamp_inventory',
    columns: ['stamp_variant_id', 'cantidad_disponible', 'stock_minimo', 'pendiente_de_contar', 'contado_en', 'contado_por', 'updated_at'],
  },
  {
    name: 'stamp_products',
    columns: ['id', 'sku', 'nombre', 'variante', 'fuente', 'activo', 'created_at', 'updated_at'],
  },
  {
    name: 'stamp_product_recipes',
    columns: ['id', 'product_id', 'stamp_variant_id', 'cantidad_por_unidad', 'ubicacion_aplicacion', 'vigente_desde', 'vigente_hasta', 'activo', 'confirmado', 'origen', 'observaciones', 'created_by', 'created_at', 'updated_at'],
  },
  {
    name: 'stamp_movements',
    columns: ['id', 'stamp_variant_id', 'tipo', 'cantidad', 'direccion', 'stock_anterior', 'stock_posterior', 'pedido_id', 'pedido_item_ref', 'sku', 'production_order_id', 'usuario', 'motivo', 'evento_origen', 'idempotency_key', 'movimiento_relacionado_id', 'correccion_cantidad_anterior', 'correccion_cantidad_nueva', 'created_at'],
  },
  {
    name: 'stamp_processed_events',
    columns: ['id', 'pedido_id', 'pedido_item_ref', 'sku', 'stamp_variant_id', 'cantidad_aplicada', 'ultimo_evento', 'ultima_cantidad_procesada', 'idempotency_key', 'last_movement_id', 'updated_at', 'created_at'],
  },
  {
    name: 'stamp_order_transition_log',
    columns: ['id', 'pedido_id', 'evento', 'resultado', 'detalle_json', 'created_at'],
    jsonColumns: ['detalle_json'],
  },
  {
    name: 'stamp_production_orders',
    columns: ['id', 'estado', 'notas', 'creado_por', 'created_at', 'updated_at'],
  },
  {
    name: 'stamp_production_order_items',
    columns: ['id', 'production_order_id', 'stamp_variant_id', 'cantidad_necesaria', 'cantidad_recibida', 'created_at'],
  },
  {
    name: 'stamp_pending_reviews',
    columns: ['id', 'tipo', 'archivo_original', 'carpeta_origen', 'stamp_variant_id', 'related_variant_id', 'motivo', 'detalle', 'resuelto', 'resolucion', 'created_at', 'resolved_at'],
  },
  {
    name: 'stamp_sync_runs',
    columns: ['id', 'archivos_nuevos', 'archivos_modificados', 'archivos_eliminados', 'resumen_json', 'aplicado', 'usuario', 'created_at', 'applied_at'],
    jsonColumns: ['resumen_json'],
  },
];

function needsSsl(connectionString) {
  return /supabase\.(co|com)/i.test(connectionString);
}

function qident(name) {
  return '"' + name.replace(/"/g, '""') + '"';
}

function normalizeValue(value, column, table) {
  if (value == null) return null;
  if ((table.jsonColumns || []).includes(column)) {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  return value;
}

async function applySchema(target) {
  const migrationsDir = path.join(__dirname, '..', '..', 'supabase', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8').replace(/^\uFEFF/, '');
    await target.query(sql);
  }
}

async function copyTable(source, target, table) {
  const rows = (await source.query(`select ${table.columns.map(qident).join(', ')} from public.${qident(table.name)} order by ${table.columns.includes('id') ? 'id' : table.columns[0]}`)).rows;
  if (rows.length === 0) {
    console.log(`  ${table.name}: 0`);
    return;
  }

  const columnSql = table.columns.map(qident).join(', ');
  const valuesSql = table.columns.map((_, idx) => `$${idx + 1}`).join(', ');
  const insertSql = `insert into public.${qident(table.name)} (${columnSql}) values (${valuesSql})`;
  for (const row of rows) {
    const values = table.columns.map(col => normalizeValue(row[col], col, table));
    await target.query(insertSql, values);
  }
  console.log(`  ${table.name}: ${rows.length}`);
}

async function resetSequences(target) {
  for (const table of TABLES.filter(t => t.columns.includes('id'))) {
    const seq = `public.${table.name}_id_seq`;
    await target.query(`select setval($1::regclass, coalesce((select max(id) from public.${qident(table.name)}), 1), true)`, [seq]);
  }
}

async function main() {
  if (!TARGET_DATABASE_URL) throw new Error('Falta TARGET_DATABASE_URL o DATABASE_URL');
  if (CONFIRM_COPY !== 'YES') throw new Error('Para evitar accidentes, ejecutar con CONFIRM_COPY=YES');
  if (!fs.existsSync(SOURCE_PGLITE_DATA_DIR)) throw new Error(`No existe SOURCE_PGLITE_DATA_DIR: ${SOURCE_PGLITE_DATA_DIR}`);

  const source = new PGlite(SOURCE_PGLITE_DATA_DIR);
  const target = new Pool({
    connectionString: TARGET_DATABASE_URL,
    ssl: needsSsl(TARGET_DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
    max: 2,
  });

  try {
    console.log(`Origen PGlite: ${SOURCE_PGLITE_DATA_DIR}`);
    console.log('Aplicando esquema en destino...');
    await applySchema(target);

    console.log('Vaciando tablas stamp_* en destino...');
    await target.query(`truncate table ${TABLES.map(t => `public.${qident(t.name)}`).reverse().join(', ')} restart identity cascade`);

    console.log('Copiando datos...');
    for (const table of TABLES) await copyTable(source, target, table);
    await resetSequences(target);

    const total = await target.query('select count(*)::int as n from public.stamp_variants');
    const movements = await target.query('select count(*)::int as n from public.stamp_movements');
    console.log(`Listo. Variantes: ${total.rows[0].n}. Movimientos: ${movements.rows[0].n}.`);
  } finally {
    await source.close();
    await target.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
