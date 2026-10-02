'use strict';

function canonicalSalesItemsKey(items) {
  return JSON.stringify((Array.isArray(items) ? items : []).map(item => ({
    itemRef: String(item.itemRef || item.item_ref || '').trim(),
    sku: String(item.sku || item.codigo || '').trim().toUpperCase(),
    talle: String(item.talle || item.size || '').trim().toUpperCase(),
    cantidad: Number(item.cantidad ?? item.quantity ?? 0),
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

function isBackfillEventId(eventId) {
  return /(?:^|[:_-])backfill(?:[:_-]|$)/i.test(String(eventId || ''));
}

function chooseBackfillDuplicateWinner(rows) {
  const candidates = Array.isArray(rows) ? rows : [];
  if (candidates.length < 2 || !candidates.some(row => isBackfillEventId(row.event_id))) return null;

  const statusPriority = { aplicado: 50, advertencia: 40, pendiente: 30, error: 20, ignorado: 0 };
  return [...candidates].sort((a, b) => {
    const statusDiff = (statusPriority[b.status] || 0) - (statusPriority[a.status] || 0);
    if (statusDiff) return statusDiff;
    const sourceDiff = Number(isBackfillEventId(a.event_id)) - Number(isBackfillEventId(b.event_id));
    if (sourceDiff) return sourceDiff;
    return Date.parse(a.occurred_at || 0) - Date.parse(b.occurred_at || 0);
  })[0];
}

function stableSalesItemKey(pedidoId, itemRef) {
  const value = String(itemRef || '').trim();
  const prefix = `${String(pedidoId || '').trim()}:`;
  if (!value.startsWith(prefix)) return value;
  const remainder = value.slice(prefix.length);
  const lineId = remainder.split(':')[0];
  return lineId ? `${prefix}${lineId}` : value;
}

function comparableSalesItem(item) {
  return JSON.stringify({
    sku: String(item.sku || '').trim().toUpperCase(),
    talle: String(item.talle || '').trim().toUpperCase(),
    cantidad: Number(item.cantidad || 0),
  });
}

function annotateSalesEventChanges(rows) {
  const events = Array.isArray(rows) ? rows : [];
  const annotations = new Map();
  const orderStates = new Map();
  const actionableStatuses = new Set(['pendiente', 'advertencia', 'error']);
  const chronological = [...events].sort((a, b) => {
    const dateDiff = Date.parse(a.occurred_at || 0) - Date.parse(b.occurred_at || 0);
    return dateDiff || String(a.event_id || '').localeCompare(String(b.event_id || ''));
  });
  const supersedingModificationIndex = new Map();
  chronological.forEach((event, index) => {
    if (event.evento === 'modificacion' && actionableStatuses.has(event.status)) {
      supersedingModificationIndex.set(String(event.pedido_id || ''), index);
    }
  });

  for (let eventIndex = 0; eventIndex < chronological.length; eventIndex++) {
    const event = chronological[eventIndex];
    const pedidoId = String(event.pedido_id || '');
    const current = orderStates.get(pedidoId) || new Map();
    const items = Array.isArray(event.items_json) ? event.items_json : [];
    const changes = [];

    if (event.status === 'ignorado') {
      annotations.set(event.event_id, { changes_json: [], change_count: 0, redundant: true });
      continue;
    }

    if (actionableStatuses.has(event.status)
        && eventIndex < (supersedingModificationIndex.get(pedidoId) ?? -1)) {
      annotations.set(event.event_id, {
        changes_json: [], change_count: 0, redundant: true,
        redundant_reason: 'Incluido en una modificación posterior.',
      });
      continue;
    }

    if (event.evento === 'armado_a_preparacion' || event.evento === 'cancelacion') {
      for (const item of current.values()) changes.push({ ...item, cantidad: 0, cambio: 'reintegro' });
      current.clear();
    } else if (event.evento === 'modificacion') {
      const next = new Map();
      for (const item of items) {
        const key = stableSalesItemKey(pedidoId, item.itemRef);
        const previous = current.get(key);
        next.set(key, item);
        if (!previous || comparableSalesItem(previous) !== comparableSalesItem(item)) {
          changes.push({ ...item, cambio: previous ? 'modificado' : 'nuevo' });
        }
      }
      for (const [key, previous] of current) {
        if (!next.has(key)) changes.push({ ...previous, cantidad: 0, cambio: 'eliminado' });
      }
      orderStates.set(pedidoId, next);
    } else {
      for (const item of items) {
        const key = stableSalesItemKey(pedidoId, item.itemRef);
        const previous = current.get(key);
        if (!previous || comparableSalesItem(previous) !== comparableSalesItem(item)) {
          changes.push({ ...item, cambio: previous ? 'modificado' : 'nuevo' });
          current.set(key, item);
        }
      }
      orderStates.set(pedidoId, current);
    }

    annotations.set(event.event_id, {
      changes_json: changes,
      change_count: changes.length,
      redundant: changes.length === 0,
      redundant_reason: changes.length === 0 ? 'Ya está cubierto por otro movimiento.' : null,
    });
  }

  return events.map(event => ({
    ...event,
    ...(annotations.get(event.event_id) || {
      changes_json: [], change_count: 0, redundant: true,
      redundant_reason: 'Sin cambios para aplicar.',
    }),
  }));
}

module.exports = {
  canonicalSalesItemsKey,
  isBackfillEventId,
  chooseBackfillDuplicateWinner,
  stableSalesItemKey,
  annotateSalesEventChanges,
};
