'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const express = require('express');
const app = require('./server');

const {
  normalizeStampConsumptionEvents,
  stampConsumptionEventsPage,
  createStampConsumptionEventsHandler,
  getCurrentStampAppState,
  missingStampEventBackfills,
  applyStampEventBackfills
} = app.__ventasStampEventTestHelpers;

function event(overrides = {}) {
  const pedidoId = overrides.pedidoId || '9001';
  const origen = overrides.origen || 'minorista';
  return {
    eventId: overrides.eventId || `stamp:${pedidoId}:${overrides.tipo || 'preparacion_a_armado'}:op-1`,
    fecha: overrides.fecha || '2026-10-02T12:00:00.000Z',
    tipo: overrides.tipo || 'preparacion_a_armado',
    pedidoId,
    usuario: 'sistema',
    origen,
    pedido: { id: pedidoId, origen },
    items: overrides.items || [{
      itemRef: `${pedidoId}:1:Rem-AB-01-Dtf:S`,
      sku: 'Rem-AB-01-Dtf',
      cantidad: 1,
      talle: 'S',
      pedidoId,
      origen
    }]
  };
}

test('un reintento con el mismo eventId no duplica la transicion', () => {
  const transition = event();
  const normalized = normalizeStampConsumptionEvents([transition, { ...transition }]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].eventId, transition.eventId);
});

test('los eventos historicos por linea conservan solo el producto marcado', () => {
  const legacy = event({
    eventId: 'stamp:9410:preparacion_a_armado:item-1-2026-10-02',
    items: [
      { itemRef: '9410:1:REM-BM-01-01-DTF:L', sku: 'REM-BM-01-01-DTF', cantidad: 1 },
      { itemRef: '9410:2:Rem-JD-08-01-Dtf:L', sku: 'Rem-JD-08-01-Dtf', cantidad: 1 },
      { itemRef: '9410:3:Rem-CZ-23-01-Dtf:L', sku: 'Rem-CZ-23-01-Dtf', cantidad: 1 },
      { itemRef: '9410:4:Rem-JD-03-03-Dtf:L', sku: 'Rem-JD-03-03-Dtf', cantidad: 1 }
    ]
  });

  const [normalized] = normalizeStampConsumptionEvents([legacy]);
  assert.equal(normalized.items.length, 1);
  assert.equal(normalized.items[0].sku, 'Rem-JD-08-01-Dtf');
});

test('los dos eventos espurios del pedido 9410 no se publican a Stock DTF', () => {
  const valid = event({ eventId: 'stamp:9410:preparacion_a_armado:item-0-2026-10-02T14%3A06%3A40.361Z' });
  const invalid = event({ eventId: 'stamp:9410:preparacion_a_armado:item-2-2026-10-02T14%3A22%3A23.149Z' });
  const normalized = normalizeStampConsumptionEvents([valid, invalid]);
  assert.deepEqual(normalized.map((row) => row.eventId), [valid.eventId]);
});

test('el historial conserva minoristas, mayoristas y los cuatro tipos', () => {
  const events = [
    event({ eventId: 'a', tipo: 'preparacion_a_armado', origen: 'minorista' }),
    event({ eventId: 'b', tipo: 'modificacion', origen: 'mayorista', pedidoId: 'M-1' }),
    event({ eventId: 'c', tipo: 'armado_a_preparacion' }),
    event({ eventId: 'd', tipo: 'cancelacion' })
  ];
  const page = stampConsumptionEventsPage({ stampConsumptionEvents: events }, { limit: 10 });
  assert.equal(page.ok, true);
  assert.equal(page.events.length, 4);
  assert.deepEqual(new Set(page.events.map((row) => row.tipo)), new Set([
    'preparacion_a_armado',
    'modificacion',
    'armado_a_preparacion',
    'cancelacion'
  ]));
  assert.deepEqual(new Set(page.events.map((row) => row.origen)), new Set(['minorista', 'mayorista']));
});

test('el historial entrega solo DTF, nunca 3D, y pagina con cursor', () => {
  const first = event({
    eventId: 'a',
    items: [
      { itemRef: 'dtf', sku: 'Rem-AA-Dtf', cantidad: 1, talle: 'M' },
      { itemRef: '3d', sku: 'Rem-DF-3D', cantidad: 1, talle: 'M' }
    ]
  });
  const second = event({ eventId: 'b', fecha: '2026-10-02T13:00:00.000Z' });
  const page = stampConsumptionEventsPage({ stampConsumptionEvents: [first, second] }, { limit: 1 });
  assert.equal(page.events.length, 1);
  assert.equal(page.events[0].items.length, 1);
  assert.equal(page.events[0].items[0].sku, 'Rem-AA-Dtf');
  assert.equal(page.nextCursor, 'a');
  assert.equal(page.hasMore, true);
  const next = stampConsumptionEventsPage({ stampConsumptionEvents: [first, second] }, { after: page.nextCursor, limit: 1 });
  assert.equal(next.events[0].eventId, 'b');
  assert.equal(next.hasMore, false);
});

test('el cambio de estado y el evento se incluyen en el mismo guardado local', () => {
  const source = fs.readFileSync(require.resolve('./public/app.js'), 'utf8');
  const start = source.indexOf('async function moveOrder(id, direction)');
  const end = source.indexOf('async function decrementOrderStock', start);
  const moveOrder = source.slice(start, end);
  assert.match(moveOrder, /appendStampConsumptionEvent\(updatedOrder, stampEventType/);
  assert.match(moveOrder, /save\(\);/);
  assert.match(moveOrder, /saveOperationalOrderNow\(updatedOrder,[\s\S]*stampConsumptionEvents:\s*stampEvent \? \[stampEvent\] : \[\]/);
  assert.doesNotMatch(moveOrder, /fetch\([^)]*stamps|stampsSyncedAt\s*:\s*timestamp/);
});

test('modificar y cancelar guardan eventos sin indicadores de descuento DTF', () => {
  const source = fs.readFileSync(require.resolve('./public/app.js'), 'utf8');
  assert.match(source, /appendStampConsumptionEvent\(editedOrder, "modificacion"/);
  assert.match(source, /appendStampConsumptionEvent\(order, "cancelacion"/);
  assert.match(source, /created\.stampEvent \? \[created\.stampEvent\] : \[\]/);
  assert.match(source, /cancelledExchange[\s\S]*stampConsumptionEvents:\s*stampEvent \? \[stampEvent\] : \[\]/);
  assert.doesNotMatch(source, /stampsSyncedAt\s*:\s*(timestamp|partialTimestamp)/);
  assert.doesNotMatch(source, /stockDeductedAt\s*:\s*stamp/);
});

test('la API pull de movimientos queda protegida y conserva su contrato', () => {
  const server = fs.readFileSync(require.resolve('./server.js'), 'utf8');
  assert.match(server, /app\.get\('\/api\/stamps\/consumption-events'/);
  assert.match(server, /stampsSecretMatches\(req\)/);
  assert.match(server, /\{\s*ok:\s*true,\s*events:\s*page,\s*nextCursor:/);
  assert.match(server, /hasMore:\s*events\.length > page\.length/);
});

test('el endpoint autentica solo por secreto y no necesita cookie', async (t) => {
  const api = express();
  api.get('/api/stamps/consumption-events', createStampConsumptionEventsHandler({
    secretMatches: (req) => req.get('x-stamps-api-secret') === 'secreto-compartido',
    loadState: async () => ({ state: { stampConsumptionEvents: [event()] } })
  }));
  const server = api.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/api/stamps/consumption-events`;

  const accepted = await fetch(url, { headers: { 'x-stamps-api-secret': 'secreto-compartido' } });
  assert.equal(accepted.status, 200);
  assert.deepEqual(Object.keys(await accepted.json()), ['ok', 'events', 'nextCursor', 'hasMore']);

  const missing = await fetch(url);
  assert.equal(missing.status, 401);

  const rejected = await fetch(url, { headers: { 'x-stamps-api-secret': 'incorrecto' } });
  assert.equal(rejected.status, 401);
});

test('con almacenamiento por filas el endpoint devuelve sus eventos y no consulta el JSON viejo', async (t) => {
  const rowEvent = event({ pedidoId: '9410', eventId: 'stamp:9410:preparacion_a_armado:item-0-prueba' });
  let legacyReads = 0;
  const api = express();
  api.get('/api/stamps/consumption-events', createStampConsumptionEventsHandler({
    secretMatches: (req) => req.get('x-stamps-api-secret') === 'secreto-compartido',
    stateReaderOptions: {
      rowStorageEnabled: true,
      readRowState: async () => ({ savedAt: '2026-10-02T12:00:00.000Z', stampConsumptionEvents: [rowEvent] }),
      readLegacyState: async () => {
        legacyReads += 1;
        return { state: { stampConsumptionEvents: [] }, updatedAt: null };
      }
    }
  }));
  const server = api.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/stamps/consumption-events`, {
    headers: { 'x-stamps-api-secret': 'secreto-compartido' }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].pedidoId, '9410');
  assert.equal(legacyReads, 0);
});

test('el lector comun usa filas cuando estan activas y conserva savedAt', async () => {
  const result = await getCurrentStampAppState({
    rowStorageEnabled: true,
    readRowState: async () => ({ savedAt: '2026-10-02T12:00:00.000Z', stampConsumptionEvents: [event()] }),
    readLegacyState: async () => assert.fail('No debe leer el almacenamiento JSON antiguo')
  });
  assert.equal(result.updatedAt, '2026-10-02T12:00:00.000Z');
  assert.equal(result.state.stampConsumptionEvents.length, 1);
});

test('la pantalla de Stock separa el historial de prendas y el de DTF', () => {
  const html = fs.readFileSync(require.resolve('./public/index.html'), 'utf8');
  const frontend = fs.readFileSync(require.resolve('./public/app.js'), 'utf8');

  assert.match(html, /data-stock-history-mode="garments"/);
  assert.match(html, /data-stock-history-mode="dtf"/);
  assert.match(html, /id="stockGarmentHistory"/);
  assert.match(html, /id="stockDtfHistory"/);
  assert.match(html, /id="stampConsumptionLogBody"/);
  assert.match(frontend, /stampConsumptionEvents[\s\S]*stampConsumptionMovementLabel/);
  assert.match(frontend, /button\.dataset\.stockHistoryMode/);
  assert.match(frontend, /itemIndexes:\s*\[targetIndex\]/);
});

test('pendientes de impresion y consumos comparten la fuente de estado actual', () => {
  const server = fs.readFileSync(require.resolve('./server.js'), 'utf8');
  const pendingStart = server.indexOf("app.get('/api/stamps/pending-print'");
  const handlerStart = server.indexOf('function createStampConsumptionEventsHandler', pendingStart);
  const pendingRoute = server.slice(pendingStart, handlerStart);
  assert.match(pendingRoute, /getCurrentStampAppState\(\)/);
  assert.match(server.slice(handlerStart, handlerStart + 700), /getCurrentStampAppState/);
});

test('marcar un DTF persiste pedido y evento juntos antes de que el endpoint lo lea', async (t) => {
  const frontend = fs.readFileSync(require.resolve('./public/app.js'), 'utf8');
  const start = frontend.indexOf('async function setDetailItemStatus');
  const end = frontend.indexOf('async function setDetailItemPrintOwner', start);
  const source = frontend.slice(start, end);
  assert.match(source, /stampEvent = appendStampConsumptionEvent/);
  assert.match(source, /saveOperationalOrderNow\(updatedOrder,[\s\S]*stampConsumptionEvents:\s*stampEvent \? \[stampEvent\] : \[\]/);

  const persistedState = { stampConsumptionEvents: [] };
  const immediateEvent = event({
    pedidoId: '9421',
    eventId: 'stamp:9421:preparacion_a_armado:item-0-prueba-inmediata',
    items: [{
      itemRef: '9421:3573250691',
      sku: 'Rem-CZ-13-05-Dtf',
      talle: 'S',
      cantidad: 1,
      pedidoId: '9421',
      origen: 'minorista'
    }]
  });
  persistedState.stampConsumptionEvents.push(immediateEvent);

  const api = express();
  api.get('/api/stamps/consumption-events', createStampConsumptionEventsHandler({
    secretMatches: () => true,
    loadState: async () => ({ state: persistedState })
  }));
  const server = api.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/stamps/consumption-events`);
  const body = await response.json();
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].items[0].itemRef, '9421:3573250691');
});

test('el backfill 9421 es idempotente por itemRef', async () => {
  const empty = { stampConsumptionEvents: [] };
  const [backfill] = missingStampEventBackfills(empty, '2026-10-02T15:00:00.000Z');
  assert.equal(backfill.items[0].itemRef, '9421:3573250691');

  const rowState = { stampConsumptionEvents: [] };
  const saveRows = async (patch) => {
    rowState.stampConsumptionEvents.push(...patch.stampConsumptionEvents);
  };
  const options = {
    rowStorageEnabled: true,
    loadState: async () => ({ state: rowState }),
    saveRows,
    timestamp: '2026-10-02T15:00:00.000Z'
  };
  const first = await applyStampEventBackfills(options);
  const second = await applyStampEventBackfills(options);
  assert.equal(first.inserted, 1);
  assert.equal(second.inserted, 0);
  assert.equal(rowState.stampConsumptionEvents.length, 1);
});
