'use strict';
// Traduce un SKU de Tiendanube a las prendas lisas de `prendas` de las que
// esta hecho. Replica las mismas reglas que ya usa Ventas para descontar
// stock (apps/ventas/public/app.js: stockSkuAlias, expandStockItem,
// expandPendingProductItem; apps/ventas/server.js: findStockPrendaDirect,
// sameStockFamily). Si se agrega un conjunto nuevo en Ventas, hay que
// agregarlo tambien aca.

// Prendas lisas cuyo producto en Tiendanube va siempre en infinito: el
// sincronizador no las revisa.
const EXCLUDED_PRENDA_SKUS = new Set(['rem-clas-dtf', 'over-clas-dtf']);

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

function canonicalSku(value = '') {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function compactSku(value = '') {
  return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

function normalizeColor(value = '') {
  const normalized = normalizeText(value);
  const aliases = { gris: 'melange', gray: 'melange', grey: 'melange' };
  return aliases[normalized] || normalized;
}

function normalizeTalle(value = '') {
  return normalizeText(value).replace(/\./g, '').replace(/\s+/g, ' ');
}

function sameStockFamily(requestedSku = '', stockSku = '') {
  const requested = compactSku(requestedSku);
  const stored = compactSku(stockSku);
  if (requested.length < 5 || stored.length < 5) return false;
  const prefix = requested.slice(0, 3);
  const suffix3 = requested.slice(-3);
  const suffix2 = requested.slice(-2);
  return stored.startsWith(prefix) && (stored.endsWith(suffix3) || stored.endsWith(suffix2));
}

// SKU vendido -> SKUs de las prendas que consume (1 unidad de cada una).
function expandComponents(sku = '') {
  const key = canonicalSku(sku);
  const aliases = {
    'pan-bag-3d': 'Pan-Bag-Dtf',
    'pan-sst-ad': 'PAN-SST-AD',
    'pantalon-sst': 'PAN-SST-AD',
    'pantalon-sst-ad': 'PAN-SST-AD',
    'pantalon-sst-adidas': 'PAN-SST-AD'
  };
  if (aliases[key]) return [aliases[key]];
  if (key === 'con-tech-nk') return ['Camp-Tech-Nk', 'Pan-Tech-Nk'];
  if (key === 'con-sst-ad') return ['Camp-Sst-Ad', 'Pan-Sst-Ad'];
  if (key === 'con-camp-3d') return ['Camp-Clas-3D', 'Pan-Bag-Dtf'];
  if (key.startsWith('con-') && key.endsWith('-dtf')) return ['Buz-Cang-Dtf', 'Pan-Bag-Dtf'];
  if (key.startsWith('pan-') && key.endsWith('-dtf')) return ['Pan-Bag-Dtf'];
  // Baggys 3D (Pan-Bag-3D, Pan-BagNk-3D, ...) se hacen sobre la baggy lisa.
  if (key.startsWith('pan-bag') && key.endsWith('-3d')) return ['Pan-Bag-Dtf'];
  if (key.startsWith('buz-') && key.endsWith('-dtf')) return ['Buz-Cang-Dtf'];
  return [String(sku || '').trim()];
}

// Busca la fila de `prendas` para un SKU de componente + talle + color,
// primero exacto y despues por familia (igual que findStockPrendaDirect).
function findPrenda(prendas, sku, talle, color) {
  const wantedSku = normalizeText(sku);
  const wantedTalle = normalizeTalle(talle);
  const wantedColor = normalizeColor(color);
  if (!wantedSku || !wantedTalle) return { error: 'Falta SKU o talle.' };

  const sameVariant = (prenda) =>
    normalizeTalle(prenda.talle) === wantedTalle &&
    (!wantedColor || normalizeColor(prenda.color) === wantedColor);

  const exact = prendas.filter((prenda) => normalizeText(prenda.sku) === wantedSku && sameVariant(prenda));
  if (exact.length === 1) return { prenda: exact[0], matchType: 'direct' };
  if (exact.length > 1) return { error: `Hay ${exact.length} prendas para ${sku} ${talle} (falta color).` };

  const family = prendas.filter((prenda) => sameStockFamily(sku, prenda.sku) && sameVariant(prenda));
  if (family.length === 1) return { prenda: family[0], matchType: 'family' };
  if (family.length > 1) return { error: `Hay ${family.length} prendas compatibles con ${sku} ${talle} ${color}.` };
  return { error: `No hay prenda para ${sku} ${talle}${color ? ` ${color}` : ''}.` };
}

// Resultado: { excluded } | { components: [{ prenda, matchType, requestedSku }] } | { error }
function resolveComponents(prendas, sku, talle, color) {
  const components = [];
  for (const componentSku of expandComponents(sku)) {
    const match = findPrenda(prendas, componentSku, talle, color);
    if (!match.prenda) return { error: match.error };
    if (EXCLUDED_PRENDA_SKUS.has(canonicalSku(match.prenda.sku))) return { excluded: true };
    components.push({ ...match, requestedSku: componentSku });
  }
  return { components };
}

const SIZE_VALUES = new Set(['xs', 's', 'm', 'l', 'xl', 'xxl', '2xl', 'xxxl', '3xl', 'unico', 'unica', 'sin talle']);

function looksLikeSize(value) {
  return SIZE_VALUES.has(normalizeTalle(value));
}

// Separa talle y color de una lista de valores de variante, usando los
// nombres de atributo si estan (["Color","Talle"]) o, si no, la heuristica
// de talles conocidos (igual que extractVariantFields en tiendanube.js).
function splitVariantValues(values = [], attributeNames = []) {
  let talle = '';
  let color = '';
  values.forEach((raw, index) => {
    const value = String(raw || '').trim();
    if (!value) return;
    const attr = normalizeText(attributeNames[index] || '');
    if (looksLikeSize(value) || ['talle', 'talla', 'size'].some((k) => attr.includes(k))) {
      if (!talle) talle = value;
    } else if (!color) {
      color = value;
    }
  });
  return { talle, color };
}

module.exports = {
  EXCLUDED_PRENDA_SKUS,
  normalizeText,
  canonicalSku,
  normalizeColor,
  normalizeTalle,
  sameStockFamily,
  expandComponents,
  findPrenda,
  resolveComponents,
  splitVariantValues
};
