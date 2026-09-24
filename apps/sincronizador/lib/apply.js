'use strict';
// Aplica en Tiendanube los cambios que el usuario aprobo en el reporte.
//
// Solo escribe si TODO sigue igual que lo que el usuario vio: se recalcula
// la conciliacion completa y se relee la variante justo antes de escribir.
// Si algo cambio en el medio (entro una venta, alguien toco el stock), esa
// linea se omite y se pide regenerar el reporte. Cada intento queda
// registrado (aplicado / omitido / error).
//
// Las dependencias de red se inyectan para poder testearlo sin Tiendanube.

const MAX_ITEMS = 100;

async function applyChanges(requests, deps) {
  const { recompute, readStock, writeStock, logChange, pause = async () => {} } = deps;
  const wanted = (Array.isArray(requests) ? requests : []).slice(0, MAX_ITEMS);
  const fresh = await recompute();
  const linesByVariant = new Map(fresh.lines.map((line) => [String(line.variantId), line]));
  const results = [];

  for (const [index, request] of wanted.entries()) {
    const variantId = String(request.variantId || '');
    const from = Number(request.from);
    const to = Number(request.to);
    const line = linesByVariant.get(variantId);
    const base = {
      variantId,
      productId: line?.productId ?? request.productId ?? '',
      productName: line?.productName ?? '',
      sku: line?.sku ?? '',
      talle: line?.talle ?? '',
      color: line?.color ?? ''
    };
    const finish = async (status, detail, before, after) => {
      const result = { ...base, status, detail, before, after };
      results.push(result);
      try {
        await logChange(result);
      } catch (err) {
        result.logError = err.message;
      }
    };

    if (!line || (line.action !== 'bajar' && line.action !== 'subir')) {
      await finish('omitido', 'Ya no hay cambio pendiente para esta variante. Regenerá el reporte.', from, null);
      continue;
    }
    if (line.tnStock !== from || line.target !== to) {
      await finish('omitido', `Cambió desde el reporte: ahora Tiendanube tiene ${line.tnStock} y lo correcto es ${line.target}. Regenerá el reporte.`, line.tnStock, null);
      continue;
    }

    try {
      if (index > 0) await pause();
      const current = await readStock(line.productId, line.variantId);
      if (current !== from) {
        await finish('omitido', `Tiendanube cambió recién (ahora tiene ${current === null ? 'infinito' : current}). No se tocó.`, current, null);
        continue;
      }
      const after = await writeStock(line.productId, line.variantId, to);
      if (after !== to) {
        await finish('error', `Tiendanube respondió con stock ${after} en vez de ${to}.`, from, after);
        continue;
      }
      await finish('aplicado', '', from, after);
    } catch (err) {
      await finish('error', err.message, from, null);
    }
  }

  return {
    results,
    aplicados: results.filter((r) => r.status === 'aplicado').length,
    omitidos: results.filter((r) => r.status === 'omitido').length,
    errores: results.filter((r) => r.status === 'error').length
  };
}

module.exports = { applyChanges, MAX_ITEMS };
