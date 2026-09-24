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
const { configStatus, loadAll } = require('./lib/sources');

const app = express();
const PORT = process.env.PORT || 3100;
const COOKIE = 'sincronizador_session';

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
<style>body{font-family:system-ui,sans-serif;background:#f4f4f5;display:grid;place-items:center;min-height:100vh;margin:0}
form{background:#fff;padding:28px;border-radius:12px;box-shadow:0 2px 12px #0001;display:grid;gap:12px;width:min(320px,90vw)}
input,button{font:inherit;padding:10px;border-radius:8px;border:1px solid #ccc}button{background:#111;color:#fff;border:0;cursor:pointer}
.error{color:#b91c1c;margin:0}</style></head>
<body><form method="post" action="login"><strong>Sincronizador de stock</strong>
<span>Misma contraseña que Ventas.</span>
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

app.get('/api/reporte', async (_req, res) => {
  const config = configStatus();
  if (!config.ok) {
    return res.status(503).json({ success: false, error: `Faltan variables de entorno: ${config.missing.join(', ')}` });
  }
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
      ...result
    });
  } catch (err) {
    console.error('[sincronizador /api/reporte]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
  app.listen(PORT, () => console.log(`Sincronizador escuchando en http://localhost:${PORT}`));
}

module.exports = app;
