'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildPlan, runPreNotice, runAutoApply } = require('../lib/auto');

const line = (variantId, productName, tnStock, target, action) => ({
  variantId, productId: 'p' + variantId, productName, sku: 'SKU', talle: 'L', color: 'Negro', tnStock, target, action
});
const bigData = { prendas: Array(30).fill({}), tnVariants: Array(60).fill({}) };

function store(initialPlan = null, paused = false) {
  const plans = new Map(initialPlan ? [[initialPlan.fecha, initialPlan]] : []);
  const sent = [];
  return {
    plans,
    sent,
    base: {
      today: () => '2026-09-26',
      isPaused: async () => paused,
      getPlan: async (fecha) => plans.get(fecha) || null,
      savePlan: async (plan) => { plans.set(plan.fecha, { ...plans.get(plan.fecha), ...plan }); },
      greeting: () => 'Facu',
      loadPhone: async () => '549110000',
      sendNotice: async (to, params) => { sent.push(params); }
    }
  };
}

test('arma el plan con cambios y un texto sin saltos de linea', () => {
  const plan = buildPlan({ lines: [line('1', 'Campera', 5, 3, 'bajar'), line('2', 'Gorra', 0, 2, 'subir'), line('3', 'Remera', 2, 2, 'ok')] });
  assert.strictEqual(plan.items.length, 2);
  assert.deepStrictEqual(plan.items[0], { variantId: '1', productId: 'p1', from: 5, to: 3, productName: 'Campera', sku: 'SKU', talle: 'L', color: 'Negro', action: 'bajar' });
  assert.strictEqual(plan.resumen.texto, 'bajar 1 (Campera) y subir 1 (Gorra)');
});

test('16:45 programa y avisa; sin cambios no avisa', async () => {
  const s = store();
  const out = await runPreNotice({ ...s.base, loadData: async () => bigData, reconcile: () => ({ lines: [line('1', 'Campera', 5, 3, 'bajar')] }) });
  assert.strictEqual(out.status, 'programado');
  assert.strictEqual(s.plans.get('2026-09-26').estado, 'programado');
  assert.deepStrictEqual(s.sent[0], ['Facu', '1', 'bajar 1 (Campera)']);

  const empty = store();
  const none = await runPreNotice({ ...empty.base, loadData: async () => bigData, reconcile: () => ({ lines: [] }) });
  assert.strictEqual(none.status, 'sin_cambios');
  assert.strictEqual(empty.sent.length, 0);
});

test('si el aviso falla, el plan queda en error y a las 17 no se aplica', async () => {
  const s = store();
  await runPreNotice({ ...s.base, sendNotice: async () => { throw new Error('plantilla no aprobada'); },
    loadData: async () => bigData, reconcile: () => ({ lines: [line('1', 'Campera', 5, 3, 'bajar')] }) });
  assert.strictEqual(s.plans.get('2026-09-26').estado, 'error');
  let applied = false;
  const out = await runAutoApply({ ...s.base, applyChanges: async () => { applied = true; return {}; } });
  assert.strictEqual(out.status, 'error');
  assert.strictEqual(applied, false);
});

test('datos raros o demasiados cambios: no programa', async () => {
  const s = store();
  const out = await runPreNotice({ ...s.base, loadData: async () => ({ prendas: [], tnVariants: [] }),
    reconcile: () => ({ lines: [line('1', 'Campera', 5, 0, 'bajar')] }) });
  assert.strictEqual(out.status, 'omitido');
  assert.strictEqual(s.sent.length, 0);

  const many = store();
  const lines = Array.from({ length: 81 }, (_, i) => line(String(i), 'X', 5, 0, 'bajar'));
  const out2 = await runPreNotice({ ...many.base, loadData: async () => bigData, reconcile: () => ({ lines }) });
  assert.strictEqual(out2.status, 'omitido');
  assert.strictEqual(many.sent.length, 0);
});

test('17:00 aplica el plan programado; frenado o pausado no aplica', async () => {
  const plan = { fecha: '2026-09-26', estado: 'programado', items: [{ variantId: '1', from: 5, to: 3 }] };
  const s = store(plan);
  let got;
  const out = await runAutoApply({ ...s.base, applyChanges: async (items) => { got = items; return { aplicados: 1, omitidos: 0, errores: 0 }; } });
  assert.strictEqual(out.status, 'aplicado');
  assert.deepStrictEqual(got, plan.items);
  assert.strictEqual(s.plans.get('2026-09-26').estado, 'aplicado');
  assert.deepStrictEqual(s.plans.get('2026-09-26').resultado, { aplicados: 1, omitidos: 0, errores: 0 });

  const stopped = store({ ...plan, estado: 'cancelado' });
  assert.strictEqual((await runAutoApply({ ...stopped.base, applyChanges: async () => { throw new Error('no'); } })).status, 'cancelado');

  const paused = store(plan, true);
  assert.strictEqual((await runAutoApply({ ...paused.base, applyChanges: async () => { throw new Error('no'); } })).status, 'pausado');
  assert.strictEqual(paused.plans.get('2026-09-26').estado, 'omitido');

  // Si a las 16:45 ya estaba frenado, no se reprograma.
  const again = store({ ...plan, estado: 'cancelado' });
  assert.strictEqual((await runPreNotice({ ...again.base })).status, 'ya_cancelado');
});
