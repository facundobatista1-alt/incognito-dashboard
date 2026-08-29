'use strict';
/**
 * Migra el catalogo hacia Postgres/PGlite leyendo directamente los JSON que
 * genero el analisis original (data/catalog_raw.json, data/pending_review.json,
 * data/possible_duplicates.json), SIN pasar por SQLite.
 *
 * Pensado para maquinas donde better-sqlite3 no puede compilarse (Windows
 * sin Visual Studio Build Tools). No inventa cantidades de stock
 * (cantidad_disponible se copia tal cual, null sigue siendo null) y es
 * re-ejecutable de forma segura (upserts por clave natural).
 *
 * Uso: node db/migrate_from_json.js
 * (sin DATABASE_URL, migra hacia el PGlite local de desarrollo)
 */
const fs = require('fs');
const path = require('path');
const { getDb, ensureSchema } = require('../src/db');

const DATA_DIR = process.env.CATALOG_DATA_DIR || path.join(__dirname, '..', '..', 'data');

function readJson(name, fallback) {
  const p = path.join(DATA_DIR, name);
  if (!fs.existsSync(p)) {
    console.log(`  (no existe ${name}, se usa ${JSON.stringify(fallback)})`);
    return fallback;
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

async function main() {
  console.log(`Migrando desde JSON: ${DATA_DIR}`);
  const catalog = readJson('catalog_raw.json', []);
  const pending = readJson('pending_review.json', []);
  const dups = readJson('possible_duplicates.json', []);

  console.log(`Origen: ${catalog.length} estampas en catalogo, ${pending.length} pendientes de revision, ${dups.length} posibles duplicados.`);

  await ensureSchema();
  const db = getDb();

  const designIdMap = new Map(); // codigo_prefijo -> pg id

  await db.transaction(async (tx) => {
    for (const item of catalog) {
      const prefijo = item.diseno_principal || (item.codigo_sugerido || '').split('-')[0] || 'SD';

      let designPgId = designIdMap.get(prefijo);
      if (!designPgId) {
        const r = await tx.query(
          `insert into stamp_designs (codigo_prefijo, nombre)
           values ($1,$1)
           on conflict (codigo_prefijo) do update set codigo_prefijo = excluded.codigo_prefijo
           returning id`,
          [prefijo]
        );
        designPgId = r.rows[0].id;
        designIdMap.set(prefijo, designPgId);
      }

      const codigo = item.codigo_sugerido || item.codigo;
      if (!codigo) { console.log('  saltando item sin codigo:', item.archivo_original); continue; }

      const vr = await tx.query(
        `insert into stamp_variants
           (design_id, codigo, nombre, variante, categoria, subcategoria, marca_tematica, color, talle_tamano,
            ubicacion_aplicacion, ancho, alto, unidad_medida, estado, observaciones)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         on conflict (codigo) do update set
           nombre = excluded.nombre, variante = excluded.variante, estado = excluded.estado
         returning id`,
        [designPgId, codigo, item.nombre || codigo, item.variante || 'unica', item.categoria || null,
         item.subcategoria || null, item.marca_tematica || null, item.color || null, item.talle_tamano || null,
         item.ubicacion_aplicacion || null, item.ancho_px || null, item.alto_px || null,
         item.unidad_medida || 'px', item.estado || 'Pendiente de revision', item.observaciones || null]
      );
      const pgId = vr.rows[0].id;

      await tx.query(
        `insert into stamp_files
           (stamp_variant_id, archivo_original, carpeta_origen, formato_archivo, origen_tipo,
            previsualizacion, phash, fecha_creacion_archivo, fecha_modificacion_archivo)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (stamp_variant_id, archivo_original, origen_capa_grupo_pagina) do nothing`,
        [pgId, item.archivo_original || null, item.carpeta_origen || null, item.formato_archivo || null,
         item.origen_tipo || null, item.previsualizacion || null, item.phash || null,
         item.fecha_creacion_archivo || null, item.fecha_modificacion_archivo || null]
      );

      await tx.query(
        `insert into stamp_inventory (stamp_variant_id, cantidad_disponible, stock_minimo, pendiente_de_contar)
         values ($1,$2,$3,$4)
         on conflict (stamp_variant_id) do update set
           cantidad_disponible = excluded.cantidad_disponible, stock_minimo = excluded.stock_minimo`,
        [pgId, item.cantidad_disponible ?? null, item.stock_minimo || 0, (item.cantidad_disponible ?? null) === null]
      );
    }

    for (const p of pending) {
      await tx.query(
        `insert into stamp_pending_reviews (tipo, archivo_original, carpeta_origen, motivo, detalle)
         values ('archivo',$1,$2,$3,$4)`,
        [p.archivo_original || null, p.carpeta_origen || null, p.motivo || 'Sin motivo especificado', p.detalle || null]
      );
    }
  });

  const counts = await db.query('select count(*)::int n from stamp_variants');
  const designsCount = await db.query('select count(*)::int n from stamp_designs');
  const pendingCount = await db.query(`select count(*)::int n from stamp_pending_reviews where resuelto=false`);

  console.log('\n--- MIGRACION COMPLETA ---');
  console.log(`Disenos: ${designsCount.rows[0].n}`);
  console.log(`Variantes de estampa: ${counts.rows[0].n}`);
  console.log(`Pendientes de revision: ${pendingCount.rows[0].n}`);
}

main().catch((err) => { console.error('ERROR:', err); process.exit(1); });
