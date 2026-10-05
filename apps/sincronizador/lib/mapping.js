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
  // Igual que Ventas: los pantalones 3D son modelos distintos (Linea,
  // Microfibra, Baggy) y no se matchean por prefijo/sufijo.
  if (requested.startsWith('pan') && requested.endsWith('3d')) return false;
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
    // Remera clasica con estampa 3D: misma remera lisa que las DTF.
    'rem-clas-3d': 'Rem-Clas-Dtf',
    'pan-sst-ad': 'PAN-SST-AD',
    'pantalon-sst': 'PAN-SST-AD',
    'pantalon-sst-ad': 'PAN-SST-AD',
    'pantalon-sst-adidas': 'PAN-SST-AD'
  };
  if (aliases[key]) return [aliases[key]];
  // Remeras 3D por marca (Rem-PM-3d, Rem-AD-3d, ...) son remera clasica.
  // Las Dri-FIT (Rem-Dfnk-3d, Rem-Dfad-3d) siguen yendo a la Dry Fit 3D.
  if (key.startsWith('rem-') && key.endsWith('-3d') && !key.startsWith('rem-df')) return ['Rem-Clas-Dtf'];
  if (key === 'con-tech-nk') return ['Camp-Tech-Nk', 'Pan-Tech-Nk'];
  if (key === 'con-sst-ad') return ['Camp-Sst-Ad', 'Pan-Sst-Ad'];
  if (key === 'con-camp-3d') return ['Camp-Clas-3D', 'Pan-Bag-Dtf'];
  if (key.startsWith('con-') && key.endsWith('-dtf')) return ['Buz-Cang-Dtf', 'Pan-Bag-Dtf'];
  if (key.startsWith('pan-') && key.endsWith('-dtf')) return ['Pan-Bag-Dtf'];
  // Baggys 3D (Pan-Bag-3D, Pan-BagNk-3D, ...) se hacen sobre la baggy lisa.
  if (key.startsWith('pan-bag') && key.endsWith('-3d')) return ['Pan-Bag-Dtf'];
  // Bermudas 3D (Ber_Clas_3D, ...) son la misma bermuda lisa que las DTF.
  if (key.startsWith('ber') && key.endsWith('-3d')) return ['Ber-Clas-Dtf'];
  if (key.startsWith('buz-') && key.endsWith('-dtf')) return ['Buz-Cang-Dtf'];
  return [String(sku || '').trim()];
}

// Conjunto remera + bermuda 3D (Con-BerR-3d, ...): color "A/B" = remera A y
// bermuda B; un solo color = las dos de ese color. La remera es la clasica,
// que va en infinito: se descuenta pero no limita el stock del conjunto
// (lo que manda es la bermuda).
// Con-<MARCA>-3d (Con-PM-3d, Con-BerR-3d, ...). Con-Camp-3D es otra cosa
// (campera + baggy) y se resuelve aparte.
function isRemeraBermudaCombo(key) {
  return key.startsWith('con-') && key.endsWith('-3d') && key !== 'con-camp-3d';
}

function splitComboColor(color = '') {
  const parts = String(color || '').split('/').map((part) => part.trim()).filter(Boolean);
  return { top: parts[0] || '', bottom: parts[1] || parts[0] || '' };
}

// SKU vendido + color -> [{ sku, color, unlimited }] de las prendas que consume.
function expandComponentSpecs(sku = '', color = '') {
  const key = canonicalSku(sku);
  if (isRemeraBermudaCombo(key)) {
    const { top, bottom } = splitComboColor(color);
    return [
      { sku: 'Rem-Clas-Dtf', color: top, unlimited: true },
      { sku: 'Ber-Clas-Dtf', color: bottom, unlimited: false }
    ];
  }
  return expandComponents(sku).map((componentSku) => ({ sku: componentSku, color, unlimited: false }));
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

// Resultado: { excluded } | { components: [{ prenda, matchType, requestedSku, unlimited }] } | { error }
// Un componente "unlimited" (remera clasica dentro de un conjunto) se
// descuenta como pendiente pero no limita el stock correcto; si no tiene
// fila en Stock se omite en vez de dar error.
function resolveComponents(prendas, sku, talle, color) {
  const components = [];
  for (const spec of expandComponentSpecs(sku, color)) {
    const match = findPrenda(prendas, spec.sku, talle, spec.color);
    if (!match.prenda) {
      if (spec.unlimited) continue;
      return { error: match.error };
    }
    if (!spec.unlimited && EXCLUDED_PRENDA_SKUS.has(canonicalSku(match.prenda.sku))) return { excluded: true };
    components.push({ ...match, requestedSku: spec.sku, unlimited: spec.unlimited });
  }
  return { components };
}

// ¿Este SKU se hace sobre remera clasica u oversize? Solo mira el SKU (no
// talle ni color), para saber si corresponde que vaya en infinito aunque
// ese talle/color no tenga fila en Stock. Los componentes que no limitan
// (remera de un conjunto) no cuentan.
function isExcludedSku(prendas, sku) {
  return expandComponentSpecs(sku).filter((spec) => !spec.unlimited).map((spec) => spec.sku).some((componentSku) => {
    const wanted = normalizeText(componentSku);
    const exact = prendas.filter((prenda) => normalizeText(prenda.sku) === wanted);
    const candidates = exact.length ? exact : prendas.filter((prenda) => sameStockFamily(componentSku, prenda.sku));
    return candidates.some((prenda) => EXCLUDED_PRENDA_SKUS.has(canonicalSku(prenda.sku)));
  });
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
  isExcludedSku,
  splitVariantValues
};
