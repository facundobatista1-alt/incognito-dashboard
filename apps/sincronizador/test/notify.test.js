'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildSummary, describe, runDailyNotice } = require('../lib/notify');

const line = (productName, action, alert = '') => ({ productName, action, alert });

test('resume con cantidades y nombres, sin saltos de linea', () => {
  const lines = [line('Campera Nk Tech', 'bajar'), line('Campera Nk Tech', 'bajar'), line('Conjunto SST', 'bajar'),
    line('Gorra', 'bajar'), line('Bermuda', 'bajar'), line('Campera SST', 'subir'), line('Camiseta', 'alerta', 'sin_mapeo')];
  const summary = buildSummary({ lines, alerts: [] });
  assert.deepStrictEqual(summary.counts, { bajar: 5, subir: 1, alertas: 1 });
  assert.strictEqual(summary.params[1], '5 (Campera Nk Tech, Conjunto SST, Gorra y 1 más)');
  assert.strictEqual(summary.params[2], '1 (Campera SST)');
  assert.strictEqual(summary.params[3], '1 (Camiseta)');
  assert.ok(summary.params.every((p) => !/\n/.test(p)));
  assert.strictEqual(describe([]), 'ninguno');
});

function deps(overrides = {}) {
  const log = [];
  const sent = [];
  return {
    log,
    sent,
    recompute: async () => ({ lines: [line('Gorra', 'bajar')], alerts: [] }),
    alreadySentToday: async () => false,
    logAviso: async (row) => { log.push(row); },
    loadPhone: async () => '5491100000000',
    send: async (to, params) => { sent.push({ to, params }); },
    ...overrides
  };
}

test('manda una vez por dia y registra', async () => {
  const d = deps();
  const out = await runDailyNotice({}, d);
  assert.strictEqual(out.status, 'enviado');
  assert.strictEqual(d.sent.length, 1);
  assert.strictEqual(d.log[0].estado, 'enviado');

  const again = await runDailyNotice({}, deps({ alreadySentToday: async () => true }));
  assert.strictEqual(again.status, 'ya_enviado');
});

test('no manda si no hay nada, salvo que se fuerce', async () => {
  const empty = deps({ recompute: async () => ({ lines: [line('Gorra', 'ok')], alerts: [] }) });
  assert.strictEqual((await runDailyNotice({}, empty)).status, 'sin_cambios');
  assert.strictEqual(empty.sent.length, 0);
  assert.strictEqual(empty.log[0].estado, 'sin_cambios');

  const forced = deps({ recompute: async () => ({ lines: [], alerts: [] }) });
  assert.strictEqual((await runDailyNotice({ force: true }, forced)).status, 'enviado');
});

test('si WhatsApp falla, registra el error', async () => {
  const d = deps({ send: async () => { throw new Error('plantilla inexistente'); } });
  await assert.rejects(runDailyNotice({}, d), /plantilla inexistente/);
  assert.strictEqual(d.log[0].estado, 'error');
  assert.strictEqual(d.log[0].detalle, 'plantilla inexistente');
});
