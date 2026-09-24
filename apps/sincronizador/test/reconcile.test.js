'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { reconcile, pendingVentasItems } = require('../lib/reconcile');
const { resolveComponents, splitVariantValues } = require('../lib/mapping');

const prendas = [
  { id: 'c1', sku: 'CAMP-SST-AD', modelo: 'SST', talle: 'L', color: 'Negro', stock: 5 },
  { id: 'p1', sku: 'PAN-SST-AD', modelo: 'Pantalón SST', talle: 'L', color: 'Negro', stock: 3 },
  { id: 'b1', sku: 'BER-CLAS-DTF', modelo: 'Bermuda', talle: 'L', color: 'Negro', stock: 1 },
  { id: 'r1', sku: 'REM-CLAS-DTF', modelo: 'Clásica', talle: 'L', color: 'Negro', stock: 40 },
  { id: 'g1', sku: 'GORR-CHAP-JOR', modelo: 'Chapita', talle: 'Único', color: 'Rojo', stock: 2 }
];

function variant(sku, talle, color, stock, extra = {}) {
  return { productId: 'p', productName: sku, variantId: `${sku}-${talle}-${color}`, sku, talle, color, stock, ...extra };
}

function lineFor(result, sku) {
  return result.lines.find((line) => line.sku === sku);
}

test('mapea conjuntos, estampados y excluidos', () => {
  const conjunto = resolveComponents(prendas, 'Con-Sst-Ad', 'L', 'Negro');
  assert.deepStrictEqual(conjunto.components.map((c) => c.prenda.id), ['c1', 'p1']);
  const bermuda = resolveComponents(prendas, 'Ber-CZ-13-01-Dtf', 'L', 'Negro');
  assert.deepStrictEqual(bermuda.components.map((c) => c.prenda.id), ['b1']);
  assert.strictEqual(bermuda.components[0].matchType, 'family');
  assert.ok(resolveComponents(prendas, 'Rem-JD-05-04+JD-05-01-Dtf', 'L', 'Negro').excluded);
  assert.ok(resolveComponents(prendas, 'Gorr-Chap-Jor', 'unico', 'rojo').components);
  assert.ok(resolveComponents(prendas, 'XYZ-123', 'L', 'Negro').error);
});

test('las baggys 3D van a la baggy lisa, sin confundirse con microfibra', () => {
  const conBaggy = [
    ...prendas,
    { id: 'pb', sku: 'PAN-BAG-DTF', modelo: 'Baggy', talle: 'L', color: 'Negro', stock: 4 },
    { id: 'pm', sku: 'PAN-MICR-3D', modelo: 'Microfibra', talle: 'L', color: 'Negro', stock: 9 },
    { id: 'pl', sku: 'PAN-LIN-3D', modelo: 'Pantalón Linea', talle: 'L', color: 'Negro', stock: 1 }
  ];
  for (const sku of ['Pan-Bag-3D', 'Pan-BagNk-3D', 'Pan-BagJ-3D']) {
    const resolved = resolveComponents(conBaggy, sku, 'L', 'Negro');
    assert.deepStrictEqual(resolved.components.map((c) => c.prenda.id), ['pb'], sku);
  }
  assert.deepStrictEqual(resolveComponents(conBaggy, 'Pan-Micr-3D', 'L', 'Negro').components.map((c) => c.prenda.id), ['pm']);
});

test('separa talle y color de la variante', () => {
  assert.deepStrictEqual(splitVariantValues(['Negro', 'XXL'], ['Color', 'Talle']), { talle: 'XXL', color: 'Negro' });
  assert.deepStrictEqual(splitVariantValues(['S', 'Violeta'], ['Talle', 'Color']), { talle: 'S', color: 'Violeta' });
  assert.deepStrictEqual(splitVariantValues(['Azul', 'M']), { talle: 'M', color: 'Azul' });
});

test('solo cuenta como pendiente lo no descontado', () => {
  assert.strictEqual(pendingVentasItems({ stockDeductedAt: '2026-09-01', items: [{ sku: 'x', size: 'L' }] }).length, 0);
  assert.strictEqual(pendingVentasItems({ stockBypassedAt: '2026-09-01', items: [{ sku: 'x', size: 'L' }] }).length, 0);
  assert.strictEqual(pendingVentasItems({ cancelled: true, items: [{ sku: 'x', size: 'L' }] }).length, 0);
  assert.strictEqual(pendingVentasItems({ recordType: 'exchange', items: [{ sku: 'x', size: 'L' }] }).length, 0);
  const items = pendingVentasItems({
    items: [
      { sku: 'a', size: 'L', quantity: 2 },
      { sku: 'b', size: 'L', stockDeductedAt: '2026-09-01' },
      { sku: 'c', size: 'L', printedGarmentId: 'x' }
    ]
  });
  assert.deepStrictEqual(items.map((item) => [item.sku, item.quantity]), [['a', 2]]);
});

test('calcula esperado con pendientes de Ventas y de Tiendanube', () => {
  const result = reconcile({
    prendas,
    tnVariants: [
      variant('Camp-Sst-Ad', 'L', 'Negro', 4),
      variant('Con-Sst-Ad', 'L', 'Negro', 4),
      variant('Ber-CZ-13-01-Dtf', 'L', 'Negro', 1),
      variant('Ber-HB-01-Dtf', 'L', 'Negro', 3),
      variant('Rem-AD-01-01-Dtf', 'L', 'Negro', 10),
      variant('Rem-AD-01-02-Dtf', 'L', 'Negro', null),
      variant('Gorr-Chap-Jor', 'Único', 'Rojo', 0),
      variant('XYZ-123', 'L', 'Negro', 2)
    ],
    ventasOrders: [
      // Mayorista sin empaquetar: consume 1 pantalon.
      { internalOrderNumber: '6001', salesChannel: 'WhatsApp', status: 'preparacion', items: [{ sku: 'Pan-Sst-Ad', size: 'L', color: 'Negro', quantity: 1 }] },
      // Ya empaquetado: no cuenta.
      { internalOrderNumber: '6002', stockDeductedAt: '2026-09-20', items: [{ sku: 'Camp-Sst-Ad', size: 'L', color: 'Negro' }] }
    ],
    tnOpenOrders: [
      // No esta en Ventas: consume 1 campera.
      { id: 11, number: 900, paymentStatus: 'pending', items: [{ sku: 'Camp-Sst-Ad', talle: 'L', color: 'Negro', quantity: 1 }] },
      // Ya esta en Ventas: se ignora.
      { id: 12, number: 901, items: [{ sku: 'Camp-Sst-Ad', talle: 'L', color: 'Negro', quantity: 1 }] }
    ],
    knownStoreOrders: new Set(['901'])
  });

  // Campera: 5 - 1 (pedido TN sin cargar) = 4 -> ok.
  assert.strictEqual(lineFor(result, 'Camp-Sst-Ad').action, 'ok');
  // Conjunto: min(campera 4, pantalon 3-1=2) = 2 -> bajar de 4 a 2.
  const conjunto = lineFor(result, 'Con-Sst-Ad');
  assert.strictEqual(conjunto.target, 2);
  assert.strictEqual(conjunto.action, 'bajar');
  // Bermudas estampadas comparten la lisa (1): una ok, otra bajar de 3 a 1.
  assert.strictEqual(lineFor(result, 'Ber-CZ-13-01-Dtf').action, 'ok');
  assert.strictEqual(lineFor(result, 'Ber-HB-01-Dtf').target, 1);
  // Gorra: TN 0, app 2 -> subir.
  assert.strictEqual(lineFor(result, 'Gorr-Chap-Jor').action, 'subir');
  // Sin mapeo -> alerta.
  assert.strictEqual(lineFor(result, 'XYZ-123').alert, 'sin_mapeo');
  // Remeras clasicas (finitas o infinitas) quedan fuera.
  assert.strictEqual(lineFor(result, 'Rem-AD-01-01-Dtf'), undefined);
  assert.strictEqual(result.summary.infinitas, 1);
  assert.strictEqual(result.summary.excluidas, 1);
});

test('marca vendido de mas y propone 0', () => {
  const result = reconcile({
    prendas,
    tnVariants: [variant('Gorr-Chap-Jor', 'Único', 'Rojo', 1)],
    ventasOrders: [{ internalOrderNumber: '6003', items: [{ sku: 'Gorr-Chap-Jor', size: 'Único', color: 'Rojo', quantity: 3 }] }]
  });
  const line = result.lines[0];
  assert.strictEqual(line.expected, -1);
  assert.strictEqual(line.target, 0);
  assert.strictEqual(line.action, 'bajar');
  assert.strictEqual(line.alert, 'vendido_de_mas');
});

test('saltea productos eliminados del reporte', () => {
  const result = reconcile({
    prendas,
    tnVariants: [
      variant('XYZ-123', 'L', 'Negro', 2, { productId: 'liquidacion' }),
      variant('Gorr-Chap-Jor', 'Único', 'Rojo', 2, { productId: 'gorra' })
    ],
    ignoredProductIds: new Set(['liquidacion'])
  });
  assert.deepStrictEqual(result.lines.map((line) => line.productId), ['gorra']);
  assert.strictEqual(result.summary.ignoradas, 1);
});
