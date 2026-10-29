'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { negocioId, getNegocio } = require('../lib/negocios');
const { reconcile } = require('../lib/reconcile');
const { splitVariantValues } = require('../lib/mapping');
const sources = require('../lib/sources');

const ENV = {
  VENTAS_SUPABASE_URL: 'https://supa.test',
  VENTAS_SUPABASE_SERVICE_ROLE_KEY: 'k',
  TIENDANUBE_STORE_ID: '111',
  TIENDANUBE_ACCESS_TOKEN: 'tok-inc',
  IGNT_TIENDANUBE_STORE_ID: '222',
  IGNT_TIENDANUBE_ACCESS_TOKEN: 'tok-ignt'
};

// Corre fn con estas variables y un fetch falso que anota cada URL pedida.
async function withFakeNetwork(env, fn) {
  const saved = { env: { ...process.env }, fetch: global.fetch };
  Object.assign(process.env, env);
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), headers: options.headers || {}, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    return { ok: true, status: 200, json: async () => [], text: async () => '' };
  };
  try {
    await fn(calls);
  } finally {
    process.env = saved.env;
    global.fetch = saved.fetch;
  }
}

test('negocioId: solo acepta negocios conocidos, el resto es Incognito', () => {
  assert.strictEqual(negocioId('ignt'), 'ignt');
  assert.strictEqual(negocioId('incognito'), 'incognito');
  assert.strictEqual(negocioId(undefined), 'incognito');
  assert.strictEqual(negocioId('otro'), 'incognito');
  assert.strictEqual(getNegocio('xx').tablaPrendas, 'prendas');
});

test('configStatus de IGNT pide sus propias credenciales de Tiendanube', async () => {
  await withFakeNetwork({ ...ENV, IGNT_TIENDANUBE_STORE_ID: '', IGNT_TIENDANUBE_ACCESS_TOKEN: '' }, async () => {
    assert.deepStrictEqual(sources.configStatus('ignt').missing, ['IGNT_TIENDANUBE_STORE_ID', 'IGNT_TIENDANUBE_ACCESS_TOKEN']);
    assert.strictEqual(sources.configStatus().ok, true);
  });
});

test('loadAll de Incognito lee lo mismo de siempre, filtrado por negocio', async () => {
  await withFakeNetwork(ENV, async (calls) => {
    const data = await sources.loadAll();
    assert.strictEqual(data.negocio, 'incognito');
    const urls = calls.map((c) => c.url);
    assert.ok(urls.some((u) => u.startsWith('https://supa.test/rest/v1/prendas?')));
    assert.ok(!urls.some((u) => u.includes('prendas_ignt')));
    assert.ok(urls.some((u) => u.includes('ventas_app_state') || u.includes('ventas_records')), 'lee Ventas');
    assert.ok(urls.filter((u) => u.includes('api.tiendanube.com')).every((u) => u.includes('/v1/111/')));
    assert.ok(urls.filter((u) => /sincronizador_(ignorados|descartes)/.test(u)).every((u) => u.includes('negocio=eq.incognito')));
  });
});

test('loadAll de IGNT usa prendas_ignt y su Tiendanube, sin Ventas', async () => {
  await withFakeNetwork(ENV, async (calls) => {
    const data = await sources.loadAll('ignt');
    assert.strictEqual(data.negocio, 'ignt');
    assert.deepStrictEqual(data.ventasOrders, []);
    const urls = calls.map((c) => c.url);
    assert.ok(urls.some((u) => u.startsWith('https://supa.test/rest/v1/prendas_ignt?')));
    assert.ok(!urls.some((u) => /\/rest\/v1\/prendas\?/.test(u)), 'no lee la tabla de Incognito');
    assert.ok(!urls.some((u) => u.includes('ventas_')), 'no lee Ventas de Incognito');
    const tn = calls.filter((c) => c.url.includes('api.tiendanube.com'));
    assert.ok(tn.length && tn.every((c) => c.url.includes('/v1/222/') && c.headers.Authentication === 'bearer tok-ignt'));
    assert.ok(urls.filter((u) => /sincronizador_(ignorados|descartes)/.test(u)).every((u) => u.includes('negocio=eq.ignt')));
  });
});

test('escrituras de IGNT van a su tienda y quedan marcadas como IGNT', async () => {
  await withFakeNetwork(ENV, async (calls) => {
    await sources.writeVariantStock('9', '8', 3, 'ignt').catch(() => {});
    await sources.logChange({ productId: '9', variantId: '8', status: 'aplicado', negocio: 'ignt' });
    await sources.logChange({ productId: '9', variantId: '8', status: 'aplicado' });
    assert.ok(calls[0].url.startsWith('https://api.tiendanube.com/v1/222/products/9/variants/8') && calls[0].method === 'PUT');
    const logs = calls.filter((c) => c.url.includes('sincronizador_cambios'));
    assert.deepStrictEqual(logs.map((c) => c.body.negocio), ['ignt', 'incognito']);
  });
});

test('IGNT: remeras y musculosas en infinito son esperadas; el resto se revisa', () => {
  const tnVariants = [
    { productId: 1, productName: 'Remera Over Origen', variantId: 11, sku: 'Over-Ig-01-Dtf', talle: 'M', color: 'Negro', stock: null },
    { productId: 2, productName: 'Musculosa Origen', variantId: 21, sku: 'Musc-Ig-01-Dtf', talle: 'M', color: 'Negro', stock: null },
    { productId: 3, productName: 'Jean Mom', variantId: 31, sku: 'Jean-Mom-P01', talle: '40', color: 'Negro', stock: null }
  ];
  const ignt = reconcile({ tnVariants, infinitoEsperado: getNegocio('ignt').infinitoEsperado });
  const bySku = Object.fromEntries(ignt.infinite.map((g) => [g.sku, g.expected]));
  assert.deepStrictEqual(bySku, { 'Jean-Mom-P01': false, 'Musc-Ig-01-Dtf': true, 'Over-Ig-01-Dtf': true });
  // En Incognito nada de eso es esperado (no hay prendas que lo excluyan).
  assert.ok(reconcile({ tnVariants }).infinite.every((g) => !g.expected));
});

test('IGNT: talle numerico de pantalon se cruza con Stock', () => {
  const prendas = [{ id: 'j1', sku: 'JEAN-MOM-P01', modelo: 'Jean Mom', talle: '40', color: 'Negro', stock: 2 }];
  const tnVariants = [{ productId: 3, productName: 'Jean Mom', variantId: 31, sku: 'Jean-Mom-P01', talle: '40', color: 'Negro', stock: 5 }];
  const result = reconcile({ prendas, tnVariants });
  assert.strictEqual(result.lines[0].target, 2);
  assert.strictEqual(result.lines[0].action, 'bajar');
});

test('pedidos sin nombres de atributo: un numero de dos cifras es talle', () => {
  assert.deepStrictEqual(splitVariantValues(['Negro', '40']), { talle: '40', color: 'Negro' });
  assert.deepStrictEqual(splitVariantValues(['Negro', 'M']), { talle: 'M', color: 'Negro' });
});
