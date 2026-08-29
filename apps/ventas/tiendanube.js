'use strict';
/**
 * tiendanube.js
 * Capa de integración con la API REST de Tiendanube.
 *
 * Responsabilidades:
 *  - Intercambio OAuth (exchangeCode)
 *  - Consulta de pedidos al API (fetchOrders)
 *  - Normalización al formato interno de la app (normalizeOrder)
 *  - Filtrado según reglas de importación (fetchAndNormalizeOrders)
 */

const https = require('https');

// ── Tasas de comisión por cuenta (igual que en app.js) ────────────────────────
const COMMISSION = { FB: 9.8, MV: 9.8, EG: 0, AD: 0, Flux: 0 };

// ── Envíos equivalentes a "Flux" (moto / mensajería local) ───────────────────
const FLUX_KEYWORDS = ['flux', 'moto', 'mensajeria local', 'mensajero', 'motoboy', 'local'];


// ═══════════════════════════════════════════════════════════════════════════════
// Helpers de HTTP (sin dependencias externas)
// ═══════════════════════════════════════════════════════════════════════════════

function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path    : parsed.pathname + parsed.search,
      method  : 'GET',
      headers
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try   { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function httpPost(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const body    = JSON.stringify(payload);
    const parsed  = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path    : parsed.pathname,
      method  : 'POST',
      headers : {
        'Content-Type'  : 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers
      }
    };
    const req = https.request(options, (res) => {
      let b = '';
      res.on('data', chunk => { b += chunk; });
      res.on('end', () => {
        try   { resolve({ status: res.statusCode, data: JSON.parse(b) }); }
        catch { resolve({ status: res.statusCode, data: b }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpPut(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const body    = JSON.stringify(payload);
    const parsed  = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path    : parsed.pathname,
      method  : 'PUT',
      headers : {
        'Content-Type'  : 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers
      }
    };
    const req = https.request(options, (res) => {
      let b = '';
      res.on('data', chunk => { b += chunk; });
      res.on('end', () => {
        try   { resolve({ status: res.statusCode, data: JSON.parse(b) }); }
        catch { resolve({ status: res.statusCode, data: b }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function apiHeaders() {
  const { TIENDANUBE_ACCESS_TOKEN, TIENDANUBE_CLIENT_ID } = process.env;
  return {
    'Authentication': `bearer ${TIENDANUBE_ACCESS_TOKEN}`,
    'User-Agent': `UsticApp/${TIENDANUBE_CLIENT_ID || 'local'} (facundobatista1@gmail.com)`
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// Helpers de normalización de strings
// ═══════════════════════════════════════════════════════════════════════════════

function normalize(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}


// ═══════════════════════════════════════════════════════════════════════════════
// OAuth
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Intercambia el código de autorización por un access token.
 * Retorna el objeto completo de Tiendanube: { access_token, token_type, scope, user_id }
 *
 * Referencia: https://dev.tiendanube.com/docs/authentication
 */
function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function findNestedValue(source, keyPatterns, valuePattern = null) {
  const seen = new Set();
  const stack = [source];

  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      current.forEach((item) => stack.push(item));
      continue;
    }

    for (const [key, value] of Object.entries(current)) {
      const normalizedKey = normalize(key);
      const keyMatches = keyPatterns.some((pattern) => normalizedKey.includes(pattern));
      if (keyMatches && value !== null && value !== undefined && typeof value !== 'object') {
        const text = String(value).trim();
        if (text && (!valuePattern || valuePattern.test(text))) return text;
      }
      if (value && typeof value === 'object') stack.push(value);
    }
  }

  return '';
}

function findNestedObject(source, keyPatterns) {
  const seen = new Set();
  const stack = [source];

  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      current.forEach((item) => stack.push(item));
      continue;
    }

    for (const [key, value] of Object.entries(current)) {
      const normalizedKey = normalize(key);
      const keyMatches = keyPatterns.some((pattern) => normalizedKey.includes(pattern));
      if (keyMatches && value && typeof value === 'object') return value;
      if (value && typeof value === 'object') stack.push(value);
    }
  }

  return null;
}

function extractCustomerEmail(tnOrder, customer = {}) {
  return firstNonEmpty(
    tnOrder.contact_email,
    tnOrder.email,
    tnOrder.customer_email,
    tnOrder.billing_email,
    tnOrder.shipping_email,
    customer.email,
    tnOrder.billing_address?.email,
    tnOrder.shipping_address?.email,
    findNestedValue(tnOrder, ['email', 'mail'], /^[^\s@]+@[^\s@]+\.[^\s@]+$/i)
  );
}

function extractPickupDetails(tnOrder) {
  return tnOrder.shipping_pickup_details ||
    tnOrder.pickup_details ||
    tnOrder.pickup_point ||
    tnOrder.shipping_pickup_point ||
    tnOrder.shipping_option_reference ||
    findNestedObject(tnOrder, ['pickup', 'sucursal', 'branch', 'agency', 'punto']);
}

function extractCustomerDocument(tnOrder, customer = {}) {
  const value = firstNonEmpty(
    tnOrder.customer_document,
    tnOrder.contact_identification,
    tnOrder.contact_document,
    tnOrder.billing_document,
    tnOrder.billing_address?.document,
    tnOrder.billing_address?.dni,
    tnOrder.billing_address?.identification,
    tnOrder.shipping_address?.document,
    tnOrder.shipping_address?.dni,
    customer.document,
    customer.dni,
    customer.identification,
    customer.identification_number,
    customer.tax_id,
    customer.cuit,
    findNestedValue(tnOrder, ['dni', 'document', 'identification', 'tax', 'cuit', 'cuil'], /\d{6,}/)
  );
  return String(value || '').replace(/\D/g, '');
}

async function exchangeCode(code) {
  const { TIENDANUBE_CLIENT_ID, TIENDANUBE_CLIENT_SECRET } = process.env;

  if (!TIENDANUBE_CLIENT_ID || !TIENDANUBE_CLIENT_SECRET) {
    throw new Error(
      'Faltan TIENDANUBE_CLIENT_ID o TIENDANUBE_CLIENT_SECRET en .env. ' +
      'Completalos antes de usar el flujo OAuth.'
    );
  }

  const { status, data } = await httpPost(
    'https://www.tiendanube.com/apps/authorize/token',
    {
      client_id    : TIENDANUBE_CLIENT_ID,
      client_secret: TIENDANUBE_CLIENT_SECRET,
      grant_type   : 'authorization_code',
      code
    }
  );

  if (status !== 200 || data.error) {
    throw new Error(
      data.error_description || data.error ||
      `Tiendanube devolvió HTTP ${status}`
    );
  }

  return data; // { access_token, token_type, scope, user_id }
}


// ═══════════════════════════════════════════════════════════════════════════════
// Fetch de pedidos al API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Trae los pedidos abiertos de la tienda desde el API de Tiendanube.
 * Requiere TIENDANUBE_STORE_ID y TIENDANUBE_ACCESS_TOKEN en .env.
 *
 * Referencia: https://dev.tiendanube.com/docs/resources/order
 */
async function fetchOrders() {
  const { TIENDANUBE_STORE_ID, TIENDANUBE_ACCESS_TOKEN } = process.env;

  if (!TIENDANUBE_STORE_ID || !TIENDANUBE_ACCESS_TOKEN) {
    throw new Error(
      'Faltan TIENDANUBE_STORE_ID o TIENDANUBE_ACCESS_TOKEN en .env. ' +
      'Completá el flujo OAuth o cargalos manualmente.'
    );
  }

  const baseUrl = `https://api.tiendanube.com/v1/${TIENDANUBE_STORE_ID}/orders`;
  const allOrders = [];
  const seen = new Set();

  // Los pedidos "abonar al recibir" pueden quedar abiertos varios dias y salir
  // de los ultimos 50. Recorremos varias paginas para no perderlos.
  for (let page = 1; page <= 6; page += 1) {
    const url = `${baseUrl}?per_page=50&page=${page}&status=open`;
    const data = await fetchOrdersFromUrl(url);

    for (const order of data) {
      const key = String(order?.id || order?.number || '').trim();
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      allOrders.push(order);
    }

    if (data.length < 50) break;
  }

  return allOrders;
}

async function fetchOrdersLegacySinglePage() {
  const { TIENDANUBE_STORE_ID, TIENDANUBE_ACCESS_TOKEN } = process.env;

  if (!TIENDANUBE_STORE_ID || !TIENDANUBE_ACCESS_TOKEN) {
    throw new Error(
      'Faltan TIENDANUBE_STORE_ID o TIENDANUBE_ACCESS_TOKEN en .env. ' +
      'Completá el flujo OAuth o cargalos manualmente.'
    );
  }

  // Traemos los ultimos pedidos abiertos (no cancelados), hasta 50 por pagina.
  // Para paginación extendida habría que recorrer el header Link de la respuesta.
  const url = `https://api.tiendanube.com/v1/${TIENDANUBE_STORE_ID}/orders?per_page=50&status=open`;

  const { status, data } = await httpGet(url, apiHeaders());

  if (status === 401) throw new Error('Token inválido o vencido. Renovalo con el flujo OAuth.');
  if (status === 404) throw new Error('Store ID incorrecto o sin acceso.');
  if (status !== 200) throw new Error(`Tiendanube API respondió HTTP ${status}.`);
  if (!Array.isArray(data)) {
    throw new Error(`Respuesta inesperada: ${JSON.stringify(data).slice(0, 200)}`);
  }

  return data;
}

async function fetchOrdersFromUrl(url) {
  const { status, data } = await httpGet(url, apiHeaders());
  if (status === 401) throw new Error('Token invalido o vencido. Renovalo con el flujo OAuth.');
  if (status === 404) throw new Error('Store ID incorrecto o sin acceso.');
  if (status !== 200) throw new Error(`Tiendanube API respondio HTTP ${status}.`);
  if (!Array.isArray(data)) {
    throw new Error(`Respuesta inesperada: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

function sameStoreOrderNumber(order, storeOrderNumber) {
  const wanted = String(storeOrderNumber || '').trim();
  return Boolean(wanted) && (
    String(order?.number || '').trim() === wanted ||
    String(order?.id || '').trim() === wanted
  );
}

async function fetchOrderByNumber(storeOrderNumber) {
  const { TIENDANUBE_STORE_ID, TIENDANUBE_ACCESS_TOKEN } = process.env;
  const number = String(storeOrderNumber || '').trim();

  if (!TIENDANUBE_STORE_ID || !TIENDANUBE_ACCESS_TOKEN) {
    throw new Error('Faltan TIENDANUBE_STORE_ID o TIENDANUBE_ACCESS_TOKEN en .env.');
  }
  if (!number) throw new Error('Falta el numero de orden de Tienda Nube.');

  const baseUrl = `https://api.tiendanube.com/v1/${TIENDANUBE_STORE_ID}/orders`;
  const candidateUrls = [
    `${baseUrl}?per_page=50&q=${encodeURIComponent(number)}`,
    `${baseUrl}?per_page=50&number=${encodeURIComponent(number)}`,
    `${baseUrl}?per_page=50&status=open`,
    `${baseUrl}?per_page=50&status=closed`,
    `${baseUrl}?per_page=50&status=cancelled`,
    `${baseUrl}?per_page=50`
  ];

  for (const url of candidateUrls) {
    let orders = [];
    try {
      orders = await fetchOrdersFromUrl(url);
    } catch (error) {
      if (/token|store id/i.test(error.message)) throw error;
      continue;
    }
    const match = orders.find((order) => sameStoreOrderNumber(order, number));
    if (match) return match;
  }

  for (let page = 2; page <= 10; page += 1) {
    const orders = await fetchOrdersFromUrl(`${baseUrl}?per_page=50&page=${page}`);
    const match = orders.find((order) => sameStoreOrderNumber(order, number));
    if (match) return match;
    if (orders.length < 50) break;
  }

  return null;
}

async function fulfillOrder(orderId, options = {}) {
  const { TIENDANUBE_STORE_ID, TIENDANUBE_ACCESS_TOKEN } = process.env;
  const id = String(orderId || '').trim();
  const trackingNumber = String(options.trackingNumber || options.shipping_tracking_number || '').trim();
  const trackingUrl = String(options.trackingUrl || options.shipping_tracking_url || '').trim();

  if (!TIENDANUBE_STORE_ID || !TIENDANUBE_ACCESS_TOKEN) {
    throw new Error('Faltan TIENDANUBE_STORE_ID o TIENDANUBE_ACCESS_TOKEN para avisar el envio.');
  }
  if (!id) throw new Error('Falta el ID interno de Tienda Nube.');
  if (!trackingNumber) throw new Error('Falta el codigo de seguimiento.');

  const payload = {
    shipping_tracking_number: trackingNumber,
    notify_customer: options.notifyCustomer !== false
  };
  if (trackingUrl) payload.shipping_tracking_url = trackingUrl;

  const { status, data } = await httpPost(
    `https://api.tiendanube.com/v1/${TIENDANUBE_STORE_ID}/orders/${encodeURIComponent(id)}/fulfill`,
    payload,
    apiHeaders()
  );

  if (status === 401) throw new Error('Token invalido o vencido. Renovalo con el flujo OAuth.');
  if (status === 404) throw new Error('No encontre ese pedido en Tienda Nube.');
  if (status < 200 || status >= 300) {
    const detail = typeof data === 'string'
      ? data
      : data?.description || data?.message || data?.error || JSON.stringify(data).slice(0, 200);
    throw new Error(`Tiendanube respondio HTTP ${status}${detail ? `: ${detail}` : ''}`);
  }

  return data;
}

async function updateOrderOwnerNote(orderId, note) {
  const { TIENDANUBE_STORE_ID, TIENDANUBE_ACCESS_TOKEN } = process.env;
  const id = String(orderId || '').trim();
  const noteText = String(note || '').trim();

  if (!TIENDANUBE_STORE_ID || !TIENDANUBE_ACCESS_TOKEN) {
    throw new Error('Faltan TIENDANUBE_STORE_ID o TIENDANUBE_ACCESS_TOKEN para escribir la nota.');
  }
  if (!id) throw new Error('Falta el ID interno de Tienda Nube.');
  if (!noteText) throw new Error('Falta la nota para Tienda Nube.');

  const url = `https://api.tiendanube.com/v1/${TIENDANUBE_STORE_ID}/orders/${encodeURIComponent(id)}`;
  const current = await httpGet(url, apiHeaders());
  if (current.status === 401) throw new Error('Token invalido o vencido. Renovalo con el flujo OAuth.');
  if (current.status === 404) throw new Error('No encontre ese pedido en Tienda Nube.');
  if (current.status < 200 || current.status >= 300) {
    const detail = typeof current.data === 'string'
      ? current.data
      : current.data?.description || current.data?.message || current.data?.error || JSON.stringify(current.data).slice(0, 200);
    throw new Error(`Tiendanube respondio HTTP ${current.status}${detail ? `: ${detail}` : ''}`);
  }

  const existingNote = String(current.data?.owner_note || '').trim();
  const nextNote = existingNote
    ? (existingNote.toLowerCase().includes(noteText.toLowerCase()) ? existingNote : `${existingNote}\n${noteText}`)
    : noteText;

  const { status, data } = await httpPut(url, { owner_note: nextNote }, apiHeaders());
  if (status === 401) throw new Error('Token invalido o vencido. Renovalo con el flujo OAuth.');
  if (status === 404) throw new Error('No encontre ese pedido en Tienda Nube.');
  if (status < 200 || status >= 300) {
    const detail = typeof data === 'string'
      ? data
      : data?.description || data?.message || data?.error || JSON.stringify(data).slice(0, 200);
    throw new Error(`Tiendanube respondio HTTP ${status}${detail ? `: ${detail}` : ''}`);
  }

  return data;
}

async function fetchProduct(productId) {
  const { TIENDANUBE_STORE_ID } = process.env;
  if (!productId) return null;
  const url = `https://api.tiendanube.com/v1/${TIENDANUBE_STORE_ID}/products/${productId}`;
  const { status, data } = await httpGet(url, apiHeaders());
  if (status !== 200 || !data || typeof data !== 'object') return null;
  return data;
}


// ═══════════════════════════════════════════════════════════════════════════════
// Detección de medio de pago
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detecta el medio de pago de una orden de Tiendanube.
 * Retorna: 'Mercado Pago' | 'Transferencia' | 'Abonar al recibir'
 *
 * Tiendanube expone varios campos según el gateway utilizado:
 *   - payment_provider_id: slug del proveedor (ej. "mercadopago")
 *   - payment_method: método específico (ej. "credit_card", "cash", "bank_transfer")
 *   - payment_details: objeto con info adicional del gateway
 *
 * ⚠️  Ajustá los valores de payment_provider_id según los gateways activos
 *      en tu tienda. Podés ver los valores reales en los pedidos de prueba.
 */
function detectPaymentMethod(tnOrder) {
  const shippingCompany = detectShippingCompany(tnOrder);
  const gatewayField = normalize(tnOrder.gateway || '');
  const gateway  = normalize(tnOrder.payment_provider_id || '');
  const method   = normalize(tnOrder.payment_method      || '');
  const details  = normalize(JSON.stringify(tnOrder.payment_details || {}));
  const paymentText = normalize([
    tnOrder.gateway_name,
    tnOrder.payment_name,
    tnOrder.payment_option,
    tnOrder.payment_description,
    tnOrder.gateway,
    tnOrder.payment_provider_id,
    tnOrder.payment_method,
    JSON.stringify(tnOrder.payment_details || {})
  ].filter(Boolean).join(' '));
  // ── Mercado Pago ────────────────────────────────────────────────
  if (
    gatewayField.includes('mercado-pago') ||
    gatewayField.includes('mercadopago') ||
    gatewayField.includes('mercado') ||
    gateway.includes('mercadopago') ||
    gateway.includes('mercado') ||
    method.includes('mercadopago') ||
    details.includes('mercadopago')
  ) return 'Mercado Pago';

  // ── Abonar al recibir (cash on delivery) ────────────────────────
  if (
    method === 'cash_on_delivery' ||
    paymentText.includes('abona al recibir') ||
    paymentText.includes('abonar al recibir') ||
    paymentText.includes('pago personalizado en efectivo') ||
    paymentText.includes('personalizado efectivo') ||
    paymentText.includes('efectivo') ||
    paymentText.includes('cash') ||
    method.includes('contra entrega') ||
    method.includes('abonar') ||
    method.includes('efectivo al recibir') ||
    gateway.includes('cash_on_delivery') ||
    (gatewayField === 'offline' && method === 'custom' && isCashOnDeliveryShipping(shippingCompany))
  ) return 'Abonar al recibir';

  // ── Transferencia bancaria ───────────────────────────────────────
  if (
    method === 'bank_transfer' ||
    method.includes('transferencia') ||
    method.includes('bank') ||
    gateway.includes('transferencia') ||
    gateway.includes('bank_transfer') ||
    details.includes('transferencia')
  ) return 'Transferencia';

  // Fallback seguro: tratamos como Transferencia (requiere revisión manual)
  return 'Transferencia';
}


// ═══════════════════════════════════════════════════════════════════════════════
// Detección de empresa de envío
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detecta la empresa de envío de una orden de Tiendanube.
 *
 * Tiendanube expone:
 *   - shipping_option: nombre de la opción de envío elegida por el cliente
 *   - shipping_carrier_name: nombre del transportista (disponible en algunas integraciones)
 *   - shipping_pickup_details: si es retiro en sucursal
 */
function detectShippingCompany(tnOrder) {
  const option   = normalize(tnOrder.shipping_option       || '');
  const carrier  = normalize(tnOrder.shipping_carrier_name || '');
  const combined = carrier || option;

  if (FLUX_KEYWORDS.some(k => combined.includes(k)))        return 'Flux';
  if (combined.includes('andreani'))                        return 'Andreani';
  if (combined.includes('correo argentino') ||
      combined.includes('correo arg'))                      return 'Correo Argentino';
  if (combined.includes('via cargo') ||
      combined.includes('viacargo'))                        return 'Via Cargo';
  if (combined.includes('oca'))                             return 'OCA';
  if (combined.includes('retiro') ||
      combined.includes('pickup'))                          return 'Retiro a puerta';

  // Devolvemos el string original (con capitalización) si no matcheó nada
  return tnOrder.shipping_carrier_name || tnOrder.shipping_option || 'Sin definir';
}

function isFluxEquivalent(shippingCompany) {
  return FLUX_KEYWORDS.some(k => normalize(shippingCompany).includes(k));
}

function isAndreaniShipping(shippingCompany) {
  return normalize(shippingCompany).includes('andreani');
}

function isCashOnDeliveryShipping(shippingCompany) {
  return isFluxEquivalent(shippingCompany) || isAndreaniShipping(shippingCompany);
}


// ═══════════════════════════════════════════════════════════════════════════════
// Extracción de color y talle desde variantes
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Intenta extraer color y talle de las variantes del primer producto.
 *
 * Tiendanube retorna variantes con un array "values" donde cada elemento
 * tiene { es: "Negro", en: "Black" } y el nombre del atributo en
 * product.variant.product.attributes[i].es / .en.
 *
 * Como la estructura puede variar por versión de API, usamos heurísticas
 * sobre los nombres de los valores.
 */
function extractVariantFields(firstProduct) {
  let color = '';
  let size  = '';

  const variant    = firstProduct.variant || {};
  const varValues  = variant.values || [];
  const attributes = (variant.product?.attributes) || (firstProduct.product?.attributes) || [];
  const assignVariantValue = (value) => {
    const val = String(value || '').trim();
    if (!val) return;
    if (looksLikeSize(val)) {
      if (!size) size = val;
      return;
    }
    if (!color) color = val;
  };

  // Si hay atributos con nombre, los usamos para asignar por tipo
  if (attributes.length > 0 && varValues.length > 0) {
    attributes.forEach((attr, i) => {
      const attrName = normalize(attr.es || attr.en || '');
      const val      = varValues[i]?.es || varValues[i]?.en || '';

      if (looksLikeSize(val)) {
        size = val;
      } else if (attrName.includes('color')) {
        color = val;
      } else if (['talle', 'talla', 'size', 'talles'].some(k => attrName.includes(k))) {
        assignVariantValue(val);
      } else {
        assignVariantValue(val);
      }
    });
  } else {
    // Sin metadatos de atributos: asignamos por heurística de valores
    varValues.forEach((v) => assignVariantValue(v.es || v.en || ''));
  }

  // Fallback: leer directamente de firstProduct si la API los pone ahí
  if (!color) color = firstProduct.color || '';
  if (!size)  size  = firstProduct.size  || '';

  return { color, size };
}

function looksLikeSize(value) {
  const normalized = normalize(value)
    .replace(/\./g, '')
    .replace(/\s+/g, ' ');
  return [
    'xs',
    's',
    'm',
    'l',
    'xl',
    'xxl',
    '2xl',
    'xxxl',
    '3xl',
    'unico',
    'unica',
    'sin talle',
    'aleatorio',
    'doble',
    'doble xl'
  ].includes(normalized);
}

function firstText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return '';
  return value.src || value.url || value.es || value.en || value.pt || value.original || '';
}

function firstImageUrl(images) {
  if (!Array.isArray(images)) return '';
  const image = images.find(Boolean);
  return firstText(image?.src) || firstText(image?.url) || firstText(image);
}

function extractProductImage(product) {
  const candidates = [
    firstText(product.image?.src),
    firstText(product.image?.url),
    firstText(product.image),
    firstText(product.image_url),
    firstText(product.thumbnail),
    firstText(product.thumbnail_url),
    firstText(product.featured_image?.src),
    firstText(product.featured_image?.url),
    firstText(product.featured_image),
    firstText(product.variant?.image?.src),
    firstText(product.variant?.image?.url),
    firstText(product.variant?.image),
    firstImageUrl(product.images),
    firstImageUrl(product.variant?.images),
    firstImageUrl(product.variant?.product?.images),
    firstImageUrl(product.product?.images)
  ];
  return candidates.find(Boolean) || '';
}

function productImageFromApi(product, productDetails) {
  if (!productDetails) return '';
  const variantId = String(product.variant_id || product.variant?.id || '');
  const variant = (productDetails.variants || []).find((item) => String(item.id) === variantId);
  const imageId = variant?.image_id || variant?.image?.id;
  const images = productDetails.images || [];
  const image = images.find((item) => String(item.id) === String(imageId)) || images[0];
  return firstText(image?.src) || firstText(image?.url) || firstText(image);
}

function normalizeProductItem(product, productDetails = null) {
  const variant = extractVariantFields(product);
  const parsed = extractVariantFromName(product.name || '');
  return {
    sourceItemId: firstNonEmpty(product.id, product.line_item_id, product.product_variant_id, product.variant_id, product.product_id),
    sku: String(product.sku || product.product_id || ''),
    name: cleanProductName(product.name || ''),
    color: variant.color || parsed.color,
    size: variant.size || parsed.size,
    purchasePrice: 0,
    salePrice: Number(product.price || 0),
    quantity: Number(product.quantity || 1),
    imageUrl: extractProductImage(product) || productImageFromApi(product, productDetails)
  };
}

function moneyNumber(value) {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? number : 0;
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function orderProductNetTotal(tnOrder, shippingCost) {
  const orderTotal = moneyNumber(tnOrder.total);
  if (orderTotal <= 0) return 0;
  return Math.max(0, orderTotal - moneyNumber(shippingCost));
}

function applyOrderDiscountToItems(items, tnOrder, shippingCost) {
  const grossProductsTotal = (items || []).reduce((sum, item) => {
    return sum + moneyNumber(item.salePrice) * moneyNumber(item.quantity || 1);
  }, 0);
  const netProductsTotal = orderProductNetTotal(tnOrder, shippingCost);

  if (grossProductsTotal <= 0 || netProductsTotal <= 0) return items;
  if (netProductsTotal >= grossProductsTotal - 0.01) return items;

  const ratio = netProductsTotal / grossProductsTotal;
  return items.map((item) => ({
    ...item,
    originalSalePrice: moneyNumber(item.salePrice),
    salePrice: roundMoney(moneyNumber(item.salePrice) * ratio)
  }));
}

function splitRepeatedProductItems(items) {
  return (items || []).flatMap((item) => {
    const quantity = Number(item.quantity || 1);
    if (!Number.isInteger(quantity) || quantity <= 1) return [item];
    return Array.from({ length: quantity }, () => ({
      ...item,
      quantity: 1
    }));
  });
}

function extractVariantFromName(name) {
  const match = String(name || '').match(/\(([^)]+)\)\s*$/);
  if (!match) return { color: '', size: '' };

  const parts = match[1].split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 1) {
    const value = parts[0];
    return looksLikeSize(value) ? { color: '', size: value } : { color: value, size: '' };
  }

  const sizePart = parts.find(looksLikeSize);
  const colorPart = parts.find((part) => part !== sizePart) || '';
  return {
    color: colorPart,
    size: sizePart || ''
  };
}

function cleanProductName(name) {
  return String(name || '').replace(/\s*\([^)]+\)\s*$/, '').trim();
}


// ═══════════════════════════════════════════════════════════════════════════════
// Función principal de normalización
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Transforma un pedido de Tiendanube al formato interno de la app.
 *
 * Reglas de importación:
 *  - Cancelados → ignorar
 *  - Mercado Pago solo si el pago está aprobado (paid / authorized)
 *  - Transferencia → siempre importar (queda para revisión manual)
 *  - Abonar al recibir → solo si el envío es Flux o moto mensajería
 *  - Abonar al recibir + otro envío → ignorar
 *
 * Reglas de cuenta:
 *  - Mercado Pago → accountSettings.mercadoPago (FB o MV)
 *  - Transferencia → accountSettings.transfer (EG o AD)
 *  - Abonar al recibir → siempre Flux
 *
 * @param {Object} tnOrder        - Pedido tal como lo devuelve el API de Tiendanube
 * @param {Object} accountSettings - { mercadoPago: 'FB'|'MV', transfer: 'EG'|'AD' }
 * @returns {Object|null}          - Pedido normalizado o null si debe ignorarse
 */
function normalizeOrder(tnOrder, accountSettings = { mercadoPago: 'FB', transfer: 'EG' }, productDetailsById = {}, options = {}) {

  // ── 1. Filtrar cancelados ────────────────────────────────────────────────────
  const orderStatus = normalize(tnOrder.status || '');
  if ((orderStatus === 'cancelled' || orderStatus === 'cancelado') && !options.includeCancelled) return null;

  // ── 2. Detectar medio de pago y estado del pago ──────────────────────────────
  const paymentMethod = detectPaymentMethod(tnOrder);
  const paymentStatus = normalize(tnOrder.payment_status || '');
  const isPaid = paymentStatus === 'paid' || paymentStatus === 'authorized';
  const paymentDetails = tnOrder.payment_details || {};
  const paymentGatewayId = firstNonEmpty(
    tnOrder.gateway_id,
    tnOrder.payment_id,
    tnOrder.transaction_id,
    paymentDetails.gateway_id,
    paymentDetails.payment_id,
    paymentDetails.transaction_id,
    paymentDetails.id,
    findNestedValue(paymentDetails, ['gateway_id', 'payment_id', 'transaction_id', 'payment', 'transaction'], /\d{4,}/)
  );
  const paymentGatewayLink = firstNonEmpty(
    tnOrder.gateway_link,
    paymentDetails.gateway_link,
    paymentDetails.payment_link,
    paymentDetails.link,
    paymentDetails.url
  );

  // ── 3. Detectar empresa de envío ─────────────────────────────────────────────
  const shippingCompany = detectShippingCompany(tnOrder);
  const shippingOption = firstNonEmpty(tnOrder.shipping_option, tnOrder.shipping_carrier_name);
  const shippingPickupDetails = extractPickupDetails(tnOrder);

  // ── 4. Aplicar reglas de importación ────────────────────────────────────────
  if (!options.forceImport && paymentMethod === 'Mercado Pago' && !isPaid) {
    return null; // Solo MP aprobado
  }
  if (!options.forceImport && paymentMethod === 'Abonar al recibir' && !isCashOnDeliveryShipping(shippingCompany)) {
    return null; // Cash-on-delivery solo con Flux / moto o Andreani
  }

  // ── 5. Asignar cuenta y comisión ─────────────────────────────────────────────
  let account;
  if (paymentMethod === 'Abonar al recibir') account = 'Flux';
  else if (paymentMethod === 'Mercado Pago') account = accountSettings.mercadoPago;
  else                                       account = accountSettings.transfer;

  const commissionRate = COMMISSION[account] ?? 0;
  const invoice = paymentMethod === 'Mercado Pago' ? 'Pendiente de facturacion' : 'No';

  // ── 6. Extraer datos del producto (primer ítem del pedido) ───────────────────
  const products = tnOrder.products || [];
  let items = splitRepeatedProductItems(
    products.map((product) => normalizeProductItem(product, productDetailsById[String(product.product_id || '')]))
  );
  let firstItem = items[0] || {
    sku: '',
    name: '',
    color: '',
    size: '',
    purchasePrice: 0,
    salePrice: 0,
    quantity: 1,
    imageUrl: ''
  };

  // ── 7. Extraer datos del cliente ─────────────────────────────────────────────
  const customer     = tnOrder.customer || {};
  const customerName = [customer.name, customer.surname].filter(Boolean).join(' ').trim()
                    || customer.email
                    || 'Sin nombre';
  const customerEmail = extractCustomerEmail(tnOrder, customer);
  const customerDocument = extractCustomerDocument(tnOrder, customer);
  const customerPhone = tnOrder.contact_phone
                    || customer.phone
                    || customer.mobile
                    || tnOrder.shipping_phone
                    || tnOrder.billing_phone
                    || tnOrder.shipping_address?.phone
                    || tnOrder.billing_address?.phone
                    || tnOrder.shipping_address?.mobile
                    || tnOrder.billing_address?.mobile
                    || '';

  // ── 8. Extraer datos de envío ────────────────────────────────────────────────
  const address      = tnOrder.shipping_address || {};
  const postalCode   = String(address.zipcode   || '');
  const fullAddress = [
    address.address,
    address.street,
    address.street_name,
    address.name,
    address.address1,
    address.line1,
    address.description,
    tnOrder.shipping_address_text,
    tnOrder.shipping_address
  ].filter((value) => typeof value === 'string' && value.trim()).join(' ').trim();
  const shippingAddress = {
    street: address.address || address.street || address.street_name || address.name || address.address1 || address.line1 || '',
    number: address.number || address.street_number || address.address_number || address.streetNumber || '',
    floor: address.floor || address.piso || '',
    apartment: address.apartment || address.unit || address.departamento || address.depto || '',
    unit: address.unit || '',
    door: address.door || address.puerta || '',
    businessName: address.business_name || address.company || address.local || address.store || '',
    addressNote: address.note || address.notes || address.comments || address.observations || address.extra || '',
    city: address.city || address.city_name || address.locality || address.locality_name || '',
    locality: address.locality || address.locality_name || '',
    neighborhood: address.neighborhood || address.barrio || address.district || address.area || address.suburb || (address.city ? address.locality : '') || '',
    barrio: address.barrio || address.neighborhood || address.district || address.area || address.suburb || (address.city ? address.locality : '') || '',
    province: address.province || address.state || address.state_name || '',
    fullAddress,
    postalCode
  };
  // Tiendanube puede tener shipping_cost_owner (pagado por la tienda)
  // o shipping_cost_customer (pagado por el cliente); usamos el total visible
  const shippingCost = Number(
    tnOrder.shipping_cost_owner ?? tnOrder.shipping_cost_customer ?? 0
  );
  items = applyOrderDiscountToItems(items, tnOrder, shippingCost);
  firstItem = items[0] || firstItem;

  // ── 9. Número de orden ───────────────────────────────────────────────────────
  // tnOrder.number es el número de tienda (ej. 1047)
  // tnOrder.id es el ID interno de Tiendanube
  const storeOrderNumber = String(tnOrder.number || tnOrder.id);

  // ── 10. Notas ────────────────────────────────────────────────────────────────
  const customerNotes = tnOrder.note || '';
  const purchasedAt = tnOrder.created_at || tnOrder.completed_at || tnOrder.paid_at || tnOrder.updated_at || '';

  // ── Resultado normalizado ────────────────────────────────────────────────────
  return {
    storeOrderId: String(tnOrder.id || ''),
    storeOrderNumber,
    customer    : customerName,
    customerPhone,
    customerEmail,
    customerDocument,
    purchasedAt,
    sku: firstItem.sku,
    color: firstItem.color,
    size: firstItem.size,
    purchasePrice : firstItem.purchasePrice,
    salePrice: firstItem.salePrice,
    quantity: firstItem.quantity,
    imageUrl: firstItem.imageUrl,
    items,
    shippingValue : shippingCost,
    shippingCompany,
    shippingOption,
    shippingAddress,
    shippingPickupType   : tnOrder.shipping_pickup_type    || null,
    shippingPickupDetails,
    salesChannel  : 'Tienda Nube',
    account,
    postalCode,
    invoice,
    commissionRate,
    paymentMethod,
    paymentGatewayId,
    paymentGatewayLink,
    paymentStatus : isPaid ? 'aprobado' : 'pendiente',
    customerNotes,
    externalNotes: '',
    internalNotes: '',
    notes: '',
    storeStatus   : tnOrder.status || '',
    status        : options.forceStatus || (paymentMethod === 'Mercado Pago' ? 'preparacion' : 'definir')
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// Función principal exportada
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Trae y normaliza los pedidos de Tiendanube listos para la app.
 * @param {Object} accountSettings - { mercadoPago: 'FB'|'MV', transfer: 'EG'|'AD' }
 * @returns {Promise<Object[]>}    - Array de pedidos normalizados (sin nulls)
 */
async function fetchAndNormalizeOrders(accountSettings) {
  const rawOrders = await fetchOrders();
  const productIds = [
    ...new Set(
      rawOrders
        .flatMap(order => order.products || [])
        .map(product => String(product.product_id || ''))
        .filter(Boolean)
    )
  ];
  const productDetailsById = {};

  await Promise.all(productIds.map(async (productId) => {
    productDetailsById[productId] = await fetchProduct(productId);
  }));

  const normalized = rawOrders
    .map(order => normalizeOrder(order, accountSettings, productDetailsById))
    .filter(Boolean); // quita los null (cancelados, reglas no cumplidas)

  return normalized;
}

async function fetchAndNormalizeOrderByNumber(storeOrderNumber, accountSettings) {
  const rawOrder = await fetchOrderByNumber(storeOrderNumber);
  if (!rawOrder) return null;

  const productIds = [
    ...new Set(
      (rawOrder.products || [])
        .map(product => String(product.product_id || ''))
        .filter(Boolean)
    )
  ];
  const productDetailsById = {};

  await Promise.all(productIds.map(async (productId) => {
    productDetailsById[productId] = await fetchProduct(productId);
  }));

  return normalizeOrder(rawOrder, accountSettings, productDetailsById, {
    includeCancelled: true,
    forceImport: true,
    forceStatus: 'definir'
  });
}


module.exports = {
  exchangeCode,
  fetchOrders,
  fulfillOrder,
  updateOrderOwnerNote,
  fetchAndNormalizeOrderByNumber,
  fetchAndNormalizeOrders,
  normalizeOrder,       // exportado para testing unitario
  detectPaymentMethod,  // exportado para testing unitario
  detectShippingCompany // exportado para testing unitario
};
