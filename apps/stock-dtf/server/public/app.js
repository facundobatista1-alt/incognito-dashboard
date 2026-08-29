'use strict';

// ============================================================================
// Helpers generales
// ============================================================================
let CURRENT_USER = localStorage.getItem('stockdtf_user') || 'MV';
if (!['MV', 'FB'].includes(CURRENT_USER)) {
  CURRENT_USER = 'MV';
  localStorage.setItem('stockdtf_user', CURRENT_USER);
}
const CURRENT_THEME = localStorage.getItem('stockdtf_theme') || 'light';
document.body.dataset.theme = CURRENT_THEME;

const API_CACHE = new Map();
const API_CACHE_MS = 20000;

async function api(path, opts = {}) {
  const method = opts.method || 'GET';
  const cacheKey = method === 'GET' ? path : '';
  const cached = cacheKey ? API_CACHE.get(cacheKey) : null;
  if (cached && Date.now() - cached.ts < API_CACHE_MS) return cached.data;

  const res = await fetch('api' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* sin body */ }
  if (!res.ok) {
    const msg = (data && data.error) || `Error HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (cacheKey) API_CACHE.set(cacheKey, { ts: Date.now(), data });
  else API_CACHE.clear();
  return data;
}

function toast(msg, type = 'ok') {
  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'err' ? 'err' : 'ok');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function badgeClass(estado) {
  return 'badge ' + String(estado || '').replace(/\s+/g, '');
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch (e) { return iso; }
}

function money(n) {
  return Number(n || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
}

function previewUrl(rel) {
  if (!rel) return '';
  return rel.replace(/\\/g, '/');
}

function isSizeStamp(row) {
  return row && row.categoria === 'Talles';
}

function stampThumbHtml(row, cls = 'thumb') {
  if (isSizeStamp(row) && !row.previsualizacion) {
    return `<span class="size-thumb ${cls === 'gallery' ? 'gallery-size' : ''}">${esc(row.talle_tamano || row.variante || row.codigo)}</span>`;
  }
  return `<img class="${cls === 'gallery' ? '' : cls}" src="${previewUrl(row.previsualizacion)}" onerror="this.style.visibility='hidden'">`;
}

function typeChipHtml(row) {
  return isSizeStamp(row) ? '<span class="type-chip">Talle</span>' : '';
}

function loadingHtml(text = 'Cargando...') {
  return `<div class="loading"><span class="spinner" aria-hidden="true"></span><span>${esc(text)}</span></div>`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No pude leer la imagen'));
    reader.readAsDataURL(file);
  });
}

function userSelectHtml(name = 'usuario') {
  return `<select name="${name}">
    <option value="MV" ${CURRENT_USER === 'MV' ? 'selected' : ''}>MV</option>
    <option value="FB" ${CURRENT_USER === 'FB' ? 'selected' : ''}>FB</option>
  </select>`;
}

function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

function openModal(html) {
  document.getElementById('modal-root').innerHTML = `<div class="modal-backdrop" onclick="if(event.target===this) closeModal()"><div class="modal">${html}</div></div>`;
}

// ============================================================================
// Router
// ============================================================================
const ROUTES = {
  dashboard: renderDashboard,
  inventario: renderInventario,
  recetas: renderRecetas,
  movimientos: renderMovimientos,
  produccion: renderProduccion,
  'carga-inicial': renderCargaInicial,
  conciliacion: renderConciliacion,
  pendientes: renderPendientes,
};

function navigate(route) {
  if (!ROUTES[route]) route = 'dashboard';
  location.hash = '#' + route;
}

async function router() {
  const route = (location.hash || '#dashboard').replace('#', '');
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.route === route);
  });
  const view = document.getElementById('view');
  view.innerHTML = loadingHtml('Cargando vista...');
  try {
    await (ROUTES[route] || renderDashboard)(view);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="panel"><div class="empty">Error cargando la vista: ${esc(e.message)}</div></div>`;
  }
  refreshPendientesBadge();
}

async function refreshPendientesBadge() {
  try {
    const pend = await api('/pendientes');
    const badge = document.getElementById('badge-pendientes');
    if (!badge) return;
    if (pend.length > 0) { badge.textContent = pend.length; badge.classList.add('show'); }
    else { badge.classList.remove('show'); }
  } catch (e) { /* silencioso */ }
}

window.addEventListener('hashchange', router);
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.route));
  });
  const themeSelect = document.getElementById('theme-select');
  if (themeSelect) {
    themeSelect.value = document.body.dataset.theme;
    themeSelect.addEventListener('change', () => {
      document.body.dataset.theme = themeSelect.value;
      localStorage.setItem('stockdtf_theme', themeSelect.value);
    });
  }
  const userSelect = document.getElementById('user-select');
  if (userSelect) {
    userSelect.value = CURRENT_USER;
    userSelect.addEventListener('change', () => {
      CURRENT_USER = userSelect.value;
      localStorage.setItem('stockdtf_user', CURRENT_USER);
    });
  }
  router();
});

// ============================================================================
// DASHBOARD
// ============================================================================
async function renderDashboard(view) {
  const d = await api('/dashboard');
  const t = d.totales;
  view.innerHTML = `
    <div class="topbar">
      <div><h1>📊 Dashboard</h1><div class="sub">Vista general del stock de estampas DTF</div></div>
      <button onclick="window.open('api/export/backup.json')">Backup</button>
    </div>
    <div class="cards">
      <div class="card"><div class="num">${t.total_variantes}</div><div class="label">Variantes de estampa</div></div>
      <div class="card"><div class="num">${t.disenos}</div><div class="label">Diseños distintos</div></div>
      <div class="card ok"><div class="num">${t.total_unidades ?? 0}</div><div class="label">Unidades disponibles</div></div>
      <div class="card warn"><div class="num">${t.stock_bajo || 0}</div><div class="label">Stock bajo</div></div>
      <div class="card danger"><div class="num">${t.agotadas || 0}</div><div class="label">Agotadas</div></div>
      <div class="card"><div class="num">${t.pendientes_revision || 0}</div><div class="label">Pendientes de revisión</div></div>
      <div class="card"><div class="num">${t.archivos_pendientes || 0}</div><div class="label">Archivos pendientes</div></div>
      <div class="card"><div class="num">${d.consumo_periodo_30d || 0}</div><div class="label">Consumo últimos 30 días</div></div>
    </div>

    <div class="panel">
      <div class="panel-title"><h2>Valor estimado en estampas</h2></div>
      <div class="toolbar">
        <label>Costo plancha<input id="val-costo" type="number" min="1" step="1" value="${localStorage.getItem('stockdtf_val_costo') || 10500}" style="width:130px"></label>
        <label>Ancho plancha cm<input id="val-ancho" type="number" min="1" step="0.1" value="${localStorage.getItem('stockdtf_val_ancho') || 58}" style="width:130px"></label>
        <label>Alto plancha cm<input id="val-alto" type="number" min="1" step="0.1" value="${localStorage.getItem('stockdtf_val_alto') || 100}" style="width:130px"></label>
        <button class="primary" onclick="loadValuacionStock()">Calcular</button>
      </div>
      <div class="notice">ℹ️ El ancho/alto en <b>px</b> es la resolución del archivo de imagen, no el tamaño físico de la estampa — nunca se usa para valuar. Solo cuentan como medida real el ancho/alto cargado en <b>cm</b>, una medida manual cargada a mano, o un formato estándar de medida asignado en Inventario.</div>
      <div id="valuacion-stock">${loadingHtml('Calculando valor...')}</div>
    </div>

    <div class="panel">
      <div class="panel-title"><h2>⚠️ Estampas con stock bajo o agotado</h2></div>
      ${d.stock_bajo.length === 0 ? '<div class="empty">No hay alertas de stock por el momento.</div>' : `
      <table><thead><tr><th></th><th>Código</th><th>Nombre</th><th>Stock</th><th>Mínimo</th><th>Estado</th></tr></thead>
      <tbody>${d.stock_bajo.map(s => `
        <tr style="cursor:pointer" onclick="navigate('inventario'); setTimeout(()=>openDetalle(${s.id}), 200)">
          <td><img class="thumb" src="${previewUrl(s.previsualizacion)}" onerror="this.style.visibility='hidden'"></td>
          <td>${esc(s.codigo)}</td><td>${esc(s.nombre)}</td>
          <td>${s.cantidad_disponible ?? '—'}</td><td>${s.stock_minimo}</td>
          <td><span class="${badgeClass(s.estado)}">${esc(s.estado)}</span></td>
        </tr>`).join('')}</tbody></table>`}
    </div>

    <div class="detail-grid" style="grid-template-columns:1fr 1fr">
      <div class="panel">
        <div class="panel-title"><h2>🔥 Estampas más utilizadas (30 días)</h2></div>
        ${d.mas_utilizadas_30d.length === 0 ? '<div class="empty">Sin consumos registrados todavía.</div>' : `
        <table><thead><tr><th></th><th>Código</th><th>Consumo</th></tr></thead>
        <tbody>${d.mas_utilizadas_30d.map(m => `
          <tr><td><img class="thumb" src="${previewUrl(m.previsualizacion)}" onerror="this.style.visibility='hidden'"></td>
          <td>${esc(m.codigo)} — ${esc(m.nombre)}</td><td>${m.consumo}</td></tr>`).join('')}</tbody></table>`}
      </div>
      <div class="panel">
        <div class="panel-title"><h2>🕒 Últimos movimientos</h2></div>
        ${d.ultimos_movimientos.length === 0 ? '<div class="empty">Todavía no hay movimientos.</div>' : `
        <table><thead><tr><th>Estampa</th><th>Tipo</th><th>Cant.</th><th>Fecha</th></tr></thead>
        <tbody>${d.ultimos_movimientos.map(m => `
          <tr><td>${esc(m.estampa_codigo)}</td><td>${esc(m.tipo)}</td>
          <td>${m.direccion === 'entrada' ? '+' : '−'}${m.cantidad}</td><td>${fmtDate(m.created_at)}</td></tr>`).join('')}</tbody></table>`}
      </div>
    </div>
  `;
  loadValuacionStock();
}

const ORIGEN_LABELS = {
  medida_manual: 'Medida manual (cm)',
  medida_cm: 'Medida real (cm)',
  categoria: 'Formato estándar',
  sin_valorizar: 'Sin valorizar',
  px_no_confiable: 'Sin valorizar (solo hay px)',
};

function valuationSizeLabel(size, categories) {
  if (!size) return '';
  if (size === 'CUSTOM') return 'Usar medida real';
  const cfg = categories ? categories[size] : null;
  if (cfg) return `${cfg.ancho_cm}×${cfg.alto_cm} cm`;
  const fallback = {
    TALLE: '4×2 cm',
    XS: '6×6 cm',
    S: '20×10 cm',
    M: '30×20 cm',
    L: '10×50 cm',
    XL: '50×50 cm',
  };
  return fallback[size] || size;
}

async function loadValuacionStock() {
  const target = document.getElementById('valuacion-stock');
  if (!target) return;
  const costo = Number(document.getElementById('val-costo')?.value || 10500);
  const ancho = Number(document.getElementById('val-ancho')?.value || 58);
  const alto = Number(document.getElementById('val-alto')?.value || 100);
  localStorage.setItem('stockdtf_val_costo', costo);
  localStorage.setItem('stockdtf_val_ancho', ancho);
  localStorage.setItem('stockdtf_val_alto', alto);
  target.innerHTML = loadingHtml('Calculando valor...');
  try {
    const v = await api(`/valuacion-stock?costo_plancha=${encodeURIComponent(costo)}&ancho_plancha_cm=${encodeURIComponent(ancho)}&alto_plancha_cm=${encodeURIComponent(alto)}`);
    const cats = Object.keys(v.size_categories || {});
    const origenes = v.unidades_por_origen || {};
    target.innerHTML = `
      <div class="cards">
        <div class="card ok"><div class="num">${money(v.valor_total)}</div><div class="label">Valor calculado</div></div>
        <div class="card"><div class="num">${Number(v.planchas_equivalentes || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}</div><div class="label">Planchas equivalentes</div></div>
        <div class="card"><div class="num">${v.unidades_valorizadas_medida_real}</div><div class="label">Unidades por medida real</div></div>
        <div class="card"><div class="num">${v.unidades_valorizadas_categoria}</div><div class="label">Unidades por formato</div></div>
        <div class="card warn"><div class="num">${v.unidades_sin_valorizar}</div><div class="label">Unidades sin valorizar</div></div>
      </div>
      ${v.unidades_sin_valorizar
        ? `<div class="notice">⚠️ ${v.estampas_sin_valorizar} estampa(s) con stock no entran en el valor: no tienen medida real en cm, medida manual ni formato estándar asignado${origenes.px_no_confiable ? ` (${origenes.px_no_confiable} unidad(es) tienen ancho/alto en px, que no cuenta como medida física)` : ''}. Asignales una medida o un formato desde Inventario para incluirlas.</div>`
        : ''}
      <table><thead><tr><th>Origen</th><th>Unidades</th></tr></thead>
        <tbody>${Object.keys(ORIGEN_LABELS).map(o => `
          <tr><td>${ORIGEN_LABELS[o]}</td><td>${origenes[o] || 0}</td></tr>`).join('')}</tbody></table>
      ${v.unidades_valorizadas_categoria ? `
      <table><thead><tr><th>Formato</th><th>Medida usada</th><th>Unidades</th></tr></thead>
        <tbody>${cats.map(c => `
          <tr><td>${valuationSizeLabel(c, v.size_categories)}</td>
          <td>${v.size_categories[c].ancho_cm}×${v.size_categories[c].alto_cm} cm</td>
          <td>${v.unidades_por_categoria[c] || 0}</td></tr>`).join('')}</tbody></table>` : ''}
    `;
  } catch (e) {
    target.innerHTML = `<div class="empty">No pude calcular el valor: ${esc(e.message)}</div>`;
  }
}

// ============================================================================
// INVENTARIO
// ============================================================================
let INV_VIEW_MODE = 'tabla';
let INV_SELECTED = new Set();
let INV_LAST_ROWS = [];

async function renderInventario(view) {
  view.innerHTML = `
    <div class="topbar">
      <div><h1>🖼️ Inventario de estampas</h1><div class="sub">Catálogo de estampas DTF y su stock</div></div>
      <div style="display:flex;gap:8px">
        <button onclick="window.open('api/export/estampas.csv')">⬇️ Exportar CSV</button>
        <button onclick="openMedidaPorLoteModal()">📐 Medida por lote</button>
        <button class="primary" onclick="openNuevaEstampaModal()">+ Nueva estampa</button>
      </div>
    </div>
    <div class="panel">
      <div class="toolbar">
        <input class="search" id="inv-q" placeholder="Buscar por nombre, código, variante…">
        <select id="inv-estado">
          <option value="">Todos los estados</option>
          <option>Disponible</option><option>Stock bajo</option><option>Agotada</option>
          <option>Pendiente de revision</option><option>Discontinuada</option>
        </select>
        <select id="inv-categoria">
          <option value="">Todos los tipos</option>
          <option value="Talles">Talles</option>
        </select>
        <select id="inv-sort">
          <option value="codigo">Ordenar: código</option>
          <option value="nombre">Ordenar: nombre</option>
          <option value="cantidad_disponible">Ordenar: stock</option>
          <option value="updated_at">Ordenar: últ. actualización</option>
        </select>
        <div class="tabs">
          <div class="tab ${INV_VIEW_MODE === 'tabla' ? 'active' : ''}" onclick="INV_VIEW_MODE='tabla'; router()">Tabla</div>
          <div class="tab ${INV_VIEW_MODE === 'galeria' ? 'active' : ''}" onclick="INV_VIEW_MODE='galeria'; router()">Galería</div>
        </div>
      </div>
      <div id="inv-bulkbar" class="toolbar hidden">
        <span id="inv-selcount" class="sub"></span>
        <select id="inv-bulk-estado"><option value="">Cambiar estado a…</option>
          <option>Disponible</option><option>Stock bajo</option><option>Agotada</option><option>Discontinuada</option></select>
        <input id="inv-bulk-categoria" placeholder="Categoría (aplicar a selección)" style="width:180px">
        <select id="inv-bulk-valuation-size">${valuationSizeOptionsHtml('Formato de medida…')}</select>
        <input id="inv-bulk-minimo" type="number" placeholder="Stock mínimo" style="width:110px">
        <button class="primary" onclick="applyBulkEdit()">Aplicar a seleccionadas</button>
      </div>
      <div class="toolbar filter-actionbar">
        <span id="inv-filter-count" class="sub">0 filtradas</span>
        <input id="inv-filter-minimo" type="number" min="0" step="1" placeholder="Mínimo" style="width:100px">
        <button onclick="applyFilteredMinimum()">Aplicar mínimo a filtradas</button>
        <select id="inv-filter-valuation-size">${valuationSizeOptionsHtml('Formato de medida…')}</select>
        <button onclick="applyFilteredValuationSize()">Aplicar formato a filtradas</button>
      </div>
      <div id="inv-content">${loadingHtml('Cargando inventario...')}</div>
    </div>
  `;
  const reload = () => loadInventario();
  document.getElementById('inv-q').addEventListener('input', debounce(reload, 250));
  document.getElementById('inv-estado').addEventListener('change', reload);
  document.getElementById('inv-categoria').addEventListener('change', reload);
  document.getElementById('inv-sort').addEventListener('change', reload);
  await loadInventario();
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

const VALUATION_SIZES = ['TALLE', 'XS', 'S', 'M', 'L', 'XL'];
function valuationSizeOptionsHtml(placeholder, selected) {
  return `<option value="">${esc(placeholder)}</option>${VALUATION_SIZES.map(s =>
    `<option value="${s}" ${selected === s ? 'selected' : ''}>${esc(valuationSizeLabel(s))}</option>`
  ).join('')}`;
}

async function updateValuationSize(id, value) {
  try {
    await api(`/estampas/${id}`, { method: 'PUT', body: { valuation_size: value } });
    toast(value ? `Formato de medida asignado: ${valuationSizeLabel(value)}` : 'Formato de medida quitado');
    loadInventario();
  } catch (e) { toast(e.message, 'err'); loadInventario(); }
}

// Medida "confiable" para valuación = medida manual cargada a mano, o
// ancho/alto real con unidad_medida='cm'. El ancho/alto en px es resolución
// de imagen, no tamaño físico, y nunca cuenta como medida real (ver
// /api/valuacion-stock en el servidor).
function tieneMedidaConfiable(r) {
  if (r.valuation_width_cm && r.valuation_height_cm) return true;
  return !!(r.ancho && r.alto && r.unidad_medida === 'cm');
}

function openMedidaPorLoteModal() {
  openModal(`
    <h2>📐 Aplicar medida real por lote</h2>
    <div class="sub" style="margin-bottom:10px">Asigna un ancho/alto en cm (medida manual) a TODAS las estampas cuyo código empiece con el prefijo indicado. Ej: prefijo <code>JD-05-</code> aplica a JD-05-01, JD-05-02, etc. Esta medida tiene prioridad sobre categoría y sobre cualquier ancho/alto técnico.</div>
    <form id="form-medida-lote" class="form-grid">
      <label class="full">Prefijo de código *<input name="prefijo" placeholder="Ej: JD-05-" required></label>
      <label>Ancho cm *<input name="ancho_cm" type="number" step="0.1" min="0.1" required></label>
      <label>Alto cm *<input name="alto_cm" type="number" step="0.1" min="0.1" required></label>
      <label class="full">Origen / fuente<input name="source" placeholder="Ej: medido a mano, catálogo proveedor…"></label>
      <label class="full">Confianza<input name="confidence" placeholder="Ej: estimado, medido, confirmado…"></label>
    </form>
    <div id="medida-lote-preview" class="sub" style="margin:8px 0"></div>
    <div class="modal-actions">
      <button class="ghost" onclick="closeModal()">Cancelar</button>
      <button onclick="previewMedidaPorLote()">Vista previa</button>
      <button class="primary" onclick="submitMedidaPorLote()">Aplicar</button>
    </div>
  `);
}

async function previewMedidaPorLote() {
  const form = document.getElementById('form-medida-lote');
  const prefijo = form.prefijo.value.trim();
  const out = document.getElementById('medida-lote-preview');
  if (!prefijo) { toast('Ingresá un prefijo', 'err'); return; }
  try {
    const r = await api('/estampas/valuacion-por-prefijo?prefijo=' + encodeURIComponent(prefijo));
    out.innerHTML = r.coincidencias === 0
      ? `⚠️ Ningún código empieza con "${esc(prefijo)}"`
      : `${r.coincidencias} estampa(s) matchean: ${r.muestra.slice(0, 10).map(m => esc(m.codigo)).join(', ')}${r.coincidencias > 10 ? '…' : ''}`;
  } catch (e) { toast(e.message, 'err'); }
}

async function submitMedidaPorLote() {
  const form = document.getElementById('form-medida-lote');
  const fd = new FormData(form);
  const body = Object.fromEntries(fd.entries());
  if (!body.prefijo || !body.ancho_cm || !body.alto_cm) { toast('Prefijo, ancho y alto son obligatorios', 'err'); return; }
  body.ancho_cm = Number(body.ancho_cm);
  body.alto_cm = Number(body.alto_cm);
  if (!body.source) delete body.source;
  if (!body.confidence) delete body.confidence;
  try {
    const r = await api('/estampas/valuacion-por-prefijo?prefijo=' + encodeURIComponent(body.prefijo));
    if (r.coincidencias === 0) { toast(`Ningún código empieza con "${body.prefijo}"`, 'err'); return; }
    const ok = confirm(`Aplicar ${body.ancho_cm}×${body.alto_cm} cm a ${r.coincidencias} estampa(s) con prefijo "${body.prefijo}"?`);
    if (!ok) return;
    const res = await api('/estampas/valuacion-por-prefijo', { method: 'POST', body });
    toast(`${res.updated} estampa(s) actualizadas con medida ${body.ancho_cm}×${body.alto_cm} cm`);
    closeModal();
    loadInventario();
  } catch (e) { toast(e.message, 'err'); }
}

async function loadInventario() {
  const q = document.getElementById('inv-q').value.trim();
  const estado = document.getElementById('inv-estado').value;
  const categoria = document.getElementById('inv-categoria').value;
  const sort = document.getElementById('inv-sort').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (estado) params.set('estado', estado);
  if (categoria) params.set('categoria', categoria);
  if (sort) params.set('sort', sort);
  const rows = await api('/estampas?' + params.toString());
  INV_LAST_ROWS = rows;
  const countEl = document.getElementById('inv-filter-count');
  if (countEl) countEl.textContent = `${rows.length} filtradas`;
  const content = document.getElementById('inv-content');
  if (rows.length === 0) { content.innerHTML = '<div class="empty">No se encontraron estampas con esos filtros.</div>'; return; }

  if (INV_VIEW_MODE === 'galeria') {
    content.innerHTML = `<div class="gallery">${rows.map(r => `
      <div class="gcard" onclick="openDetalle(${r.id})">
        ${stampThumbHtml(r, 'gallery')}
        <div class="gc-body">
          <div class="gc-code">${esc(r.codigo)}${typeChipHtml(r)}</div>
          <div class="gc-meta">${esc(r.nombre)}</div>
          <div class="gc-meta">Stock: ${r.cantidad_disponible ?? '—'} · <span class="${badgeClass(r.estado)}">${esc(r.estado)}</span></div>
        </div>
      </div>`).join('')}</div>`;
    return;
  }

  content.innerHTML = `
    <table>
      <thead><tr>
        <th><input type="checkbox" id="inv-checkall"></th>
        <th></th><th>Código</th><th>Nombre</th><th>Variante</th><th>Tamaño</th><th>Valuación</th>
        <th>Stock</th><th>Mínimo</th><th>Estado</th><th>Acciones</th>
      </tr></thead>
      <tbody>${rows.map(r => `
        <tr>
          <td><input type="checkbox" class="inv-check" data-id="${r.id}" ${INV_SELECTED.has(r.id) ? 'checked' : ''}></td>
          <td>${stampThumbHtml(r)}</td>
          <td style="cursor:pointer;font-weight:600" onclick="openDetalle(${r.id})">${esc(r.codigo)}${typeChipHtml(r)}</td>
          <td style="cursor:pointer" onclick="openDetalle(${r.id})">${esc(r.nombre)}</td>
          <td>${esc(r.variante)}</td>
          <td>${r.ancho && r.alto ? `${r.ancho}×${r.alto} ${r.unidad_medida}${r.unidad_medida === 'px' ? ' <span class="sub" title="Resolución de imagen, no tamaño físico">(no confiable)</span>' : ''}` : '—'}</td>
          <td>${tieneMedidaConfiable(r)
            ? `<span class="sub" title="${r.valuation_width_cm ? 'Medida manual cargada a mano' : 'Ancho/alto real en cm'}, la categoría no aplica">${r.valuation_width_cm ? `manual ${r.valuation_width_cm}×${r.valuation_height_cm}cm` : 'medida real'}</span>`
            : `<select class="sm" onchange="updateValuationSize(${r.id}, this.value)">${valuationSizeOptionsHtml('— sin asignar —', r.valuation_size)}</select>`}</td>
          <td>${r.cantidad_disponible ?? '<span class="sub">pendiente</span>'}</td>
          <td>${r.stock_minimo}</td>
          <td><span class="${badgeClass(r.estado)}">${esc(r.estado)}</span></td>
          <td>
            <button class="sm" onclick="openDetalle(${r.id})">Ver</button>
            <button class="sm" onclick="openMovStockModal(${r.id}, '${esc(r.codigo)}')">Stock</button>
          </td>
        </tr>`).join('')}</tbody>
    </table>`;

  document.getElementById('inv-checkall').addEventListener('change', (e) => {
    document.querySelectorAll('.inv-check').forEach(cb => { cb.checked = e.target.checked; toggleSel(Number(cb.dataset.id), e.target.checked); });
  });
  document.querySelectorAll('.inv-check').forEach(cb => {
    cb.addEventListener('change', (e) => toggleSel(Number(cb.dataset.id), e.target.checked));
  });
  updateBulkbar();
}

function toggleSel(id, checked) {
  if (checked) INV_SELECTED.add(id); else INV_SELECTED.delete(id);
  updateBulkbar();
}
function updateBulkbar() {
  const bar = document.getElementById('inv-bulkbar');
  if (!bar) return;
  if (INV_SELECTED.size > 0) {
    bar.classList.remove('hidden');
    document.getElementById('inv-selcount').textContent = `${INV_SELECTED.size} seleccionadas`;
  } else bar.classList.add('hidden');
}

async function applyBulkEdit() {
  const changes = {};
  const estado = document.getElementById('inv-bulk-estado').value;
  const categoria = document.getElementById('inv-bulk-categoria').value;
  const valuationSize = document.getElementById('inv-bulk-valuation-size').value;
  const minimo = document.getElementById('inv-bulk-minimo').value;
  if (estado) changes.estado = estado;
  if (categoria) changes.categoria = categoria;
  if (valuationSize) changes.valuation_size = valuationSize;
  if (minimo) changes.stock_minimo = Number(minimo);
  if (Object.keys(changes).length === 0) { toast('Elegí al menos un cambio para aplicar', 'err'); return; }
  try {
    const r = await api('/estampas/bulk-update', { method: 'POST', body: { ids: [...INV_SELECTED], changes } });
    toast(`${r.updated} estampas actualizadas`);
    INV_SELECTED.clear();
    loadInventario();
  } catch (e) { toast(e.message, 'err'); }
}

async function applyFilteredValuationSize() {
  const select = document.getElementById('inv-filter-valuation-size');
  const valuationSize = select ? select.value : '';
  const ids = INV_LAST_ROWS.map(r => r.id);
  if (!valuationSize) { toast('Elegí un formato de medida', 'err'); return; }
  if (!ids.length) { toast('No hay estampas filtradas para actualizar', 'err'); return; }
  const ok = confirm(`Aplicar formato ${valuationSizeLabel(valuationSize)} a ${ids.length} estampa(s) filtradas?`);
  if (!ok) return;
  try {
    const r = await api('/estampas/bulk-update', { method: 'POST', body: { ids, changes: { valuation_size: valuationSize } } });
    toast(`${r.updated} estampas actualizadas con formato ${valuationSizeLabel(valuationSize)}`);
    if (select) select.value = '';
    loadInventario();
  } catch (e) { toast(e.message, 'err'); }
}

async function applyFilteredMinimum() {
  const input = document.getElementById('inv-filter-minimo');
  const raw = input ? input.value : '';
  const minimo = Number(raw);
  const ids = INV_LAST_ROWS.map(r => r.id);
  if (raw === '' || !Number.isInteger(minimo) || minimo < 0) {
    toast('Ingresá un mínimo válido', 'err');
    return;
  }
  if (!ids.length) {
    toast('No hay estampas filtradas para actualizar', 'err');
    return;
  }
  const ok = confirm(`Aplicar stock mínimo ${minimo} a ${ids.length} estampa(s) filtradas?`);
  if (!ok) return;
  try {
    const r = await api('/estampas/bulk-update', { method: 'POST', body: { ids, changes: { stock_minimo: minimo } } });
    toast(`${r.updated} estampas actualizadas con mínimo ${minimo}`);
    if (input) input.value = '';
    loadInventario();
  } catch (e) { toast(e.message, 'err'); }
}

function openNuevaEstampaModal() {
  openModal(`
    <h2>+ Nueva estampa (alta manual)</h2>
    <form id="form-nueva-estampa" class="form-grid">
      <label>Código *<input name="codigo" required></label>
      <label>Nombre *<input name="nombre" required></label>
      <label>Categoría<input name="categoria"></label>
      <label>Subcategoría<input name="subcategoria"></label>
      <label>Color<input name="color"></label>
      <label>Ubicación de aplicación
        <select name="ubicacion_aplicacion"><option value="">—</option><option>frente</option><option>espalda</option><option>manga</option><option>pantalon</option><option>otra</option></select>
      </label>
      <label>Ancho<input name="ancho" type="number" step="0.01"></label>
      <label>Alto<input name="alto" type="number" step="0.01"></label>
      <label>Unidad<select name="unidad_medida"><option>cm</option><option>px</option></select></label>
      <label>Stock inicial<input name="cantidad_disponible" type="number" value="0"></label>
      <label>Stock mínimo<input name="stock_minimo" type="number" value="2"></label>
      <label class="full">Imagen para ver en inventario<input name="preview_file" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label>
      <label class="full">Archivo original (ruta o nombre)<input name="archivo_original" placeholder="Ej: C:\\...\\estampa.psd"></label>
      <label class="full">Observaciones<textarea name="observaciones" rows="2"></textarea></label>
    </form>
    <div class="modal-actions">
      <button class="ghost" onclick="closeModal()">Cancelar</button>
      <button class="primary" onclick="submitNuevaEstampa()">Guardar</button>
    </div>
  `);
}
async function submitNuevaEstampa() {
  const form = document.getElementById('form-nueva-estampa');
  const fd = new FormData(form);
  const body = Object.fromEntries(fd.entries());
  const previewFile = fd.get('preview_file');
  delete body.preview_file;
  ['ancho', 'alto', 'cantidad_disponible', 'stock_minimo'].forEach(k => { if (body[k] !== '') body[k] = Number(body[k]); else delete body[k]; });
  if (previewFile && previewFile.size) {
    body.preview_upload = await fileToDataUrl(previewFile);
    if (!body.archivo_original) body.archivo_original = previewFile.name;
  }
  body.carpeta_origen = body.archivo_original ? body.archivo_original.split(/[\\/]/).slice(0, -1).join('/') : '';
  body.formato_archivo = body.archivo_original ? (body.archivo_original.split('.').pop() || '').toLowerCase() : '';
  try {
    await api('/estampas', { method: 'POST', body });
    toast('Estampa creada');
    closeModal();
    router();
  } catch (e) { toast(e.message, 'err'); }
}

function openMovStockModal(id, codigo) {
  openModal(`
    <h2>Movimiento de stock — ${esc(codigo)}</h2>
    <div class="tabs" id="mov-tabs">
      <div class="tab active" data-t="ingreso">Ingreso</div>
      <div class="tab" data-t="salida">Pérdida / Daño</div>
      <div class="tab" data-t="correccion">Corrección manual</div>
    </div>
    <form id="form-mov" class="form-grid">
      <input type="hidden" name="tipo" value="ingreso">
      <label id="lbl-cantidad">Cantidad *<input name="cantidad" type="number" min="1" required></label>
      <label id="lbl-cantnueva" class="hidden">Cantidad nueva (total) *<input name="cantidad_nueva" type="number" min="0"></label>
      <label>Usuario${userSelectHtml()}</label>
      <label class="full">Motivo${''}<input name="motivo" placeholder="Opcional"></label>
    </form>
    <div class="modal-actions">
      <button class="ghost" onclick="closeModal()">Cancelar</button>
      <button class="primary" onclick="submitMovStock(${id})">Registrar</button>
    </div>
  `);
  document.querySelectorAll('#mov-tabs .tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('#mov-tabs .tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.querySelector('#form-mov input[name=tipo]').value = t.dataset.t;
    document.getElementById('lbl-cantidad').classList.toggle('hidden', t.dataset.t === 'correccion');
    document.getElementById('lbl-cantnueva').classList.toggle('hidden', t.dataset.t !== 'correccion');
  }));
}
async function submitMovStock(id) {
  const form = document.getElementById('form-mov');
  const fd = new FormData(form);
  const body = Object.fromEntries(fd.entries());
  const tipo = body.tipo;
  try {
    if (tipo === 'ingreso') {
      await api(`/estampas/${id}/ingreso`, { method: 'POST', body: { cantidad: Number(body.cantidad), usuario: body.usuario, motivo: body.motivo } });
    } else if (tipo === 'salida') {
      await api(`/estampas/${id}/salida`, { method: 'POST', body: { cantidad: Number(body.cantidad), usuario: body.usuario, motivo: body.motivo, tipo: 'perdida' } });
    } else {
      await api(`/estampas/${id}/correccion`, { method: 'POST', body: { cantidad_nueva: Number(body.cantidad_nueva), usuario: body.usuario, motivo: body.motivo } });
    }
    toast('Movimiento registrado');
    closeModal();
    router();
  } catch (e) { toast(e.message, 'err'); }
}

// ============================================================================
// DETALLE DE ESTAMPA (modal grande)
// ============================================================================
async function openDetalle(id) {
  const d = await api('/estampas/' + id);
  if (d.error) { toast(d.error, 'err'); return; }
  const f = (d.archivos && d.archivos[0]) || {};
  d.previsualizacion = d.previsualizacion ?? f.previsualizacion;
  d.archivo_original = d.archivo_original ?? f.archivo_original;
  d.formato_archivo = d.formato_archivo ?? f.formato_archivo;
  d.origen_tipo = d.origen_tipo ?? f.origen_tipo;
  d.origen_capa_grupo_pagina = d.origen_capa_grupo_pagina ?? f.origen_capa_grupo_pagina;
  d.origen_json = d.origen_json ?? f.origen_json;
  let capas = [];
  try { capas = (JSON.parse(d.origen_json || '{}').capas_detectadas) || []; } catch (e) {}

  openModal(`
    <h2>🔎 ${esc(d.codigo)} — ${esc(d.nombre)}</h2>
    <div class="detail-grid">
      <div>
        ${isSizeStamp(d) && !d.previsualizacion
          ? `<div class="size-thumb" style="width:100%;height:220px;font-size:54px">${esc(d.talle_tamano || d.variante || d.codigo)}</div>`
          : `<img class="big" src="${previewUrl(d.previsualizacion)}" onerror="this.style.opacity=0.15">`}
        <div style="margin-top:10px">
          <span class="${badgeClass(d.estado)}">${esc(d.estado)}</span>
        </div>
        <div class="kv" style="margin-top:10px"><div class="k">Stock actual</div><div>${d.cantidad_disponible ?? 'pendiente de carga'}</div></div>
        <div class="kv"><div class="k">Stock mínimo</div><div>${d.stock_minimo}</div></div>
        <div class="kv"><div class="k">Consumo 30d</div><div>${d.consumo_30d}</div></div>
        <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
          <button class="sm" onclick="closeModal(); openMovStockModal(${d.id}, '${esc(d.codigo)}')">Corregir stock</button>
          ${d.estado !== 'Discontinuada'
            ? `<button class="sm danger" onclick="discontinuar(${d.id})">Discontinuar</button>`
            : `<button class="sm" onclick="reactivar(${d.id})">Reactivar</button>`}
          <button class="sm danger" onclick="eliminarEstampa(${d.id}, '${esc(d.codigo)}')">Eliminar</button>
        </div>
      </div>
      <div>
        <div class="kv"><div class="k">Variante</div><div>${esc(d.variante)}</div></div>
        <div class="kv"><div class="k">Categoría</div><div>${esc(d.categoria || '—')}</div></div>
        <div class="kv"><div class="k">Ubicación aplic.</div><div>${esc(d.ubicacion_aplicacion || '—')}</div></div>
        <div class="kv"><div class="k">Tamaño</div><div>${d.ancho && d.alto ? `${d.ancho}×${d.alto} ${d.unidad_medida}${d.unidad_medida === 'px' ? ' <span class="sub">(no confiable para valuar)</span>' : ''}` : '—'}</div></div>
        <div class="kv"><div class="k">Medida de valuación</div><div>${d.valuation_width_cm
          ? `<span class="sub">manual: ${d.valuation_width_cm}×${d.valuation_height_cm} cm${d.valuation_source ? ` — ${esc(d.valuation_source)}` : ''}${d.valuation_confidence ? ` (${esc(d.valuation_confidence)})` : ''}</span>`
          : tieneMedidaConfiable(d) ? '<span class="sub">usa medida real (cm)</span>' : (d.valuation_size ? esc(valuationSizeLabel(d.valuation_size)) : '—')}</div></div>
        <div class="kv"><div class="k">Archivo original</div><div style="word-break:break-all">${esc(d.archivo_original)}</div></div>
        <div class="kv"><div class="k">Formato</div><div>${esc(d.formato_archivo)}</div></div>
        <div class="kv"><div class="k">Origen</div><div>${esc(d.origen_tipo)}${d.origen_capa_grupo_pagina ? ' — ' + esc(d.origen_capa_grupo_pagina) : ''}</div></div>
        <div class="kv"><div class="k">Observaciones</div><div>${esc(d.observaciones || '—')}</div></div>

        ${capas.length ? `<h3 style="margin-top:14px;font-size:13px">Capas / grupos detectados</h3>
        <div class="layer-tree">${capas.map(c => `${'  '.repeat(c.profundidad)}${c.es_grupo ? '📁' : '📄'} ${esc(c.nombre)} ${c.visible ? '' : '(oculta)'}`).join('<br>')}</div>` : ''}

        ${d.posibles_duplicados && d.posibles_duplicados.length ? `<h3 style="margin-top:14px;font-size:13px">⚠️ Posibles duplicados</h3>
        ${d.posibles_duplicados.map(p => `<div class="kv"><div class="k">${esc(p.codigo_otro)}</div><div>${esc(p.nombre_otro)} — ${esc(JSON.parse(p.motivos || '[]').join(', '))}
          <button class="sm" onclick="resolverDuplicado(${p.id}, 'son_distintos')">Son distintos</button></div></div>`).join('')}` : ''}

        <h3 style="margin-top:14px;font-size:13px">Productos que consumen esta estampa</h3>
        ${d.productos_asociados.length === 0 ? '<div class="empty">Sin productos asociados todavía.</div>' :
          d.productos_asociados.map(p => `<div class="kv"><div class="k">${esc(p.sku)}</div><div>${esc(p.producto_nombre)} — ${p.cantidad_por_unidad}x (${esc(p.ubicacion_aplicacion || 'sin ubicación')})</div></div>`).join('')}

        <h3 style="margin-top:14px;font-size:13px">Historial de movimientos</h3>
        <div style="max-height:220px;overflow:auto">
        <table><thead><tr><th>Fecha</th><th>Tipo</th><th>Cant.</th><th>Stock post.</th><th>Pedido</th></tr></thead>
        <tbody>${d.movimientos.length === 0 ? '<tr><td colspan="5" class="empty">Sin movimientos</td></tr>' : d.movimientos.map(m => `
          <tr><td>${fmtDate(m.created_at)}</td><td>${esc(m.tipo)}</td><td>${m.direccion === 'entrada' ? '+' : '−'}${m.cantidad}</td>
          <td>${m.stock_posterior ?? '—'}</td><td>${esc(m.pedido_id || '—')}</td></tr>`).join('')}</tbody></table>
        </div>
      </div>
    </div>
    <div class="modal-actions"><button class="ghost" onclick="closeModal()">Cerrar</button></div>
  `);
}
async function eliminarEstampa(id, codigo) {
  if (!confirm(`Eliminar ${codigo}? Esta accion no se puede deshacer.`)) return;
  try {
    await api(`/estampas/${id}`, { method: 'DELETE' });
    toast('Estampa eliminada');
    closeModal(); router();
  } catch (e) { toast(e.message, 'err'); }
}
async function discontinuar(id) {
  if (!confirm('¿Marcar esta estampa como discontinuada?')) return;
  await api(`/estampas/${id}/discontinuar`, { method: 'POST' });
  toast('Estampa discontinuada');
  closeModal(); router();
}
async function reactivar(id) {
  await api(`/estampas/${id}/reactivar`, { method: 'POST' });
  toast('Estampa reactivada');
  closeModal(); router();
}
async function resolverDuplicado(id, resolucion) {
  await api(`/duplicados/${id}/resolver`, { method: 'POST', body: { resolucion } });
  toast('Marcado como revisado');
  closeModal();
}

// ============================================================================
// RECETAS DE ESTAMPADO
// ============================================================================
async function renderRecetas(view) {
  const q = document.getElementById('recetas-q');
  const query = q ? q.value : '';
  const [recetas, productosSinReceta, incompletas] = await Promise.all([
    api('/recetas'), api('/productos/sin-receta'), api('/productos/recetas-incompletas'),
  ]);
  const productos = await api('/productos' + (query ? `?q=${encodeURIComponent(query)}` : ''));

  view.innerHTML = `
    <div class="topbar">
      <div><h1>🧾 Recetas de estampado</h1><div class="sub">Qué estampas consume cada producto</div></div>
      <div style="display:flex;gap:8px">
        <button onclick="openImportarProductosModal()">⬆️ Importar productos</button>
        <button class="primary" onclick="openNuevaRecetaModal()">+ Nueva receta</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title"><h2>Catálogo de productos (${productos.length})</h2></div>
      <input id="recetas-q" class="inline-search" placeholder="Buscar por SKU o nombre…" value="${esc(query)}">
      <table><thead><tr><th>SKU</th><th>Nombre</th><th>Variante</th><th>Fuente</th><th></th></tr></thead>
      <tbody>${productos.slice(0, 50).map(p => `<tr><td>${esc(p.sku)}</td><td>${esc(p.nombre)}</td><td>${esc(p.variante || '—')}</td><td>${esc(p.fuente || 'manual')}</td>
        <td><button class="sm" onclick="openNuevaRecetaModal(${p.id})">+ receta</button></td></tr>`).join('')}</tbody></table>
      ${productos.length > 50 ? `<div class="sub">Mostrando 50 de ${productos.length}. Refiná la búsqueda para ver más.</div>` : ''}
    </div>

    ${productosSinReceta.length ? `<div class="panel">
      <div class="panel-title"><h2>Productos sin receta activa (${productosSinReceta.length})</h2></div>
      <table><thead><tr><th>SKU</th><th>Nombre</th><th></th></tr></thead>
      <tbody>${productosSinReceta.map(p => `<tr><td>${esc(p.sku)}</td><td>${esc(p.nombre)}</td>
        <td><button class="sm" onclick="openNuevaRecetaModal(${p.id})">Definir receta</button></td></tr>`).join('')}</tbody></table>
    </div>` : ''}

    ${incompletas.length ? `<div class="panel">
      <div class="panel-title"><h2>⚠️ Recetas posiblemente incompletas (${incompletas.length})</h2></div>
      <div class="sub">Productos con una sola estampa activa — si el producto lleva estampa en más de un lugar (ej: frente y espalda), puede faltar cargar la segunda.</div>
      <table><thead><tr><th>SKU</th><th>Nombre</th><th>Ubicaciones cargadas</th><th></th></tr></thead>
      <tbody>${incompletas.map(p => `<tr><td>${esc(p.sku)}</td><td>${esc(p.nombre)}</td><td>${esc((p.ubicaciones || []).join(', ') || '—')}</td>
        <td><button class="sm" onclick="openNuevaRecetaModal(${p.id})">+ agregar ubicación</button></td></tr>`).join('')}</tbody></table>
    </div>` : ''}

    <div class="panel">
      <div class="panel-title"><h2>Recetas definidas (${recetas.length})</h2></div>
      ${recetas.length === 0 ? '<div class="empty">Todavía no hay recetas cargadas.</div>' : `
      <table><thead><tr><th></th><th>SKU</th><th>Producto</th><th>Estampa</th><th>Cant./unidad</th><th>Ubicación</th><th>Confirmada</th><th>Activa</th><th></th></tr></thead>
      <tbody>${recetas.map(r => `
        <tr>
          <td><img class="thumb" src="${previewUrl(r.previsualizacion)}" onerror="this.style.visibility='hidden'"></td>
          <td>${esc(r.sku)}</td><td>${esc(r.producto_nombre)}</td>
          <td>${esc(r.estampa_codigo)} — ${esc(r.estampa_nombre)}</td>
          <td>${r.cantidad_por_unidad}</td><td>${esc(r.ubicacion_aplicacion || '—')}</td>
          <td>${r.confirmado ? '✅' : '⏳ sugerida'}</td>
          <td>${r.activo ? '✅' : '❌'}</td>
          <td>
            ${!r.confirmado ? `<button class="sm" onclick="confirmarReceta(${r.id})">Confirmar</button>` : ''}
            <button class="sm" onclick="toggleReceta(${r.id}, ${r.activo ? 0 : 1})">${r.activo ? 'Desactivar' : 'Activar'}</button>
            <button class="sm" onclick="openCopiarRecetaModal(${r.product_id})">Copiar a otros talles/variantes</button>
          </td>
        </tr>`).join('')}</tbody></table>`}
    </div>
  `;

  const qInput = document.getElementById('recetas-q');
  if (qInput) qInput.addEventListener('change', () => router());
}

function openImportarProductosModal() {
  openModal(`
    <h2>⬆️ Importar productos</h2>
    <p class="sub">Pegá un JSON con formato <code>[{"sku":"...", "nombre":"...", "variante":"..."}]</code>, tal como lo podés exportar desde Tiendanube o incognito-ventas. No relaciona estampas automáticamente por parecido de nombre — eso siempre lo definís vos en la receta.</p>
    <textarea id="importar-json" rows="10" class="full-textarea" placeholder='[{"sku":"REMERA-BASICA-M","nombre":"Remera básica","variante":"M"}]'></textarea>
    <div class="modal-actions">
      <button class="ghost" onclick="closeModal()">Cancelar</button>
      <button class="primary" onclick="submitImportarProductos()">Importar</button>
    </div>
  `);
}
async function submitImportarProductos() {
  const raw = document.getElementById('importar-json').value.trim();
  let productos;
  try { productos = JSON.parse(raw); } catch (e) { toast('JSON inválido', 'err'); return; }
  if (!Array.isArray(productos)) { toast('Debe ser un array de productos', 'err'); return; }
  try {
    const r = await api('/productos/importar', { method: 'POST', body: { productos, fuente: 'importacion_manual' } });
    toast(`Importados: ${r.creados} nuevos, ${r.actualizados} actualizados, ${r.invalidos} inválidos`);
    closeModal(); router();
  } catch (e) { toast(e.message, 'err'); }
}

async function openNuevaRecetaModal(productId) {
  const productos = await api('/productos');
  const estampas = await api('/estampas');
  const estampaMap = Object.fromEntries(estampas.map(s => [s.id, s]));
  const first = estampas[0];
  openModal(`
    <h2>+ Nueva receta de estampado</h2>
    <form id="form-receta" class="form-grid">
      <label class="full">Producto (SKU) *
        <select name="product_id">${productos.map(p => `<option value="${p.id}" ${productId === p.id ? 'selected' : ''}>${esc(p.sku)} — ${esc(p.nombre)}</option>`).join('')}</select>
      </label>
      <label class="full">Estampa *
        <select name="stamp_variant_id" onchange="document.getElementById('receta-preview').src = previewUrl(this.selectedOptions[0].dataset.preview || '')">
          ${estampas.map(s => `<option value="${s.id}" data-preview="${esc(s.previsualizacion || '')}">${esc(s.codigo)} — ${esc(s.nombre)}</option>`).join('')}
        </select>
      </label>
      <div class="full">
        <img id="receta-preview" class="recipe-preview" src="${previewUrl(first ? first.previsualizacion : '')}" onerror="this.style.visibility='hidden'">
      </div>
      <label>Cantidad por unidad *<input name="cantidad_por_unidad" type="number" min="1" value="1"></label>
      <label>Ubicación
        <select name="ubicacion_aplicacion"><option value="">—</option><option>frente</option><option>espalda</option><option>manga</option><option>pantalon</option><option>otra</option></select>
      </label>
      <label class="full">Observaciones<textarea name="observaciones" rows="2"></textarea></label>
    </form>
    <p class="sub">Las relaciones que cargués acá quedan <b>confirmadas</b> porque las estás definiendo vos mismo/a. Las sugerencias automáticas por nombre parecido, en cambio, quedan como "pendientes de confirmar" y no descuentan stock hasta que las confirmes.</p>
    <div class="modal-actions">
      <button class="ghost" onclick="closeModal()">Cancelar</button>
      <button class="primary" onclick="submitNuevaReceta()">Guardar</button>
    </div>
  `);
}
async function submitNuevaReceta() {
  const form = document.getElementById('form-receta');
  const fd = new FormData(form);
  const body = Object.fromEntries(fd.entries());
  body.product_id = Number(body.product_id);
  body.stamp_variant_id = Number(body.stamp_variant_id);
  body.cantidad_por_unidad = Number(body.cantidad_por_unidad);
  body.confirmado = true;
  body.usuario = CURRENT_USER;
  try {
    await api('/recetas', { method: 'POST', body });
    toast('Receta creada');
    closeModal(); router();
  } catch (e) { toast(e.message, 'err'); }
}
async function confirmarReceta(id) {
  await api(`/recetas/${id}`, { method: 'PUT', body: { confirmado: 1 } });
  toast('Receta confirmada'); router();
}
async function toggleReceta(id, activo) {
  await api(`/recetas/${id}`, { method: 'PUT', body: { activo } });
  toast(activo ? 'Receta activada' : 'Receta desactivada'); router();
}
function openCopiarRecetaModal(fromProductId) {
  api('/productos').then(productos => {
    const candidatos = productos.filter(p => p.id !== fromProductId);
    openModal(`
      <h2>Copiar recetas a otros talles/variantes</h2>
      <p class="sub">Elegí uno o más productos destino (por ejemplo, los otros talles de la misma prenda). Se copian todas las recetas activas del producto de origen.</p>
      <div class="scroll-box">
        ${candidatos.map(p => `
          <label style="display:block;padding:4px 0">
            <input type="checkbox" class="copiar-target" value="${p.id}"> ${esc(p.sku)} — ${esc(p.nombre)} ${p.variante ? '(' + esc(p.variante) + ')' : ''}
          </label>`).join('')}
      </div>
      <div class="modal-actions">
        <button class="ghost" onclick="closeModal()">Cancelar</button>
        <button class="primary" onclick="submitCopiarReceta(${fromProductId})">Copiar a los seleccionados</button>
      </div>
    `);
  });
}
async function submitCopiarReceta(fromProductId) {
  const toProductIds = Array.from(document.querySelectorAll('.copiar-target:checked')).map(el => Number(el.value));
  if (!toProductIds.length) { toast('Elegí al menos un producto destino', 'err'); return; }
  const r = await api('/recetas/copiar', { method: 'POST', body: { fromProductId, toProductIds } });
  toast(`${r.copiadas} recetas copiadas a ${toProductIds.length} producto(s)`);
  closeModal(); router();
}

// ============================================================================
// PRODUCCIÓN / REPOSICIÓN
// ============================================================================
const PROD_ESTADOS = ['Pendiente', 'Preparando archivo', 'Enviado a imprimir', 'Impreso', 'Recibido', 'Cancelado'];

function openNuevaProduccionModal(stampId, codigo, sugerido) {
  openModal(`
    <h2>+ Agregar a producción — ${esc(codigo)}</h2>
    <form id="form-produccion" class="form-grid">
      <label>Cantidad necesaria *<input name="cantidad_necesaria" type="number" min="1" value="${sugerido || 50}"></label>
      <label class="full">Notas<textarea name="notas" rows="2"></textarea></label>
    </form>
    <div class="modal-actions">
      <button class="ghost" onclick="closeModal()">Cancelar</button>
      <button class="primary" onclick="submitNuevaProduccion(${stampId})">Crear orden</button>
    </div>`);
}
async function submitNuevaProduccion(stampId) {
  const form = document.getElementById('form-produccion');
  const fd = new FormData(form);
  const raw = Object.fromEntries(fd.entries());
  const body = {
    items: [{ stamp_variant_id: stampId, cantidad_necesaria: Number(raw.cantidad_necesaria) }],
    notas: raw.notas || null,
    usuario: CURRENT_USER,
  };
  await api('/produccion', { method: 'POST', body });
  toast('Orden de producción creada');
  closeModal(); router();
}
async function cambiarEstadoProduccion(id, estado) {
  await api(`/produccion/${id}/estado`, { method: 'PUT', body: { estado } });
  toast('Estado actualizado'); router();
}
function openRecibirModal(id, cantidadSugerida) {
  openModal(`
    <h2>Marcar orden como recibida</h2>
    <form id="form-recibir" class="form-grid">
      <label>Cantidad recibida *<input name="cantidad_recibida" type="number" min="1" value="${cantidadSugerida}"></label>
    </form>
    <p class="sub">Esto ingresa automáticamente la cantidad al stock de la estampa.</p>
    <div class="modal-actions">
      <button class="ghost" onclick="closeModal()">Cancelar</button>
      <button class="primary" onclick="submitRecibir(${id})">Confirmar recepción</button>
    </div>`);
}
async function submitRecibir(id) {
  const cantidad = Number(document.querySelector('#form-recibir [name=cantidad_recibida]').value);
  try {
    await api(`/produccion/items/${id}/recibir`, { method: 'POST', body: { cantidad_recibida: cantidad, usuario: CURRENT_USER } });
    toast('Stock actualizado');
    closeModal(); router();
  } catch (e) { toast(e.message, 'err'); }
}

function orderTotalCantidad(order) {
  return (order.items || []).reduce((sum, it) => sum + Number(it.cantidad_necesaria || 0), 0);
}

function orderSummaryText(order) {
  const items = order.items || [];
  const preview = items.slice(0, 3).map(it => it.codigo).join(', ');
  const extra = items.length > 3 ? ` +${items.length - 3} mas` : '';
  return preview + extra;
}

function orderThumbsHtml(order) {
  const items = order.items || [];
  return `<div class="order-thumbs">
    ${items.slice(0, 4).map(it => stampThumbHtml(it)).join('')}
    ${items.length > 4 ? `<span class="order-more">+${items.length - 4}</span>` : ''}
  </div>`;
}

function orderStatusHtml(order) {
  if (order.estado === 'Recibido' || order.estado === 'Cancelado') {
    return `<span class="badge">${esc(order.estado)}</span>`;
  }
  return `<select onchange="cambiarEstadoProduccion(${order.id}, this.value)">
    ${PROD_ESTADOS.filter(e => e !== 'Recibido').map(e => `<option value="${e}" ${order.estado === e ? 'selected' : ''}>${e}</option>`).join('')}
  </select>`;
}

function productionOrderRowsHtml(ordenes) {
  if (ordenes.length === 0) return '<div class="empty">No hay ordenes de produccion todavia.</div>';
  return `
    <table><thead><tr><th>Orden</th><th>Resumen</th><th>Items</th><th>Total</th><th>Estado</th><th>Acciones</th></tr></thead>
    <tbody>${ordenes.map(o => `
      <tr>
        <td><strong>#${o.id}</strong><div class="sub">${fmtDate(o.created_at)}</div></td>
        <td>
          ${orderThumbsHtml(o)}
          <div class="sub">${esc(orderSummaryText(o))}</div>
        </td>
        <td>${(o.items || []).length}</td>
        <td>${orderTotalCantidad(o)}</td>
        <td>${orderStatusHtml(o)}</td>
        <td>
          <button class="sm" onclick="openOrdenProduccionDetalle(${o.id})">Ver detalle</button>
          <button class="sm" onclick="window.open('api/produccion/${o.id}/pedido.html', '_blank')">HTML</button>
          <button class="sm" onclick="window.open('api/produccion/${o.id}/pedido.csv')">CSV</button>
          ${o.estado !== 'Recibido' && o.estado !== 'Cancelado' ? `<button class="sm primary" onclick="recibirOrdenCompleta(${o.id})">Recibir todo</button>` : ''}
          ${o.estado !== 'Recibido' && o.estado !== 'Cancelado' ? `<button class="sm danger" onclick="eliminarOrdenProduccion(${o.id})">Eliminar</button>` : ''}
        </td>
      </tr>`).join('')}</tbody></table>`;
}

async function openOrdenProduccionDetalle(id) {
  const ordenes = await api('/produccion?estado_activo=1');
  const order = ordenes.find(o => Number(o.id) === Number(id));
  if (!order) { toast('No encontre esa orden activa', 'err'); return; }
  openModal(`
    <h2>Orden #${order.id}</h2>
    <div class="sub">${fmtDate(order.created_at)} - ${(order.items || []).length} item(s) - total ${orderTotalCantidad(order)}</div>
    <div style="max-height:440px;overflow:auto;margin-top:12px">
      <table><thead><tr><th></th><th>Estampa</th><th>Cantidad</th><th>Recibido</th><th></th></tr></thead>
      <tbody>${(order.items || []).map(it => `
        <tr>
          <td>${stampThumbHtml(it)}</td>
          <td>${esc(it.codigo)}${typeChipHtml(it)} - ${esc(it.nombre)}</td>
          <td>${it.cantidad_necesaria}</td>
          <td>${it.cantidad_recibida || 0}</td>
          <td>${order.estado !== 'Recibido' && order.estado !== 'Cancelado' ? `<button class="sm primary" onclick="openRecibirModal(${it.id}, ${Math.max(Number(it.cantidad_necesaria || 0) - Number(it.cantidad_recibida || 0), 1)})">Recibir</button>` : ''}</td>
        </tr>`).join('')}</tbody></table>
    </div>
    <div class="modal-actions">
      <button class="ghost" onclick="closeModal()">Cerrar</button>
      <button onclick="window.open('api/produccion/${order.id}/pedido.html', '_blank')">HTML</button>
      <button onclick="window.open('api/produccion/${order.id}/pedido.csv')">CSV</button>
      ${order.estado !== 'Recibido' && order.estado !== 'Cancelado' ? `<button class="primary" onclick="recibirOrdenCompleta(${order.id})">Recibir todo</button>` : ''}
    </div>
  `);
}

async function recibirOrdenCompleta(id) {
  const ordenes = await api('/produccion?estado_activo=1');
  const order = ordenes.find(o => Number(o.id) === Number(id));
  if (!order) { toast('No encontre esa orden activa', 'err'); return; }
  const pendientes = (order.items || [])
    .map(it => ({ id: it.id, cantidad: Number(it.cantidad_necesaria || 0) - Number(it.cantidad_recibida || 0) }))
    .filter(it => it.cantidad > 0);
  if (!pendientes.length) { toast('La orden ya esta recibida'); return; }
  const ok = confirm(`Recibir todos los items pendientes de la orden #${id}?`);
  if (!ok) return;
  try {
    for (const it of pendientes) {
      await api(`/produccion/items/${it.id}/recibir`, { method: 'POST', body: { cantidad_recibida: it.cantidad, usuario: CURRENT_USER } });
    }
    toast(`Orden #${id} recibida`);
    closeModal();
    router();
  } catch (e) { toast(e.message, 'err'); }
}

// ============================================================================
// PENDIENTES
// ============================================================================
async function renderPendientes(view) {
  const [archivos, duplicados] = await Promise.all([api('/pendientes'), api('/duplicados')]);
  view.innerHTML = `
    <div class="topbar"><div><h1>⚠️ Archivos pendientes de revisión</h1><div class="sub">Todo lo que necesita un vistazo humano</div></div></div>

    <div class="panel">
      <div class="panel-title"><h2>Archivos que no se pudieron catalogar automáticamente (${archivos.length})</h2></div>
      ${archivos.length === 0 ? '<div class="empty">No hay archivos pendientes. 🎉</div>' : `
      <table><thead><tr><th>Archivo</th><th>Motivo</th><th>Detalle</th><th></th></tr></thead>
      <tbody>${archivos.map(a => `
        <tr><td style="word-break:break-all">${esc(a.archivo_original)}</td><td>${esc(a.motivo)}</td>
        <td style="max-width:320px">${esc((a.detalle || '').slice(0, 200))}</td>
        <td><button class="sm" onclick="resolverPendiente(${a.id})">Marcar resuelto</button></td></tr>`).join('')}</tbody></table>`}
    </div>

    <div class="panel">
      <div class="panel-title"><h2>Posibles duplicados (${duplicados.length})</h2></div>
      ${duplicados.length === 0 ? '<div class="empty">No se detectaron posibles duplicados.</div>' : `
      <table><thead><tr><th></th><th>Estampa A</th><th></th><th>Estampa B</th><th>Motivo</th><th></th></tr></thead>
      <tbody>${duplicados.map(d => `
        <tr>
          <td><img class="thumb" src="${previewUrl(d.preview_a)}" onerror="this.style.visibility='hidden'"></td>
          <td>${esc(d.codigo_a)} — ${esc(d.nombre_a)}</td>
          <td><img class="thumb" src="${previewUrl(d.preview_b)}" onerror="this.style.visibility='hidden'"></td>
          <td>${esc(d.codigo_b)} — ${esc(d.nombre_b)}</td>
          <td>${esc(d.motivo)}</td>
          <td><button class="sm" onclick="resolverDuplicado(${d.id}, 'son_distintos')">Son distintos</button></td>
        </tr>`).join('')}</tbody></table>`}
    </div>
  `;
}
async function resolverPendiente(id) {
  await api(`/pendientes/${id}/resolver`, { method: 'POST' });
  toast('Marcado como resuelto'); router();
}

// ============================================================================
// CARGA INICIAL DE STOCK (galeria rapida + CSV masivo)
// ============================================================================
let _cargaInicialIdx = 0;
let _cargaInicialLista = [];
let _cargaInicialQuery = '';
let _cargaInicialSearchActive = false;

function cargaInicialItemThumbHtml(item) {
  if (isSizeStamp(item) && !item.previsualizacion) {
    return `<span class="size-thumb ci-pick-thumb">${esc(item.talle_tamano || item.variante || item.codigo)}</span>`;
  }
  return `<img class="thumb ci-pick-thumb" src="${previewUrl(item.previsualizacion)}" onerror="this.style.visibility='hidden'">`;
}

async function renderCargaInicial(view) {
  const query = _cargaInicialQuery;
  _cargaInicialLista = await api('/carga-inicial/pendientes' + (query ? `?q=${encodeURIComponent(query)}` : ''));
  if (_cargaInicialIdx >= _cargaInicialLista.length) _cargaInicialIdx = 0;

  view.innerHTML = `
    <div class="topbar">
      <div><h1>🔢 Carga inicial de stock</h1><div class="sub">Nunca se inventa una cantidad: cada carga queda registrada como movimiento "ajuste_inicial"</div></div>
      <div><input id="carga-inicial-q" placeholder="Buscar por código o nombre…" value="${esc(query)}"></div>
    </div>

    <div class="panel">
      <div class="panel-title"><h2>Pendientes de contar (${_cargaInicialLista.length})</h2></div>
      ${_cargaInicialLista.length === 0 ? '<div class="empty">No quedan estampas pendientes de contar. 🎉</div>' : `
        <div class="ci-layout">
          <div class="ci-current">
            <div class="ci-current-preview">
              ${isSizeStamp(_cargaInicialLista[_cargaInicialIdx]) && !_cargaInicialLista[_cargaInicialIdx].previsualizacion
                ? `<div class="size-thumb" style="width:260px;height:260px;font-size:60px">${esc(_cargaInicialLista[_cargaInicialIdx].talle_tamano || _cargaInicialLista[_cargaInicialIdx].variante || _cargaInicialLista[_cargaInicialIdx].codigo)}</div>`
                : `<img id="ci-preview" class="ci-preview" src="${previewUrl(_cargaInicialLista[_cargaInicialIdx].previsualizacion)}" onerror="this.style.visibility='hidden'">`}
            </div>
            <div class="ci-current-form">
              <div style="font-size:20px;font-weight:600">${esc(_cargaInicialLista[_cargaInicialIdx].codigo)}${typeChipHtml(_cargaInicialLista[_cargaInicialIdx])} — ${esc(_cargaInicialLista[_cargaInicialIdx].nombre)}</div>
              <div class="sub" style="margin-bottom:16px">${esc(_cargaInicialLista[_cargaInicialIdx].variante || '')} · estampa ${_cargaInicialIdx + 1} de ${_cargaInicialLista.length}</div>
              <form id="ci-form" onsubmit="return guardarCargaInicial(event)">
                <label class="sub">Cantidad contada</label>
                <input id="ci-cantidad" class="ci-number" type="number" min="0" step="1" required autofocus>
                <br><br>
                <label class="sub">Stock mínimo</label>
                <input id="ci-minimo" class="ci-minimum" type="number" min="0" step="1" value="${_cargaInicialLista[_cargaInicialIdx].stock_minimo ?? 2}">
                <br><br>
                <button type="button" class="sm" onclick="cargaInicialAnterior()">Anterior</button>
                <button type="submit">Guardar y siguiente (Enter)</button>
                <button type="button" class="sm" onclick="saltarCargaInicial()">Siguiente</button>
              </form>
            </div>
          </div>
          <div class="ci-picker">
            <div class="sub" style="margin-bottom:8px">Elegí cuál cargar</div>
            <div class="ci-picker-list">
              ${_cargaInicialLista.map((item, idx) => `
                <button class="ci-pick ${idx === _cargaInicialIdx ? 'active' : ''}" onclick="seleccionarCargaInicial(${idx})">
                  ${cargaInicialItemThumbHtml(item)}
                  <span><strong>${esc(item.codigo)}${typeChipHtml(item)}</strong><small>${esc(item.nombre)}</small></span>
                </button>
              `).join('')}
            </div>
          </div>
        </div>
      `}
    </div>

    <div class="panel">
      <div class="panel-title"><h2>Carga masiva por CSV</h2></div>
      <div class="sub">Formato: <code>codigo,cantidad,stock_minimo</code> (una fila por estampa, con o sin encabezado). Cada fila se procesa por separado.</div>
      <textarea id="ci-csv" rows="6" class="ci-csv" placeholder="codigo,cantidad,stock_minimo"></textarea>
      <br><br>
      <button onclick="cargarCsvInicial()">Procesar CSV</button>
      <div id="ci-csv-resultado" style="margin-top:12px"></div>
    </div>
  `;

  const qInput = document.getElementById('carga-inicial-q');
  if (qInput) {
    qInput.addEventListener('focus', () => { _cargaInicialSearchActive = true; });
    qInput.addEventListener('input', debounce(() => {
      _cargaInicialQuery = qInput.value.trim();
      _cargaInicialIdx = 0;
      renderCargaInicial(document.getElementById('view'));
    }, 250));
  }
  const cant = document.getElementById('ci-cantidad');
  if (qInput && (_cargaInicialSearchActive || query)) {
    qInput.focus();
    qInput.setSelectionRange(qInput.value.length, qInput.value.length);
  } else if (cant) {
    cant.focus();
  }
}

async function guardarCargaInicial(ev) {
  ev.preventDefault();
  const item = _cargaInicialLista[_cargaInicialIdx];
  if (!item) return false;
  const cantidad = Number(document.getElementById('ci-cantidad').value);
  const stock_minimo = Number(document.getElementById('ci-minimo').value || 0);
  try {
    await api(`/carga-inicial/${item.id}`, { method: 'POST', body: { cantidad, stock_minimo, usuario: CURRENT_USER } });
    toast(`Guardado: ${item.codigo} = ${cantidad}`);
    router();
  } catch (e) {
    toast(e.message, 'err');
  }
  return false;
}

function seleccionarCargaInicial(idx) {
  _cargaInicialIdx = idx;
  router();
}

function saltarCargaInicial() {
  _cargaInicialIdx = (_cargaInicialIdx + 1) % Math.max(_cargaInicialLista.length, 1);
  router();
}

function cargaInicialAnterior() {
  const total = Math.max(_cargaInicialLista.length, 1);
  _cargaInicialIdx = (_cargaInicialIdx - 1 + total) % total;
  router();
}

async function cargarCsvInicial() {
  const csv = document.getElementById('ci-csv').value.trim();
  if (!csv) { toast('Pegá contenido CSV primero', 'err'); return; }
  try {
    const r = await api('/carga-inicial/csv', { method: 'POST', body: { csv, usuario: CURRENT_USER } });
    document.getElementById('ci-csv-resultado').innerHTML = `
      <div class="sub">${r.exitosas} de ${r.procesadas} filas cargadas correctamente.</div>
      <table><thead><tr><th>Código</th><th>Resultado</th></tr></thead><tbody>
        ${r.resultados.map(x => `<tr><td>${esc(x.codigo)}</td><td>${x.ok ? '✅ OK' : '❌ ' + esc(x.error)}</td></tr>`).join('')}
      </tbody></table>`;
    toast(`CSV procesado: ${r.exitosas}/${r.procesadas} OK`);
    router();
  } catch (e) {
    toast(e.message, 'err');
  }
}

// ============================================================================
// CONCILIACION
// ============================================================================
async function renderConciliacion(view) {
  const r = await api('/conciliacion/resumen');
  view.innerHTML = `
    <div class="topbar"><div><h1>🧩 Conciliación</h1><div class="sub">Chequeos cruzados entre el stock de estampas y los pedidos de incognito-ventas</div></div></div>

    ${r.nota ? `<div class="panel"><div class="empty">⚠️ ${esc(r.nota)}</div></div>` : ''}

    <div class="panel">
      <div class="panel-title"><h2>Stock negativo (${r.stock_negativo.length})</h2></div>
      ${r.stock_negativo.length === 0 ? '<div class="empty">Sin inconsistencias de stock negativo.</div>' : `
      <table><thead><tr><th>Código</th><th>Nombre</th><th>Cantidad</th></tr></thead><tbody>
        ${r.stock_negativo.map(s => `<tr><td>${esc(s.codigo)}</td><td>${esc(s.nombre)}</td><td style="color:#f66">${s.cantidad_disponible}</td></tr>`).join('')}
      </tbody></table>`}
    </div>

    <div class="panel">
      <div class="panel-title"><h2>Productos sin receta activa (${r.productos_sin_receta.length})</h2></div>
      ${r.productos_sin_receta.length === 0 ? '<div class="empty">Todos los productos activos tienen receta.</div>' : `
      <table><thead><tr><th>SKU</th><th>Nombre</th></tr></thead><tbody>
        ${r.productos_sin_receta.map(p => `<tr><td>${esc(p.sku)}</td><td>${esc(p.nombre)}</td></tr>`).join('')}
      </tbody></table>`}
    </div>

    <div class="panel">
      <div class="panel-title"><h2>Eventos fallidos (${r.eventos_fallidos.length})</h2></div>
      ${r.eventos_fallidos.length === 0 ? '<div class="empty">Sin eventos fallidos registrados.</div>' : `
      <table><thead><tr><th>Pedido</th><th>Evento</th><th>Fecha</th><th></th></tr></thead><tbody>
        ${r.eventos_fallidos.map(e => `<tr><td>${esc(e.pedido_id)}</td><td>${esc(e.evento)}</td><td>${fmtDate(e.created_at)}</td>
          <td><button class="sm" onclick="reintentarEvento('${esc(e.pedido_id)}')">Reintentar</button></td></tr>`).join('')}
      </tbody></table>`}
    </div>

    <div class="panel">
      <div class="panel-title"><h2>Eventos con advertencia (${r.eventos_con_advertencia.length})</h2></div>
      ${r.eventos_con_advertencia.length === 0 ? '<div class="empty">Sin advertencias pendientes.</div>' : `
      <table><thead><tr><th>Pedido</th><th>Evento</th><th>Fecha</th></tr></thead><tbody>
        ${r.eventos_con_advertencia.map(e => `<tr><td>${esc(e.pedido_id)}</td><td>${esc(e.evento)}</td><td>${fmtDate(e.created_at)}</td></tr>`).join('')}
      </tbody></table>`}
    </div>

    <div class="panel">
      <div class="panel-title"><h2>Consumo aplicado por pedido (últimos 100)</h2></div>
      <table><thead><tr><th>Pedido</th><th>Líneas</th><th>Total aplicado</th><th>Última actualización</th></tr></thead><tbody>
        ${r.consumo_por_pedido.map(c => `<tr><td>${esc(c.pedido_id)}</td><td>${c.lineas}</td><td>${c.total_aplicado}</td><td>${fmtDate(c.ultima_actualizacion)}</td></tr>`).join('')}
      </tbody></table>
    </div>
  `;
}

async function reintentarEvento(pedidoId) {
  const evento = prompt('Evento a reintentar (preparacion_a_armado / armado_a_preparacion / cancelacion / modificacion):', 'preparacion_a_armado');
  if (!evento) return;
  try {
    await api(`/conciliacion/reintentar/${encodeURIComponent(pedidoId)}`, { method: 'POST', body: { evento, usuario: CURRENT_USER, items: [] } });
    toast('Reintento enviado');
    router();
  } catch (e) {
    toast(e.message, 'err');
  }
}

// ============================================================================
// PRODUCCION - pedido visual de faltantes
// ============================================================================
let STOCK_PANEL_COLLAPSED = localStorage.getItem('stockdtf_stock_collapsed') === '1';
let VENTAS_PANEL_COLLAPSED = localStorage.getItem('stockdtf_ventas_collapsed') === '1';

function stockPanelTitleHtml(title) {
  return `
    <div class="panel-title collapsible-title">
      <h2>${esc(title)}</h2>
      <button class="icon-btn collapse-btn" onclick="toggleStockPanel()" title="${STOCK_PANEL_COLLAPSED ? 'Mostrar' : 'Ocultar'} faltantes por stock">
        ${STOCK_PANEL_COLLAPSED ? '▸' : '▾'}
      </button>
    </div>`;
}

function ventasPanelTitleHtml(title) {
  return `
    <div class="panel-title collapsible-title">
      <h2>${esc(title)}</h2>
      <button class="icon-btn collapse-btn" onclick="toggleVentasPanel()" title="${VENTAS_PANEL_COLLAPSED ? 'Mostrar' : 'Ocultar'} pendientes de ventas">
        ${VENTAS_PANEL_COLLAPSED ? '▸' : '▾'}
      </button>
    </div>`;
}

function toggleStockPanel() {
  STOCK_PANEL_COLLAPSED = !STOCK_PANEL_COLLAPSED;
  localStorage.setItem('stockdtf_stock_collapsed', STOCK_PANEL_COLLAPSED ? '1' : '0');
  const panel = document.getElementById('stock-faltantes-panel');
  if (!panel) return;
  const body = panel.querySelector('.collapsible-body');
  const btn = panel.querySelector('.collapse-btn');
  if (body) body.classList.toggle('hidden', STOCK_PANEL_COLLAPSED);
  if (btn) {
    btn.textContent = STOCK_PANEL_COLLAPSED ? '▸' : '▾';
    btn.title = `${STOCK_PANEL_COLLAPSED ? 'Mostrar' : 'Ocultar'} faltantes por stock`;
  }
}

function toggleVentasPanel() {
  VENTAS_PANEL_COLLAPSED = !VENTAS_PANEL_COLLAPSED;
  localStorage.setItem('stockdtf_ventas_collapsed', VENTAS_PANEL_COLLAPSED ? '1' : '0');
  const panel = document.getElementById('ventas-pendientes-panel');
  if (!panel) return;
  const body = panel.querySelector('.collapsible-body');
  const btn = panel.querySelector('.collapse-btn');
  if (body) body.classList.toggle('hidden', VENTAS_PANEL_COLLAPSED);
  if (btn) {
    btn.textContent = VENTAS_PANEL_COLLAPSED ? '▸' : '▾';
    btn.title = `${VENTAS_PANEL_COLLAPSED ? 'Mostrar' : 'Ocultar'} pendientes de ventas`;
  }
}

async function renderProduccion(view) {
  const [ordenes, stockSug] = await Promise.all([
    api('/produccion?estado_activo=1'),
    api('/produccion/sugerencias?fuente=stock&incluir_cubiertas=1'),
  ]);
  const candidatas = stockSug.items || [];
  const stockPorPedir = candidatas.filter(c => Number(c.cantidad_sugerida || 0) > 0);

  view.innerHTML = `
    <div class="topbar">
      <div><h1>Produccion / Reposicion</h1><div class="sub">Pedidos visuales para imprimir o reponer estampas</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="primary" onclick="openPedidoFaltantesModal('stock')" ${stockPorPedir.length ? '' : 'disabled'}>Pedido por stock</button>
        <button id="btn-pedido-ventas" class="primary" onclick="openPedidoFaltantesModal('ventas')" disabled>Pedido por ventas</button>
        <button id="btn-pedido-ambas" onclick="openPedidoFaltantesModal('ambas')" ${stockPorPedir.length ? '' : 'disabled'}>Pedido combinado</button>
      </div>
    </div>

    <div id="stock-faltantes-panel" class="panel">
      ${stockPanelTitleHtml(`Faltantes por stock (${candidatas.length})`)}
      <div class="collapsible-body ${STOCK_PANEL_COLLAPSED ? 'hidden' : ''}">
        ${candidatas.length === 0 ? '<div class="empty">No hay estampas con stock bajo o agotado.</div>' : `
        <table><thead><tr><th></th><th>Codigo</th><th>Stock</th><th>Minimo</th><th>Faltante</th><th>Ya pedido</th><th>A pedir</th><th></th></tr></thead>
        <tbody>${candidatas.map(c => {
          return `<tr>
            <td>${stampThumbHtml(c)}</td>
            <td>${esc(c.codigo)}${typeChipHtml(c)} - ${esc(c.nombre)}</td>
            <td>${c.cantidad_disponible ?? 0}</td><td>${c.stock_minimo || 0}</td><td>${c.faltante_stock ?? c.cantidad_sugerida}</td><td>${c.ya_pedido || 0}</td><td>${c.cantidad_sugerida}</td>
            <td>${Number(c.cantidad_sugerida || 0) > 0
              ? `<button class="sm primary" onclick="openNuevaProduccionModal(${c.id}, '${esc(c.codigo)}', ${c.cantidad_sugerida})">Agregar</button>`
              : '<span class="sub">Cubierto</span>'}</td>
          </tr>`;
        }).join('')}</tbody></table>`}
      </div>
    </div>

    <div id="ventas-pendientes-panel" class="panel">
      ${ventasPanelTitleHtml('Pendientes de ventas')}
      <div class="collapsible-body ${VENTAS_PANEL_COLLAPSED ? 'hidden' : ''}">
        ${loadingHtml('Cargando pendientes de ventas...')}
      </div>
    </div>

    <div class="panel">
      <div class="panel-title"><h2>Ordenes de produccion</h2></div>
      ${productionOrderRowsHtml(ordenes)}
    </div>
  `;
  loadProduccionVentasPanel(stockPorPedir.length > 0);
}

function ventasPendientesHtml(ventasSug) {
  const ventasPendientes = ventasSug.items || [];
  return `
    ${ventasPanelTitleHtml(`Pendientes de ventas (${ventasPendientes.length})`)}
    <div class="collapsible-body ${VENTAS_PANEL_COLLAPSED ? 'hidden' : ''}">
      ${ventasSug.nota ? `<div class="notice">${esc(ventasSug.nota)}</div>` : ''}
      ${ventasPendientes.length === 0 ? '<div class="empty">No hay pendientes de ventas para pedir.</div>' : `
      <table><thead><tr><th></th><th>Codigo</th><th>Stock</th><th>Ya pedido</th><th>Cantidad ventas</th></tr></thead>
      <tbody>${ventasPendientes.map(c => `<tr>
        <td>${stampThumbHtml(c)}</td>
        <td>${esc(c.codigo)}${typeChipHtml(c)} - ${esc(c.nombre)}</td><td>${c.cantidad_disponible ?? 0}</td><td>${c.ya_pedido || 0}</td><td>${c.cantidad_sugerida}</td>
      </tr>`).join('')}</tbody></table>`}
    </div>
  `;
}

async function loadProduccionVentasPanel(hasStockCandidates) {
  const panel = document.getElementById('ventas-pendientes-panel');
  if (!panel) return;
  try {
    const ventasSug = await api('/produccion/sugerencias?fuente=ventas');
    const ventasPendientes = ventasSug.items || [];
    panel.innerHTML = ventasPendientesHtml(ventasSug);
    const btnVentas = document.getElementById('btn-pedido-ventas');
    const btnAmbas = document.getElementById('btn-pedido-ambas');
    if (btnVentas) btnVentas.disabled = ventasPendientes.length === 0;
    if (btnAmbas) btnAmbas.disabled = !hasStockCandidates && ventasPendientes.length === 0;
  } catch (e) {
    panel.innerHTML = `${ventasPanelTitleHtml('Pendientes de ventas')}<div class="collapsible-body ${VENTAS_PANEL_COLLAPSED ? 'hidden' : ''}"><div class="empty">No pude consultar ventas: ${esc(e.message)}</div></div>`;
  }
}

async function eliminarOrdenProduccion(id) {
  const ok = confirm(`Eliminar la orden #${id}? Se va a quitar de la lista y dejar como cancelada.`);
  if (!ok) return;
  await api(`/produccion/${id}`, { method: 'DELETE' });
  toast(`Orden #${id} eliminada`);
  router();
}

async function openPedidoFaltantesModal(fuente = 'stock') {
  openModal(`
    <h2>Generar pedido visual</h2>
    ${loadingHtml('Preparando pedido...')}
  `);
  let sugerencias;
  try {
    sugerencias = await api(`/produccion/sugerencias?fuente=${encodeURIComponent(fuente)}`);
  } catch (e) {
    openModal(`
      <h2>Generar pedido visual</h2>
      <div class="empty">No pude preparar el pedido: ${esc(e.message)}</div>
      <div class="modal-actions"><button class="ghost" onclick="closeModal()">Cerrar</button></div>
    `);
    return;
  }
  const candidatas = (sugerencias.items || []).filter(c => Number(c.cantidad_sugerida || 0) > 0);
  if (!candidatas.length) {
    closeModal();
    toast(sugerencias.nota || 'No hay estampas para pedir', sugerencias.nota ? 'err' : 'ok');
    return;
  }
  openModal(`
    <h2>Generar pedido visual</h2>
    <div class="sub">Fuente: ${esc(fuente)}. Ajusta cantidades y crea una orden. Lo ya pedido en ordenes activas se descuenta para no repetir.</div>
    ${sugerencias.nota ? `<div class="notice">${esc(sugerencias.nota)}</div>` : ''}
    <div style="max-height:420px;overflow:auto;margin-top:10px">
      <table><thead><tr><th></th><th>Estampa</th><th>Stock</th><th>Ya pedido</th><th>Cantidad</th></tr></thead>
      <tbody>${candidatas.map(c => {
        return `<tr>
          <td>${stampThumbHtml(c)}</td>
          <td>${esc(c.codigo)}${typeChipHtml(c)}<div class="sub">${esc(c.fuente || fuente)}</div></td><td>${c.cantidad_disponible ?? 0}</td><td>${c.ya_pedido || 0}</td>
          <td><input class="pedido-faltante" data-id="${c.id}" type="number" min="0" step="1" value="${c.cantidad_sugerida}" style="width:90px"></td>
        </tr>`;
      }).join('')}</tbody></table>
    </div>
    <div class="modal-actions">
      <button class="ghost" onclick="closeModal()">Cancelar</button>
      <button class="primary" onclick="submitPedidoFaltantes()">Crear orden</button>
    </div>
  `);
}

async function submitPedidoFaltantes() {
  const items = Array.from(document.querySelectorAll('.pedido-faltante'))
    .map(el => ({ stamp_variant_id: Number(el.dataset.id), cantidad_necesaria: Number(el.value) }))
    .filter(it => it.cantidad_necesaria > 0);
  if (!items.length) { toast('No hay cantidades para pedir', 'err'); return; }
  const r = await api('/produccion', { method: 'POST', body: { items, notas: 'Pedido visual de faltantes', usuario: CURRENT_USER } });
  toast(`Orden #${r.id} creada`);
  closeModal();
  window.open(`api/produccion/${r.id}/pedido.html`, '_blank');
  router();
}

// ============================================================================
// MOVIMIENTOS - lote con confirmacion
// ============================================================================
const MOV_BATCH = new Map();

async function renderMovimientos(view) {
  view.innerHTML = `
    <div class="topbar"><div><h1>Movimientos de stock</h1><div class="sub">Carga rapida y confirmacion por lote</div></div></div>
    <div class="panel" id="mov-batch-panel"></div>
    <div class="panel">
      <div class="toolbar">
        <input class="search" id="mov-q" placeholder="Buscar por nombre, codigo, variante...">
        <select id="mov-estado">
          <option value="">Todos los estados</option>
          <option>Disponible</option><option>Stock bajo</option><option>Agotada</option>
          <option>Pendiente de revision</option><option>Discontinuada</option>
        </select>
      </div>
      <div class="toolbar">
        <textarea id="mov-import" class="ci-csv" rows="3" placeholder="Pegar codigo,cantidad desde el pedido visual"></textarea>
        <button onclick="importarMovimientosCsv()">Agregar desde codigo</button>
      </div>
      <div id="mov-content">${loadingHtml('Cargando movimientos...')}</div>
    </div>
  `;
  document.getElementById('mov-q').addEventListener('input', debounce(loadMovimientos, 250));
  document.getElementById('mov-estado').addEventListener('change', loadMovimientos);
  renderMovBatch();
  await loadMovimientos();
}

async function loadMovimientos() {
  const q = document.getElementById('mov-q').value.trim();
  const estado = document.getElementById('mov-estado').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (estado) params.set('estado', estado);
  params.set('sort', 'codigo');
  const rows = await api('/estampas?' + params.toString());
  const content = document.getElementById('mov-content');
  if (rows.length === 0) {
    content.innerHTML = '<div class="empty">No se encontraron estampas con esos filtros.</div>';
    return;
  }
  content.innerHTML = `
    <table><thead><tr>
      <th></th><th>Codigo</th><th>Nombre</th><th>Stock</th><th>Estado</th><th>Ajustar</th>
    </tr></thead>
    <tbody>${rows.map(r => {
      const pending = MOV_BATCH.get(String(r.id))?.cantidad || 0;
      return `<tr>
        <td>${stampThumbHtml(r)}</td>
        <td style="cursor:pointer;font-weight:600" onclick="openDetalle(${r.id})">${esc(r.codigo)}</td>
        <td style="cursor:pointer" onclick="openDetalle(${r.id})">${esc(r.nombre)}</td>
        <td>${r.cantidad_disponible ?? '<span class="sub">pendiente</span>'}</td>
        <td><span class="${badgeClass(r.estado)}">${esc(r.estado)}</span></td>
        <td class="stepper-cell">
          <button class="step-btn minus" onclick="addMovBatch(${r.id}, '${esc(r.codigo)}', -1)">-</button>
          <span class="step-count">${pending > 0 ? '+' : ''}${pending}</span>
          <button class="step-btn plus" onclick="addMovBatch(${r.id}, '${esc(r.codigo)}', 1)">+</button>
        </td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

function addMovBatch(id, codigo, delta) {
  const key = String(id);
  const current = MOV_BATCH.get(key) || { id, codigo, cantidad: 0 };
  current.cantidad += delta;
  if (current.cantidad === 0) MOV_BATCH.delete(key);
  else MOV_BATCH.set(key, current);
  renderMovBatch();
  loadMovimientos();
}

function renderMovBatch() {
  const panel = document.getElementById('mov-batch-panel');
  if (!panel) return;
  const items = Array.from(MOV_BATCH.values()).sort((a, b) => a.codigo.localeCompare(b.codigo));
  panel.innerHTML = `
    <div class="panel-title"><h2>Cambios para confirmar (${items.length})</h2></div>
    ${items.length === 0 ? '<div class="empty">Toca + o - en las estampas, o pega el codigo del pedido visual.</div>' : `
      <table><thead><tr><th>Codigo</th><th>Cantidad</th><th></th></tr></thead><tbody>
      ${items.map(it => `<tr><td>${esc(it.codigo)}</td><td>${it.cantidad > 0 ? '+' : ''}${it.cantidad}</td>
        <td><button class="sm" onclick="MOV_BATCH.delete('${it.id}'); renderMovBatch(); loadMovimientos();">Quitar</button></td></tr>`).join('')}
      </tbody></table>
      <div class="toolbar" style="margin-top:12px">
        <input id="mov-batch-motivo" placeholder="Motivo" value="Ingreso por pedido DTF">
        <button class="primary" onclick="confirmarMovBatch()">Confirmar todo</button>
        <button onclick="MOV_BATCH.clear(); renderMovBatch(); loadMovimientos();">Vaciar</button>
      </div>`}
  `;
}

async function importarMovimientosCsv() {
  const text = document.getElementById('mov-import').value.trim().replace(/\\n/g, '\n');
  if (!text) { toast('Pega codigo,cantidad primero', 'err'); return; }
  const rows = await api('/estampas?sort=codigo');
  const byCode = new Map(rows.map(r => [r.codigo, r]));
  let added = 0;
  for (const line of text.split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean) continue;
    const parts = clean.includes(',')
      ? clean.split(',')
      : clean.includes(';')
        ? clean.split(';')
        : clean.split(/\t|\s{2,}/);
    const [codigoRaw, cantidadRaw] = parts.map(s => (s || '').trim().replace(/^"|"$/g, ''));
    if (!codigoRaw || codigoRaw.toLowerCase() === 'codigo' || codigoRaw.toLowerCase().includes('codigo para ingresar')) continue;
    const cantidad = Number(cantidadRaw);
    const stamp = byCode.get(codigoRaw);
    if (!stamp || !Number.isFinite(cantidad) || cantidad === 0) continue;
    const key = String(stamp.id);
    const current = MOV_BATCH.get(key) || { id: stamp.id, codigo: stamp.codigo, cantidad: 0 };
    current.cantidad += cantidad;
    if (current.cantidad === 0) MOV_BATCH.delete(key); else MOV_BATCH.set(key, current);
    added++;
  }
  toast(`${added} lineas agregadas`);
  renderMovBatch();
  loadMovimientos();
}

async function confirmarMovBatch() {
  const items = Array.from(MOV_BATCH.values()).map(it => ({
    stamp_variant_id: it.id,
    codigo: it.codigo,
    cantidad: Math.abs(it.cantidad),
    tipo: it.cantidad > 0 ? 'ingreso' : 'perdida',
  }));
  if (!items.length) return;
  const motivo = document.getElementById('mov-batch-motivo')?.value || 'Movimiento por lote';
  try {
    const r = await api('/movimientos/lote', { method: 'POST', body: { items, usuario: CURRENT_USER, motivo } });
    const fallidas = r.resultados.filter(x => !x.ok);
    if (fallidas.length) {
      toast(`${r.exitosas}/${r.procesadas} aplicadas. Revisa errores.`, 'err');
    } else {
      toast(`${r.exitosas} movimientos aplicados`);
      MOV_BATCH.clear();
    }
    renderMovBatch();
    loadMovimientos();
  } catch (e) { toast(e.message, 'err'); }
}
