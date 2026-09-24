'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { applyChanges } = require('../lib/apply');

function line(variantId, tnStock, target, action = tnStock > target ? 'bajar' : 'subir') {
  return { productId: 'p1', variantId, productName: 'Bermuda', sku: 'Ber-X-Dtf', talle: 'L', color: 'Negro', tnStock, target, action };
}

function fakeStore(initial) {
  const stock = { ...initial };
  const writes = [];
  const logs = [];
  return {
    stock,
    writes,
    logs,
    deps: (lines) => ({
      recompute: async () => ({ lines }),
      readStock: async (_p, v) => stock[v],
      writeStock: async (_p, v, value) => { writes.push([v, value]); stock[v] = value; return value; },
      logChange: async (row) => { logs.push(row); }
    })
  };
}

test('aplica solo si coincide lo aprobado, lo recalculado y lo que hay en Tiendanube', async () => {
  const store = fakeStore({ a: 5, b: 3, c: 4, d: 2 });
  store.stock.c = 9; // alguien toco la variante c despues del recalculo
  const lines = [line('a', 5, 1), line('b', 3, 2), line('c', 4, 0), line('d', 2, 2, 'ok')];
  const out = await applyChanges([
    { variantId: 'a', from: 5, to: 1 }, // ok
    { variantId: 'b', from: 3, to: 1 }, // el usuario vio otro destino
    { variantId: 'c', from: 4, to: 0 }, // Tiendanube cambio recien
    { variantId: 'd', from: 2, to: 0 }, // ya no hay cambio
    { variantId: 'zz', from: 1, to: 0 } // no existe
  ], store.deps(lines));

  assert.deepStrictEqual(store.writes, [['a', 1]]);
  assert.deepStrictEqual(out.results.map((r) => r.status), ['aplicado', 'omitido', 'omitido', 'omitido', 'omitido']);
  assert.strictEqual(out.aplicados, 1);
  assert.strictEqual(store.logs.length, 5);
  assert.strictEqual(store.stock.c, 9);
});

test('marca error si Tiendanube falla o no guarda el valor', async () => {
  const lines = [line('a', 5, 1), line('b', 3, 0)];
  const out = await applyChanges([{ variantId: 'a', from: 5, to: 1 }, { variantId: 'b', from: 3, to: 0 }], {
    recompute: async () => ({ lines }),
    readStock: async (_p, v) => ({ a: 5, b: 3 })[v],
    writeStock: async (_p, v) => { if (v === 'a') throw new Error('HTTP 500'); return 2; },
    logChange: async () => {}
  });
  assert.deepStrictEqual(out.results.map((r) => r.status), ['error', 'error']);
  assert.strictEqual(out.errores, 2);
});

test('si falla el registro igual informa el resultado', async () => {
  const lines = [line('a', 5, 1)];
  const out = await applyChanges([{ variantId: 'a', from: 5, to: 1 }], {
    recompute: async () => ({ lines }),
    readStock: async () => 5,
    writeStock: async () => 1,
    logChange: async () => { throw new Error('supabase caido'); }
  });
  assert.strictEqual(out.results[0].status, 'aplicado');
  assert.strictEqual(out.results[0].logError, 'supabase caido');
});
