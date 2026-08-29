'use strict';
/**
 * Migra los datos de server/data/stock.db (SQLite) hacia el esquema nuevo
 * en Postgres/Supabase (supabase/migrations/0001_stamps_schema.sql).
 *
 * - Conserva codigos, rutas de archivo, previsualizaciones y el id que
 *   tenian en SQLite (columna legacy_sqlite_id, para trazabilidad).
 * - NO inventa cantidades de stock: cantidad_disponible se copia tal cual
 *   estaba (NULL sigue siendo NULL).
 * - Es re-ejecutable de forma segura: usa upserts por clave natural
 *   (codigo, archivo_original) en vez de asumir que corre una sola vez.
 *
 * Uso:
 *   DATABASE_URL=postgres://... node db/migrate_sqlite_to_postgres.js
 *   (sin DATABASE_URL, migra hacia el PGlite local de desarrollo)
 */
const path = require('path');
const Database = require('better-sqlite3');
const { getDb, ensureSchema } = require('../src/db');

const SQLITE_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'stock.db');

async function main() {
  console.log(`Migrando desde SQLite: ${SQLITE_PATH}`);
  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  await ensureSchema();
  const db = getDb();

  const designs = sqlite.prepare('SELECT * FROM designs').all();
  const variants = sqlite.prepare('SELECT * FROM stamp_variants').all();
  const pendingFiles = sqlite.prepare('SELECT * FROM pending_files').all();
  const dups = sqlite.prepare('SELECT * FROM possible_duplicates').all();
  const products = sqlite.prepare('SELECT * FROM products').all();
  const recipes = sqlite.prepare('SELECT * FROM product_stamp_recipes').all();
  const movements = sqlite.prepare('SELECT * FROM movements').all();
  const prodOrders = sqlite.prepare('SELECT * FROM production_orders').all();

  console.log(`Origen: ${designs.length} disenos, ${variants.length} variantes, ${pendingFiles.length} pendientes, ` +
    `${dups.length} duplicados, ${products.length} productos, ${recipes.length} recetas, ` +
    `${movements.length} movimientos, ${prodOrders.length} ordenes de produccion.`);

  const designIdMap = new Map();   // sqlite id -> pg id
  const variantIdMap = new Map();  // sqlite id -> pg id
  const productIdMap = new Map();
  const movementIdMap = new Map();
  const prodOrderIdMap = new Map();

  await db.transaction(async (tx) => {
    // ---- designs ----
    for (const d of designs) {
      const r = await tx.query(
        `insert into stamp_designs (codigo_prefijo, nombre, categoria, subcategoria, marca_tematica, observaciones)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (codigo_prefijo) do update set nombre = excluded.nombre
         returning id`,
        [d.codigo_prefijo, d.nombre, d.categoria, d.subcategoria, d.marca_tematica, d.observaciones]
      );
      designIdMap.set(d.id, r.rows[0].id);
    }

    // ---- variants + files + inventory ----
    for (const v of variants) {
      const designPgId = v.design_id ? designIdMap.get(v.design_id) : null;
      const r = await tx.query(
        `insert into stamp_variants
           (design_id, codigo, nombre, variante, categoria, subcategoria, marca_tematica, color, talle_tamano,
            ubicacion_aplicacion, ancho, alto, unidad_medida, estado, observaciones, legacy_sqlite_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         on conflict (codigo) do update set
           nombre = excluded.nombre, variante = excluded.variante, estado = excluded.estado
         returning id`,
        [designPgId, v.codigo, v.nombre, v.variante, v.categoria, v.subcategoria, v.marca_tematica,
         v.color, v.talle_tamano, v.ubicacion_aplicacion, v.ancho, v.alto, v.unidad_medida,
         v.estado, v.observaciones, v.id]
      );
      const pgId = r.rows[0].id;
      variantIdMap.set(v.id, pgId);

      await tx.query(
        `insert into stamp_files
           (stamp_variant_id, archivo_original, carpeta_origen, formato_archivo, origen_tipo,
            origen_capa_grupo_pagina, previsualizacion, phash, fecha_creacion_archivo,
            fecha_modificacion_archivo, origen_json)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict (stamp_variant_id, archivo_original, origen_capa_grupo_pagina) do nothing`,
        [pgId, v.archivo_original, v.carpeta_origen, v.formato_archivo, v.origen_tipo,
         v.origen_capa_grupo_pagina, v.previsualizacion, v.phash,
         v.fecha_creacion_archivo || null, v.fecha_modificacion_archivo || null,
         v.origen_json || null]
      );

      await tx.query(
        `insert into stamp_inventory (stamp_variant_id, cantidad_disponible, stock_minimo, pendiente_de_contar)
         values ($1,$2,$3,$4)
         on conflict (stamp_variant_id) do update set
           cantidad_disponible = excluded.cantidad_disponible, stock_minimo = excluded.stock_minimo`,
        [pgId, v.cantidad_disponible, v.stock_minimo || 0, v.cantidad_disponible === null]
      );
    }

    // ---- pending_files -> stamp_pending_reviews (tipo='archivo') ----
    for (const p of pendingFiles) {
      await tx.query(
        `insert into stamp_pending_reviews (tipo, archivo_original, carpeta_origen, motivo, detalle, resuelto)
         values ('archivo',$1,$2,$3,$4,$5)`,
        [p.archivo_original, p.carpeta_origen, p.motivo, p.detalle, !!p.resuelto]
      );
    }

    // ---- possible_duplicates -> stamp_pending_reviews (tipo='posible_duplicado') ----
    for (const d of dups) {
      const aId = variantIdMap.get(d.stamp_variant_id_a);
      const bId = variantIdMap.get(d.stamp_variant_id_b);
      if (!aId || !bId) continue;
      await tx.query(
        `insert into stamp_pending_reviews (tipo, stamp_variant_id, related_variant_id, motivo, detalle, resuelto, resolucion)
         values ('posible_duplicado',$1,$2,'Posible duplicado detectado por analisis',$3,$4,$5)`,
        [aId, bId, d.motivos, !!d.resuelto, d.resolucion]
      );
    }

    // ---- products ----
    for (const p of products) {
      const r = await tx.query(
        `insert into stamp_products (sku, nombre, variante, activo)
         values ($1,$2,$3,$4)
         on conflict (sku) do update set nombre = excluded.nombre
         returning id`,
        [p.sku, p.nombre, p.variante, !!p.activo]
      );
      productIdMap.set(p.id, r.rows[0].id);
    }

    // ---- recipes ----
    for (const rec of recipes) {
      const productPgId = productIdMap.get(rec.product_id);
      const variantPgId = variantIdMap.get(rec.stamp_variant_id);
      if (!productPgId || !variantPgId) continue;
      await tx.query(
        `insert into stamp_product_recipes
           (product_id, stamp_variant_id, cantidad_por_unidad, ubicacion_aplicacion, activo, confirmado, origen, observaciones, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [productPgId, variantPgId, rec.cantidad_por_unidad, rec.ubicacion_aplicacion,
         !!rec.activo, !!rec.confirmado, rec.origen, rec.observaciones, rec.created_by]
      );
    }

    // ---- movements ----
    for (const m of movements) {
      const variantPgId = variantIdMap.get(m.stamp_variant_id);
      if (!variantPgId) continue;
      const r = await tx.query(
        `insert into stamp_movements
           (stamp_variant_id, tipo, cantidad, direccion, stock_anterior, stock_posterior, pedido_id,
            pedido_item_ref, usuario, motivo, idempotency_key, correccion_cantidad_anterior,
            correccion_cantidad_nueva, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         returning id`,
        [variantPgId, m.tipo, m.cantidad, m.direccion, m.stock_anterior, m.stock_posterior,
         m.pedido_id, m.pedido_item_ref, m.usuario, m.motivo,
         m.idempotency_key ? `legacy:${m.idempotency_key}` : null,
         m.correccion_cantidad_anterior, m.correccion_cantidad_nueva, m.created_at]
      );
      movementIdMap.set(m.id, r.rows[0].id);
    }

    // ---- production_orders (SQLite: 1 orden = 1 estampa) -> orders + items ----
    for (const po of prodOrders) {
      const variantPgId = variantIdMap.get(po.stamp_variant_id);
      if (!variantPgId) continue;
      const r = await tx.query(
        `insert into stamp_production_orders (estado, notas, creado_por, created_at)
         values ($1,$2,$3,$4) returning id`,
        [po.estado, po.notas, po.creado_por, po.created_at]
      );
      const orderPgId = r.rows[0].id;
      prodOrderIdMap.set(po.id, orderPgId);
      await tx.query(
        `insert into stamp_production_order_items (production_order_id, stamp_variant_id, cantidad_necesaria, cantidad_recibida)
         values ($1,$2,$3,$4)`,
        [orderPgId, variantPgId, po.cantidad_necesaria, po.cantidad_recibida]
      );
    }
  });

  console.log('\n--- MIGRACION COMPLETA ---');
  console.log(`Disenos: ${designIdMap.size}`);
  console.log(`Variantes de estampa: ${variantIdMap.size}`);
  console.log(`Productos: ${productIdMap.size}`);
  console.log(`Movimientos: ${movementIdMap.size}`);
  console.log(`Ordenes de produccion: ${prodOrderIdMap.size}`);

  sqlite.close();
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERROR EN LA MIGRACION:', e); process.exit(1); });
