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

module.exports = { canonicalSalesItemsKey, isBackfillEventId, chooseBackfillDuplicateWinner };
