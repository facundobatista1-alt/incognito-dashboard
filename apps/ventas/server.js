'use strict';
require('dotenv').config();

const express = require('express');
const path    = require('path');
const crypto  = require('crypto');
const fs      = require('fs/promises');
const { AsyncLocalStorage } = require('async_hooks');
const JSZip   = require('jszip');
const tn      = require('./tiendanube');
const {
  KommoService,
  kommoConfigFromEnv,
  sanitizedKommoError,
  botTemplateIds
} = require('./kommo-service');
const {
  assertKommoTestRequestAllowed,
  chooseWhatsappEngine,
  isKommoCompatibleMessageType
} = require('./whatsapp-engine');
const {
  buildWhatsappTemplateErrorPayload,
  safeKommoFrontendDebug,
  shouldExposeKommoTestDebug
} = require('./whatsapp-debug');

const app  = express();
const PORT = process.env.PORT || 3000;
const STOCK_DECREMENT_URL = process.env.STOCK_DECREMENT_URL || 'https://incognito-stock.netlify.app/.netlify/functions/decrement-stock';
const STOCK_RESTORE_URL = process.env.STOCK_RESTORE_URL || '';
const STOCK_LIST_URL = process.env.STOCK_LIST_URL || 'https://incognito-stock.netlify.app/.netlify/functions/list-stock-items';
const STOCK_SECRET = process.env.DECREMENT_SECRET || process.env.STOCK_SYNC_SECRET || '';
const STAMPS_API_URL = (process.env.STAMPS_API_URL || 'https://incognito-stock-estampas-dtf.onrender.com/api/stamps/v1').replace(/\/$/, '');
const STAMPS_API_SECRET = process.env.STAMPS_API_SECRET || process.env.VENTAS_APP_PASSWORD || '';
// Prefijo VENTAS_ para no compartir accidentalmente el proyecto Supabase que
// ya usa Tareas en este mismo proceso (root render.yaml define SUPABASE_URL
// sin prefijo para Tareas; Ventas tiene su propio proyecto Supabase aparte).
const SUPABASE_URL = (process.env.VENTAS_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.VENTAS_SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_STATE_TABLE = process.env.VENTAS_SUPABASE_STATE_TABLE || 'ventas_app_state';
const APP_STATE_ID = process.env.APP_STATE_ID || 'default';
const ANDREANI_BRANCHES_URL = process.env.ANDREANI_BRANCHES_URL || 'https://apis.andreani.com/v2/sucursales';
const FLUX_API_URL = (process.env.FLUX_API_URL || 'https://fluxlogistica.lightdata.app/api/v1/').replace(/\/$/, '');
const FLUX_EXTERNAL_API_URL = (process.env.FLUX_EXTERNAL_API_URL || 'https://apiexterna.lightdata.com.ar/externa').replace(/\/$/, '');
const FLUX_API_TOKEN = process.env.FLUX_API_TOKEN || '';
const FLUX_COMPANY_TOKEN = process.env.FLUX_COMPANY_TOKEN || process.env.FLUX_EMPRESA_TOKEN || '';
const FLUX_COMPANY_ID = process.env.FLUX_COMPANY_ID || process.env.FLUX_ID_EMPRESA || '';
const FLUX_REQUEST_TIMEOUT_MS = Number(process.env.FLUX_REQUEST_TIMEOUT_MS || 60000);
const FLUX_INSERT_CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.FLUX_INSERT_CONCURRENCY || 2)));
const FLUX_INSERT_RETRIES = Math.max(0, Math.min(3, Number(process.env.FLUX_INSERT_RETRIES || 2)));
const MICROSOFT_TENANT_ID = process.env.MICROSOFT_TENANT_ID || '';
const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || '';
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || '';
const SHAREPOINT_DRIVE_ID = process.env.SHAREPOINT_DRIVE_ID || '';
const SHAREPOINT_BACKUP_PATH = (process.env.SHAREPOINT_BACKUP_PATH || 'backup-historico-pedidos.xls').replace(/^\/+/, '');
const SHAREPOINT_FULL_BACKUP_PATH = (process.env.SHAREPOINT_FULL_BACKUP_PATH || path.posix.join(path.posix.dirname(SHAREPOINT_BACKUP_PATH), 'backup-completo-incognito-ventas.json')).replace(/^\/+/, '');
const SHAREPOINT_AUTO_BACKUP = String(process.env.SHAREPOINT_AUTO_BACKUP || '').toLowerCase() === 'true';
const CONTABLE_SUPABASE_URL = (process.env.CONTABLE_SUPABASE_URL || 'https://hspvuakueakgeffiyjzm.supabase.co').replace(/\/$/, '');
const CONTABLE_SUPABASE_KEY = process.env.CONTABLE_SUPABASE_SERVICE_ROLE_KEY || process.env.CONTABLE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzcHZ1YWt1ZWFrZ2VmZml5anptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0NjI2ODgsImV4cCI6MjA5NDAzODY4OH0.74_AUatbpgaufvciYdMG-gyLlaJ0R4u1orH6rKY6xuo';
const SHAREPOINT_CONTABLE_BACKUP_PATH = (process.env.SHAREPOINT_CONTABLE_BACKUP_PATH || '').replace(/^\/+/, '');
const SHAREPOINT_CONTABLE_FULL_BACKUP_PATH = (process.env.SHAREPOINT_CONTABLE_FULL_BACKUP_PATH || (SHAREPOINT_CONTABLE_BACKUP_PATH ? path.posix.join(path.posix.dirname(SHAREPOINT_CONTABLE_BACKUP_PATH), 'backup-completo-incognito-contable.json') : '')).replace(/^\/+/, '');
const SHAREPOINT_CONTABLE_AUTO_BACKUP = String(process.env.SHAREPOINT_CONTABLE_AUTO_BACKUP || process.env.SHAREPOINT_AUTO_BACKUP || '').toLowerCase() === 'true';
const WHATSAPP_GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v25.0';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || '';
const WHATSAPP_TEMPLATE_TRACKING_NAME = process.env.WHATSAPP_TEMPLATE_TRACKING_NAME || '';
const WHATSAPP_TEMPLATE_FLUX_NAME = process.env.WHATSAPP_TEMPLATE_FLUX_NAME || '';
const WHATSAPP_TEMPLATE_CONFIRMATION_NAME = process.env.WHATSAPP_TEMPLATE_CONFIRMATION_NAME || '';
const WHATSAPP_TEMPLATE_CONFIRMATION_CASH_DEFAULT = 'nueva_plantilla_de_whatsapp_28_07_2026_10_39_o7lafq';
const WHATSAPP_TEMPLATE_CONFIRMATION_CASH_NAME = process.env.WHATSAPP_TEMPLATE_CONFIRMATION_CASH_NAME || WHATSAPP_TEMPLATE_CONFIRMATION_CASH_DEFAULT || WHATSAPP_TEMPLATE_CONFIRMATION_NAME;
const WHATSAPP_TEMPLATE_ORDER_CONTACT_NAME = process.env.WHATSAPP_TEMPLATE_ORDER_CONTACT_NAME || WHATSAPP_TEMPLATE_CONFIRMATION_NAME;
const WHATSAPP_TEMPLATE_LANGUAGE = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'es';
const WHATSAPP_SEND_ENGINE = 'kommo';
const KOMMO_TEST_ENABLED = String(process.env.KOMMO_TEST_ENABLED || 'false').toLowerCase() === 'true';
const KOMMO_TEST_PHONE_ALLOWLIST = process.env.KOMMO_TEST_PHONE_ALLOWLIST || '';
const KOMMO_CONFIG = kommoConfigFromEnv(process.env);
const MAYORISTA_CATALOG_URL = process.env.MAYORISTA_CATALOG_URL || 'https://incognito-mayorista.onrender.com/catalogo/productos.json';
const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN || '';
const MERCADOPAGO_MV_ACCESS_TOKEN = process.env.MERCADOPAGO_MV_ACCESS_TOKEN || '';
const mercadoPagoRequestContext = new AsyncLocalStorage();
const andreaniBranchCache = new Map();
const kommoWhatsappService = new KommoService(KOMMO_CONFIG);
let sharePointTokenCache = { token: '', expiresAt: 0 };
let lastSharePointAutoBackupDate = '';
let lastSharePointContableAutoBackupDate = '';

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: false }));

function parseCookies(header = '') {
  return header.split(';').reduce((cookies, part) => {
    const [key, ...valueParts] = part.trim().split('=');
    if (!key) return cookies;
    cookies[key] = decodeURIComponent(valueParts.join('=') || '');
    return cookies;
  }, {});
}

function sessionSignature() {
  const secret = process.env.APP_SESSION_SECRET || process.env.VENTAS_APP_PASSWORD || 'local-dev';
  return crypto
    .createHmac('sha256', secret)
    .update(process.env.VENTAS_APP_PASSWORD || '')
    .digest('hex');
}

function isAuthenticated(req) {
  if (!process.env.VENTAS_APP_PASSWORD) return true;
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies.ventas_session === sessionSignature();
}

function stampsSecretMatches(req) {
  const expected = String(STAMPS_API_SECRET || '');
  const received = String(req.get('x-stamps-api-secret') || '');
  if (!expected || !received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function rawOrderItems(order = {}) {
  return Array.isArray(order.items) && order.items.length
    ? order.items
    : [{
        sku: order.sku,
        name: order.name,
        color: order.color,
        size: order.size,
        talle: order.talle,
        quantity: order.quantity,
        imageUrl: order.imageUrl,
        picked: Boolean(order.picked),
        pickStatus: order.pickStatus || (order.picked ? 'armado' : '')
      }];
}

function stampPendingItemStatus(item = {}) {
  return String(item.pickStatus || (item.picked ? 'armado' : '')).trim().toLowerCase();
}

function isPendingPrintDtfSku(sku) {
  return String(sku || '').trim().toUpperCase().endsWith('DTF');
}

function cleanPendingPrintSize(value) {
  const text = String(value || '').trim();
  const normalized = text.toUpperCase().replace(/^TALLE\s*/i, '').replace(/\s+/g, '');
  if (['S', 'M', 'L', 'XL', 'XXL'].includes(normalized)) return normalized;
  if (normalized === '2XL') return 'XXL';
  return text;
}

function pendingPrintPedidoId(order = {}) {
  return String(order.internalOrderNumber || order.orderNumber || order.storeOrderNumber || order.id || '').trim();
}

function pendingPrintRowsFromState(state = {}) {
  const sourceOrders = [
    ...(Array.isArray(state.orders) ? state.orders : []),
    ...(Array.isArray(state.exchanges) ? state.exchanges : [])
  ];

  return sourceOrders
    .filter((order) =>
      order &&
      order.status === 'preparacion' &&
      !order.cancelled &&
      order.status !== 'cancelado' &&
      !order.clearedFromBoard
    )
    .flatMap((order) => {
      const pedidoId = pendingPrintPedidoId(order);
      return rawOrderItems(order)
        .map((item, index) => ({ order, item, index }))
        .filter(({ item }) => isPendingPrintDtfSku(item.sku) && stampPendingItemStatus(item) !== 'armado')
        .map(({ order, item, index }) => {
          const sku = String(item.sku || '').trim();
          const talle = cleanPendingPrintSize(item.size || item.talle || '');
          return {
            pedidoId,
            itemRef: `${pedidoId}:${index + 1}:${sku}:${talle}`,
            sku,
            nombre: String(item.name || order.name || sku || '').trim(),
            talle,
            color: String(item.color || order.color || '').trim(),
            cantidad: Number(item.quantity || 1),
            imagen: String(item.imageUrl || order.imageUrl || '').trim(),
            cliente: String(order.customer || order.client || order.customerName || '').trim()
          };
        });
    })
    .sort((left, right) => {
      const leftNumber = Number(left.pedidoId);
      const rightNumber = Number(right.pedidoId);
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
      }
      return String(left.pedidoId).localeCompare(String(right.pedidoId), 'es');
    });
}

function loginPage(error = '') {
  return `<!doctype html>
  <html lang="es">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Ingresar - Ventas</title>
      <style>
        * { box-sizing: border-box; }
        body {
          min-height: 100vh;
          margin: 0;
          display: grid;
          place-items: center;
          background: #f9fafb;
          color: #111827;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        form {
          width: min(92vw, 380px);
          background: #fff;
          border-radius: 10px;
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.10);
          padding: 24px;
        }
        h1 { font-size: 1.2rem; margin: 0 0 6px; }
        p { color: #6b7280; font-size: 0.9rem; margin: 0 0 18px; }
        label { display: grid; gap: 7px; font-weight: 600; }
        input {
          border: 1px solid #d1d5db;
          border-radius: 8px;
          font: inherit;
          min-height: 42px;
          padding: 8px 12px;
        }
        button {
          width: 100%;
          min-height: 42px;
          margin-top: 14px;
          border: 1px solid #6c3fc5;
          border-radius: 8px;
          background: #6c3fc5;
          color: #fff;
          cursor: pointer;
          font: inherit;
          font-weight: 700;
        }
        .error {
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 8px;
          color: #b91c1c;
          margin-bottom: 12px;
          padding: 9px 10px;
        }
      </style>
    </head>
    <body>
      <form method="post" action="login">
        <h1>Tablero de ventas</h1>
        <p>Ingresa la contrasena para continuar.</p>
        ${error ? `<div class="error">${error}</div>` : ''}
        <label>
          Contrasena
          <input name="password" type="password" autocomplete="current-password" autofocus required>
        </label>
        <button type="submit">Ingresar</button>
      </form>
    </body>
  </html>`;
}

app.get('/login', (req, res) => {
  if (isAuthenticated(req)) return res.redirect((req.baseUrl || '') + '/');
  res.send(loginPage());
});

app.post('/login', (req, res) => {
  if (!process.env.VENTAS_APP_PASSWORD) return res.redirect((req.baseUrl || '') + '/');
  if (String(req.body.password || '') !== process.env.VENTAS_APP_PASSWORD) {
    return res.status(401).send(loginPage('Contrasena incorrecta.'));
  }
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader(
    'Set-Cookie',
    `ventas_session=${sessionSignature()}; HttpOnly; SameSite=Lax; Path=${req.baseUrl || '/'}; Max-Age=2592000${secure ? '; Secure' : ''}`
  );
  res.redirect((req.baseUrl || '') + '/');
});

app.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', `ventas_session=; HttpOnly; SameSite=Lax; Path=${req.baseUrl || '/'}; Max-Age=0`);
  res.redirect((req.baseUrl || '') + '/login');
});

function setMercadoPagoCors(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sanitizePaymentIds(ids) {
  return Array.from(new Set((Array.isArray(ids) ? ids : [])
    .map((id) => String(id || '').trim())
    .filter((id) => /^\d{6,}$/.test(id))))
    .slice(0, 200);
}

function toISODate(value, fallback) {
  const s = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback;
}

function addDaysISO(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function argentinaTodayISO() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date()).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function argentinaISODateFrom(value) {
  const d = new Date(value || '');
  if (Number.isNaN(d.getTime())) return String(value || '').slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function minISODate(a, b) {
  return a <= b ? a : b;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',' || ch === ';') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => String(h || '').trim());
  return rows.slice(1).map((cells) => headers.reduce((obj, header, idx) => {
    obj[header] = cells[idx] || '';
    return obj;
  }, {}));
}

function parseMpAmount(value) {
  if (typeof value === 'number') return value;
  let s = String(value || '').trim().replace(/\s/g, '').replace(/\$/g, '');
  if (!s) return 0;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function isPastDateTime(value) {
  const t = Date.parse(value || '');
  return Number.isFinite(t) && t <= Date.now();
}

function normalizeMercadoPagoAccount(value) {
  const account = String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (account === 'MP MV' || account === 'MV' || account === 'MARIANO') return 'MP MV';
  return 'MP FB';
}

function getMercadoPagoAccessToken(account) {
  const normalized = normalizeMercadoPagoAccount(account);
  if (normalized === 'MP MV') return MERCADOPAGO_MV_ACCESS_TOKEN;
  return MERCADOPAGO_ACCESS_TOKEN;
}

function getCurrentMercadoPagoAccount() {
  return (mercadoPagoRequestContext.getStore() || {}).account || 'MP FB';
}

function withMercadoPagoAccount(account, fn) {
  return mercadoPagoRequestContext.run({ account: normalizeMercadoPagoAccount(account) }, fn);
}

async function mercadoPagoFetch(pathname, options = {}) {
  const token = getMercadoPagoAccessToken(getCurrentMercadoPagoAccount());
  if (!token) {
    throw new Error(`Falta token de Mercado Pago para ${getCurrentMercadoPagoAccount()} en Render.`);
  }
  const response = await fetch(`https://api.mercadopago.com${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json, text/csv, */*',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Mercado Pago HTTP ${response.status}`);
  }
  return text;
}

async function createMercadoPagoReleaseReport(from, to) {
  const body = JSON.stringify({
    begin_date: `${from}T00:00:00Z`,
    end_date: `${to}T23:59:59Z`,
    check_available_balance: true
  });
  const text = await mercadoPagoFetch('/v1/account/release_report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  return JSON.parse(text);
}

async function getMercadoPagoPaymentRelease(paymentId) {
  const text = await mercadoPagoFetch(`/v1/payments/${encodeURIComponent(paymentId)}`, { method: 'GET' });
  const payment = JSON.parse(text);
  const releaseDate = payment.money_release_date || '';
  const amount = parseMpAmount(payment.transaction_details && payment.transaction_details.net_received_amount);
  if (String(payment.status || '').toLowerCase() !== 'approved') return null;
  if (!isPastDateTime(releaseDate)) return null;
  if (amount <= 0) return null;
  return {
    SOURCE_ID: String(payment.id || paymentId),
    RECORD_TYPE: 'release',
    DESCRIPTION: 'payment_fallback',
    NET_CREDIT_AMOUNT: amount,
    DATE: String(releaseDate).slice(0, 10),
    FILE_NAME: 'payments-api'
  };
}

function getReportFileName(payload) {
  const direct = payload && (payload.file_name || payload.filename || payload.name || payload.fileName || '');
  if (direct) return direct;
  const files = payload && Array.isArray(payload.files) ? payload.files : [];
  const first = files.find((file) => file && (file.file_name || file.filename || file.name || file.fileName));
  return first ? (first.file_name || first.filename || first.name || first.fileName || '') : '';
}

function getReportTaskId(payload) {
  return payload && (payload.id || payload.task_id || payload.taskId || '');
}

async function waitForMercadoPagoReport(payload) {
  let fileName = getReportFileName(payload);
  const taskId = getReportTaskId(payload);
  for (let i = 0; i < 24 && !fileName && taskId; i += 1) {
    await sleep(2500);
    const taskText = await mercadoPagoFetch(`/v1/account/release_report/task/${encodeURIComponent(taskId)}`, { method: 'GET' });
    const task = JSON.parse(taskText);
    fileName = getReportFileName(task);
  }
  return fileName;
}

function dateValue(value) {
  const t = Date.parse(value || '');
  return Number.isFinite(t) ? t : 0;
}

function argentinaDateTimeISO(dateStr, endOfDay = false) {
  return `${dateStr}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}-03:00`;
}

function isUnreleasedMercadoPagoPayment(payment) {
  if (String(payment && payment.status || '').toLowerCase() !== 'approved') return false;
  const status = String(payment.money_release_status || '').toLowerCase();
  if (status === 'pending') return true;
  const releaseDate = String(payment.money_release_date || '');
  if (!releaseDate || releaseDate.toLowerCase() === 'pending') return true;
  if (releaseDate.toLowerCase() === 'released') return false;
  const releaseAt = Date.parse(releaseDate);
  return Number.isFinite(releaseAt) && releaseAt > Date.now();
}

async function searchMercadoPagoPayments(params) {
  const query = new URLSearchParams(params);
  const text = await mercadoPagoFetch(`/v1/payments/search?${query.toString()}`, { method: 'GET' });
  return JSON.parse(text);
}

async function getMercadoPagoUnreleasedBalance(from, to) {
  const payments = [];
  const limit = 100;
  for (let offset = 0; offset < 1000; offset += limit) {
    const payload = await searchMercadoPagoPayments({
      status: 'approved',
      sort: 'date_created',
      criteria: 'desc',
      range: 'date_created',
      begin_date: argentinaDateTimeISO(from, false),
      end_date: argentinaDateTimeISO(to, true),
      limit: String(limit),
      offset: String(offset)
    });
    const results = Array.isArray(payload.results) ? payload.results : [];
    payments.push(...results);
    const total = Number(payload.paging && payload.paging.total) || results.length;
    if (results.length < limit || offset + limit >= total) break;
  }

  const unreleased = payments
    .filter(isUnreleasedMercadoPagoPayment)
    .map((payment) => {
      const amount = parseMpAmount(payment.transaction_details && payment.transaction_details.net_received_amount)
        || parseMpAmount(payment.transaction_amount);
      return {
        id: String(payment.id || ''),
        amount,
        releaseDate: payment.money_release_date || '',
        releaseStatus: payment.money_release_status || '',
        dateCreated: payment.date_created || '',
        externalReference: payment.external_reference || ''
      };
    })
    .filter((payment) => payment.amount > 0);

  const total = unreleased.reduce((sum, payment) => sum + payment.amount, 0);
  return { total, count: unreleased.length, payments: unreleased };
}

async function findMercadoPagoReleaseReports(from, to) {
  const text = await mercadoPagoFetch('/v1/account/release_report/list', { method: 'GET' });
  const reports = JSON.parse(text);
  if (!Array.isArray(reports)) return { fileNames: [], coversRange: false };

  const fromAt = dateValue(`${from}T00:00:00Z`);
  const toAt = dateValue(`${to}T23:59:59Z`);
  const releaseReports = reports
    .filter((report) => report && report.file_name)
    .filter((report) => String(report.subtype || report.sub_type || '').toLowerCase() === 'release')
    .filter((report) => String(report.status || '').toLowerCase() === 'enabled')
    .sort((a, b) => dateValue(b.date_created || b.generation_date) - dateValue(a.date_created || a.generation_date));

  const selected = [];
  releaseReports
    .filter((report) => dateValue(report.begin_date) <= toAt && dateValue(report.end_date) >= fromAt)
    .forEach((report) => selected.push(report.file_name));

  releaseReports.slice(0, 8).forEach((report) => selected.push(report.file_name));

  const coversRange = releaseReports.some((report) => {
    return dateValue(report.begin_date) <= fromAt && dateValue(report.end_date) >= toAt;
  });

  return { fileNames: Array.from(new Set(selected)).slice(0, 8), coversRange };
}

async function createMercadoPagoSettlementReport(from, to) {
  const body = JSON.stringify({
    begin_date: `${from}T00:00:00Z`,
    end_date: `${to}T23:59:59Z`
  });
  const text = await mercadoPagoFetch('/v1/account/settlement_report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  return JSON.parse(text);
}

async function getMercadoPagoSettlementConfig() {
  const text = await mercadoPagoFetch('/v1/account/settlement_report/config', { method: 'GET' });
  return JSON.parse(text);
}

function parseMercadoPagoAvailableBalanceRow(row, fileName) {
  const recordType = String(row.RECORD_TYPE || '').trim().toLowerCase();
  const description = String(row.DESCRIPTION || '').trim().toLowerCase();
  const date = String(row.DATE || row.RELEASE_DATE || row.TRANSACTION_DATE || '').slice(0, 10);
  const balance = parseMpAmount(
    row.BALANCE_AMOUNT
    || row.AVAILABLE_BALANCE
    || row.TOTAL_AVAILABLE_BALANCE
    || row.NET_CREDIT_AMOUNT
    || row.NET_AMOUNT
  );
  const looksLikeBalance = recordType.includes('balance')
    || recordType === 'total'
    || description.includes('available_balance')
    || description.includes('saldo')
    || row.BALANCE_AMOUNT
    || row.AVAILABLE_BALANCE
    || row.TOTAL_AVAILABLE_BALANCE;
  if (!looksLikeBalance || !date || !Number.isFinite(balance) || balance <= 0) return null;
  return {
    date,
    balance,
    recordType: row.RECORD_TYPE || '',
    description: row.DESCRIPTION || '',
    fileName
  };
}

function isMercadoPagoConfigNotFoundError(err) {
  const message = String(err && err.message || '');
  return message.includes('config_not_found_for_user') || message.includes('Configuration not found for user');
}

async function ensureMercadoPagoSettlementIncludesWithdraw() {
  const requiredColumns = [
    'SOURCE_ID',
    'PAYMENT_METHOD_TYPE',
    'TRANSACTION_TYPE',
    'TRANSACTION_AMOUNT',
    'SETTLEMENT_NET_AMOUNT',
    'TRANSACTION_DATE',
    'FEE_AMOUNT',
    'SETTLEMENT_DATE',
    'REAL_AMOUNT',
    'TAXES_AMOUNT',
    'BUSINESS_UNIT',
    'SUB_UNIT',
    'MONEY_RELEASE_DATE',
    'EXTERNAL_REFERENCE',
    'DESCRIPTION',
    'SHIPPING_ID',
    'SHIPMENT_MODE',
    'ORDER_ID',
    'SEGMENT_DETAIL',
    'SALE_DETAIL',
    'TRANSACTION_DATE_SHORT',
    'SETTLEMENT_DATE_SHORT',
    'MONEY_RELEASE_DATE_SHORT',
    'PAYER_NAME',
    'METADATA',
    'POI_WALLET_NAME',
    'POI_BANK_NAME',
    'OPERATION_TAGS',
    'PRODUCT_SKU',
    'ORDER_MP',
    'TRANSACTION_INTENT_ID',
    'PURCHASE_ID',
    'SHIPPING_ORDER_ID'
  ];
  let config;
  try {
    config = await getMercadoPagoSettlementConfig();
  } catch (err) {
    if (!isMercadoPagoConfigNotFoundError(err)) throw err;
    const body = JSON.stringify({
      file_name_prefix: `settlement-report-${getCurrentMercadoPagoAccount().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      include_withdraw: true,
      shipping_detail: true,
      display_timezone: 'GMT-03',
      report_translation: 'es',
      header_language: 'es',
      scheduled: false,
      frequency: { format: 'CSV', hour: 0, type: 'daily', value: null },
      columns: requiredColumns.map((key) => ({ key }))
    });
    await mercadoPagoFetch('/v1/account/settlement_report/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    return true;
  }
  const currentColumns = Array.isArray(config.columns) ? config.columns : [];
  const currentKeys = new Set(currentColumns.map((column) => String(column && column.key || '').trim()).filter(Boolean));
  const missingColumns = requiredColumns.filter((key) => !currentKeys.has(key));
  if (config && config.include_withdraw === true && !missingColumns.length) return false;
  const body = JSON.stringify({
    file_name_prefix: config.file_name_prefix,
    include_withdraw: true,
    shipping_detail: Boolean(config.shipping_detail),
    display_timezone: config.display_timezone || 'GMT-03',
    frequency: config.frequency || { format: 'CSV', hour: 0, type: 'daily', value: null },
    columns: currentColumns.concat(missingColumns.map((key) => ({ key })))
  });
  await mercadoPagoFetch('/v1/account/settlement_report/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  return true;
}

async function waitForMercadoPagoSettlementReport(payload) {
  let fileName = getReportFileName(payload);
  const taskId = getReportTaskId(payload);
  for (let i = 0; i < 15 && !fileName && taskId; i += 1) {
    await sleep(4000);
    const taskText = await mercadoPagoFetch(`/v1/account/settlement_report/task/${encodeURIComponent(taskId)}`, { method: 'GET' });
    const task = JSON.parse(taskText);
    fileName = getReportFileName(task);
  }
  return fileName;
}

async function findMercadoPagoSettlementReports(from, to) {
  const text = await mercadoPagoFetch('/v1/account/settlement_report/list', { method: 'GET' });
  const reports = JSON.parse(text);
  if (!Array.isArray(reports)) return { fileNames: [], coversRange: false };

  const fromAt = dateValue(`${from}T00:00:00Z`);
  const toAt = dateValue(`${to}T23:59:59Z`);
  const settlementReports = reports
    .filter((report) => report && report.file_name)
    .filter((report) => String(report.subtype || report.sub_type || report.report_type || '').toLowerCase() === 'settlement')
    .filter((report) => ['enabled', 'processed'].includes(String(report.status || '').toLowerCase()))
    .filter((report) => /\.csv$/i.test(String(report.file_name || '')))
    .sort((a, b) => dateValue(b.date_created || b.generation_date) - dateValue(a.date_created || a.generation_date));

  const selected = [];
  const overlappingReports = settlementReports
    .filter((report) => dateValue(report.begin_date) <= toAt && dateValue(report.end_date) >= fromAt);

  overlappingReports
    .forEach((report) => selected.push(report.file_name));

  settlementReports.slice(0, 8).forEach((report) => selected.push(report.file_name));

  const coveringReports = settlementReports.filter((report) => {
    return dateValue(report.begin_date) <= fromAt && dateValue(report.end_date) >= toAt;
  });
  const coversRange = coveringReports.length > 0;
  const latestCoveringReport = coveringReports[0] || null;

  return {
    fileNames: Array.from(new Set(selected)),
    coversRange,
    latestFileName: latestCoveringReport && latestCoveringReport.file_name || '',
    latestCreatedAt: latestCoveringReport && (latestCoveringReport.date_created || latestCoveringReport.generation_date) || ''
  };
}

function normalizeMpSettlementDate(row) {
  return String(
    row.TRANSACTION_DATE_SHORT
    || row.TRANSACTION_DATE
    || row.DATE
    || row.SETTLEMENT_DATE_SHORT
    || row.SETTLEMENT_DATE
    || row.MONEY_RELEASE_DATE_SHORT
    || row.MONEY_RELEASE_DATE
    || ''
  ).slice(0, 10);
}

function isRecentMercadoPagoSettlementRange(to, today) {
  return to >= addDaysISO(today, -2);
}

function isFreshMercadoPagoReport(createdAt) {
  const created = dateValue(createdAt);
  if (!Number.isFinite(created)) return false;
  return Date.now() - created <= 10 * 60 * 1000;
}

function cleanMpText(value) {
  let text = String(value || '').trim();
  if (!text || text.toLowerCase() === 'null') return '';
  text = text.replace(/^"+|"+$/g, '').replace(/\\"/g, '"').trim();
  return text;
}

function getMpMovementDetail(row) {
  return cleanMpText(row.DESCRIPTION)
    || cleanMpText(row.SALE_DETAIL)
    || cleanMpText(row.SEGMENT_DETAIL)
    || cleanMpText(row.PRODUCT_SKU)
    || cleanMpText(row.PAYER_NAME)
    || cleanMpText(row.EXTERNAL_REFERENCE)
    || cleanMpText(row.POI_WALLET_NAME)
    || cleanMpText(row.POI_BANK_NAME)
    || cleanMpText(row.OPERATION_TAGS)
    || cleanMpText(row.METADATA)
    || cleanMpText(row.SHIPMENT_MODE)
    || '';
}

function isMercadoPagoSaleSettlement(row, amount) {
  const transactionType = String(row.TRANSACTION_TYPE || row.RECORD_TYPE || row.DESCRIPTION || '').trim().toUpperCase();
  const businessUnit = String(row.BUSINESS_UNIT || '').trim().toLowerCase();
  const subUnit = String(row.SUB_UNIT || '').trim().toLowerCase();
  const paymentMethodType = String(row.PAYMENT_METHOD_TYPE || '').trim();
  const detailText = [
    row.DESCRIPTION,
    row.SEGMENT_DETAIL,
    row.SALE_DETAIL,
    row.EXTERNAL_REFERENCE,
    row.PRODUCT_SKU,
    row.PAYER_NAME,
    row.POI_WALLET_NAME,
    row.POI_BANK_NAME,
    row.OPERATION_TAGS,
    row.METADATA,
    row.ORDER_ID,
    row.SHIPPING_ID,
    row.SHIPMENT_MODE
  ].map(cleanMpText).join(' ').toLowerCase();
  const looksLikeOperationalMovement = [
    'andreani',
    'micorreo',
    'mi correo',
    'correo argentino',
    'paquetes',
    'transferencia',
    'intra mp',
    'payout',
    'withdraw',
    'asset_management',
    'rendimiento',
    'mercado libre'
  ].some((term) => detailText.includes(term));
  if (looksLikeOperationalMovement) return false;
  return transactionType === 'SETTLEMENT'
    && amount > 0
    && businessUnit === 'mercado pago'
    && subUnit.includes('checkout')
    && Boolean(paymentMethodType);
}

function describeMpMovementType(type, amount, isSale) {
  const t = String(type || '').toUpperCase();
  if (t.includes('SHIPPING')) return 'Envio Mercado Pago';
  if (t.includes('WITHDRAWAL') || t.includes('PAYOUT')) return 'Retiro Mercado Pago';
  if (t.includes('REFUND')) return 'Devolucion Mercado Pago';
  if (t.includes('CHARGEBACK') || t.includes('DISPUTE') || t.includes('MEDIATION')) return 'Reclamo Mercado Pago';
  if (t.includes('CREDIT') || t.includes('GAIN') || t.includes('CASHBACK')) return 'Credito Mercado Pago';
  if (t.includes('SETTLEMENT') && isSale) return 'Venta Mercado Pago';
  if (t.includes('SETTLEMENT') && amount < 0) return 'Debito Mercado Pago';
  if (t.includes('SETTLEMENT')) return 'Credito Mercado Pago';
  return `Movimiento Mercado Pago ${t || 'sin tipo'}`;
}

function isShippingLikeMovement(row) {
  const externalReference = cleanMpText(row.EXTERNAL_REFERENCE).toLowerCase();
  const saleDetail = cleanMpText(row.SALE_DETAIL).toLowerCase();
  const shipmentMode = cleanMpText(row.SHIPMENT_MODE).toLowerCase();
  return externalReference.includes('envio')
    || saleDetail.includes('micorreo')
    || saleDetail.includes('correo argentino')
    || saleDetail.includes('andreani')
    || saleDetail.includes('paquetes')
    || Boolean(shipmentMode);
}

function applyIncognitoMovementRules(descriptionBase, detail, category, transactionType) {
  const text = `${descriptionBase} ${detail}`.toLowerCase();
  if (text.includes('mi correo') || text.includes('micorreo') || text.includes('correo argentino')) {
    return { description: 'Correo Argentino', category: 'Envíos' };
  }
  if (text.includes('andreani') || (descriptionBase.toLowerCase().includes('envio mercado pago') && text.includes('paquetes'))) {
    return { description: 'Andreani', category: 'Envíos' };
  }
  if (text.includes('mercado libre') && text.includes('compra')) {
    return { description: 'Mercado Libre', category: 'Productos' };
  }
  if (text.includes('transferencia enviada') || text.includes('intra mp')) {
    return { description: detail ? `Transferencia enviada Mercado Pago - ${detail}` : 'Transferencia enviada Mercado Pago', category: 'Productos' };
  }
  if (descriptionBase.toLowerCase().includes('credito mercado pago')) {
    return { description: 'Rendimientos', category };
  }
  if (String(transactionType || '').toUpperCase().includes('PAYOUT') || descriptionBase.toLowerCase().includes('retiro mercado pago')) {
    return { description: 'Retiro Mercado Pago', category: 'Productos' };
  }
  return {
    description: `${descriptionBase}${detail ? ` - ${detail}` : ''}`,
    category
  };
}

function categorizeMpMovementType(type, amount, isSale, row) {
  const t = String(type || '').toUpperCase();
  const text = `${getMpMovementDetail(row)} ${row.DESCRIPTION || ''} ${row.SEGMENT_DETAIL || ''}`.toLowerCase();
  if (t.includes('SHIPPING') || isShippingLikeMovement(row)) return 'Envíos';
  if (t.includes('REFUND') || t.includes('CHARGEBACK') || t.includes('DISPUTE') || t.includes('MEDIATION')) return 'Devolución';
  if (text.includes('mercado libre') && text.includes('compra')) return 'Productos';
  if (text.includes('transferencia enviada') || text.includes('intra mp')) return 'Productos';
  if (t.includes('SETTLEMENT') && isSale) return 'Venta de producto';
  return 'Otros';
}

function isMercadoPagoShippingPayment(payment) {
  const text = `${payment.description || ''} ${payment.external_reference || ''}`.toLowerCase();
  return String(payment.status || '').toLowerCase() === 'approved'
    && String(payment.operation_type || '').toLowerCase() === 'regular_payment'
    && String(payment.payment_type_id || '').toLowerCase() === 'account_money'
    && (
      text.includes('paquetes')
      || text.includes('andreani')
      || text.includes('micorreo')
      || text.includes('mi correo')
      || text.includes('correo argentino')
      || text.includes('envio')
      || text.includes('envío')
    );
}

const mercadoPagoUserIdCache = new Map();

async function getMercadoPagoUserId() {
  const account = getCurrentMercadoPagoAccount();
  if (mercadoPagoUserIdCache.has(account)) return mercadoPagoUserIdCache.get(account);
  const text = await mercadoPagoFetch('/users/me', { method: 'GET' });
  const user = JSON.parse(text);
  const ownerId = String(user.id || '').trim();
  mercadoPagoUserIdCache.set(account, ownerId);
  return ownerId;
}

async function searchMercadoPagoPaymentsByDate(from, to) {
  const results = [];
  const limit = 100;
  for (let offset = 0; offset < 1000; offset += limit) {
    const params = new URLSearchParams({
      sort: 'date_created',
      criteria: 'desc',
      range: 'date_created',
      begin_date: `${from}T00:00:00.000-03:00`,
      end_date: `${to}T23:59:59.999-03:00`,
      limit: String(limit),
      offset: String(offset)
    });
    const text = await mercadoPagoFetch(`/v1/payments/search?${params.toString()}`, { method: 'GET' });
    const data = JSON.parse(text);
    const page = Array.isArray(data.results) ? data.results : [];
    results.push(...page);
    if (page.length < limit) break;
  }
  return results;
}

function mercadoPagoPaymentText(payment) {
  const payerName = `${payment.payer && payment.payer.first_name || ''} ${payment.payer && payment.payer.last_name || ''}`.trim();
  const collectorName = `${payment.collector && payment.collector.first_name || ''} ${payment.collector && payment.collector.last_name || ''}`.trim();
  return [
    payment.description,
    payment.external_reference,
    payment.statement_descriptor,
    payment.operation_type,
    payment.payment_type_id,
    payerName,
    collectorName,
    payment.collector && payment.collector.nickname,
    payment.additional_info && payment.additional_info.payer && payment.additional_info.payer.first_name,
    payment.additional_info && payment.additional_info.payer && payment.additional_info.payer.last_name
  ].filter(Boolean).join(' ');
}

function mercadoPagoPaymentLabel(payment) {
  const payerName = `${payment.payer && payment.payer.first_name || ''} ${payment.payer && payment.payer.last_name || ''}`.trim();
  const collectorName = `${payment.collector && payment.collector.first_name || ''} ${payment.collector && payment.collector.last_name || ''}`.trim();
  const collectorId = String(payment.collector_id || payment.collector && payment.collector.id || '').trim();
  const knownCollectors = {
    '2440761733': 'SUBE Viajes',
    '3636756131': 'Mercado Libre'
  };
  return cleanMpText(payment.description)
    || cleanMpText(payment.statement_descriptor)
    || cleanMpText(knownCollectors[collectorId])
    || cleanMpText(payment.external_reference)
    || cleanMpText(collectorName)
    || cleanMpText(payment.collector && payment.collector.nickname)
    || cleanMpText(payerName)
    || '';
}

function isMercadoPagoTechnicalReference(value) {
  const text = cleanMpText(value);
  return /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(text)
    || /^\d{10,}$/.test(text);
}

function isMercadoPagoOutgoingPayment(payment, ownerId) {
  const status = String(payment.status || '').toLowerCase();
  const payerId = String(payment.payer && payment.payer.id || '').trim();
  const collectorId = String(payment.collector_id || payment.collector && payment.collector.id || '').trim();
  const amount = parseMpAmount(payment.transaction_amount);
  if (status !== 'approved' || amount <= 0) return false;
  if (!ownerId || payerId !== ownerId || collectorId === ownerId) return false;
  return true;
}

function normalizeMercadoPagoOutgoingPayment(payment) {
  const sourceId = String(payment.id || '').trim();
  const amount = parseMpAmount(payment.transaction_amount);
  const text = mercadoPagoPaymentText(payment).toLowerCase();
  const isCorreo = text.includes('micorreo') || text.includes('mi correo') || text.includes('correo argentino');
  const isAndreani = text.includes('andreani') || text.includes('paquetes');
  const isTransfer = text.includes('transferencia') || text.includes('money_transfer') || String(payment.operation_type || '').toLowerCase().includes('transfer');
  const isMercadoLibre = text.includes('mercado libre');
  const isSube = text.includes('sube');
  const label = mercadoPagoPaymentLabel(payment);
  const labelText = label.toLowerCase();
  const safeLabel = label && !isMercadoPagoTechnicalReference(label) ? label : '';
  let transactionType = 'PAYMENT';
  let categoria = 'Otros';
  let descripcion = `${safeLabel || 'Pago Mercado Pago'} | ${sourceId}`;
  if (isCorreo) {
    categoria = 'Envíos';
    descripcion = `Correo Argentino | ${sourceId}`;
  } else if (isAndreani) {
    categoria = 'Envíos';
    descripcion = `Andreani | ${sourceId}`;
  } else if (isSube || labelText.includes('sube')) {
    categoria = 'Otros';
    descripcion = `SUBE Viajes | ${sourceId}`;
  } else if (isTransfer) {
    transactionType = 'TRANSFER';
    categoria = 'Productos';
    descripcion = `${safeLabel ? `${safeLabel} - ` : ''}Transferencia enviada Mercado Pago | ${sourceId}`;
  } else if (isMercadoLibre || labelText.includes('mercado libre')) {
    categoria = 'Productos';
    descripcion = `Mercado Libre | ${sourceId}`;
  }
  return {
    sourceId,
    transactionType,
    isSale: false,
    date: argentinaISODateFrom(payment.date_created || payment.date_approved || ''),
    amount: -Math.abs(amount),
    ingreso: 0,
    egreso: Math.abs(amount),
    categoria,
    cuenta: 'MP FB',
    descripcion,
    fileName: 'payments_search_outgoing',
    raw: {
      SOURCE_ID: sourceId,
      TRANSACTION_TYPE: transactionType,
      TRANSACTION_AMOUNT: amount,
      REAL_AMOUNT: -Math.abs(amount),
      TRANSACTION_DATE: payment.date_created || '',
      DESCRIPTION: payment.description || '',
      EXTERNAL_REFERENCE: payment.external_reference || '',
      PAYMENT_METHOD_TYPE: payment.payment_type_id || '',
      OPERATION_TYPE: payment.operation_type || '',
      PAYER_ID: payment.payer && payment.payer.id || '',
      COLLECTOR_ID: payment.collector_id || payment.collector && payment.collector.id || ''
    }
  };
}

function isMercadoPagoIntraTransfer(row, amount) {
  const transactionType = String(row.TRANSACTION_TYPE || row.RECORD_TYPE || row.DESCRIPTION || '').trim().toUpperCase();
  const segmentDetail = cleanMpText(row.SEGMENT_DETAIL).toLowerCase();
  return transactionType === 'SETTLEMENT'
    && amount < 0
    && segmentDetail.includes('intra mp');
}

function normalizeMercadoPagoShippingPayment(payment) {
  const sourceId = String(payment.id || '').trim();
  const amount = parseMpAmount(payment.transaction_amount);
  const text = `${payment.description || ''} ${payment.external_reference || ''}`.toLowerCase();
  const isCorreo = text.includes('micorreo') || text.includes('mi correo') || text.includes('correo argentino');
  const isAndreani = text.includes('andreani') || text.includes('paquetes');
  const label = mercadoPagoPaymentLabel(payment);
  const descripcion = isCorreo
    ? 'Correo Argentino'
    : isAndreani
      ? 'Andreani'
      : (label || 'Envio Mercado Pago');
  return {
    sourceId,
    transactionType: 'PAYMENT',
    isSale: false,
    date: argentinaISODateFrom(payment.date_created || payment.date_approved || ''),
    amount: -Math.abs(amount),
    ingreso: 0,
    egreso: Math.abs(amount),
    categoria: 'Envíos',
    cuenta: 'MP FB',
    descripcion: `${descripcion} | ${sourceId}`,
    fileName: 'payments_search',
    raw: {
      SOURCE_ID: sourceId,
      TRANSACTION_TYPE: 'PAYMENT',
      TRANSACTION_AMOUNT: amount,
      REAL_AMOUNT: amount,
      TRANSACTION_DATE: payment.date_created || '',
      DESCRIPTION: payment.description || '',
      EXTERNAL_REFERENCE: payment.external_reference || '',
      PAYMENT_METHOD_TYPE: payment.payment_type_id || '',
      OPERATION_TYPE: payment.operation_type || ''
    }
  };
}

function normalizeMercadoPagoAssetManagementRelease(row, fileName) {
  const sourceId = String(row.SOURCE_ID || '').trim();
  const credit = parseMpAmount(row.NET_CREDIT_AMOUNT);
  const debit = parseMpAmount(row.NET_DEBIT_AMOUNT);
  const amount = credit - debit;
  return {
    sourceId,
    transactionType: 'ASSET_MANAGEMENT',
    isSale: false,
    date: argentinaISODateFrom(row.DATE || ''),
    amount,
    ingreso: amount > 0 ? amount : 0,
    egreso: amount < 0 ? Math.abs(amount) : 0,
    categoria: 'Otros',
    cuenta: 'MP FB',
    descripcion: `Rendimientos${sourceId ? ` | ${sourceId}` : ''}`,
    fileName,
    raw: {
      SOURCE_ID: sourceId,
      DESCRIPTION: row.DESCRIPTION || '',
      NET_CREDIT_AMOUNT: credit,
      NET_DEBIT_AMOUNT: debit,
      GROSS_AMOUNT: parseMpAmount(row.GROSS_AMOUNT),
      DATE: row.DATE || '',
      BALANCE_AMOUNT: row.BALANCE_AMOUNT || ''
    }
  };
}

async function searchMercadoPagoShippingPayments(from, to) {
  const results = await searchMercadoPagoPaymentsByDate(from, to);
  return results
    .filter(isMercadoPagoShippingPayment)
    .map(normalizeMercadoPagoShippingPayment)
    .filter((movement) => movement.date >= from && movement.date <= to && movement.egreso > 0);
}

async function searchMercadoPagoOutgoingPayments(from, to) {
  const ownerId = await getMercadoPagoUserId();
  const results = await searchMercadoPagoPaymentsByDate(from, to);
  return results
    .filter((payment) => isMercadoPagoOutgoingPayment(payment, ownerId))
    .map(normalizeMercadoPagoOutgoingPayment)
    .filter((movement) => movement.date >= from && movement.date <= to && movement.egreso > 0);
}

function shouldTryDirectPaymentEnrichment(movement) {
  return movement
    && movement.sourceId
    && movement.egreso > 0
    && ['SETTLEMENT', 'PAYOUT'].includes(String(movement.transactionType || '').toUpperCase())
    && isGenericMercadoPagoDescription(movement.descripcion);
}

function sameMercadoPagoAmount(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) < 0.01;
}

async function enrichMercadoPagoMovementsFromPaymentIds(movements) {
  const candidates = movements.filter(shouldTryDirectPaymentEnrichment).slice(0, 40);
  if (!candidates.length) return 0;
  let ownerId = '';
  try { ownerId = await getMercadoPagoUserId(); } catch (e) {}
  let enriched = 0;
  for (const movement of candidates) {
    try {
      const text = await mercadoPagoFetch(`/v1/payments/${encodeURIComponent(movement.sourceId)}`, { method: 'GET' });
      const payment = JSON.parse(text);
      const normalized = normalizeMercadoPagoOutgoingPayment(payment);
      const payerId = String(payment.payer && payment.payer.id || '').trim();
      const amountMatches = sameMercadoPagoAmount(normalized.egreso, movement.egreso);
      const belongsToAccount = !ownerId || payerId === ownerId || amountMatches;
      if (!normalized.sourceId || !belongsToAccount) continue;
      const before = movement.descripcion;
      mergeMercadoPagoMovement(movement, normalized);
      if (movement.descripcion !== before) enriched += 1;
    } catch (e) {
      // Some settlement SOURCE_ID values are not payment IDs. Ignore and keep the report row.
    }
  }
  return enriched;
}

function normalizeMercadoPagoPayoutRelease(row, fileName) {
  const sourceId = String(row.SOURCE_ID || '').trim();
  const egreso = parseMpAmount(row.NET_DEBIT_AMOUNT);
  const rawDescription = cleanMpText(row.DESCRIPTION);
  const detail = cleanMpText(row.SALE_DETAIL)
    || cleanMpText(row.TRANSACTION_DETAIL)
    || cleanMpText(row.SEGMENT_DETAIL)
    || cleanMpText(row.EXTERNAL_REFERENCE)
    || rawDescription;
  const descriptionText = `${rawDescription} ${detail}`.toLowerCase();
  const isTransfer = descriptionText.includes('transfer') || descriptionText.includes('payout') || descriptionText.includes('withdraw');
  const isRefund = descriptionText.includes('refund') || descriptionText.includes('devolu');
  const descripcion = isRefund
    ? `Devolucion Mercado Pago${detail ? ` - ${detail}` : ''}`
    : isTransfer
      ? `Retiro Mercado Pago${detail && detail.toLowerCase() !== 'payout' ? ` - ${detail}` : ''}`
      : `Debito Mercado Pago${detail ? ` - ${detail}` : ''}`;
  return {
    sourceId,
    transactionType: 'PAYOUT',
    isSale: false,
    date: argentinaISODateFrom(row.DATE || row.TRANSACTION_APPROVAL_DATE || ''),
    amount: -Math.abs(egreso),
    ingreso: 0,
    egreso: Math.abs(egreso),
    categoria: isRefund ? 'Devolución' : 'Productos',
    cuenta: 'MP FB',
    descripcion: `${descripcion}${sourceId ? ` | ${sourceId}` : ''}`,
    fileName,
    raw: {
      SOURCE_ID: sourceId,
      TRANSACTION_TYPE: 'PAYOUT',
      TRANSACTION_AMOUNT: egreso,
      REAL_AMOUNT: -Math.abs(egreso),
      TRANSACTION_DATE: row.DATE || '',
      DESCRIPTION: row.DESCRIPTION || '',
      SALE_DETAIL: row.SALE_DETAIL || '',
      TRANSACTION_DETAIL: row.TRANSACTION_DETAIL || '',
      PAYMENT_METHOD_TYPE: row.PAYMENT_METHOD_TYPE || '',
      BUSINESS_UNIT: row.BUSINESS_UNIT || '',
      SUB_UNIT: row.SUB_UNIT || '',
      BALANCE_AMOUNT: row.BALANCE_AMOUNT || ''
    }
  };
}

function mpMovementLooseKey(movement) {
  return [
    movement.sourceId || '',
    movement.date || '',
    Math.abs(Number(movement.amount || movement.ingreso || movement.egreso || 0)).toFixed(2)
  ].join('|');
}

function normalizeMercadoPagoMovementType(type) {
  const text = String(type || '').trim().toUpperCase();
  if (text === 'PAYOUT') return 'PAYOUTS';
  return text;
}

function shouldUseMpMovementLooseKey(movement) {
  return Boolean(String(movement && movement.sourceId || '').trim());
}

function isGenericMercadoPagoDescription(description) {
  const text = cleanMpText(description).toLowerCase();
  if (!text) return true;
  return text.includes('debito mercado pago')
    || text.includes('credito mercado pago')
    || text.includes('pago mercado pago')
    || text.includes('movimiento mercado pago')
    || text.includes('reserve_for_payment')
    || text.includes('reserve_for_payout')
    || text.includes('transferencia enviada mercado pago - varios')
    || text === 'andreani'
    || text === 'andreani |';
}

function mergeMercadoPagoMovement(existing, incoming) {
  if (!existing || !incoming) return existing || incoming;
  const incomingDescription = cleanMpText(incoming.descripcion);
  const existingDescription = cleanMpText(existing.descripcion);
  const incomingLooksBetter = incomingDescription
    && (
      isGenericMercadoPagoDescription(existingDescription)
      || incoming.fileName === 'payments_search'
      || incoming.fileName === 'payments_search_outgoing'
      || incoming.transactionType === 'PAYMENT'
      || incoming.transactionType === 'TRANSFER'
    )
    && !isGenericMercadoPagoDescription(incomingDescription);
  if (!incomingLooksBetter) return existing;
  existing.descripcion = incoming.descripcion;
  existing.categoria = incoming.categoria || existing.categoria;
  existing.transactionType = incoming.transactionType || existing.transactionType;
  existing.raw = Object.assign({}, existing.raw || {}, incoming.raw || {});
  existing.enrichedFrom = incoming.fileName || 'fallback';
  return existing;
}

function addMercadoPagoMovement(movements, seen, seenLoose, movement) {
  const key = `${movement.sourceId}|${normalizeMercadoPagoMovementType(movement.transactionType)}|${movement.date}|${movement.amount}`;
  const looseKey = mpMovementLooseKey(movement);
  if (seen.has(key)) return;
  if (shouldUseMpMovementLooseKey(movement) && seenLoose.has(looseKey)) {
    const existing = movements.find((item) => shouldUseMpMovementLooseKey(item) && mpMovementLooseKey(item) === looseKey);
    if (existing) mergeMercadoPagoMovement(existing, movement);
    seen.add(key);
    return;
  }
  seen.add(key);
  if (shouldUseMpMovementLooseKey(movement)) seenLoose.add(looseKey);
  movements.push(movement);
}

async function searchMercadoPagoPayoutMovements(from, to) {
  const today = argentinaTodayISO();
  const reportTo = minISODate(to, addDaysISO(today, -1));
  if (from > reportTo) return [];
  let foundReports = await findMercadoPagoReleaseReports(from, reportTo);
  const fileNames = [];
  if (!foundReports.coversRange) {
    const report = await createMercadoPagoReleaseReport(from, reportTo);
    const fileName = await waitForMercadoPagoReport(report);
    if (fileName) fileNames.push(fileName);
    foundReports = await findMercadoPagoReleaseReports(from, reportTo);
  }
  fileNames.push(...(foundReports.fileNames || []));
  const movements = [];
  const seen = new Set();
  for (const fileName of Array.from(new Set(fileNames)).slice(0, 8)) {
    if (!/\.csv$/i.test(fileName)) continue;
    const csv = await mercadoPagoFetch(`/v1/account/release_report/${encodeURIComponent(fileName)}`, { method: 'GET' });
    parseCsvRows(csv)
      .filter((row) => parseMpAmount(row.NET_DEBIT_AMOUNT) > 0)
      .map((row) => normalizeMercadoPagoPayoutRelease(row, fileName))
      .filter((movement) => movement.date >= from && movement.date <= to && movement.egreso > 0)
      .forEach((movement) => {
        const key = `${movement.sourceId}|${movement.transactionType}|${movement.date}|${movement.amount}`;
        if (seen.has(key)) return;
        seen.add(key);
        movements.push(movement);
      });
  }
  return movements;
}

async function searchMercadoPagoAssetManagementMovements(from, to) {
  const today = argentinaTodayISO();
  const reportTo = minISODate(to, today);
  if (from > reportTo) return [];
  let foundReports = await findMercadoPagoReleaseReports(from, reportTo);
  const fileNames = [];
  if (!foundReports.coversRange) {
    const report = await createMercadoPagoReleaseReport(from, reportTo);
    const fileName = await waitForMercadoPagoReport(report);
    if (fileName) fileNames.push(fileName);
    foundReports = await findMercadoPagoReleaseReports(from, reportTo);
  }
  fileNames.push(...(foundReports.fileNames || []));
  const movements = [];
  const seen = new Set();
  for (const fileName of Array.from(new Set(fileNames)).slice(0, 8)) {
    if (!/\.csv$/i.test(fileName)) continue;
    const csv = await mercadoPagoFetch(`/v1/account/release_report/${encodeURIComponent(fileName)}`, { method: 'GET' });
    parseCsvRows(csv)
      .filter((row) => String(row.DESCRIPTION || '').toLowerCase() === 'asset_management')
      .map((row) => normalizeMercadoPagoAssetManagementRelease(row, fileName))
      .filter((movement) => movement.date >= from && movement.date <= to && movement.ingreso > 0)
      .forEach((movement) => {
        const key = `${movement.sourceId}|${movement.transactionType}|${movement.date}|${movement.amount}`;
        if (seen.has(key)) return;
        seen.add(key);
        movements.push(movement);
      });
  }
  return movements;
}

function normalizeMercadoPagoSettlementRow(row, fileName) {
  const sourceId = String(
    row.SOURCE_ID
    || row.ORDER_MP
    || row.PURCHASE_ID
    || row.TRANSACTION_INTENT_ID
    || row.EXTERNAL_REFERENCE
    || ''
  ).trim();
  const transactionType = String(row.TRANSACTION_TYPE || row.RECORD_TYPE || row.DESCRIPTION || '').trim().toUpperCase();
  const settlementNetAmount = parseMpAmount(row.SETTLEMENT_NET_AMOUNT);
  const realAmount = parseMpAmount(row.REAL_AMOUNT);
  const transactionAmount = parseMpAmount(row.TRANSACTION_AMOUNT);
  const feeAmount = parseMpAmount(row.FEE_AMOUNT);
  const taxesAmount = parseMpAmount(row.TAXES_AMOUNT);
  const amount = settlementNetAmount || realAmount || (transactionAmount - feeAmount - taxesAmount);
  const date = normalizeMpSettlementDate(row);
  const isSale = isMercadoPagoSaleSettlement(row, amount);
  const detail = getMpMovementDetail(row);
  let descriptionBase = describeMpMovementType(transactionType, amount, isSale);
  if (isMercadoPagoIntraTransfer(row, amount)) descriptionBase = 'Transferencia enviada Mercado Pago';
  if (!isSale && isShippingLikeMovement(row)) descriptionBase = 'Envio Mercado Pago';
  const normalized = applyIncognitoMovementRules(
    descriptionBase,
    detail,
    categorizeMpMovementType(transactionType, amount, isSale, row),
    transactionType
  );
  const description = `${normalized.description}${sourceId ? ` | ${sourceId}` : ''}`;
  return {
    sourceId,
    transactionType,
    isSale,
    date,
    amount,
    ingreso: amount > 0 ? amount : 0,
    egreso: amount < 0 ? Math.abs(amount) : 0,
    categoria: normalized.category,
    cuenta: 'MP FB',
    descripcion: description,
    fileName,
    raw: {
      SOURCE_ID: sourceId,
      TRANSACTION_TYPE: transactionType,
      TRANSACTION_AMOUNT: transactionAmount,
      FEE_AMOUNT: feeAmount,
      TAXES_AMOUNT: taxesAmount,
      REAL_AMOUNT: realAmount,
      SETTLEMENT_NET_AMOUNT: settlementNetAmount,
      TRANSACTION_DATE: row.TRANSACTION_DATE || '',
      SETTLEMENT_DATE: row.SETTLEMENT_DATE || '',
      MONEY_RELEASE_DATE: row.MONEY_RELEASE_DATE || '',
      DATE: row.DATE || '',
      TRANSACTION_DATE_SHORT: row.TRANSACTION_DATE_SHORT || '',
      SETTLEMENT_DATE_SHORT: row.SETTLEMENT_DATE_SHORT || '',
      MONEY_RELEASE_DATE_SHORT: row.MONEY_RELEASE_DATE_SHORT || '',
      EXTERNAL_REFERENCE: row.EXTERNAL_REFERENCE || '',
      DESCRIPTION: row.DESCRIPTION || '',
      SHIPPING_ID: row.SHIPPING_ID || '',
      SHIPMENT_MODE: row.SHIPMENT_MODE || '',
      ORDER_ID: row.ORDER_ID || '',
      PAYER_NAME: row.PAYER_NAME || '',
      PAYMENT_METHOD: row.PAYMENT_METHOD || '',
      SEGMENT_DETAIL: row.SEGMENT_DETAIL || '',
      SALE_DETAIL: row.SALE_DETAIL || '',
      BUSINESS_UNIT: row.BUSINESS_UNIT || '',
      SUB_UNIT: row.SUB_UNIT || ''
    }
  };
}

app.options('/api/mercadopago/releases', (req, res) => {
  setMercadoPagoCors(req, res);
  res.status(204).end();
});

app.options('/api/mercadopago/account-movements', (req, res) => {
  setMercadoPagoCors(req, res);
  res.status(204).end();
});

app.options('/api/mercadopago/unreleased-balance', (req, res) => {
  setMercadoPagoCors(req, res);
  res.status(204).end();
});

app.options('/api/mercadopago/available-balance', (req, res) => {
  setMercadoPagoCors(req, res);
  res.status(204).end();
});

app.options('/api/mercadopago/released-payments', (req, res) => {
  setMercadoPagoCors(req, res);
  res.status(204).end();
});

app.post('/api/mercadopago/unreleased-balance', async (req, res) => {
  setMercadoPagoCors(req, res);
  try {
    const mpAccount = normalizeMercadoPagoAccount(req.body && req.body.account);
    if (!getMercadoPagoAccessToken(mpAccount)) {
      return res.status(500).json({ success: false, error: `Falta token de Mercado Pago para ${mpAccount} en Render.` });
    }
    await withMercadoPagoAccount(mpAccount, async () => {
      const today = argentinaTodayISO();
      const from = toISODate(req.body && req.body.from, addDaysISO(today, -45));
      const to = minISODate(toISODate(req.body && req.body.to, today), today);
      const balance = await getMercadoPagoUnreleasedBalance(from, to);
      res.json({ success: true, account: mpAccount, from, to, ...balance });
    });
  } catch (err) {
    console.error('[/api/mercadopago/unreleased-balance]', err.message);
    res.status(500).json({ success: false, error: err.message || 'Error consultando dinero por liberar de Mercado Pago.' });
  }
});

app.post('/api/mercadopago/account-movements', async (req, res) => {
  setMercadoPagoCors(req, res);
  try {
    const mpAccount = normalizeMercadoPagoAccount(req.body && req.body.account);
    if (!getMercadoPagoAccessToken(mpAccount)) {
      return res.status(500).json({ success: false, error: `Falta token de Mercado Pago para ${mpAccount} en Render.` });
    }

    await withMercadoPagoAccount(mpAccount, async () => {
    const today = argentinaTodayISO();
    const defaultFrom = addDaysISO(today, -20);
    const from = toISODate(req.body && req.body.from, defaultFrom);
    const requestedTo = toISODate(req.body && req.body.to, today);
    const to = minISODate(requestedTo, today);
    const includeSales = Boolean(req.body && req.body.includeSales);
    const forceFresh = Boolean(req.body && req.body.forceFresh);
    if (from > to) {
      return res.status(400).json({ success: false, error: 'El rango de fechas no tiene movimientos cerrados para consultar.' });
    }

    const configWasUpdated = await ensureMercadoPagoSettlementIncludesWithdraw();
    const reportTo = minISODate(to, addDaysISO(today, -1));
    const canUseSettlementReport = from <= reportTo;
    const reportFrom = from;
    const needsFreshReport = canUseSettlementReport && (forceFresh || configWasUpdated);
    let foundReports = { fileNames: [], coversRange: false };
    let fileNames = [];
    let reportPending = false;
    if (canUseSettlementReport) {
      foundReports = await findMercadoPagoSettlementReports(reportFrom, reportTo);
      if (needsFreshReport && foundReports.latestFileName && isFreshMercadoPagoReport(foundReports.latestCreatedAt)) {
        fileNames = [foundReports.latestFileName];
      } else if (needsFreshReport) {
        const report = await createMercadoPagoSettlementReport(reportFrom, reportTo);
        const fileName = await waitForMercadoPagoSettlementReport(report);
        if (fileName) fileNames.unshift(fileName);
      }
      if (needsFreshReport && !fileNames.length) {
        reportPending = true;
      }
      if (!needsFreshReport) fileNames = fileNames.concat(foundReports.fileNames);
      if (!needsFreshReport && !foundReports.coversRange && isRecentMercadoPagoSettlementRange(reportTo, today)) {
        reportPending = true;
        fileNames = [];
      } else if (!needsFreshReport && !foundReports.coversRange) {
        const report = await createMercadoPagoSettlementReport(reportFrom, reportTo);
        const fileName = await waitForMercadoPagoSettlementReport(report);
        if (fileName) fileNames.unshift(fileName);
      }
      if (!needsFreshReport && !fileNames.length) {
        foundReports = await findMercadoPagoSettlementReports(reportFrom, reportTo);
        fileNames = foundReports.fileNames;
      }
    }

    if (canUseSettlementReport && !fileNames.length && !reportPending) {
      return res.json({
        success: true,
        account: mpAccount,
        pending: true,
        error: 'Mercado Pago esta generando el reporte. Proba de nuevo en un minuto.',
        movements: [],
        report: { from, to, reportFrom, reportTo, fileNames: [] }
      });
    }
    if (canUseSettlementReport && reportPending && !fileNames.length) {
      return res.json({
        success: true,
        account: mpAccount,
        pending: true,
        error: 'Mercado Pago esta generando el reporte actualizado. Proba de nuevo en un minuto.',
        movements: [],
        report: { from, to, reportFrom, reportTo, fileNames: [], freshRequired: true }
      });
    }

    const movements = [];
    const seen = new Set();
    const seenLoose = new Set();
    const filteredSales = new Set();
    const reportStats = [];
    for (const fileName of fileNames) {
      if (!/\.csv$/i.test(fileName)) continue;
      const csv = await mercadoPagoFetch(`/v1/account/settlement_report/${encodeURIComponent(fileName)}`, { method: 'GET' });
      const parsedRows = parseCsvRows(csv);
      let inRange = 0;
      let withAmount = 0;
      let afterSalesFilter = 0;
      parsedRows
        .map((row) => normalizeMercadoPagoSettlementRow(row, fileName))
        .forEach((movement) => {
          if (movement.date < reportFrom || movement.date > reportTo) return;
          inRange += 1;
          if (movement.amount === 0) return;
          withAmount += 1;
          if (!includeSales && movement.isSale) {
            filteredSales.add(`${movement.sourceId}|${movement.transactionType}|${movement.date}|${movement.amount}`);
            return;
          }
          afterSalesFilter += 1;
          const key = `${movement.sourceId}|${normalizeMercadoPagoMovementType(movement.transactionType)}|${movement.date}|${movement.amount}`;
          if (seen.has(key)) return;
          if (shouldUseMpMovementLooseKey(movement) && seenLoose.has(mpMovementLooseKey(movement))) return;
          seen.add(key);
          if (shouldUseMpMovementLooseKey(movement)) seenLoose.add(mpMovementLooseKey(movement));
          movements.push(movement);
        });
      reportStats.push({ fileName, rows: parsedRows.length, inRange, withAmount, afterSalesFilter });
    }

    const paymentFallbacks = await searchMercadoPagoShippingPayments(from, to);
    paymentFallbacks.forEach((movement) => {
      addMercadoPagoMovement(movements, seen, seenLoose, movement);
    });

    const outgoingPaymentFallbacks = await searchMercadoPagoOutgoingPayments(from, to);
    outgoingPaymentFallbacks.forEach((movement) => {
      addMercadoPagoMovement(movements, seen, seenLoose, movement);
    });

    const payoutFallbacks = await searchMercadoPagoPayoutMovements(from, to);
    payoutFallbacks.forEach((movement) => {
      addMercadoPagoMovement(movements, seen, seenLoose, movement);
    });

    const assetManagementFallbacks = await searchMercadoPagoAssetManagementMovements(from, to);
    assetManagementFallbacks.forEach((movement) => {
      addMercadoPagoMovement(movements, seen, seenLoose, movement);
    });

    const directPaymentEnrichments = await enrichMercadoPagoMovementsFromPaymentIds(movements);

    movements.forEach((movement) => {
      movement.cuenta = mpAccount;
    });
    movements.sort((a, b) => a.date.localeCompare(b.date) || a.transactionType.localeCompare(b.transactionType));
    if (reportPending && !movements.length) {
      return res.json({
        success: true,
        account: mpAccount,
        pending: true,
        error: 'Mercado Pago esta generando el reporte actualizado. Proba de nuevo en un minuto.',
        movements: [],
        report: { from, to, fileNames: [], freshRequired: true }
      });
    }
    res.json({
      success: true,
      account: mpAccount,
      movements,
      report: {
        from,
        to,
        reportFrom: canUseSettlementReport ? reportFrom : null,
        reportTo: canUseSettlementReport ? reportTo : null,
        fileNames,
        stats: reportStats,
        filteredSales: filteredSales.size,
        freshRequired: needsFreshReport,
        reportPending,
        paymentFallbacks: paymentFallbacks.length,
        outgoingPaymentFallbacks: outgoingPaymentFallbacks.length,
        payoutFallbacks: payoutFallbacks.length,
        assetManagementFallbacks: assetManagementFallbacks.length,
        directPaymentEnrichments
      }
    });
    });
  } catch (err) {
    console.error('[/api/mercadopago/account-movements]', err.message);
    res.status(500).json({ success: false, error: err.message || 'Error consultando movimientos de Mercado Pago.' });
  }
});

app.post('/api/mercadopago/released-payments', async (req, res) => {
  setMercadoPagoCors(req, res);
  try {
    const mpAccount = normalizeMercadoPagoAccount(req.body && req.body.account);
    if (!getMercadoPagoAccessToken(mpAccount)) {
      return res.status(500).json({ success: false, error: `Falta token de Mercado Pago para ${mpAccount} en Render.` });
    }

    await withMercadoPagoAccount(mpAccount, async () => {
      const today = argentinaTodayISO();
      const from = toISODate(req.body && req.body.from, addDaysISO(today, -7));
      const to = minISODate(toISODate(req.body && req.body.to, today), today);
      let foundReports = await findMercadoPagoReleaseReports(from, to);
      let fileNames = foundReports.fileNames || [];
      if (!foundReports.coversRange || req.body && req.body.forceFresh) {
        const report = await createMercadoPagoReleaseReport(from, to);
        const fileName = await waitForMercadoPagoReport(report);
        if (fileName) fileNames = [fileName].concat(fileNames);
      }

      const releases = [];
      const seen = new Set();
      for (const fileName of Array.from(new Set(fileNames)).slice(0, 8)) {
        if (!/\.csv$/i.test(fileName)) continue;
        const csv = await mercadoPagoFetch(`/v1/account/release_report/${encodeURIComponent(fileName)}`, { method: 'GET' });
        parseCsvRows(csv)
          .filter((row) => {
            const date = String(row.DATE || '').slice(0, 10);
            const description = String(row.DESCRIPTION || '').trim().toLowerCase();
            const credit = parseMpAmount(row.NET_CREDIT_AMOUNT);
            return date >= from && date <= to && credit > 0 && description === 'payment';
          })
          .forEach((row) => {
            const sourceId = String(row.SOURCE_ID || '').trim();
            const amount = parseMpAmount(row.NET_CREDIT_AMOUNT);
            const date = String(row.DATE || '').slice(0, 10);
            const key = `${sourceId}|${date}|${amount}`;
            if (seen.has(key)) return;
            seen.add(key);
            releases.push({
              sourceId,
              date,
              amount,
              fileName,
              description: String(row.DESCRIPTION || '').trim(),
              balanceAmount: parseMpAmount(row.BALANCE_AMOUNT)
            });
          });
      }
      releases.sort((a, b) => a.date.localeCompare(b.date) || String(a.sourceId).localeCompare(String(b.sourceId)));
      res.json({ success: true, account: mpAccount, from, to, releases, report: { fileNames } });
    });
  } catch (err) {
    console.error('[/api/mercadopago/released-payments]', err.message);
    res.status(500).json({ success: false, error: err.message || 'Error consultando liberaciones de Mercado Pago.' });
  }
});

app.post('/api/mercadopago/available-balance', async (req, res) => {
  setMercadoPagoCors(req, res);
  try {
    const mpAccount = normalizeMercadoPagoAccount(req.body && req.body.account);
    if (!getMercadoPagoAccessToken(mpAccount)) {
      return res.status(500).json({ success: false, error: `Falta token de Mercado Pago para ${mpAccount} en Render.` });
    }

    await withMercadoPagoAccount(mpAccount, async () => {
      const today = argentinaTodayISO();
      const from = toISODate(req.body && req.body.from, addDaysISO(today, -7));
      const to = minISODate(toISODate(req.body && req.body.to, today), today);
      let foundReports = await findMercadoPagoReleaseReports(from, to);
      let fileNames = foundReports.fileNames || [];
      const report = await createMercadoPagoReleaseReport(from, to);
      const fileName = await waitForMercadoPagoReport(report);
      if (fileName) fileNames = [fileName].concat(fileNames);
      if (!fileNames.length) {
        foundReports = await findMercadoPagoReleaseReports(from, to);
        fileNames = foundReports.fileNames || [];
      }

      const balances = [];
      for (const currentFileName of Array.from(new Set(fileNames)).slice(0, 8)) {
        if (!/\.csv$/i.test(currentFileName)) continue;
        const csv = await mercadoPagoFetch(`/v1/account/release_report/${encodeURIComponent(currentFileName)}`, { method: 'GET' });
        parseCsvRows(csv)
          .map((row) => parseMercadoPagoAvailableBalanceRow(row, currentFileName))
          .filter(Boolean)
          .forEach((row) => balances.push(row));
      }

      balances.sort((a, b) => dateValue(`${b.date || today}T00:00:00Z`) - dateValue(`${a.date || today}T00:00:00Z`));
      res.json({
        success: true,
        account: mpAccount,
        from,
        to,
        availableBalance: balances.length ? balances[0].balance : null,
        balances,
        report: { fileNames }
      });
    });
  } catch (err) {
    console.error('[/api/mercadopago/available-balance]', err.message);
    res.status(500).json({ success: false, error: err.message || 'Error consultando saldo disponible de Mercado Pago.' });
  }
});

app.post('/api/mercadopago/releases', async (req, res) => {
  setMercadoPagoCors(req, res);
  try {
    const mpAccount = normalizeMercadoPagoAccount(req.body && req.body.account);
    if (!getMercadoPagoAccessToken(mpAccount)) {
      return res.status(500).json({ success: false, error: `Falta token de Mercado Pago para ${mpAccount} en Render.` });
    }

    await withMercadoPagoAccount(mpAccount, async () => {
    const paymentIds = sanitizePaymentIds(req.body && req.body.paymentIds);
    if (!paymentIds.length) {
      return res.status(400).json({ success: false, error: 'No se recibieron paymentIds validos.' });
    }

    const today = argentinaTodayISO();
    const from = toISODate(req.body && req.body.from, addDaysISO(today, -45));
    const to = minISODate(toISODate(req.body && req.body.to, today), today);
    const reportTo = minISODate(to, addDaysISO(today, -1));
    const reportFrom = from <= reportTo ? from : reportTo;
    let foundReports = await findMercadoPagoReleaseReports(reportFrom, reportTo);
    let fileNames = foundReports.fileNames;
    if (!foundReports.coversRange) {
      const report = await createMercadoPagoReleaseReport(reportFrom, reportTo);
      const fileName = await waitForMercadoPagoReport(report);
      if (fileName) fileNames.push(fileName);
    }
    if (!fileNames.length) {
      foundReports = await findMercadoPagoReleaseReports(reportFrom, reportTo);
      fileNames = foundReports.fileNames;
    }

    const wanted = new Set(paymentIds);
    const releases = [];
    for (const fileName of fileNames) {
      const csv = await mercadoPagoFetch(`/v1/account/release_report/${encodeURIComponent(fileName)}`, { method: 'GET' });
      parseCsvRows(csv)
        .filter((row) => wanted.has(String(row.SOURCE_ID || '').trim()))
        .filter((row) => {
          const recordType = String(row.RECORD_TYPE || '').trim().toLowerCase();
          const description = String(row.DESCRIPTION || '').trim().toLowerCase();
          return !recordType || recordType === 'release' || description === 'payment';
        })
        .map((row) => ({
          SOURCE_ID: String(row.SOURCE_ID || '').trim(),
          RECORD_TYPE: String(row.RECORD_TYPE || 'release').trim(),
          DESCRIPTION: String(row.DESCRIPTION || '').trim(),
          NET_CREDIT_AMOUNT: parseMpAmount(row.NET_CREDIT_AMOUNT),
          DATE: String(row.DATE || '').slice(0, 10),
          FILE_NAME: fileName
        }))
        .filter((row) => row.NET_CREDIT_AMOUNT > 0)
        .forEach((row) => releases.push(row));
      if (releases.length >= wanted.size) break;
    }

    const found = new Set(releases.map((row) => String(row.SOURCE_ID || '').trim()));
    for (const paymentId of paymentIds) {
      if (found.has(paymentId)) continue;
      try {
        const fallback = await getMercadoPagoPaymentRelease(paymentId);
        if (fallback) {
          releases.push(fallback);
          found.add(paymentId);
        }
      } catch (err) {
        console.warn('[/api/mercadopago/releases fallback]', paymentId, err.message);
      }
    }

    res.json({ success: true, account: mpAccount, releases, report: { from, to, fileNames } });
    });
  } catch (err) {
    console.error('[/api/mercadopago/releases]', err.message);
    res.status(500).json({ success: false, error: err.message || 'Error consultando Mercado Pago.' });
  }
});

app.get('/api/stamps/pending-print', async (req, res) => {
  if (!stampsSecretMatches(req)) {
    return res.status(401).json({ ok: false, error: 'Secreto invalido.' });
  }

  try {
    const { state, updatedAt } = await getStoredAppState();
    res.json({
      ok: true,
      updatedAt,
      items: pendingPrintRowsFromState(state)
    });
  } catch (err) {
    console.error('[/api/stamps/pending-print]', err.message);
    res.status(err.statusCode || 500).json({
      ok: false,
      error: err.statusCode === 503
        ? 'No esta configurado el almacenamiento compartido de ventas.'
        : 'No pude consultar los DTF pendientes.'
    });
  }
});

app.use((req, res, next) => {
  if (isAuthenticated(req)) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ success: false, error: 'No autenticado.' });
  }
  return res.redirect((req.baseUrl || '') + '/login');
});

// ── Estáticos ────────────────────────────────────────────────────────────────
// La carpeta public/ tiene index.html, app.js y styles.css.
// Los archivos del backend (server.js, .env, etc.) quedan en la raíz y
// nunca se sirven al navegador.
app.use(express.static(path.join(__dirname, 'public')));

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status    : 'ok',
    timestamp : new Date().toISOString(),
    tiendanube: {
      clientId   : !!process.env.TIENDANUBE_CLIENT_ID,
      storeId    : !!process.env.TIENDANUBE_STORE_ID,
      accessToken: !!process.env.TIENDANUBE_ACCESS_TOKEN
    }
  });
});

app.get('/api/kommo/bots', async (req, res) => {
  try {
    const wantedName = String(req.query.name || '').trim();
    const bots = await kommoWhatsappService.listBots();
    const safeBots = bots.map((bot) => ({
      id: Number(bot.id || 0),
      name: String(bot.name || ''),
      is_active: bot.is_active ?? bot.active ?? null,
      templateIds: botTemplateIds(bot)
    })).filter((bot) => bot.id && bot.name);
    let filtered = wantedName
      ? safeBots.filter((bot) => bot.name.trim() === wantedName)
      : safeBots;
    if (wantedName) {
      filtered = await Promise.all(filtered.map(async (bot) => {
        try {
          const detail = await kommoWhatsappService.readBot(bot.id);
          const templateIds = botTemplateIds(detail).concat(bot.templateIds)
            .filter((value, index, list) => list.indexOf(value) === index);
          return { ...bot, templateIds };
        } catch {
          return bot;
        }
      }));
    }
    res.json({
      success: true,
      requestedName: wantedName || null,
      count: filtered.length,
      bots: filtered
    });
  } catch (err) {
    console.error('[/api/kommo/bots]', sanitizedKommoError(err));
    res.status(err.statusCode || 500).json({
      success: false,
      error: sanitizedKommoError(err)
    });
  }
});

app.get('/api/mayorista/products', async (_req, res) => {
  try {
    const response = await fetch(MAYORISTA_CATALOG_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      return res.status(response.status).json({ success: false, error: `Catalogo mayorista HTTP ${response.status}` });
    }
    const products = await response.json();
    res.json(Array.isArray(products) ? products : []);
  } catch (err) {
    console.error('[/api/mayorista/products]', err.message);
    res.status(500).json({ success: false, error: 'No pude leer el catalogo mayorista.' });
  }
});

async function callStockFunction(url, options = {}) {
  if (!STOCK_SECRET) {
    const error = new Error('Falta DECREMENT_SECRET en .env para conectar con stock.');
    error.statusCode = 503;
    throw error;
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${STOCK_SECRET}`,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: summarizeExternalError(text, `Stock respondio HTTP ${response.status}`) };
  }

  return { ok: response.ok, status: response.status, data };
}

function summarizeExternalError(text = '', fallback = 'El servicio externo devolvio una respuesta invalida.') {
  const value = String(text || '').trim();
  if (!value) return fallback;
  if (/<html[\s>]/i.test(value) || /<!doctype html/i.test(value)) {
    const title = value.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim();
    return title ? `El servicio externo devolvio una pagina HTML: ${title}.` : 'El servicio externo devolvio una pagina HTML en lugar de JSON.';
  }
  return value.length > 500 ? `${value.slice(0, 500)}...` : value;
}

function isStockFunctionMissing(result = {}) {
  const error = String(result.data?.error || '').toLowerCase();
  return result.status === 404 && (
    error.includes('page not found') ||
    error.includes('pagina html') ||
    error.includes('html')
  );
}

async function callFluxApi(action, data) {
  if (!FLUX_API_URL || !FLUX_API_TOKEN) {
    const error = new Error('Falta configurar FLUX_API_URL y FLUX_API_TOKEN para conectar con Flux.');
    error.statusCode = 503;
    throw error;
  }

  const form = new FormData();
  form.append('tk', FLUX_API_TOKEN);
  form.append('ac', action);
  form.append('data', typeof data === 'string' ? data : JSON.stringify(data));

  const response = await fetch(FLUX_API_URL, {
    method: 'POST',
    body: form
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { estado: response.ok, mensaje: text };
  }
  return { ok: response.ok, status: response.status, data: parsed };
}

function fluxExternalEnabled() {
  return Boolean(FLUX_EXTERNAL_API_URL && FLUX_API_TOKEN && FLUX_COMPANY_TOKEN && FLUX_COMPANY_ID);
}

function fluxExternalMissingConfig() {
  return [
    ['FLUX_API_TOKEN', FLUX_API_TOKEN],
    ['FLUX_COMPANY_TOKEN', FLUX_COMPANY_TOKEN],
    ['FLUX_COMPANY_ID', FLUX_COMPANY_ID]
  ].filter(([, value]) => !value).map(([key]) => key).join(', ');
}

function argentinaDateString(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(safeDate).reduce((dateParts, part) => {
    dateParts[part.type] = part.value;
    return dateParts;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function fluxDateForExternalApi(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]} 00:00:00`;
  const date = value ? new Date(value) : new Date();
  return argentinaDateString(date) + ' 00:00:00';
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return value;
  }
  return '';
}

function whatsappApiEnabled() {
  return Boolean(WHATSAPP_PHONE_NUMBER_ID && WHATSAPP_ACCESS_TOKEN);
}

function normalizeWhatsappPhone(phone = '') {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('549')) return digits;
  if (digits.startsWith('54')) return `549${digits.slice(2).replace(/^0/, '').replace(/^(\d{2,4})15/, '$1')}`;
  const withoutTrunk = digits.replace(/^0/, '');
  const withoutMobilePrefix = withoutTrunk.replace(/^(\d{2,4})15/, '$1');
  if (withoutMobilePrefix.length >= 8 && withoutMobilePrefix.length <= 11) return `549${withoutMobilePrefix}`;
  return digits;
}

function whatsappTemplateForType(type) {
  if (type === 'flux') return WHATSAPP_TEMPLATE_FLUX_NAME;
  if (type === 'order_contact') return WHATSAPP_TEMPLATE_ORDER_CONTACT_NAME;
  if (type === 'confirmation') return WHATSAPP_TEMPLATE_CONFIRMATION_CASH_NAME;
  return WHATSAPP_TEMPLATE_TRACKING_NAME;
}

function buildWhatsappTemplatePayload({ to, type, trackingUrl, customerName, orderNumber }) {
  const templateName = whatsappTemplateForType(type);
  if (!templateName) throw new Error(`Falta configurar la plantilla WhatsApp para ${type === 'flux' ? 'Flux' : type === 'confirmation' ? 'confirmacion' : 'seguimiento'}.`);

  const template = {
    name: templateName,
    language: { code: WHATSAPP_TEMPLATE_LANGUAGE }
  };

  if (type === 'confirmation' || type === 'order_contact') {
    const name = String(customerName || '').trim();
    const number = String(orderNumber || '').trim();
    if (!name || !number) throw new Error('Faltan nombre del cliente o numero de orden para completar la plantilla.');
    template.components = [{
      type: 'body',
      parameters: [
        { type: 'text', text: name },
        { type: 'text', text: number }
      ]
    }];
  } else if (type !== 'flux') {
    const url = String(trackingUrl || '').trim();
    if (!url) throw new Error('Falta el link de seguimiento para completar la plantilla.');
    template.components = [{
      type: 'body',
      parameters: [{ type: 'text', text: url }]
    }];
  }

  return {
    messaging_product: 'whatsapp',
    to: normalizeWhatsappPhone(to),
    type: 'template',
    template
  };
}

function fluxExternalShipmentPayload(shipment = {}) {
  const idVenta = String(shipment.shipment_id || shipment.id_venta || shipment.idenvio || '').replace(/^ventas-/i, '');
  const trackingSource = String(firstNonEmpty(shipment.tracking_number, shipment.tracking, shipment.trackingNumber, shipment.Tracking, idVenta)).trim();
  const trackingNumber = trackingSource;
  const collectAmount = firstNonEmpty(shipment.total_a_cobrar, shipment.totalACobrar, shipment.monto_a_cobrar, shipment.montoCobranza);
  const declaredValue = firstNonEmpty(shipment.valor_declarado, shipment.valorDeclarado, collectAmount);
  const reverseLogistics = firstNonEmpty(shipment.logistica_inversa, shipment.logisticaInversa, shipment.enviosLogisticaInversa?.valor);
  const address = {
    calle: shipment.calle || '',
    numero: shipment.numero || shipment['número'] || '',
    cp: shipment.cp || '',
    localidad: shipment.localidad || '',
    provincia: shipment.provincia || ''
  };
  return {
    token: FLUX_API_TOKEN,
    idEmpresa: FLUX_COMPANY_ID,
    fecha_venta: fluxDateForExternalApi(shipment.fechaVenta || shipment.fecha_venta),
    destination_receiver_name: shipment.destinatario || shipment.destination_receiver_name || '',
    destination_receiver_phone: shipment.telefono || shipment.destination_receiver_phone || '',
    peso: shipment.peso ?? '',
    valor_declarado: declaredValue,
    id_venta: idVenta,
    tracking_number: trackingNumber,
    ...(collectAmount !== '' && collectAmount !== null && collectAmount !== undefined ? {
      monto_total_a_cobrar: collectAmount,
      envioscobranza: { valor: Number(collectAmount) || collectAmount }
    } : {}),
    ...(reverseLogistics ? {
      enviosLogisticaInversa: { valor: String(reverseLogistics) }
    } : {}),
    observaciones: shipment.observaciones ?? shipment.obs ?? '',
    estado: shipment.estado || 0,
    enviosDireccionesDestino: address
  };
}

async function callFluxExternalApi(pathname, options = {}) {
  if (!fluxExternalEnabled()) {
    const error = new Error(`Falta configurar Flux API nueva en Render: ${fluxExternalMissingConfig()}.`);
    error.statusCode = 503;
    throw error;
  }

  const url = `${FLUX_EXTERNAL_API_URL}/${pathname.replace(/^\/+/, '')}`;
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(FLUX_REQUEST_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${FLUX_COMPANY_TOKEN}`,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { success: response.ok, message: text };
  }
  return { ok: response.ok, status: response.status, data: parsed, rawText: text, url };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

function looksLikeHtml(value = '') {
  return /<!doctype html|<html[\s>]|<body[\s>]/i.test(String(value || ''));
}

function conciseFluxHttpError(status, text = '') {
  const body = String(text || '').trim();
  if (looksLikeHtml(body)) {
    const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      || body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
      || '';
    const cleanTitle = title.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const statusText = status ? `HTTP ${status}` : 'una pagina HTML de error';
    return cleanTitle ? `Lightdata devolvio ${statusText}: ${cleanTitle}` : `Lightdata devolvio ${statusText}.`;
  }
  return body.slice(0, 500);
}

function isFluxTemporaryFailure(result = {}) {
  const status = Number(result.status || result.httpStatus || 0);
  return [408, 429, 500, 502, 503, 504].includes(status);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fluxErrorText(value) {
  if (!value) return '';
  if (typeof value === 'string') return conciseFluxHttpError('', value) || value;
  if (Array.isArray(value)) return value.map(fluxErrorText).filter(Boolean).join(' | ');
  if (typeof value !== 'object') return String(value);

  const direct = [
    value.message,
    value.mensaje,
    value.error,
    value.descripcion,
    value.description,
    value.detalle,
    value.detail
  ].map((item) => String(item || '').trim()).filter(Boolean);
  if (direct.length) return direct.join(' | ');

  const nested = [
    value.data,
    value.result,
    value.results,
    value.errores,
    value.errors
  ].map(fluxErrorText).filter(Boolean);
  if (nested.length) return nested.join(' | ');

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function insertFluxExternalShipments(shipments = []) {
  const results = await mapWithConcurrency(shipments, FLUX_INSERT_CONCURRENCY, async (shipment) => {
    const payload = fluxExternalShipmentPayload(shipment);
    try {
      let result;
      for (let attempt = 0; attempt <= FLUX_INSERT_RETRIES; attempt += 1) {
        result = await callFluxExternalApi('insertar-envio', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (!isFluxTemporaryFailure(result) || attempt >= FLUX_INSERT_RETRIES) break;
        await wait(600 * (attempt + 1));
      }
      return {
        ...result.data,
        httpStatus: result.status,
        endpoint: result.url,
        rawText: looksLikeHtml(result.rawText) ? '' : result.rawText,
        estado: result.data?.success !== false,
        mensaje: fluxErrorText(result.data?.message || result.data?.mensaje) || fluxErrorText(result.data) || conciseFluxHttpError(result.status, result.rawText) || '',
        id: result.data?.data?.did || result.data?.data?.idEnvio || ''
      };
    } catch (error) {
      return {
        success: false,
        estado: false,
        httpStatus: error.name === 'TimeoutError' ? 504 : (error.statusCode || 500),
        mensaje: error.name === 'TimeoutError'
          ? 'Flux tardo demasiado en responder para este pedido.'
          : error.message,
        error: error.message
      };
    }
  });
  return {
    ok: results.every((item) => item.success !== false && item.estado !== false),
    status: results.some((item) => item.success === false || item.estado === false) ? 422 : 200,
    data: results
  };
}

const FLUX_STATUS_LABELS = {
  0: 'Retirado',
  1: 'A planta',
  2: 'En camino',
  5: 'Entregado',
  6: 'Nadie',
  7: 'A retirar',
  8: 'Cancelado'
};

const FLUX_STATUS_CODES_BY_LABEL = {
  'retirado': '0',
  'a retirar': '7',
  'a planta': '1',
  'en camino': '2',
  'entregado': '5',
  'nadie': '6',
  'cancelado': '8'
};

function fluxStatusLabel(code) {
  const normalized = Number(code);
  return FLUX_STATUS_LABELS[normalized] || String(code ?? 'Sin estado');
}

function fluxStatusCodeFromLabel(label) {
  return FLUX_STATUS_CODES_BY_LABEL[normalizeText(label)] || '';
}

async function getFluxExternalStatus(idEnvio) {
  const requestedId = String(idEnvio || '').trim();
  const query = new URLSearchParams({
    token: FLUX_API_TOKEN,
    idEmpresa: FLUX_COMPANY_ID,
    idEnvio: requestedId
  });
  const result = await callFluxExternalApi(`estado-envio?${query.toString()}`, {
    method: 'GET'
  });
  const data = result.data || {};
  const statusCode = data.data?.estado ?? data.estado ?? data.estado_envio ?? '';
  if (result.ok && data.success !== false) {
    return {
      idEnvio: requestedId,
      fluxShipmentId: data.data?.didenvio || requestedId,
      success: true,
      httpStatus: result.status,
      endpoint: result.url,
      raw: data,
      statusCode: String(statusCode),
      statusLabel: fluxStatusLabel(statusCode),
      message: data.message || data.mensaje || fluxErrorText(data) || result.rawText || ''
    };
  }

  return getFluxExternalStatusByTracking(requestedId, result);
}

async function getFluxExternalStatusByDid(did) {
  const id = String(did || '').trim();
  if (!id) return null;
  const query = new URLSearchParams({
    token: FLUX_API_TOKEN,
    idEmpresa: FLUX_COMPANY_ID,
    idEnvio: id
  });
  const result = await callFluxExternalApi(`estado-envio?${query.toString()}`, {
    method: 'GET'
  });
  const data = result.data || {};
  if (!result.ok || data.success === false) return null;
  const statusCode = data.data?.estado ?? data.estado ?? data.estado_envio ?? '';
  return {
    idEnvio: id,
    fluxShipmentId: data.data?.didenvio || id,
    success: true,
    httpStatus: result.status,
    endpoint: result.url,
    raw: data,
    statusCode: String(statusCode),
    statusLabel: fluxStatusLabel(statusCode),
    message: data.message || data.mensaje || fluxErrorText(data) || result.rawText || ''
  };
}

async function getFluxExternalStatusByTracking(trackingNumber, previousResult = null) {
  const requestedId = String(trackingNumber || '').trim();
  const payload = {
    idEmpresa: FLUX_COMPANY_ID,
    idEnvio: requestedId
  };
  const result = await callFluxExternalApi('obtener-datos-shipment-ml', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  const data = result.data || {};
  const did = data.data?.did || data.data?.didenvio || '';
  const statusByDid = await getFluxExternalStatusByDid(did);
  if (statusByDid) {
    return {
      ...statusByDid,
      idEnvio: requestedId,
      lookupId: requestedId,
      rawLookup: data
    };
  }
  const statusLabel = data.data?.estado_envio ?? data.estado_envio ?? '';
  const statusCode = data.data?.estado ?? data.estado ?? fluxStatusCodeFromLabel(statusLabel);
  return {
    idEnvio: requestedId,
    fluxShipmentId: data.data?.did || data.data?.didenvio || '',
    success: result.ok && data.success !== false,
    httpStatus: result.status,
    endpoint: result.url,
    raw: data,
    statusCode: String(statusCode),
    statusLabel: statusLabel || fluxStatusLabel(statusCode),
    message: data.message || data.mensaje || fluxErrorText(data) || result.rawText || previousResult?.rawText || ''
  };
}

function supabaseEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

// Saca las fotos en base64 del estado antes de guardarlo (van a Supabase
// Storage, queda solo un link corto en su lugar). Este es el unico punto
// donde se intercepta: al no tocar el resto del guardado, si algo de esto
// falla el guardado sigue funcionando igual que antes, solo sin el ahorro
// de banda ancha. Ver apps/ventas/lib/media.js y su comentario.
const { createMediaOffloader } = require('./lib/media.js');
const mediaOffloader = createMediaOffloader({
  supabaseUrl: SUPABASE_URL,
  serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  bucket: process.env.SUPABASE_MEDIA_BUCKET || 'ventas-fotos'
});

async function callSupabase(pathname, options = {}) {
  if (!supabaseEnabled()) {
    const error = new Error('Supabase no esta configurado.');
    error.statusCode = 503;
    throw error;
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: response.ok, status: response.status, data };
}

function sharePointEnabled() {
  return Boolean(MICROSOFT_TENANT_ID && MICROSOFT_CLIENT_ID && MICROSOFT_CLIENT_SECRET && SHAREPOINT_DRIVE_ID);
}

async function getSharePointAccessToken() {
  if (!sharePointEnabled()) {
    const missing = [
      ['MICROSOFT_TENANT_ID', MICROSOFT_TENANT_ID],
      ['MICROSOFT_CLIENT_ID', MICROSOFT_CLIENT_ID],
      ['MICROSOFT_CLIENT_SECRET', MICROSOFT_CLIENT_SECRET],
      ['SHAREPOINT_DRIVE_ID', SHAREPOINT_DRIVE_ID]
    ].filter(([, value]) => !value).map(([key]) => key).join(', ');
    const error = new Error(`Falta configurar SharePoint en Render: ${missing}.`);
    error.statusCode = 503;
    throw error;
  }

  const now = Date.now();
  if (sharePointTokenCache.token && sharePointTokenCache.expiresAt > now + 60000) {
    return sharePointTokenCache.token;
  }

  const form = new URLSearchParams();
  form.set('client_id', MICROSOFT_CLIENT_ID);
  form.set('client_secret', MICROSOFT_CLIENT_SECRET);
  form.set('scope', 'https://graph.microsoft.com/.default');
  form.set('grant_type', 'client_credentials');

  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(MICROSOFT_TENANT_ID)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error_description || data.error || 'No se pudo autenticar con Microsoft.');
    error.statusCode = response.status;
    throw error;
  }

  sharePointTokenCache = {
    token: data.access_token,
    expiresAt: now + Number(data.expires_in || 3600) * 1000
  };
  return sharePointTokenCache.token;
}

async function uploadSharePointFile(filePath, buffer, contentType) {
  const token = await getSharePointAccessToken();
  const cleanPath = String(filePath || SHAREPOINT_BACKUP_PATH).replace(/^\/+/, '');
  const uploadUrl = `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(SHAREPOINT_DRIVE_ID)}/root:/${cleanPath}:/content`;
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType || 'application/octet-stream'
    },
    body: buffer
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || 'No se pudo subir el archivo a SharePoint.');
    error.statusCode = response.status;
    throw error;
  }
  return data;
}

function normalizeStockText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function normalizeStockColor(value = '') {
  const normalized = normalizeStockText(value);
  const aliases = {
    gris: 'melange',
    gray: 'melange',
    grey: 'melange'
  };
  return aliases[normalized] || normalized;
}

function compactStockSku(value = '') {
  return normalizeStockText(value).replace(/[^a-z0-9]/g, '');
}

function sameStockFamily(requestedSku = '', stockSku = '') {
  const requested = compactStockSku(requestedSku);
  const stored = compactStockSku(stockSku);
  if (requested.length < 5 || stored.length < 5) return false;
  const prefix = requested.slice(0, 3);
  const suffix3 = requested.slice(-3);
  const suffix2 = requested.slice(-2);
  return stored.startsWith(prefix) && (stored.endsWith(suffix3) || stored.endsWith(suffix2));
}

function stockQuantity(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function supabaseStockSelect() {
  return 'id,sku,modelo,categoria,talle,color,stock,minimo,precio';
}

async function listStockItemsDirect(queryParams = {}) {
  const params = new URLSearchParams();
  params.set('select', supabaseStockSelect());
  params.set('order', 'categoria.asc,modelo.asc,talle.asc,color.asc');
  if (String(queryParams.solo_con_stock || '').toLowerCase() === 'true') params.set('stock', 'gt.0');
  if (queryParams.sku) params.set('sku', `ilike.*${String(queryParams.sku).trim()}*`);
  if (queryParams.modelo) params.set('modelo', `ilike.*${String(queryParams.modelo).trim()}*`);
  if (queryParams.categoria) params.set('categoria', `ilike.*${String(queryParams.categoria).trim()}*`);

  const result = await callSupabase(`prendas?${params.toString()}`, { method: 'GET' });
  if (!result.ok) {
    const error = new Error(typeof result.data === 'string' ? result.data : JSON.stringify(result.data));
    error.statusCode = result.status;
    throw error;
  }
  const items = Array.isArray(result.data) ? result.data : [];
  return { total: items.length, items };
}

async function findStockPrendaDirect(item = {}) {
  const sku = String(item.sku || '').trim();
  const talle = String(item.size || item.talle || '').trim();
  const color = String(item.color || '').trim();
  if (!sku || !talle) return { error: 'Falta SKU o talle.' };

  const params = new URLSearchParams();
  params.set('select', supabaseStockSelect());
  params.set('sku', `ilike.${sku}`);
  params.set('talle', `ilike.${talle}`);
  const result = await callSupabase(`prendas?${params.toString()}`, { method: 'GET' });
  if (!result.ok) return { error: typeof result.data === 'string' ? result.data : JSON.stringify(result.data) };

  const normalizedSku = normalizeStockText(sku);
  const normalizedTalle = normalizeStockText(talle);
  const normalizedColor = normalizeStockColor(color);
  const candidates = (Array.isArray(result.data) ? result.data : []).filter((prenda) =>
    normalizeStockText(prenda.sku) === normalizedSku &&
    normalizeStockText(prenda.talle) === normalizedTalle &&
    (!normalizedColor || normalizeStockColor(prenda.color) === normalizedColor)
  );

  if (candidates.length === 1) return { prenda: candidates[0] };
  if (candidates.length > 1) {
    return { error: `Hay ${candidates.length} colores para SKU "${sku}", talle "${talle}". Especificar color.` };
  }

  const familyParams = new URLSearchParams();
  familyParams.set('select', supabaseStockSelect());
  familyParams.set('talle', `ilike.${talle}`);
  const familyResult = await callSupabase(`prendas?${familyParams.toString()}`, { method: 'GET' });
  if (!familyResult.ok) {
    return { error: typeof familyResult.data === 'string' ? familyResult.data : JSON.stringify(familyResult.data) };
  }
  const familyCandidates = (Array.isArray(familyResult.data) ? familyResult.data : []).filter((prenda) =>
    sameStockFamily(sku, prenda.sku) &&
    normalizeStockText(prenda.talle) === normalizedTalle &&
    (!normalizedColor || normalizeStockColor(prenda.color) === normalizedColor)
  );
  if (familyCandidates.length === 1) {
    return { prenda: familyCandidates[0], matchType: 'family' };
  }
  if (familyCandidates.length > 1) {
    return { error: `Hay ${familyCandidates.length} prendas compatibles para familia SKU "${sku}", talle "${talle}"${color ? `, color "${color}"` : ''}.` };
  }
  return { error: `No existe prenda compatible para SKU "${sku}", talle "${talle}"${color ? `, color "${color}"` : ''}.` };
}

async function directOrderWasProcessed(orderId) {
  const params = new URLSearchParams();
  params.set('order_id', `eq.${String(orderId || '').trim()}`);
  params.set('select', 'order_id');
  params.set('limit', '1');
  const result = await callSupabase(`processed_orders?${params.toString()}`, { method: 'GET' });
  return result.ok && Array.isArray(result.data) && result.data.length > 0;
}

async function rememberDirectProcessedOrder(orderId) {
  await callSupabase('processed_orders', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ order_id: String(orderId || '').trim() })
  });
}

async function decrementStockDirect(orderId, items = []) {
  if (!supabaseEnabled()) {
    const error = new Error('Supabase no esta configurado para descontar stock directo.');
    error.statusCode = 503;
    throw error;
  }

  if (await directOrderWasProcessed(orderId)) {
    return { status: 200, data: { orderId, status: 'already_processed', actualizados: [], errores: [], mensaje: 'Este pedido ya fue procesado anteriormente.' } };
  }

  const actualizados = [];
  const errores = [];

  for (const item of items) {
    const quantity = Math.max(1, Number(item.quantity || item.cantidad || 1));
    const match = await findStockPrendaDirect(item);
    if (!match.prenda) {
      errores.push({ sku: item.sku || '', error: match.error || 'No se encontro la prenda.' });
      continue;
    }

    const prenda = match.prenda;
    const stockAnterior = stockQuantity(prenda.stock);
    if (stockAnterior < quantity) {
      errores.push({ sku: prenda.sku || item.sku || '', error: `Stock insuficiente - disponible: ${stockAnterior}, requerido: ${quantity}` });
      continue;
    }

    const stockNuevo = stockAnterior - quantity;
    const patch = await callSupabase(`prendas?id=eq.${encodeURIComponent(prenda.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ stock: stockNuevo })
    });
    if (!patch.ok) {
      errores.push({ sku: prenda.sku || item.sku || '', error: typeof patch.data === 'string' ? patch.data : JSON.stringify(patch.data) });
      continue;
    }

    actualizados.push({
      sku: prenda.sku || item.sku || '',
      requested_sku: item.sku || '',
      modelo: prenda.modelo || '',
      talle: prenda.talle || item.size || item.talle || '',
      color: prenda.color || item.color || '',
      prenda_id: prenda.id || '',
      quantity,
      stockAnterior,
      stockNuevo,
      matchType: match.matchType || 'direct'
    });
  }

  if (actualizados.length) await rememberDirectProcessedOrder(orderId);
  return {
    status: errores.length ? 422 : 200,
    data: { orderId, status: errores.length ? 'partial_error' : 'success', actualizados, errores }
  };
}

async function getStoredAppState() {
  if (!supabaseEnabled()) {
    const error = new Error('Supabase no esta configurado.');
    error.statusCode = 503;
    throw error;
  }
  const query = `${SUPABASE_STATE_TABLE}?id=eq.${encodeURIComponent(APP_STATE_ID)}&select=state,updated_at`;
  const result = await callSupabase(query, { method: 'GET' });
  if (!result.ok) {
    const error = new Error(JSON.stringify(result.data));
    error.statusCode = result.status;
    throw error;
  }
  const row = Array.isArray(result.data) ? result.data[0] : null;
  return { state: row?.state || {}, updatedAt: row?.updated_at || null };
}

const backupHeaders = [
  '',
  'FECHA',
  'SKU',
  'CANT',
  'CV',
  'Total C',
  'PV',
  'Total PV',
  'Medio',
  'Cuenta',
  'Envio',
  'Medio de Envio',
  'Medio de Venta',
  'Comision',
  'Ganancia',
  'Cliente',
  'CP',
  'Factura',
  'Color',
  'Talle',
  'Estado',
  'Cancelado',
  'Notas'
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function backupGroupKey(row) {
  return row.orderId || row.internalOrderNumber || row.storeOrderNumber || row.id;
}

function skuEquals(left, right) {
  return normalizeText(left) === normalizeText(right);
}

function backupStatusLabel(status) {
  if (status === 'cancelado') return 'Cancelado';
  if (status === 'despachado') return 'Despachado';
  const labels = {
    preparacion: 'En preparacion',
    armado: 'Armado',
    rotulado: 'Rotulado'
  };
  return labels[status] || status || '';
}

function compactNotes(parts) {
  const seen = new Set();
  return parts
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .flatMap((value) => value.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean))
    .filter((value) => {
      const key = normalizeText(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(' - ');
}

function orderItems(order = {}) {
  const sourceItems = Array.isArray(order.items) && order.items.length
    ? order.items
    : [{
        sku: order.sku,
        name: order.name,
        color: order.color,
        size: order.size,
        purchasePrice: order.purchasePrice,
        salePrice: order.salePrice,
        quantity: order.quantity
      }];
  return sourceItems.map((item) => ({
    sku: item.sku || '',
    name: item.name || '',
    color: item.color || '',
    size: item.size || '',
    purchasePrice: Number(item.purchasePrice || 0),
    salePrice: Number(item.salePrice || 0),
    quantity: Number(item.quantity || 1)
  }));
}

function backupRowIndex(row) {
  const match = String(row.id || '').match(/:(\d+)$/);
  return match ? Number(match[1]) : -1;
}

function matchingOrderForBackupRow(row, orders = []) {
  return orders.find((order) =>
    order.id === row.orderId ||
    (String(order.internalOrderNumber || '').trim() && String(order.internalOrderNumber || '').trim() === String(row.internalOrderNumber || '').trim()) ||
    (String(order.storeOrderNumber || '').trim() && String(order.storeOrderNumber || '').trim() === String(row.storeOrderNumber || '').trim())
  );
}

function internalOrderNote(order) {
  return String(order?.internalNotes ?? order?.notes ?? '').trim();
}

function backupOrderNotes(order, previousNotes = '', cancelReason = '') {
  return compactNotes([
    previousNotes,
    order?.customerNotes ? `Cliente: ${order.customerNotes}` : '',
    order?.externalNotes ? `Externa: ${order.externalNotes}` : '',
    internalOrderNote(order) ? `Interna: ${internalOrderNote(order)}` : '',
    order?.packagingNote ? `Empaquetado: ${order.packagingNote}` : '',
    cancelReason ? `Cancelado: ${cancelReason}` : ''
  ]);
}

function itemForBackupRow(order, row) {
  const items = orderItems(order);
  const index = backupRowIndex(row);
  if (index >= 0 && items[index]) return items[index];
  return items.find((item) => skuEquals(item.sku, row.sku) && normalizeText(item.size) === normalizeText(row.size) && normalizeText(item.color) === normalizeText(row.color)) ||
    items.find((item) => skuEquals(item.sku, row.sku)) ||
    null;
}

function syncBackupRowsWithOrders(rows, orders = []) {
  return rows.map((row) => {
    const order = matchingOrderForBackupRow(row, orders);
    if (!order) {
      return {
        ...row,
        statusLabel: row.statusLabel || (row.cancelled ? 'Cancelado' : '')
      };
    }
    const item = itemForBackupRow(order, row);
    return {
      ...row,
      customer: order.customer || row.customer,
      internalOrderNumber: order.internalOrderNumber || row.internalOrderNumber,
      storeOrderNumber: order.storeOrderNumber || row.storeOrderNumber,
      postalCode: order.postalCode || row.postalCode,
      shippingCompany: order.shippingCompany || row.shippingCompany,
      salesChannel: order.salesChannel || row.salesChannel,
      account: order.account || row.account,
      invoice: order.invoice || row.invoice,
      commissionRate: order.commissionRate ?? row.commissionRate,
      paymentMethod: order.paymentMethod || row.paymentMethod,
      sku: item?.sku || row.sku,
      color: item?.color || row.color,
      size: item?.size || row.size,
      purchasePrice: Number(item?.purchasePrice || 0) > 0 ? item.purchasePrice : row.purchasePrice,
      salePrice: item ? item.salePrice : row.salePrice,
      quantity: item ? item.quantity : row.quantity,
      status: order.status || row.status,
      statusLabel: backupStatusLabel(order.status),
      packagingNote: order.packagingNote || row.packagingNote || '',
      customerNotes: order.customerNotes || row.customerNotes || '',
      externalNotes: order.externalNotes || row.externalNotes || '',
      internalNotes: internalOrderNote(order) || row.internalNotes || '',
      notes: backupOrderNotes(order, row.notes, row.cancelReason),
      cancelled: Boolean(row.cancelled || order.cancelled || order.status === 'cancelado'),
      cancelledAt: row.cancelledAt || order.cancelledAt || '',
      cancelReason: row.cancelReason || order.cancelReason || ''
    };
  });
}

function prorateBackupShippingRows(rows) {
  const groups = rows.reduce((map, row) => {
    const key = backupGroupKey(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
    return map;
  }, new Map());

  return rows.map((row) => {
    const key = backupGroupKey(row);
    const group = groups.get(key) || [row];
    if (group.length <= 1) return row;
    const groupQuantity = group.reduce((sum, item) => sum + Number(item.quantity || 1), 0) || 1;
    const totalShipping = row.totalShippingValue !== undefined
      ? Number(row.totalShippingValue || 0)
      : Math.max(...group.map((item) => Number(item.shippingValue || 0)));
    return {
      ...row,
      shippingValue: (totalShipping / groupQuantity) * Number(row.quantity || 1)
    };
  });
}

function facundoCalvoBackupRows() {
  const orderId = 'manual-correction-6443';
  return Array.from({ length: 33 }, (_, index) => ({
    id: `${orderId}:${index}`,
    orderId,
    approvedDate: '2026-05-21',
    createdAt: '2026-05-21',
    approvedAt: '2026-05-21',
    internalOrderNumber: '6443',
    storeOrderNumber: '',
    customer: 'Facundo Calvo',
    sku: 'Camp-Sst-Ad',
    name: 'Campera Adidas SST',
    color: 'Verde',
    size: '',
    purchasePrice: 17000,
    salePrice: 27000,
    quantity: 1,
    shippingValue: 8100,
    totalShippingValue: 8100,
    paymentMethod: 'Transferencia',
    paymentStatus: 'aprobado',
    account: 'EG',
    commissionRate: 0,
    shippingCompany: 'Flux',
    salesChannel: 'WhatsApp',
    postalCode: '',
    invoice: 'No',
    status: 'despachado',
    statusLabel: 'Despachado',
    cancelled: false,
    notes: 'Correccion historica: pedido manual recuperado'
  }));
}

function ignacioGonzalesBackupRows() {
  const orderId = 'manual-correction-6558';
  const common = {
    orderId,
    approvedDate: '2026-05-27',
    createdAt: '2026-05-27',
    approvedAt: '2026-05-27T17:33:58.863Z',
    internalOrderNumber: '6558',
    storeOrderNumber: '',
    customer: 'Ignacio Gonzales',
    name: '',
    shippingValue: 0,
    totalShippingValue: 0,
    paymentMethod: 'Transferencia',
    paymentStatus: 'aprobado',
    account: 'AD',
    commissionRate: 0,
    shippingCompany: 'Flux',
    salesChannel: 'WhatsApp',
    postalCode: '1663',
    invoice: 'No',
    status: 'despachado',
    statusLabel: 'Despachado',
    cancelled: false,
    notes: 'Correccion historica: pedido mayorista recuperado'
  };
  const items = [
    ['PAN-BAG-DTF', 'Gris', 'M', 15000, 22368.18],
    ['PAN-BAG-DTF', 'Gris', 'L', 15000, 22368.18],
    ['PAN-BAG-DTF', 'Gris', 'L', 15000, 22368.18],
    ['PAN-BAG-DTF', 'Gris', 'L', 15000, 22368.18],
    ['PAN-BAG-DTF', 'Gris', 'L', 15000, 22368.18],
    ['PAN-BAG-DTF', 'Gris', 'XL', 15000, 22368.18],
    ['PAN-BAG-DTF', 'Gris', 'XL', 15000, 22368.18],
    ['PAN-BAG-DTF', 'Gris', 'XXL', 15000, 22368.18],
    ['PAN-BAG-DTF', 'Negro', 'S', 15000, 22368.18],
    ['PAN-BAG-DTF', 'Negro', 'M', 15000, 22368.18],
    ['PAN-BAG-DTF', 'Negro', 'L', 15000, 22368.18],
    ['PAN-BAG-DTF', 'Negro', 'XL', 15000, 22368.18],
    ['BUZ-CANG-DTF', 'Negro', 'S', 16000, 20368.18],
    ['BUZ-CANG-DTF', 'Negro', 'M', 16000, 20368.18],
    ['BUZ-CANG-DTF', 'Negro', 'L', 16000, 20368.18],
    ['BUZ-CANG-DTF', 'Negro', 'XL', 16000, 20368.18],
    ['BUZ-CANG-DTF', 'Negro', 'XXL', 16000, 20368.18],
    ['BUZ-CANG-DTF', 'Negro', 'S', 16000, 20368.18],
    ['BUZ-CANG-DTF', 'Negro', 'M', 16000, 20368.18],
    ['BUZ-CANG-DTF', 'Negro', 'L', 16000, 20368.18],
    ['BUZ-CANG-DTF', 'Negro', 'XL', 16000, 20368.18],
    ['BUZ-CANG-DTF', 'Negro', 'XXL', 16000, 20368.18]
  ];
  return items.map(([sku, color, size, purchasePrice, salePrice], index) => ({
    ...common,
    id: `${orderId}:${index}`,
    sku,
    color,
    size,
    purchasePrice,
    salePrice,
    quantity: 1
  }));
}

function pabloDeMatteiBackupRows() {
  const orderId = 'historical-correction-6402';
  return [{
    id: `${orderId}:0`,
    orderId,
    approvedDate: '2026-04-30',
    createdAt: '2026-04-30',
    approvedAt: '2026-04-30',
    internalOrderNumber: '6038',
    storeOrderNumber: '6402',
    customer: 'Pablo De Mattei',
    sku: 'Pan-Sst-Ad',
    name: '',
    color: 'Verde',
    size: 'L',
    purchasePrice: 13000,
    salePrice: 27000,
    quantity: 1,
    shippingValue: 3699,
    totalShippingValue: 3699,
    paymentMethod: 'Transferencia',
    paymentStatus: 'aprobado',
    account: 'AD',
    commissionRate: 0,
    shippingCompany: 'Flux',
    salesChannel: 'Tienda Nube',
    postalCode: '1425',
    invoice: 'No',
    status: 'despachado',
    statusLabel: 'Despachado',
    cancelled: false,
    notes: 'Correccion historica: pedido Tienda Nube 6402 recuperado',
    fluxZone: 0,
    fluxZoneName: 'CABA',
    fluxExpectedZone: 0,
    fluxSettledAt: '2026-05-09T16:56:49.487Z',
    fluxCollectedValue: null
  }];
}

function backupRowsNeedCorrection(existingRows, correctionRows, expected) {
  return (
    existingRows.length !== correctionRows.length ||
    existingRows.some((row) =>
      String(row.customer || '').trim() !== expected.customer ||
      Number(row.purchasePrice || 0) <= 0 ||
      Number(row.salePrice || 0) <= 0
    )
  );
}

const FORCED_REMOVED_BACKUP_INTERNAL_NUMBERS = [
  '6041',
  '6049',
  '6066',
  '6324',
  '6328',
  '6591',
  '6607',
  '6638',
  '6710',
  '6723',
  '6750',
  '6760',
  '6821',
  '6908',
  '6523',
  '6524'
];
const FORCE_CANCELLED_BACKUP_STORE_NUMBERS = ['7280'];
const SEBASTIAN_ORTEGA_INTERNAL_NUMBER = '6515';
const SEBASTIAN_ORTEGA_TOTAL_SHIPPING = 15400;

function ensureHistoricManualCorrections(state = {}) {
  const backupRows = Array.isArray(state.backupRows) ? state.backupRows : [];
  const dismissedStoreSet = new Set(
    (Array.isArray(state.dismissedStoreOrders) ? state.dismissedStoreOrders : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
  const removedBackupInternalNumbers = [...new Set([
    ...(Array.isArray(state.removedBackupInternalNumbers) ? state.removedBackupInternalNumbers : []),
    ...FORCED_REMOVED_BACKUP_INTERNAL_NUMBERS
  ].map((value) => String(value || '').trim()).filter(Boolean))];
  const removedBackupInternalSet = new Set(removedBackupInternalNumbers);
  const filteredBackupRows = backupRows.filter((row) =>
    !removedBackupInternalSet.has(String(row.internalOrderNumber || '').trim())
  );
  let sebastianShippingChanged = false;
  let forcedCancelledChanged = false;
  const normalizedBackupRows = filteredBackupRows.map((row) => {
    const storeOrderNumber = String(row.storeOrderNumber || '').trim();
    const shouldForceCancel =
      FORCE_CANCELLED_BACKUP_STORE_NUMBERS.includes(storeOrderNumber) &&
      dismissedStoreSet.has(storeOrderNumber) &&
      !row.cancelled;
    const isSebastianOrtega =
      String(row.internalOrderNumber || '').trim() === SEBASTIAN_ORTEGA_INTERNAL_NUMBER &&
      String(row.customer || '').trim().toLowerCase() === 'sebastian ortega';
    let nextRow = row;
    if (shouldForceCancel) {
      forcedCancelledChanged = true;
      nextRow = {
        ...nextRow,
        cancelled: true,
        cancelledAt: nextRow.cancelledAt || new Date().toISOString(),
        cancelReason: nextRow.cancelReason || 'Cancelado',
        notes: [nextRow.notes, `Cancelado TN ${storeOrderNumber}`].filter(Boolean).join(' - ')
      };
    }
    if (!isSebastianOrtega) return nextRow;
    if (
      Number(nextRow.totalShippingValue || 0) === SEBASTIAN_ORTEGA_TOTAL_SHIPPING &&
      Number(nextRow.shippingValue || 0) === SEBASTIAN_ORTEGA_TOTAL_SHIPPING
    ) {
      return nextRow;
    }
    sebastianShippingChanged = true;
    return {
      ...nextRow,
      shippingValue: SEBASTIAN_ORTEGA_TOTAL_SHIPPING,
      totalShippingValue: SEBASTIAN_ORTEGA_TOTAL_SHIPPING
    };
  });
  const removedRowsChanged = filteredBackupRows.length !== backupRows.length;
  const removedListChanged = removedBackupInternalNumbers.length !== (
    Array.isArray(state.removedBackupInternalNumbers) ? state.removedBackupInternalNumbers : []
  ).length;
  const facundoRows = facundoCalvoBackupRows();
  const ignacioRows = ignacioGonzalesBackupRows();
  const pabloRows = pabloDeMatteiBackupRows();
  const existingFacundoRows = normalizedBackupRows.filter((row) =>
    String(row.internalOrderNumber || '').trim() === '6443' ||
    String(row.orderId || '').trim() === 'manual-correction-6443'
  );
  const existingIgnacioRows = normalizedBackupRows.filter((row) =>
    String(row.internalOrderNumber || '').trim() === '6558' ||
    String(row.orderId || '').trim() === 'manual-correction-6558'
  );
  const existingPabloRows = normalizedBackupRows.filter((row) =>
    String(row.internalOrderNumber || '').trim() === '6038' ||
    String(row.storeOrderNumber || '').trim() === '6402' ||
    String(row.orderId || '').trim() === 'historical-correction-6402'
  );
  const needsFacundoCalvoCorrection =
    existingFacundoRows.length !== facundoRows.length ||
    existingFacundoRows.some((row) =>
      String(row.customer || '').trim() !== 'Facundo Calvo' ||
      Number(row.purchasePrice || 0) !== 17000 ||
      Number(row.salePrice || 0) !== 27000 ||
      Number(row.totalShippingValue || row.shippingValue || 0) !== 8100
    );
  const needsIgnacioGonzalesCorrection = backupRowsNeedCorrection(
    existingIgnacioRows,
    ignacioRows,
    { customer: 'Ignacio Gonzales' }
  );
  const needsPabloDeMatteiCorrection =
    existingPabloRows.length !== pabloRows.length ||
    existingPabloRows.some((row) =>
      String(row.customer || '').trim() !== 'Pablo De Mattei' ||
      String(row.storeOrderNumber || '').trim() !== '6402' ||
      Number(row.purchasePrice || 0) !== 13000 ||
      Number(row.salePrice || 0) !== 27000 ||
      Number(row.totalShippingValue || row.shippingValue || 0) !== 3699
    );
  if (
    !removedRowsChanged &&
    !removedListChanged &&
    !sebastianShippingChanged &&
    !forcedCancelledChanged &&
    !needsFacundoCalvoCorrection &&
    !needsIgnacioGonzalesCorrection &&
    !needsPabloDeMatteiCorrection
  ) {
    return { state, changed: false };
  }

  const preservedRows = normalizedBackupRows.filter((row) =>
    String(row.internalOrderNumber || '').trim() !== '6443' &&
    String(row.orderId || '').trim() !== 'manual-correction-6443' &&
    String(row.internalOrderNumber || '').trim() !== '6558' &&
    String(row.orderId || '').trim() !== 'manual-correction-6558' &&
    String(row.internalOrderNumber || '').trim() !== '6038' &&
    String(row.storeOrderNumber || '').trim() !== '6402' &&
    String(row.orderId || '').trim() !== 'historical-correction-6402'
  );
  const correctionRows = [
    ...(needsFacundoCalvoCorrection ? facundoRows : existingFacundoRows),
    ...(needsIgnacioGonzalesCorrection ? ignacioRows : existingIgnacioRows),
    ...(needsPabloDeMatteiCorrection ? pabloRows : existingPabloRows)
  ];
  return {
    state: {
      ...state,
      backupRows: [...correctionRows, ...preservedRows],
      removedBackupInternalNumbers,
      savedAt: new Date().toISOString()
    },
    changed: true
  };
}

async function persistAppState(state) {
  const updatedAt = new Date().toISOString();
  const result = await callSupabase(`${SUPABASE_STATE_TABLE}?on_conflict=id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      id: APP_STATE_ID,
      state,
      updated_at: updatedAt
    })
  });
  return { result, updatedAt };
}

function backupRowValues(row) {
  const quantity = roundMoney(row.quantity || 0);
  const purchasePrice = roundMoney(row.purchasePrice || 0);
  const salePrice = roundMoney(row.salePrice || 0);
  const shippingValue = roundMoney(row.shippingValue || 0);
  const commissionRate = Number(row.commissionRate || 0);
  const totalCost = roundMoney(purchasePrice * quantity);
  const totalSale = roundMoney(salePrice * quantity);
  const commission = roundMoney(totalSale * (commissionRate / 100));
  const gain = roundMoney(totalSale - totalCost - shippingValue - commission);
  const payOnDelivery = normalizeText(row.paymentMethod) === 'abonar al recibir';
  const payOnDeliveryCollected = row.fluxCollectedValue !== null && row.fluxCollectedValue !== undefined && row.fluxCollectedValue !== '';
  const hideSaleValues = payOnDelivery && !payOnDeliveryCollected;

  return [
    row.internalOrderNumber,
    row.approvedDate,
    row.sku,
    quantity,
    purchasePrice,
    totalCost,
    hideSaleValues ? '' : salePrice,
    hideSaleValues ? '' : totalSale,
    row.paymentMethod,
    row.account,
    shippingValue,
    row.shippingCompany,
    row.salesChannel,
    `${commissionRate.toFixed(3)} %`,
    hideSaleValues ? '' : gain,
    row.customer,
    row.postalCode,
    row.invoice,
    row.color,
    row.size,
    row.statusLabel || backupStatusLabel(row.status),
    row.cancelled ? 'Si' : 'No',
    row.notes
  ];
}

function roundMoney(value) {
  let number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  while (Math.abs(number) >= 1000000) number /= 1000;
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function formatExcelNumber(value) {
  if (value === '' || value === null || value === undefined) return '';
  const number = roundMoney(value);
  if (!Number.isFinite(number)) return value;
  return number.toFixed(2).replace('.', ',');
}

function excelCellValue(value, cellIndex) {
  const numericColumns = [3, 4, 5, 6, 7, 10, 14].includes(cellIndex);
  return numericColumns ? formatExcelNumber(value) : value;
}

function excelNumericAttribute(value, cellIndex) {
  const numericColumns = [3, 4, 5, 6, 7, 10, 14].includes(cellIndex);
  if (!numericColumns || value === '' || value === null || value === undefined) return '';
  const number = roundMoney(value);
  return Number.isFinite(number) ? ` x:num="${number}"` : '';
}

function consecutiveBackupRowspan(rows, startIndex, key) {
  let count = 0;
  for (let index = startIndex; index < rows.length; index += 1) {
    if (backupGroupKey(rows[index]) !== key) break;
    count += 1;
  }
  return count;
}

function buildBackupExcelBuffer(rows) {
  const head = backupHeaders.map((header) => `<th>${escapeHtml(header)}</th>`).join('');
  let groupIndex = -1;
  const body = rows.map((row, rowIndex) => {
    const values = backupRowValues(row);
    const key = backupGroupKey(row);
    const previousKey = rowIndex > 0 ? backupGroupKey(rows[rowIndex - 1]) : '';
    const firstInGroup = key !== previousKey;
    if (firstInGroup) groupIndex += 1;
    const rowClasses = [
      firstInGroup ? 'order-start' : '',
      groupIndex % 2 === 0 ? 'order-even' : 'order-odd',
      row.cancelled ? 'cancelled-row' : ''
    ].filter(Boolean).join(' ');
    const cells = values.map((value, cellIndex) => {
      const numericClass = [3, 4, 5, 6, 7, 10, 14].includes(cellIndex) ? ' number-cell' : '';
      const displayValue = excelCellValue(value, cellIndex);
      const numericAttribute = excelNumericAttribute(value, cellIndex);
      if (cellIndex !== 0) return `<td class="col-${cellIndex}${numericClass}"${numericAttribute}>${escapeHtml(displayValue)}</td>`;
      if (!firstInGroup) return '';
      const rowspan = consecutiveBackupRowspan(rows, rowIndex, key);
      const rowspanAttribute = rowspan > 1 ? ` rowspan="${rowspan}"` : '';
      return `<td class="order-number"${rowspanAttribute}>${escapeHtml(displayValue)}</td>`;
    }).join('');
    return `<tr class="${rowClasses}">${cells}</tr>`;
  }).join('');
  const html = `<!doctype html>
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; color: #111827; }
          table { border-collapse: collapse; width: 100%; }
          th { background: #5330a0; color: #ffffff; border: 1px solid #3f2479; font-size: 12px; font-weight: 700; padding: 8px 10px; text-align: left; white-space: nowrap; }
          td { border: 1px solid #d1d5db; font-size: 12px; padding: 7px 10px; vertical-align: middle; }
          .number-cell { text-align: right; mso-number-format: "#,##0.00"; }
          .order-number { background: #ede8fa; border-left: 3px solid #6c3fc5; color: #3f2479; font-size: 14px; font-weight: 700; text-align: center; vertical-align: middle; }
          .order-start td { border-top: 3px solid #6c3fc5; }
          .order-even td { background: #ffffff; }
          .order-odd td { background: #f9fafb; }
          .cancelled-row td, .cancelled-row .order-number { background: #fce7f3 !important; color: #831843; }
          .order-even .order-number, .order-odd .order-number { background: #ede8fa; }
          .cancelled-row .order-number { background: #fce7f3 !important; color: #831843 !important; }
          .col-2 { font-weight: 700; }
          .col-8, .col-11, .col-12 { color: #374151; }
          .col-14 { font-weight: 700; }
        </style>
      </head>
      <body>
        <table>
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </body>
    </html>`;
  return Buffer.from(html, 'utf8');
}

function buildFullAppBackupBuffer(state = {}) {
  const payload = {
    type: 'incognito-ventas-full-backup',
    version: 1,
    generatedAt: new Date().toISOString(),
    appStateId: APP_STATE_ID,
    state
  };
  return Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
}

async function updateSharePointBackupHistory() {
  const stored = await getStoredAppState();
  const correction = ensureHistoricManualCorrections(stored.state || {});
  const state = correction.state;
  if (correction.changed) await persistAppState(state);
  const rows = prorateBackupShippingRows(syncBackupRowsWithOrders(
    Array.isArray(state.backupRows) ? state.backupRows : [],
    Array.isArray(state.orders) ? state.orders : []
  ));
  const item = await uploadSharePointFile(
    SHAREPOINT_BACKUP_PATH,
    buildBackupExcelBuffer(rows),
    'application/vnd.ms-excel;charset=utf-8'
  );
  const fullBackupItem = await uploadSharePointFile(
    SHAREPOINT_FULL_BACKUP_PATH,
    buildFullAppBackupBuffer(state),
    'application/json;charset=utf-8'
  );
  return {
    item,
    fullBackupItem,
    rows: rows.length,
    filename: SHAREPOINT_BACKUP_PATH.split('/').pop() || SHAREPOINT_BACKUP_PATH,
    fullBackupFilename: SHAREPOINT_FULL_BACKUP_PATH.split('/').pop() || SHAREPOINT_FULL_BACKUP_PATH
  };
}

function contableSupabaseEnabled() {
  return Boolean(CONTABLE_SUPABASE_URL && CONTABLE_SUPABASE_KEY);
}

async function callContableSupabase(pathname, options = {}) {
  if (!contableSupabaseEnabled()) {
    const error = new Error('Supabase contable no esta configurado.');
    error.statusCode = 503;
    throw error;
  }

  const response = await fetch(`${CONTABLE_SUPABASE_URL}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: CONTABLE_SUPABASE_KEY,
      Authorization: `Bearer ${CONTABLE_SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: response.ok, status: response.status, data };
}

async function fetchAllContableRows(table, orderColumn = 'fecha') {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const query = `${table}?select=*&order=${encodeURIComponent(`${orderColumn}.asc`)}`;
    const result = await callContableSupabase(query, {
      method: 'GET',
      headers: { Range: `${from}-${to}` }
    });
    if (!result.ok) {
      const error = new Error(`Supabase contable ${table}: ${JSON.stringify(result.data)}`);
      error.statusCode = result.status;
      throw error;
    }
    const chunk = Array.isArray(result.data) ? result.data : [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return rows;
}

async function getStoredContableState() {
  const [transactions, transfers] = await Promise.all([
    fetchAllContableRows('transactions', 'fecha'),
    fetchAllContableRows('transfers', 'fecha')
  ]);
  return {
    type: 'incognito-contable-full-backup',
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'incognito-ventas-backend',
    transactions,
    transfers,
    counts: {
      transactions: transactions.length,
      transfers: transfers.length
    }
  };
}

function formatContableNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString('es-AR', { maximumFractionDigits: 2 }) : '';
}

function buildContableBackupExcelBuffer(state = {}) {
  const transactions = Array.isArray(state.transactions) ? state.transactions : [];
  const transfers = Array.isArray(state.transfers) ? state.transfers : [];
  const txRows = transactions.map((tx) => `
    <tr>
      <td>${escapeHtml(tx.fecha || '')}</td>
      <td>${escapeHtml(tx.descripcion || '')}</td>
      <td>${escapeHtml(tx.nro_interno || tx.nroInterno || '')}</td>
      <td>${escapeHtml(tx.categoria || '')}</td>
      <td>${escapeHtml(tx.cuenta || '')}</td>
      <td class="number-cell">${formatContableNumber(tx.ingreso)}</td>
      <td class="number-cell">${formatContableNumber(tx.egreso)}</td>
      <td>${escapeHtml(tx.pendiente ? 'Pendiente' : 'Completo')}</td>
    </tr>`).join('');
  const trRows = transfers.map((tr) => `
    <tr>
      <td>${escapeHtml(tr.fecha || '')}</td>
      <td>${escapeHtml(tr.origen || '')}</td>
      <td>${escapeHtml(tr.destino || '')}</td>
      <td class="number-cell">${formatContableNumber(tr.monto)}</td>
      <td>${escapeHtml(tr.descripcion || '')}</td>
    </tr>`).join('');
  const html = `<!doctype html>
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; color: #111827; }
          h1 { color: #3f2479; }
          h2 { color: #5330a0; margin-top: 26px; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 24px; }
          th { background: #5330a0; color: #ffffff; border: 1px solid #3f2479; font-size: 12px; font-weight: 700; padding: 8px 10px; text-align: left; white-space: nowrap; }
          td { border: 1px solid #d1d5db; font-size: 12px; padding: 7px 10px; vertical-align: middle; }
          .number-cell { text-align: right; mso-number-format: "#,##0.00"; }
        </style>
      </head>
      <body>
        <h1>Backup contable Incognito</h1>
        <p>Generado: ${escapeHtml(state.generatedAt || '')}</p>

        <h2>Transacciones (${transactions.length})</h2>
        <table>
          <thead><tr><th>Fecha</th><th>Descripcion</th><th>Nro interno</th><th>Categoria</th><th>Cuenta</th><th>Ingreso</th><th>Egreso</th><th>Estado</th></tr></thead>
          <tbody>${txRows}</tbody>
        </table>

        <h2>Transferencias (${transfers.length})</h2>
        <table>
          <thead><tr><th>Fecha</th><th>Origen</th><th>Destino</th><th>Monto</th><th>Descripcion</th></tr></thead>
          <tbody>${trRows}</tbody>
        </table>
      </body>
    </html>`;
  return Buffer.from(html, 'utf8');
}

function buildContableFullBackupBuffer(state = {}) {
  return Buffer.from(JSON.stringify(state, null, 2), 'utf8');
}

async function updateSharePointContableBackup() {
  if (!SHAREPOINT_CONTABLE_BACKUP_PATH) {
    const error = new Error('Falta configurar SHAREPOINT_CONTABLE_BACKUP_PATH en Render.');
    error.statusCode = 503;
    throw error;
  }
  const state = await getStoredContableState();
  const item = await uploadSharePointFile(
    SHAREPOINT_CONTABLE_BACKUP_PATH,
    buildContableBackupExcelBuffer(state),
    'application/vnd.ms-excel;charset=utf-8'
  );
  const fullBackupItem = await uploadSharePointFile(
    SHAREPOINT_CONTABLE_FULL_BACKUP_PATH,
    buildContableFullBackupBuffer(state),
    'application/json;charset=utf-8'
  );
  return {
    item,
    fullBackupItem,
    rows: state.counts.transactions,
    transfers: state.counts.transfers,
    filename: SHAREPOINT_CONTABLE_BACKUP_PATH.split('/').pop() || SHAREPOINT_CONTABLE_BACKUP_PATH,
    fullBackupFilename: SHAREPOINT_CONTABLE_FULL_BACKUP_PATH.split('/').pop() || SHAREPOINT_CONTABLE_FULL_BACKUP_PATH
  };
}

const PROCESS_STATUS_RANK = {
  definir: 0,
  preparacion: 1,
  armado: 2,
  rotulado: 3,
  despachado: 4
};

function timestampMs(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function orderRank(order = {}) {
  return PROCESS_STATUS_RANK[order.status] ?? -1;
}

function orderTime(order = {}) {
  return Math.max(
    timestampMs(order.updatedAt),
    timestampMs(order.statusUpdatedAt),
    timestampMs(order.stockDeductedAt),
    timestampMs(order.stockBypassedAt),
    timestampMs(order.fluxSentAt),
    timestampMs(order.approvedAt),
    timestampMs(order.insertedAt),
    timestampMs(order.purchasedAt)
  );
}

function orderKey(order = {}) {
  return String(order.id || order.internalOrderNumber || order.storeOrderNumber || '').trim();
}

function mergeOrderWithPreservedFields(baseOrder = {}, overrideOrder = {}) {
  const merged = { ...baseOrder, ...overrideOrder };
  if (!String(merged.paymentGatewayId || '').trim()) {
    merged.paymentGatewayId = String(overrideOrder.paymentGatewayId || baseOrder.paymentGatewayId || '').trim();
  }
  if (!String(merged.paymentGatewayLink || '').trim()) {
    merged.paymentGatewayLink = String(overrideOrder.paymentGatewayLink || baseOrder.paymentGatewayLink || '').trim();
  }
  return merged;
}

function mergeOrder(localOrder = {}, remoteOrder = {}) {
  const localCancelled = Boolean(localOrder.cancelled || localOrder.status === 'cancelado');
  const remoteCancelled = Boolean(remoteOrder.cancelled || remoteOrder.status === 'cancelado');
  if (localCancelled !== remoteCancelled) {
    return localCancelled
      ? mergeOrderWithPreservedFields(remoteOrder, localOrder)
      : mergeOrderWithPreservedFields(localOrder, remoteOrder);
  }

  const localStatusTime = timestampMs(localOrder.statusUpdatedAt);
  const remoteStatusTime = timestampMs(remoteOrder.statusUpdatedAt);
  if (Math.abs(localStatusTime - remoteStatusTime) > 100) {
    return localStatusTime > remoteStatusTime
      ? mergeOrderWithPreservedFields(remoteOrder, localOrder)
      : mergeOrderWithPreservedFields(localOrder, remoteOrder);
  }

  const localRank = orderRank(localOrder);
  const remoteRank = orderRank(remoteOrder);
  if (localRank !== remoteRank && localRank >= 0 && remoteRank >= 0) {
    return localRank > remoteRank
      ? mergeOrderWithPreservedFields(remoteOrder, localOrder)
      : mergeOrderWithPreservedFields(localOrder, remoteOrder);
  }

  const localTime = orderTime(localOrder);
  const remoteTime = orderTime(remoteOrder);
  if (Math.abs(localTime - remoteTime) > 1000) {
    return localTime > remoteTime
      ? mergeOrderWithPreservedFields(remoteOrder, localOrder)
      : mergeOrderWithPreservedFields(localOrder, remoteOrder);
  }
  return mergeOrderWithPreservedFields(remoteOrder, localOrder);
}

function mergeByKey(localItems = [], remoteItems = [], keyFn) {
  const map = new Map();
  remoteItems.forEach((item) => {
    const key = keyFn(item);
    if (key) map.set(key, item);
  });
  localItems.forEach((item) => {
    const key = keyFn(item);
    if (!key) return;
    map.set(key, map.has(key) ? { ...map.get(key), ...item } : item);
  });
  return [...map.values()];
}

function mergePrintedGarmentState(current = {}, incoming = {}) {
  const currentUsed = Boolean(current.usedAt || current.usedOrderId);
  const incomingUsed = Boolean(incoming.usedAt || incoming.usedOrderId);
  if (currentUsed && !incomingUsed) return { ...incoming, ...current };
  if (incomingUsed && !currentUsed) return { ...current, ...incoming };
  return { ...current, ...incoming };
}

function mergePrintedGarments(localItems = [], remoteItems = [], deletedIds = []) {
  const deletedSet = new Set(deletedIds.map((value) => String(value || '').trim()).filter(Boolean));
  const keyFor = (item = {}) => String(item.id || `${item.sku || ''}:${item.color || ''}:${item.size || ''}`).trim();
  const map = new Map();
  remoteItems.forEach((item) => {
    const key = keyFor(item);
    if (key && !deletedSet.has(key)) map.set(key, item);
  });
  localItems.forEach((item) => {
    const key = keyFor(item);
    if (!key || deletedSet.has(key)) return;
    map.set(key, map.has(key) ? mergePrintedGarmentState(map.get(key), item) : item);
  });
  return [...map.values()];
}

function mergeDismissedOrders(localState = {}, remoteState = {}) {
  return [...new Set([
    ...(Array.isArray(remoteState.dismissedStoreOrders) ? remoteState.dismissedStoreOrders : []),
    ...(Array.isArray(localState.dismissedStoreOrders) ? localState.dismissedStoreOrders : [])
  ].map((value) => String(value || '').trim()).filter(Boolean))];
}

function mergeRecoveredStoreOrders(localState = {}, remoteState = {}) {
  return [...new Set([
    ...(Array.isArray(remoteState.recoveredStoreOrders) ? remoteState.recoveredStoreOrders : []),
    ...(Array.isArray(localState.recoveredStoreOrders) ? localState.recoveredStoreOrders : [])
  ].map((value) => String(value || '').trim()).filter(Boolean))];
}

function mergeDismissedOrderIds(localState = {}, remoteState = {}) {
  return [...new Set([
    ...(Array.isArray(remoteState.dismissedOrderIds) ? remoteState.dismissedOrderIds : []),
    ...(Array.isArray(localState.dismissedOrderIds) ? localState.dismissedOrderIds : [])
  ].map((value) => String(value || '').trim()).filter(Boolean))];
}

function mergeRemovedBackupInternalNumbers(localState = {}, remoteState = {}) {
  return [...new Set([
    ...(Array.isArray(remoteState.removedBackupInternalNumbers) ? remoteState.removedBackupInternalNumbers : []),
    ...(Array.isArray(localState.removedBackupInternalNumbers) ? localState.removedBackupInternalNumbers : [])
  ].map((value) => String(value || '').trim()).filter(Boolean))];
}

function mergeRemovedBackupRowIds(localState = {}, remoteState = {}) {
  return [...new Set([
    ...(Array.isArray(remoteState.removedBackupRowIds) ? remoteState.removedBackupRowIds : []),
    ...(Array.isArray(localState.removedBackupRowIds) ? localState.removedBackupRowIds : [])
  ].map((value) => String(value || '').trim()).filter(Boolean))];
}

function mergeDeletedPrintedGarmentIds(localState = {}, remoteState = {}) {
  return [...new Set([
    ...(Array.isArray(remoteState.deletedPrintedGarmentIds) ? remoteState.deletedPrintedGarmentIds : []),
    ...(Array.isArray(localState.deletedPrintedGarmentIds) ? localState.deletedPrintedGarmentIds : [])
  ].map((value) => String(value || '').trim()).filter(Boolean))];
}

function isDismissedOrder(order = {}, dismissedStoreOrders = [], dismissedOrderIds = []) {
  const storeOrder = String(order.storeOrderNumber || '').trim();
  const ids = [order.id, order.internalOrderNumber]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return (storeOrder && dismissedStoreOrders.includes(storeOrder)) ||
    ids.some((id) => dismissedOrderIds.includes(id));
}

function mergeAppState(localState = {}, remoteState = {}) {
  const localOrders = Array.isArray(localState.orders) ? localState.orders : [];
  const localActiveOrderIds = [...new Set(localOrders
    .flatMap((order) => [order.id, order.internalOrderNumber])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
  const dismissedStoreOrders = mergeDismissedOrders(localState, remoteState);
  const recoveredStoreOrders = mergeRecoveredStoreOrders(localState, remoteState)
    .filter((number) => !dismissedStoreOrders.includes(number));
  const dismissedOrderIds = mergeDismissedOrderIds(localState, remoteState)
    .filter((id) => !localActiveOrderIds.includes(id));
  const removedBackupInternalNumbers = mergeRemovedBackupInternalNumbers(localState, remoteState);
  const removedBackupRowIds = mergeRemovedBackupRowIds(localState, remoteState);
  const deletedPrintedGarmentIds = mergeDeletedPrintedGarmentIds(localState, remoteState);
  const ordersMap = new Map();
  const exchangesMap = new Map();

  (Array.isArray(remoteState.orders) ? remoteState.orders : []).forEach((order) => {
    const key = orderKey(order);
    if (key && !isDismissedOrder(order, dismissedStoreOrders, dismissedOrderIds)) ordersMap.set(key, order);
  });

  localOrders.forEach((order) => {
    const key = orderKey(order);
    if (!key || isDismissedOrder(order, dismissedStoreOrders, dismissedOrderIds)) return;
    ordersMap.set(key, ordersMap.has(key) ? mergeOrder(order, ordersMap.get(key)) : order);
  });

  (Array.isArray(remoteState.exchanges) ? remoteState.exchanges : []).forEach((exchange) => {
    const key = orderKey(exchange);
    if (key) exchangesMap.set(key, exchange);
  });

  (Array.isArray(localState.exchanges) ? localState.exchanges : []).forEach((exchange) => {
    const key = orderKey(exchange);
    if (!key) return;
    exchangesMap.set(key, exchangesMap.has(key) ? mergeOrder(exchange, exchangesMap.get(key)) : exchange);
  });

  const backupRows = mergeByKey(
    Array.isArray(localState.backupRows) ? localState.backupRows : [],
    Array.isArray(remoteState.backupRows) ? remoteState.backupRows : [],
    (row) => String(row.id || `${row.orderId || row.internalOrderNumber || row.storeOrderNumber || ''}:${row.sku || ''}:${row.talle || row.size || ''}:${row.color || ''}`).trim()
  ).filter((row) =>
    !removedBackupInternalNumbers.includes(String(row.internalOrderNumber || '').trim()) &&
    !removedBackupRowIds.includes(String(row.id || '').trim())
  );

  const merged = {
    ...remoteState,
    ...localState,
    orders: [...ordersMap.values()],
    exchanges: [...exchangesMap.values()],
    backupRows,
    stockLogRows: mergeByKey(
      Array.isArray(localState.stockLogRows) ? localState.stockLogRows : [],
      Array.isArray(remoteState.stockLogRows) ? remoteState.stockLogRows : [],
      (row) => String(row.id || `${row.date || ''}:${row.orderId || row.orderNumber || ''}:${row.requestedSku || row.sku || ''}:${row.quantity || ''}`).trim()
    ),
    printedGarments: mergePrintedGarments(
      Array.isArray(localState.printedGarments) ? localState.printedGarments : [],
      Array.isArray(remoteState.printedGarments) ? remoteState.printedGarments : [],
      deletedPrintedGarmentIds
    ),
    skuPrices: {
      ...(remoteState.skuPrices && typeof remoteState.skuPrices === 'object' ? remoteState.skuPrices : {}),
      ...(localState.skuPrices && typeof localState.skuPrices === 'object' ? localState.skuPrices : {})
    },
    accountSettings: {
      ...(remoteState.accountSettings && typeof remoteState.accountSettings === 'object' ? remoteState.accountSettings : {}),
      ...(localState.accountSettings && typeof localState.accountSettings === 'object' ? localState.accountSettings : {})
    },
    dismissedStoreOrders,
    dismissedOrderIds,
    recoveredStoreOrders,
    removedBackupInternalNumbers,
    removedBackupRowIds,
    deletedPrintedGarmentIds,
    internalSequence: Math.max(Number(localState.internalSequence || 5999), Number(remoteState.internalSequence || 5999)),
    savedAt: new Date().toISOString()
  };

  return ensureHistoricManualCorrections(merged).state;
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cellXml(column, rowNumber, value) {
  const address = `${column}${rowNumber}`;
  if (value === null || value === undefined || value === '') return `<x:c r="${address}"/>`;
  if (typeof value === 'number' && Number.isFinite(value)) return `<x:c r="${address}"><x:v>${value}</x:v></x:c>`;
  return `<x:c r="${address}" t="inlineStr"><x:is><x:t>${xmlEscape(value)}</x:t></x:is></x:c>`;
}

function rowXml(rowNumber, values) {
  const columns = 'ABCDEFGHIJKLMNOPQRS'.split('');
  return `<x:row r="${rowNumber}">${values.map((value, index) => cellXml(columns[index], rowNumber, value)).join('')}</x:row>`;
}


function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function branchListFromResponse(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.sucursales)) return data.sucursales;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  if (data && typeof data === 'object' && (data.codigo || data.descripcion || data.direccion)) return [data];
  return [];
}

async function fetchAndreaniBranches(query = {}) {
  const params = Object.entries(query)
    .map(([key, value]) => [key, String(value || '').trim()])
    .filter(([, value]) => value);
  if (!params.length) return [];

  const cacheKey = params.map(([key, value]) => `${key}:${normalizeText(value)}`).join('|');
  if (andreaniBranchCache.has(cacheKey)) return andreaniBranchCache.get(cacheKey);

  try {
    const url = new URL(ANDREANI_BRANCHES_URL);
    params.forEach(([key, value]) => url.searchParams.set(key, value));
    url.searchParams.set('canal', 'B2C');
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[Andreani sucursales] HTTP ${response.status}`);
      andreaniBranchCache.set(cacheKey, []);
      return [];
    }
    const branches = branchListFromResponse(await response.json());
    andreaniBranchCache.set(cacheKey, branches);
    return branches;
  } catch (err) {
    console.warn('[Andreani sucursales] Error:', err.message);
    andreaniBranchCache.set(cacheKey, []);
    return [];
  }
}

async function fetchAndreaniBranchesByLookup(lookup = {}) {
  const postalCode = String(lookup.postalCode || '').replace(/\D/g, '');
  const locality = String(lookup.locality || '').trim();
  const rawName = cleanGenericBranchName(lookup.rawName);
  const candidates = [];

  if (postalCode) candidates.push(...await fetchAndreaniBranches({ codigoPostal: postalCode }));
  if (!candidates.length && locality) candidates.push(...await fetchAndreaniBranches({ localidad: locality }));
  if (!candidates.length && rawName) candidates.push(...await fetchAndreaniBranches({ localidad: rawName }));

  return candidates;
}

function branchOfficialName(branch) {
  return branch?.descripcion || branch?.sucursal || branch?.codigo || '';
}

function cleanGenericBranchName(value) {
  let text = String(value || '').trim();
  if (!text) return '';
  text = text
    .replace(/\b(punto\s+hop|hop|sucursal\s+andreani|andreani|punto\s+de\s+retiro|punto\s+de\s+entrega|pickup\s+point|retiro\s+en\s+sucursal|retiro\s+sucursal|punto)\b/ig, ' ')
    .replace(/[-–—:|()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length >= 3 ? text : '';
}

function branchScore(branch, lookup = {}) {
  const address = branch.direccion || {};
  const branchText = normalizeText([
    branch.descripcion,
    branch.sucursal,
    branch.codigo,
    branch.numero,
    address.calle,
    address.numero,
    address.localidad,
    address.provincia,
    address.codigoPostal
  ].filter(Boolean).join(' '));
  const lookupName     = normalizeText(cleanGenericBranchName(lookup.rawName));
  const lookupLocality = normalizeText(lookup.locality);
  const lookupStreet   = normalizeText(lookup.street);
  const lookupNumber   = normalizeText(lookup.number);
  const lookupCode     = normalizeText(lookup.code);
  const lookupPostalCode = String(lookup.postalCode || '').replace(/\D/g, '');

  let score = 0;
  if (lookupCode && [branch.codigo, branch.numero, branch.id].some((value) => normalizeText(value) === lookupCode)) score += 55;
  if (lookupPostalCode && String(address.codigoPostal || '').replace(/\D/g, '') === lookupPostalCode) score += 40;
  if (lookupLocality && normalizeText(address.localidad).includes(lookupLocality)) score += 25;
  if (lookupLocality && lookupLocality.includes(normalizeText(address.localidad))) score += 18;
  if (lookupStreet && branchText.includes(lookupStreet)) score += 20;
  if (lookupNumber && String(address.numero || '').replace(/\D/g, '') === lookupNumber) score += 12;
  if (lookupName && branchText.includes(lookupName)) score += 30;
  if (branch.datosAdicionales?.entregaEnvios !== false) score += 5;
  return score;
}

async function resolveAndreaniBranchName(shipment) {
  const lookup = {
    ...(shipment.branchLookup || {}),
    rawName: cleanGenericBranchName(shipment.branchLookup?.rawName || shipment.branchName || '')
  };
  const postalCode = lookup.postalCode || shipment.destination?.split('/').pop();
  const branches = await fetchAndreaniBranchesByLookup({ ...lookup, postalCode });
  if (!branches.length) return '';

  const [best] = branches
    .map((branch) => ({ branch, score: branchScore(branch, lookup) }))
    .sort((a, b) => b.score - a.score);

  if (!best || best.score < 20) return '';
  return branchOfficialName(best.branch);
}

async function resolveAndreaniBranches(shipments) {
  return Promise.all(shipments.map(async (shipment) => {
    if (shipment.deliveryType !== 'sucursal') return shipment;
    const branchName = await resolveAndreaniBranchName(shipment);
    const finalBranchName = branchName || cleanGenericBranchName(shipment.branchName) || '';
    return {
      ...shipment,
      branchName: finalBranchName,
      observations: finalBranchName
        ? shipment.observations
        : [shipment.observations, 'Completar/revisar: sucursal Andreani'].filter(Boolean).join(' - ')
    };
  }));
}


function stripAccents(str) {
  return String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}

function parseLocationStrings(sharedStringsXml) {
  const results = [];
  const regex = /<x:t[^>]*>([^<]+\/[^<]+\/[^<]+)<\/x:t>/g;
  let m;
  while ((m = regex.exec(sharedStringsXml)) !== null) {
    const s = m[1].trim();
    if (s.split('/').length === 3) results.push(s);
  }
  return results;
}

function findAndreaniDestination(locationStrings, province, postalCode, locality = '', fallbackDestination = '') {
  const fallbackParts = String(fallbackDestination || '').split('/').map(part => part.trim());
  const cp = String(postalCode || fallbackParts[2] || '').replace(/\D/g, '');
  const prov = stripAccents(province || fallbackParts[0] || '');
  const loc = stripAccents(locality || fallbackParts[1] || '');
  if (!cp && !prov && !loc) return '';

  // Filtrar por código postal exacto
  const byCP = cp
    ? locationStrings.filter(s => String(s.split('/').pop() || '').replace(/\D/g, '') === cp)
    : [];

  if (!byCP.length) {
    // Sin match por CP: retornar vacío para que Andreani lo complete
    return '';
  }

  if (byCP.length === 1) return byCP[0];

  // Filtrar por provincia
  const byProv = byCP.filter(s => stripAccents(s.split('/')[0]) === prov);
  if (byProv.length === 1) return byProv[0];

  // Filtrar por localidad si Tiendanube la entrega
  const base = byProv.length ? byProv : byCP;
  const byLocality = loc
    ? base.filter(s => stripAccents(s.split('/')[1]).includes(loc) || loc.includes(stripAccents(s.split('/')[1])))
    : [];
  if (byLocality.length === 1) return byLocality[0];

  // Preferir localidad cuyo nombre coincide con la provincia (capital)
  const capital = (byLocality.length ? byLocality : base).find(s => {
    const parts = s.split('/');
    return stripAccents(parts[1]) === prov || stripAccents(parts[1]) === stripAccents(parts[0]);
  });
  if (capital) return capital;

  // Devolver el primero de los filtrados por provincia (o por CP si no hay prov)
  return (byLocality.length ? byLocality : base)[0];
}

async function buildAndreaniWorkbook(shipments) {
  const templatePath = path.join(__dirname, 'templates', 'andreani', 'EnvioMasivoExcelPaquetes.xlsx');
  const template = await fs.readFile(templatePath);
  const zip = await JSZip.loadAsync(template);

  // Cargar lista de destinos válidos del template (sharedStrings.xml)
  const ssFile = zip.file('xl/sharedStrings.xml');
  const locationStrings = ssFile
    ? parseLocationStrings(await ssFile.async('string'))
    : [];

  // Resolver sucursales Andreani via API (para pedidos a sucursal sin nombre)
  const resolved = await resolveAndreaniBranches(shipments);
  const domicilio = resolved.filter(s => s.deliveryType !== 'sucursal');
  const sucursal  = resolved.filter(s => s.deliveryType === 'sucursal');
  const packageWeightGrams = 1000;

  // ── Hoja 1: A domicilio (19 columnas A-S) ──────────────────────────────────
  if (domicilio.length > 0) {
    const sheet1 = zip.file('xl/worksheets/sheet1.xml');
    if (!sheet1) throw new Error('No se encontro la hoja A domicilio en la plantilla Andreani.');
    const rows = domicilio.map((s, index) => rowXml(index + 3, [
      '',                               // A: Paquete Guardado (vacío)
      packageWeightGrams,               // B: Peso (grs)
      30,                               // C: Alto (cm)
      20,                               // D: Ancho (cm)
      5,                                // E: Profundidad (cm)
      Number(s.declaredValue || 0),     // F: Valor declarado
      s.internalOrderNumber || '',      // G: Número interno
      s.firstName || '',                // H: Nombre
      s.lastName || '',                 // I: Apellido
      s.dni || '',                      // J: DNI
      s.email || '',                    // K: Email
      s.phoneArea || '',                // L: Código celular
      s.phoneNumber || '',              // M: Número celular
      s.street || '',                   // N: Calle
      s.streetNumber || '',             // O: Número
      s.floor || '',                    // P: Piso
      s.apartment || '',                // Q: Departamento
      findAndreaniDestination(locationStrings, s.province, s.postalCode, s.locality, s.destination), // R: Destino (lookup)
      s.observations || ''              // S: Observaciones
    ])).join('');
    let xml1 = await sheet1.async('string');
    const lastRow1 = Math.max(2, domicilio.length + 2);
    xml1 = xml1.replace(/<x:dimension ref="[^"]+" \/>/, `<x:dimension ref="A1:S${lastRow1}" />`);
    xml1 = xml1.replace('</x:sheetData>', `${rows}</x:sheetData>`);
    zip.file('xl/worksheets/sheet1.xml', xml1);
  }

  // ── Hoja 2: A sucursal (14 columnas A-N) ───────────────────────────────────
  if (sucursal.length > 0) {
    const sheet2 = zip.file('xl/worksheets/sheet2.xml');
    if (!sheet2) throw new Error('No se encontro la hoja A sucursal en la plantilla Andreani.');
    const rows = sucursal.map((s, index) => rowXml(index + 3, [
      '',                               // A: Paquete Guardado (vacío)
      packageWeightGrams,               // B: Peso (grs)
      30,                               // C: Alto (cm)
      20,                               // D: Ancho (cm)
      5,                                // E: Profundidad (cm)
      Number(s.declaredValue || 0),     // F: Valor declarado
      s.internalOrderNumber || '',      // G: Número interno
      s.firstName || '',                // H: Nombre
      s.lastName || '',                 // I: Apellido
      s.dni || '',                      // J: DNI
      s.email || '',                    // K: Email
      s.phoneArea || '',                // L: Código celular
      s.phoneNumber || '',              // M: Número celular
      s.branchName || ''               // N: Sucursal
    ])).join('');
    let xml2 = await sheet2.async('string');
    const lastRow2 = Math.max(2, sucursal.length + 2);
    xml2 = xml2.replace(/<x:dimension ref="[^"]+" \/>/, `<x:dimension ref="A1:N${lastRow2}" />`);
    xml2 = xml2.replace('</x:sheetData>', `${rows}</x:sheetData>`);
    zip.file('xl/worksheets/sheet2.xml', xml2);
  }

  return zip.generateAsync({ type: 'nodebuffer' });
}

// ── OAuth paso 1: redirigir al usuario a la pantalla de autorización ──────────
app.get('/auth/tiendanube', (req, res) => {
  const { TIENDANUBE_CLIENT_ID, TIENDANUBE_REDIRECT_URI } = process.env;

  if (!TIENDANUBE_CLIENT_ID) {
    return res.status(503).send(
      'Falta TIENDANUBE_CLIENT_ID en .env. ' +
      'Copiá .env.example como .env y completá las variables.'
    );
  }

  const authUrl =
    `https://www.tiendanube.com/apps/${encodeURIComponent(TIENDANUBE_CLIENT_ID)}/authorize` +
    `?redirect_uri=${encodeURIComponent(TIENDANUBE_REDIRECT_URI || '')}`;

  res.redirect(authUrl);
});

// ── OAuth paso 2: Tiendanube redirige acá con un "code" ──────────────────────
app.get('/auth/tiendanube/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: 'Falta el parámetro "code" en la URL.' });
  }

  try {
    const tokenData = await tn.exchangeCode(String(code));
    // En producción guardarías el token en una base de datos o en variables de entorno.
    // Por ahora lo devolvemos en pantalla para que el usuario lo copie al .env.
    res.json({
      success : true,
      message : [
        'Token obtenido correctamente.',
        'Copiá los valores de abajo en tu archivo .env:',
        `  TIENDANUBE_ACCESS_TOKEN=${tokenData.access_token}`,
        `  TIENDANUBE_STORE_ID=${tokenData.user_id}`
      ].join('\n'),
      access_token: tokenData.access_token,
      store_id    : tokenData.user_id
    });
  } catch (err) {
    console.error('[OAuth callback]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Pedidos de Tiendanube normalizados ────────────────────────────────────────
// El frontend manda las cuentas activas como query params para que el backend
// aplique las mismas reglas de asignación que usa la app.
app.get('/api/tiendanube/orders', async (req, res) => {
  const accountSettings = {
    mercadoPago: req.query.mercadoPagoAccount || 'FB',
    transfer   : req.query.transferAccount    || 'EG'
  };

  try {
    const orders = await tn.fetchAndNormalizeOrders(accountSettings);
    res.json({ success: true, orders });
  } catch (err) {
    console.error('[/api/tiendanube/orders]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/tiendanube/orders/by-number/:number', async (req, res) => {
  const accountSettings = {
    mercadoPago: req.query.mercadoPagoAccount || 'FB',
    transfer   : req.query.transferAccount    || 'EG'
  };

  try {
    const order = await tn.fetchAndNormalizeOrderByNumber(req.params.number, accountSettings);
    if (!order) {
      return res.status(404).json({ success: false, error: 'No encontre ese TN en Tienda Nube.' });
    }
    res.json({ success: true, order });
  } catch (err) {
    console.error('[/api/tiendanube/orders/by-number]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/tiendanube/orders/:id/fulfill', async (req, res) => {
  const { trackingNumber, trackingUrl, notifyCustomer } = req.body || {};
  try {
    const result = await tn.fulfillOrder(req.params.id, {
      trackingNumber,
      trackingUrl,
      notifyCustomer: notifyCustomer !== false
    });
    res.json({ success: true, result });
  } catch (err) {
    console.error('[/api/tiendanube/orders/:id/fulfill]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/tiendanube/orders/:id/owner-note', async (req, res) => {
  const note = String(req.body?.note || '').trim() || 'Cargado';
  try {
    const result = await tn.updateOrderOwnerNote(req.params.id, note);
    res.json({ success: true, result });
  } catch (err) {
    console.error('[/api/tiendanube/orders/:id/owner-note]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/stock/items', async (req, res) => {
  try {
    if (supabaseEnabled()) {
      const direct = await listStockItemsDirect(req.query);
      return res.json(direct);
    }
    const params = new URLSearchParams(req.query);
    if (!params.has('solo_con_stock')) params.set('solo_con_stock', 'true');
    const url = `${STOCK_LIST_URL}?${params.toString()}`;
    const result = await callStockFunction(url);
    if (isStockFunctionMissing(result)) {
      const direct = await listStockItemsDirect(req.query);
      return res.json(direct);
    }
    res.status(result.status).json(result.data);
  } catch (err) {
    console.error('[/api/stock/items]', err.message);
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

app.post('/api/stock/decrement', async (req, res) => {
  const { orderId, items } = req.body || {};
  if (!orderId || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ success: false, error: 'Faltan orderId o items para descontar stock.' });
  }

  try {
    if (supabaseEnabled()) {
      const direct = await decrementStockDirect(orderId, items);
      return res.status(direct.status).json(direct.data);
    }
    const result = await callStockFunction(STOCK_DECREMENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, items })
    });
    if (isStockFunctionMissing(result)) {
      const direct = await decrementStockDirect(orderId, items);
      return res.status(direct.status).json(direct.data);
    }
    res.status(result.status).json(result.data);
  } catch (err) {
    console.error('[/api/stock/decrement]', err.message);
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.post('/api/stock/restore', async (req, res) => {
  const { orderId, items } = req.body || {};
  if (!orderId || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ success: false, error: 'Faltan orderId o items para devolver stock.' });
  }
  if (!STOCK_RESTORE_URL) {
    return res.status(503).json({
      success: false,
      error: 'Falta configurar STOCK_RESTORE_URL para devolver stock automaticamente.'
    });
  }

  try {
    const result = await callStockFunction(STOCK_RESTORE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, items })
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    console.error('[/api/stock/restore]', err.message);
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

async function forwardStampTransition({ pedidoId, evento, usuario, items }) {
  const response = await fetch(`${STAMPS_API_URL}/pedidos/${encodeURIComponent(String(pedidoId))}/transicion`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Stamps-Api-Secret': STAMPS_API_SECRET
    },
    body: JSON.stringify({
      evento,
      usuario: String(usuario || '').trim() || 'sistema',
      items: items.map((item) => ({
        sku: String(item.sku || '').trim(),
        cantidad: Number(item.cantidad || item.quantity || 1),
        itemRef: String(item.itemRef || '').trim(),
        talle: String(item.talle || item.size || '').trim(),
        nombre: String(item.nombre || item.name || '').trim()
      }))
    }),
    signal: AbortSignal.timeout(120000)
  });
  const data = await response.json().catch(async () => ({ raw: await response.text().catch(() => '') }));
  if (!response.ok) {
    const detail = data?.error || data?.message || data?.mensaje || data?.raw || `HTTP ${response.status}`;
    const err = new Error(String(detail).slice(0, 500));
    err.statusCode = response.status;
    err.data = data;
    throw err;
  }
  return { status: response.status, data };
}

app.post('/api/stamps/transition', async (req, res) => {
  const { pedidoId, evento, usuario, items } = req.body || {};
  const waitForResult = req.body?.wait === true;
  if (!pedidoId || !evento || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ success: false, error: 'Faltan pedidoId, evento o items para sincronizar estampas.' });
  }
  if (!STAMPS_API_SECRET) {
    return res.status(503).json({
      success: false,
      error: 'Falta configurar STAMPS_API_SECRET para conectar con Stock Estampas.'
    });
  }

  try {
    const payload = { pedidoId, evento, usuario, items };
    if (!waitForResult) {
      forwardStampTransition(payload)
        .then((result) => {
          console.info('[/api/stamps/transition queued ok]', JSON.stringify({ pedidoId, evento, status: result.status }));
        })
        .catch((err) => {
          console.error('[/api/stamps/transition queued error]', JSON.stringify({
            pedidoId,
            evento,
            status: err.statusCode || null,
            error: err.message
          }));
        });
      return res.status(202).json({ success: true, queued: true, message: 'Sincronizacion de estampas solicitada.' });
    }

    const result = await forwardStampTransition(payload);
    res.status(result.status).json({ success: true, data: result.data });
  } catch (err) {
    console.error('[/api/stamps/transition]', err.message);
    res.status(err.name === 'TimeoutError' ? 504 : (err.statusCode || 500)).json({ success: false, error: err.message, data: err.data });
  }
});

async function sendWhatsappTemplateViaMeta(input = {}) {
  if (!whatsappApiEnabled()) {
    const error = new Error('Falta configurar WhatsApp Cloud API.');
    error.statusCode = 503;
    throw error;
  }

  const payload = buildWhatsappTemplatePayload(input);
  if (!payload.to) {
    const error = new Error('Falta WhatsApp del cliente.');
    error.statusCode = 400;
    throw error;
  }

  const response = await fetch(`https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${encodeURIComponent(WHATSAPP_PHONE_NUMBER_ID)}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const metaError = data?.error || {};
    const detailParts = [
      metaError.error_user_msg,
      metaError.message,
      metaError.code ? `codigo ${metaError.code}` : '',
      metaError.error_subcode ? `subcodigo ${metaError.error_subcode}` : ''
    ].filter(Boolean);
    const detail = detailParts.join(' - ') || data?.message || `Meta respondio HTTP ${response.status}`;
    const error = new Error(detail);
    error.statusCode = response.status;
    error.meta = data;
    throw error;
  }

  return { engine: 'meta', result: data };
}

function whatsappEngineForRequest(input = {}) {
  assertKommoTestRequestAllowed(input, {
    testEnabled: KOMMO_TEST_ENABLED,
    testPhoneAllowlist: KOMMO_TEST_PHONE_ALLOWLIST
  });
  return chooseWhatsappEngine(input, {
    defaultEngine: WHATSAPP_SEND_ENGINE,
    testEnabled: KOMMO_TEST_ENABLED,
    testPhoneAllowlist: KOMMO_TEST_PHONE_ALLOWLIST
  });
}

function canFallbackKommoToMeta(input = {}, error) {
  if (!isKommoCompatibleMessageType(input.type)) return false;
  const message = sanitizedKommoError(error).toLowerCase();
  return message.includes('no se encontro un contacto') ||
    message.includes('no tiene una conversacion') ||
    message.includes('no encontre la conversacion') ||
    message.includes('la conversacion no esta vinculada') ||
    message.includes('channel must be linked') ||
    message.includes('setup channel first') ||
    message.includes('ningun lead asociado');
}

app.post('/api/whatsapp/send-template', async (req, res) => {
  const input = req.body || {};
  let engine = 'meta';
  try {
    engine = whatsappEngineForRequest(input);
    if (engine === 'kommo') {
      const result = await kommoWhatsappService.sendWhatsappTemplate(input);
      if (result.diagnostics) {
        console.info('[/api/whatsapp/send-template diagnostics]', JSON.stringify(result.diagnostics));
      }
      const payload = {
        success: true,
        engine: 'kommo',
        message: result.message || 'Lanzamiento solicitado a Kommo',
        result,
        diagnostics: {
          contactId: result.contactId || result.kommoDebug?.contactId || null,
          selectedLeadId: result.leadId || result.kommoDebug?.selectedLeadId || null,
          botId: result.botId || result.kommoDebug?.botId || null,
          launchEntityId: result.kommoDebug?.launchEntityId || result.diagnostics?.entity_id_used_for_bot || null,
          fieldsVerified: result.fieldsVerified === true || Boolean(result.kommoDebug?.verifiedTn || result.kommoDebug?.verifiedName),
          verifiedTn: result.kommoDebug?.verifiedTn || null,
          verifiedName: result.kommoDebug?.verifiedName || null
        }
      };
      if (shouldExposeKommoTestDebug(input, engine, {
        testEnabled: KOMMO_TEST_ENABLED,
        testPhoneAllowlist: KOMMO_TEST_PHONE_ALLOWLIST
      })) {
        payload.debug = safeKommoFrontendDebug(result.kommoDebug || result.diagnostics || {});
      }
      return res.json(payload);
    }

    const result = await sendWhatsappTemplateViaMeta(input);
    res.json({ success: true, result: result.result, engine: result.engine });
  } catch (err) {
    if (engine === 'kommo' && !err.disableMetaFallback && canFallbackKommoToMeta(input, err)) {
      try {
        const fallback = await sendWhatsappTemplateViaMeta(input);
        return res.json({
          success: true,
          engine: 'meta_fallback',
          message: 'WhatsApp enviado por Meta. Kommo no tenia una conversacion vinculada para ese numero.',
          kommoError: sanitizedKommoError(err),
          result: fallback.result
        });
      } catch (fallbackError) {
        const detail = `Kommo no pudo usar ese contacto y Meta tampoco pudo enviar: ${sanitizedKommoError(fallbackError)}`;
        console.error('[/api/whatsapp/send-template fallback]', detail);
        return res.status(fallbackError.statusCode || 500).json({
          success: false,
          error: detail
        });
      }
    }

    const safeMessage = engine === 'kommo'
      ? `No se pudo enviar el mensaje mediante Kommo. No se envio ningun WhatsApp. ${sanitizedKommoError(err)}`
      : sanitizedKommoError(err);
    console.error('[/api/whatsapp/send-template]', safeMessage);
    if (err.kommoDiagnostics) {
      console.info('[/api/whatsapp/send-template diagnostics]', JSON.stringify(err.kommoDiagnostics));
    }
    const payload = buildWhatsappTemplateErrorPayload({
      err,
      input,
      engine,
      testEnabled: KOMMO_TEST_ENABLED,
      testPhoneAllowlist: KOMMO_TEST_PHONE_ALLOWLIST,
      sanitizedMessage: safeMessage
    });
    res.status(err.statusCode || 500).json(payload);
  }
});

app.get('/api/app-state', async (_req, res) => {
  if (!supabaseEnabled()) return res.json({ enabled: false, state: null });

  try {
    const query = `${SUPABASE_STATE_TABLE}?id=eq.${encodeURIComponent(APP_STATE_ID)}&select=state,updated_at`;
    const result = await callSupabase(query, { method: 'GET' });
    if (!result.ok) return res.status(result.status).json({ enabled: true, error: result.data });
    const row = Array.isArray(result.data) ? result.data[0] : null;
    const correction = ensureHistoricManualCorrections(row?.state || {});
    let updatedAt = row?.updated_at || null;
    if (correction.changed) {
      const persisted = await persistAppState(correction.state);
      if (persisted.result.ok) updatedAt = persisted.updatedAt;
    }
    res.json({
      enabled: true,
      state: correction.state || null,
      updatedAt
    });
  } catch (err) {
    console.error('[/api/app-state GET]', err.message);
    res.status(err.statusCode || 500).json({ enabled: true, error: err.message });
  }
});

app.get('/api/app-state/meta', async (_req, res) => {
  if (!supabaseEnabled()) return res.json({ enabled: false, updatedAt: null, savedAt: null });

  try {
    const query = `${SUPABASE_STATE_TABLE}?id=eq.${encodeURIComponent(APP_STATE_ID)}&select=state->>savedAt,updated_at`;
    const result = await callSupabase(query, { method: 'GET' });
    if (!result.ok) return res.status(result.status).json({ enabled: true, error: result.data });
    const row = Array.isArray(result.data) ? result.data[0] : null;
    res.json({
      enabled: true,
      savedAt: row?.savedAt || null,
      updatedAt: row?.updated_at || null
    });
  } catch (err) {
    console.error('[/api/app-state/meta GET]', err.message);
    res.status(err.statusCode || 500).json({ enabled: true, error: err.message });
  }
});

app.post('/api/app-state', async (req, res) => {
  if (!supabaseEnabled()) return res.json({ enabled: false, saved: false });

  const state = req.body?.state;
  const replace = Boolean(req.body?.replace);
  if (!state || typeof state !== 'object') {
    return res.status(400).json({ enabled: true, saved: false, error: 'Falta state.' });
  }

  try {
    let stateToSave = state;
    if (!replace) {
      const query = `${SUPABASE_STATE_TABLE}?id=eq.${encodeURIComponent(APP_STATE_ID)}&select=state`;
      const current = await callSupabase(query, { method: 'GET' });
      if (!current.ok) return res.status(current.status).json({ enabled: true, saved: false, error: current.data });
      const row = Array.isArray(current.data) ? current.data[0] : null;
      stateToSave = mergeAppState(state, row?.state || {});
    } else {
      stateToSave = ensureHistoricManualCorrections({ ...state, savedAt: new Date().toISOString() }).state;
    }

    try {
      stateToSave = await mediaOffloader.offloadInlineImages(stateToSave);
    } catch (err) {
      console.error('[media] fallo el paso de subir fotos, se guarda tal cual estaba:', err.message);
    }

    const updatedAt = new Date().toISOString();
    const result = await callSupabase(`${SUPABASE_STATE_TABLE}?on_conflict=id`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        id: APP_STATE_ID,
        state: stateToSave,
        updated_at: updatedAt
      })
    });
    if (!result.ok) return res.status(result.status).json({ enabled: true, saved: false, error: result.data });
    res.json({ enabled: true, saved: true, savedAt: stateToSave.savedAt || updatedAt, updatedAt });
  } catch (err) {
    console.error('[/api/app-state POST]', err.message);
    res.status(err.statusCode || 500).json({ enabled: true, saved: false, error: err.message });
  }
});

app.post('/api/app-state/sku-prices', async (req, res) => {
  if (!supabaseEnabled()) return res.status(503).json({ enabled: false, saved: false });

  const incomingPrices = req.body?.skuPrices;
  if (!incomingPrices || typeof incomingPrices !== 'object' || Array.isArray(incomingPrices)) {
    return res.status(400).json({ enabled: true, saved: false, error: 'Faltan skuPrices.' });
  }

  try {
    const query = `${SUPABASE_STATE_TABLE}?id=eq.${encodeURIComponent(APP_STATE_ID)}&select=state`;
    const current = await callSupabase(query, { method: 'GET' });
    if (!current.ok) return res.status(current.status).json({ enabled: true, saved: false, error: current.data });
    const row = Array.isArray(current.data) ? current.data[0] : null;
    const state = row?.state && typeof row.state === 'object' ? row.state : {};
    const nextState = {
      orders: Array.isArray(state.orders) ? state.orders : [],
      exchanges: Array.isArray(state.exchanges) ? state.exchanges : [],
      backupRows: Array.isArray(state.backupRows) ? state.backupRows : [],
      stockLogRows: Array.isArray(state.stockLogRows) ? state.stockLogRows : [],
      printedGarments: Array.isArray(state.printedGarments) ? state.printedGarments : [],
      deletedPrintedGarmentIds: Array.isArray(state.deletedPrintedGarmentIds) ? state.deletedPrintedGarmentIds : [],
      skuPrices: { ...(state.skuPrices || {}), ...incomingPrices },
      internalSequence: Number(state.internalSequence || 5999),
      accountSettings: state.accountSettings || { mercadoPago: 'FB', transfer: 'EG' },
      dismissedStoreOrders: Array.isArray(state.dismissedStoreOrders) ? state.dismissedStoreOrders : [],
      dismissedOrderIds: Array.isArray(state.dismissedOrderIds) ? state.dismissedOrderIds : [],
      savedAt: new Date().toISOString()
    };

    const result = await callSupabase(`${SUPABASE_STATE_TABLE}?on_conflict=id`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        id: APP_STATE_ID,
        state: nextState,
        updated_at: new Date().toISOString()
      })
    });
    if (!result.ok) return res.status(result.status).json({ enabled: true, saved: false, error: result.data });
    res.json({ enabled: true, saved: true, count: Object.keys(incomingPrices).length });
  } catch (err) {
    console.error('[/api/app-state/sku-prices POST]', err.message);
    res.status(err.statusCode || 500).json({ enabled: true, saved: false, error: err.message });
  }
});

app.post('/api/sharepoint/backup-history', async (_req, res) => {
  try {
    const result = await updateSharePointBackupHistory();
    res.json({
      success: true,
      rows: result.rows,
      filename: result.filename,
      webUrl: result.item?.webUrl || '',
      fullBackupFilename: result.fullBackupFilename,
      fullBackupWebUrl: result.fullBackupItem?.webUrl || ''
    });
  } catch (err) {
    console.error('[/api/sharepoint/backup-history]', err.message);
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

app.post('/api/sharepoint/backup-contable', async (_req, res) => {
  try {
    const result = await updateSharePointContableBackup();
    res.json({
      success: true,
      rows: result.rows,
      transfers: result.transfers,
      filename: result.filename,
      webUrl: result.item?.webUrl || '',
      fullBackupFilename: result.fullBackupFilename,
      fullBackupWebUrl: result.fullBackupItem?.webUrl || ''
    });
  } catch (err) {
    console.error('[/api/sharepoint/backup-contable]', err.message);
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

app.post('/api/andreani/labels', async (req, res) => {
  const shipments = Array.isArray(req.body?.shipments) ? req.body.shipments : [];
  if (!shipments.length) {
    return res.status(400).json({ success: false, error: 'No hay envios Andreani para exportar.' });
  }

  try {
    const workbook = await buildAndreaniWorkbook(shipments);
    const filename = `andreani-rotulos-${argentinaDateString()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(workbook);
  } catch (err) {
    console.error('[/api/andreani/labels]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/flux/shipments', async (req, res) => {
  const shipments = Array.isArray(req.body?.shipments) ? req.body.shipments : [];
  if (!shipments.length) {
    return res.status(400).json({ success: false, error: 'No hay envios Flux para enviar.' });
  }

  const payload = shipments.map(({ localOrderId, ...shipment }) => shipment);
  try {
    const result = fluxExternalEnabled()
      ? await insertFluxExternalShipments(payload)
      : await callFluxApi('insert', payload);
    const data = result.data || {};
    const failed = Array.isArray(data)
      ? data.some((item) => item && (item.estado === false || item.success === false))
      : data.estado === false || data.success === false;
    const errorMessage = failed
      ? (Array.isArray(data) ? data : [data])
        .map((item) => {
          const status = item?.httpStatus ? `HTTP ${item.httpStatus}` : '';
          const message = fluxErrorText(item);
          const raw = item?.rawText && item.rawText !== message ? `Respuesta cruda: ${item.rawText}` : '';
          return [status, message, raw].filter(Boolean).join(' - ');
        })
        .filter(Boolean)
        .join(' | ')
      : '';
    res.status(failed ? 422 : result.status).json({
      success: !failed && result.ok,
      error: errorMessage || undefined,
      endpoint: fluxExternalEnabled() ? `${FLUX_EXTERNAL_API_URL}/insertar-envio` : FLUX_API_URL,
      results: Array.isArray(data) ? data : [data],
      raw: data
    });
  } catch (err) {
    console.error('[/api/flux/shipments]', err.message);
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

app.post('/api/flux/status', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((id) => String(id || '').trim()).filter(Boolean) : [];
  if (!ids.length) {
    return res.status(400).json({ success: false, error: 'No hay envios Flux para consultar.' });
  }

  try {
    if (!fluxExternalEnabled()) {
      const error = new Error(`Falta configurar Flux API nueva en Render: ${fluxExternalMissingConfig()}.`);
      error.statusCode = 503;
      throw error;
    }

    const results = [];
    for (const idEnvio of ids) {
      results.push(await getFluxExternalStatus(idEnvio));
    }
    res.json({ success: true, results });
  } catch (err) {
    console.error('[/api/flux/status]', err.message);
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

function buenosAiresDateHour() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false
  }).formatToParts(new Date()).reduce((map, part) => {
    map[part.type] = part.value;
    return map;
  }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour || 0)
  };
}

async function runSharePointAutoBackupIfDue() {
  if (!SHAREPOINT_AUTO_BACKUP && !SHAREPOINT_CONTABLE_AUTO_BACKUP) return;
  const { date, hour } = buenosAiresDateHour();
  if (hour < 23) return;

  if (SHAREPOINT_AUTO_BACKUP && lastSharePointAutoBackupDate !== date) {
    try {
      const result = await updateSharePointBackupHistory();
      lastSharePointAutoBackupDate = date;
      console.log(`[sharepoint] Historico actualizado: ${result.filename} (${result.rows} filas) + ${result.fullBackupFilename}`);
    } catch (err) {
      console.error('[sharepoint] No se pudo actualizar el historico diario:', err.message);
    }
  }

  if (SHAREPOINT_CONTABLE_AUTO_BACKUP && SHAREPOINT_CONTABLE_BACKUP_PATH && lastSharePointContableAutoBackupDate !== date) {
    try {
      const result = await updateSharePointContableBackup();
      lastSharePointContableAutoBackupDate = date;
      console.log(`[sharepoint] Contable actualizado: ${result.filename} (${result.rows} transacciones, ${result.transfers} transferencias) + ${result.fullBackupFilename}`);
    } catch (err) {
      console.error('[sharepoint] No se pudo actualizar el backup contable diario:', err.message);
    }
  }
}

async function applyStartupHistoricCorrections() {
  if (!supabaseEnabled()) return;
  try {
    const stored = await getStoredAppState();
    const correction = ensureHistoricManualCorrections(stored.state || {});
    if (!correction.changed) return;
    const persisted = await persistAppState(correction.state);
    if (persisted.result.ok) {
      console.log('[state] Correcciones historicas aplicadas');
    } else {
      console.error('[state] No se pudo aplicar correccion historica:', JSON.stringify(persisted.result.data));
    }
  } catch (err) {
    console.error('[state] No se pudo revisar correcciones historicas:', err.message);
  }
}

if (SHAREPOINT_AUTO_BACKUP) {
  setInterval(runSharePointAutoBackupIfDue, 60 * 60 * 1000);
  setTimeout(runSharePointAutoBackupIfDue, 30 * 1000);
}

// Montado bajo /ventas (require.main !== module): no corre listen() propio ni
// las correcciones historicas de arranque, para no tocar Supabase hasta que
// esta app este realmente activada con sus credenciales propias.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✓  Servidor corriendo en http://localhost:${PORT}`);
    console.log(`   Tiendanube Client ID  : ${process.env.TIENDANUBE_CLIENT_ID  || '(no configurado)'}`);
    console.log(`   Tiendanube Store ID   : ${process.env.TIENDANUBE_STORE_ID   || '(no configurado)'}`);
    console.log(`   Tiendanube Token      : ${process.env.TIENDANUBE_ACCESS_TOKEN ? '***' : '(no configurado)'}`);
    setTimeout(applyStartupHistoricCorrections, 2000);
  });
}

module.exports = app;
