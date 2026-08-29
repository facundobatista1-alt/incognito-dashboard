'use strict';
/**
 * Carga inicial del catalogo generado por scripts/analyze_stamps.py hacia la
 * base de datos real.
 *
 * REGLAS (seccion 10 del pedido original):
 *  - No infiere stock a partir de la cantidad de archivos: cantidad_disponible
 *    queda en NULL ("pendiente de carga") salvo que se indique una fuente
 *    confiable.
 *  - Es idempotente: si un archivo_original ya existe como stamp_variant, no
 *    lo duplica (esto tambien es la base de la sincronizacion futura, ver
 *    sync_check.js).
 *  - Carga tambien pending_review.json -> pending_files y
 *    possible_duplicates.json -> possible_duplicates.
 */
const fs = require('fs');
const path = require('path');
const { db, ensureSchema } = require('../src/db');

ensureSchema();

const ROOT = path.join(__dirname, '..', '..'); // stock-dtf/
const DATA_DIR = path.join(ROOT, 'data');

function readJson(name, fallback) {
  const p = path.join(DATA_DIR, name);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function pxToCm(px, dpi) {
  if (!px || !dpi) return null;
  return Math.round((px / dpi) * 2.54 * 100) / 100;
}

function getOrCreateDesign(prefix) {
  let d = db.prepare('SELECT * FROM designs WHERE codigo_prefijo = ?').get(prefix);
  if (d) return d.id;
  const info = db.prepare('INSERT INTO designs (codigo_prefijo, nombre) VALUES (?, ?)').run(prefix, prefix);
  return info.lastInsertRowid;
}

function seedCatalog() {
  const catalog = readJson('catalog_raw.json', []);
  const existingByFile = new Set(
    db.prepare('SELECT archivo_original, origen_capa_grupo_pagina FROM stamp_variants').all()
      .map(r => r.archivo_original + '||' + (r.origen_capa_grupo_pagina || ''))
  );

  const insertStmt = db.prepare(`
    INSERT INTO stamp_variants (
      design_id, codigo, nombre, variante, categoria, subcategoria, marca_tematica, color, talle_tamano,
      ubicacion_aplicacion, ancho, alto, unidad_medida, cantidad_disponible, stock_minimo, estado,
      archivo_original, carpeta_origen, formato_archivo, origen_tipo, origen_capa_grupo_pagina,
      previsualizacion, phash, observaciones, fecha_creacion_archivo, fecha_modificacion_archivo, origen_json
    ) VALUES (
      @design_id, @codigo, @nombre, @variante, @categoria, @subcategoria, @marca_tematica, @color, @talle_tamano,
      @ubicacion_aplicacion, @ancho, @alto, @unidad_medida, @cantidad_disponible, @stock_minimo, @estado,
      @archivo_original, @carpeta_origen, @formato_archivo, @origen_tipo, @origen_capa_grupo_pagina,
      @previsualizacion, @phash, @observaciones, @fecha_creacion_archivo, @fecha_modificacion_archivo, @origen_json
    )
  `);

  let inserted = 0, skipped = 0;
  const txn = db.transaction(() => {
    for (const item of catalog) {
      const variantKey = item.origen_tipo === 'imagen_simple' || item.origen_tipo === 'tiff_pagina_unica' || item.origen_tipo === 'psd_sin_grupos'
        ? '' : item.variante;
      const dedupKey = item.archivo_original + '||' + (variantKey || '');
      if (existingByFile.has(dedupKey)) { skipped++; continue; }

      const designId = getOrCreateDesign(item.diseno_principal);
      const dpi = Array.isArray(item.dpi) ? item.dpi[0] : null;
      const anchoCm = pxToCm(item.ancho_px, dpi);
      const altoCm = pxToCm(item.alto_px, dpi);
      const useCm = anchoCm && altoCm;

      insertStmt.run({
        design_id: designId,
        codigo: item.codigo_sugerido,
        nombre: item.nombre,
        variante: item.variante || 'unica',
        categoria: null,
        subcategoria: null,
        marca_tematica: null,
        color: null,
        talle_tamano: null,
        ubicacion_aplicacion: null,
        ancho: useCm ? anchoCm : item.ancho_px,
        alto: useCm ? altoCm : item.alto_px,
        unidad_medida: useCm ? 'cm' : 'px',
        cantidad_disponible: null, // pendiente de carga -- NO se infiere
        stock_minimo: 0,
        estado: 'Pendiente de revision',
        archivo_original: item.archivo_original,
        carpeta_origen: item.carpeta_origen,
        formato_archivo: item.formato_archivo,
        origen_tipo: item.origen_tipo,
        origen_capa_grupo_pagina: (item.origen_grupo || (item.origen_pagina ? `pagina_${item.origen_pagina}` : null)),
        previsualizacion: item.previsualizacion,
        phash: item.phash || null,
        observaciones: item.observaciones || null,
        fecha_creacion_archivo: item.fecha_creacion_archivo || null,
        fecha_modificacion_archivo: item.fecha_modificacion_archivo || null,
        origen_json: JSON.stringify({ capas_detectadas: item.capas_detectadas || null, id_interno_analisis: item.id_interno }),
      });
      inserted++;
    }
  });
  txn();
  console.log(`Estampas: ${inserted} insertadas, ${skipped} ya existian (omitidas).`);
}

function seedPending() {
  const pending = readJson('pending_review.json', []);
  const existing = new Set(db.prepare('SELECT archivo_original, motivo FROM pending_files').all().map(r => r.archivo_original + '||' + r.motivo));
  const stmt = db.prepare('INSERT INTO pending_files (archivo_original, carpeta_origen, motivo, detalle) VALUES (?,?,?,?)');
  let n = 0;
  const txn = db.transaction(() => {
    for (const p of pending) {
      const key = p.archivo_original + '||' + p.motivo;
      if (existing.has(key)) continue;
      stmt.run(p.archivo_original, p.carpeta_origen || null, p.motivo, p.detalle || null);
      n++;
    }
  });
  txn();
  console.log(`Pendientes de revision: ${n} insertados.`);
}

function seedDuplicates() {
  const dups = readJson('possible_duplicates.json', []);
  const findVariantId = db.prepare('SELECT id FROM stamp_variants WHERE archivo_original = ? LIMIT 1');
  const stmt = db.prepare('INSERT INTO possible_duplicates (stamp_variant_id_a, stamp_variant_id_b, motivos) VALUES (?,?,?)');
  let n = 0, skipped = 0;
  const txn = db.transaction(() => {
    for (const d of dups) {
      const a = findVariantId.get(d.archivo_a);
      const b = findVariantId.get(d.archivo_b);
      if (!a || !b) { skipped++; continue; }
      const already = db.prepare(`
        SELECT 1 FROM possible_duplicates
        WHERE (stamp_variant_id_a=? AND stamp_variant_id_b=?) OR (stamp_variant_id_a=? AND stamp_variant_id_b=?)
      `).get(a.id, b.id, b.id, a.id);
      if (already) { skipped++; continue; }
      stmt.run(a.id, b.id, JSON.stringify(d.motivos || []));
      n++;
    }
  });
  txn();
  console.log(`Posibles duplicados: ${n} insertados, ${skipped} omitidos.`);
}

seedCatalog();
seedPending();
seedDuplicates();
console.log('Carga inicial completa.');
