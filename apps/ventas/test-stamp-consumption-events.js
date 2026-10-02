'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const express = require('express');
const app = require('./server');

const {
  normalizeStampConsumptionEvents,
  stampConsumptionEventsPage,
  createStampConsumptionEventsHandler
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
  assert.doesNotMatch(moveOrder, /fetch\([^)]*stamps|stampsSyncedAt\s*:\s*timestamp/);
});

test('modificar y cancelar guardan eventos sin indicadores de descuento DTF', () => {
  const source = fs.readFileSync(require.resolve('./public/app.js'), 'utf8');
  assert.match(source, /appendStampConsumptionEvent\(editedOrder, "modificacion"/);
  assert.match(source, /appendStampConsumptionEvent\(order, "cancelacion"/);
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
