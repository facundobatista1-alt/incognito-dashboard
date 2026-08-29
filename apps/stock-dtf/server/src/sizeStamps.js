'use strict';

const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
const SPECIAL_PREFIXES = new Map([
  ['AM', 'Amiri'],
  ['BP', 'Bape'],
  ['CH', 'Chrome'],
  ['CZ', 'Corteiz'],
  ['DS', 'Diesel'],
  ['HB', 'Boss'],
  ['JD', 'Jordan'],
  ['NK', 'Nike'],
  ['SP', 'Supreme'],
  ['ST', 'Stussy'],
  ['TS', 'Trapstar'],
]);

const BRAND_PREFIX_HINTS = [
  ['AM', /\bAMIRI\b/],
  ['BP', /\bBAPE\b/],
  ['CH', /\bCHROME\b/],
  ['CZ', /\b(CORTEIZ|CORT)\b/],
  ['DS', /\b(DIESEL|DIE)\b/],
  ['HB', /\b(BOSS|HUGO)\b/],
  ['JD', /\b(JORDAN|JOR|FLIGHT|FLI)\b/],
  ['NK', /\b(NIKE|NIK|NK)\b/],
  ['SP', /\bSUPREME\b/],
  ['ST', /\bSTUSSY\b/],
  ['TS', /\bTRAPSTAR\b/],
];

function normalizeSize(value) {
  const raw = String(value || '').toUpperCase().trim();
  if (!raw) return '';
  const direct = raw.replace(/^TALLE\s+/, '').replace(/^SIZE\s+/, '');
  if (SIZES.includes(direct)) return direct;
  const match = raw.match(/(?:^|[^A-Z0-9])(XXL|XL|L|M|S)(?:[^A-Z0-9]|$)/);
  return match ? match[1] : '';
}

function extractSize(item, product) {
  return normalizeSize(
    item.talle || item.talle_tamano || item.size || item.tamano || item.variante ||
    product?.variante || item.nombre || item.name || product?.nombre || item.sku
  );
}

function extractPrefix(value) {
  const raw = String(value || '').toUpperCase();
  const dashed = raw.match(/(?:^|[^A-Z])([A-Z]{2})-\d/);
  if (dashed) return dashed[1];
  const start = raw.match(/^([A-Z]{2})(?:[^A-Z]|$)/);
  return start ? start[1] : '';
}

function extractStampPrefix(item, product, recipeRows = []) {
  const explicit = item.estampa_codigo || item.codigo_estampa || item.stampCode || item.stamp_code || item.codigo;
  const fromExplicit = extractPrefix(explicit);
  if (fromExplicit) return fromExplicit;
  const fromRecipe = extractPrefix(recipeRows[0]?.estampa_codigo);
  if (fromRecipe) return fromRecipe;
  const fromSku = extractPrefix(item.sku || product?.sku || product?.nombre || item.nombre);
  if (fromSku) return fromSku;
  const text = [
    item.nombre, item.name, item.titulo, item.title, item.sku,
    product?.nombre, product?.variante, product?.sku,
  ].map((v) => String(v || '').toUpperCase()).join(' ');
  const hint = BRAND_PREFIX_HINTS.find(([, re]) => re.test(text));
  return hint ? hint[0] : '';
}

function sizeStampCode(prefix, size) {
  if (!prefix || !size) return '';
  return SPECIAL_PREFIXES.has(prefix) ? `${prefix}-${size}` : `TALLE-${size}`;
}

async function findSizeStamp(db, code) {
  if (!code) return null;
  const r = await db.query('select id, codigo from stamp_variants where codigo=$1', [code]);
  return r.rows[0] || null;
}

module.exports = {
  SIZES,
  SPECIAL_PREFIXES,
  extractSize,
  extractStampPrefix,
  sizeStampCode,
  findSizeStamp,
};
