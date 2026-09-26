'use strict';
// Sincronizador Stock <-> Tiendanube. Compara el stock de la app de Stock
// (tabla prendas) contra el stock de las variantes visibles de Tiendanube y
// propone cambios. Escribe en Tiendanube los que el usuario aplica desde la
// pantalla y, ademas, el plan automatico diario (aviso 16:45, aplicacion
// 17:00, ver lib/auto.js), que se puede frenar o pausar desde la pantalla.
//
// Mismo patron que las otras sub-apps: exporta el express.app y solo abre
// puerto si corre standalone. Usa la contrasena de Ventas
// (VENTAS_APP_PASSWORD) y las credenciales que Ventas ya carga en este
// proceso (Supabase, Tiendanube, WhatsApp). La unica variable propia es
// SINCRONIZADOR_CRON_SECRET, que protege el aviso diario por WhatsApp.

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { reconcile } = require('./lib/reconcile');
const {
  configStatus,
  loadAll,
  loadIgnored,
  addIgnored,
  removeIgnored,
  readVariantStock,
  writeVariantStock,
  logChange,
  loadChanges,
  noticeSentOn,
  logNotice,
  loadNotices,
  getPlan,
  savePlan,
  isAutoPaused,
  setAutoPaused,
  wait
} = require('./lib/sources');
const { runPreNotice, runAutoApply, buildPlan } = require('./lib/auto');
const { applyChanges } = require('./lib/apply');
const { runDailyNotice, loadRecipientPhone, sendTemplate, sendAutoNotice, todayAR, GREETING_NAME } = require('./lib/notify');

function noticeDeps() {
  return {
    recompute: async () => reconcile(await loadAll()),
    alreadySentToday: noticeSentOn,
    logAviso: logNotice,
    loadPhone: loadRecipientPhone,
    send: sendTemplate
  };
}

function cronSecretMatches(req) {
  const expected = String(process.env.SINCRONIZADOR_CRON_SECRET || '');
  const received = String(req.get('x-sincronizador-secret') || '');
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

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

// Aviso diario, disparado por el cron de Render (sincronizador-aviso-diario)
// con una clave propia. Va antes del login porque el cron no tiene sesion.
// Manda como mucho un WhatsApp por dia y solo si hay algo para revisar.
app.post('/api/avisos/diario', async (req, res) => {
  if (!process.env.SINCRONIZADOR_CRON_SECRET) {
    return res.status(503).json({ success: false, error: 'Falta SINCRONIZADOR_CRON_SECRET.' });
  }
  if (!cronSecretMatches(req)) return res.status(401).json({ success: false, error: 'No autorizado.' });
  // Apagado a pedido del usuario (lo reemplaza el aviso de las 16:45). Responde
  // OK para que el cron de las 9:30 no figure como fallido; se vuelve a
  // prender con SINCRONIZADOR_AVISO_DIARIO=on.
  if (process.env.SINCRONIZADOR_AVISO_DIARIO !== 'on') {
    return res.json({ success: true, status: 'desactivado' });
  }
  const config = configStatus();
  if (!config.ok) {
    return res.status(503).json({ success: false, error: `Faltan variables de entorno: ${config.missing.join(', ')}` });
  }
  try {
    const outcome = await runDailyNotice({ origin: 'cron' }, noticeDeps());
    console.log('[sincronizador aviso diario]', JSON.stringify(outcome));
    res.json({ success: true, ...outcome });
  } catch (err) {
    console.error('[sincronizador aviso diario]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// Automatico diario, disparado por los crons de Render con la misma clave:
// 16:45 arma el plan y avisa por WhatsApp; 17:00 lo aplica.
function cronGuard(req, res) {
  if (!process.env.SINCRONIZADOR_CRON_SECRET) {
    res.status(503).json({ success: false, error: 'Falta SINCRONIZADOR_CRON_SECRET.' });
    return false;
  }
  if (!cronSecretMatches(req)) {
    res.status(401).json({ success: false, error: 'No autorizado.' });
    return false;
  }
  const config = configStatus();
  if (!config.ok) {
    res.status(503).json({ success: false, error: `Faltan variables de entorno: ${config.missing.join(', ')}` });
    return false;
  }
  return true;
}

app.post('/api/automatico/aviso', async (req, res) => {
  if (!cronGuard(req, res)) return;
  try {
    const outcome = await runPreNotice(autoDeps());
    console.log('[sincronizador automatico aviso]', JSON.stringify(outcome));
    res.json({ success: true, ...outcome });
  } catch (err) {
    console.error('[sincronizador automatico aviso]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// Responde enseguida y aplica en segundo plano (pueden ser varios minutos
// por el limite de pedidos de Tiendanube). El resultado queda en el plan.
app.post('/api/automatico/aplicar', async (req, res) => {
  if (!cronGuard(req, res)) return;
  if (applying) return res.status(409).json({ success: false, error: 'Ya se están aplicando cambios.' });
  applying = true;
  res.status(202).json({ success: true, status: 'iniciado' });
  try {
    const outcome = await runAutoApply(autoDeps());
    console.log('[sincronizador automatico aplicar]', JSON.stringify(outcome));
  } catch (err) {
    console.error('[sincronizador automatico aplicar]', err.message);
  } finally {
    applying = false;
  }
});

// Diagnostico de solo lectura: que variantes estan en infinito en
// Tiendanube y sobre que prenda se hacen. Acepta la sesion o la clave del
// cron (para poder revisarlo sin la contrasena de Ventas).
app.get('/api/diagnostico/infinitos', async (req, res) => {
  if (!isAuthenticated(req) && !cronSecretMatches(req)) {
    return res.status(401).json({ success: false, error: 'No autorizado.' });
  }
  const config = configStatus();
  if (!config.ok) {
    return res.status(503).json({ success: false, error: `Faltan variables de entorno: ${config.missing.join(', ')}` });
  }
  try {
    const result = reconcile(await loadAll());
    res.json({
      success: true,
      totalVariantes: result.summary.infinitas,
      noEsperadas: result.infinite.filter((g) => !g.expected),
      esperadas: result.infinite.filter((g) => g.expected).map((g) => ({ sku: g.sku, variants: g.variants }))
    });
  } catch (err) {
    console.error('[sincronizador diagnostico infinitos]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
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
        estampadasDisponibles: data.printedGarments.filter((g) => !g.usedAt && !g.usedOrderId).length,
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

// Aplicar en Tiendanube los cambios aprobados. Cada item es lo que el
// usuario vio en el reporte ({ variantId, from, to }); solo se escribe si
// sigue siendo exactamente eso (ver lib/apply.js). Una aplicacion a la vez.
let applying = false;

// Misma aplicacion para el boton y para el automatico: recalcula y relee
// cada variante antes de escribir (ver lib/apply.js).
function applyWithChecks(items, origin) {
  return applyChanges(items, {
    recompute: async () => reconcile(await loadAll()),
    readStock: readVariantStock,
    writeStock: writeVariantStock,
    logChange,
    pause: () => wait(400),
    origin
  });
}

function autoDeps() {
  return {
    today: todayAR,
    isPaused: isAutoPaused,
    getPlan,
    savePlan,
    loadData: loadAll,
    reconcile,
    loadPhone: loadRecipientPhone,
    sendNotice: sendAutoNotice,
    greeting: GREETING_NAME,
    applyChanges: (items) => applyWithChecks(items, 'automatico')
  };
}

// Hora actual en Argentina, en minutos desde medianoche.
function minutesNowAR() {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date()).split(':').map(Number);
  return h * 60 + m;
}

function publicPlan(plan) {
  if (!plan) return null;
  const { items = [], ...rest } = plan;
  return { ...rest, items: items.map((i) => ({ productName: i.productName, sku: i.sku, color: i.color, talle: i.talle, from: i.from, to: i.to, action: i.action })) };
}

app.get('/api/automatico', async (_req, res) => {
  try {
    const [pausado, plan] = await Promise.all([isAutoPaused(), getPlan(todayAR())]);
    res.json({ success: true, pausado, plan: publicPlan(plan), minutosAhora: minutesNowAR() });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// "Frenar automatico": solo el plan de hoy, si todavia no se aplico.
app.post('/api/automatico/frenar', async (_req, res) => {
  try {
    const plan = await getPlan(todayAR());
    if (!plan || plan.estado !== 'programado') {
      return res.status(409).json({ success: false, error: 'Hoy no hay una aplicación automática programada para frenar.' });
    }
    await savePlan({ ...plan, estado: 'cancelado', detalle: `Frenado desde la pantalla a las ${new Date().toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' })}.` });
    res.json({ success: true });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

app.post('/api/automatico/reactivar', async (_req, res) => {
  try {
    const plan = await getPlan(todayAR());
    if (!plan || plan.estado !== 'cancelado') {
      return res.status(409).json({ success: false, error: 'No hay un automático frenado hoy.' });
    }
    if (minutesNowAR() >= 17 * 60) {
      return res.status(409).json({ success: false, error: 'Ya pasaron las 17:00: hoy no se puede reactivar.' });
    }
    await savePlan({ ...plan, estado: 'programado', detalle: '' });
    res.json({ success: true });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

app.post('/api/automatico/pausa', async (req, res) => {
  try {
    await setAutoPaused(Boolean(req.body?.pausado));
    res.json({ success: true, pausado: Boolean(req.body?.pausado) });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

app.post('/api/aplicar', async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const valid = items.filter((item) =>
    /^\d+$/.test(String(item?.variantId || '')) &&
    Number.isInteger(Number(item.from)) && Number(item.from) >= 0 &&
    Number.isInteger(Number(item.to)) && Number(item.to) >= 0 && Number(item.to) <= 10000);
  if (!valid.length || valid.length !== items.length) {
    return res.status(400).json({ success: false, error: 'Los cambios a aplicar no son validos.' });
  }
  if (applying) {
    return res.status(409).json({ success: false, error: 'Ya se estan aplicando cambios. Espera a que termine.' });
  }
  applying = true;
  try {
    const outcome = await applyWithChecks(valid, 'manual');
    console.log('[sincronizador /api/aplicar]', JSON.stringify({ aplicados: outcome.aplicados, omitidos: outcome.omitidos, errores: outcome.errores }));
    res.json({ success: true, ...outcome });
  } catch (err) {
    console.error('[sincronizador /api/aplicar]', err.message);
    res.status(502).json({ success: false, error: err.message });
  } finally {
    applying = false;
  }
});

// Boton "Probar aviso" de la pantalla: manda el WhatsApp ahora, aunque ya
// se haya mandado hoy o no haya cambios.
// Manda ahora el mismo WhatsApp que el de las 16:45, con los cambios de este
// momento. Solo avisa: no programa ni aplica nada.
app.post('/api/avisos/probar', async (_req, res) => {
  try {
    const plan = buildPlan(reconcile(await loadAll()));
    const phone = await loadRecipientPhone();
    await sendAutoNotice(phone, [GREETING_NAME(), String(plan.resumen.total), plan.resumen.texto || 'ninguno']);
    res.json({ success: true, counts: plan.resumen });
  } catch (err) {
    console.error('[sincronizador aviso de prueba]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

app.get('/api/avisos', async (_req, res) => {
  try {
    res.json({ success: true, notices: await loadNotices() });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

app.get('/api/historial', async (_req, res) => {
  try {
    res.json({ success: true, changes: await loadChanges() });
  } catch (err) {
    console.error('[sincronizador GET /api/historial]', err.message);
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
