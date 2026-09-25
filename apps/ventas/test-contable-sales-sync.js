'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = require('./server');

const buildTransaction = app.locals.buildContableSalesTransaction;
const buildMpTransactions = app.locals.buildContableMpSalesTransactions;

test('Mercado Pago se carga en MP MV con cliente y orden, sin duplicarse al reintentar', () => {
  const input = [{ orderId: 'order-mp-1', internalNumber: '9401', customer: 'Maria Lopez', date: '2026-09-24', paymentId: '123456789' }];
  const first = buildMpTransactions(input)[0];
  const retry = buildMpTransactions(input)[0];
  assert.equal(first.id, retry.id);
  assert.equal(first.cuenta, 'MP MV');
  assert.equal(first.ingreso, 0);
  assert.equal(first.pendiente, true);
  assert.equal(first.nro_interno, '9401');
  assert.equal(first.descripcion, 'Maria Lopez | 123456789');
});

test('Mercado Pago conserva el numero de orden para la etiqueta violeta', () => {
  const [row] = buildMpTransactions([{ orderId: 'order-mp-2', internalNumber: '9402', customer: 'Juan Perez', date: '2026-09-24' }]);
  assert.equal(row.descripcion, 'Juan Perez');
  assert.equal(row.nro_interno, '9402');
});

test('Mercado Pago reintenta errores temporales sin habilitar duplicados', () => {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.match(source, /transientStatuses = new Set\(\[502, 503, 504\]\)/);
  assert.match(source, /body: JSON\.stringify\(transactions\),\s*retries: 1/);
  assert.match(source, /attempt < retries/);
  assert.match(source, /CONTABl?E_MP_SALES_ERROR/i);
});

test('Importar mayorista completa Compra desde Precios SKU sin pisar Venta', () => {
  const source = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const block = source.slice(source.indexOf('function mayoristaItemsFromCart('), source.indexOf('function appendWholesaleImportItems('));
  const context = vm.createContext({
    mayoristaNameFromCartId: () => '', mayoristaProductImage: () => '',
    storedSkuPrice: sku => sku === 'Rem-Test-Dtf' ? 7000 : 0
  });
  vm.runInContext(block, context);
  const [row] = context.mayoristaItemsFromCart([{ s: 'Rem-Test-Dtf', q: 1, precio: 15000 }], []);
  assert.equal(row.salePrice, 15000);
  assert.equal(row.purchasePrice, 7000);
});

test('El descargable de pendientes incluye pedidos y cambios en preparacion', () => {
  const source = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  assert.match(source, /function operationalOrders\(\)\s*\{\s*return \[\.\.\.orders, \.\.\.exchanges\]/);
  assert.match(source, /function downloadPendingProductsHtml\(\)\s*\{\s*const rows = operationalOrders\(\)/);
  assert.match(source, /\.filter\(\(item\) => !detailItemWasHandled\(item\)\)/);
});

test('Los cambios descuentan y restauran stock con la misma proteccion que los pedidos', () => {
  const source = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const moveBlock = source.slice(source.indexOf('async function moveOrder('), source.indexOf('async function decrementOrderStock('));
  const decrementBlock = source.slice(source.indexOf('async function decrementOrderStock('), source.indexOf('function hasRemainingStockItems('));
  const exchangeBlock = source.slice(source.indexOf('function createExchange('), source.indexOf('function collectExchangeItems('));
  const cancelBlock = source.slice(source.indexOf('async function cancelProcessedOrder('), source.indexOf('function createManualOrder('));
  assert.match(moveBlock, /currentOrder\.status === "preparacion" && nextStatus === "armado"/);
  assert.match(moveBlock, /!currentOrder\.stockDeductedAt && hasRemainingStockItems\(currentOrder\)/);
  assert.doesNotMatch(moveBlock, /recordType !== "exchange"/);
  assert.match(decrementBlock, /orderItems\(order\)/);
  assert.match(decrementBlock, /!item\.printedGarmentId && !item\.stockDeductedAt/);
  assert.match(exchangeBlock, /exchangeReturnProduct: formData\.get\("returnProduct"\)/);
  assert.match(exchangeBlock, /items\s*$/m);
  assert.match(cancelBlock, /if \(order\.stockDeductedAt && items\.length\)/);
  assert.doesNotMatch(cancelBlock, /if \(!isExchange && order\.stockDeductedAt/);
});

test('Botones de guardado esperan confirmacion y no repiten acciones si falla la nube', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const helper = source.slice(source.indexOf('async function runSavedButtonProcess('), source.indexOf('function setManualSubmitLoading('));
  let confirm;
  const messages = [];
  const context = vm.createContext({
    console: { error() {} }, window: { alert: message => messages.push(message) },
    flushRemoteSaveNow: () => new Promise(resolve => { confirm = resolve; })
  });
  vm.runInContext(helper, context);
  const button = {
    textContent: 'Guardar precio', dataset: {}, disabled: false,
    classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {}
  };
  let calls = 0;
  const pending = context.runSavedButtonProcess(button, () => { calls += 1; });
  await Promise.resolve();
  assert.equal(button.disabled, true);
  confirm(false);
  await pending;
  assert.equal(calls, 1);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Guardar precio');
  assert.match(messages[0], /confirmar el guardado/);
});

test('Procesos de botones bloquean el segundo clic y se restauran incluso si fallan', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const helper = source.slice(source.indexOf('async function runButtonProcess('), source.indexOf('function setManualSubmitLoading('));
  const context = vm.createContext({});
  vm.runInContext(helper, context);
  const button = {
    textContent: 'Usar prenda', dataset: {}, disabled: false,
    classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {}
  };
  let finish;
  let calls = 0;
  const pending = context.runButtonProcess(button, () => {
    calls += 1;
    return new Promise(resolve => { finish = resolve; });
  });
  await context.runButtonProcess(button, () => { calls += 1; });
  assert.equal(calls, 1);
  assert.equal(button.disabled, true);
  finish('saved');
  assert.equal(await pending, 'saved');
  assert.equal(button.textContent, 'Usar prenda');
  await assert.rejects(context.runButtonProcess(button, async () => { throw new Error('fallo'); }), /fallo/);
  assert.equal(button.disabled, false);
  assert.equal(button.dataset.processing, undefined);
});

test('Pasar a preparacion muestra el logo y restaura el boton al terminar o cancelar', () => {
  const source = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const helper = source.slice(source.indexOf('function setButtonSaving('), source.indexOf('function setManualSubmitLoading('));
  const context = vm.createContext({});
  vm.runInContext(helper, context);
  const classes = new Set();
  const attributes = {};
  const button = {
    textContent: 'Pasar a preparacion', dataset: {}, disabled: false,
    classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
    setAttribute: (name, value) => { attributes[name] = value; },
    removeAttribute: name => { delete attributes[name]; }
  };
  context.setButtonSaving(button, true);
  assert.equal(button.disabled, true);
  assert.equal(attributes['aria-busy'], 'true');
  assert.ok(classes.has('is-saving'));
  assert.match(button.innerHTML, /manual-save-logo/);
  assert.match(button.innerHTML, /Guardando/);
  context.setButtonSaving(button, false);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Pasar a preparacion');
  assert.equal(attributes['aria-busy'], undefined);
  assert.equal(classes.has('is-saving'), false);
  assert.match(source, /if \(approveButton\.disabled\) return;/);
  assert.match(source, /finally \{\s*setButtonSaving\(approveButton, false\);/);
});

test('Transferencia AD se carga como Venta de producto en Uala AD', () => {
  const row = buildTransaction({
    orderId: 'order-1', internalNumber: '9201', date: '2026-09-14',
    customer: 'Cliente AD', paymentMethod: 'Transferencia', account: 'AD', amount: 43100
  });
  assert.equal(row.categoria, 'Venta de producto');
  assert.equal(row.cuenta, 'Uala AD');
  assert.equal(row.nro_interno, '9201');
  assert.equal(row.ingreso, 43100);
  assert.equal(row.pendiente, false);
});

test('Transferencia EG se carga en Uala EG', () => {
  const row = buildTransaction({
    orderId: 'order-2', internalNumber: '9202', date: '2026-09-14',
    customer: 'Cliente EG', paymentMethod: 'Transferencia', account: 'EG', amount: 68998
  });
  assert.equal(row.cuenta, 'Uala EG');
  assert.equal(row.ingreso, 68998);
});

test('Abonar al recibir se carga en Flux pendiente y sin monto', () => {
  const row = buildTransaction({
    orderId: 'order-3', internalNumber: '9203', date: '2026-09-14',
    customer: 'Cliente Flux', paymentMethod: 'Abonar al recibir', account: 'EG', amount: 99999
  });
  assert.equal(row.cuenta, 'Flux');
  assert.equal(row.ingreso, 0);
  assert.equal(row.pendiente, true);
});

test('La misma venta conserva su ID para no duplicarse al reintentar', () => {
  const base = {
    orderId: 'same-order', internalNumber: '9204', date: '2026-09-14',
    customer: 'Cliente', paymentMethod: 'Transferencia', account: 'AD'
  };
  assert.equal(buildTransaction({ ...base, amount: 10000 }).id, buildTransaction({ ...base, amount: 12000 }).id);
});

test('Una transferencia sin monto se rechaza antes de escribir en Contable', () => {
  assert.throws(() => buildTransaction({
    orderId: 'order-5', internalNumber: '9205', date: '2026-09-14',
    customer: 'Cliente', paymentMethod: 'Transferencia', account: 'EG', amount: 0
  }), /mayor a cero/);
});

test('Ventas pide monto solo para transferencias y espera la confirmacion contable', () => {
  const source = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
  assert.match(html, /id="accountingSaleDialog"/);
  assert.match(source, /payment === "transferencia" \|\| payment === "abonar al recibir"/);
  assert.match(source, /accountingResult = await saveAccountingSale/);
  assert.match(source, /accountingSaleAmountField\.hidden = !info\.requiresAmount/);
});

test('Abonar al recibir pasa a preparacion aunque Contable falle', () => {
  const source = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  assert.match(source, /normalize\(approvedOrder\.paymentMethod\) !== "abonar al recibir"/);
  assert.match(source, /accountingSyncPending: true/);
  assert.match(source, /El pedido paso a preparacion, pero Contable no pudo registrar Flux/);
});
