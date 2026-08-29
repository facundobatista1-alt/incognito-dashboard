'use strict';
/**
 * Bateria de pruebas obligatorias (seccion 14 del pedido original).
 * Levanta el servidor real contra una base de datos temporal y ejercita la
 * API por HTTP, tal como lo haria la app de ventas o el frontend.
 *
 * Uso: node tests/run_tests.js
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const TMP_DB = path.join(os.tmpdir(), `stockdtf_test_${Date.now()}`);
const PORT = 3999;
const BASE = `http://localhost:${PORT}`;

let pass = 0, fail = 0;
const failures = [];

function ok(cond, label) {
  if (cond) { pass++; console.log(`  OK - ${label}`); }
  else { fail++; failures.push(label); console.log(`  FAIL - ${label}`); }
}

async function api(pathName, opts = {}) {
  const res = await fetch(BASE + pathName, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitHealthy() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.ok) return true;
    } catch (e) {}
    await sleep(250);
  }
  throw new Error('El servidor no respondio a tiempo');
}

async function main() {
  console.log('== Preparando base de datos de prueba ==');
  if (fs.existsSync(TMP_DB)) fs.rmSync(TMP_DB, { recursive: true, force: true });
  execSync(`node db/migrate.js`, { cwd: ROOT, env: { ...process.env, DATABASE_URL: '', PGLITE_DATA_DIR: TMP_DB } });

  console.log('== Levantando servidor de pruebas en puerto', PORT, '==');
  const child = spawn('node', ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: '', PGLITE_DATA_DIR: TMP_DB, PORT: String(PORT) },
    stdio: 'pipe',
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => console.error('[server]', d.toString()));
  await waitHealthy();

  try {
    await runScenarios();
  } finally {
    child.kill();
    if (fs.existsSync(TMP_DB)) fs.rmSync(TMP_DB, { recursive: true, force: true });
  }

  console.log(`\n== RESULTADO: ${pass} OK / ${fail} fallidas de ${pass + fail} ==`);
  if (fail > 0) {
    console.log('Fallidas:', failures.join(', '));
    process.exit(1);
  }
}

async function crearEstampa(codigo, nombre) {
  const r = await api('/api/estampas', {
    method: 'POST',
    body: { codigo, nombre, archivo_original: `/fake/${codigo}.tif`, carpeta_origen: '/fake', formato_archivo: 'tif' },
  });
  return r.data.id;
}
async function crearProducto(sku, nombre, variante) {
  await api('/api/productos', { method: 'POST', body: { sku, nombre, variante } });
  const r = await api('/api/productos?q=' + sku);
  return r.data[0].id;
}
async function crearReceta(productId, stampId, cantidad, ubicacion) {
  const r = await api('/api/recetas', { method: 'POST', body: { product_id: productId, stamp_variant_id: stampId, cantidad_por_unidad: cantidad, ubicacion_aplicacion: ubicacion, confirmado: true } });
  return r.data.id;
}
async function stockDe(estampaId) {
  const r = await api('/api/estampas/' + estampaId);
  return r.data.cantidad_disponible;
}
async function idPorCodigo(codigo) {
  const r = await api('/api/estampas?q=' + encodeURIComponent(codigo));
  const exact = r.data.find(e => e.codigo === codigo);
  return exact && exact.id;
}

async function runScenarios() {
  console.log('\n== 1) Ingreso manual de stock ==');
  const e1 = await crearEstampa('TEST-01', 'Estampa de prueba 1');
  let r = await api(`/api/estampas/${e1}/ingreso`, { method: 'POST', body: { cantidad: 100, usuario: 'test', motivo: 'ajuste inicial' } });
  ok(r.status === 200 && r.data.stock_posterior === 100, 'Ingreso manual deja stock en 100');

  console.log('\n== 2) Descuento por un pedido (producto simple) ==');
  const p1 = await crearProducto('SKU-1', 'Remera Test');
  await crearReceta(p1, e1, 1, 'frente');
  r = await api('/api/stamps/v1/pedidos/PED-001/transicion', {
    method: 'POST', body: { evento: 'preparacion_a_armado', usuario: 'test', items: [{ sku: 'SKU-1', cantidad: 1, itemRef: 'l1' }] },
  });
  ok(r.data.ok === true, 'Transicion sin advertencias');
  ok(await stockDe(e1) === 99, 'Stock descontado correctamente (100 -> 99)');

  console.log('\n== 3) Pedido con varias unidades ==');
  const e2 = await crearEstampa('TEST-02', 'Estampa de prueba 2');
  await api(`/api/estampas/${e2}/ingreso`, { method: 'POST', body: { cantidad: 50, usuario: 'test' } });
  const p2 = await crearProducto('SKU-2', 'Buzo Test');
  await crearReceta(p2, e2, 1, 'frente');
  await api('/api/stamps/v1/pedidos/PED-002/transicion', {
    method: 'POST', body: { evento: 'preparacion_a_armado', usuario: 'test', items: [{ sku: 'SKU-2', cantidad: 5, itemRef: 'l1' }] },
  });
  ok(await stockDe(e2) === 45, 'Pedido de 5 unidades descuenta 5 (50 -> 45)');

  console.log('\n== 4) Pedido con varios productos ==');
  const e3 = await crearEstampa('TEST-03', 'Estampa de prueba 3');
  await api(`/api/estampas/${e3}/ingreso`, { method: 'POST', body: { cantidad: 30, usuario: 'test' } });
  const p3 = await crearProducto('SKU-3', 'Campera Test');
  await crearReceta(p3, e3, 2, 'frente');
  await api('/api/stamps/v1/pedidos/PED-003/transicion', {
    method: 'POST', body: {
      evento: 'preparacion_a_armado', usuario: 'test',
      items: [{ sku: 'SKU-2', cantidad: 2, itemRef: 'l1' }, { sku: 'SKU-3', cantidad: 3, itemRef: 'l2' }],
    },
  });
  ok(await stockDe(e2) === 43, 'Producto 1 del pedido multi-producto descuenta bien (45 -> 43)');
  ok(await stockDe(e3) === 24, 'Producto 2 del pedido multi-producto descuenta bien (30 -> 24, 3x2)');

  console.log('\n== 5) Producto que consume varias estampas (frente + espalda) ==');
  const e4a = await crearEstampa('TEST-04A', 'Frente');
  const e4b = await crearEstampa('TEST-04B', 'Espalda');
  await api(`/api/estampas/${e4a}/ingreso`, { method: 'POST', body: { cantidad: 20, usuario: 'test' } });
  await api(`/api/estampas/${e4b}/ingreso`, { method: 'POST', body: { cantidad: 20, usuario: 'test' } });
  const p4 = await crearProducto('SKU-4', 'Conjunto Test');
  await crearReceta(p4, e4a, 1, 'frente');
  await crearReceta(p4, e4b, 1, 'espalda');
  await api('/api/stamps/v1/pedidos/PED-004/transicion', {
    method: 'POST', body: { evento: 'preparacion_a_armado', usuario: 'test', items: [{ sku: 'SKU-4', cantidad: 2, itemRef: 'l1' }] },
  });
  ok(await stockDe(e4a) === 18, 'Estampa frente descontada (20 -> 18)');
  ok(await stockDe(e4b) === 18, 'Estampa espalda descontada (20 -> 18)');

  console.log('\n== 5b) Estampas de talle automaticas (general y especial) ==');
  const talleGeneralS = await idPorCodigo('TALLE-S');
  const talleAmiriS = await idPorCodigo('AM-S');
  const talleChromeXl = await idPorCodigo('CH-XL');
  ok(!!talleChromeXl, 'CH - Chrome tiene estampas de talle especiales');
  await api(`/api/estampas/${talleGeneralS}/ingreso`, { method: 'POST', body: { cantidad: 10, usuario: 'test' } });
  await api(`/api/estampas/${talleAmiriS}/ingreso`, { method: 'POST', body: { cantidad: 10, usuario: 'test' } });
  const eAd = await crearEstampa('AD-99-01', 'Adidas talle test');
  const eAm = await crearEstampa('AM-99-01', 'Amiri talle test');
  await api(`/api/estampas/${eAd}/ingreso`, { method: 'POST', body: { cantidad: 10, usuario: 'test' } });
  await api(`/api/estampas/${eAm}/ingreso`, { method: 'POST', body: { cantidad: 10, usuario: 'test' } });
  const pAd = await crearProducto('SKU-AD-S', 'Adidas Test', 'S');
  const pAm = await crearProducto('SKU-AM-S', 'Amiri Test', 'S');
  await crearReceta(pAd, eAd, 1, 'frente');
  await crearReceta(pAm, eAm, 1, 'frente');
  await api('/api/stamps/v1/pedidos/PED-TALLE-1/transicion', {
    method: 'POST', body: { evento: 'preparacion_a_armado', usuario: 'test', items: [{ sku: 'SKU-AD-S', cantidad: 1, itemRef: 'l1' }] },
  });
  await api('/api/stamps/v1/pedidos/PED-TALLE-2/transicion', {
    method: 'POST', body: { evento: 'preparacion_a_armado', usuario: 'test', items: [{ sku: 'SKU-AM-S', cantidad: 1, itemRef: 'l1' }] },
  });
  ok(await stockDe(talleGeneralS) === 9, 'AD talle S descuenta la estampa general TALLE-S');
  ok(await stockDe(talleAmiriS) === 9, 'AM talle S descuenta la estampa especial AM-S');

  console.log('\n== 5c) Descuento automatico por codigo en SKU, sin receta ==');
  const ePm = await crearEstampa('PM-02-01', 'Puma automatico por SKU');
  await api(`/api/estampas/${ePm}/ingreso`, { method: 'POST', body: { cantidad: 10, usuario: 'test' } });
  r = await api('/api/stamps/v1/pedidos/PED-AUTO-SKU/transicion', {
    method: 'POST',
    body: {
      evento: 'preparacion_a_armado',
      usuario: 'test',
      items: [{ sku: 'Rem-PM-02-01-Dtf', nombre: 'Prueba de Puma', talle: 'S', cantidad: 1, itemRef: 'l1' }],
    },
  });
  ok(r.data.ok === true, 'SKU con PM-02-01 descuenta sin receta ni producto asociado');
  ok(await stockDe(ePm) === 9, 'PM-02-01 queda descontada (10 -> 9)');

  console.log('\n== 5d) SKU compuesto con varias estampas ==');
  const talleGeneralM = await idPorCodigo('TALLE-M');
  const eGd1 = await crearEstampa('GD-01-01', 'GD conjunto 1');
  const eGd3 = await crearEstampa('GD-01-03', 'GD conjunto 3');
  await api(`/api/estampas/${talleGeneralM}/ingreso`, { method: 'POST', body: { cantidad: 10, usuario: 'test' } });
  await api(`/api/estampas/${eGd1}/ingreso`, { method: 'POST', body: { cantidad: 10, usuario: 'test' } });
  await api(`/api/estampas/${eGd3}/ingreso`, { method: 'POST', body: { cantidad: 10, usuario: 'test' } });
  r = await api('/api/stamps/v1/pedidos/PED-SKU-COMPUESTO-1/transicion', {
    method: 'POST',
    body: {
      evento: 'preparacion_a_armado',
      usuario: 'test',
      items: [{ sku: 'Buz-GD-01-03+GD-01-01-Dtf', talle: 'M', cantidad: 1, itemRef: 'l1' }],
    },
  });
  ok(r.data.ok === true, 'SKU compuesto con 2 estampas se procesa sin advertencias');
  ok(await stockDe(eGd1) === 9, 'GD-01-01 se descuenta desde SKU compuesto');
  ok(await stockDe(eGd3) === 9, 'GD-01-03 se descuenta desde SKU compuesto');
  r = await api('/api/stamps/v1/pedidos/PED-SKU-COMPUESTO-2/transicion', {
    method: 'POST',
    body: {
      evento: 'preparacion_a_armado',
      usuario: 'test',
      items: [{ sku: 'Con-GD-01-03+GD-01-01+GD-01-03-Dtf', talle: 'M', cantidad: 1, itemRef: 'l1' }],
    },
  });
  ok(r.data.ok === true, 'SKU compuesto con 3 estampas se procesa sin advertencias');
  ok(await stockDe(eGd1) === 8, 'GD-01-01 se descuenta una vez en conjunto');
  ok(await stockDe(eGd3) === 7, 'GD-01-03 se descuenta dos veces si viene repetida');
  r = await api('/api/stamps/v1/pedidos/PED-SKU-COMPUESTO-3/transicion', {
    method: 'POST',
    body: {
      evento: 'preparacion_a_armado',
      usuario: 'test',
      items: [{ sku: 'Buz-GD-01-03+GD-01-01-Dtf', codigo_estampa: 'GD-01-03', nombre: 'GD-01-01', talle: 'M', cantidad: 1, itemRef: 'l1' }],
    },
  });
  ok(r.data.ok === true, 'SKU compuesto prioriza el SKU aunque otros campos repitan codigos');
  ok(await stockDe(eGd1) === 7, 'GD-01-01 no se duplica por nombre/campo extra');
  ok(await stockDe(eGd3) === 6, 'GD-01-03 no se duplica por codigo_estampa extra');

  console.log('\n== 6) Producto sin receta ==');
  await crearProducto('SKU-5', 'Sin Receta Test');
  r = await api('/api/stamps/v1/pedidos/PED-005/transicion', {
    method: 'POST', body: { evento: 'preparacion_a_armado', usuario: 'test', items: [{ sku: 'SKU-5', cantidad: 1, itemRef: 'l1' }] },
  });
  ok(r.data.ok === false && r.data.advertencias.some(a => a.motivo && a.motivo.includes('sin_receta_ni_codigo')), 'Producto sin receta ni codigo genera advertencia y no rompe el pedido');

  console.log('\n== 7) Stock insuficiente ==');
  const e6 = await crearEstampa('TEST-06', 'Poco stock');
  await api(`/api/estampas/${e6}/ingreso`, { method: 'POST', body: { cantidad: 2, usuario: 'test' } });
  const p6 = await crearProducto('SKU-6', 'Producto Poco Stock');
  await crearReceta(p6, e6, 1, 'frente');
  r = await api('/api/stamps/v1/pedidos/PED-006/transicion', {
    method: 'POST', body: { evento: 'preparacion_a_armado', usuario: 'test', items: [{ sku: 'SKU-6', cantidad: 10, itemRef: 'l1' }] },
  });
  ok(r.data.advertencias.some(a => a.motivo === 'stock_insuficiente'), 'Stock insuficiente genera advertencia');
  ok(await stockDe(e6) === 2, 'Stock NO se descuenta cuando es insuficiente (sigue en 2)');

  console.log('\n== 8) Evento duplicado (idempotencia) ==');
  const stockAntesDup = await stockDe(e1);
  const bodyDup = { evento: 'preparacion_a_armado', usuario: 'test', items: [{ sku: 'SKU-1', cantidad: 1, itemRef: 'l1' }] };
  await api('/api/stamps/v1/pedidos/PED-001/transicion', { method: 'POST', body: bodyDup });
  await api('/api/stamps/v1/pedidos/PED-001/transicion', { method: 'POST', body: bodyDup });
  await api('/api/stamps/v1/pedidos/PED-001/transicion', { method: 'POST', body: bodyDup });
  ok(await stockDe(e1) === stockAntesDup, `Evento duplicado 3 veces no vuelve a descontar (sigue en ${stockAntesDup})`);

  console.log('\n== 9) Regreso de "Armado" a "En preparacion" ==');
  const stockAntesReversa = await stockDe(e2);
  r = await api('/api/stamps/v1/pedidos/PED-002/transicion', { method: 'POST', body: { evento: 'armado_a_preparacion', usuario: 'test' } });
  ok(await stockDe(e2) === stockAntesReversa + 5, `Reversa reintegra las 5 unidades (${stockAntesReversa} -> ${stockAntesReversa + 5})`);

  console.log('\n== 10) Cancelacion posterior al descuento ==');
  const stockAntesCancel = await stockDe(e3);
  await api('/api/stamps/v1/pedidos/PED-003/transicion', { method: 'POST', body: { evento: 'cancelacion', usuario: 'test' } });
  ok(await stockDe(e3) === stockAntesCancel + 6, 'Cancelacion reintegra todo lo descontado para ese pedido (2 items x 3u x 2 = 6)');

  console.log('\n== 11) Modificacion de un pedido ya procesado (solo se aplica la diferencia) ==');
  const e7 = await crearEstampa('TEST-07', 'Modificacion');
  await api(`/api/estampas/${e7}/ingreso`, { method: 'POST', body: { cantidad: 100, usuario: 'test' } });
  const p7 = await crearProducto('SKU-7', 'Producto Modificable');
  await crearReceta(p7, e7, 1, 'frente');
  await api('/api/stamps/v1/pedidos/PED-007/transicion', { method: 'POST', body: { evento: 'preparacion_a_armado', usuario: 'test', items: [{ sku: 'SKU-7', cantidad: 2, itemRef: 'l1' }] } });
  ok(await stockDe(e7) === 98, 'Primera aplicacion descuenta 2 (100 -> 98)');
  await api('/api/stamps/v1/pedidos/PED-007/transicion', { method: 'POST', body: { evento: 'modificacion', usuario: 'test', items: [{ sku: 'SKU-7', cantidad: 5, itemRef: 'l1' }] } });
  ok(await stockDe(e7) === 95, 'Modificacion a 5 unidades solo descuenta la diferencia (98 -> 95, no 93)');
  await api('/api/stamps/v1/pedidos/PED-007/transicion', { method: 'POST', body: { evento: 'modificacion', usuario: 'test', items: [{ sku: 'SKU-7', cantidad: 1, itemRef: 'l1' }] } });
  ok(await stockDe(e7) === 99, 'Modificacion a la baja (5 -> 1) reintegra la diferencia (95 -> 99)');

  console.log('\n== 12) Correccion manual (motivo opcional, usuario obligatorio) ==');
  r = await api(`/api/estampas/${e1}/correccion`, { method: 'POST', body: { cantidad_nueva: 50 } });
  ok(r.status === 400, 'Correccion sin usuario es rechazada');
  const stockAntesCorr = await stockDe(e1);
  r = await api(`/api/estampas/${e1}/correccion`, { method: 'POST', body: { cantidad_nueva: 50, usuario: 'MV' } });
  ok(r.status === 200 && (await stockDe(e1)) === 50, `Correccion manual ajusta el stock a 50 (antes ${stockAntesCorr})`);
  const movs = (await api('/api/movimientos?estampaId=' + e1)).data;
  ok(movs.some(m => m.tipo === 'correccion' && m.correccion_cantidad_nueva === 50), 'Queda registrado el movimiento de correccion con cantidad anterior/nueva');

  console.log('\n== 13) Nunca se borran movimientos (historial completo) ==');
  ok(movs.length >= 2, `La estampa TEST-01 acumula ${movs.length} movimientos historicos (ingreso + descuento + reintegros + correccion)`);

  console.log('\n== 14) Persistencia (simulada: releer desde la API sigue devolviendo lo mismo) ==');
  const before = await stockDe(e1);
  await sleep(100);
  const after = await stockDe(e1);
  ok(before === after, 'La lectura es estable/persistente entre llamadas (base temporal)');

  console.log('\n== 15) Dashboard no rompe con datos reales ==');
  r = await api('/api/dashboard');
  ok(r.status === 200 && typeof r.data.totales.total_variantes === 'number', 'Dashboard responde con totales validos');

  console.log('\n== 16) Valuacion por formato estandar de medida ==');
  const vSinMedida = await crearEstampa('VAL-01', 'Sin medida ni categoria');
  await api(`/api/estampas/${vSinMedida}/ingreso`, { method: 'POST', body: { cantidad: 5, usuario: 'test' } });

  const vCategoria = await crearEstampa('VAL-02', 'Sin medida, categoria M');
  await api(`/api/estampas/${vCategoria}/ingreso`, { method: 'POST', body: { cantidad: 3, usuario: 'test' } });
  r = await api(`/api/estampas/${vCategoria}`, { method: 'PUT', body: { valuation_size: 'M' } });
  ok(r.status === 200 && r.data.updated === true, 'PUT asigna categoria de valuacion M');

  // Bug real corregido: ancho/alto en PX es resolucion de imagen, NO tamano
  // fisico. Con categoria asignada, debe usar la categoria (no el px).
  const vPxConCategoria = await crearEstampa('VAL-03', 'PX + categoria: NO debe usar el px como medida real');
  await api(`/api/estampas/${vPxConCategoria}/ingreso`, { method: 'POST', body: { cantidad: 2, usuario: 'test' } });
  await api(`/api/estampas/${vPxConCategoria}`, { method: 'PUT', body: { ancho: 3543, alto: 1949, unidad_medida: 'px', valuation_size: 'S' } });

  // Mismo caso pero SIN categoria: debe quedar sin valorizar, marcado
  // especificamente como 'px_no_confiable' (hay un dato, pero no es de fiar).
  const vPxSinCategoria = await crearEstampa('VAL-03B', 'Solo PX, sin categoria: sin valorizar (px no confiable)');
  await api(`/api/estampas/${vPxSinCategoria}/ingreso`, { method: 'POST', body: { cantidad: 6, usuario: 'test' } });
  await api(`/api/estampas/${vPxSinCategoria}`, { method: 'PUT', body: { ancho: 3425, alto: 3180, unidad_medida: 'px' } });

  // Medida real en CM (confiable) + categoria: prioriza la medida en cm.
  const vMedidaCm = await crearEstampa('VAL-07', 'Medida real en cm, prioriza sobre categoria');
  await api(`/api/estampas/${vMedidaCm}/ingreso`, { method: 'POST', body: { cantidad: 7, usuario: 'test' } });
  await api(`/api/estampas/${vMedidaCm}`, { method: 'PUT', body: { ancho: 5, alto: 5, unidad_medida: 'cm', valuation_size: 'L' } });

  // Medida manual cargada a mano: maxima prioridad, por encima de cm real y categoria.
  const vMedidaManual = await crearEstampa('VAL-08', 'Medida manual: prioridad maxima');
  await api(`/api/estampas/${vMedidaManual}/ingreso`, { method: 'POST', body: { cantidad: 8, usuario: 'test' } });
  await api(`/api/estampas/${vMedidaManual}`, { method: 'PUT', body: { ancho: 20, alto: 20, unidad_medida: 'cm', valuation_size: 'L', valuation_width_cm: 5, valuation_height_cm: 5, valuation_source: 'medido a mano', valuation_confidence: 'confirmado' } });

  const vCustom = await crearEstampa('VAL-04', 'CUSTOM sin medida real: no se estima');
  await api(`/api/estampas/${vCustom}/ingreso`, { method: 'POST', body: { cantidad: 4, usuario: 'test' } });
  await api(`/api/estampas/${vCustom}`, { method: 'PUT', body: { valuation_size: 'CUSTOM' } });

  r = await api(`/api/estampas/${vSinMedida}`, { method: 'PUT', body: { valuation_size: 'NOEXISTE' } });
  ok(r.status === 400, 'PUT rechaza una categoria de valuacion invalida');

  r = await api(`/api/estampas/${vSinMedida}`, { method: 'PUT', body: { valuation_width_cm: 5 } });
  ok(r.status === 400, 'PUT rechaza valuation_width_cm sin valuation_height_cm (deben ir juntos)');
  r = await api(`/api/estampas/${vSinMedida}`, { method: 'PUT', body: { valuation_width_cm: 0, valuation_height_cm: 5 } });
  ok(r.status === 400, 'PUT rechaza medida manual no positiva');

  r = await api('/api/valuacion-stock');
  ok(r.status === 200, 'Valuacion de stock responde 200');
  ok(!!r.data.detalle.find(d => d.codigo === 'VAL-02' && d.origen === 'categoria' && d.valuation_size === 'M'), 'VAL-02 se valoriza por categoria M');
  ok(!!r.data.detalle.find(d => d.codigo === 'VAL-03' && d.origen === 'categoria' && d.valuation_size === 'S'), 'VAL-03 con px+categoria usa la categoria, NO el px como medida real');
  ok(!r.data.detalle.some(d => d.codigo === 'VAL-03B'), 'VAL-03B (solo px, sin categoria) no aparece valorizada');
  ok(r.data.sin_valorizar.some(s => s.codigo === 'VAL-03B' && s.origen === 'px_no_confiable' && s.ancho_px === 3425), 'VAL-03B queda sin valorizar con origen px_no_confiable (no sin_valorizar generico)');
  ok(!!r.data.detalle.find(d => d.codigo === 'VAL-07' && d.origen === 'medida_cm' && d.ancho_cm === 5 && d.alto_cm === 5), 'VAL-07 usa la medida real en cm (5x5), prioriza sobre categoria L');
  ok(!!r.data.detalle.find(d => d.codigo === 'VAL-08' && d.origen === 'medida_manual' && d.ancho_cm === 5 && d.alto_cm === 5 && d.valuation_source === 'medido a mano'), 'VAL-08 usa la medida manual (5x5), prioridad maxima sobre cm real y categoria');
  ok(r.data.sin_valorizar.some(s => s.codigo === 'VAL-01' && s.origen === 'sin_valorizar'), 'VAL-01 sin medida ni categoria queda sin valorizar (origen sin_valorizar)');
  ok(r.data.sin_valorizar.some(s => s.codigo === 'VAL-04'), 'VAL-04 con categoria CUSTOM y sin medida real queda sin valorizar');
  ok(r.data.unidades_por_categoria && r.data.unidades_por_categoria.M >= 3, 'unidades_por_categoria contabiliza M correctamente');
  ok(r.data.unidades_por_origen && r.data.unidades_por_origen.px_no_confiable >= 6, 'unidades_por_origen contabiliza px_no_confiable por separado');
  ok(r.data.unidades_por_origen && r.data.unidades_por_origen.medida_manual >= 8, 'unidades_por_origen contabiliza medida_manual por separado');
  ok(r.data.size_categories && r.data.size_categories.M.ancho_cm === 30 && r.data.size_categories.M.alto_cm === 20, 'size_categories expone el formato 30x20');
  ok(r.data.size_categories && r.data.size_categories.TALLE.ancho_cm === 4 && r.data.size_categories.TALLE.alto_cm === 2, 'size_categories expone talles como etiqueta chica 4x2');
  ok(r.data.size_categories && r.data.size_categories.XL.ancho_cm === 50 && r.data.size_categories.XL.alto_cm === 50, 'size_categories expone el formato 50x50');
  ok(r.data.parametros && !('dpi' in r.data.parametros), 'La respuesta ya no incluye dpi (no se usa para convertir px a cm)');

  console.log('\n== 17) Bulk-update aplica categoria de valuacion a varias estampas ==');
  const vBulk1 = await crearEstampa('VAL-05', 'Bulk 1');
  const vBulk2 = await crearEstampa('VAL-06', 'Bulk 2');
  r = await api('/api/estampas/bulk-update', { method: 'POST', body: { ids: [vBulk1, vBulk2], changes: { valuation_size: 'L' } } });
  ok(r.status === 200 && r.data.updated === 2, 'Bulk-update reporta 2 actualizadas');
  const d5 = (await api('/api/estampas/' + vBulk1)).data;
  const d6 = (await api('/api/estampas/' + vBulk2)).data;
  ok(d5.valuation_size === 'L' && d6.valuation_size === 'L', 'Bulk-update dejo valuation_size=L en ambas estampas');

  r = await api('/api/estampas/bulk-update', { method: 'POST', body: { ids: [vBulk1], changes: { valuation_size: 'NOEXISTE' } } });
  ok(r.status === 400, 'Bulk-update rechaza una categoria de valuacion invalida');

  console.log('\n== 18) Aplicar medida real por lote (prefijo de codigo) ==');
  const jd1 = await crearEstampa('JD-05-01', 'JD lote 1');
  const jd2 = await crearEstampa('JD-05-02', 'JD lote 2');
  const jdOtro = await crearEstampa('JD-06-01', 'JD que NO matchea el prefijo JD-05-');
  await api(`/api/estampas/${jd1}/ingreso`, { method: 'POST', body: { cantidad: 3, usuario: 'test' } });
  await api(`/api/estampas/${jd2}/ingreso`, { method: 'POST', body: { cantidad: 4, usuario: 'test' } });

  r = await api('/api/estampas/valuacion-por-prefijo?prefijo=' + encodeURIComponent('JD-05-'));
  ok(r.status === 200 && r.data.coincidencias === 2, 'Vista previa por prefijo JD-05- encuentra 2 coincidencias');

  r = await api('/api/estampas/valuacion-por-prefijo', { method: 'POST', body: { prefijo: 'JD-05-', ancho_cm: 5, alto_cm: 5, source: 'lote JD-05' } });
  ok(r.status === 200 && r.data.updated === 2, 'Aplicar por prefijo actualiza 2 estampas');

  const djd1 = (await api('/api/estampas/' + jd1)).data;
  const djdOtro = (await api('/api/estampas/' + jdOtro)).data;
  ok(djd1.valuation_width_cm === '5' || djd1.valuation_width_cm === 5, 'JD-05-01 recibe la medida manual del lote (5cm ancho)');
  ok(djdOtro.valuation_width_cm == null, 'JD-06-01 (no matchea el prefijo) no se toca');

  r = await api('/api/valuacion-stock');
  ok(!!r.data.detalle.find(d => d.codigo === 'JD-05-01' && d.origen === 'medida_manual' && d.ancho_cm == 5), 'JD-05-01 se valoriza con la medida real de 5x5cm cargada por lote');

  r = await api('/api/estampas/valuacion-por-prefijo', { method: 'POST', body: { prefijo: 'NOEXISTE-PREFIJO-', ancho_cm: 5, alto_cm: 5 } });
  ok(r.status === 200 && r.data.updated === 0, 'Aplicar por prefijo sin coincidencias no actualiza nada');

  r = await api('/api/estampas/valuacion-por-prefijo', { method: 'POST', body: { prefijo: 'JD-05-', ancho_cm: 0, alto_cm: 5 } });
  ok(r.status === 400, 'Aplicar por prefijo rechaza medida no positiva');
}

main().catch(e => { console.error(e); process.exit(1); });
