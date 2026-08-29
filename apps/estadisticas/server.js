'use strict';

require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3050);
const APP_BASE_URL = String(process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const TIENDANUBE_AUTH_BASE = String(process.env.TIENDANUBE_AUTH_BASE || 'https://www.tiendanube.com').replace(/\/$/, '');
// ESTADISTICAS_APP_PASSWORD (no APP_PASSWORD) para no pisar la de Stock DTF
// en el mismo proceso del panel unificado.
const APP_PASSWORD = String(process.env.ESTADISTICAS_APP_PASSWORD || '');
const COOKIE_SECRET = String(process.env.COOKIE_SECRET || process.env.ESTADISTICAS_TIENDANUBE_CLIENT_SECRET || 'estadisticas-local-dev');

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false }));

const money = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const dateOnly = (value) => new Date(value).toISOString().slice(0, 10);
const dayMs = 24 * 60 * 60 * 1000;
const envPath = path.join(__dirname, '.env');
const oauthStates = new Set();
const productCache = new Map();
const statsCache = new Map();
const statsCacheTtlMs = Number(process.env.STATS_CACHE_TTL_MS || 6 * 60 * 60 * 1000);
const statsCacheDir = process.env.STATS_CACHE_DIR || path.join(__dirname, '.cache', 'stats');
const productCacheDir = process.env.PRODUCT_CACHE_DIR || path.join(__dirname, '.cache', 'products');
const productCacheTtlMs = Number(process.env.PRODUCT_CACHE_TTL_MS || 7 * 24 * 60 * 60 * 1000);
const statsBuildsInFlight = new Map();
const cashOnDeliveryPaymentNeedles = [
  'efectivo',
  'cash',
  'abonar',
  'recibir',
  'kbga',
  'contra entrega',
  'contrareembolso',
  'contra reembolso'
];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlPage(title, body) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, sans-serif; background: #f7f5fb; color: #081c3a; }
    main { width: min(620px, calc(100vw - 32px)); background: #fff; border: 1px solid #e3ddf7; border-radius: 16px; box-shadow: 0 18px 50px rgba(29, 18, 68, .12); padding: 32px; }
    h1 { margin: 0 0 12px; font-size: 28px; }
    p { line-height: 1.5; color: #40516f; }
    a, code { color: #5f35c9; }
    .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 24px; }
    .button { display: inline-block; padding: 12px 16px; border-radius: 10px; background: #6f42d8; color: white; text-decoration: none; font-weight: 700; }
    .secondary { background: #edf7f8; color: #0b6370; }
  </style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function statsCacheFile(cacheKey) {
  const safeName = crypto.createHash('sha1').update(cacheKey).digest('hex');
  return path.join(statsCacheDir, `${safeName}.json`);
}

function productCacheFile(cacheKey) {
  const safeName = crypto.createHash('sha1').update(cacheKey).digest('hex');
  return path.join(productCacheDir, `${safeName}.json`);
}

async function readStatsCacheRecord(cacheKey) {
  const memory = statsCache.get(cacheKey);
  if (memory) return { ...memory, stale: Date.now() - memory.createdAt >= statsCacheTtlMs };

  try {
    const raw = await fs.readFile(statsCacheFile(cacheKey), 'utf8');
    const cached = JSON.parse(raw);
    if (!cached?.createdAt || !cached.payload) return null;
    statsCache.set(cacheKey, { createdAt: cached.createdAt, payload: cached.payload });
    return { createdAt: cached.createdAt, payload: cached.payload, stale: Date.now() - cached.createdAt >= statsCacheTtlMs };
  } catch {
    return null;
  }
}

async function readStatsCache(cacheKey) {
  const cached = await readStatsCacheRecord(cacheKey);
  return cached && !cached.stale ? cached.payload : null;
}

async function writeStatsCache(cacheKey, payload) {
  const record = { createdAt: Date.now(), payload };
  statsCache.set(cacheKey, record);
  try {
    await fs.mkdir(statsCacheDir, { recursive: true });
    await fs.writeFile(statsCacheFile(cacheKey), JSON.stringify(record), 'utf8');
  } catch (error) {
    console.warn(`No se pudo guardar cache de estadisticas: ${error.message}`);
  }
}

async function readProductCache(cacheKey) {
  if (productCache.has(cacheKey)) return productCache.get(cacheKey);
  try {
    const raw = await fs.readFile(productCacheFile(cacheKey), 'utf8');
    const cached = JSON.parse(raw);
    if (!cached?.createdAt || Date.now() - cached.createdAt >= productCacheTtlMs) return undefined;
    productCache.set(cacheKey, cached.product ?? null);
    return cached.product ?? null;
  } catch {
    return undefined;
  }
}

async function writeProductCache(cacheKey, product) {
  productCache.set(cacheKey, product ?? null);
  try {
    await fs.mkdir(productCacheDir, { recursive: true });
    await fs.writeFile(productCacheFile(cacheKey), JSON.stringify({ createdAt: Date.now(), product: product ?? null }), 'utf8');
  } catch (error) {
    console.warn(`No se pudo guardar cache de producto: ${error.message}`);
  }
}

function oauthCallbackUrl() {
  return `${APP_BASE_URL}/auth/tiendanube/callback`;
}

function cookieValue(req, name) {
  const raw = String(req.headers.cookie || '');
  return raw
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1) || '';
}

function signSessionToken(value) {
  return crypto.createHmac('sha256', COOKIE_SECRET).update(value).digest('hex');
}

function sessionToken() {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${stamp}.${signSessionToken(stamp)}`;
}

function isValidSessionToken(token) {
  const [stamp, signature] = String(token || '').split('.');
  if (!stamp || !signature) return false;
  const expected = signSessionToken(stamp);
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function isPublicPath(pathname) {
  return pathname === '/login'
    || pathname === '/logout'
    || pathname.startsWith('/auth/tiendanube/')
    || pathname === '/healthz';
}

function requireAppPassword(req, res, next) {
  if (!APP_PASSWORD || isPublicPath(req.path)) {
    next();
    return;
  }

  if (isValidSessionToken(cookieValue(req, 'estadisticas_session'))) {
    next();
    return;
  }

  if (req.path.startsWith('/api/') || req.path.endsWith('.csv')) {
    res.status(401).json({ success: false, error: 'No autorizado' });
    return;
  }

  res.redirect((req.baseUrl || '') + '/login');
}

function loginPage(error = '') {
  return htmlPage(
    'Ingresar',
    `<h1>Estadisticas Nube</h1>
    <p>Ingresa la clave compartida para abrir el panel.</p>
    ${error ? `<p style="color:#b42318">${escapeHtml(error)}</p>` : ''}
    <form method="post" action="login" style="display:grid; gap:14px; margin-top:20px">
      <input name="password" type="password" autofocus placeholder="Clave" style="font:inherit; padding:13px 14px; border:1px solid #c9c1e8; border-radius:10px">
      <button class="button" type="submit" style="border:0; cursor:pointer">Entrar</button>
    </form>`
  );
}

async function persistEnvValues(values) {
  let existing = '';
  try {
    existing = await fs.readFile(envPath, 'utf8');
  } catch (error) {
    try {
      existing = await fs.readFile(path.join(__dirname, '.env.example'), 'utf8');
    } catch {
      existing = '';
    }
  }

  const lines = existing.split(/\r?\n/);
  const used = new Set();
  const next = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match || !Object.prototype.hasOwnProperty.call(values, match[1])) return line;
    used.add(match[1]);
    return `${match[1]}=${values[match[1]]}`;
  });

  for (const [key, value] of Object.entries(values)) {
    if (!used.has(key)) next.push(`${key}=${value}`);
  }

  await fs.writeFile(envPath, next.join('\n').replace(/\n{3,}/g, '\n\n'), 'utf8');
  Object.assign(process.env, values);
}

async function exchangeTiendanubeCode(code) {
  const clientId = process.env.ESTADISTICAS_TIENDANUBE_CLIENT_ID;
  const clientSecret = process.env.ESTADISTICAS_TIENDANUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Faltan el ID de aplicacion o el secreto del cliente en el archivo .env.');
  }

  const response = await fetch(`${TIENDANUBE_AUTH_BASE}/apps/authorize/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': `EstadisticasLocal/${clientId} (${process.env.APP_CONTACT_EMAIL || 'local@example.com'})`
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code
    })
  });

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { message: text };
  }

  if (!response.ok) {
    throw new Error(payload.message || payload.error_description || payload.error || `Tiendanube respondio HTTP ${response.status}`);
  }

  if (!payload.access_token) {
    throw new Error('Tiendanube no devolvio un access_token.');
  }

  return payload;
}

app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

app.get('/login', (req, res) => {
  if (!APP_PASSWORD) {
    res.redirect((req.baseUrl || '') + '/');
    return;
  }
  res.send(loginPage());
});

app.post('/login', (req, res) => {
  if (!APP_PASSWORD) {
    res.redirect((req.baseUrl || '') + '/');
    return;
  }

  if (String(req.body.password || '') !== APP_PASSWORD) {
    res.status(401).send(loginPage('Clave incorrecta.'));
    return;
  }

  res.cookie('estadisticas_session', sessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: APP_BASE_URL.startsWith('https://'),
    path: (req.baseUrl || '') + '/',
    maxAge: 1000 * 60 * 60 * 24 * 14
  });
  res.redirect((req.baseUrl || '') + '/');
});

app.get('/logout', (req, res) => {
  res.clearCookie('estadisticas_session', { path: (req.baseUrl || '') + '/' });
  res.redirect((req.baseUrl || '') + '/login');
});

app.use(requireAppPassword);
app.use(express.static(path.join(__dirname, 'public')));

function argentinaDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value instanceof Date ? value : new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function demoOrders() {
  const today = new Date(`${argentinaDate()}T12:00:00-03:00`);
  const products = [
    ['Campera Nk Tech', 'Camperas', 'Negro', 'M', 766903, 17, 'Tech'],
    ['Campera Adidas SST - Negra', 'Camperas', 'Negro', 'L', 506256, 12, 'SST'],
    ['Campera Adidas SST - Beige', 'Camperas', 'Beige', 'XL', 445438, 11, 'SST'],
    ['Campera Adidas SST - Roja', 'Camperas', 'Rojo', 'S', 419449, 11, 'SST'],
    ['Conjunto Adidas SST', 'Conjuntos', 'Negro', 'XXL', 411069, 6, 'SST'],
    ['Remera Boxy', 'Remeras', 'Blanco', 'M', 182500, 8, 'Manga corta'],
    ['Pantalon Cargo', 'Pantalones', 'Gris', 'L', 214800, 7, 'Largos'],
    ['Gorra Chapita', 'Gorras', 'Negro', 'Unico', 84200, 4, 'Accesorios'],
    ['Buzo Oversize', 'Buzos', 'Verde', 'XL', 139900, 5, 'Oversize']
  ];
  const provinces = ['Buenos Aires', 'Capital Federal', 'Cordoba', 'Neuquen', 'Santa Fe', 'Mendoza'];
  const payments = ['Mercado Pago', 'Mercado Pago', 'Transferencia', 'Offline'];
  const shipping = ['Andreani', 'Flux', 'Correo Argentino', 'Retiro local'];
  const genders = ['mujer', 'hombre', 'mujer', 'hombre', 'mujer', 'indeterminado'];
  const orders = [];
  let id = 1900;

  for (let dayOffset = 89; dayOffset >= 0; dayOffset -= 1) {
    const weekdayPattern = [5, 7, 8, 10, 14, 18, 12];
    const weekBoost = 1 + ((89 - dayOffset) % 28) / 80;
    const recentBoost = dayOffset < 14 ? 1.2 : 1;
    const count = Math.max(1, Math.round(weekdayPattern[(89 - dayOffset) % 7] * weekBoost * recentBoost));
    for (let i = 0; i < count; i += 1) {
      const product = products[(i + dayOffset) % products.length];
      const created = new Date(today.getTime() - dayOffset * dayMs);
      created.setHours([0, 1, 8, 9, 10, 13, 14, 16, 18, 20, 21, 22][i % 12], 10 + i, 0, 0);
      const quantity = i % 5 === 0 ? 2 : 1;
      const unitPrice = product[4] / Math.max(product[5], 1);
      const orderProducts = [{
        product_id: `p-${(i + dayOffset) % products.length}`,
        name: `${product[0]} (${product[2]}, ${product[3]})`,
        category: product[1],
        subcategory: product[6],
        categories: [{ name: product[1] }, { name: product[6] }],
        price: unitPrice,
        quantity,
        sku: `${product[1].slice(0, 3).toUpperCase()}-${product[2].slice(0, 3).toUpperCase()}-${product[3]}`
      }];
      if (i % 7 === 0) {
        const second = products[(i + dayOffset + 3) % products.length];
        orderProducts.push({
          product_id: `p-${(i + dayOffset + 3) % products.length}`,
          name: `${second[0]} (${second[2]}, ${second[3]})`,
          category: second[1],
          subcategory: second[6],
          categories: [{ name: second[1] }, { name: second[6] }],
          price: second[4] / Math.max(second[5], 1),
          quantity: 1,
          sku: `${second[1].slice(0, 3).toUpperCase()}-${second[2].slice(0, 3).toUpperCase()}-${second[3]}`
        });
      }
      const subtotal = orderProducts.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0);
      orders.push({
        id: String(id += 1),
        number: id,
        created_at: created.toISOString(),
        paid_at: created.toISOString(),
        status: 'closed',
        payment_status: 'paid',
        payment_method: payments[(i + dayOffset) % payments.length],
        shipping_carrier_name: shipping[(i + 2 * dayOffset) % shipping.length],
        total: money(subtotal + 3900),
        subtotal: money(subtotal),
        shipping_cost_customer: shipping[(i + 2 * dayOffset) % shipping.length] === 'Retiro local' ? 0 : 3900,
        customer: {
          name: ['Lucia', 'Marcos', 'Sofia', 'Agustin', 'Carla', 'Tomas'][i % 6],
          age: 22 + ((i * 3 + dayOffset) % 47),
          gender: genders[i % genders.length]
        },
        shipping_address: {
          province: provinces[(i + dayOffset) % provinces.length],
          city: ['CABA', 'La Plata', 'Cordoba', 'Neuquen', 'Rosario', 'Godoy Cruz'][i % 6]
        },
        products: orderProducts
      });
    }
  }

  return orders;
}

function demoAbandonedCarts() {
  const today = new Date(`${argentinaDate()}T12:00:00-03:00`);
  const products = [
    ['Campera Nk Tech', 'Camperas', 'Negro', 'M', 45112, 'Tech'],
    ['Campera Adidas SST - Beige', 'Camperas', 'Beige', 'XL', 40494, 'SST'],
    ['Campera Adidas SST - Negra', 'Camperas', 'Negro', 'L', 42188, 'SST'],
    ['Remera Jordan', 'Remeras', 'Blanco', 'S', 28300, 'Manga corta'],
    ['Conjunto Adidas SST', 'Conjuntos', 'Negro', 'XXL', 68512, 'SST'],
    ['Pantalon Jordan Logo 3D', 'Pantalones', 'Gris', 'L', 31800, 'Largos']
  ];
  const provinces = ['Buenos Aires', 'Capital Federal', 'Cordoba', 'Neuquen', 'Santa Fe', 'Mendoza'];
  const shipping = ['Andreani a Domicilio', 'Motomensajeria (CABA y GBA) - Domicilio', 'Sin definir', 'Sucursal de Andreani'];
  const payments = ['Sin datos', 'Mercado Pago', 'Offline'];
  const genders = ['hombre', 'hombre', 'mujer', 'hombre', 'mujer', 'indeterminado'];
  return Array.from({ length: 152 }, (_, index) => {
    const created = new Date(today.getTime() - (index % 7) * dayMs);
    created.setHours([0, 1, 2, 7, 9, 11, 12, 14, 16, 18, 20, 22][index % 12], index % 60, 0, 0);
    const first = products[index % products.length];
    const second = products[(index + 2) % products.length];
    const quantity = index % 5 === 0 ? 2 : 1;
    const cartProducts = [{
      name: `${first[0]} (${first[2]}, ${first[3]})`,
      category: first[1],
      subcategory: first[5],
      categories: [{ name: first[1] }, { name: first[5] }],
      price: first[4],
      quantity,
      image_url: ''
    }];
    if (index % 4 === 0) {
      cartProducts.push({
        name: `${second[0]} (${second[2]}, ${second[3]})`,
        category: second[1],
        subcategory: second[5],
        categories: [{ name: second[1] }, { name: second[5] }],
        price: second[4],
        quantity: 1,
        image_url: ''
      });
    }
    const total = money(cartProducts.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0));
    return {
      id: `cart-${index + 1}`,
      created_at: created.toISOString(),
      total,
      items: cartProducts.reduce((sum, item) => sum + Number(item.quantity || 1), 0),
      customer_email: index % 4 === 0 ? '' : `cliente${index + 1}@mail.com`,
      customer: {
        age: 22 + ((index * 5) % 54),
        gender: genders[index % genders.length]
      },
      shipping_address: {
        province: provinces[index % provinces.length],
        city: ['CABA', 'La Plata', 'Cordoba', 'Neuquen', 'Rosario', 'Godoy Cruz'][index % 6]
      },
      shipping_carrier_name: shipping[index % shipping.length],
      payment_method: payments[index % payments.length],
      shipping_cost_customer: index % 5 === 0 ? 0 : 3900,
      products: cartProducts,
      recovered: index % 17 === 0
    };
  });
}

function apiHeaders() {
  return {
    Authentication: `bearer ${process.env.ESTADISTICAS_TIENDANUBE_ACCESS_TOKEN}`,
    'User-Agent': `EstadisticasLocal/${process.env.ESTADISTICAS_TIENDANUBE_CLIENT_ID || 'local'} (${process.env.APP_CONTACT_EMAIL || 'local@example.com'})`
  };
}

async function fetchTiendanubeOrders({ from, to }) {
  const { ESTADISTICAS_TIENDANUBE_STORE_ID, ESTADISTICAS_TIENDANUBE_ACCESS_TOKEN } = process.env;
  if (!ESTADISTICAS_TIENDANUBE_STORE_ID || !ESTADISTICAS_TIENDANUBE_ACCESS_TOKEN) return null;

  const all = [];
  const perPage = 200;
  const maxPages = 250;
  const pageFromLink = (link, rel) => {
    const match = String(link || '').match(new RegExp(`<[^>]*[?&]page=(\\d+)[^>]*>;\\s*rel="${rel}"`));
    return match ? Number(match[1]) : null;
  };
  const fetchPage = async (page) => {
    const params = new URLSearchParams({
      per_page: String(perPage),
      page: String(page),
      status: 'any',
      payment_status: 'any',
      created_at_min: `${from}T00:00:00-03:00`,
      created_at_max: `${to}T23:59:59-03:00`
    });
    const url = `https://api.tiendanube.com/v1/${ESTADISTICAS_TIENDANUBE_STORE_ID}/orders?${params}`;
    const response = await fetch(url, { headers: apiHeaders() });
    if (!response.ok) throw new Error(`Tiendanube respondio HTTP ${response.status}`);
    const batch = await response.json();
    return {
      batch: Array.isArray(batch) ? batch : [],
      link: response.headers.get('link') || ''
    };
  };

  const firstPage = await fetchPage(1);
  all.push(...firstPage.batch);
  const lastPage = Math.min(pageFromLink(firstPage.link, 'last') || (firstPage.batch.length < perPage ? 1 : maxPages), maxPages);
  const concurrency = 4;
  for (let page = 2; page <= lastPage; page += concurrency) {
    const pages = Array.from({ length: Math.min(concurrency, lastPage - page + 1) }, (_, index) => page + index);
    const results = await Promise.all(pages.map(fetchPage));
    results.forEach((result) => all.push(...result.batch));
  }
  return all;
}

async function fetchTiendanubeAbandonedCheckouts({ from, to }) {
  const { ESTADISTICAS_TIENDANUBE_STORE_ID, ESTADISTICAS_TIENDANUBE_ACCESS_TOKEN } = process.env;
  if (!ESTADISTICAS_TIENDANUBE_STORE_ID || !ESTADISTICAS_TIENDANUBE_ACCESS_TOKEN) return null;

  const all = [];
  const perPage = 200;
  const maxPages = 80;
  const fromTime = new Date(`${from}T00:00:00-03:00`).getTime();
  const toTime = new Date(`${to}T23:59:59-03:00`).getTime();
  const fetchPage = async (page) => {
    const params = new URLSearchParams({
      per_page: String(perPage),
      page: String(page),
      created_at_max: `${to}T23:59:59-03:00`
    });
    const url = `https://api.tiendanube.com/v1/${ESTADISTICAS_TIENDANUBE_STORE_ID}/checkouts?${params}`;
    const response = await fetch(url, { headers: apiHeaders() });
    if (response.status === 404) return { batch: [], link: '' };
    if (!response.ok) throw new Error(`Tiendanube checkouts respondio HTTP ${response.status}`);
    const batch = await response.json();
    return {
      batch: Array.isArray(batch) ? batch : [],
      link: response.headers.get('link') || ''
    };
  };

  for (let page = 1; page <= maxPages; page += 1) {
    const { batch } = await fetchPage(page);
    if (!batch.length) break;
    all.push(...batch);
    const oldest = batch.reduce((min, checkout) => {
      const created = new Date(checkout.created_at || checkout.updated_at || 0).getTime();
      return Number.isFinite(created) ? Math.min(min, created) : min;
    }, Number.POSITIVE_INFINITY);
    if (oldest < fromTime || batch.length < perPage) break;
  }

  return all
    .filter((checkout) => {
      const created = new Date(checkout.created_at || checkout.updated_at || 0).getTime();
      return Number.isFinite(created) && created >= fromTime && created <= toTime;
    })
    .map(normalizeAbandonedCheckout);
}

async function fetchTiendanubeAbandonedCheckoutsWithRetry(range) {
  const first = await fetchTiendanubeAbandonedCheckouts(range);
  if (Array.isArray(first) && first.length) return first;
  await new Promise((resolve) => setTimeout(resolve, 900));
  return fetchTiendanubeAbandonedCheckouts(range);
}

function normalizeAbandonedCheckout(checkout = {}) {
  return {
    ...checkout,
    total: numberValue(checkout.total || checkout.subtotal || 0),
    items: (checkout.products || []).reduce((sum, item) => sum + Number(item.quantity || 1), 0),
    customer_email: checkout.contact_email || checkout.customer_email || '',
    customer: {
      ...(checkout.customer || {}),
      name: checkout.contact_name || checkout.customer?.name || checkout.billing_name || checkout.shipping_name || '',
      identification: checkout.contact_identification || checkout.customer?.identification || ''
    },
    shipping_address: {
      ...(checkout.shipping_address && typeof checkout.shipping_address === 'object' ? checkout.shipping_address : {}),
      province: checkout.shipping_province || checkout.shipping_address?.province || checkout.billing_province || '',
      city: checkout.shipping_city || checkout.shipping_address?.city || checkout.billing_city || ''
    },
    billing_address: {
      ...(checkout.billing_address && typeof checkout.billing_address === 'object' ? checkout.billing_address : {}),
      province: checkout.billing_province || checkout.shipping_province || '',
      city: checkout.billing_city || checkout.shipping_city || ''
    },
    payment_method: checkout.payment_details?.method || checkout.gateway || checkout.gateway_id || checkout.payment_method || '',
    shipping_carrier_name: checkout.shipping_option || checkout.shipping || checkout.shipping_carrier_name || '',
    recovered: Boolean(checkout.completed_at)
  };
}

async function fetchTiendanubeProduct(productId) {
  const { ESTADISTICAS_TIENDANUBE_STORE_ID, ESTADISTICAS_TIENDANUBE_ACCESS_TOKEN } = process.env;
  if (!ESTADISTICAS_TIENDANUBE_STORE_ID || !ESTADISTICAS_TIENDANUBE_ACCESS_TOKEN || !productId) return null;
  const cacheKey = String(productId);
  const cached = await readProductCache(cacheKey);
  if (cached !== undefined) return cached;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`https://api.tiendanube.com/v1/${ESTADISTICAS_TIENDANUBE_STORE_ID}/products/${encodeURIComponent(productId)}`, {
        headers: apiHeaders()
      });
      if (response.ok) {
        const product = await response.json();
        await writeProductCache(cacheKey, product);
        return product;
      }
      if (![429, 500, 502, 503, 504].includes(response.status)) break;
    } catch (error) {
      if (attempt === 3) break;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 450));
  }

  await writeProductCache(cacheKey, null);
  return null;
}

async function enrichOrdersWithProducts(orders = [], options = {}) {
  if (options.skipProductDetails) return orders;
  const ids = [
    ...new Set(
      orders
        .flatMap((order) => order.products || [])
        .map((product) => String(product.product_id || product.id || '').trim())
        .filter(Boolean)
    )
  ];
  if (!ids.length) return orders;

  const details = new Map();
  const concurrency = 4;
  for (let index = 0; index < ids.length; index += concurrency) {
    const batch = ids.slice(index, index + concurrency);
    await Promise.all(batch.map(async (id) => {
      details.set(id, await fetchTiendanubeProduct(id).catch(() => null));
    }));
  }

  return orders.map((order) => ({
    ...order,
    products: (order.products || []).map((product) => {
      const detail = details.get(String(product.product_id || product.id || '').trim());
      if (!detail) return product;
      return {
        ...product,
        category: product.category || product.category_name || detail.category || detail.category_name,
        subcategory: product.subcategory || product.subcategory_name || detail.subcategory || detail.subcategory_name,
        categories: detail.categories?.length ? detail.categories : product.categories || [],
        variant_attributes: detail.attributes || [],
        variant_detail: (detail.variants || []).find((variant) => String(variant.id) === String(product.variant_id)) || null
      };
    })
  }));
}

function periodRange(period) {
  const today = new Date(`${argentinaDate()}T12:00:00-03:00`);
  const value = String(period || '7d').trim().toLowerCase();

  if (value === 'today') return { from: dateOnly(today), to: dateOnly(today), days: 1 };

  if (value === 'yesterday') {
    const yesterday = new Date(today.getTime() - dayMs);
    return { from: dateOnly(yesterday), to: dateOnly(yesterday), days: 1 };
  }

  const monthMatch = value.match(/^month:(\d{4})-(\d{2})$/);
  if (monthMatch) {
    const year = Number(monthMatch[1]);
    const monthIndex = Number(monthMatch[2]) - 1;
    const fromDate = new Date(Date.UTC(year, monthIndex, 1, 15, 0, 0));
    const toDate = new Date(Date.UTC(year, monthIndex + 1, 0, 15, 0, 0));
    const days = Math.max(1, Math.round((toDate - fromDate) / dayMs) + 1);
    return { from: dateOnly(fromDate), to: dateOnly(toDate), days };
  }

  const yearMatch = value.match(/^year:(\d{4})$/);
  if (yearMatch) {
    const year = Number(yearMatch[1]);
    const fromDate = new Date(Date.UTC(year, 0, 1, 15, 0, 0));
    const toDate = new Date(Date.UTC(year, 11, 31, 15, 0, 0));
    const days = Math.max(1, Math.round((toDate - fromDate) / dayMs) + 1);
    return { from: dateOnly(fromDate), to: dateOnly(toDate), days };
  }

  const customMatch = value.match(/^custom:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/);
  if (customMatch) {
    const fromDate = new Date(`${customMatch[1]}T12:00:00-03:00`);
    const toDate = new Date(`${customMatch[2]}T12:00:00-03:00`);
    const days = Math.max(1, Math.round((toDate - fromDate) / dayMs) + 1);
    return { from: dateOnly(fromDate), to: dateOnly(toDate), days };
  }

  const days = value === '14d' ? 14 : value === '30d' ? 30 : value === '90d' ? 90 : value === '365d' ? 365 : 7;
  const fromDate = new Date(today.getTime() - (days - 1) * dayMs);
  return { from: dateOnly(fromDate), to: dateOnly(today), days };
}

function localDateKey(value) {
  return argentinaDate(new Date(value));
}

function labelFromProduct(product = {}) {
  return String(localizedText(product.name_without_variants) || localizedText(product.product_name) || localizedText(product.name) || 'Producto sin nombre')
    .replace(/\s*\([^)]+\)\s*$/, '')
    .trim();
}

function localizedText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (typeof value === 'object') {
    return String(value.es || value.pt || value.en || Object.values(value).find(Boolean) || '').trim();
  }
  return '';
}

function cleanLabel(value, fallback = 'Sin dato') {
  const label = localizedText(value).replace(/\s+/g, ' ').trim();
  return label || fallback;
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedText(value) {
  return localizedText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function orderPaymentSearchText(order = {}) {
  return [
    order.gateway,
    order.gateway_name,
    order.payment_method,
    order.payment_provider_id,
    order.payment_details?.method,
    order.payment_details?.gateway,
    order.payment_details?.gateway_name,
    order.payment_details?.name,
    order.payment_details?.payment_method,
    order.payment_details?.type
  ].map(normalizedText).filter(Boolean).join(' ');
}

function internalOwnerNote(order = {}) {
  const direct = [
    order.owner_note,
    order.owner_notes,
    order.internal_note,
    order.internal_notes,
    order.admin_note,
    order.admin_notes,
    order.staff_note,
    order.staff_notes
  ].map(localizedText).filter(Boolean);
  if (direct.length) return direct.join(' ');

  if (order.extra && typeof order.extra === 'object') {
    return Object.entries(order.extra)
      .filter(([key]) => /owner|internal|admin|staff|nota|note/i.test(key))
      .map(([, value]) => localizedText(value))
      .filter(Boolean)
      .join(' ');
  }

  return '';
}

function isCashOnDeliveryPayment(order = {}) {
  const text = orderPaymentSearchText(order);
  return cashOnDeliveryPaymentNeedles.some((needle) => text.includes(needle));
}

function isLoadedCashOnDeliveryOrder(order = {}) {
  const note = internalOwnerNote(order);
  return isCashOnDeliveryPayment(order)
    && Boolean(note.trim());
}

function markLoadedCashOnDeliveryOrders(orders = []) {
  return orders.map((order) => {
    if (!isLoadedCashOnDeliveryOrder(order)) return order;
    return {
      ...order,
      __loadedCashOnDelivery: true,
      __paymentLabelOverride: 'Abonar al recibir'
    };
  });
}

function normalizeGateway(value) {
  const label = cleanLabel(value, '');
  const key = label.toLowerCase();
  const names = {
    'mercado-pago': 'Mercado Pago',
    mercadopago: 'Mercado Pago',
    offline: 'Offline',
    custom: 'Offline',
    transfer: 'Transferencia',
    transferencia: 'Transferencia'
  };
  return names[key] || label;
}

function paymentPlatformLabel(order = {}) {
  if (order.__paymentLabelOverride) return order.__paymentLabelOverride;
  return normalizeGateway(order.gateway)
    || normalizeGateway(order.gateway_name)
    || normalizeGateway(order.payment_method)
    || normalizeGateway(order.payment_provider_id)
    || 'Sin datos';
}

function paymentMethodLabel(order = {}) {
  if (order.__loadedCashOnDelivery) return 'Efectivo al recibir';
  const raw = cleanLabel(order.payment_details?.method || order.payment_method || order.gateway, '');
  const key = raw.toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ');
  const labels = {
    cash: 'Dinero en cuenta',
    wallet: 'Dinero en cuenta',
    account_money: 'Dinero en cuenta',
    'account money': 'Dinero en cuenta',
    money: 'Dinero en cuenta',
    ticket: 'Dinero en cuenta',
    bank_transfer: 'Transferencia o depósito bancario',
    'bank transfer': 'Transferencia o depósito bancario',
    transfer: 'Transferencia o depósito bancario',
    transferencia: 'Transferencia o depósito bancario',
    custom: 'Transferencia o depósito bancario',
    credit_card: 'Tarjeta de crédito',
    'credit card': 'Tarjeta de crédito',
    debit_card: 'Tarjeta de débito',
    'debit card': 'Tarjeta de débito',
    offline: 'Transferencia o depósito bancario'
  };
  if (labels[key]) return labels[key];
  if (paymentPlatformLabel(order) === 'Transferencia o depósito bancario') return 'Transferencia o depósito bancario';
  if (paymentPlatformLabel(order) === 'Offline') return 'Transferencia o depósito bancario';
  return raw || paymentPlatformLabel(order) || 'Sin método';
}

function paymentInstallmentsLabel(order = {}) {
  if (order.__loadedCashOnDelivery) return 'Sin cuotas';
  const installments = Number(order.payment_details?.installments || order.installments || 0);
  return installments > 0 ? String(installments) : 'Sin cuotas';
}

function paymentFullLabel(order = {}) {
  const platform = paymentPlatformLabel(order);
  const method = paymentMethodLabel(order);
  const installments = paymentInstallmentsLabel(order);
  const suffix = method === 'Tarjeta de crédito' && installments !== 'Sin cuotas'
    ? ` - ${installments} ${installments === '1' ? 'cuota' : 'cuotas'}`
    : '';
  return `${platform} - ${method}${suffix}`;
}

function paymentLabel(order = {}) {
  return paymentPlatformLabel(order);
}

function shippingLabel(order = {}) {
  return cleanLabel(order.shipping_option, '')
    || cleanLabel(order.shipping_carrier_name, '')
    || cleanLabel(order.shipping, '')
    || 'Sin envio';
}

function provinceLabel(record = {}) {
  return cleanLabel(
    record.shipping_address?.province
      || record.shipping_province
      || record.billing_address?.province
      || record.billing_province
      || record.customer?.billing_province,
    'Sin provincia'
  );
}

function cityLabel(record = {}) {
  return cleanLabel(
    record.shipping_address?.city
      || record.shipping_city
      || record.billing_address?.city
      || record.billing_city
      || record.customer?.billing_city,
    'Sin ciudad'
  );
}

function normalizedName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-zñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function documentValue(record = {}) {
  return record.customer?.identification
    || record.contact_identification
    || record.identification
    || record.billing_identification
    || record.customer?.document
    || record.customer?.document_number
    || record.customer?.tax_id
    || record.customer?.cuit
    || record.customer?.cuil
    || record.extra?.identification
    || record.extra?.dni
    || record.extra?.document
    || record.customer?.extra?.identification
    || record.customer?.extra?.dni
    || record.customer?.extra?.document
    || '';
}

function genderFromTaxDocument(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 11) return '';
  const prefix = digits.slice(0, 2);
  if (prefix === '20') return 'hombre';
  if (prefix === '27') return 'mujer';
  if (['30', '33', '34'].includes(prefix)) return 'indeterminado';
  return '';
}

function genderFromName(record = {}) {
  const name = normalizedName(
    record.customer?.name
      || record.contact_name
      || record.billing_name
      || record.customer?.billing_name
      || ''
  );
  if (!name) return '';

  const femaleNames = new Set([
    'abril', 'agostina', 'agustina', 'aldana', 'alejandra', 'alicia', 'alma', 'ana', 'andrea', 'angeles', 'antonella',
    'araceli', 'barbara', 'belen', 'bianca', 'brenda', 'camila', 'candela', 'carla', 'carolina', 'catalina', 'cecilia',
    'celeste', 'chiara', 'clara', 'claudia', 'constanza', 'daiana', 'daniela', 'elfina', 'eliana', 'emilia', 'florencia',
    'guadalupe', 'isabella', 'jennifer', 'jimena', 'johana', 'julieta', 'lara', 'laura', 'lucia', 'ludmila', 'lujan',
    'macarena', 'magali', 'malena', 'marcela', 'maria', 'mariana', 'martina', 'melanie', 'micaela', 'milagros', 'morena',
    'natalia', 'nayla', 'noelia', 'paola', 'paula', 'priscila', 'romina', 'rocio', 'sabrina', 'sofia', 'sol', 'stefania',
    'tamara', 'valentina', 'valeria', 'vanesa', 'victoria', 'yamila', 'yesica'
  ]);
  const maleNames = new Set([
    'agustin', 'alan', 'alejandro', 'alexis', 'andres', 'angel', 'antonio', 'ariel', 'benjamin', 'bruno', 'camilo',
    'carlos', 'cristian', 'damian', 'daniel', 'dante', 'dario', 'diego', 'eduardo', 'emanuel', 'emiliano', 'enzo',
    'esteban', 'facundo', 'federico', 'felipe', 'fernando', 'franco', 'gabriel', 'gaston', 'geronimo', 'gonzalo',
    'guillermo', 'ignacio', 'ivan', 'joaquin', 'jonathan', 'jorge', 'jose', 'juan', 'julian', 'lautaro', 'leandro',
    'leonardo', 'lucas', 'luciano', 'manuel', 'marcos', 'martin', 'matias', 'maximiliano', 'miguel', 'nahuel',
    'nicolas', 'pablo', 'pedro', 'ramiro', 'ricardo', 'rodrigo', 'santiago', 'sebastian', 'sergio', 'tomas', 'valentin'
  ]);

  const parts = name.split(' ').slice(0, 3);
  const hasFemale = parts.some((part) => femaleNames.has(part));
  const hasMale = parts.some((part) => maleNames.has(part));
  if (hasFemale && !hasMale) return 'mujer';
  if (hasMale && !hasFemale) return 'hombre';
  if (parts[0] === 'maria' && parts[1] && !['jose', 'jesus'].includes(parts[1])) return 'mujer';
  if (parts[0] === 'jose' && parts[1] && parts[1] !== 'maria') return 'hombre';
  return '';
}

function genderLabel(record = {}) {
  const raw = cleanLabel(record.customer?.gender || record.customer_gender || record.billing_address?.gender, '');
  const value = raw.toLowerCase();
  if (['m', 'masculino', 'hombre', 'male'].includes(value)) return 'hombre';
  if (['f', 'femenino', 'mujer', 'female'].includes(value)) return 'mujer';
  if (['indeterminado', 'otro', 'other'].includes(value)) return 'indeterminado';
  if (value) return raw;
  return genderFromTaxDocument(documentValue(record)) || genderFromName(record) || 'indeterminado';
}

function ageValue(record = {}) {
  const directAge = Number(
    record.customer?.age
      || record.customer_age
      || record.billing_address?.age
      || record.extra?.age
      || record.extra?.edad
      || record.customer?.extra?.age
      || record.customer?.extra?.edad
      || 0
  );
  if (directAge > 0) return directAge;

  const birthDate = record.customer?.birthdate
    || record.customer?.birthday
    || record.customer?.date_of_birth
    || record.extra?.birthdate
    || record.extra?.birthday
    || record.extra?.fecha_nacimiento
    || record.extra?.nacimiento
    || record.customer?.extra?.birthdate
    || record.customer?.extra?.birthday
    || record.customer?.extra?.fecha_nacimiento
    || record.customer?.extra?.nacimiento;
  const parsed = birthDate ? new Date(birthDate) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) {
    const today = new Date(`${argentinaDate()}T12:00:00-03:00`);
    let age = today.getFullYear() - parsed.getFullYear();
    const birthdayThisYear = new Date(today.getFullYear(), parsed.getMonth(), parsed.getDate());
    if (today < birthdayThisYear) age -= 1;
    if (age > 0 && age < 120) return age;
  }

  return estimatedAgeFromIdentification(
    record.customer?.identification
      || record.identification
      || record.billing_identification
      || record.extra?.identification
      || record.extra?.dni
      || record.customer?.extra?.identification
      || record.customer?.extra?.dni
  );
}

function estimatedAgeFromIdentification(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 8) return 0;
  const dni = Number(digits);
  if (!Number.isFinite(dni) || dni < 5_000_000 || dni > 60_000_000) return 0;

  const anchors = [
    [5_000_000, 1940],
    [10_000_000, 1952],
    [15_000_000, 1960],
    [20_000_000, 1968],
    [25_000_000, 1976],
    [30_000_000, 1983],
    [35_000_000, 1990],
    [40_000_000, 1997],
    [45_000_000, 2003],
    [50_000_000, 2009],
    [55_000_000, 2015],
    [60_000_000, 2021]
  ];
  let birthYear = null;
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const [fromDni, fromYear] = anchors[index];
    const [toDni, toYear] = anchors[index + 1];
    if (dni >= fromDni && dni <= toDni) {
      const ratio = (dni - fromDni) / (toDni - fromDni);
      birthYear = Math.round(fromYear + ratio * (toYear - fromYear));
      break;
    }
  }
  if (!birthYear) return 0;
  const age = new Date(`${argentinaDate()}T12:00:00-03:00`).getFullYear() - birthYear;
  return age >= 18 && age <= 90 ? age : 0;
}

function isSizeValue(value) {
  const key = cleanLabel(value, '').toUpperCase().replace(/\s+/g, '');
  return ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'U', 'UNICO', 'UNICA', 'ONE SIZE', 'ONESIZE'].includes(key)
    || /^\d{1,2}$/.test(key)
    || /^\d{1,2}\/\d{1,2}$/.test(key);
}

function variantParts(product = {}) {
  const attributes = Array.isArray(product.variant_attributes) ? product.variant_attributes.map(localizedText) : [];
  const values = Array.isArray(product.variant_values) && product.variant_values.length
    ? product.variant_values.map(localizedText)
    : Array.isArray(product.variant_detail?.values)
      ? product.variant_detail.values.map(localizedText)
      : [];
  const byAttribute = new Map(attributes.map((attribute, index) => [attribute.toLowerCase(), values[index]]));
  const name = localizedText(product.name);
  const match = name.match(/\(([^)]+)\)\s*$/);
  const nameParts = match ? match[1].split(',').map((part) => part.trim()).filter(Boolean) : [];
  const variantValues = values.length ? values : nameParts;
  const attrColor = byAttribute.get('color');
  const attrSize = byAttribute.get('talle') || byAttribute.get('size');
  const detectedSize = attrSize || variantValues.find(isSizeValue) || '';
  const detectedColor = attrColor || variantValues.find((value) => value && value !== detectedSize && !isSizeValue(value)) || '';
  return {
    color: cleanLabel(product.color || detectedColor, 'Sin color'),
    size: cleanLabel(product.size || detectedSize, 'Sin talle')
  };
}

function productCategoryEntries(product = {}) {
  const rawCategories = Array.isArray(product.categories) ? product.categories : [];
  const categories = rawCategories
    .map((item) => ({
      id: item?.id ?? null,
      parent: item?.parent ?? null,
      label: cleanLabel(item?.name || item?.label || item, '')
    }))
    .filter((item) => item.label);

  if (!categories.length) {
    const inferred = inferCategoryFromProductName(product);
    const category = cleanLabel(product.category || product.category_name || inferred.category, '');
    const subcategory = cleanLabel(product.subcategory || product.subcategory_name, '');
    return [{ category: category || 'Sin categoria', subcategory }];
  }

  const byId = new Map(categories.filter((item) => item.id != null).map((item) => [String(item.id), item]));
  const roots = categories.filter((item) => item.parent == null || !byId.has(String(item.parent)));
  const entries = roots.length ? roots.flatMap((root) => {
    const children = categories.filter((item) => String(item.parent) === String(root.id));
    if (!children.length) return [{ category: root.label, subcategory: '' }];
    return children.map((child) => ({ category: root.label, subcategory: child.label }));
  }) : [{ category: categories[0].label, subcategory: categories[1]?.label || '' }];

  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.category}::${entry.subcategory}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inferCategoryFromProductName(product = {}) {
  const label = labelFromProduct(product);
  const lower = label.toLowerCase();
  const rules = [
    [/combo/, 'Combos'],
    [/conjunto/, 'Conjuntos'],
    [/campera|canguro|rompeviento|chaleco/, 'Camperas'],
    [/pantal[oó]n|jogger|cargo|babucha|short/, 'Pantalones'],
    [/remera|chomba|musculosa|top/, 'Remeras'],
    [/buzo|hoodie|sweater|sweatshirt/, 'Buzos'],
    [/gorra|cap/, 'Gorras']
  ];
  const category = rules.find(([pattern]) => pattern.test(lower))?.[1] || '';
  const subcategoryRules = [
    [/sst/, 'SST'],
    [/jordan/, 'Jordan'],
    [/tech/, 'Tech'],
    [/baggy/, 'Baggy'],
    [/corteiz/, 'Corteiz'],
    [/diesel/, 'Diesel'],
    [/adidas/, 'Adidas'],
    [/nike| nk /, 'Nike']
  ];
  const subcategory = subcategoryRules.find(([pattern]) => pattern.test(lower))?.[1] || '';
  return { category, subcategory };
}

function addCategoryCounts(categoryMap, treeMap, entries, value) {
  const countedCategories = new Set();
  for (const entry of entries) {
    if (!treeMap.has(entry.category)) {
      treeMap.set(entry.category, { label: entry.category, count: 0, children: new Map() });
    }
    const treeRow = treeMap.get(entry.category);
    if (!countedCategories.has(entry.category)) {
      addCount(categoryMap, entry.category, value);
      treeRow.count += numberValue(value);
      countedCategories.add(entry.category);
    }
    if (entry.subcategory) addCount(treeRow.children, entry.subcategory, value);
  }
}

function addSalesCategoryCounts(categoryMap, treeMap, entries) {
  const countedProductsByCategory = new Set();
  const countedProductsBySubcategory = new Set();
  for (const entry of entries) {
    const productKey = entry.productKey || '';
    const isComboCategory = entry.category === 'Combos';
    if (!treeMap.has(entry.category)) {
      treeMap.set(entry.category, { label: entry.category, count: 0, children: new Map() });
    }
    const treeRow = treeMap.get(entry.category);
    const categoryKey = isComboCategory ? `${entry.category}::${productKey}` : entry.category;
    if (!countedProductsByCategory.has(categoryKey)) {
      addCount(categoryMap, entry.category, 1);
      treeRow.count += 1;
      countedProductsByCategory.add(categoryKey);
    }
    if (entry.subcategory) {
      const subcategoryKey = isComboCategory ? `${entry.category}::${entry.subcategory}::${productKey}` : `${entry.category}::${entry.subcategory}`;
      if (!countedProductsBySubcategory.has(subcategoryKey)) {
        addCount(treeRow.children, entry.subcategory, 1);
        countedProductsBySubcategory.add(subcategoryKey);
      }
    }
  }
}

function addCount(map, key, value = 1, extra = {}) {
  const label = String(key || 'Sin dato').trim() || 'Sin dato';
  const current = map.get(label) || { label, count: 0, total: 0, ...extra };
  current.count += numberValue(value);
  current.total += numberValue(extra.total);
  map.set(label, current);
}

function top(map, limit = 10) {
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

function topWithOthers(map, limit = 10, otherLabel = 'otros') {
  const rows = [...map.values()].sort((a, b) => b.count - a.count);
  if (rows.length <= limit) return rows;
  const visible = rows.slice(0, Math.max(1, limit - 1));
  const hidden = rows.slice(Math.max(1, limit - 1));
  const other = hidden.reduce((acc, item) => {
    acc.count += numberValue(item.count);
    acc.total += numberValue(item.total);
    return acc;
  }, { label: otherLabel, count: 0, total: 0, children: hidden });
  return [...visible, other];
}

function createMetricSet() {
  return {
    payments: new Map(),
    paymentPlatforms: new Map(),
    paymentMethods: new Map(),
    paymentInstallments: new Map(),
    paymentAll: new Map(),
    provinces: new Map(),
    cities: new Map(),
    categories: new Map(),
    categoryTree: new Map(),
    allVariants: new Map(),
    colors: new Map(),
    sizes: new Map(),
    ages: new Map(),
    hours: Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 })),
    weekdays: ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'].map((label, index) => ({ label, day: index, count: 0 })),
    shipping: new Map(),
    shippingPayment: new Map(),
    genders: new Map(),
    combos: new Map()
  };
}

function addPairCount(map, source, target, count = 1, extra = {}) {
  const key = `${source}::${target}`;
  const current = map.get(key) || { label: `${source} + ${target}`, source, target, count: 0, base: 0, ...extra };
  current.count += numberValue(count);
  if (extra.base != null) current.base = numberValue(extra.base);
  map.set(key, current);
}

function comboPairRows(pairCounts, productSaleCounts, limit = 80) {
  const rows = [];
  for (const [pairKey, pairRow] of pairCounts.entries()) {
    const count = numberValue(pairRow?.count ?? pairRow);
    const [first, second] = pairKey.split('::');
    const firstBase = numberValue(productSaleCounts.get(first)?.count || 0);
    const secondBase = numberValue(productSaleCounts.get(second)?.count || 0);
    if (count < 2 || !firstBase || !secondBase) continue;
    rows.push({
      label: `${first} + ${second}`,
      source: first,
      target: second,
      first,
      second,
      count,
      base: firstBase,
      firstBase,
      secondBase
    });
  }
  return rows
    .sort((a, b) => b.count - a.count || (b.count / Math.max(b.base, 1)) - (a.count / Math.max(a.base, 1)))
    .slice(0, limit);
}

function metricPayload(metric) {
  return {
    payments: top(metric.payments, 8),
    paymentPlatforms: top(metric.paymentPlatforms, 8),
    paymentMethods: top(metric.paymentMethods, 8),
    paymentInstallments: top(metric.paymentInstallments, 8),
    paymentAll: topWithOthers(metric.paymentAll, 6, 'otras'),
    gender: top(metric.genders, 8),
    provinces: topWithOthers(metric.provinces, 5, 'otros'),
    cities: top(metric.cities, 8),
    categories: top(metric.categories, 12),
    categoryTree: [...metric.categoryTree.values()]
      .map((item) => ({
        label: item.label,
        count: categoryTreeDisplayCount(item),
        children: top(item.children, 10)
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
    variants: {
      all: topWithOthers(metric.allVariants, 11, 'otras'),
      colors: topWithOthers(metric.colors, 9, 'otras'),
      sizes: topWithOthers(metric.sizes, 9, 'otras')
    },
    ages: [...metric.ages.values()].sort((a, b) => Number(a.label) - Number(b.label)),
    hours: metric.hours,
    weekdays: [1, 2, 3, 4, 5, 6, 0].map((day) => metric.weekdays[day]),
    shipping: top(metric.shipping, 8),
    shippingPayment: top(metric.shippingPayment, 8),
    combos: Array.isArray(metric.combos) ? metric.combos : top(metric.combos, 8)
  };
}

function categoryTreeDisplayCount(item) {
  if (item.label !== 'Combos') return item.count;
  const nestedComboLabels = ['Baggy Adidas bordado', 'Baggy Bordados'];
  const nestedTotal = nestedComboLabels.reduce((sum, label) => sum + numberValue(item.children.get(label)?.count || 0), 0);
  return Math.max(0, item.count - nestedTotal);
}

function buildCartMetrics(carts, range) {
  const days = Array.from({ length: range.days }, (_, index) => {
    const base = new Date(`${range.from}T12:00:00-03:00`);
    base.setDate(base.getDate() + index);
    const key = dateOnly(base);
    return { key, label: `${base.getDate()}/${base.getMonth() + 1}`, count: 0, products: 0, revenue: 0 };
  });
  const byDay = new Map(days.map((item) => [item.key, item]));
  const metrics = {
    carts: createMetricSet(),
    products: createMetricSet(),
    amounts: createMetricSet()
  };
  const productRows = new Map();
  const cartProductCounts = new Map();
  const cartComboPairCounts = new Map();

  for (const cart of carts) {
    const createdAt = cart.created_at || new Date();
    const cartProducts = Array.isArray(cart.products) ? cart.products : [];
    const quantity = cartProducts.reduce((sum, item) => sum + Number(item.quantity || 1), Number(cart.items || 0) && !cartProducts.length ? Number(cart.items || 0) : 0);
    const total = money(cart.total || 0);
    const day = byDay.get(localDateKey(createdAt));
    if (day) {
      day.count += 1;
      day.products += quantity;
      day.revenue += total;
    }
    const hour = new Date(createdAt).getHours();
    const weekday = new Date(createdAt).getDay();
    const age = ageValue(cart);
    const shippingCost = numberValue(cart.shipping_cost_customer || cart.shipping_cost);
    const cartGender = genderLabel(cart);
    const cartPayment = paymentLabel(cart);
    const cartPaymentMethod = paymentMethodLabel(cart);
    const cartPaymentInstallments = paymentInstallmentsLabel(cart);
    const cartPaymentFull = paymentFullLabel(cart);
    const cartProvince = provinceLabel(cart);
    const cartCity = cityLabel(cart);
    const cartShipping = shippingLabel(cart);
    const orderMetricValues = { carts: 1, products: quantity, amounts: total };
    for (const [metricKey, value] of Object.entries(orderMetricValues)) {
      const metric = metrics[metricKey];
      const shippingMetricValue = metricKey === 'amounts' ? shippingCost : value;
      addCount(metric.payments, cartPayment, value);
      addCount(metric.paymentPlatforms, cartPayment, value);
      addCount(metric.paymentMethods, cartPaymentMethod, value);
      addCount(metric.paymentInstallments, cartPaymentInstallments, value);
      addCount(metric.paymentAll, cartPaymentFull, value);
      addCount(metric.provinces, cartProvince, value);
      addCount(metric.cities, cartCity, value);
      if (shippingMetricValue > 0 || metricKey !== 'amounts') {
        addCount(metric.shipping, cartShipping, shippingMetricValue);
        addCount(metric.shippingPayment, shippingCost > 0 ? 'Envios pagados por los clientes' : 'Envios pagados por la tienda', shippingMetricValue);
      }
      if (cartGender) addCount(metric.genders, cartGender, value);
      if (age > 0) addCount(metric.ages, age, value);
      if (metric.hours[hour]) metric.hours[hour].count += value;
      if (metric.weekdays[weekday]) metric.weekdays[weekday].count += value;
    }

    const cartProductLabels = [...new Set(cartProducts.map(labelFromProduct).filter(Boolean))].sort();
    for (const label of cartProductLabels) addCount(cartProductCounts, label, 1);
    for (let firstIndex = 0; firstIndex < cartProductLabels.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < cartProductLabels.length; secondIndex += 1) {
        addPairCount(cartComboPairCounts, cartProductLabels[firstIndex], cartProductLabels[secondIndex], 1);
      }
    }

    const cartCategoryEntries = new Map();
    const cartColors = new Set();
    const cartSizes = new Set();

    for (const product of cartProducts) {
      const productQuantity = Number(product.quantity || 1);
      const label = labelFromProduct(product);
      const variant = variantParts(product);
      const productRevenue = money(Number(product.price || 0) * productQuantity);
      const row = productRows.get(label) || { label, count: 0, revenue: 0, image: product.image?.src || product.image_url || '' };
      row.count += productQuantity;
      row.revenue += productRevenue;
      productRows.set(label, row);

      const categoryEntries = productCategoryEntries(product);
      for (const entry of categoryEntries) {
        const key = `${entry.category || ''}|||${entry.subcategory || ''}`;
        if (!cartCategoryEntries.has(key)) cartCategoryEntries.set(key, entry);
      }
      if (variant.color) cartColors.add(variant.color);
      if (variant.size) cartSizes.add(variant.size);

      const productMetricValues = { products: productQuantity, amounts: productRevenue };
      for (const [metricKey, value] of Object.entries(productMetricValues)) {
        const metric = metrics[metricKey];
        addCategoryCounts(metric.categories, metric.categoryTree, categoryEntries, value);
        addCount(metric.allVariants, variant.color, value);
        addCount(metric.allVariants, variant.size, value);
        addCount(metric.colors, variant.color, value);
        addCount(metric.sizes, variant.size, value);
      }
    }

    addCategoryCounts(metrics.carts.categories, metrics.carts.categoryTree, [...cartCategoryEntries.values()], 1);
    for (const color of cartColors) {
      addCount(metrics.carts.allVariants, color, 1);
      addCount(metrics.carts.colors, color, 1);
    }
    for (const size of cartSizes) {
      addCount(metrics.carts.allVariants, size, 1);
      addCount(metrics.carts.sizes, size, 1);
    }
  }

  return {
    carts: {
      ...metricPayload({ ...metrics.carts, combos: comboPairRows(cartComboPairCounts, cartProductCounts) }),
      byDay: [...byDay.values()].map((item) => ({ ...item, count: item.count }))
    },
    products: {
      ...metricPayload(metrics.products),
      byDay: [...byDay.values()].map((item) => ({ ...item, count: item.products }))
    },
    amounts: {
      ...metricPayload(metrics.amounts),
      byDay: [...byDay.values()].map((item) => ({ ...item, count: item.revenue }))
    },
    productsTable: [...productRows.values()].sort((a, b) => b.count - a.count)
  };
}

function buildCartCountByDay(carts, range) {
  const days = Array.from({ length: range.days }, (_, index) => {
    const base = new Date(`${range.from}T12:00:00-03:00`);
    base.setDate(base.getDate() + index);
    const key = dateOnly(base);
    return { key, label: `${base.getDate()}/${base.getMonth() + 1}`, count: 0, products: 0, revenue: 0 };
  });
  const byDay = new Map(days.map((item) => [item.key, item]));
  for (const cart of carts) {
    const day = byDay.get(localDateKey(cart.created_at || new Date()));
    if (day) day.count += 1;
  }
  return [...byDay.values()];
}

function buildStats(orders, abandonedCarts, range, source) {
  const preparedOrders = markLoadedCashOnDeliveryOrders(orders);
  const paid = preparedOrders.filter((order) => {
    const status = String(order.status || '').toLowerCase();
    const payment = String(order.payment_status || '').toLowerCase();
    const created = localDateKey(order.created_at || order.paid_at || new Date());
    const isCancelled = ['cancelled', 'canceled', 'cancelada', 'cancelado'].includes(status);
    const normalPaid = !isCancelled && (!payment || ['paid', 'authorized', 'aprobado'].includes(payment));
    return created >= range.from && created <= range.to && (normalPaid || order.__loadedCashOnDelivery);
  });
  const loadedCashOnDeliveryCount = paid.filter((order) => order.__loadedCashOnDelivery).length;

  const days = Array.from({ length: range.days }, (_, index) => {
    const base = new Date(`${range.from}T12:00:00-03:00`);
    base.setDate(base.getDate() + index);
    const key = dateOnly(base);
    return { key, label: `${base.getDate()}/${base.getMonth() + 1}`, count: 0, products: 0, revenue: 0 };
  });
  const byDay = new Map(days.map((item) => [item.key, item]));
  const payments = new Map();
  const provinces = new Map();
  const cities = new Map();
  const categories = new Map();
  const categoryTree = new Map();
  const allVariants = new Map();
  const colors = new Map();
  const sizes = new Map();
  const ages = new Map();
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  const weekdays = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'].map((label, index) => ({ label, day: index, count: 0, total: 0 }));
  const products = new Map();
  const productSaleCounts = new Map();
  const comboPairCounts = new Map();
  const shipping = new Map();
  const shippingPayment = new Map();
  const genders = new Map();
  const combos = new Map();
  const metrics = {
    sales: createMetricSet(),
    products: createMetricSet(),
    billing: createMetricSet()
  };

  for (const order of paid) {
    const createdAt = order.created_at || order.paid_at || new Date();
    const orderProducts = Array.isArray(order.products) ? order.products : [];
    const orderQuantity = orderProducts.reduce((sum, item) => sum + Number(item.quantity || 1), 0);
    const day = byDay.get(localDateKey(createdAt));
    const total = money(order.total || order.total_paid || order.subtotal || 0);
    if (day) {
      day.count += 1;
      day.revenue += total;
      day.products += orderQuantity;
    }
    const hour = new Date(createdAt).getHours();
    if (hours[hour]) hours[hour].count += 1;
    const weekday = new Date(createdAt).getDay();
    if (weekdays[weekday]) {
      weekdays[weekday].count += 1;
      weekdays[weekday].total += total;
    }

    const orderPayment = paymentLabel(order);
    const orderPaymentMethod = paymentMethodLabel(order);
    const orderPaymentInstallments = paymentInstallmentsLabel(order);
    const orderPaymentFull = paymentFullLabel(order);
    const orderProvince = provinceLabel(order);
    const orderCity = cityLabel(order);
    const orderShipping = shippingLabel(order);
    const orderGender = genderLabel(order);
    const shippingCost = numberValue(order.shipping_cost_customer || order.shipping_cost || order.shipping_cost_owner);

    addCount(payments, orderPayment, 1, { total });
    addCount(provinces, orderProvince);
    addCount(cities, orderCity);
    addCount(shipping, orderShipping);
    addCount(shippingPayment, shippingCost > 0 ? 'Envios pagados por los clientes' : 'Envio sin cargo / retiro');
    if (orderGender) addCount(genders, orderGender);

    const age = ageValue(order);
    if (age > 0) addCount(ages, age);

    const orderMetricValues = { sales: 1, products: orderQuantity, billing: total };
    for (const [metricKey, value] of Object.entries(orderMetricValues)) {
      const metric = metrics[metricKey];
      const shippingMetricValue = metricKey === 'billing' ? shippingCost : value;
      addCount(metric.payments, orderPayment, value);
      addCount(metric.paymentPlatforms, orderPayment, value);
      addCount(metric.paymentMethods, orderPaymentMethod, value);
      addCount(metric.paymentInstallments, orderPaymentInstallments, value);
      addCount(metric.paymentAll, orderPaymentFull, value);
      addCount(metric.provinces, orderProvince, value);
      addCount(metric.cities, orderCity, value);
      if (shippingMetricValue > 0 || metricKey !== 'billing') {
        addCount(metric.shipping, orderShipping, shippingMetricValue);
        addCount(metric.shippingPayment, shippingCost > 0 ? 'Envios pagados por los clientes' : 'Envio sin cargo / retiro', shippingMetricValue);
      }
      if (orderGender) addCount(metric.genders, orderGender, value);
      if (age > 0) addCount(metric.ages, age, value);
      if (metric.hours[hour]) metric.hours[hour].count += value;
      if (metric.weekdays[weekday]) metric.weekdays[weekday].count += value;
    }

    const orderProductLabels = [...new Set(orderProducts.map(labelFromProduct).filter(Boolean))].sort();
    for (const label of orderProductLabels) addCount(productSaleCounts, label, 1);
    for (let firstIndex = 0; firstIndex < orderProductLabels.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < orderProductLabels.length; secondIndex += 1) {
        addPairCount(comboPairCounts, orderProductLabels[firstIndex], orderProductLabels[secondIndex], 1);
      }
    }

    const salesCategoryEntries = new Map();
    const salesColors = new Set();
    const salesSizes = new Set();
    const salesAllVariants = new Set();

    for (const product of orderProducts) {
      const quantity = Number(product.quantity || 1);
      const label = labelFromProduct(product);
      const variant = variantParts(product);
      const revenue = money(numberValue(product.price) * quantity);
      const row = products.get(label) || {
        label,
        sold: 0,
        revenue: 0,
        stock: product.variant_detail?.stock ?? product.stock ?? product.stock_management ?? 'infinito',
        image: product.image?.src || product.image_url || '',
        variantMap: new Map()
      };
      row.sold += quantity;
      row.revenue += revenue;
      const variantGroupLabel = variant.color && variant.color !== 'Sin color'
        ? variant.color
        : cleanLabel(localizedText(product.name).replace(label, '').replace(/[()]/g, ''), 'Sin variante');
      const variantGroup = row.variantMap.get(variantGroupLabel) || {
        label: variantGroupLabel,
        sold: 0,
        revenue: 0,
        stock: 0,
        hasInfiniteStock: false,
        image: product.image?.src || product.image_url || '',
        sizes: new Map(),
        stockKeys: new Set()
      };
      const variantStock = product.variant_detail?.stock ?? product.stock ?? product.stock_management;
      const stockKey = String(product.variant_id || product.id || `${label}-${variantGroupLabel}-${variant.size}`);
      variantGroup.sold += quantity;
      variantGroup.revenue += revenue;
      if (!variantGroup.stockKeys.has(stockKey)) {
        if (Number.isFinite(Number(variantStock))) variantGroup.stock += Number(variantStock);
        else variantGroup.hasInfiniteStock = true;
        variantGroup.stockKeys.add(stockKey);
      }
      const sizeLabel = variant.size && variant.size !== 'Sin talle' ? variant.size : 'Sin talle';
      const sizeRow = variantGroup.sizes.get(sizeLabel) || {
        label: sizeLabel,
        sold: 0,
        revenue: 0,
        stock: 0,
        hasInfiniteStock: false,
        stockKeys: new Set()
      };
      sizeRow.sold += quantity;
      sizeRow.revenue += revenue;
      if (!sizeRow.stockKeys.has(stockKey)) {
        if (Number.isFinite(Number(variantStock))) sizeRow.stock += Number(variantStock);
        else sizeRow.hasInfiniteStock = true;
        sizeRow.stockKeys.add(stockKey);
      }
      variantGroup.sizes.set(sizeLabel, sizeRow);
      row.variantMap.set(variantGroupLabel, variantGroup);
      products.set(label, row);

      const categoryEntries = productCategoryEntries(product);
      addCategoryCounts(categories, categoryTree, categoryEntries, quantity);
      addCount(colors, variant.color, quantity);
      addCount(sizes, variant.size, quantity);
      addCount(allVariants, variant.color, quantity);
      addCount(allVariants, variant.size, quantity);

      for (const entry of categoryEntries) {
        salesCategoryEntries.set(`${entry.category}::${entry.subcategory}::${label}`, { ...entry, productKey: label });
      }
      if (variant.color && variant.color !== 'Sin color') {
        salesColors.add(variant.color);
        salesAllVariants.add(variant.color);
      }
      if (variant.size && variant.size !== 'Sin talle') {
        salesSizes.add(variant.size);
        salesAllVariants.add(variant.size);
      }

      const productMetricValues = { products: quantity, billing: revenue };
      for (const [metricKey, value] of Object.entries(productMetricValues)) {
        const metric = metrics[metricKey];
        addCategoryCounts(metric.categories, metric.categoryTree, categoryEntries, value);
        addCount(metric.allVariants, variant.color, value);
        addCount(metric.allVariants, variant.size, value);
        addCount(metric.colors, variant.color, value);
        addCount(metric.sizes, variant.size, value);
      }
    }

    addSalesCategoryCounts(metrics.sales.categories, metrics.sales.categoryTree, [...salesCategoryEntries.values()]);
    for (const value of salesColors) addCount(metrics.sales.colors, value, 1);
    for (const value of salesSizes) addCount(metrics.sales.sizes, value, 1);
    for (const value of salesAllVariants) addCount(metrics.sales.allVariants, value, 1);
  }

  const revenue = money(paid.reduce((sum, order) => sum + numberValue(order.total || order.total_paid || order.subtotal), 0));
  const itemCount = paid.reduce((sum, order) => sum + (order.products || []).reduce((inner, item) => inner + numberValue(item.quantity || 1), 0), 0);
  const carts = abandonedCarts.filter((cart) => {
    const created = localDateKey(cart.created_at || new Date());
    return created >= range.from && created <= range.to;
  });
  const metricCarts = carts.filter((cart) => {
    const products = Array.isArray(cart.products) ? cart.products : [];
    return products.length > 0;
  });
  const recovered = carts.filter((cart) => cart.recovered);
  const cartMetrics = buildCartMetrics(metricCarts, range);
  cartMetrics.carts.byDay = buildCartCountByDay(carts, range);
  const productRows = [...products.values()].sort((a, b) => b.sold - a.sold);
  const comboRows = comboPairRows(comboPairCounts, productSaleCounts);

  return {
    source,
    range,
    summary: {
      sales: paid.length,
      salesPerDay: money(paid.length / range.days),
      revenue,
      averageTicket: paid.length ? money(revenue / paid.length) : 0,
      productsPerSale: paid.length ? money(itemCount / paid.length) : 0,
      abandonedCarts: carts.length,
      recoveredCarts: recovered.length,
      recoveryRate: carts.length ? money((recovered.length / carts.length) * 100) : 0,
      loadedCashOnDelivery: loadedCashOnDeliveryCount
    },
    salesByDay: [...byDay.values()],
    metrics: {
      sales: {
        ...metricPayload({ ...metrics.sales, combos: comboRows }),
        byDay: [...byDay.values()].map((item) => ({ ...item, count: item.count }))
      },
      products: {
        ...metricPayload({ ...metrics.products, combos: comboRows }),
        byDay: [...byDay.values()].map((item) => ({ ...item, count: item.products }))
      },
      billing: {
        ...metricPayload({ ...metrics.billing, combos: comboRows }),
        byDay: [...byDay.values()].map((item) => ({ ...item, count: item.revenue }))
      }
    },
    payments: top(payments, 8),
    gender: top(genders, 8),
    provinces: top(provinces, 8),
    cities: top(cities, 8),
    categories: top(categories, 12),
    categoryTree: [...categoryTree.values()]
      .map((item) => ({
        label: item.label,
        count: item.count,
        children: top(item.children, 10)
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
    variants: { all: top(allVariants, 12), colors: top(colors, 12), sizes: top(sizes, 12) },
    ages: [...ages.values()].sort((a, b) => Number(a.label) - Number(b.label)),
    hours,
    weekdays: [1, 2, 3, 4, 5, 6, 0].map((day) => weekdays[day]),
    products: productRows.map((row) => ({
      ...row,
      variantMap: undefined,
      variants: [...(row.variantMap || new Map()).values()]
        .map((variant) => ({
          label: variant.label,
          sold: variant.sold,
          revenue: variant.revenue,
          stock: variant.hasInfiniteStock ? 'infinito' : variant.stock,
          image: variant.image,
          sizes: [...variant.sizes.values()]
            .map((size) => ({
              label: size.label,
              sold: size.sold,
              revenue: size.revenue,
              stock: size.hasInfiniteStock ? 'infinito' : size.stock
            }))
            .sort((a, b) => b.sold - a.sold)
        }))
        .sort((a, b) => b.sold - a.sold),
      speed: money(row.sold / range.days),
      stockDays: Number(row.stock) > 0 ? money(Number(row.stock) / Math.max(row.sold / range.days, 0.01)) : row.stock
    })),
    billing: {
      pending: paid.filter((order) => paymentLabel(order).toLowerCase().includes('mercado')).length,
      invoiced: paid.filter((order) => String(order.invoice || '').toLowerCase().includes('fact')).length,
      totalToInvoice: revenue
    },
    abandonedCarts: carts,
    cartMetrics,
    shipping: top(shipping, 8),
    shippingPayment: top(shippingPayment, 8),
    combos: comboRows
  };
}

app.get('/auth/tiendanube/status', (req, res) => {
  res.json({
    configured: Boolean(process.env.ESTADISTICAS_TIENDANUBE_CLIENT_ID && process.env.ESTADISTICAS_TIENDANUBE_CLIENT_SECRET),
    connected: Boolean(process.env.ESTADISTICAS_TIENDANUBE_STORE_ID && process.env.ESTADISTICAS_TIENDANUBE_ACCESS_TOKEN),
    appId: process.env.ESTADISTICAS_TIENDANUBE_CLIENT_ID || null,
    callbackUrl: oauthCallbackUrl()
  });
});

app.get('/auth/tiendanube/start', (req, res) => {
  const clientId = process.env.ESTADISTICAS_TIENDANUBE_CLIENT_ID;
  if (!clientId) {
    res.status(400).send(htmlPage(
      'Falta configurar Tienda Nube',
      `<h1>Falta el ID de la app</h1>
      <p>Agrega <code>ESTADISTICAS_TIENDANUBE_CLIENT_ID</code> y <code>ESTADISTICAS_TIENDANUBE_CLIENT_SECRET</code> en el archivo <code>.env</code>.</p>`
    ));
    return;
  }

  const state = crypto.randomBytes(18).toString('hex');
  oauthStates.add(state);
  res.redirect(`${TIENDANUBE_AUTH_BASE}/apps/${encodeURIComponent(clientId)}/authorize?state=${state}`);
});

app.get('/auth/tiendanube/callback', async (req, res) => {
  if (req.query.error) {
    res.status(400).send(htmlPage(
      'Autorizacion cancelada',
      `<h1>No se completo la autorizacion</h1>
      <p>Tienda Nube devolvio: <code>${escapeHtml(req.query.error)}</code></p>
      <div class="actions"><a class="button" href="/auth/tiendanube/start">Intentar de nuevo</a></div>`
    ));
    return;
  }

  const code = String(req.query.code || '');
  const state = String(req.query.state || '');
  if (!state || !oauthStates.has(state)) {
    res.status(400).send(htmlPage(
      'Validacion vencida',
      `<h1>Validacion vencida</h1>
      <p>La autorizacion no coincide con una solicitud iniciada desde esta app local. Iniciala otra vez.</p>
      <div class="actions"><a class="button" href="/auth/tiendanube/start">Autorizar Tienda Nube</a></div>`
    ));
    return;
  }
  oauthStates.delete(state);

  if (!code) {
    res.status(400).send(htmlPage(
      'Falta el codigo',
      `<h1>Falta el codigo de autorizacion</h1>
      <p>Volve a iniciar la autorizacion desde la app local.</p>
      <div class="actions"><a class="button" href="/auth/tiendanube/start">Autorizar Tienda Nube</a></div>`
    ));
    return;
  }

  try {
    const token = await exchangeTiendanubeCode(code);
    const storeId = String(token.user_id || token.store_id || token.store || '');
    await persistEnvValues({
      ESTADISTICAS_TIENDANUBE_STORE_ID: storeId,
      ESTADISTICAS_TIENDANUBE_ACCESS_TOKEN: token.access_token
    });

    res.send(htmlPage(
      'Tienda conectada',
      `<h1>Tienda conectada</h1>
      <p>Listo: guarde la autorizacion localmente y la app ya puede intentar leer los datos reales de esta tienda.</p>
      <p>La URL de callback configurada para Partners debe ser <code>${escapeHtml(oauthCallbackUrl())}</code>.</p>
      <div class="actions">
        <a class="button" href="/">Abrir estadisticas</a>
        <a class="button secondary" href="/auth/tiendanube/status">Ver estado</a>
      </div>`
    ));
  } catch (error) {
    res.status(502).send(htmlPage(
      'No se pudo conectar',
      `<h1>No se pudo conectar</h1>
      <p>${escapeHtml(error.message)}</p>
      <p>Revisa en Partners que la URL de callback sea <code>${escapeHtml(oauthCallbackUrl())}</code>.</p>
      <div class="actions"><a class="button" href="/auth/tiendanube/start">Intentar de nuevo</a></div>`
    ));
  }
});

app.get('/api/stats', async (req, res) => {
  const range = periodRange(String(req.query.period || '7d'));
  const cacheKey = `${range.from}:${range.to}`;
  const cached = req.query.refresh === '1' ? null : await readStatsCacheRecord(cacheKey);
  if (cached && !cached.stale) {
    res.json(cached.payload);
    return;
  }
  if (cached?.payload && req.query.refresh !== '1') {
    refreshStatsInBackground(cacheKey, range);
    res.setHeader('X-Stats-Cache', 'stale');
    res.json({ ...cached.payload, cache: { stale: true, refreshing: true } });
    return;
  }
  try {
    const payload = await getOrBuildStatsPayload(range, true);
    res.json(payload);
  } catch (error) {
    res.status(502).json({
      success: false,
      error: error.message,
      fallback: buildStats(demoOrders(), demoAbandonedCarts(), range, 'demo')
    });
  }
});

function refreshStatsInBackground(cacheKey, range) {
  if (statsBuildsInFlight.has(cacheKey)) return statsBuildsInFlight.get(cacheKey);
  const promise = buildStatsPayload(range, true)
    .catch((error) => console.warn(`No se pudo refrescar cache ${cacheKey}: ${error.message}`))
    .finally(() => statsBuildsInFlight.delete(cacheKey));
  statsBuildsInFlight.set(cacheKey, promise);
  return promise;
}

async function getOrBuildStatsPayload(range, warnCheckouts = false) {
  const cacheKey = `${range.from}:${range.to}`;
  if (statsBuildsInFlight.has(cacheKey)) return statsBuildsInFlight.get(cacheKey);
  const promise = buildStatsPayload(range, warnCheckouts)
    .finally(() => statsBuildsInFlight.delete(cacheKey));
  statsBuildsInFlight.set(cacheKey, promise);
  return promise;
}

async function buildStatsPayload(range, warnCheckouts = false) {
  const cacheKey = `${range.from}:${range.to}`;
  const tnOrders = await fetchTiendanubeOrders(range);
  const orders = tnOrders ? await enrichOrdersWithProducts(tnOrders, { skipProductDetails: range.days > 120 }) : demoOrders();
  const tnCheckouts = tnOrders ? await fetchTiendanubeAbandonedCheckoutsWithRetry(range).catch((error) => {
    if (warnCheckouts) console.warn(`No se pudieron leer checkouts abandonados: ${error.message}`);
    return [];
  }) : null;
  const checkouts = tnCheckouts ? await enrichOrdersWithProducts(tnCheckouts, { skipProductDetails: range.days > 120 }) : demoAbandonedCarts();
  const payload = buildStats(orders, checkouts, range, tnOrders ? 'tiendanube' : 'demo');
  await writeStatsCache(cacheKey, payload);
  return payload;
}

const reportConfigs = {
  ventas: { context: 'sales', title: 'Ventas', valueHeader: 'Ventas', money: false },
  productos: { context: 'products', title: 'Productos vendidos', valueHeader: 'Productos', money: false },
  facturacion: { context: 'billing', title: 'Facturacion', valueHeader: 'Facturacion', money: true },
  carritos: { context: 'carts', title: 'Carritos abandonados', valueHeader: 'Carritos', money: false },
  'carritos-productos': { context: 'cartProducts', title: 'Productos de carritos abandonados', valueHeader: 'Productos', money: false },
  'carritos-importes': { context: 'cartAmounts', title: 'Importes de carritos abandonados', valueHeader: 'Importe', money: true }
};

async function statsForReport(range) {
  const cacheKey = `${range.from}:${range.to}`;
  const cached = await readStatsCacheRecord(cacheKey);
  if (cached?.payload) {
    if (cached.stale) refreshStatsInBackground(cacheKey, range);
    return cached.payload;
  }
  return getOrBuildStatsPayload(range);
}

function reportConfig(view) {
  return reportConfigs[view] || reportConfigs.ventas;
}

function reportMetricData(payload, context) {
  if (context === 'sales') return payload.metrics?.sales || payload;
  if (context === 'products') return payload.metrics?.products || payload.metrics?.sales || payload;
  if (context === 'billing') return payload.metrics?.billing || payload.metrics?.sales || payload;
  if (context === 'carts') return payload.cartMetrics?.carts || payload.metrics?.sales || payload;
  if (context === 'cartProducts') return payload.cartMetrics?.products || payload.metrics?.products || payload;
  if (context === 'cartAmounts') return payload.cartMetrics?.amounts || payload.metrics?.billing || payload;
  return payload.metrics?.sales || payload;
}

function reportNumber(value) {
  return Number(value || 0).toLocaleString('es-AR', { maximumFractionDigits: 1 });
}

function reportMoney(value) {
  return Number(value || 0).toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  });
}

function reportValue(value, config) {
  return config.money ? reportMoney(value) : reportNumber(value);
}

function reportPercent(value, total) {
  return total ? `${reportNumber((Number(value || 0) / total) * 100)}%` : '0%';
}

function htmlTable(title, headers, rows) {
  const body = rows.length ? rows.map((row) => `
    <tr>${row.map((cell) => `<td>${escapeHtml(cell ?? '')}</td>`).join('')}</tr>
  `).join('') : `<tr><td colspan="${headers.length}">Sin datos para este periodo.</td></tr>`;
  return `
    <h2>${escapeHtml(title)}</h2>
    <table>
      <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function metricRows(rows, config) {
  const total = (rows || []).reduce((sum, item) => sum + Number(item.count || 0), 0);
  return (rows || []).map((item) => [
    item.label,
    reportValue(item.count, config),
    reportPercent(item.count, total)
  ]);
}

function categoryReportRows(rows, config) {
  const out = [];
  for (const item of rows || []) {
    out.push([item.label, reportValue(item.count, config), '']);
    for (const child of item.children || []) {
      out.push([`  ${child.label}`, reportValue(child.count, config), reportPercent(child.count, item.count)]);
    }
  }
  return out;
}

function productReportRows(payload, config) {
  const cartRows = payload.cartMetrics?.productsTable || [];
  const sourceRows = config.context?.startsWith('cart') ? cartRows : (payload.products || []);
  return sourceRows.slice(0, 80).map((item) => {
    if (config.context?.startsWith('cart')) {
      return [item.label, reportNumber(item.count), '', '', '', ''];
    }
    return [
      item.label,
      reportNumber(item.sold),
      item.stock,
      item.stockDays,
      reportNumber(item.speed),
      reportMoney(item.revenue)
    ];
  });
}

const reportColors = ['#6c3fc5', '#1aa6a6', '#fb7f62', '#4b83d1', '#13a36f', '#f6b73c', '#9f7aea', '#ef6f9a'];

function chartCard(title, svg) {
  return `
    <section class="report-card">
      <h2>${escapeHtml(title)}</h2>
      ${svg || '<p>Sin datos para este periodo.</p>'}
    </section>
  `;
}

function reportBarChart(rows, config, options = {}) {
  const cleanRows = (rows || []).filter((item) => Number(item.count || 0) > 0);
  if (!cleanRows.length) return '';
  const maxItems = options.maxItems || 18;
  const visible = cleanRows.length > maxItems
    ? cleanRows.filter((_, index) => index % Math.ceil(cleanRows.length / maxItems) === 0).slice(0, maxItems)
    : cleanRows;
  const width = 780;
  const height = 260;
  const pad = { top: 24, right: 20, bottom: 46, left: 72 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const max = Math.max(...visible.map((item) => Number(item.count || 0)), 1);
  const gap = 9;
  const barW = Math.max(10, (chartW - gap * (visible.length - 1)) / visible.length);
  const bars = visible.map((item, index) => {
    const value = Number(item.count || 0);
    const h = (value / max) * chartH;
    const x = pad.left + index * (barW + gap);
    const y = pad.top + chartH - h;
    const label = String(item.label || item.key || '');
    return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="6" fill="${index % 6 === 5 ? '#9eb7d8' : '#1aa6a6'}" />
      <text x="${(x + barW / 2).toFixed(1)}" y="${(height - 18).toFixed(1)}" text-anchor="middle" font-size="13" fill="#172033">${escapeHtml(label)}</text>
    `;
  }).join('');
  const ticks = [0, max / 2, max].map((tick) => {
    const y = pad.top + chartH - (tick / max) * chartH;
    return `
      <line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${width - pad.right}" y2="${y.toFixed(1)}" stroke="#e5e7eb" />
      <text x="${pad.left - 12}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="13" fill="#475569">${escapeHtml(reportValue(tick, config))}</text>
    `;
  }).join('');
  return `
    <svg class="report-chart" viewBox="0 0 ${width} ${height}" role="img">
      ${ticks}
      <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + chartH}" stroke="#d8dce5" />
      <line x1="${pad.left}" y1="${pad.top + chartH}" x2="${width - pad.right}" y2="${pad.top + chartH}" stroke="#d8dce5" />
      ${bars}
    </svg>
  `;
}

function reportHorizontalBars(rows, config, limit = 10) {
  const cleanRows = (rows || []).filter((item) => Number(item.count || 0) > 0).slice(0, limit);
  if (!cleanRows.length) return '';
  const max = Math.max(...cleanRows.map((item) => Number(item.count || 0)), 1);
  return `
    <div class="report-hbars">
      ${cleanRows.map((item, index) => {
        const width = Math.max(2, (Number(item.count || 0) / max) * 100);
        return `
          <div class="report-hbar-row">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(reportValue(item.count, config))}</strong>
            <i style="width:${width.toFixed(1)}%; background:${reportColors[index % reportColors.length]}"></i>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function donutPath(cx, cy, outerR, innerR, startAngle, endAngle) {
  const toPoint = (angle, radius) => {
    const rad = (angle - 90) * Math.PI / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
  };
  const [x1, y1] = toPoint(startAngle, outerR);
  const [x2, y2] = toPoint(endAngle, outerR);
  const [x3, y3] = toPoint(endAngle, innerR);
  const [x4, y4] = toPoint(startAngle, innerR);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4} Z`;
}

function reportDonutChart(rows, config) {
  const cleanRows = (rows || []).filter((item) => Number(item.count || 0) > 0).slice(0, 8);
  if (!cleanRows.length) return '';
  const total = cleanRows.reduce((sum, item) => sum + Number(item.count || 0), 0) || 1;
  let cursor = 0;
  const slices = cleanRows.map((item, index) => {
    const value = Number(item.count || 0);
    const start = cursor;
    cursor += (value / total) * 360;
    const mid = (start + cursor) / 2;
    const rad = (mid - 90) * Math.PI / 180;
    const labelX = 150 + 72 * Math.cos(rad);
    const labelY = 150 + 72 * Math.sin(rad);
    return `
      <path d="${donutPath(150, 150, 105, 48, start, cursor)}" fill="${reportColors[index % reportColors.length]}" />
      <text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="13" font-weight="700" fill="#fff">${escapeHtml(reportValue(value, config))}</text>
    `;
  }).join('');
  const legend = cleanRows.map((item, index) => `
    <div><i style="background:${reportColors[index % reportColors.length]}"></i><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(reportPercent(item.count, total))}</strong></div>
  `).join('');
  return `
    <div class="report-donut-wrap">
      <svg class="report-donut" viewBox="0 0 300 300" role="img">${slices}</svg>
      <div class="report-legend">${legend}</div>
    </div>
  `;
}

function reportChartSections(metric, config, byDay) {
  return `
    <div class="chart-grid">
      ${chartCard(`${config.valueHeader} por dia`, reportBarChart(byDay, config))}
      ${chartCard('Pago y financiacion', reportDonutChart(metric.paymentPlatforms || metric.payments || [], config))}
      ${chartCard('Variantes', reportHorizontalBars(metric.variants?.all || [], config))}
      ${chartCard('Provincias', reportDonutChart(metric.provinces || [], config))}
      ${chartCard('Edad', reportBarChart(metric.ages || [], config, { maxItems: 20 }))}
      ${chartCard('Categorias', reportHorizontalBars(metric.categoryTree || [], config))}
      ${chartCard('Hora del dia', reportBarChart((metric.hours || []).map((item) => ({ label: String(item.hour ?? item.label).padStart(2, '0'), count: item.count })), config, { maxItems: 24 }))}
      ${chartCard('Genero', reportDonutChart(metric.gender || [], config))}
      ${chartCard('Dias de la semana', reportBarChart(metric.weekdays || [], config, { maxItems: 7 }))}
    </div>
  `;
}

function reportHtml(payload, range, view, printable = false) {
  const config = reportConfig(view);
  const metric = reportMetricData(payload, config.context);
  const byDay = metric.byDay || payload.salesByDay || [];
  const total = byDay.reduce((sum, item) => sum + Number(item.count || 0), 0);
  const charts = printable ? reportChartSections(metric, config, byDay) : '';
  const sections = [
    htmlTable('Resumen', ['Dato', 'Valor'], [
      [config.valueHeader, reportValue(total, config)],
      [`${config.valueHeader} por dia`, reportValue(total / Math.max(range.days, 1), config)],
      ['Periodo', `${range.from} a ${range.to}`],
      ['Origen', payload.source === 'tiendanube' ? 'Datos reales' : 'Modo demo']
    ]),
    htmlTable(`${config.valueHeader} por dia`, ['Fecha', config.valueHeader], byDay.map((item) => [item.label || item.key, reportValue(item.count, config)])),
    htmlTable('Pago y financiacion - Plataforma', ['Plataforma', config.valueHeader, '%'], metricRows(metric.paymentPlatforms || metric.payments || [], config)),
    htmlTable('Pago y financiacion - Metodo', ['Metodo', config.valueHeader, '%'], metricRows(metric.paymentMethods || [], config)),
    htmlTable('Pago y financiacion - Cuotas', ['Cuotas', config.valueHeader, '%'], metricRows(metric.paymentInstallments || [], config)),
    htmlTable('Variantes - Todas', ['Variante', config.valueHeader, '%'], metricRows(metric.variants?.all || [], config)),
    htmlTable('Provincias', ['Provincia', config.valueHeader, '%'], metricRows(metric.provinces || [], config)),
    htmlTable('Edad', ['Edad', config.valueHeader, '%'], metricRows(metric.ages || [], config)),
    htmlTable('Categorias', ['Categoria', config.valueHeader, '% dentro de categoria'], categoryReportRows(metric.categoryTree || [], config)),
    htmlTable('Hora del dia', ['Hora', config.valueHeader, '%'], metricRows((metric.hours || []).map((item) => ({ label: String(item.hour ?? item.label).padStart(2, '0'), count: item.count })), config)),
    htmlTable('Envios', ['Forma de envio', config.valueHeader, '%'], metricRows(metric.shipping || [], config)),
    htmlTable('Genero', ['Genero', config.valueHeader, '%'], metricRows(metric.gender || [], config)),
    htmlTable('Combinacion de productos', ['Productos juntos', 'Coincidencias', '% coincidencia'], (metric.combos || []).slice(0, 30).map((item) => [
      `${item.first || item.source || ''} + ${item.second || item.target || ''}`.trim(),
      reportNumber(item.count),
      reportPercent(item.count, item.base || item.firstBase || item.count)
    ])),
    htmlTable('Dias de la semana', ['Dia', config.valueHeader], (metric.weekdays || []).map((item) => [item.label, reportValue(item.count, config)])),
    htmlTable('Productos', ['Producto', 'Vendidos', 'Stock actual', 'Dias restantes de stock', 'Velocidad diaria', 'Facturacion'], productReportRows(payload, config))
  ].join('');

  const printScript = printable ? `<script>window.addEventListener('load', () => setTimeout(() => window.print(), 450));</script>` : '';
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Reporte ${escapeHtml(config.title)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #172033; margin: 28px; background: #fff; }
    header { border-bottom: 4px solid #6c3fc5; margin-bottom: 22px; padding-bottom: 14px; }
    h1 { margin: 0 0 6px; font-size: 28px; }
    h2 { margin: 26px 0 8px; font-size: 18px; color: #3d1b78; }
    p { color: #64748b; margin: 0; }
    .chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 18px 0 24px; }
    .report-card { border: 1px solid #d8dce5; border-radius: 12px; padding: 14px; break-inside: avoid; page-break-inside: avoid; }
    .report-card h2 { margin-top: 0; }
    .report-chart { width: 100%; height: auto; display: block; }
    .report-donut-wrap { display: grid; grid-template-columns: 220px 1fr; gap: 16px; align-items: center; }
    .report-donut { width: 220px; height: 220px; }
    .report-legend { display: grid; gap: 7px; font-size: 13px; }
    .report-legend div { display: grid; grid-template-columns: 14px minmax(0, 1fr) auto; gap: 7px; align-items: center; }
    .report-legend i { width: 14px; height: 14px; border-radius: 4px; }
    .report-hbars { display: grid; gap: 8px; }
    .report-hbar-row { display: grid; grid-template-columns: minmax(120px, 1fr) auto; gap: 8px; align-items: center; }
    .report-hbar-row i { grid-column: 1 / -1; display: block; height: 18px; border-radius: 5px; min-width: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 14px; page-break-inside: avoid; }
    th { background: #eee8ff; color: #172033; text-align: left; }
    th, td { border: 1px solid #d8dce5; padding: 8px 10px; font-size: 13px; vertical-align: top; }
    tr:nth-child(even) td { background: #fbfbfe; }
    @media print {
      body { margin: 14mm; }
      .chart-grid { grid-template-columns: 1fr 1fr; }
      h2 { break-after: avoid; }
      table { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Estadisticas Nube - ${escapeHtml(config.title)}</h1>
    <p>Periodo: ${escapeHtml(range.from)} a ${escapeHtml(range.to)}</p>
  </header>
  ${charts}
  ${sections}
  ${printScript}
</body>
</html>`;
}

app.get('/api/export.xls', async (req, res) => {
  const range = periodRange(String(req.query.period || '7d'));
  const view = String(req.query.view || 'ventas');
  const config = reportConfig(view);
  const payload = await statsForReport(range);
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="estadisticas-${config.context}-${range.from}-${range.to}.xls"`);
  res.send(reportHtml(payload, range, view, false));
});

app.get('/api/export.pdf', async (req, res) => {
  const range = periodRange(String(req.query.period || '7d'));
  const view = String(req.query.view || 'ventas');
  const payload = await statsForReport(range);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(reportHtml(payload, range, view, true));
});

app.get('/api/export.csv', async (req, res) => {
  const range = periodRange(String(req.query.period || '7d'));
  const stats = await statsForReport(range);
  const rows = [
    ['producto', 'vendidos', 'velocidad_diaria', 'stock', 'dias_stock', 'facturacion'],
    ...stats.products.map((item) => [item.label, item.sold, item.speed, item.stock, item.stockDays, Math.round(item.revenue)])
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="estadisticas-productos-${range.from}-${range.to}.csv"`);
  res.send(rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Estadisticas Nube Local: http://localhost:${PORT}`);
    setTimeout(() => {
      const range = periodRange('7d');
      const cacheKey = `${range.from}:${range.to}`;
      readStatsCacheRecord(cacheKey)
        .then((cached) => {
          if (!cached || cached.stale) refreshStatsInBackground(cacheKey, range);
        })
        .catch(() => {});
    }, 1500);
  });
}

module.exports = app;
