'use strict';
const fs = require('fs');
const path = require('path');
const { getDb, ensureSchema } = require('../src/db');

const SOURCE_DIR = process.env.PNG_VARIANTS_DIR ||
  'C:\\Users\\facun\\Incognito\\Incognito - Documentos\\Marketing\\Dtf\\logos\\Dise\u00f1os DTF';
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const PREVIEWS_DIR = path.join(PROJECT_ROOT, 'previews');

function getPngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG') return { width: null, height: null };
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

async function main() {
  await ensureSchema();
  const db = getDb();

  const bases = await db.query(`
    select base.id, base.codigo
    from stamp_variants base
    where base.codigo ~ '^[A-Z]+-[0-9]+$'
      and exists (
        select 1 from stamp_variants sibling
        where sibling.codigo like base.codigo || '-__'
      )
      and not exists (
        select 1 from stamp_variants first_color
        where first_color.codigo = base.codigo || '-01'
      )
    order by base.codigo
  `);

  const converted = [];
  const skipped = [];

  await db.transaction(async (tx) => {
    for (const base of bases.rows) {
      const newCode = `${base.codigo}-01`;
      const prefix = base.codigo.split('-')[0];
      const sourcePath = path.join(SOURCE_DIR, `${newCode}.png`);
      const previewPath = `previews/${prefix}/${newCode}.png`;
      const previewFile = path.join(PREVIEWS_DIR, prefix, `${newCode}.png`);

      if (!fs.existsSync(previewFile) && !fs.existsSync(sourcePath)) {
        skipped.push(`${base.codigo} (no encontre ${newCode}.png)`);
        continue;
      }

      const imageFile = fs.existsSync(previewFile) ? previewFile : sourcePath;
      const size = getPngSize(imageFile);
      const original = await tx.query('select observaciones from stamp_variants where id = $1', [base.id]);
      const obs = original.rows[0]?.observaciones || '';
      const note = `Convertida desde ${base.codigo}: la base representa la variante color 01.`;
      const observaciones = [obs, note].filter(Boolean).join('\n');

      await tx.query(`
        update stamp_variants
        set codigo = $2,
            nombre = $2,
            variante = 'color 01',
            color = coalesce(color, 'variante 01'),
            ancho = $3,
            alto = $4,
            unidad_medida = 'px',
            observaciones = $5,
            updated_at = now()
        where id = $1
      `, [base.id, newCode, size.width, size.height, observaciones]);

      const file = await tx.query(`
        select id from stamp_files
        where stamp_variant_id = $1
        order by id
        limit 1
      `, [base.id]);

      if (file.rows[0]) {
        await tx.query(`
          update stamp_files
          set archivo_original = $2,
              carpeta_origen = $3,
              formato_archivo = 'png',
              origen_tipo = 'png_variante_color_exportada',
              origen_capa_grupo_pagina = '01',
              previsualizacion = $4
          where id = $1
        `, [file.rows[0].id, sourcePath, SOURCE_DIR, previewPath]);
      } else {
        await tx.query(`
          insert into stamp_files
            (stamp_variant_id, archivo_original, carpeta_origen, formato_archivo, origen_tipo, origen_capa_grupo_pagina, previsualizacion)
          values ($1,$2,$3,'png','png_variante_color_exportada','01',$4)
        `, [base.id, sourcePath, SOURCE_DIR, previewPath]);
      }

      converted.push(`${base.codigo} -> ${newCode}`);
    }
  });

  console.log(`Bases convertidas a variante -01: ${converted.length}`);
  for (const item of converted) console.log(`- ${item}`);
  if (skipped.length) {
    console.log(`Omitidas: ${skipped.length}`);
    for (const item of skipped) console.log(`- ${item}`);
  }
  await db.close();
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
