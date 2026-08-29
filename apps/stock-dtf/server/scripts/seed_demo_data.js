'use strict';
/**
 * Carga datos de DEMOSTRACION claramente marcados, para revisar la app
 * visualmente. Corre contra un servidor YA LEVANTADO en localhost.
 * No inventa estampas nuevas (usa 5 de las 111 reales para setear stock de
 * ejemplo); los productos y la orden de produccion son 100% ficticios y
 * llevan el prefijo "DEMO -" en el nombre para que sean inconfundibles.
 * Usuario de todos los movimientos: "demo-revision" (facil de filtrar/
 * identificar despues en Movimientos).
 */
const BASE = process.env.DEMO_BASE_URL || 'http://localhost:3001';
const USUARIO = 'demo-revision';

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  console.log('Conectando a', BASE, '...');
  const estampas = await api('/api/estampas');
  if (estampas.length < 6) throw new Error('Se esperaban al menos 6 estampas ya cargadas (111 esperadas). Corré primero la migración.');
  console.log(`Catálogo: ${estampas.length} estampas encontradas.`);

  const [e1, e2, e3, eBajo, eAgotada] = estampas;

  console.log('Cargando stock de ejemplo en 5 estampas reales...');
  await api(`/api/carga-inicial/${e1.id}`, { method: 'POST', body: { cantidad: 48, stock_minimo: 10, usuario: USUARIO } });
  await api(`/api/carga-inicial/${e2.id}`, { method: 'POST', body: { cantidad: 120, stock_minimo: 15, usuario: USUARIO } });
  await api(`/api/carga-inicial/${e3.id}`, { method: 'POST', body: { cantidad: 30, stock_minimo: 5, usuario: USUARIO } });
  await api(`/api/carga-inicial/${eBajo.id}`, { method: 'POST', body: { cantidad: 3, stock_minimo: 10, usuario: USUARIO } }); // stock bajo
  await api(`/api/carga-inicial/${eAgotada.id}`, { method: 'POST', body: { cantidad: 0, stock_minimo: 5, usuario: USUARIO } }); // agotada
  console.log(`  OK: ${e1.codigo} (48), ${e2.codigo} (120), ${e3.codigo} (30), ${eBajo.codigo} (3, stock bajo), ${eAgotada.codigo} (0, agotada)`);

  console.log('Creando 2 productos DEMO con receta...');
  const p1 = await api('/api/productos', { method: 'POST', body: { sku: 'DEMO-REMERA-M', nombre: 'DEMO - Remera básica', variante: 'M' } });
  const p2 = await api('/api/productos', { method: 'POST', body: { sku: 'DEMO-BUZO-L', nombre: 'DEMO - Buzo básico', variante: 'L' } });
  await api('/api/recetas', { method: 'POST', body: { product_id: p1.id, stamp_variant_id: e1.id, cantidad_por_unidad: 1, ubicacion_aplicacion: 'frente', usuario: USUARIO } });
  await api('/api/recetas', { method: 'POST', body: { product_id: p2.id, stamp_variant_id: e2.id, cantidad_por_unidad: 1, ubicacion_aplicacion: 'espalda', usuario: USUARIO } });
  console.log(`  OK: DEMO-REMERA-M -> ${e1.codigo} (frente), DEMO-BUZO-L -> ${e2.codigo} (espalda)`);

  console.log('Generando movimientos de ejemplo (un descuento simulado + un ingreso extra)...');
  await api(`/api/stamps/v1/pedidos/DEMO-PEDIDO-1/descontar`, {
    method: 'POST',
    body: { usuario: USUARIO, items: [{ sku: 'DEMO-REMERA-M', cantidad: 2, itemRef: 'sku:demo-remera-m' }] },
  });
  await api(`/api/estampas/${e3.id}/ingreso`, { method: 'POST', body: { cantidad: 10, usuario: USUARIO, motivo: 'DEMO - reposición de ejemplo' } });
  console.log('  OK: descuento simulado del pedido DEMO-PEDIDO-1 + un ingreso manual de ejemplo.');

  console.log('Creando 1 orden de producción DEMO...');
  const orden = await api('/api/produccion', {
    method: 'POST',
    body: { items: [{ stamp_variant_id: eAgotada.id, cantidad_necesaria: 50 }], notas: 'DEMO - reposición de ejemplo para revisión visual', usuario: USUARIO },
  });
  console.log(`  OK: orden de producción #${orden.id} para reponer ${eAgotada.codigo} (la estampa agotada).`);

  console.log('\n✅ Datos de demostración cargados. Todo con usuario "demo-revision" y prefijo "DEMO -" para identificarlos fácil.');
}

main().catch((err) => { console.error('ERROR:', err.message); process.exit(1); });
