'use strict';
// Sincronizador Stock <-> Tiendanube. Tramo 1: reporte de SOLO LECTURA.
// Compara el stock de la app de Stock (tabla prendas) contra el stock de
// las variantes visibles de Tiendanube y propone cambios, sin aplicar nada.
//
// Mismo patron que las otras sub-apps: exporta el express.app y solo abre
// puerto si corre standalone. Usa la contrasena de Ventas
// (VENTAS_APP_PASSWORD) y las credenciales que Ventas ya carga en este
// proceso, asi que no necesita variables de entorno nuevas.

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { reconcile } = require('./lib/reconcile');
const { configStatus, loadAll, loadIgnored, addIgnored, removeIgnored } = require('./lib/sources');

const app = express();
const PORT = process.env.PORT || 3100;
const COOKIE = 'sincronizador_session';

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

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
  return crypto.createHmac('sha256', secret).update(`sincronizador:${process.env.VENTAS_APP_PASSWORD || ''}`).digest('hex');
}

function isAuthenticated(req) {
  if (!process.env.VENTAS_APP_PASSWORD) return true;
  return parseCookies(req.headers.cookie || '')[COOKIE] === sessionSignature();
}

function loginPage(error = '') {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sincronizador</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:linear-gradient(135deg,#f9fafb 0%,#ede8fa 100%);display:grid;place-items:center;min-height:100vh;margin:0;color:#111827}
form{background:#fff;padding:28px;border-radius:10px;border:1px solid rgba(108,63,197,.14);box-shadow:0 18px 50px rgba(17,24,39,.16);display:grid;gap:12px;width:min(340px,90vw)}
.eyebrow{color:#6c3fc5;font-size:.82rem;font-weight:600;margin:0}strong{font-size:1.2rem}span{color:#6b7280;font-size:.88rem}
input,button{font:inherit;padding:10px 12px;border-radius:8px;border:1px solid #d1d5db}button{background:#6c3fc5;color:#fff;border:0;cursor:pointer;font-weight:600}button:hover{background:#5330a0}
.error{color:#dc2626;margin:0}</style></head>
<body><form method="post" action="login"><p class="eyebrow">Stock ↔ Tiendanube</p><strong>Sincronizador</strong>
<span>Entrá con la misma contraseña que Ventas.</span>
${error ? `<p class="error">${error}</p>` : ''}
<input type="password" name="password" placeholder="Contraseña" autofocus>
<button type="submit">Entrar</button></form></body></html>`;
}

app.get('/login', (req, res) => {
  if (isAuthenticated(req)) return res.redirect(`${req.baseUrl || ''}/`);
  res.send(loginPage());
});

app.post('/login', (req, res) => {
  if (!process.env.VENTAS_APP_PASSWORD) return res.redirect(`${req.baseUrl || ''}/`);
  if (String(req.body.password || '') !== process.env.VENTAS_APP_PASSWORD) {
    return res.status(401).send(loginPage('Contraseña incorrecta.'));
  }
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `${COOKIE}=${sessionSignature()}; HttpOnly; SameSite=Lax; Path=${req.baseUrl || '/'}; Max-Age=2592000${secure ? '; Secure' : ''}`);
  res.redirect(`${req.baseUrl || ''}/`);
});

app.use((req, res, next) => {
  if (isAuthenticated(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ success: false, error: 'No autenticado.' });
  return res.redirect(`${req.baseUrl || ''}/login`);
});

app.use('/api', (_req, res, next) => {
  const config = configStatus();
  if (!config.ok) {
    return res.status(503).json({ success: false, error: `Faltan variables de entorno: ${config.missing.join(', ')}` });
  }
  next();
});

app.get('/api/reporte', async (_req, res) => {
  try {
    const startedAt = Date.now();
    const data = await loadAll();
    const result = reconcile(data);
    res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      sources: {
        prendas: data.prendas.length,
        productosTiendanube: data.tnProducts,
        variantesTiendanube: data.tnVariants.length,
        pedidosVentas: data.ventasOrders.length,
        pedidosTiendanubeAbiertos: data.tnOpenOrders.length,
        guardadoPorFila: data.rowStorage
      },
      ignored: data.ignored,
      ...result
    });
  } catch (err) {
    console.error('[sincronizador /api/reporte]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// Eliminar un producto del reporte: no toca Tiendanube ni Stock, solo lo
// anota para que las proximas corridas no lo revisen.
app.get('/api/ignorados', async (_req, res) => {
  try {
    res.json({ success: true, ignored: await loadIgnored() });
  } catch (err) {
    console.error('[sincronizador GET /api/ignorados]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

app.post('/api/ignorados', async (req, res) => {
  const { productId, productName, sku } = req.body || {};
  if (!/^\d+$/.test(String(productId || ''))) {
    return res.status(400).json({ success: false, error: 'Falta el producto de Tiendanube.' });
  }
  try {
    await addIgnored({ productId, productName, sku });
    res.json({ success: true });
  } catch (err) {
    console.error('[sincronizador POST /api/ignorados]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

app.delete('/api/ignorados/:productId', async (req, res) => {
  if (!/^\d+$/.test(req.params.productId)) {
    return res.status(400).json({ success: false, error: 'Producto invalido.' });
  }
  try {
    await removeIgnored(req.params.productId);
    res.json({ success: true });
  } catch (err) {
    console.error('[sincronizador DELETE /api/ignorados]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
  app.listen(PORT, () => console.log(`Sincronizador escuchando en http://localhost:${PORT}`));
}

module.exports = app;
