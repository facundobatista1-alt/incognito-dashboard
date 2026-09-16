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
  const result = await client.fetch({ orderId: 100 });
  assert.equal(result.trackingCode, '36000456');
  assert.equal(result.isPacked, true);
  assert.equal(JSON.stringify(result.fulfillmentStatuses), JSON.stringify(['PACKED']));
});

test('Tracking TN: informa pendiente si algun paquete aun no esta empaquetado', async () => {
  const client = trackingClient([{ data: { id: 100, fulfillment_orders: [
    { status: 'PACKED' }, { status: 'IN_PREPARATION' }
  ] } }]);
  const result = await client.fetch({ orderId: 100 });
  assert.equal(result.isPacked, false);
  assert.equal(JSON.stringify(result.fulfillmentStatuses), JSON.stringify(['PACKED', 'IN_PREPARATION']));
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

test('Sincronizacion en vivo consulta la fecha del almacenamiento por filas', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const metaRoute = serverSource.slice(
    serverSource.indexOf("app.get('/api/app-state/meta'"),
    serverSource.indexOf("app.post('/api/app-state'"));
  const appSource = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  assert.match(metaRoute, /if \(VENTAS_ROW_STORAGE_ENABLED\)/);
  assert.match(metaRoute, /const meta = await fetchVentasMeta\(\)/);
  assert.match(metaRoute, /const savedAt = meta\?\.savedAt \|\| null/);
  assert.match(appSource, /window\.addEventListener\("focus", refreshRemoteState\)/);
  assert.match(appSource, /window\.setInterval\(refreshRemoteState, 5000\)/);
});

test('Modal de rotulos Andreani selecciona solo Armado pendiente de empaquetar', () => {
  const source = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const modal = source.slice(source.indexOf('function openAndreaniLabelsDialog('), source.indexOf('function syncAndreaniSelectAllState('));
  const loader = source.slice(source.indexOf('async function loadAndreaniPackingStatus('), source.indexOf('function syncAndreaniSelectAllState('));
  assert.match(modal, /input type="checkbox" value="\$\{escapeHtml\(order\.id\)\}">/);
  assert.match(modal, /loadAndreaniPackingStatus\(selectedOrders\)/);
  assert.match(loader, /order\.status !== "armado"/);
  assert.match(loader, /checkbox\.checked = !data\.isPacked/);
  assert.match(loader, /Sin pedido de Tienda Nube vinculado/);
});

test('Modal Flux conserva su propia regla de seleccion y puede abrirse', () => {
  const source = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const fluxModal = source.slice(
    source.indexOf('function shouldPreselectFluxShipment('),
    source.indexOf('function syncFluxSelectAllState('));
  assert.match(fluxModal, /function shouldPreselectFluxShipment\(order\)/);
  assert.match(fluxModal, /return !order\.labelReady && !order\.fluxSentAt/);
  assert.match(fluxModal, /shouldPreselectFluxShipment\(order\)/);
  assert.doesNotMatch(fluxModal, /shouldPreselectLabelModalOrder/);
});

test('Flux completa el barrio de CABA por calle y altura sin bloquear el envio', () => {
  const appSource = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const serverSource = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.match(appSource, /function fluxCabaNeighborhood\(order\)/);
  assert.match(appSource, /selectedOrders = await resolveFluxCabaNeighborhoods\(selectedOrders\)/);
  assert.match(appSource, /neighborhood,\s*barrio: neighborhood/);
  assert.match(serverSource, /async function lookupCabaNeighborhood\(street, number\)/);
  assert.match(serverSource, /ws\.usig\.buenosaires\.gob\.ar\/datos_utiles/);
  assert.match(serverSource, /app\.post\('\/api\/flux\/caba-neighborhoods'/);
});

test('Flux respeta la localidad modificada manualmente antes que la correccion por CP', () => {
  const appSource = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  assert.match(appSource, /localityManuallyEdited = previousAddress/);
  assert.match(appSource, /previousAddress\.localityManuallyEdited \|\| normalize\(locality\) !== normalize\(previousLocality\)/);
  assert.match(appSource, /if \(order\.shippingAddress\?\.localityManuallyEdited && fallback\) return fallback/);
});

test('Flux usa un identificador nuevo al reexportar un envio anterior', () => {
  const appSource = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const shipmentBuilder = appSource.slice(
    appSource.indexOf('function fluxShipmentFromOrder(order)'),
    appSource.indexOf('async function sendFluxShipments('));
  assert.match(shipmentBuilder, /order\.fluxSentAt\s*\? `\$\{id\}-R/);
  assert.match(shipmentBuilder, /idenvio: shipmentId/);
  assert.match(shipmentBuilder, /shipment_id: shipmentId/);
  assert.match(shipmentBuilder, /tracking_number: shipmentId/);
  assert.match(shipmentBuilder, /`Pedido \$\{id\} - reexportado`/);
});

test('Prendas estampadas permite ordenar todas las columnas de datos', () => {
  const appSource = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const htmlSource = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
  ['photo', 'sku', 'color', 'size', 'status', 'usedOrder', 'note'].forEach((key) => {
    assert.match(htmlSource, new RegExp(`data-printed-garment-sort="${key}"`));
  });
  assert.match(appSource, /function comparePrintedGarments\(left, right\)/);
  assert.match(appSource, /function comparePrintedGarmentSizes\(left, right\)/);
  assert.match(appSource, /setPrintedGarmentSort\(button\.dataset\.printedGarmentSort\)/);
});

test('Prendas estampadas muestra un conteo agrupado de las disponibles', () => {
  const appSource = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const htmlSource = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
  assert.match(htmlSource, /id="openPrintedGarmentCount"/);
  assert.match(htmlSource, /id="printedGarmentCountDialog"/);
  assert.match(appSource, /printedGarments\.filter\(printedGarmentIsAvailable\)/);
  assert.match(appSource, /function availablePrintedGarmentCountRows\(\)/);
  assert.match(appSource, /current\.quantity \+= 1/);
  assert.match(appSource, /openPrintedGarmentCount\?\.addEventListener\("click", openPrintedGarmentCountDialog\)/);
});

test('Pendientes agrupa Dry Fit 3D y bermudas DTF como prendas lisas', () => {
  const appSource = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const groupingSource = appSource.slice(
    appSource.indexOf('function pendingProductKey(item)'),
    appSource.indexOf('function showView(view)'));
  const context = {
    normalize: (value) => String(value || '').trim().toLowerCase()
  };
  vm.runInNewContext(groupingSource, context);

  assert.equal(context.pendingProductKey({ sku: 'REM-DFAD-3D' }), 'REM-DRY-FIT-LISAS');
  assert.equal(context.pendingProductKey({ sku: 'Rem-DF-NK-3D' }), 'REM-DRY-FIT-LISAS');
  assert.equal(context.pendingProductLabel({ sku: 'REM-DFNK-3D' }), 'Remeras Dry Fit Lisas');
  assert.equal(context.pendingProductKey({ sku: 'Ber-AB-01-Dtf' }), 'BER-*-DTF');
  assert.equal(context.pendingProductLabel({ sku: 'BER-XX-DTF' }), 'Bermudas lisas');
});

test('A definir ordena por numero descendente y permite eliminar varios pedidos seleccionados', () => {
  const appSource = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const htmlSource = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
  const pendingRenderer = appSource.slice(appSource.indexOf('function renderPending()'), appSource.indexOf('function renderBoard()'));
  assert.match(pendingRenderer, /orderSortNumber\(right\) - orderSortNumber\(left\)/);
  assert.match(htmlSource, /id="togglePendingBulkDelete"/);
  assert.match(htmlSource, /id="pendingSelectAll"/);
  assert.match(htmlSource, /id="deleteSelectedPending"/);
  assert.match(appSource, /data-pending-delete-select=/);
  assert.match(appSource, /function deleteSelectedPendingOrders\(\)/);
  assert.match(appSource, /selectedOrders\.forEach\(\(order\) =>/);
  assert.match(appSource, /if \(orderHasBackupRows\(order\)\) markBackupRowsCancelled\(order, "Cancelado"\)/);
});

test('Un identificador vacio nunca relaciona pedidos distintos en el backup', () => {
  const source = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const body = source.slice(
    source.indexOf('function backupRowMatchesOrder('),
    source.indexOf('function markBackupRowsCancelled(')
  );
  const context = vm.createContext({});
  vm.runInContext(body, context);

  const unrelatedManualRow = {
    orderId: 'old-order',
    internalOrderNumber: '8973',
    storeOrderNumber: ''
  };
  const cancelledManualOrder = {
    id: 'new-order',
    internalOrderNumber: '9092',
    storeOrderNumber: ''
  };
  assert.equal(context.backupRowMatchesOrder(unrelatedManualRow, cancelledManualOrder), false);
  assert.equal(context.backupRowMatchesOrder(unrelatedManualRow, { id: 'old-order' }), true);
  assert.equal(context.backupRowMatchesOrder(unrelatedManualRow, { internalOrderNumber: '8973' }), true);
  assert.equal(context.backupRowMatchesOrder(
    { storeOrderNumber: '81234' },
    { storeOrderNumber: '81234' }
  ), true);
});

test('Repara solo las 171 filas afectadas por la cancelacion accidental 9092', () => {
  const source = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const body = source.slice(
    source.indexOf('const ACCIDENTAL_CANCELLATION_9092_ORDER_NUMBERS'),
    source.indexOf('function markBackupRowsCancelled(')
  );
  const context = vm.createContext({ Set, Date });
  vm.runInContext(body, context);

  const originalNote = 'Cancelado previo - Corregido: el pedido nunca se saco del tablero';
  const affectedRows = Array.from({ length: 171 }, (_, index) => ({
    internalOrderNumber: index < 40 ? '8797' : '9070',
    cancelled: true,
    cancelledAt: '2026-09-14T10:00:00.000Z',
    cancelReason: 'Cancelado',
    invoice: 'No',
    notes: `${index === 0 ? originalNote : ''}${index === 0 ? ' - ' : ''}Cancelado 9092${index >= 104 ? ' - Cancelado: Cancelado' : ''}`
  }));
  const legitimateCancellation = {
    internalOrderNumber: '7603',
    cancelled: true,
    notes: 'Cancelado anterior - Cancelado 9092'
  };
  const laterCancellation = {
    internalOrderNumber: '8797',
    cancelled: true,
    notes: 'Cancelado 8797'
  };
  const timestamp = '2026-09-14T18:00:00.000Z';
  const result = context.repairAccidentalCancellation9092(
    [...affectedRows, legitimateCancellation, laterCancellation],
    timestamp
  );

  assert.equal(result.repairedCount, 171);
  assert.equal(result.rows.filter((row) => row.cancelled === false).length, 171);
  assert.equal(result.rows[0].notes, originalNote);
  assert.equal(result.rows[0].invoice, 'No');
  assert.equal(result.rows[0].rowUpdatedAt, timestamp);
  assert.equal(result.rows[171].cancelled, true);
  assert.equal(result.rows[171].notes, legitimateCancellation.notes);
  assert.equal(result.rows[172].cancelled, true);
});

test('Completa en 1000 los pedidos de Correo Argentino con envio total en cero', () => {
  const source = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const body = source.slice(
    source.indexOf('const CORREO_ARGENTINO_ZERO_SHIPPING_TOTAL'),
    source.indexOf('function repairAccidentalCancellation9092(')
  );
  const context = vm.createContext({
    Date,
    Map,
    Set,
    Number,
    normalize: (value) => String(value || '').trim().toLowerCase(),
    backupGroupKey: (row) => row.orderId || row.internalOrderNumber || row.storeOrderNumber || row.id
  });
  vm.runInContext(body, context);

  const timestamp = '2026-09-15T20:00:00.000Z';
  const result = context.repairCorreoArgentinoZeroShipping([
    { id: 'a:0', orderId: 'a', shippingCompany: 'Correo Argentino', shippingValue: 0 },
    { id: 'a:1', orderId: 'a', shippingCompany: 'Correo Argentino', shippingValue: 0 },
    { id: 'b:0', orderId: 'b', shippingCompany: 'Correo Argentino', shippingValue: 4500 },
    { id: 'c:0', orderId: 'c', shippingCompany: 'Flux', shippingValue: 0 }
  ], timestamp);

  assert.equal(result.repairedOrderCount, 1);
  assert.equal(result.repairedRowCount, 2);
  assert.equal(result.rows[0].shippingValue, 1000);
  assert.equal(result.rows[0].totalShippingValue, 2000);
  assert.equal(result.rows[0].shippingValuePerRow, true);
  assert.equal(result.rows[1].shippingValue, 1000);
  assert.equal(result.rows[1].totalShippingValue, 2000);
  assert.equal(result.rows[1].rowUpdatedAt, timestamp);
  assert.equal(result.rows[2].shippingValue, 4500);
  assert.equal(result.rows[3].shippingValue, 0);

  const secondPass = context.repairCorreoArgentinoZeroShipping(result.rows, timestamp);
  assert.equal(secondPass.repairedOrderCount, 0);
  assert.equal(secondPass.repairedRowCount, 0);

  const adrianaRepair = context.repairAdrianaIsabel8654([{
    id: 'row-8654',
    internalOrderNumber: '8654',
    paymentMethod: 'Abonar al recibir',
    account: 'Flux',
    salePrice: 0,
    totalSaleValue: 0
  }], timestamp);
  assert.equal(adrianaRepair.repairedCount, 1);
  assert.equal(adrianaRepair.rows[0].paymentMethod, 'Transferencia');
  assert.equal(adrianaRepair.rows[0].account, 'EG');
  assert.equal(adrianaRepair.rows[0].salePrice, 34000);
  assert.equal(adrianaRepair.rows[0].totalSaleValue, 34000);

  const helpers = require('./server').__ventasRowStorageTestHelpers;
  const exported = helpers.prorateBackupShippingRows(result.rows);
  assert.equal(exported[0].shippingValue, 1000);
  assert.equal(exported[1].shippingValue, 1000);
});

test('Completa en 2000 por fila los envios Andreani y Flux que estan en cero', () => {
  const source = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const body = source.slice(
    source.indexOf('const CORREO_ARGENTINO_ZERO_SHIPPING_TOTAL'),
    source.indexOf('function repairAccidentalCancellation9092(')
  );
  const context = vm.createContext({
    Date,
    Map,
    Set,
    Number,
    normalize: (value) => String(value || '').trim().toLowerCase(),
    backupGroupKey: (row) => row.orderId || row.internalOrderNumber || row.storeOrderNumber || row.id
  });
  vm.runInContext(body, context);

  const timestamp = '2026-09-15T21:00:00.000Z';
  const result = context.repairAndreaniFluxZeroShipping([
    { id: 'a:0', orderId: 'a', shippingCompany: 'Andreani', shippingValue: 0 },
    { id: 'a:1', orderId: 'a', shippingCompany: 'Andreani', shippingValue: 0 },
    { id: 'b:0', orderId: 'b', shippingCompany: 'Flux', shippingValue: 0 },
    { id: 'c:0', orderId: 'c', shippingCompany: 'Flux', shippingValue: 3500 },
    { id: 'd:0', orderId: 'd', shippingCompany: 'Correo Argentino', shippingValue: 0 }
  ], timestamp);

  assert.equal(result.repairedOrderCount, 2);
  assert.equal(result.repairedRowCount, 3);
  assert.equal(result.rows[0].shippingValue, 2000);
  assert.equal(result.rows[0].totalShippingValue, 4000);
  assert.equal(result.rows[0].shippingValuePerRow, true);
  assert.equal(result.rows[1].shippingValue, 2000);
  assert.equal(result.rows[1].totalShippingValue, 4000);
  assert.equal(result.rows[2].shippingValue, 2000);
  assert.equal(result.rows[2].totalShippingValue, 2000);
  assert.equal(result.rows[2].rowUpdatedAt, timestamp);
  assert.equal(result.rows[3].shippingValue, 3500);
  assert.equal(result.rows[4].shippingValue, 0);

  const secondPass = context.repairAndreaniFluxZeroShipping(result.rows, timestamp);
  assert.equal(secondPass.repairedOrderCount, 0);
  assert.equal(secondPass.repairedRowCount, 0);

  const helpers = require('./server').__ventasRowStorageTestHelpers;
  const exported = helpers.prorateBackupShippingRows(result.rows);
  assert.equal(exported[0].shippingValue, 2000);
  assert.equal(exported[1].shippingValue, 2000);
  assert.equal(exported[2].shippingValue, 2000);
});

test('Aplica las bajas historicas solicitadas y corrige el pedido 8654', () => {
  const helpers = require('./server').__ventasRowStorageTestHelpers;
  const removedNumbers = ['8734', '8601', '8058', '8541', '8524', '8486', '8603'];
  const state = {
    backupRows: [
      ...removedNumbers.map((internalOrderNumber) => ({
        id: `row-${internalOrderNumber}`,
        internalOrderNumber,
        shippingCompany: 'Flux'
      })),
      {
        id: 'row-8654',
        internalOrderNumber: '8654',
        customer: 'Adriana Isabel',
        paymentMethod: 'Abonar al recibir',
        account: 'Flux',
        salePrice: 0,
        totalSaleValue: 0,
        shippingCompany: 'Flux'
      }
    ]
  };

  const result = helpers.ensureHistoricManualCorrections(state);
  assert.equal(result.changed, true);
  removedNumbers.forEach((number) => {
    assert.equal(result.state.backupRows.some((row) => row.internalOrderNumber === number), false);
    assert.equal(result.state.removedBackupInternalNumbers.includes(number), true);
  });
  const corrected = result.state.backupRows.find((row) => row.internalOrderNumber === '8654');
  assert.equal(corrected.paymentMethod, 'Transferencia');
  assert.equal(corrected.account, 'EG');
  assert.equal(corrected.salePrice, 34000);
  assert.equal(corrected.totalSaleValue, 34000);
});

test('Contador de estampas parte del cierre validado y solo aplica movimientos', () => {
  const source = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const body = source.slice(source.indexOf('function normalizeStampCounterEvents('), source.indexOf('function backupRowMonth('));
  const context = vm.createContext({
    STAMP_COUNTER_BASE: { FB: 675, MV: 666 },
    stampCounterEvents: []
  });
  vm.runInContext(body, context);
  assert.deepEqual({ ...context.printStampCounts() }, { FB: 675, MV: 666 });
  context.stampCounterEvents = [
    { id: 'one', deltaFB: -1, deltaMV: 0 },
    { id: 'two', deltaFB: 0, deltaMV: 1 }
  ];
  assert.deepEqual({ ...context.printStampCounts() }, { FB: 674, MV: 667 });
});

test('Contador de estampas ignora movimientos repetidos y no depende de pedidos', () => {
  const source = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const body = source.slice(source.indexOf('function normalizeStampCounterEvents('), source.indexOf('function backupRowMonth('));
  const context = vm.createContext({
    STAMP_COUNTER_BASE: { FB: 675, MV: 666 },
    stampCounterEvents: [
      { id: 'same', deltaFB: 1, deltaMV: 0 },
      { id: 'same', deltaFB: 1, deltaMV: 0 }
    ]
  });
  vm.runInContext(body, context);
  assert.deepEqual({ ...context.printStampCounts() }, { FB: 676, MV: 666 });
});

test('Contador de estampas guarda el movimiento junto con la marca', () => {
  const source = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const setter = source.slice(source.indexOf('async function setDetailItemPrintOwner('), source.indexOf('function toggleDetailItemPicked('));
  assert.match(source, /STAMP_COUNTER_BASE = Object\.freeze\(\{ FB: 675, MV: 666 \}\)/);
  assert.match(setter, /stampCounterEvents = \[\.\.\.stampCounterEvents, counterEvent\]/);
  assert.match(setter, /saveOperationalOrderNow\(updatedOrder, \{ stampCounterEvents: \[counterEvent\] \}\)/);
  const serverSource = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.match(serverSource, /stampCounterEvents: mergeByKey\(/);
});

test('Pasar a despachado ya no informa el seguimiento a Tienda Nube', () => {
  const source = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const single = source.slice(source.indexOf('async function moveOrder('), source.indexOf('async function decrementOrderStock('));
  const bulk = source.slice(source.indexOf('async function confirmBulkLabelMove('), source.indexOf('function splitStreetAndNumber('));
  assert.doesNotMatch(single, /notifyTiendanubeFulfillment/);
  assert.doesNotMatch(bulk, /notifyTiendanubeFulfillment/);
});

test('Editar un pedido muestra el logo girando hasta confirmar el guardado remoto', () => {
  const appSource = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const cssSource = fs.readFileSync(path.join(__dirname, 'public/styles.css'), 'utf8');
  const submitFlow = appSource.slice(
    appSource.indexOf('function setButtonSaving('),
    appSource.indexOf('manualForm.addEventListener("submit"'));
  assert.match(submitFlow, /manual-save-logo/);
  assert.match(submitFlow, /Guardando\.\.\./);
  assert.match(submitFlow, /if \(isEditing\) setManualSubmitLoading\(true\)/);
  assert.match(submitFlow, /const saved = await flushRemoteSaveNow\(\)/);
  assert.match(submitFlow, /finally \{/);
  assert.match(submitFlow, /setManualSubmitLoading\(false/);
  assert.match(cssSource, /@keyframes manualSaveLogoSpin/);
  assert.match(cssSource, /animation: manualSaveLogoSpin/);
});
