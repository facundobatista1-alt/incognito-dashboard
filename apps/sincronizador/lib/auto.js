'use strict';
// Aplicacion automatica diaria (hora Argentina):
//   16:45  runPreNotice: arma el plan con los cambios del reporte, lo guarda
//          y manda el WhatsApp avisando que se van a aplicar.
//   17:00  runAutoApply: aplica SOLO ese plan, con los mismos controles que
//          el boton "Aplicar" (recalcula y relee cada variante; lo que cambio
//          en el medio se omite).
// Reglas de seguridad:
//   - Sin aviso enviado no hay aplicacion (el plan queda en "error").
//   - Si el automatico esta pausado, o el plan del dia se freno desde la
//     pantalla, no se aplica nada.
//   - Si los datos vienen raros (Stock/Tiendanube casi vacios) o hay una
//     cantidad anormal de cambios, no se programa nada.

const { describe } = require('./notify');

const MIN_PRENDAS = 20;
const MIN_TN_VARIANTS = 50;
const MAX_AUTO_CHANGES = () => Number(process.env.SINCRONIZADOR_MAX_AUTO_CAMBIOS || 80);
const APPLY_CHUNK = 100;

function isChange(line) {
  return line.action === 'bajar' || line.action === 'subir';
}

function buildPlan(result) {
  const lines = result.lines.filter(isChange);
  const bajar = lines.filter((line) => line.action === 'bajar');
  const subir = lines.filter((line) => line.action === 'subir');
  const parts = [];
  if (bajar.length) parts.push(`bajar ${describe(bajar)}`);
  if (subir.length) parts.push(`subir ${describe(subir)}`);
  return {
    items: lines.map((line) => ({
      variantId: String(line.variantId),
      productId: String(line.productId),
      from: line.tnStock,
      to: line.target,
      productName: line.productName,
      sku: line.sku,
      talle: line.talle,
      color: line.color,
      action: line.action
    })),
    resumen: { total: lines.length, bajar: bajar.length, subir: subir.length, texto: parts.join(' y ').slice(0, 900) }
  };
}

function sanityProblem(data, plan) {
  if ((data.prendas || []).length < MIN_PRENDAS) return `Stock devolvió solo ${(data.prendas || []).length} prendas.`;
  if ((data.tnVariants || []).length < MIN_TN_VARIANTS) return `Tiendanube devolvió solo ${(data.tnVariants || []).length} variantes.`;
  if (plan.items.length > MAX_AUTO_CHANGES()) {
    return `Hay ${plan.items.length} cambios (más de ${MAX_AUTO_CHANGES()}): demasiados para aplicarlos solos. Revisalos a mano.`;
  }
  return '';
}

// deps: { today, isPaused, getPlan, savePlan, loadData, reconcile, loadPhone, sendNotice, greeting }
async function runPreNotice(deps) {
  const fecha = deps.today();
  if (await deps.isPaused()) return { status: 'pausado', fecha };
  const existing = await deps.getPlan(fecha);
  if (existing && ['aplicando', 'aplicado', 'cancelado'].includes(existing.estado)) {
    return { status: `ya_${existing.estado}`, fecha };
  }

  const data = await deps.loadData();
  const plan = buildPlan(deps.reconcile(data));
  if (!plan.items.length) {
    await deps.savePlan({ fecha, estado: 'sin_cambios', items: [], resumen: plan.resumen, detalle: '' });
    return { status: 'sin_cambios', fecha };
  }
  const problem = sanityProblem(data, plan);
  if (problem) {
    await deps.savePlan({ fecha, estado: 'omitido', items: plan.items, resumen: plan.resumen, detalle: problem });
    return { status: 'omitido', fecha, detalle: problem };
  }

  await deps.savePlan({ fecha, estado: 'programado', items: plan.items, resumen: plan.resumen, detalle: '' });
  try {
    const phone = await deps.loadPhone();
    await deps.sendNotice(phone, [deps.greeting(), String(plan.resumen.total), plan.resumen.texto]);
  } catch (err) {
    // Sin aviso, no se aplica.
    await deps.savePlan({ fecha, estado: 'error', items: plan.items, resumen: plan.resumen, detalle: `No se pudo mandar el aviso: ${err.message}` });
    return { status: 'error', fecha, detalle: err.message };
  }
  return { status: 'programado', fecha, resumen: plan.resumen };
}

// deps: { today, isPaused, getPlan, savePlan, applyChanges }
// applyChanges(items) -> { aplicados, omitidos, errores }
async function runAutoApply(deps) {
  const fecha = deps.today();
  const plan = await deps.getPlan(fecha);
  if (!plan) return { status: 'sin_plan', fecha };
  if (plan.estado !== 'programado') return { status: plan.estado, fecha };
  if (await deps.isPaused()) {
    await deps.savePlan({ ...plan, estado: 'omitido', detalle: 'El automático estaba pausado.' });
    return { status: 'pausado', fecha };
  }

  await deps.savePlan({ ...plan, estado: 'aplicando' });
  const totals = { aplicados: 0, omitidos: 0, errores: 0 };
  try {
    const items = plan.items || [];
    for (let start = 0; start < items.length; start += APPLY_CHUNK) {
      const outcome = await deps.applyChanges(items.slice(start, start + APPLY_CHUNK));
      totals.aplicados += outcome.aplicados;
      totals.omitidos += outcome.omitidos;
      totals.errores += outcome.errores;
    }
    await deps.savePlan({ ...plan, estado: 'aplicado', resultado: totals, applied_at: new Date().toISOString() });
    return { status: 'aplicado', fecha, ...totals };
  } catch (err) {
    await deps.savePlan({ ...plan, estado: 'error', resultado: totals, detalle: `Falló al aplicar: ${err.message}` });
    return { status: 'error', fecha, detalle: err.message, ...totals };
  }
}

module.exports = { buildPlan, sanityProblem, runPreNotice, runAutoApply, MAX_AUTO_CHANGES };
