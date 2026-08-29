'use strict';
/**
 * Importa variantes de color exportadas como PNG.
 *
 * Fuente esperada:
 *   C:\Users\facun\Incognito\Incognito - Documentos\Marketing\Dtf\logos\Diseños DTF
 *
 * Cada archivo debe llamarse CODIGO-BASE-NN.png, por ejemplo AD-01-01.png.
 * Se crea una estampa/variante nueva por PNG, con stock pendiente de contar.
 */
const fs = require('fs');
const path = require('path');
const { getDb, ensureSchema } = require('../src/db');

const SOURCE_DIR = process.env.PNG_VARIANTS_DIR ||
  'C:\\Users\\facun\\Incognito\\Incognito - Documentos\\Marketing\\Dtf\\logos\\Diseños DTF';
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const PREVIEWS_DIR = path.join(PROJECT_ROOT, 'previews');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');

function readJson(name, fallback) {
  const file = path.join(DATA_DIR, name);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function getPngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG') return { width: null, height: null };
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function parseVariantFile(fileName) {
  const match = fileName.match(/^([A-Z]+-\d+)-(\d+)\.png$/i);
  if (!match) return null;
  return {
    code: `${match[1].toUpperCase()}-${match[2]}`,
    baseCode: match[1].toUpperCase(),
    variantNumber: match[2],
    prefix: match[1].split('-')[0].toUpperCase(),
  };
}

async function main() {
  if (!fs.existsSync(SOURCE_DIR)) {
    throw new Error(`No existe la carpeta de variantes PNG: ${SOURCE_DIR}`);
  }

  await ensureSchema();
  const db = getDb();
  const filesIndex = readJson('files_index.json', []);
  const pngFiles = fs.readdirSync(SOURCE_DIR)
    .filter((name) => name.toLowerCase().endsWith('.png'))
    .map((name) => ({ name, parsed: parseVariantFile(name) }))
    .filter((item) => item.parsed)
    .sort((a, b) => a.name.localeCompare(b.name));

  let copied = 0;
  let inserted = 0;
  let updated = 0;
  const resolvedPendingBases = new Set();

  await db.transaction(async (tx) => {
    for (const { name, parsed } of pngFiles) {
      const sourcePath = path.join(SOURCE_DIR, name);
      const targetDir = path.join(PREVIEWS_DIR, parsed.prefix);
      const targetPath = path.join(targetDir, name);
      const previewPath = `previews/${parsed.prefix}/${name}`;
      const size = getPngSize(sourcePath);

      fs.mkdirSync(targetDir, { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
      copied++;

      const designResult = await tx.query(
        `insert into stamp_designs (codigo_prefijo, nombre)
         values ($1,$1)
         on conflict (codigo_prefijo) do update set codigo_prefijo = excluded.codigo_prefijo
         returning id`,
        [parsed.prefix]
      );
      const designId = designResult.rows[0].id;

      const baseResult = await tx.query(
        `select sv.*
         from stamp_variants sv
         where sv.codigo = $1 or sv.codigo = $2
         order by case when sv.codigo = $1 then 0 else 1 end
         limit 1`,
        [parsed.baseCode, `${parsed.baseCode}-Background`]
      );
      const base = baseResult.rows[0] || {};
      const indexedSource = filesIndex.find((item) => item.nombre_archivo === `${parsed.baseCode}.psd`) || {};

      const existing = await tx.query('select id from stamp_variants where codigo = $1', [parsed.code]);
      const variantResult = await tx.query(
        `insert into stamp_variants
           (design_id, codigo, nombre, variante, categoria, subcategoria, marca_tematica,
            color, talle_tamano, ubicacion_aplicacion, ancho, alto, unidad_medida, estado, observaciones)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         on conflict (codigo) do update set
           nombre = excluded.nombre,
           variante = excluded.variante,
           categoria = coalesce(stamp_variants.categoria, excluded.categoria),
           subcategoria = coalesce(stamp_variants.subcategoria, excluded.subcategoria),
           marca_tematica = coalesce(stamp_variants.marca_tematica, excluded.marca_tematica),
           color = coalesce(stamp_variants.color, excluded.color),
           ancho = excluded.ancho,
           alto = excluded.alto,
           unidad_medida = excluded.unidad_medida,
           observaciones = excluded.observaciones,
           updated_at = now()
         returning id`,
        [
          base.design_id || designId,
          parsed.code,
          parsed.code,
          `color ${parsed.variantNumber}`,
          base.categoria || null,
          base.subcategoria || null,
          base.marca_tematica || null,
          `variante ${parsed.variantNumber}`,
          base.talle_tamano || null,
          base.ubicacion_aplicacion || null,
          size.width,
          size.height,
          'px',
          existing.rows[0] ? (base.estado || 'Pendiente de revision') : 'Pendiente de revision',
          `Variante de color exportada como PNG desde ${parsed.baseCode}.`,
        ]
      );
      const variantId = variantResult.rows[0].id;
      if (existing.rows[0]) updated++; else inserted++;

      await tx.query(
        `insert into stamp_files
           (stamp_variant_id, archivo_original, carpeta_origen, formato_archivo, origen_tipo,
            origen_capa_grupo_pagina, previsualizacion, fecha_creacion_archivo, fecha_modificacion_archivo)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (stamp_variant_id, archivo_original, origen_capa_grupo_pagina) do update set
           previsualizacion = excluded.previsualizacion`,
        [
          variantId,
          sourcePath,
          SOURCE_DIR,
          'png',
          'png_variante_color_exportada',
          parsed.variantNumber,
          previewPath,
          fs.statSync(sourcePath).birthtime.toISOString(),
          fs.statSync(sourcePath).mtime.toISOString(),
        ]
      );

      await tx.query(
        `insert into stamp_inventory (stamp_variant_id, cantidad_disponible, stock_minimo, pendiente_de_contar)
         values ($1,null,0,true)
         on conflict (stamp_variant_id) do nothing`,
        [variantId]
      );

      if (indexedSource.archivo_original) {
        await tx.query(
          `update stamp_pending_reviews
           set resuelto = true,
               resolucion = 'Resuelto: variantes de color importadas desde PNG exportado',
               resolved_at = now()
           where resuelto = false and archivo_original = $1`,
          [indexedSource.archivo_original]
        );
        resolvedPendingBases.add(parsed.baseCode);
      }
    }
  });

  console.log(`PNGs detectados: ${pngFiles.length}`);
  console.log(`Previews copiadas: ${copied}`);
  console.log(`Variantes creadas: ${inserted}`);
  console.log(`Variantes actualizadas: ${updated}`);
  console.log(`Pendientes de archivo resueltos por base: ${Array.from(resolvedPendingBases).sort().join(', ') || 'ninguno'}`);
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
