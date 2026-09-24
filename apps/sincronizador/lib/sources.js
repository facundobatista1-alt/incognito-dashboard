'use strict';
// Lectura de datos para la conciliacion. SOLO LECTURA: todas las llamadas
// son GET. Usa las mismas credenciales que ya carga Ventas en este proceso
// (VENTAS_SUPABASE_*, TIENDANUBE_*), sin variables nuevas.

const { splitVariantValues } = require('./mapping');

const SUPABASE_URL = () => (process.env.VENTAS_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = () => process.env.VENTAS_SUPABASE_SERVICE_ROLE_KEY || '';
const PAGE_SIZE = 1000;
// Pedidos abiertos de Tiendanube mas viejos que esto no se cuentan como
// pendientes: un pedido real sin cargar en Ventas por mas tiempo es raro,
// y los despachados viejos pueden seguir "open" en Tiendanube.
const TN_OPEN_ORDER_MAX_AGE_DAYS = 15;

function configStatus() {
  const missing = [];
  if (!SUPABASE_URL()) missing.push('VENTAS_SUPABASE_URL');
  if (!SUPABASE_KEY()) missing.push('VENTAS_SUPABASE_SERVICE_ROLE_KEY');
  if (!process.env.TIENDANUBE_STORE_ID) missing.push('TIENDANUBE_STORE_ID');
  if (!process.env.TIENDANUBE_ACCESS_TOKEN) missing.push('TIENDANUBE_ACCESS_TOKEN');
  return { ok: missing.length === 0, missing };
}

async function supabaseGetAll(pathname) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const response = await fetch(`${SUPABASE_URL()}/rest/v1/${pathname}`, {
      headers: {
        apikey: SUPABASE_KEY(),
        Authorization: `Bearer ${SUPABASE_KEY()}`,
        'Range-Unit': 'items',
        Range: `${from}-${from + PAGE_SIZE - 1}`
      }
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Supabase ${pathname.split('?')[0]} respondio HTTP ${response.status}: ${JSON.stringify(data).slice(0, 200)}`);
    }
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function supabaseWrite(pathname, method, body) {
  const response = await fetch(`${SUPABASE_URL()}/rest/v1/${pathname}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY(),
      Authorization: `Bearer ${SUPABASE_KEY()}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Supabase ${pathname.split('?')[0]} respondio HTTP ${response.status}: ${detail.slice(0, 200)}`);
  }
}

// Productos de Tiendanube que el usuario elimino del reporte (por ejemplo,
// liquidaciones que nunca se van a cargar en Stock). Unica tabla en la que
// escribe el sincronizador; no toca prendas ni Tiendanube.
async function loadIgnored() {
  return supabaseGetAll('sincronizador_ignorados?select=tn_product_id,product_name,sku,created_at&order=created_at.desc');
}

async function addIgnored({ productId, productName = '', sku = '' }) {
  await supabaseWrite('sincronizador_ignorados?on_conflict=tn_product_id', 'POST', {
    tn_product_id: String(productId),
    product_name: String(productName).slice(0, 300),
    sku: String(sku).slice(0, 120)
  });
}

async function removeIgnored(productId) {
  await supabaseWrite(`sincronizador_ignorados?tn_product_id=eq.${encodeURIComponent(String(productId))}`, 'DELETE');
}

async function loadPrendas() {
  return supabaseGetAll('prendas?select=id,sku,modelo,categoria,talle,color,stock,discontinuado&order=id.asc');
}

// Ventas guarda los pedidos en ventas_records (guardado por fila) o en el
// JSON unico de ventas_app_state, segun VENTAS_ROW_STORAGE_ENABLED. Se lee
// del mismo lado que lee Ventas.
async function loadVentas() {
  const rowStorage = process.env.VENTAS_ROW_STORAGE_ENABLED === 'true';
  let orders;
  let backupStoreNumbers;
  let printedGarments;
  if (rowStorage) {
    orders = (await supabaseGetAll('ventas_records?collection=eq.orders&select=data&order=record_id.asc'))
      .map((row) => row.data || {});
    backupStoreNumbers = (await supabaseGetAll('ventas_records?collection=eq.backupRows&select=n:data->>storeOrderNumber&order=record_id.asc'))
      .map((row) => row.n);
    // Sin imageUrl: puede ser una foto pesada y no hace falta.
    printedGarments = await supabaseGetAll('ventas_records?collection=eq.printedGarments&select=sku:data->>sku,size:data->>size,color:data->>color,usedAt:data->>usedAt,usedOrderId:data->>usedOrderId&order=record_id.asc');
  } else {
    const stateId = encodeURIComponent(process.env.APP_STATE_ID || 'default');
    const table = process.env.VENTAS_SUPABASE_STATE_TABLE || 'ventas_app_state';
    const rows = await supabaseGetAll(`${table}?id=eq.${stateId}&select=orders:state->orders,backupRows:state->backupRows,printedGarments:state->printedGarments`);
    const row = rows[0] || {};
    orders = Array.isArray(row.orders) ? row.orders : [];
    backupStoreNumbers = (Array.isArray(row.backupRows) ? row.backupRows : []).map((item) => item.storeOrderNumber);
    printedGarments = Array.isArray(row.printedGarments) ? row.printedGarments : [];
  }

  const knownStoreOrders = new Set();
  const remember = (value) => {
    const text = String(value || '').trim();
    if (text) knownStoreOrders.add(text);
  };
  orders.forEach((order) => {
    remember(order.storeOrderNumber);
    remember(order.storeOrderId);
  });
  backupStoreNumbers.forEach(remember);
  return { orders, knownStoreOrders, rowStorage, printedGarments };
}

function tnHeaders() {
  return {
    Authentication: `bearer ${process.env.TIENDANUBE_ACCESS_TOKEN}`,
    'User-Agent': `IncognitoSincronizador/${process.env.TIENDANUBE_CLIENT_ID || 'local'} (facundobatista1@gmail.com)`
  };
}

async function tnGetAllPages(resource, params) {
  const all = [];
  for (let page = 1; page <= 50; page += 1) {
    const query = new URLSearchParams({ ...params, per_page: '200', page: String(page) });
    const url = `https://api.tiendanube.com/v1/${process.env.TIENDANUBE_STORE_ID}/${resource}?${query}`;
    const response = await fetch(url, { headers: tnHeaders() });
    // Tiendanube responde 404 al pedir una pagina despues de la ultima.
    if (response.status === 404 && page > 1) break;
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Tiendanube ${resource} respondio HTTP ${response.status}: ${JSON.stringify(data).slice(0, 200)}`);
    }
    const items = Array.isArray(data) ? data : [];
    all.push(...items);
    if (items.length < 200) break;
  }
  return all;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Pedido a una sola variante, reintentando si Tiendanube responde 429
// (limite de ~2 pedidos por segundo).
async function tnVariantRequest(productId, variantId, options = {}) {
  const url = `https://api.tiendanube.com/v1/${process.env.TIENDANUBE_STORE_ID}/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`;
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, {
      ...options,
      headers: { ...tnHeaders(), 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    if (response.status === 429 && attempt < 4) {
      await wait(1000 * (attempt + 1));
      continue;
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Tiendanube respondio HTTP ${response.status}: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return data;
  }
}

function variantStock(variant) {
  if (!variant || variant.stock_management === false || variant.stock === null || variant.stock === undefined) return null;
  return Number(variant.stock);
}

async function readVariantStock(productId, variantId) {
  return variantStock(await tnVariantRequest(productId, variantId));
}

// UNICA escritura en Tiendanube: cambia solo el stock de una variante.
async function writeVariantStock(productId, variantId, stock) {
  return variantStock(await tnVariantRequest(productId, variantId, {
    method: 'PUT',
    body: JSON.stringify({ stock })
  }));
}

async function logChange(row) {
  await supabaseWrite('sincronizador_cambios', 'POST', {
    tn_product_id: String(row.productId),
    tn_variant_id: String(row.variantId),
    product_name: String(row.productName || '').slice(0, 300),
    sku: String(row.sku || '').slice(0, 120),
    talle: String(row.talle || '').slice(0, 40),
    color: String(row.color || '').slice(0, 60),
    stock_antes: Number.isFinite(row.before) ? row.before : null,
    stock_nuevo: Number.isFinite(row.after) ? row.after : null,
    estado: row.status,
    detalle: String(row.detail || '').slice(0, 500)
  });
}

async function loadChanges(limit = 200) {
  return supabaseGetAll(`sincronizador_cambios?select=*&order=created_at.desc&limit=${limit}`);
}

function localized(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.es || value.en || value.pt || '';
}

// Variantes de productos VISIBLES, aplanadas. stock null = infinito.
async function loadTiendanubeVariants() {
  const products = await tnGetAllPages('products', { published: 'true' });
  const variants = [];
  for (const product of products) {
    if (product.published === false) continue;
    const attributeNames = (product.attributes || []).map(localized);
    for (const variant of product.variants || []) {
      const { talle, color } = splitVariantValues((variant.values || []).map(localized), attributeNames);
      variants.push({
        productId: product.id,
        productName: localized(product.name),
        variantId: variant.id,
        sku: variant.sku || '',
        talle,
        color,
        stock: variantStock(variant)
      });
    }
  }
  return { products: products.length, variants };
}

// Pedidos abiertos recientes, sin despachar. Los que ya estan en Ventas se
// descartan despues, en reconcile(), con knownStoreOrders.
async function loadTiendanubeOpenOrders() {
  const since = new Date(Date.now() - TN_OPEN_ORDER_MAX_AGE_DAYS * 86400000).toISOString();
  const orders = await tnGetAllPages('orders', { status: 'open', created_at_min: since });
  return orders
    .filter((order) => !['shipped', 'fulfilled', 'delivered'].includes(String(order.shipping_status || '').toLowerCase()))
    .map((order) => ({
      id: order.id,
      number: order.number,
      paymentStatus: order.payment_status || '',
      shippingStatus: order.shipping_status || '',
      createdAt: order.created_at || '',
      items: (order.products || []).map((product) => {
        const { talle, color } = splitVariantValues(product.variant_values || []);
        return {
          sku: product.sku || '',
          talle,
          color,
          quantity: Math.max(1, Number(product.quantity || 1))
        };
      })
    }));
}

async function loadAll() {
  const [prendas, ventas, tn, tnOpenOrders, ignored] = await Promise.all([
    loadPrendas(),
    loadVentas(),
    loadTiendanubeVariants(),
    loadTiendanubeOpenOrders(),
    loadIgnored()
  ]);
  return {
    prendas,
    ignored,
    ignoredProductIds: new Set(ignored.map((row) => String(row.tn_product_id))),
    ventasOrders: ventas.orders,
    printedGarments: ventas.printedGarments,
    knownStoreOrders: ventas.knownStoreOrders,
    rowStorage: ventas.rowStorage,
    tnProducts: tn.products,
    tnVariants: tn.variants,
    tnOpenOrders
  };
}

module.exports = {
  configStatus,
  loadAll,
  loadIgnored,
  addIgnored,
  removeIgnored,
  readVariantStock,
  writeVariantStock,
  logChange,
  loadChanges,
  wait
};
