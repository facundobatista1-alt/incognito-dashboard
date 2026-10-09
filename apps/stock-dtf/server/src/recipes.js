'use strict';
const sizeStamps = require('./sizeStamps');
/**
 * Resolucion de consumo para un pedido -- version Postgres.
 * Prioridad:
 *  1) receta manual confirmada, si existe;
 *  2) codigo de estampa detectado en SKU/nombre/texto del item, sin asociar
 *     definitivamente el producto;
 *  3) advertencia si no se puede resolver.
 */

async function getActiveRecipesForProduct(db, productId) {
  const r = await db.query(
    `select r.*, sv.nombre as estampa_nombre, sv.codigo as estampa_codigo
     from stamp_product_recipes r join stamp_variants sv on sv.id = r.stamp_variant_id
     where r.product_id = $1 and r.activo = true and r.confirmado = true
       and (r.vigente_hasta is null or r.vigente_hasta > now())`,
    [productId]
  );
  return r.rows;
}

async function findProductBySku(db, sku) {
  const r = await db.query('select * from stamp_products where sku = $1', [sku]);
  return r.rows[0] || null;
}

function normalizeText(value) {
  return String(value || '').toUpperCase().replace(/[_\s]+/g, '-');
}

function extractStampCodeCandidates(item, product) {
  const haystack = [
    item.sku,
    item.nombre,
    item.name,
    item.titulo,
    item.title,
    item.descripcion,
    item.codigo,
    item.estampa_codigo,
    product?.sku,
    product?.nombre,
    product?.variante,
  ].map(normalizeText).join(' ');

  const found = new Set();
  const re = /(?:^|[^A-Z0-9])([A-Z]{2}-\d{2}(?:-\d{2})?)(?=$|[^A-Z0-9])/g;
  let m;
  while ((m = re.exec(haystack))) found.add(m[1]);
  return [...found].sort((a, b) => b.length - a.length);
}

function extractStampCodeOccurrences(item, product) {
  const parseValues = (values) => {
    const haystack = values.map(normalizeText).join(' ');
    const found = [];
    const re = /(?:^|[^A-Z0-9])([A-Z]{2}-\d{2}(?:-\d{2})?)(?=$|[^A-Z0-9])/g;
    let m;
    while ((m = re.exec(haystack))) found.push(m[1]);
    return found.slice(0, 4);
  };

  const skuCodes = parseValues([item.sku, product?.sku]);
  if (skuCodes.length) return skuCodes;

  const explicitCodes = parseValues([
    item.codigo_estampa,
    item.estampa_codigo,
    item.stampCode,
    item.stamp_code,
  ]);
  if (explicitCodes.length) return explicitCodes;

  return parseValues([
    item.codigo,
    item.nombre,
    item.name,
    item.titulo,
    item.title,
    item.descripcion,
    product?.nombre,
    product?.variante,
  ]);
}

async function findStampsByText(db, item, product) {
  const codes = extractStampCodeOccurrences(item, product);
  const found = [];
  for (const code of codes) {
    const r = await db.query(
      `select id, codigo from stamp_variants
       where codigo = $1 and coalesce(categoria, '') <> 'Talles'`,
      [code]
    );
    if (r.rows[0]) found.push(r.rows[0]);
  }
  return found;
}

/**
 * items: [{ sku, cantidad, itemRef }]
 * Devuelve { consumos, sinReceta }
 */
async function resolveConsumptionForOrderItems(db, items) {
  const consumos = [];
  const sinReceta = [];
  const sourceItems = Array.isArray(items) ? items : [];

  // Resolver un pedido completo en lote evita una consulta por SKU, receta,
  // talle y codigo. En produccion esto reduce cientos de viajes a Postgres a
  // solo tres, sin cambiar las prioridades de resolucion.
  const skus = [...new Set(sourceItems.map((item) => String(item.sku || '')).filter(Boolean))];
  let products = [];
  if (skus.length) {
    const placeholders = skus.map((_, index) => `$${index + 1}`).join(',');
    products = (await db.query(`select * from stamp_products where sku in (${placeholders})`, skus)).rows;
  }
  const productsBySku = new Map(products.map((product) => [String(product.sku), product]));

  const productIds = [...new Set(products.map((product) => Number(product.id)).filter(Number.isFinite))];
  let allRecipes = [];
  if (productIds.length) {
    const placeholders = productIds.map((_, index) => `$${index + 1}`).join(',');
    allRecipes = (await db.query(
      `select r.*, sv.nombre as estampa_nombre, sv.codigo as estampa_codigo
       from stamp_product_recipes r join stamp_variants sv on sv.id = r.stamp_variant_id
       where r.product_id in (${placeholders}) and r.activo = true and r.confirmado = true
         and (r.vigente_hasta is null or r.vigente_hasta > now())`,
      productIds
    )).rows;
  }
  const recipesByProduct = new Map();
  for (const recipe of allRecipes) {
    const key = String(recipe.product_id);
    if (!recipesByProduct.has(key)) recipesByProduct.set(key, []);
    recipesByProduct.get(key).push(recipe);
  }

  const contexts = sourceItems.map((item) => {
    const product = productsBySku.get(String(item.sku || '')) || null;
    const recipeRows = product ? (recipesByProduct.get(String(product.id)) || []) : [];
    const size = sizeStamps.extractSize(item, product);
    const prefix = sizeStamps.extractStampPrefix(item, product, recipeRows);
    return {
      item,
      product,
      recipeRows,
      sizeCode: sizeStamps.sizeStampCode(prefix, size),
      autoCodes: recipeRows.length ? [] : extractStampCodeOccurrences(item, product),
    };
  });

  const stampCodes = [...new Set(contexts.flatMap((context) => [context.sizeCode, ...context.autoCodes]).filter(Boolean))];
  let stamps = [];
  if (stampCodes.length) {
    const placeholders = stampCodes.map((_, index) => `$${index + 1}`).join(',');
    stamps = (await db.query(
      `select id, codigo, categoria from stamp_variants where codigo in (${placeholders})`,
      stampCodes
    )).rows;
  }
  const stampsByCode = new Map(stamps.map((stamp) => [String(stamp.codigo), stamp]));

  for (const context of contexts) {
    const { item, product, recipeRows, sizeCode, autoCodes } = context;
    const itemRef = item.itemRef || item.sku;
    const cantidadItem = Number(item.cantidad ?? 1);
    const sizeStamp = stampsByCode.get(sizeCode);
    if (sizeStamp) {
      consumos.push({
        itemRef, sku: item.sku, stampVariantId: sizeStamp.id,
        cantidadRequerida: cantidadItem,
        ubicacion: 'talle',
      });
    }

    if (recipeRows.length > 0) {
      for (const r of recipeRows) {
        consumos.push({
          itemRef, sku: item.sku, stampVariantId: r.stamp_variant_id,
          cantidadRequerida: cantidadItem * r.cantidad_por_unidad,
          ubicacion: r.ubicacion_aplicacion,
        });
      }
      continue;
    }

    const autoStamps = autoCodes
      .map((code) => stampsByCode.get(code))
      .filter((stamp) => stamp && String(stamp.categoria || '') !== 'Talles');
    if (autoStamps.length > 0) {
      const grouped = new Map();
      for (const autoStamp of autoStamps) {
        const key = String(autoStamp.id);
        const current = grouped.get(key) || { ...autoStamp, veces: 0 };
        current.veces += 1;
        grouped.set(key, current);
      }
      for (const autoStamp of grouped.values()) {
        consumos.push({
          itemRef, sku: item.sku, stampVariantId: autoStamp.id,
          cantidadRequerida: cantidadItem * autoStamp.veces,
          ubicacion: 'codigo_sku',
        });
      }
      continue;
    }

    sinReceta.push({
      itemRef, sku: item.sku,
      motivo: product ? 'producto_sin_receta_ni_codigo' : 'sku_sin_receta_ni_codigo',
      detalle: 'No se encontro receta ni codigo de estampa dentro del SKU/nombre del item',
    });
  }
  return { consumos, sinReceta };
}

async function suggestStampsForProduct(db, productNombre, limit = 5) {
  const words = (productNombre || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
  if (words.length === 0) return [];
  const r = await db.query(`
    select sv.id, sv.codigo, sv.nombre, d.codigo_prefijo as diseno_principal
    from stamp_variants sv left join stamp_designs d on d.id = sv.design_id
  `);
  const scored = r.rows.map(s => {
    const hay = (s.nombre + ' ' + s.codigo + ' ' + (s.diseno_principal || '')).toLowerCase();
    const score = words.reduce((acc, w) => acc + (hay.includes(w) ? 1 : 0), 0);
    return { ...s, score };
  }).filter(s => s.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

module.exports = { resolveConsumptionForOrderItems, suggestStampsForProduct, getActiveRecipesForProduct, findProductBySku, extractStampCodeCandidates, extractStampCodeOccurrences };
