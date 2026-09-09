'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const path = require('node:path');

function trackingClient(replies) {
  const calls = [];
  const https = {
    request(options, callback) {
      calls.push(options);
      const req = new EventEmitter();
      req.setTimeout = (ms, handler) => { req.timeoutHandler = handler; };
      req.destroy = (error) => req.emit('error', error);
      req.write = () => {};
      req.end = () => queueMicrotask(() => {
        const reply = replies.shift();
        assert.ok(reply, 'Llamada externa inesperada');
        if (reply.timeout) return req.timeoutHandler();
        const res = new EventEmitter();
        res.statusCode = reply.status || 200;
        callback(res);
        res.emit('data', JSON.stringify(reply.data));
        res.emit('end');
      });
      return req;
    }
  };
  const context = vm.createContext({
    require: (name) => { assert.equal(name, 'https'); return https; },
    module: { exports: {} }, URL, Buffer,
    process: { env: { TIENDANUBE_STORE_ID: '123', TIENDANUBE_ACCESS_TOKEN: 'fake' } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'tiendanube.js'), 'utf8'), context);
  return {
    fetch: context.module.exports.fetchOrderTracking,
    fetchPack: context.module.exports.packOrder,
    calls
  };
}

test('Tracking TN: consulta el ID real, recupera codigo clasico y solo hace GET', async () => {
  const client = trackingClient([{ data: { id: 100, number: 9000, shipping_tracking_number: '36000123' } }]);
  const result = await client.fetch({ orderId: '100', number: '9000' });
  assert.equal(result.trackingCode, '36000123');
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].method, 'GET');
  assert.equal(client.calls[0].path, '/v1/123/orders/100?aggregates=fulfillment_orders');
});

test('Tracking TN: usa fulfillment actual y descarta el cancelado', async () => {
  const client = trackingClient([{ data: { id: 100, shipping_tracking_number: 'viejo', fulfillment_orders: [
    { status: 'CANCELLED', tracking_info: { code: 'cancelado' } },
    { status: 'PACKED', tracking_info: { code: '36000456' } }
  ] } }]);
  assert.equal((await client.fetch({ orderId: 100 })).trackingCode, '36000456');
});

test('Tracking TN: busca por numero exacto sin confundir el ID interno', async () => {
  const client = trackingClient([
    { data: [{ id: 9000, number: 8000 }, { id: 100, number: 9000 }] },
    { data: { id: 100, number: 9000, shipping_tracking_number: '36000123' } }
  ]);
  assert.equal((await client.fetch({ number: 9000 })).storeOrderId, '100');
  assert.ok(client.calls.every((call) => call.method === 'GET'));
});

test('Tracking TN: no elige un pedido distinto ni un seguimiento entre varios bultos', async () => {
  await assert.rejects(trackingClient([{ data: { id: 100, number: 8000 } }]).fetch({ orderId: 100, number: 9000 }), /no coincide/);
  await assert.rejects(trackingClient([{ data: [{ id: 9000, number: 8000 }] }]).fetch({ number: 9000 }), /pedido unico/);
  await assert.rejects(trackingClient([{ data: { id: 100, fulfillment_orders: [
    { tracking_info: { code: 'uno' } }, { tracking_info: { code: 'dos' } }
  ] } }]).fetch({ orderId: 100 }), /varios seguimientos/);
});

test('Tracking TN: ausencia de codigo, autorizacion vencida y timeout', async () => {
  assert.equal((await trackingClient([{ data: { id: 100 } }]).fetch({ orderId: 100 })).trackingCode, '');
  await assert.rejects(trackingClient([{ status: 401 }]).fetch({ orderId: 100 }), /autorizacion/);
  await assert.rejects(trackingClient([{ timeout: true }]).fetch({ orderId: 100 }), /demasiado/);
});

test('Empaquetado TN: marca todos los paquetes pendientes y reutiliza los ya empaquetados', async () => {
  const client = trackingClient([
    { data: [
      { id: 'ful-1', status: 'UNPACKED' },
      { id: 'ful-2', status: 'IN_PREPARATION' },
      { id: 'ful-3', status: 'PACKED' }
    ] },
    { data: { id: 'ful-1', status: 'PACKED' } },
    { data: { id: 'ful-2', status: 'PACKED' } }
  ]);
  const result = await client.fetchPack('100');
  assert.equal(result.fulfillmentCount, 3);
  assert.equal(result.updatedCount, 2);
  assert.equal(result.alreadyPacked, false);
  assert.deepEqual(client.calls.map((call) => call.method), ['GET', 'PATCH', 'PATCH']);
  assert.match(client.calls[1].path, /\/orders\/100\/fulfillment-orders\/ful-1$/);
});

test('Empaquetado TN: no modifica un paquete que ya estaba terminado', async () => {
  const client = trackingClient([{ data: [{ id: 'ful-1', status: 'DISPATCHED' }] }]);
  const result = await client.fetchPack('100');
  assert.equal(result.alreadyPacked, true);
  assert.equal(result.updatedCount, 0);
  assert.equal(client.calls.length, 1);
});

function modalClient(orders, response) {
  const inputs = new Map(orders.map((order) => [order.id, {
    dataset: { bulkTracking: order.id }, value: order.trackingCode || '', checked: false, isConnected: true
  }]));
  const statuses = new Map(orders.map((order) => [order.id, { dataset: { bulkTrackingStatus: order.id }, textContent: '' }]));
  const listeners = {};
  const dialog = { open: true, addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener() {} };
  const confirm = { disabled: false };
  const calls = [];
  const context = vm.createContext({
    bulkLabelDialog: dialog, confirmBulkLabel: confirm,
    bulkLabelList: {
      querySelectorAll: (selector) => [...(selector === '[data-bulk-tracking]' ? inputs : statuses).values()],
      querySelector: (selector) => inputs.get(selector.match(/value="([^"]+)"/)?.[1]) || null,
      addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener() {}
    },
    CSS: { escape: (value) => String(value) },
    syncBulkLabelSelectAllState() {},
    normalize: (value) => String(value || '').toLowerCase(),
    AbortController, URLSearchParams, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      calls.push(url);
      const data = await response({ inputs, statuses, listeners, dialog, options });
      return { ok: true, json: async () => data };
    }
  });
  const source = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('async function loadBulkLabelTracking('), source.indexOf('function syncBulkLabelSelectAllState(')), context);
  return { run: () => context.loadBulkLabelTracking(orders), inputs, statuses, calls, listeners, confirm };
}

test('Modal: consulta Andreani, completa codigo y selecciona solo los que Tienda Nube reconoce', async () => {
  const orders = [
    { id: 'a', shippingCompany: 'Andreani', storeOrderId: '100' },
    { id: 'b', shippingCompany: 'Andreani', storeOrderNumber: '9001', trackingCode: 'manual' },
    { id: 'c', shippingCompany: 'Flux', storeOrderId: '102' },
    { id: 'd', shippingCompany: 'Correo Argentino', storeOrderId: '103' },
    { id: 'e', shippingCompany: 'Andreani', internalOrderNumber: '9002' }
  ];
  const modal = modalClient(orders, async () => ({ success: true, trackingCode: '36000123' }));
  const before = JSON.stringify(orders);
  await modal.run();
  assert.equal(modal.calls.length, 2);
  assert.equal(modal.inputs.get('a').value, '36000123');
  assert.equal(modal.inputs.get('a').checked, true);
  assert.equal(modal.inputs.get('b').value, '36000123');
  assert.equal(modal.inputs.get('b').checked, true);
  assert.equal(modal.inputs.get('c').value, '');
  assert.equal(modal.inputs.get('c').checked, false);
  assert.match(modal.statuses.get('e').textContent, /Sin pedido/);
  assert.equal(modal.confirm.disabled, false);
  assert.equal(JSON.stringify(orders), before, 'Abrir modal no modifica ni despacha pedidos');
});

test('Modal: conserva edicion manual y selecciona al confirmar que Tienda Nube tiene seguimiento', async () => {
  const modal = modalClient([{ id: 'a', shippingCompany: 'Andreani', storeOrderId: '100' }], async ({ inputs, listeners }) => {
    listeners.input({ target: inputs.get('a') });
    return { success: true, trackingCode: '36000123' };
  });
  await modal.run();
  assert.equal(modal.inputs.get('a').value, '');
  assert.equal(modal.inputs.get('a').checked, true);
  assert.match(modal.statuses.get('a').textContent, /obtenido/);
});

test('Modal: informa sin seguimiento y errores sin bloquear la carga manual', async () => {
  for (const response of [{ success: true, trackingCode: '' }, { success: false, error: 'Error de Tienda Nube' }]) {
    const modal = modalClient([{ id: 'a', shippingCompany: 'Andreani', storeOrderId: '100' }], async () => response);
    await modal.run();
    assert.equal(modal.inputs.get('a').value, '');
    assert.match(modal.statuses.get('a').textContent, /no tiene seguimiento|Error de Tienda Nube/);
    assert.equal(modal.confirm.disabled, false);
  }
});

test('Modal: cerrar cancela la consulta y evita completar un modal viejo', async () => {
  const modal = modalClient([{ id: 'a', shippingCompany: 'Andreani', storeOrderId: '100' }], async ({ dialog, listeners, options }) => {
    dialog.open = false;
    listeners.close();
    assert.equal(options.signal.aborted, true);
    return { success: true, trackingCode: '36000123' };
  });
  await modal.run();
  assert.equal(modal.inputs.get('a').value, '');
  assert.equal(modal.confirm.disabled, false);
});

test('Endpoint: responde solo seguimiento sin persistir ni despachar', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  let handler;
  vm.runInNewContext(source.slice(source.indexOf("app.get('/api/tiendanube/tracking'"), source.indexOf("app.post('/api/tiendanube/orders/:id/fulfill'")), {
    app: { get: (route, fn) => { handler = fn; }, post() {} },
    tn: { fetchOrderTracking: async ({ orderId }) => ({ trackingCode: '36000123', storeOrderId: orderId }) },
    console
  });
  const res = { set() {}, json(data) { this.data = data; } };
  await handler({ query: { orderId: '100' } }, res);
  assert.equal(res.data.success, true);
  assert.equal(res.data.trackingCode, '36000123');
});

test('Contador de estampas usa la misma clave para historial y pedido activo', () => {
  const source = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const body = source.slice(source.indexOf('function printStampCounts()'), source.indexOf('function backupRowMonth('));
  const context = vm.createContext({
    backupRows: [{ id: 'tn-100:0', sku: 'Rem-X-Dtf', quantity: 1, printOwner: 'FB' }],
    operationalOrders: () => [{ id: 'local-1', storeOrderId: 'tn-100', items: [{ sku: 'Rem-X-Dtf', quantity: 1, printOwner: 'FB' }] }],
    orderItems: (order) => order.items,
    isDtfSku: (sku) => /dtf$/i.test(sku),
    detailItemPrintOwner: (item) => item.printOwner || '',
    stableBackupOrderId: (order) => order.storeOrderId || order.id
  });
  vm.runInContext(body, context);
  assert.equal(context.printStampCounts().FB, 1);
  context.backupRows[0].printOwner = '';
  context.operationalOrders = () => [{ id: 'local-1', storeOrderId: 'tn-100', items: [{ sku: 'Rem-X-Dtf', quantity: 1, printOwner: '' }] }];
  assert.equal(context.printStampCounts().FB, 0, 'Quitar una estampa descuenta una sola unidad');
});

test('Pasar a despachado ya no informa el seguimiento a Tienda Nube', () => {
  const source = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const single = source.slice(source.indexOf('async function moveOrder('), source.indexOf('async function decrementOrderStock('));
  const bulk = source.slice(source.indexOf('async function confirmBulkLabelMove('), source.indexOf('function splitStreetAndNumber('));
  assert.doesNotMatch(single, /notifyTiendanubeFulfillment/);
  assert.doesNotMatch(bulk, /notifyTiendanubeFulfillment/);
});
