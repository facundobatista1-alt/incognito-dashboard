'use strict';
/**
 * Aplica data/sync_summary.json (generado por scripts/sync_check.py) a la
 * base de datos:
 *   - Archivos NUEVOS: se analizan (invocando analyze_stamps.py --only-file)
 *     y se insertan como estampas nuevas con stock pendiente de carga (NULL).
 *   - Archivos MODIFICADOS: se re-analizan y se actualiza SOLO metadata
 *     (previsualizacion, dimensiones, phash, fechas, capas) -- NUNCA se toca
 *     cantidad_disponible, stock_minimo, estado, categoria ni ninguna otra
 *     cosa cargada a mano.
 *   - Archivos ELIMINADOS de la carpeta: NO se borra la estampa. Se agrega
 *     una entrada en pending_files para que alguien lo revise a mano.
 *
 * No duplica registros existentes bajo ningun caso.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { db, ensureSchema } = require('../src/db');

ensureSchema();

const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data');
const PY_SCRIPT = path.join(ROOT, 'scripts', 'analyze_stamps.py');

function readJson(p, fallback) {
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function getOrCreateDesign(prefix) {
  let d = db.prepare('SELECT * FROM designs WHERE codigo_prefijo = ?').get(prefix);
  if (d) return d.id;
  const info = db.prepare('INSERT INTO designs (codigo_prefijo, nombre) VALUES (?, ?)').run(prefix, prefix);
  return info.lastInsertRowid;
}

function analyzeOneFile(filePath) {
  // Corre el analizador solo para este archivo. Usa un directorio de salida
  // temporal separado para no pisar el catalogo jsonl principal.
  const tmpOut = path.join(DATA_DIR, '_sync_tmp');
  fs.mkdirSync(tmpOut, { recursive: true });
  fs.mkdirSync(path.join(tmpOut, 'data'), { recursive: true });
  // limpiamos TODO el estado temporal antes de cada llamada -- estos archivos
  // son acumulativos (jsonl de append), asi que si no se limpian, una
  // corrida posterior arrastra entradas de archivos ya procesados antes.
  for (const name of ['processed_files.txt', 'catalog_raw.jsonl', 'pending_review.jsonl', 'files_index.jsonl', '_id_counter.txt']) {
    const p2 = path.join(tmpOut, 'data', name);
    if (fs.existsSync(p2)) fs.unlinkSync(p2);
  }
  execFileSync('python3', [PY_SCRIPT, path.dirname(filePath), tmpOut, '--only-file', filePath], { stdio: 'pipe' });
  const catalogPath = path.join(tmpOut, 'data', 'catalog_raw.jsonl');
  const pendingPath = path.join(tmpOut, 'data', 'pending_review.jsonl');
  const catalog = fs.existsSync(catalogPath)
    ? fs.readFileSync(catalogPath, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    : [];
  const pending = fs.existsSync(pendingPath)
    ? fs.readFileSync(pendingPath, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    : [];
  // las previews que genera van a <tmpOut>/previews -- las copiamos al
  // directorio de previews real para que queden accesibles por la app.
  const realPreviews = path.join(ROOT, 'previews');
  const tmpPreviews = path.join(tmpOut, 'previews');
  if (fs.existsSync(tmpPreviews)) {
    for (const sub of fs.readdirSync(tmpPreviews)) {
      const src = path.join(tmpPreviews, sub);
      const dst = path.join(realPreviews, sub);
      fs.mkdirSync(dst, { recursive: true });
      for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dst, f));
    }
  }
  return { catalog, pending };
}

function insertNew(item) {
  const codeCollision = db.prepare('SELECT id, archivo_original FROM stamp_variants WHERE codigo = ?').get(item.codigo_sugerido);
  if (codeCollision) {
    db.prepare('INSERT INTO pending_files (archivo_original, carpeta_origen, motivo, detalle) VALUES (?,?,?,?)').run(
      item.archivo_original, item.carpeta_origen,
      'Codigo duplicado con una estampa existente',
      `El codigo sugerido "${item.codigo_sugerido}" ya lo usa la estampa id=${codeCollision.id} (${codeCollision.archivo_original}). ` +
      `No se creo automaticamente para evitar colisiones -- asignar un codigo manualmente.`
    );
    return;
  }
  const designId = getOrCreateDesign(item.diseno_principal);
  const dpi = Array.isArray(item.dpi) ? item.dpi[0] : null;
  const useCm = item.ancho_px && dpi;
  const ancho = useCm ? Math.round((item.ancho_px / dpi) * 2.54 * 100) / 100 : item.ancho_px;
  const alto = useCm ? Math.round((item.alto_px / dpi) * 2.54 * 100) / 100 : item.alto_px;
  db.prepare(`
    INSERT INTO stamp_variants (design_id, codigo, nombre, variante, unidad_medida, ancho, alto,
      cantidad_disponible, stock_minimo, estado, archivo_original, carpeta_origen, formato_archivo,
      origen_tipo, origen_capa_grupo_pagina, previsualizacion, phash, observaciones,
      fecha_creacion_archivo, fecha_modificacion_archivo, origen_json)
    VALUES (?,?,?,?,?,?,?,NULL,0,'Pendiente de revision',?,?,?,?,?,?,?,?,?,?,?)
  `).run(designId, item.codigo_sugerido, item.nombre, item.variante || 'unica', useCm ? 'cm' : 'px',
    ancho, alto, item.archivo_original, item.carpeta_origen, item.formato_archivo, item.origen_tipo,
    item.origen_grupo || null, item.previsualizacion, item.phash || null,
    'Agregado por sincronizacion automatica', item.fecha_creacion_archivo, item.fecha_modificacion_archivo,
    JSON.stringify({ capas_detectadas: item.capas_detectadas || null }));
}

function updateModified(item) {
  // Solo actualiza metadata derivada del archivo. NUNCA toca stock/estado/categoria.
  db.prepare(`
    UPDATE stamp_variants SET previsualizacion = ?, phash = ?, fecha_modificacion_archivo = ?,
      origen_json = ?, updated_at = datetime('now')
    WHERE archivo_original = ?
  `).run(item.previsualizacion, item.phash || null, item.fecha_modificacion_archivo,
    JSON.stringify({ capas_detectadas: item.capas_detectadas || null }), item.archivo_original);
}

function run() {
  const summary = readJson(path.join(DATA_DIR, 'sync_summary.json'), null);
  if (!summary) {
    console.error('No hay data/sync_summary.json. Corre primero scripts/sync_check.py');
    process.exit(1);
  }

  let nuevosInsertados = 0, modificadosActualizados = 0, eliminadosMarcados = 0;

  const txn = db.transaction(() => {
    for (const filePath of summary.archivos_nuevos) {
      const already = db.prepare('SELECT 1 FROM stamp_variants WHERE archivo_original = ?').get(filePath);
      if (already) continue; // nunca duplicar
      const { catalog, pending } = analyzeOneFile(filePath);
      for (const item of catalog) { insertNew(item); nuevosInsertados++; }
      for (const p of pending) {
        db.prepare('INSERT INTO pending_files (archivo_original, carpeta_origen, motivo, detalle) VALUES (?,?,?,?)')
          .run(p.archivo_original, p.carpeta_origen, p.motivo, p.detalle || null);
      }
    }

    for (const filePath of summary.archivos_modificados) {
      const { catalog, pending } = analyzeOneFile(filePath);
      const existing = db.prepare('SELECT id FROM stamp_variants WHERE archivo_original = ?').get(filePath);
      if (existing && catalog.length > 0) {
        updateModified(catalog[0]);
        modificadosActualizados++;
      } else if (catalog.length > 0) {
        // el archivo cambio de tal forma que ahora produce una variante
        // distinta a la que habia -- se inserta como nueva y se deja la
        // vieja para revision manual en vez de borrarla.
        for (const item of catalog) insertNew(item);
        db.prepare('INSERT INTO pending_files (archivo_original, carpeta_origen, motivo, detalle) VALUES (?,?,?,?)')
          .run(filePath, path.dirname(filePath), 'Archivo modificado con estructura distinta', 'Revisar si corresponde discontinuar la variante anterior');
      }
      for (const p of pending) {
        db.prepare('INSERT INTO pending_files (archivo_original, carpeta_origen, motivo, detalle) VALUES (?,?,?,?)')
          .run(p.archivo_original, p.carpeta_origen, p.motivo, p.detalle || null);
      }
    }

    for (const filePath of summary.archivos_eliminados) {
      const existing = db.prepare('SELECT id FROM stamp_variants WHERE archivo_original = ?').get(filePath);
      if (existing) {
        db.prepare('INSERT INTO pending_files (archivo_original, carpeta_origen, motivo, detalle) VALUES (?,?,?,?)')
          .run(filePath, path.dirname(filePath),
            'Archivo ya no esta en la carpeta de origen',
            'La estampa NO se borro automaticamente. Revisar si corresponde discontinuarla manualmente.');
        eliminadosMarcados++;
      }
    }

    db.prepare(`INSERT INTO sync_runs (archivos_nuevos, archivos_modificados, archivos_eliminados, resumen_json, aplicado, applied_at)
                VALUES (?,?,?,?,1,datetime('now'))`)
      .run(summary.total_nuevos, summary.total_modificados, summary.total_eliminados, JSON.stringify(summary));
  });
  txn();

  console.log(`Sincronizacion aplicada: ${nuevosInsertados} estampas nuevas, ${modificadosActualizados} actualizadas, ${eliminadosMarcados} marcadas para revision (no borradas).`);
}

run();
