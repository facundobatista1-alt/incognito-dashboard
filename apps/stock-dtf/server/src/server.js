'use strict';
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { execFileSync } = require('child_process');
const { getDb, ensureSchema } = require('./db');
const engine = require('./engine');
const recipes = require('./recipes');
const { SIZE_CATEGORIES, VALUATION_SIZES } = require('./valuation');

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: false }));

// Secreto para el panel interno (frontend de esta app). Queda fijado como
// prioridad para evitar que Render conserve un valor viejo enmascarado.
const APP_PASSWORD = process.env.NODE_ENV === 'test' ? '' : (process.env.APP_PASSWORD || 'Incognito2026!');
// Secreto SEPARADO para la integracion con incognito-ventas (contrato STAMPS_*,
// nunca reutiliza ni reemplaza el DECREMENT_SECRET del stock de prendas)
const STAMPS_API_SECRET = process.env.STAMPS_API_SECRET === APP_PASSWORD ? process.env.STAMPS_API_SECRET : '';
const PANEL_COOKIE = 'stockdtf_panel';
const PANEL_COOKIE_VALUE = APP_PASSWORD
  ? crypto.createHash('sha256').update(APP_PASSWORD).digest('hex')
  : '';

const PREVIEWS_DIR = process.env.PREVIEWS_DIR || path.join(__dirname, '..', '..', 'previews');

function stampOrderSql(alias = 'sv') {
  return `
    case when ${alias}.categoria = 'Talles' then regexp_replace(${alias}.codigo, '-(S|M|L|XL|XXL)$', '') else ${alias}.codigo end,
    case ${alias}.talle_tamano
      when 'S' then 1 when 'M' then 2 when 'L' then 3 when 'XL' then 4 when 'XXL' then 5
      else 99
    end,
    ${alias}.codigo
  `;
}

// Normaliza valuation_size: '' -> null, valida contra el enum permitido.
// Devuelve undefined si el campo no vino en el body (para no tocarlo).
function normalizeValuationSize(value) {
  if (value === undefined) return undefined;
  const s = String(value || '').trim().toUpperCase();
  if (!s) return null;
  if (!VALUATION_SIZES.includes(s)) {
    throw new engine.StockError(
      `Tamaño de valuación inválido: "${value}". Opciones: ${VALUATION_SIZES.join(', ')}`,
      'INVALID_INPUT'
    );
  }
  return s;
}

// Valida el par ancho/alto manual de valuacion (valuation_width_cm /
// valuation_height_cm): deben venir juntos y ser > 0, o ambos vacios/null
// para borrar la medida manual. Devuelve {valuation_width_cm, valuation_height_cm}
// (numeros o null) normalizado, o undefined si ninguno de los dos vino en el body.
function normalizeValuationMeasure(body) {
  const hasW = 'valuation_width_cm' in body;
  const hasH = 'valuation_height_cm' in body;
  if (!hasW && !hasH) return undefined;
  const isEmpty = (v) => v === '' || v === null || v === undefined;
  const wRaw = body.valuation_width_cm;
  const hRaw = body.valuation_height_cm;
  if (isEmpty(wRaw) && isEmpty(hRaw)) return { valuation_width_cm: null, valuation_height_cm: null };
  const w = Number(wRaw);
  const h = Number(hRaw);
  if (isEmpty(wRaw) || isEmpty(hRaw) || !(w > 0) || !(h > 0)) {
    throw new engine.StockError(
      'valuation_width_cm y valuation_height_cm deben cargarse juntos y ser mayores a cero',
      'INVALID_INPUT'
    );
  }
  return { valuation_width_cm: w, valuation_height_cm: h };
}

function parseCookies(req) {
  return String(req.headers.cookie || '').split(';').reduce((acc, part) => {
    const idx = part.indexOf('=');
    if (idx > -1) acc[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    return acc;
  }, {});
}

function loginPage(error = '', base = '') {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stock DTF - Acceso</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Inter,system-ui,Segoe UI,sans-serif;background:#f5f6f8;color:#111827}
form{width:min(360px,calc(100vw - 32px));padding:24px;border:1px solid #d9dee7;border-radius:8px;background:#fff}
h1{font-size:22px;margin:0 0 8px}p{margin:0 0 18px;color:#526071}label{display:block;font-weight:700;margin-bottom:8px}
input{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #cfd6df;border-radius:6px;font-size:16px}
button{width:100%;margin-top:14px;padding:11px 12px;border:0;border-radius:6px;background:#2563eb;color:#fff;font-weight:700;font-size:15px}
.err{color:#b91c1c;margin-top:12px;font-size:14px}
</style></head><body><form method="post" action="${base}/login">
<h1>Stock DTF</h1><p>Acceso interno Incognito</p>
<label>Contraseña</label><input name="password" type="password" autofocus autocomplete="current-password">
<button>Entrar</button>${error ? `<div class="err">${error}</div>` : ''}
</form></body></html>`;
}

function requirePanelAuth(req, res, next) {
  if (!APP_PASSWORD) return next();
  if (req.path === '/login' || req.path === '/api/health' || req.path.startsWith('/api/stamps/v1')) return next();
  const cookies = parseCookies(req);
  if (cookies[PANEL_COOKIE] === PANEL_COOKIE_VALUE) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ ok: false, error: 'login_requerido' });
  return res.redirect((req.baseUrl || '') + '/login');
}

app.get('/login', (req, res) => res.type('html').send(loginPage('', req.baseUrl || '')));
app.post('/login', (req, res) => {
  if (!APP_PASSWORD || req.body.password === APP_PASSWORD) {
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${PANEL_COOKIE}=${encodeURIComponent(PANEL_COOKIE_VALUE)}; Path=${req.baseUrl || '/'}; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`);
    return res.redirect((req.baseUrl || '') + '/');
  }
  return res.status(401).type('html').send(loginPage('Contraseña incorrecta', req.baseUrl || ''));
});

function requireStampsSecret(req, res, next) {
  const allowedSecrets = [STAMPS_API_SECRET, APP_PASSWORD].filter(Boolean);
  if (!allowedSecrets.length) return next(); // sin secreto configurado = abierto (solo dev local)
  const auth = String(req.headers.authorization || '');
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
  const provided = req.headers['x-stamps-api-secret'] || bearer || req.query.secret;
  if (!allowedSecrets.includes(provided)) {
    return res.status(401).json({ ok: false, error: 'Secreto de API de estampas invalido o faltante' });
  }
  next();
}

function wrap(fn) {
  return async (req, res) => {
    try {
      const result = await fn(req, res);
      if (result !== undefined) res.json(result);
    } catch (e) {
      if (e instanceof engine.StockError) {
        const statusMap = { INSUFFICIENT_STOCK: 409, NOT_FOUND: 404, INVALID_INPUT: 400, ALREADY_RECEIVED: 409 };
        return res.status(statusMap[e.code] || 400).json({ ok: false, error: e.message, code: e.code, details: e.details });
      }
      console.error('[error]', e);
      res.status(500).json({ ok: false, error: 'Error interno', detalle: String((e && e.message) || e) });
    }
  };
}

let db; // se inicializa en start()
let ventasPendingCache = { ts: 0, url: '', data: null, error: null };
let ventasPendingRefreshPromise = null;
const VENTAS_PENDING_CACHE_MS = 5 * 60 * 1000;
const VENTAS_PENDING_STALE_MS = 30 * 60 * 1000;
const VENTAS_PENDING_TIMEOUT_MS = 5000;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} tardo mas de ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function savePreviewUpload(dataUrl, code) {
  if (!dataUrl) return null;
  const match = String(dataUrl).match(/^data:image\/(png|jpe?g|webp|gif);base64,([a-z0-9+/=]+)$/i);
  if (!match) {
    throw new engine.StockError('La imagen debe ser PNG, JPG, WEBP o GIF', 'INVALID_INPUT');
  }
  const ext = match[1].toLowerCase().replace('jpeg', 'jpg');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 8 * 1024 * 1024) {
    throw new engine.StockError('La imagen de vista previa debe pesar menos de 8 MB', 'INVALID_INPUT');
  }
  const cleanCode = String(code || 'preview').toUpperCase().replace(/[^A-Z0-9_-]+/g, '_');
  const prefix = cleanCode.split('-')[0] || 'manual';
  const targetDir = path.join(PREVIEWS_DIR, prefix);
  fs.mkdirSync(targetDir, { recursive: true });
  const fileName = `${cleanCode}.${ext}`;
  fs.writeFileSync(path.join(targetDir, fileName), buffer);
  return `previews/${prefix}/${fileName}`;
}

// ============================================================================
// HEALTH
// ============================================================================
app.get('/api/health', wrap(async () => ({ ok: true, ts: new Date().toISOString(), db: db.kind })));

app.use(requirePanelAuth);
app.use('/previews', express.static(PREVIEWS_DIR));

// Sirve index.html inyectando <base> con el prefijo de mount (req.baseUrl),
// para que las rutas relativas del frontend (styles.css, app.js, fetch('api/...'))
// resuelvan bien tanto standalone como montado bajo /stock-dtf.
app.get(['/', '/index.html'], (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const base = (req.baseUrl || '') + '/';
  res.type('html').send(html.replace('<head>', `<head>\n<base href="${base}">`));
});

app.use(express.static(path.join(__dirname, '..', 'public')));

// ============================================================================
// DASHBOARD
// ============================================================================
app.get('/api/dashboard', wrap(async () => {
  const [
    totalesResult,
    disenosResult,
    archivosPendientesResult,
    duplicadosPendientesResult,
    ultimosMovimientosResult,
    masUtilizadasResult,
    consumoPeriodoResult,
    stockBajoListaResult,
  ] = await Promise.all([
    db.query(`
      select
        count(*)::int as total_variantes,
        coalesce(sum(si.cantidad_disponible),0)::int as total_unidades,
        sum(case when sv.estado='Stock bajo' then 1 else 0 end)::int as stock_bajo,
        sum(case when sv.estado='Agotada' then 1 else 0 end)::int as agotadas,
        sum(case when sv.estado='Pendiente de revision' then 1 else 0 end)::int as pendientes_revision,
        sum(case when sv.estado='Discontinuada' then 1 else 0 end)::int as discontinuadas
      from stamp_variants sv join stamp_inventory si on si.stamp_variant_id = sv.id
    `),
    db.query('select count(*)::int n from stamp_designs'),
    db.query(`select count(*)::int n from stamp_pending_reviews where resuelto=false and tipo='archivo'`),
    db.query(`select count(*)::int n from stamp_pending_reviews where resuelto=false and tipo='posible_duplicado'`),
    db.query(`
      select m.*, sv.nombre as estampa_nombre, sv.codigo as estampa_codigo
      from stamp_movements m join stamp_variants sv on sv.id = m.stamp_variant_id
      order by m.id desc limit 15
    `),
    db.query(`
      select sv.id, sv.codigo, sv.nombre, sf.previsualizacion, sum(m.cantidad)::int as consumo
      from stamp_movements m
      join stamp_variants sv on sv.id = m.stamp_variant_id
      left join stamp_files sf on sf.stamp_variant_id = sv.id
      where m.direccion='salida' and m.tipo='descuento_pedido' and m.created_at >= now() - interval '30 days'
      group by sv.id, sv.codigo, sv.nombre, sf.previsualizacion
      order by consumo desc limit 8
    `),
    db.query(`
      select coalesce(sum(cantidad),0)::int total from stamp_movements
      where direccion='salida' and tipo='descuento_pedido' and created_at >= now() - interval '30 days'
    `),
    db.query(`
      select sv.id, sv.codigo, sv.nombre, si.cantidad_disponible, si.stock_minimo, sf.previsualizacion, sv.estado
      from stamp_variants sv
      join stamp_inventory si on si.stamp_variant_id = sv.id
      left join stamp_files sf on sf.stamp_variant_id = sv.id
      where sv.estado in ('Stock bajo','Agotada')
      order by sv.estado, si.cantidad_disponible asc limit 20
    `),
  ]);

  const totales = totalesResult.rows[0];
  const disenos = disenosResult.rows[0].n;
  const archivosPendientes = archivosPendientesResult.rows[0].n;
  const duplicadosPendientes = duplicadosPendientesResult.rows[0].n;
  const ultimosMovimientos = ultimosMovimientosResult.rows;
  const masUtilizadas = masUtilizadasResult.rows;
  const consumoPeriodo = consumoPeriodoResult.rows[0].total;
  const stockBajoLista = stockBajoListaResult.rows;

  return {
    totales: { ...totales, disenos, archivos_pendientes: archivosPendientes, posibles_duplicados: duplicadosPendientes },
    consumo_periodo_30d: consumoPeriodo,
    ultimos_movimientos: ultimosMovimientos,
    mas_utilizadas_30d: masUtilizadas,
    stock_bajo: stockBajoLista,
  };
}));

app.get('/api/valuacion-stock', wrap(async (req) => {
  const costoPlancha = Number(req.query.costo_plancha || 10500);
  const anchoPlanchaCm = Number(req.query.ancho_plancha_cm || 58);
  const altoPlanchaCm = Number(req.query.alto_plancha_cm || 100);
  if (!(costoPlancha > 0) || !(anchoPlanchaCm > 0) || !(altoPlanchaCm > 0)) {
    throw new engine.StockError('Costo y medida de plancha deben ser mayores a cero', 'INVALID_INPUT');
  }

  const areaPlanchaCm2 = anchoPlanchaCm * altoPlanchaCm;
  const rows = (await db.query(`
    select sv.id, sv.codigo, sv.nombre, sv.categoria, sv.ancho, sv.alto, sv.unidad_medida, sv.valuation_size,
           sv.valuation_width_cm, sv.valuation_height_cm, sv.valuation_source, sv.valuation_confidence,
           coalesce(si.cantidad_disponible, 0)::int as cantidad_disponible
    from stamp_variants sv
    join stamp_inventory si on si.stamp_variant_id = sv.id
    where coalesce(si.cantidad_disponible, 0) > 0
      and sv.estado <> 'Discontinuada'
    order by ${stampOrderSql('sv')}
  `)).rows;

  let areaTotalCm2 = 0;
  let unidadesValorizadas = 0;
  let valorTotal = 0;
  const unidadesPorCategoria = Object.fromEntries(Object.keys(SIZE_CATEGORIES).map((key) => [key, 0]));
  // dpi solo se usa para el equivalente en "planchas"; ya no convierte px a cm
  // (ver abajo: ancho/alto en px NUNCA se toma como medida fisica real).
  const sinValorizar = [];
  const detalle = [];

  // Prioridad de valuación, de más a menos confiable:
  //   1) medida_manual  -> valuation_width_cm/valuation_height_cm cargados a mano
  //      (por estampa o por lote via /api/estampas/valuacion-por-prefijo).
  //   2) medida_cm      -> ancho/alto reales, SOLO si unidad_medida = 'cm'.
  //      Si unidad_medida = 'px', ancho/alto es la resolución de la imagen,
  //      NO el tamaño físico del diseño: nunca se usa para valuar (bug real
  //      corregido acá: antes se convertía px->cm por DPI y daba medidas
  //      absurdas, ej. una estampa de 5x5cm real medía 3425x3180 px y se
  //      valuaba como si fuera de 29x27cm).
  //   3) categoria      -> valuation_size (XS/S/M/L/XL/TALLE) como medida
  //      representativa. 'CUSTOM' señala explícitamente "no estimar".
  //   4) sin valorizar  -> nada de lo anterior. Si además tiene ancho/alto en
  //      px (dato "técnico" no confiable para valuar), se marca aparte como
  //      'px_no_confiable' en vez de 'sin_valorizar' para distinguir "no hay
  //      ningún dato" de "hay un dato, pero no es de fiar".
  for (const row of rows) {
    const stock = Number(row.cantidad_disponible || 0);
    const manualW = Number(row.valuation_width_cm || 0);
    const manualH = Number(row.valuation_height_cm || 0);
    const tieneMedidaManual = manualW > 0 && manualH > 0;

    const unidad = String(row.unidad_medida || '').toLowerCase();
    const anchoReal = Number(row.ancho || 0);
    const altoReal = Number(row.alto || 0);
    const tieneMedidaCm = unidad === 'cm' && anchoReal > 0 && altoReal > 0;
    const tieneMedidaPxNoConfiable = !tieneMedidaCm && unidad === 'px' && anchoReal > 0 && altoReal > 0;

    const categoria = SIZE_CATEGORIES[row.valuation_size] ? row.valuation_size : null;

    let anchoCm, altoCm, origen;
    if (tieneMedidaManual) {
      anchoCm = manualW;
      altoCm = manualH;
      origen = 'medida_manual';
    } else if (tieneMedidaCm) {
      anchoCm = anchoReal;
      altoCm = altoReal;
      origen = 'medida_cm';
    } else if (categoria) {
      anchoCm = SIZE_CATEGORIES[categoria].ancho_cm;
      altoCm = SIZE_CATEGORIES[categoria].alto_cm;
      origen = 'categoria';
    } else {
      sinValorizar.push({ ...row, origen: tieneMedidaPxNoConfiable ? 'px_no_confiable' : 'sin_valorizar' });
      continue;
    }

    const areaUnidadCm2 = anchoCm * altoCm;
    const areaStockCm2 = areaUnidadCm2 * stock;
    const valorUnitario = (areaUnidadCm2 / areaPlanchaCm2) * costoPlancha;
    const valorStock = valorUnitario * stock;

    areaTotalCm2 += areaStockCm2;
    unidadesValorizadas += stock;
    valorTotal += valorStock;
    if (origen === 'categoria') unidadesPorCategoria[categoria] += stock;
    detalle.push({
      id: row.id,
      codigo: row.codigo,
      nombre: row.nombre,
      cantidad_disponible: stock,
      origen,
      valuation_size: origen === 'categoria' ? categoria : null,
      valuation_source: origen === 'medida_manual' ? row.valuation_source : null,
      valuation_confidence: origen === 'medida_manual' ? row.valuation_confidence : null,
      ancho_cm: anchoCm,
      alto_cm: altoCm,
      area_unidad_cm2: areaUnidadCm2,
      valor_unitario: valorUnitario,
      valor_stock: valorStock,
    });
  }

  const unidadesPorOrigen = { medida_manual: 0, medida_cm: 0, categoria: 0, sin_valorizar: 0, px_no_confiable: 0 };
  for (const d of detalle) unidadesPorOrigen[d.origen] += d.cantidad_disponible;
  for (const s of sinValorizar) unidadesPorOrigen[s.origen] += Number(s.cantidad_disponible || 0);

  const unidadesSinValorizar = unidadesPorOrigen.sin_valorizar + unidadesPorOrigen.px_no_confiable;
  detalle.sort((a, b) => b.valor_stock - a.valor_stock);
  return {
    parametros: { costo_plancha: costoPlancha, ancho_plancha_cm: anchoPlanchaCm, alto_plancha_cm: altoPlanchaCm },
    size_categories: SIZE_CATEGORIES,
    area_plancha_cm2: areaPlanchaCm2,
    planchas_equivalentes: areaTotalCm2 / areaPlanchaCm2,
    area_total_cm2: areaTotalCm2,
    valor_total: valorTotal,
    unidades_valorizadas: unidadesValorizadas,
    unidades_valorizadas_medida_real: unidadesPorOrigen.medida_manual + unidadesPorOrigen.medida_cm,
    unidades_valorizadas_categoria: unidadesPorOrigen.categoria,
    unidades_por_origen: unidadesPorOrigen,
    unidades_por_categoria: unidadesPorCategoria,
    estampas_valorizadas: detalle.length,
    estampas_sin_valorizar: sinValorizar.length,
    unidades_sin_valorizar: unidadesSinValorizar,
    sin_valorizar: sinValorizar.slice(0, 80).map((row) => ({
      id: row.id,
      codigo: row.codigo,
      nombre: row.nombre,
      categoria: row.categoria,
      cantidad_disponible: row.cantidad_disponible,
      origen: row.origen,
      ancho_px: row.origen === 'px_no_confiable' ? Number(row.ancho) : null,
      alto_px: row.origen === 'px_no_confiable' ? Number(row.alto) : null,
    })),
    detalle: detalle.slice(0, 40),
  };
}));

// ============================================================================
// INVENTARIO
// ============================================================================
app.get('/api/estampas', wrap(async (req) => {
  const { q, categoria, estado, diseno, sort, dir } = req.query;
  let sql = `
    select sv.*, si.cantidad_disponible, si.stock_minimo, si.pendiente_de_contar,
           d.codigo_prefijo as diseno_prefijo, d.nombre as diseno_nombre,
           sf.archivo_original, sf.previsualizacion, sf.formato_archivo
    from stamp_variants sv
    join stamp_inventory si on si.stamp_variant_id = sv.id
    left join stamp_designs d on d.id = sv.design_id
    left join lateral (
      select archivo_original, previsualizacion, formato_archivo from stamp_files
      where stamp_variant_id = sv.id order by id limit 1
    ) sf on true
    where 1=1`;
  const params = [];
  if (q) { params.push(`%${q}%`); sql += ` and (sv.nombre ilike $${params.length} or sv.codigo ilike $${params.length} or sv.variante ilike $${params.length})`; }
  if (categoria) { params.push(categoria); sql += ` and sv.categoria = $${params.length}`; }
  if (estado) { params.push(estado); sql += ` and sv.estado = $${params.length}`; }
  if (diseno) { params.push(diseno); sql += ` and d.codigo_prefijo = $${params.length}`; }
  if (sort === 'codigo' || !['nombre', 'cantidad_disponible', 'stock_minimo', 'estado', 'updated_at'].includes(sort)) {
    sql += ` order by ${stampOrderSql('sv')}`;
  } else {
    const sortCol = sort === 'cantidad_disponible' || sort === 'stock_minimo' ? `si.${sort}` : `sv.${sort}`;
    sql += ` order by ${sortCol} ${dir === 'desc' ? 'desc' : 'asc'}, ${stampOrderSql('sv')}`;
  }
  return (await db.query(sql, params)).rows;
}));

// Vista previa (solo lectura) de qué estampas matchean un prefijo de código,
// para la herramienta "aplicar medida real por lote" del Inventario.
// IMPORTANTE: declarada antes de '/api/estampas/:id' para que Express no la
// confunda con una búsqueda por id.
app.get('/api/estampas/valuacion-por-prefijo', wrap(async (req) => {
  const prefijo = String(req.query.prefijo || '').trim().replace(/\*+$/, '');
  if (!prefijo) throw new engine.StockError('prefijo es obligatorio', 'INVALID_INPUT');
  const matches = (await db.query(
    `select id, codigo, nombre from stamp_variants where codigo like $1 order by codigo`,
    [`${prefijo}%`]
  )).rows;
  return { prefijo, coincidencias: matches.length, muestra: matches.slice(0, 50) };
}));

// Aplica una medida real de valuación (ancho/alto en cm) a TODAS las
// estampas cuyo código empiece con `prefijo` (ej. "JD-05-" matchea
// JD-05-01, JD-05-02, ...). Tiene prioridad sobre categoría y sobre
// ancho/alto técnico (ver /api/valuacion-stock).
app.post('/api/estampas/valuacion-por-prefijo', wrap(async (req) => {
  const b = req.body || {};
  const prefijo = String(b.prefijo || '').trim().replace(/\*+$/, '');
  if (!prefijo) throw new engine.StockError('prefijo es obligatorio', 'INVALID_INPUT');
  const anchoCm = Number(b.ancho_cm);
  const altoCm = Number(b.alto_cm);
  if (!(anchoCm > 0) || !(altoCm > 0)) {
    throw new engine.StockError('ancho_cm y alto_cm deben ser mayores a cero', 'INVALID_INPUT');
  }
  const source = b.source ? String(b.source).trim().slice(0, 200) : `lote:${prefijo}`;
  const confidence = b.confidence ? String(b.confidence).trim().slice(0, 60) : null;

  const matches = (await db.query(
    `select id, codigo from stamp_variants where codigo like $1 order by codigo`,
    [`${prefijo}%`]
  )).rows;
  if (matches.length === 0) return { updated: 0, coincidencias: [] };

  await db.query(
    `update stamp_variants
     set valuation_width_cm=$1, valuation_height_cm=$2, valuation_source=$3, valuation_confidence=$4, updated_at=now()
     where codigo like $5`,
    [anchoCm, altoCm, source, confidence, `${prefijo}%`]
  );
  return { updated: matches.length, coincidencias: matches.map(m => m.codigo) };
}));

app.get('/api/estampas/:id', wrap(async (req) => {
  const v = await engine.getVariantWithStock(db, req.params.id);
  if (!v) return { error: 'No encontrada' };
  const files = (await db.query('select * from stamp_files where stamp_variant_id=$1', [req.params.id])).rows;
  const movimientos = (await db.query('select * from stamp_movements where stamp_variant_id=$1 order by id desc limit 100', [req.params.id])).rows;
  const productos = (await db.query(`
    select r.*, p.sku, p.nombre as producto_nombre, p.variante as producto_variante
    from stamp_product_recipes r join stamp_products p on p.id = r.product_id
    where r.stamp_variant_id = $1 and r.activo = true
  `, [req.params.id])).rows;
  const duplicados = (await db.query(`
    select pr.*, sv.codigo as codigo_otro, sv.nombre as nombre_otro, sf.previsualizacion as preview_otro
    from stamp_pending_reviews pr
    join stamp_variants sv on sv.id = (case when pr.stamp_variant_id = $1 then pr.related_variant_id else pr.stamp_variant_id end)
    left join stamp_files sf on sf.stamp_variant_id = sv.id
    where pr.tipo='posible_duplicado' and (pr.stamp_variant_id = $1 or pr.related_variant_id = $1) and pr.resuelto = false
  `, [req.params.id])).rows;
  const consumo30 = (await db.query(`
    select coalesce(sum(cantidad),0)::int total from stamp_movements
    where stamp_variant_id=$1 and direccion='salida' and tipo='descuento_pedido' and created_at >= now() - interval '30 days'
  `, [req.params.id])).rows[0].total;

  return { ...v, archivos: files, movimientos, productos_asociados: productos, posibles_duplicados: duplicados, consumo_30d: consumo30 };
}));

app.post('/api/estampas', wrap(async (req) => {
  const b = req.body;
  if (!b.codigo || !b.nombre) {
    throw new engine.StockError('codigo y nombre son obligatorios', 'INVALID_INPUT');
  }
  const uploadedPreview = savePreviewUpload(b.preview_upload, b.codigo);
  if (!b.archivo_original && !uploadedPreview) {
    throw new engine.StockError('archivo_original o imagen de vista previa es obligatorio', 'INVALID_INPUT');
  }
  return db.transaction(async (tx) => {
    let designId = b.design_id || null;
    if (!designId && b.diseno_principal) {
      const dr = await tx.query(
        `insert into stamp_designs (codigo_prefijo, nombre) values ($1,$1)
         on conflict (codigo_prefijo) do update set codigo_prefijo=excluded.codigo_prefijo returning id`,
        [b.diseno_principal]
      );
      designId = dr.rows[0].id;
    }
    const r = await tx.query(
      `insert into stamp_variants (design_id, codigo, nombre, variante, categoria, subcategoria, marca_tematica,
         color, talle_tamano, ubicacion_aplicacion, ancho, alto, unidad_medida, estado, observaciones)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
      [designId, b.codigo, b.nombre, b.variante || 'unica', b.categoria || null, b.subcategoria || null,
       b.marca_tematica || null, b.color || null, b.talle_tamano || null, b.ubicacion_aplicacion || null,
       b.ancho || null, b.alto || null, b.unidad_medida || 'px', b.estado || 'Pendiente de revision', b.observaciones || null]
    );
    const id = r.rows[0].id;
    await tx.query(
      `insert into stamp_files (stamp_variant_id, archivo_original, carpeta_origen, formato_archivo, origen_tipo, previsualizacion)
       values ($1,$2,$3,$4,$5,$6)`,
      [
        id,
        b.archivo_original || `alta-manual/${b.codigo}`,
        b.carpeta_origen || '',
        b.formato_archivo || '',
        b.origen_tipo || 'manual',
        uploadedPreview || b.previsualizacion || null,
      ]
    );
    await tx.query(
      `insert into stamp_inventory (stamp_variant_id, cantidad_disponible, stock_minimo, pendiente_de_contar)
       values ($1,$2,$3,$4)`,
      [id, b.cantidad_disponible ?? null, b.stock_minimo || 0, (b.cantidad_disponible ?? null) === null]
    );
    return { id };
  });
}));

app.put('/api/estampas/:id', wrap(async (req) => {
  const allowed = ['nombre', 'variante', 'categoria', 'subcategoria', 'marca_tematica', 'color', 'talle_tamano',
    'ubicacion_aplicacion', 'ancho', 'alto', 'unidad_medida', 'estado', 'observaciones', 'valuation_size',
    'valuation_width_cm', 'valuation_height_cm', 'valuation_source', 'valuation_confidence'];
  const b = req.body;
  const fields = allowed.filter(f => f in b);
  if (fields.includes('valuation_size')) {
    b.valuation_size = normalizeValuationSize(b.valuation_size);
  }
  const measure = normalizeValuationMeasure(b);
  if (measure) Object.assign(b, measure);
  if (fields.includes('valuation_source')) {
    b.valuation_source = b.valuation_source ? String(b.valuation_source).trim().slice(0, 200) : null;
  }
  if (fields.includes('valuation_confidence')) {
    b.valuation_confidence = b.valuation_confidence ? String(b.valuation_confidence).trim().slice(0, 60) : null;
  }
  const changesInventory = 'stock_minimo' in b;
  if (fields.length === 0 && !changesInventory) return { updated: false };
  await db.transaction(async (tx) => {
    if (fields.length) {
      const setSql = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
      await tx.query(`update stamp_variants set ${setSql}, updated_at = now() where id = $1`, [req.params.id, ...fields.map(f => b[f])]);
    }
    if (changesInventory) {
      await tx.query('update stamp_inventory set stock_minimo=$2, updated_at=now() where stamp_variant_id=$1', [req.params.id, b.stock_minimo]);
      const v = await engine.getVariantWithStock(tx, req.params.id);
      if (v) {
        const estado = engine.recomputeEstado(v);
        await tx.query('update stamp_variants set estado=$1, updated_at=now() where id=$2', [estado, req.params.id]);
      }
    }
  });
  return { updated: true };
}));

app.post('/api/estampas/bulk-update', wrap(async (req) => {
  const { ids, changes } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) throw new engine.StockError('ids requerido', 'INVALID_INPUT');
  const variantFields = ['categoria', 'subcategoria', 'marca_tematica', 'color', 'ubicacion_aplicacion', 'estado',
    'valuation_size', 'valuation_source', 'valuation_confidence'].filter(f => f in changes && changes[f] !== '' && changes[f] != null);
  const invFields = ['stock_minimo'].filter(f => f in changes && changes[f] !== '' && changes[f] != null);
  if (variantFields.includes('valuation_size')) {
    changes.valuation_size = normalizeValuationSize(changes.valuation_size);
  }
  const measure = normalizeValuationMeasure(changes);
  if (measure && measure.valuation_width_cm != null) {
    Object.assign(changes, measure);
    variantFields.push('valuation_width_cm', 'valuation_height_cm');
  }
  if (variantFields.length === 0 && invFields.length === 0) return { updated: 0 };
  return db.transaction(async (tx) => {
    for (const id of ids) {
      if (variantFields.length) {
        const setSql = variantFields.map((f, i) => `${f} = $${i + 2}`).join(', ');
        await tx.query(`update stamp_variants set ${setSql}, updated_at=now() where id=$1`, [id, ...variantFields.map(f => changes[f])]);
      }
      if (invFields.length) {
        const setSql = invFields.map((f, i) => `${f} = $${i + 2}`).join(', ');
        await tx.query(`update stamp_inventory set ${setSql}, updated_at=now() where stamp_variant_id=$1`, [id, ...invFields.map(f => changes[f])]);
        const v = await engine.getVariantWithStock(tx, id);
        if (v) {
          const estado = engine.recomputeEstado(v);
          await tx.query('update stamp_variants set estado=$1, updated_at=now() where id=$2', [estado, id]);
        }
      }
    }
    return { updated: ids.length };
  });
}));

app.post('/api/admin/estampas/:id/preview', wrap(async (req) => {
  const b = req.body || {};
  if (!b.previsualizacion) throw new engine.StockError('previsualizacion es obligatoria', 'INVALID_INPUT');
  const variant = await engine.getVariantWithStock(db, req.params.id);
  if (!variant) throw new engine.StockError('Estampa no encontrada', 'NOT_FOUND');

  return db.transaction(async (tx) => {
    const existing = (await tx.query(`
      select id
      from stamp_files
      where stamp_variant_id = $1
      order by
        case when coalesce(previsualizacion, '') = '' then 0 else 1 end,
        id
      limit 1
    `, [req.params.id])).rows[0];

    if (existing) {
      await tx.query(`
        update stamp_files
        set archivo_original = coalesce($2, archivo_original),
            carpeta_origen = coalesce($3, carpeta_origen),
            formato_archivo = coalesce($4, formato_archivo),
            origen_tipo = coalesce($5, origen_tipo),
            previsualizacion = $6
        where id = $1
      `, [
        existing.id,
        b.archivo_original || null,
        b.carpeta_origen || null,
        b.formato_archivo || null,
        b.origen_tipo || null,
        b.previsualizacion,
      ]);
      return { ok: true, updated: true, file_id: existing.id };
    }

    const inserted = await tx.query(`
      insert into stamp_files
        (stamp_variant_id, archivo_original, carpeta_origen, formato_archivo, origen_tipo, previsualizacion)
      values ($1,$2,$3,$4,$5,$6)
      returning id
    `, [
      req.params.id,
      b.archivo_original || '',
      b.carpeta_origen || '',
      b.formato_archivo || '',
      b.origen_tipo || 'manual',
      b.previsualizacion,
    ]);
    return { ok: true, updated: false, file_id: inserted.rows[0].id };
  });
}));

app.delete('/api/estampas/:id', wrap(async (req) => {
  const id = req.params.id;
  const v = await engine.getVariantWithStock(db, id);
  if (!v) throw new engine.StockError('Estampa no encontrada', 'NOT_FOUND');

  const refs = await db.query(`
    select
      (select count(*)::int from stamp_movements where stamp_variant_id = $1) as movimientos,
      (select count(*)::int from stamp_product_recipes where stamp_variant_id = $1 and activo = true) as recetas,
      (select count(*)::int from stamp_production_order_items where stamp_variant_id = $1) as produccion
  `, [id]);
  const r = refs.rows[0];
  if (r.movimientos || r.recetas || r.produccion) {
    throw new engine.StockError(
      'No se puede eliminar una estampa con movimientos, recetas o produccion asociada. Primero revisa esas relaciones.',
      'INVALID_INPUT',
      r
    );
  }

  await db.transaction(async (tx) => {
    await tx.query(`
      update stamp_pending_reviews
      set resuelto = true,
          resolucion = 'Resuelto: estampa eliminada manualmente',
          resolved_at = now()
      where resuelto = false and (stamp_variant_id = $1 or related_variant_id = $1)
    `, [id]);
    await tx.query('delete from stamp_variants where id = $1', [id]);
  });
  return { ok: true };
}));

app.post('/api/estampas/:id/ingreso', wrap(async (req) => {
  const { cantidad, usuario, motivo } = req.body;
  return engine.ingreso(db, { variantId: req.params.id, cantidad, usuario, motivo, tipo: 'ingreso' });
}));
app.post('/api/estampas/:id/salida', wrap(async (req) => {
  const { cantidad, usuario, motivo, tipo } = req.body;
  return engine.salidaManual(db, { variantId: req.params.id, cantidad, usuario, motivo, tipo });
}));
app.post('/api/estampas/:id/correccion', wrap(async (req) => {
  const { cantidad_nueva, usuario, motivo } = req.body;
  return engine.correccionManual(db, { variantId: req.params.id, cantidadNueva: cantidad_nueva, usuario, motivo });
}));
app.post('/api/estampas/:id/discontinuar', wrap(async (req) => {
  await db.query(`update stamp_variants set estado='Discontinuada', updated_at=now() where id=$1`, [req.params.id]);
  return { ok: true };
}));
app.post('/api/estampas/:id/reactivar', wrap(async (req) => {
  const v = await engine.getVariantWithStock(db, req.params.id);
  const estado = engine.recomputeEstado({ ...v, estado: 'Disponible' });
  await db.query(`update stamp_variants set estado=$1, updated_at=now() where id=$2`, [estado, req.params.id]);
  return { ok: true };
}));

// ============================================================================
// DISENOS / CATEGORIAS
// ============================================================================
app.get('/api/disenos', wrap(async () => (await db.query('select * from stamp_designs order by codigo_prefijo')).rows));
app.get('/api/categorias', wrap(async () =>
  (await db.query(`select distinct categoria from stamp_variants where categoria is not null and categoria != '' order by categoria`)).rows.map(r => r.categoria)
));

// ============================================================================
// PRODUCTOS (con importacion desde Tiendanube/incognito-ventas)
// ============================================================================
app.get('/api/productos', wrap(async (req) => {
  const { q } = req.query;
  if (q) {
    return (await db.query(`select * from stamp_products where sku ilike $1 or nombre ilike $1 order by nombre`, [`%${q}%`])).rows;
  }
  return (await db.query('select * from stamp_products order by nombre')).rows;
}));
app.post('/api/productos', wrap(async (req) => {
  const { sku, nombre, variante } = req.body;
  if (!sku || !nombre) throw new engine.StockError('sku y nombre son obligatorios', 'INVALID_INPUT');
  const r = await db.query(
    `insert into stamp_products (sku, nombre, variante, fuente) values ($1,$2,$3,'manual')
     on conflict (sku) do update set nombre=excluded.nombre, variante=excluded.variante, updated_at=now()
     returning id`,
    [sku, nombre, variante || null]
  );
  return { id: r.rows[0].id, ok: true };
}));
// Importacion masiva: recibe un array de {sku, nombre, variante} (por ejemplo
// pegado desde un export de Tiendanube o traido con /api/productos/importar-tiendanube)
app.post('/api/productos/importar', wrap(async (req) => {
  const { productos, fuente } = req.body;
  if (!Array.isArray(productos)) throw new engine.StockError('productos debe ser un array', 'INVALID_INPUT');
  let creados = 0, actualizados = 0, invalidos = 0;
  await db.transaction(async (tx) => {
    for (const p of productos) {
      if (!p.sku || !p.nombre) { invalidos++; continue; }
      const r = await tx.query(
        `insert into stamp_products (sku, nombre, variante, fuente) values ($1,$2,$3,$4)
         on conflict (sku) do update set nombre=excluded.nombre, variante=excluded.variante, updated_at=now()
         returning (xmax = 0) as inserted`,
        [p.sku, p.nombre, p.variante || null, fuente || 'tiendanube']
      );
      if (r.rows[0].inserted) creados++; else actualizados++;
    }
  });
  return { creados, actualizados, invalidos };
}));
app.get('/api/productos/sin-receta', wrap(async () => (await db.query(`
  select p.* from stamp_products p
  where p.activo = true and not exists (
    select 1 from stamp_product_recipes r where r.product_id = p.id and r.activo = true and r.confirmado = true
  )
  order by p.nombre
`)).rows));
app.get('/api/productos/recetas-incompletas', wrap(async () => (await db.query(`
  select p.id, p.sku, p.nombre, count(r.id)::int as cantidad_recetas,
         array_agg(distinct r.ubicacion_aplicacion) filter (where r.ubicacion_aplicacion is not null) as ubicaciones
  from stamp_products p
  join stamp_product_recipes r on r.product_id = p.id and r.activo = true and r.confirmado = true
  group by p.id, p.sku, p.nombre
  having count(r.id) = 1
  order by p.nombre
`)).rows));

// ============================================================================
// RECETAS DE ESTAMPADO
// ============================================================================
app.get('/api/recetas', wrap(async (req) => {
  const { productId } = req.query;
  let sql = `
    select r.*, p.sku, p.nombre as producto_nombre, sv.codigo as estampa_codigo, sv.nombre as estampa_nombre,
           sf.previsualizacion
    from stamp_product_recipes r
    join stamp_products p on p.id = r.product_id
    join stamp_variants sv on sv.id = r.stamp_variant_id
    left join lateral (select previsualizacion from stamp_files where stamp_variant_id = sv.id limit 1) sf on true
    where 1=1`;
  const params = [];
  if (productId) { params.push(productId); sql += ` and r.product_id = $${params.length}`; }
  sql += ' order by r.id desc';
  return (await db.query(sql, params)).rows;
}));

app.post('/api/recetas', wrap(async (req) => {
  const b = req.body;
  if (!b.product_id || !b.stamp_variant_id) throw new engine.StockError('product_id y stamp_variant_id son obligatorios', 'INVALID_INPUT');
  const r = await db.query(
    `insert into stamp_product_recipes (product_id, stamp_variant_id, cantidad_por_unidad, ubicacion_aplicacion,
       activo, confirmado, origen, observaciones, created_by)
     values ($1,$2,$3,$4,true,true,$5,$6,$7) returning id`,
    [b.product_id, b.stamp_variant_id, b.cantidad_por_unidad || 1, b.ubicacion_aplicacion || null,
     b.origen || 'manual', b.observaciones || null, b.usuario || null]
  );
  return { id: r.rows[0].id };
}));

app.put('/api/recetas/:id', wrap(async (req) => {
  const allowed = ['cantidad_por_unidad', 'ubicacion_aplicacion', 'activo', 'confirmado', 'observaciones', 'vigente_hasta'];
  const fields = allowed.filter(f => f in req.body);
  if (fields.length === 0) return { updated: false };
  const setSql = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
  await db.query(`update stamp_product_recipes set ${setSql}, updated_at = now() where id = $1`, [req.params.id, ...fields.map(f => req.body[f])]);
  return { updated: true };
}));

// Copiar receta(s) de un producto a VARIOS productos destino (talles/variantes)
app.post('/api/recetas/copiar', wrap(async (req) => {
  const { fromProductId, toProductIds } = req.body;
  const targets = Array.isArray(toProductIds) ? toProductIds : [req.body.toProductId].filter(Boolean);
  if (!targets.length) throw new engine.StockError('toProductIds (o toProductId) es obligatorio', 'INVALID_INPUT');
  const source = (await db.query('select * from stamp_product_recipes where product_id = $1 and activo = true', [fromProductId])).rows;
  let copiadas = 0;
  await db.transaction(async (tx) => {
    for (const toId of targets) {
      for (const r of source) {
        await tx.query(
          `insert into stamp_product_recipes (product_id, stamp_variant_id, cantidad_por_unidad, ubicacion_aplicacion, activo, confirmado, origen, observaciones)
           values ($1,$2,$3,$4,true,$5,'copiado_de_otra_variante',$6)
           on conflict (product_id, stamp_variant_id, ubicacion_aplicacion) where activo=true do nothing`,
          [toId, r.stamp_variant_id, r.cantidad_por_unidad, r.ubicacion_aplicacion, r.confirmado, r.observaciones]
        );
        copiadas++;
      }
    }
  });
  return { copiadas };
}));

app.get('/api/recetas/sugerencias/:productId', wrap(async (req) => {
  const producto = (await db.query('select * from stamp_products where id=$1', [req.params.productId])).rows[0];
  if (!producto) return [];
  return recipes.suggestStampsForProduct(db, producto.nombre);
}));

// ============================================================================
// MOVIMIENTOS
// ============================================================================
app.get('/api/movimientos', wrap(async (req) => {
  const { estampaId, pedidoId, tipo, limit } = req.query;
  let sql = `select m.*, sv.codigo as estampa_codigo, sv.nombre as estampa_nombre
             from stamp_movements m join stamp_variants sv on sv.id = m.stamp_variant_id where 1=1`;
  const params = [];
  if (estampaId) { params.push(estampaId); sql += ` and m.stamp_variant_id = $${params.length}`; }
  if (pedidoId) { params.push(pedidoId); sql += ` and m.pedido_id = $${params.length}`; }
  if (tipo) { params.push(tipo); sql += ` and m.tipo = $${params.length}`; }
  params.push(Number(limit) || 200);
  sql += ` order by m.id desc limit $${params.length}`;
  return (await db.query(sql, params)).rows;
}));

app.post('/api/movimientos/lote', wrap(async (req) => {
  const { items, usuario, motivo } = req.body;
  if (!usuario) throw new engine.StockError('usuario es obligatorio', 'INVALID_INPUT');
  if (!Array.isArray(items) || items.length === 0) throw new engine.StockError('items es obligatorio', 'INVALID_INPUT');

  const results = [];
  for (const item of items) {
    const rawCantidad = Number(item.cantidad);
    const cantidad = Math.abs(rawCantidad);
    const tipo = item.tipo || (rawCantidad >= 0 ? 'ingreso' : 'perdida');
    try {
      let variantId = item.stamp_variant_id || item.id || null;
      let codigo = item.codigo || null;
      if (!variantId && codigo) {
        const found = (await db.query('select id from stamp_variants where codigo = $1', [codigo])).rows[0];
        if (!found) { results.push({ codigo, ok: false, error: 'Codigo no encontrado' }); continue; }
        variantId = found.id;
      }
      if (!variantId || !Number.isInteger(cantidad) || cantidad <= 0) {
        results.push({ codigo: codigo || variantId || '', ok: false, error: 'Item invalido' });
        continue;
      }

      const variant = (await db.query('select codigo from stamp_variants where id=$1', [variantId])).rows[0];
      codigo = codigo || (variant && variant.codigo) || String(variantId);
      if (tipo === 'ingreso') {
        await engine.ingreso(db, { variantId, cantidad, usuario, motivo: motivo || 'Ingreso por lote', tipo: 'ingreso' });
      } else {
        await engine.salidaManual(db, { variantId, cantidad, usuario, motivo: motivo || 'Salida por lote', tipo: 'perdida' });
      }
      results.push({ codigo, ok: true });
    } catch (e) {
      results.push({ codigo: item.codigo || item.stamp_variant_id || '', ok: false, error: e.message });
    }
  }
  return { procesadas: results.length, exitosas: results.filter(r => r.ok).length, resultados: results };
}));

// ============================================================================
// CARGA INICIAL RAPIDA DE STOCK
// ============================================================================
app.get('/api/carga-inicial/pendientes', wrap(async (req) => {
  const { q } = req.query;
  let sql = `
    select sv.id, sv.codigo, sv.nombre, sv.variante, sv.categoria, sv.talle_tamano,
           si.cantidad_disponible, si.stock_minimo, si.pendiente_de_contar,
           sf.previsualizacion
    from stamp_variants sv
    join stamp_inventory si on si.stamp_variant_id = sv.id
    left join lateral (select previsualizacion from stamp_files where stamp_variant_id = sv.id limit 1) sf on true
    where si.pendiente_de_contar = true`;
  const params = [];
  if (q) { params.push(`%${q}%`); sql += ` and (sv.nombre ilike $${params.length} or sv.codigo ilike $${params.length})`; }
  sql += ` order by ${stampOrderSql('sv')}`;
  return (await db.query(sql, params)).rows;
}));

// Carga masiva por CSV (texto plano: codigo,cantidad,stock_minimo). Cada fila
// se procesa en SU PROPIA transaccion: una fila invalida no aborta el resto.
app.post('/api/carga-inicial/csv', wrap(async (req) => {
  const { csv, usuario } = req.body;
  if (!usuario) throw new engine.StockError('usuario es obligatorio', 'INVALID_INPUT');
  if (!csv) throw new engine.StockError('csv es obligatorio', 'INVALID_INPUT');
  const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const results = [];
  for (const line of lines) {
    const [codigo, cantidad, stockMinimo] = line.split(',').map(s => (s || '').trim());
    if (!codigo || codigo.toLowerCase() === 'codigo') continue; // ignora encabezado
    try {
      const variant = (await db.query('select id from stamp_variants where codigo = $1', [codigo])).rows[0];
      if (!variant) { results.push({ codigo, ok: false, error: 'Codigo no encontrado' }); continue; }
      if (stockMinimo) await db.query('update stamp_inventory set stock_minimo=$2 where stamp_variant_id=$1', [variant.id, Number(stockMinimo)]);
      await engine.correccionManual(db, {
        variantId: variant.id, cantidadNueva: Number(cantidad), usuario,
        motivo: 'Carga inicial masiva (CSV)', tipo: 'ajuste_inicial',
      });
      // mismo orden que en /api/carga-inicial/:id: minimo primero, correccion despues.
      results.push({ codigo, ok: true });
    } catch (e) {
      results.push({ codigo, ok: false, error: e.message });
    }
  }
  return { procesadas: results.length, exitosas: results.filter(r => r.ok).length, resultados: results };
}));

app.post('/api/carga-inicial/:id', wrap(async (req) => {
  const { cantidad, stock_minimo, usuario } = req.body;
  if (!usuario) throw new engine.StockError('usuario es obligatorio para la carga inicial', 'INVALID_INPUT');
  // stock_minimo se actualiza ANTES de la correccion: el estado (Disponible /
  // Stock bajo / Agotada) se recalcula dentro de correccionManual usando el
  // stock_minimo vigente en ese momento -- si se actualizara despues, un
  // stock_minimo nuevo mas alto no se reflejaria en el estado hasta el
  // proximo movimiento.
  if (stock_minimo != null) {
    await db.query('update stamp_inventory set stock_minimo=$2 where stamp_variant_id=$1', [req.params.id, Number(stock_minimo)]);
  }
  const result = await engine.correccionManual(db, {
    variantId: req.params.id, cantidadNueva: Number(cantidad), usuario,
    motivo: 'Carga inicial de stock', tipo: 'ajuste_inicial',
  });
  return result;
}));

app.post('/api/carga-inicial/:id/marcar-pendiente', wrap(async (req) => {
  await db.query('update stamp_inventory set pendiente_de_contar = true where stamp_variant_id = $1', [req.params.id]);
  return { ok: true };
}));



// ============================================================================
// API DE ESTAMPAS PARA incognito-ventas (contrato STAMPS_*, autenticado)
// ============================================================================
const stampsRouter = express.Router();
stampsRouter.use(requireStampsSecret);

stampsRouter.get('/estampas', wrap(async (req) => {
  const rows = (await db.query(`
    select sv.id, sv.codigo, sv.nombre, sv.estado, sv.categoria, sv.subcategoria, sv.marca_tematica, sv.talle_tamano,
           si.cantidad_disponible, si.stock_minimo
    from stamp_variants sv join stamp_inventory si on si.stamp_variant_id = sv.id
    order by ${stampOrderSql('sv')}
  `)).rows;
  return { ok: true, estampas: rows };
}));

stampsRouter.get('/recetas', wrap(async (req) => {
  const { sku } = req.query;
  if (!sku) throw new engine.StockError('sku es requerido', 'INVALID_INPUT');
  const product = await recipes.findProductBySku(db, sku);
  if (!product) return { ok: true, recetas: [], producto_encontrado: false };
  const rows = await recipes.getActiveRecipesForProduct(db, product.id);
  return { ok: true, recetas: rows, producto_encontrado: true };
}));

async function handleTransicion(req, res) {
  const pedidoId = req.params.pedidoId;
  const { evento, items, usuario } = req.body;
  if (!evento) throw new engine.StockError('evento es obligatorio', 'INVALID_INPUT');

  let consumos = [], sinReceta = [];
  if (evento === 'preparacion_a_armado' || evento === 'modificacion') {
    if (!Array.isArray(items)) throw new engine.StockError('items es obligatorio para este evento', 'INVALID_INPUT');
    const resolved = await recipes.resolveConsumptionForOrderItems(db, items);
    consumos = resolved.consumos;
    sinReceta = resolved.sinReceta;

    if (evento === 'modificacion') {
      // El pedido puede llegar con MENOS lineas que antes (se saco un
      // producto del todo, no solo se bajo la cantidad a 0). El caller no
      // tiene forma de "avisar" que una linea desaparecio si ya no esta en
      // items -- asi que el motor la detecta solo: cualquier
      // (pedido_item_ref, stamp_variant_id) que ya tenga consumo aplicado en
      // stamp_processed_events pero NO aparezca en los consumos recien
      // resueltos se agrega con cantidadRequerida=0, generando el reintegro
      // correspondiente. Esto es lo que hace que "sacar un producto del
      // pedido" reintegre sus estampas aunque el frontend solo mande la
      // lista de items que quedan.
      const yaAplicados = (await db.query(
        `select pedido_item_ref, stamp_variant_id, sku from stamp_processed_events where pedido_id=$1 and cantidad_aplicada > 0`,
        [pedidoId]
      )).rows;
      const presentes = new Set(consumos.map(c => `${c.itemRef}::${c.stampVariantId}`));
      for (const a of yaAplicados) {
        const key = `${a.pedido_item_ref}::${a.stamp_variant_id}`;
        if (!presentes.has(key)) {
          consumos.push({ itemRef: a.pedido_item_ref, sku: a.sku, stampVariantId: a.stamp_variant_id, cantidadRequerida: 0 });
        }
      }
    }
  } else if (evento === 'armado_a_preparacion' || evento === 'cancelacion') {
    const aplicados = (await db.query('select * from stamp_processed_events where pedido_id=$1', [pedidoId])).rows;
    consumos = aplicados.map(a => ({ itemRef: a.pedido_item_ref, sku: a.sku, stampVariantId: a.stamp_variant_id, cantidadRequerida: 0 }));
  } else {
    throw new engine.StockError(`Evento desconocido: ${evento}`, 'INVALID_INPUT');
  }

  const { resultados, advertencias } = await engine.reconcileOrderConsumption(db, { pedidoId, evento, consumos, usuario });
  const todasAdvertencias = [...advertencias, ...sinReceta];
  return {
    ok: todasAdvertencias.length === 0,
    pedidoId, evento, resultados, advertencias: todasAdvertencias,
  };
}

stampsRouter.post('/pedidos/:pedidoId/transicion', wrap(handleTransicion));
// alias explicitos pedidos por la consigna (mismo motor, evento fijo)
stampsRouter.post('/pedidos/:pedidoId/descontar', wrap((req) => { req.body.evento = 'preparacion_a_armado'; return handleTransicion(req); }));
stampsRouter.post('/pedidos/:pedidoId/reintegrar', wrap((req) => { req.body.evento = 'armado_a_preparacion'; return handleTransicion(req); }));
stampsRouter.post('/pedidos/:pedidoId/reconciliar', wrap((req) => { req.body.evento = 'modificacion'; return handleTransicion(req); }));

stampsRouter.get('/pedidos/:pedidoId/resultado', wrap(async (req) => {
  const consumos = (await db.query('select * from stamp_processed_events where pedido_id=$1', [req.params.pedidoId])).rows;
  const log = (await db.query('select * from stamp_order_transition_log where pedido_id=$1 order by id desc', [req.params.pedidoId])).rows;
  return { ok: true, consumos, log };
}));

stampsRouter.get('/productos/sin-receta', wrap(async () => {
  const rows = (await db.query(`
    select p.sku, p.nombre from stamp_products p
    where p.activo = true and not exists (select 1 from stamp_product_recipes r where r.product_id=p.id and r.activo=true and r.confirmado=true)
  `)).rows;
  return { ok: true, productos: rows };
}));

stampsRouter.post('/produccion/ingreso', wrap(async (req) => {
  const { orderItemId, cantidadRecibida, usuario } = req.body;
  if (!orderItemId || !cantidadRecibida) throw new engine.StockError('orderItemId y cantidadRecibida son obligatorios', 'INVALID_INPUT');
  const result = await engine.recibirProduccionItem(db, { orderItemId, cantidadRecibida, usuario: usuario || 'incognito-ventas' });
  return { ok: true, ...result };
}));

app.use('/api/stamps/v1', stampsRouter);

// ============================================================================
// PRODUCCION / REPOSICION (panel interno)
// ============================================================================
app.get('/api/produccion', wrap(async (req) => {
  const { estado, estado_activo } = req.query;
  let sql = `
    select po.id, po.estado, po.notas, po.creado_por, po.created_at, po.updated_at,
           json_agg(json_build_object(
             'id', poi.id, 'stamp_variant_id', poi.stamp_variant_id, 'cantidad_necesaria', poi.cantidad_necesaria,
             'cantidad_recibida', poi.cantidad_recibida, 'codigo', sv.codigo, 'nombre', sv.nombre,
             'categoria', sv.categoria, 'talle_tamano', sv.talle_tamano, 'variante', sv.variante,
             'previsualizacion', sf.previsualizacion
           )) as items
    from stamp_production_orders po
    join stamp_production_order_items poi on poi.production_order_id = po.id
    join stamp_variants sv on sv.id = poi.stamp_variant_id
    left join lateral (select previsualizacion from stamp_files where stamp_variant_id = sv.id limit 1) sf on true
    where 1=1`;
  const params = [];
  if (estado) { params.push(estado); sql += ` and po.estado = $${params.length}`; }
  if (estado_activo) sql += ` and po.estado <> 'Cancelado'`;
  sql += ' group by po.id order by po.id desc';
  return (await db.query(sql, params)).rows;
}));

async function getProductionOrderItems(orderId) {
  const order = (await db.query('select * from stamp_production_orders where id=$1', [orderId])).rows[0];
  if (!order) return null;
  const items = (await db.query(`
    select poi.id as item_id, poi.cantidad_necesaria, poi.cantidad_recibida,
           sv.id as stamp_variant_id, sv.codigo, sv.nombre, sv.variante, sv.categoria, sv.talle_tamano,
           si.cantidad_disponible, sf.previsualizacion
    from stamp_production_order_items poi
    join stamp_variants sv on sv.id = poi.stamp_variant_id
    join stamp_inventory si on si.stamp_variant_id = sv.id
    left join lateral (select previsualizacion from stamp_files where stamp_variant_id=sv.id limit 1) sf on true
    where poi.production_order_id=$1
    order by case when sv.categoria = 'Talles' then 1 else 0 end, ${stampOrderSql('sv')}
  `, [orderId])).rows;
  return { order, items };
}

function htmlEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function getActiveProductionPendingMap() {
  const rows = (await db.query(`
    select poi.stamp_variant_id,
           sum(greatest(poi.cantidad_necesaria - coalesce(poi.cantidad_recibida, 0), 0))::int as pendiente
    from stamp_production_order_items poi
    join stamp_production_orders po on po.id = poi.production_order_id
    where po.estado not in ('Recibido', 'Cancelado')
    group by poi.stamp_variant_id
  `)).rows;
  return new Map(rows.map((r) => [String(r.stamp_variant_id), Number(r.pendiente) || 0]));
}

async function getStockProductionSuggestions({ includeCovered = false } = {}) {
  const pendingMap = await getActiveProductionPendingMap();
  const rows = (await db.query(`
    select sv.id, sv.codigo, sv.nombre, sv.variante, sv.categoria, sv.talle_tamano,
           si.cantidad_disponible, si.stock_minimo, sf.previsualizacion
    from stamp_variants sv
    join stamp_inventory si on si.stamp_variant_id = sv.id
    left join lateral (select previsualizacion from stamp_files where stamp_variant_id=sv.id limit 1) sf on true
    where sv.estado in ('Stock bajo','Agotada')
    order by ${stampOrderSql('sv')}
  `)).rows;
  return rows.map((r) => {
    const minimo = Number(r.stock_minimo) || 0;
    const sugerida = Math.max(minimo - (r.cantidad_disponible || 0), 0);
    const yaPedido = pendingMap.get(String(r.id)) || 0;
    return { ...r, faltante_stock: sugerida, cantidad_sugerida: Math.max(sugerida - yaPedido, 0), ya_pedido: yaPedido, fuente: 'stock' };
  }).filter((r) => includeCovered ? r.faltante_stock > 0 : r.cantidad_sugerida > 0);
}

function normalizeVentasPendingItems(data) {
  const rawItems = Array.isArray(data) ? data : (data.items || data.pendientes || data.estampas || []);
  return rawItems.map((item) => ({
    sku: item.sku || item.codigo || item.estampa_codigo || item.stampCode || '',
    codigo: item.codigo || item.estampa_codigo || item.stampCode || '',
    nombre: item.nombre || item.name || item.titulo || item.title || '',
    talle: item.talle || item.size || item.variant_size || '',
    color: item.color || '',
    cantidad: Number(item.cantidad || item.cantidad_necesaria || item.quantity || item.qty || 0),
    itemRef: item.itemRef || item.item_ref || item.pedido_item_ref || [item.pedidoId || item.pedido_id, item.sku, item.talle].filter(Boolean).join(':'),
  })).filter((item) => (item.sku || item.codigo) && item.cantidad > 0);
}

async function refreshVentasPendingCache(url) {
  if (ventasPendingRefreshPromise) return ventasPendingRefreshPromise;
  ventasPendingRefreshPromise = (async () => {
    const resp = await withTimeout(fetch(url, {
      headers: { 'x-stamps-api-secret': STAMPS_API_SECRET || APP_PASSWORD },
    }), VENTAS_PENDING_TIMEOUT_MS, 'incognito-ventas');
    if (!resp.ok) throw new Error(`incognito-ventas respondio HTTP ${resp.status}`);
    const data = await withTimeout(resp.json(), VENTAS_PENDING_TIMEOUT_MS, 'JSON de incognito-ventas');
    const incoming = normalizeVentasPendingItems(data);
    const consumos = await recipes.resolveConsumptionForOrderItems(db, incoming);
    const byVariant = new Map();
    for (const item of consumos.consumos) {
      byVariant.set(String(item.stampVariantId), (byVariant.get(String(item.stampVariantId)) || 0) + Number(item.cantidadRequerida || 0));
    }
    const resolved = { byVariant: Array.from(byVariant.entries()), sinResolver: consumos.sinReceta.length, refreshedAt: new Date().toISOString() };
    ventasPendingCache = { ts: Date.now(), url, data: resolved, error: null };
    return resolved;
  })().catch((e) => {
    ventasPendingCache.error = e.message;
    throw e;
  }).finally(() => {
    ventasPendingRefreshPromise = null;
  });
  return ventasPendingRefreshPromise;
}

async function getVentasProductionSuggestions() {
  const url = process.env.VENTAS_PENDING_STAMPS_URL || 'https://incognito-ventas.onrender.com/api/stamps/pending-print';
  if (!url) {
    return {
      configurado: false,
      nota: 'VENTAS_PENDING_STAMPS_URL no esta configurada. Cuando incognito-ventas exponga pendientes, este boton ya va a poder consumirlos.',
      items: [],
    };
  }

  const cacheAge = ventasPendingCache.url === url && ventasPendingCache.data ? Date.now() - ventasPendingCache.ts : Infinity;
  let resolved = cacheAge < VENTAS_PENDING_CACHE_MS ? ventasPendingCache.data : null;
  let cacheNote = null;
  if (!resolved) {
    if (cacheAge < VENTAS_PENDING_STALE_MS) {
      resolved = ventasPendingCache.data;
      cacheNote = 'Mostrando la ultima consulta disponible mientras ventas se actualiza en segundo plano.';
      refreshVentasPendingCache(url).catch((e) => console.warn('[ventas-pending-refresh]', e.message));
    } else {
      try {
        resolved = await refreshVentasPendingCache(url);
      } catch (e) {
        return {
          configurado: true,
          nota: `No pude consultar ventas rapido: ${e.message}. Proba de nuevo en unos segundos.`,
          items: [],
        };
      }
    }
  }

  const pendingMap = await getActiveProductionPendingMap();
  const variantEntries = resolved.byVariant || [];
  const variantIds = variantEntries.map(([variantId]) => Number(variantId)).filter(Number.isFinite);
  if (variantIds.length === 0) {
    const nota = resolved.sinResolver > 0
      ? `${resolved.sinResolver} item(s) de ventas no tienen codigo de estampa reconocible.`
      : cacheNote;
    return { configurado: true, nota, items: [] };
  }
  const placeholders = variantIds.map((_, idx) => `$${idx + 1}`).join(',');
  const rows = (await db.query(`
    select sv.id, sv.codigo, sv.nombre, sv.variante, sv.categoria, sv.talle_tamano,
           si.cantidad_disponible, si.stock_minimo, sf.previsualizacion
    from stamp_variants sv
    join stamp_inventory si on si.stamp_variant_id = sv.id
    left join lateral (select previsualizacion from stamp_files where stamp_variant_id=sv.id limit 1) sf on true
    where sv.id in (${placeholders})
    order by ${stampOrderSql('sv')}
  `, variantIds)).rows;
  const rowsById = new Map(rows.map((row) => [String(row.id), row]));
  const result = [];
  for (const [variantId, cantidad] of variantEntries) {
    const row = rowsById.get(String(variantId));
    if (!row) continue;
    const yaPedido = pendingMap.get(String(row.id)) || 0;
    const cantidadSugerida = Math.max(cantidad - yaPedido, 0);
    if (cantidadSugerida > 0) {
      result.push({ ...row, cantidad_sugerida: cantidadSugerida, ya_pedido: yaPedido, fuente: 'ventas' });
    }
  }
  result.sort((a, b) => variantIds.indexOf(Number(a.id)) - variantIds.indexOf(Number(b.id)));
  const sinResolver = resolved.sinResolver;
  const nota = sinResolver > 0
    ? `${sinResolver} item(s) de ventas no tienen codigo de estampa reconocible; igual se incluyen los talles detectados.`
    : cacheNote;
  return { configurado: true, nota, items: result };
}

app.get('/api/produccion/sugerencias', wrap(async (req) => {
  const fuente = req.query.fuente || 'stock';
  if (fuente === 'stock') return { fuente, items: await getStockProductionSuggestions({ includeCovered: req.query.incluir_cubiertas === '1' }), nota: null };
  if (fuente === 'ventas') {
    const ventas = await getVentasProductionSuggestions();
    return { fuente, items: ventas.items, nota: ventas.nota, configurado: ventas.configurado };
  }
  if (fuente === 'ambas') {
    const [stock, ventas] = await Promise.all([
      getStockProductionSuggestions(),
      getVentasProductionSuggestions(),
    ]);
    const merged = new Map();
    for (const item of [...stock, ...ventas.items]) {
      const current = merged.get(String(item.id));
      if (!current) merged.set(String(item.id), { ...item, fuente: item.fuente });
      else {
        current.cantidad_sugerida += item.cantidad_sugerida;
        current.fuente = current.fuente === item.fuente ? current.fuente : 'stock+ventas';
      }
    }
    return { fuente, items: Array.from(merged.values()), nota: ventas.nota, configurado_ventas: ventas.configurado };
  }
  throw new engine.StockError('Fuente invalida', 'INVALID_INPUT');
}));

app.get('/api/produccion/:id/pedido.html', async (req, res) => {
  const data = await getProductionOrderItems(req.params.id);
  if (!data) return res.status(404).send('Orden no encontrada');
  const rows = data.items.map((it) => `
    <tr>
      <td>${it.categoria === 'Talles' && !it.previsualizacion
        ? `<div class="sizeimg">${htmlEsc(it.talle_tamano || it.variante || it.codigo)}</div>`
        : `<img src="/${htmlEsc(it.previsualizacion || '')}" onerror="this.style.display='none'">`}</td>
      <td><strong>${htmlEsc(it.codigo)}</strong><br><span>${htmlEsc(it.nombre)}</span><br><small>${htmlEsc(it.variante || '')}</small></td>
      <td><span class="qty">${it.cantidad_necesaria}</span></td>
      <td>${it.cantidad_disponible ?? 'pendiente'}</td>
    </tr>
  `).join('');
  const csv = ['codigo,cantidad', ...data.items.map((it) => `${it.codigo},${it.cantidad_necesaria}`)].join('\n');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Pedido DTF #${data.order.id}</title>
<style>
body{font-family:Arial,sans-serif;margin:24px;color:#111} h1{margin:0 0 4px} .sub{color:#555;margin-bottom:20px}
table{width:100%;border-collapse:collapse} th,td{border-bottom:1px solid #ddd;padding:10px;text-align:left;vertical-align:middle}
img{width:120px;height:120px;object-fit:contain;background:#fff;border:1px solid #ddd;border-radius:6px}
.sizeimg{width:120px;height:120px;display:flex;align-items:center;justify-content:center;background:#111827;color:#fff;border-radius:6px;font-size:34px;font-weight:800}
.qty{display:inline-flex;align-items:center;justify-content:center;min-width:84px;padding:10px 14px;border-radius:10px;background:#ffcc00;color:#111;font-size:38px;font-weight:800}
textarea{width:100%;height:120px;margin-top:18px;font-family:Consolas,monospace}.print{margin-bottom:18px}@media print{.print,textarea,h2.csv{display:none}}
</style></head><body>
<button class="print" onclick="window.print()">Imprimir</button>
<h1>Pedido DTF #${data.order.id}</h1>
<div class="sub">Generado desde Stock DTF - ${new Date().toLocaleString('es-AR')}</div>
<table><thead><tr><th>Imagen</th><th>Estampa</th><th>Cantidad</th><th>Stock actual</th></tr></thead><tbody>${rows}</tbody></table>
<h2 class="csv">Codigo para ingresar stock</h2>
<textarea readonly>${htmlEsc(csv)}</textarea>
</body></html>`);
});

app.get('/api/produccion/:id/pedido.csv', async (req, res) => {
  const data = await getProductionOrderItems(req.params.id);
  if (!data) return res.status(404).send('Orden no encontrada');
  const csv = ['codigo,cantidad'].concat(data.items.map((it) => `"${String(it.codigo).replace(/"/g, '""')}",${it.cantidad_necesaria}`)).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="pedido-dtf-${data.order.id}.csv"`);
  res.send(csv);
});
app.post('/api/produccion', wrap(async (req) => {
  const { items, notas, usuario } = req.body; // items: [{stamp_variant_id, cantidad_necesaria}]
  if (!Array.isArray(items) || items.length === 0) throw new engine.StockError('items es obligatorio', 'INVALID_INPUT');
  return db.transaction(async (tx) => {
    const r = await tx.query('insert into stamp_production_orders (notas, creado_por) values ($1,$2) returning id', [notas || null, usuario || null]);
    const orderId = r.rows[0].id;
    for (const it of items) {
      await tx.query('insert into stamp_production_order_items (production_order_id, stamp_variant_id, cantidad_necesaria) values ($1,$2,$3)',
        [orderId, it.stamp_variant_id, it.cantidad_necesaria]);
    }
    return { id: orderId };
  });
}));
app.put('/api/produccion/:id/estado', wrap(async (req) => {
  const { estado } = req.body;
  const validos = ['Pendiente', 'Preparando archivo', 'Enviado a imprimir', 'Impreso', 'Cancelado'];
  if (!validos.includes(estado)) throw new engine.StockError('Estado invalido (usar el endpoint de recepcion para "Recibido")', 'INVALID_INPUT');
  await db.query(`update stamp_production_orders set estado=$1, updated_at=now() where id=$2`, [estado, req.params.id]);
  return { ok: true };
}));
app.delete('/api/produccion/:id', wrap(async (req) => {
  const order = (await db.query('select id, estado from stamp_production_orders where id=$1', [req.params.id])).rows[0];
  if (!order) throw new engine.StockError('Orden de produccion no encontrada', 'NOT_FOUND');
  await db.query(`update stamp_production_orders set estado='Cancelado', updated_at=now() where id=$1`, [req.params.id]);
  return { ok: true };
}));
app.post('/api/produccion/items/:itemId/recibir', wrap(async (req) => {
  const { cantidad_recibida, usuario } = req.body;
  return engine.recibirProduccionItem(db, { orderItemId: req.params.itemId, cantidadRecibida: Number(cantidad_recibida), usuario });
}));

// ============================================================================
// PENDIENTES
// ============================================================================
app.get('/api/pendientes', wrap(async () => (await db.query(`select * from stamp_pending_reviews where resuelto=false and tipo='archivo' order by id desc`)).rows));
app.post('/api/pendientes/:id/resolver', wrap(async (req) => {
  await db.query(`update stamp_pending_reviews set resuelto=true, resolved_at=now() where id=$1`, [req.params.id]);
  return { ok: true };
}));
app.get('/api/duplicados', wrap(async () => (await db.query(`
  select pr.*, a.codigo as codigo_a, a.nombre as nombre_a, sfa.previsualizacion as preview_a,
         b.codigo as codigo_b, b.nombre as nombre_b, sfb.previsualizacion as preview_b
  from stamp_pending_reviews pr
  join stamp_variants a on a.id = pr.stamp_variant_id
  join stamp_variants b on b.id = pr.related_variant_id
  left join lateral (select previsualizacion from stamp_files where stamp_variant_id=a.id limit 1) sfa on true
  left join lateral (select previsualizacion from stamp_files where stamp_variant_id=b.id limit 1) sfb on true
  where pr.tipo='posible_duplicado' and pr.resuelto=false
`)).rows));
app.post('/api/duplicados/:id/resolver', wrap(async (req) => {
  const { resolucion } = req.body;
  await db.query(`update stamp_pending_reviews set resuelto=true, resolucion=$2, resolved_at=now() where id=$1`, [req.params.id, resolucion || 'revisado']);
  return { ok: true };
}));

// ============================================================================
// CONCILIACION
// ============================================================================
app.get('/api/conciliacion/resumen', wrap(async () => {
  const sinReceta = (await db.query(`
    select p.sku, p.nombre from stamp_products p
    where p.activo=true and not exists (select 1 from stamp_product_recipes r where r.product_id=p.id and r.activo=true and r.confirmado=true)
  `)).rows;
  const stockNegativo = (await db.query(`
    select sv.codigo, sv.nombre, si.cantidad_disponible from stamp_inventory si
    join stamp_variants sv on sv.id = si.stamp_variant_id where si.cantidad_disponible < 0
  `)).rows;
  const eventosFallidos = (await db.query(`select * from stamp_order_transition_log where resultado='error' order by id desc limit 50`)).rows;
  const eventosConAdvertencia = (await db.query(`select * from stamp_order_transition_log where resultado='advertencia' order by id desc limit 50`)).rows;
  const consumoPorPedido = (await db.query(`
    select pedido_id, count(*)::int lineas, sum(cantidad_aplicada)::int total_aplicado, max(updated_at) ultima_actualizacion
    from stamp_processed_events where cantidad_aplicada > 0 group by pedido_id order by ultima_actualizacion desc limit 100
  `)).rows;

  let ventasComparacion = null;
  const ventasUrl = process.env.VENTAS_ORDERS_SUMMARY_URL || '';
  if (ventasUrl) {
    try {
      const resp = await fetch(ventasUrl, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) ventasComparacion = await resp.json();
    } catch (e) {
      ventasComparacion = { error: `No se pudo contactar a incognito-ventas: ${e.message}` };
    }
  }

  return {
    productos_sin_receta: sinReceta,
    stock_negativo: stockNegativo,
    eventos_fallidos: eventosFallidos,
    eventos_con_advertencia: eventosConAdvertencia,
    consumo_por_pedido: consumoPorPedido,
    comparacion_con_ventas: ventasComparacion,
    nota: ventasUrl ? null : 'VENTAS_ORDERS_SUMMARY_URL no esta configurada -- no se puede comparar automaticamente contra el estado real de pedidos en incognito-ventas. Ver docs/CONCILIACION.md.',
  };
}));

app.post('/api/conciliacion/reintentar/:pedidoId', wrap(async (req) => {
  const { evento, items, usuario } = req.body;
  req.params.pedidoId = req.params.pedidoId;
  req.body = { evento, items, usuario };
  return handleTransicion(req);
}));

// ============================================================================
// SINCRONIZACION DE LA CARPETA DE ORIGEN
// ============================================================================
const SOURCE_DIR = process.env.SOURCE_DIR || path.join(__dirname, '..', '..', '3-vectorizada');
const SYNC_CHECK_PY = path.join(__dirname, '..', '..', 'scripts', 'sync_check.py');
const PROJECT_ROOT = path.join(__dirname, '..', '..');

app.post('/api/sync/check', wrap(async () => {
  execFileSync('python3', [SYNC_CHECK_PY, SOURCE_DIR, PROJECT_ROOT], { stdio: 'pipe' });
  return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'sync_summary.json'), 'utf-8'));
}));
app.post('/api/sync/apply', wrap(async () => {
  const out = execFileSync('node', [path.join(__dirname, '..', 'db', 'apply_sync.js')], { stdio: 'pipe' }).toString();
  return { ok: true, log: out };
}));
app.get('/api/sync/historial', wrap(async () => (await db.query('select * from stamp_sync_runs order by id desc limit 20')).rows));

// ============================================================================
// EXPORTACION
// ============================================================================
async function buildBackupSnapshot() {
  const tables = [
    ['stamp_designs', 'id'],
    ['stamp_variants', 'codigo'],
    ['stamp_files', 'id'],
    ['stamp_inventory', 'stamp_variant_id'],
    ['stamp_products', 'id'],
    ['stamp_product_recipes', 'id'],
    ['stamp_movements', 'id'],
    ['stamp_processed_events', 'id'],
    ['stamp_order_transition_log', 'id'],
    ['stamp_production_orders', 'id'],
    ['stamp_production_order_items', 'id'],
    ['stamp_pending_reviews', 'id'],
    ['stamp_sync_runs', 'id'],
  ];
  const data = {};
  for (const [table, orderCol] of tables) {
    data[table] = (await db.query(`select * from ${table} order by ${orderCol}`)).rows;
  }
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    db: db.kind,
    counts: Object.fromEntries(Object.entries(data).map(([table, rows]) => [table, rows.length])),
    data,
  };
}

app.get('/api/export/backup.json', async (req, res) => {
  const snapshot = await buildBackupSnapshot();
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="stock-dtf-backup-${date}.json"`);
  res.send(JSON.stringify(snapshot, null, 2));
});

app.get('/api/export/estampas.csv', async (req, res) => {
  const rows = (await db.query(`
    select sv.*, si.cantidad_disponible, si.stock_minimo, sf.archivo_original, sf.previsualizacion
    from stamp_variants sv
    join stamp_inventory si on si.stamp_variant_id = sv.id
    left join lateral (select archivo_original, previsualizacion from stamp_files where stamp_variant_id=sv.id limit 1) sf on true
    order by ${stampOrderSql('sv')}
  `)).rows;
  const cols = Object.keys(rows[0] || { id: '' });
  const csv = [cols.join(',')].concat(rows.map(r => cols.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="estampas.csv"');
  res.send(csv);
});

app.post('/api/admin/reset-carga-inicial', wrap(async (req) => {
  const { usuario, confirmacion } = req.body || {};
  if (!usuario) throw new engine.StockError('usuario es obligatorio', 'INVALID_INPUT');
  if (confirmacion !== 'RESET_STOCK_DTF') throw new engine.StockError('Confirmacion invalida', 'INVALID_INPUT');
  return db.transaction(async (tx) => {
    const before = (await tx.query(`
      select count(*)::int as estampas,
             coalesce(sum(coalesce(cantidad_disponible, 0)), 0)::int as stock_total,
             coalesce(sum(coalesce(stock_minimo, 0)), 0)::int as minimos_total
      from stamp_inventory
    `)).rows[0];
    await tx.query(`
      update stamp_inventory
      set cantidad_disponible = 0,
          stock_minimo = 0,
          pendiente_de_contar = true,
          contado_en = null,
          contado_por = null,
          updated_at = now()
    `);
    await tx.query(`
      update stamp_variants
      set estado = 'Agotada',
          updated_at = now()
      where estado <> 'Discontinuada'
    `);
    const after = (await tx.query(`
      select count(*)::int as estampas,
             coalesce(sum(coalesce(cantidad_disponible, 0)), 0)::int as stock_total,
             coalesce(sum(coalesce(stock_minimo, 0)), 0)::int as minimos_total,
             sum(case when pendiente_de_contar then 1 else 0 end)::int as pendientes_de_contar
      from stamp_inventory
    `)).rows[0];
    return { ok: true, before, after, usuario };
  });
}));

// ============================================================================
async function start() {
  db = getDb();
  await ensureSchema();
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`Stock de estampas DTF (${db.kind}) escuchando en puerto ${PORT}`);
    if (STAMPS_API_SECRET || APP_PASSWORD) {
      const ventasUrl = process.env.VENTAS_PENDING_STAMPS_URL || 'https://incognito-ventas.onrender.com/api/stamps/pending-print';
      refreshVentasPendingCache(ventasUrl).catch((e) => console.warn('[ventas-pending-warmup]', e.message));
    }
  });
}

if (require.main === module) {
  start();
} else {
  db = getDb();
}

module.exports = app;
module.exports.start = start;
