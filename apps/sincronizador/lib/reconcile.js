'use strict';
// Calculo puro (sin red) de la conciliacion Stock <-> Tiendanube.
//
// Regla: el stock correcto de una variante en Tiendanube es
//   min sobre sus prendas componentes de (stock en `prendas` - pendiente)
// donde "pendiente" son unidades ya vendidas que la app de Stock todavia no
// desconto: pedidos de Ventas (cualquier canal) sin empaquetar, y pedidos
// abiertos de Tiendanube que todavia no entraron a Ventas.
// A eso se le suman las prendas ya estampadas disponibles (devoluciones
// cargadas en "Prendas estampadas" de Ventas) de ese mismo SKU/talle/color:
// se venden sin gastar una prenda lisa, y solo cuentan para su diseño.
//
// No escribe nada: devuelve lineas con la accion propuesta.

const { resolveComponents, isExcludedSku, canonicalSku, normalizeTalle, normalizeColor } = require('./mapping');

function printedKey(sku, talle, color) {
  return `${canonicalSku(sku)}|${normalizeTalle(talle)}|${normalizeColor(color)}`;
}

// Prendas estampadas sin usar, contadas por SKU/talle/color. Ventas marca
// usedAt cuando una se asigna a un pedido.
function availablePrinted(printedGarments = []) {
  const counts = new Map();
  for (const garment of printedGarments) {
    if (!garment || garment.usedAt || garment.usedOrderId) continue;
    const key = printedKey(garment.sku, garment.size || garment.talle, garment.color);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function isTrue(value) {
  return value === true || String(value).toLowerCase() === 'true';
}

// Misma forma que orderItems() de Ventas: pedidos viejos guardaban un unico
// item en campos sueltos del pedido.
function ventasOrderItems(order = {}) {
  if (Array.isArray(order.items) && order.items.length) return order.items;
  return [{ sku: order.sku, size: order.size, color: order.color, quantity: order.quantity }];
}

function orderLabel(order = {}) {
  return String(order.internalOrderNumber || order.storeOrderNumber || order.id || '').trim();
}

// Unidades de un pedido de Ventas que todavia no se descontaron de Stock.
// Ventas descuenta al pasar de "preparacion" a "armado"; si se salteo el
// descuento (stockBypassedAt) ese pedido ya no va a descontar nunca.
function pendingVentasItems(order = {}) {
  if (isTrue(order.cancelled) || order.cancelledAt) return [];
  if (order.recordType === 'exchange' || isTrue(order.isExchange)) return [];
  if (order.stockDeductedAt || order.stockBypassedAt) return [];
  return ventasOrderItems(order)
    .filter((item) => !item.stockDeductedAt && !item.printedGarmentId)
    .map((item) => ({
      sku: item.sku || '',
      talle: item.size || item.talle || '',
      color: item.color || '',
      quantity: Math.max(1, Number(item.quantity || 1))
    }));
}

function addPending(pendingByPrenda, alerts, prendas, item, source) {
  const resolved = resolveComponents(prendas, item.sku, item.talle, item.color);
  if (resolved.excluded) return;
  if (!resolved.components) {
    alerts.push({
      type: 'pendiente_sin_mapeo',
      message: `Pedido ${source.order}: ${resolved.error}`,
      source
    });
    return;
  }
  for (const { prenda } of resolved.components) {
    if (!pendingByPrenda.has(prenda.id)) pendingByPrenda.set(prenda.id, { quantity: 0, sources: [] });
    const entry = pendingByPrenda.get(prenda.id);
    entry.quantity += item.quantity;
    entry.sources.push({ ...source, sku: item.sku, quantity: item.quantity });
  }
}

// Las unicas prendas que deben ir en infinito en Tiendanube son las hechas
// sobre remera clasica u oversize (EXCLUDED_PRENDA_SKUS). Todo lo demas en
// infinito se marca para revisar: puede venderse sin stock real.
function describeInfinite(prendas, variant) {
  const excluded = isExcludedSku(prendas, variant.sku);
  const resolved = excluded ? { excluded: true } : resolveComponents(prendas, variant.sku, variant.talle, variant.color);
  let base = '';
  if (resolved.excluded) base = 'remera clásica / oversize';
  else if (resolved.components) base = resolved.components.map((c) => c.prenda.sku).join(' + ');
  return {
    productId: variant.productId,
    productName: variant.productName,
    sku: variant.sku,
    talle: variant.talle,
    color: variant.color,
    expected: Boolean(resolved.excluded),
    base: base || 'sin prenda en Stock'
  };
}

// Agrupa por SKU: { sku, productos, variantes, base, esperado }.
function groupInfinite(list) {
  const groups = new Map();
  for (const item of list) {
    const key = String(item.sku || '').trim().toUpperCase() || `producto:${item.productId}`;
    if (!groups.has(key)) {
      groups.set(key, { sku: item.sku || '', products: new Set(), variants: 0, bases: new Set(), expected: true });
    }
    const group = groups.get(key);
    group.products.add(item.productName);
    group.variants += 1;
    group.bases.add(item.base);
    group.expected = group.expected && item.expected;
  }
  return [...groups.values()]
    .map((g) => ({ sku: g.sku, products: [...g.products], variants: g.variants, base: [...g.bases].join(' / '), expected: g.expected }))
    .sort((a, b) => Number(a.expected) - Number(b.expected) || a.sku.localeCompare(b.sku));
}

function reconcile({ prendas = [], tnVariants = [], ventasOrders = [], tnOpenOrders = [], knownStoreOrders = new Set(), ignoredProductIds = new Set(), printedGarments = [] }) {
  const alerts = [];
  const pendingByPrenda = new Map();
  const printedByKey = availablePrinted(printedGarments);

  for (const order of ventasOrders) {
    const source = {
      origin: 'ventas',
      order: orderLabel(order),
      channel: order.salesChannel || '',
      status: order.status || ''
    };
    for (const item of pendingVentasItems(order)) addPending(pendingByPrenda, alerts, prendas, item, source);
  }

  for (const order of tnOpenOrders) {
    if (knownStoreOrders.has(String(order.number)) || knownStoreOrders.has(String(order.id))) continue;
    const source = {
      origin: 'tiendanube',
      order: String(order.number || order.id),
      channel: 'Tienda Nube (sin cargar en Ventas)',
      status: order.paymentStatus || ''
    };
    for (const item of order.items || []) addPending(pendingByPrenda, alerts, prendas, item, source);
  }

  const lines = [];
  const skipped = { infinite: 0, excluded: 0, ignored: 0 };
  const infinite = [];

  for (const variant of tnVariants) {
    if (ignoredProductIds.has(String(variant.productId))) {
      skipped.ignored += 1;
      continue;
    }
    if (variant.stock === null || variant.stock === undefined) {
      skipped.infinite += 1;
      infinite.push(describeInfinite(prendas, variant));
      continue;
    }
    const base = {
      productId: variant.productId,
      productName: variant.productName,
      variantId: variant.variantId,
      sku: variant.sku,
      talle: variant.talle,
      color: variant.color,
      tnStock: Number(variant.stock)
    };
    const printed = printedByKey.get(printedKey(variant.sku, variant.talle, variant.color)) || 0;
    const decide = (target) => {
      const diff = base.tnStock - target;
      return { diff, action: diff > 0 ? 'bajar' : diff < 0 ? 'subir' : 'ok' };
    };

    const resolved = isExcludedSku(prendas, variant.sku)
      ? { excluded: true }
      : resolveComponents(prendas, variant.sku, variant.talle, variant.color);
    if (resolved.excluded) {
      skipped.excluded += 1;
      continue;
    }
    if (!resolved.components) {
      if (!printed) {
        lines.push({ ...base, action: 'alerta', alert: 'sin_mapeo', reason: resolved.error, components: [], printed: 0 });
        continue;
      }
      // Sin prenda lisa en Stock pero con devoluciones estampadas: solo se
      // puede vender lo que ya esta estampado.
      lines.push({
        ...base,
        components: [],
        printed,
        expected: printed,
        target: printed,
        ...decide(printed),
        alert: '',
        reason: `Sin prenda lisa en Stock; solo cuenta ${printed} ya estampada(s).`
      });
      continue;
    }

    const components = resolved.components.map(({ prenda, matchType }) => {
      const pending = pendingByPrenda.get(prenda.id);
      const stock = Number(prenda.stock) || 0;
      const pendingQty = pending ? pending.quantity : 0;
      return {
        prendaId: prenda.id,
        sku: prenda.sku,
        modelo: prenda.modelo,
        talle: prenda.talle,
        color: prenda.color,
        stock,
        pending: pendingQty,
        pendingSources: pending ? pending.sources : [],
        expected: stock - pendingQty,
        matchType
      };
    });

    const expected = Math.min(...components.map((component) => component.expected));
    const target = Math.max(0, expected) + printed;

    lines.push({
      ...base,
      components,
      printed,
      expected,
      target,
      ...decide(target),
      alert: expected < 0 ? 'vendido_de_mas' : '',
      reason: expected < 0
        ? `Hay ${-expected} unidad(es) vendidas de mas que el stock de la app.`
        : ''
    });
  }

  const summary = {
    revisadas: lines.length,
    ok: lines.filter((line) => line.action === 'ok').length,
    bajar: lines.filter((line) => line.action === 'bajar').length,
    subir: lines.filter((line) => line.action === 'subir').length,
    alertas: lines.filter((line) => line.alert).length + alerts.length,
    infinitas: skipped.infinite,
    excluidas: skipped.excluded,
    ignoradas: skipped.ignored
  };

  return { summary, lines, alerts, infinite: groupInfinite(infinite) };
}

module.exports = { reconcile, pendingVentasItems };
