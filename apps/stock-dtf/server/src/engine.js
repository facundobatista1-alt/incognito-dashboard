'use strict';
/**
 * Motor transaccional de stock de estampas DTF -- version Postgres/Supabase.
 *
 * Reglas clave (ver docs/INTEGRACION_VENTAS.md y docs/SUPABASE.md):
 *  - Todo lo que cambia stock corre dentro de una transaccion real de
 *    Postgres (BEGIN/COMMIT/ROLLBACK vía db.transaction).
 *  - El descuento de stock (`stamp_inventory.cantidad_disponible`) se hace
 *    siempre con un UPDATE atomico de una sola sentencia (nunca
 *    "leer, calcular en JS, escribir"), asi que dos pedidos que descuentan
 *    la MISMA estampa al mismo tiempo se serializan naturalmente por el
 *    row lock de Postgres -- no hay ventana de carrera.
 *  - La idempotencia de los descuentos por pedido vive en la tabla
 *    `stamp_processed_events` (constraint UNIQUE en base de datos, no solo
 *    en memoria): para cada (pedido, item, estampa) se guarda cuanto esta
 *    aplicado en este momento, y cada evento nuevo se reconcilia por
 *    DIFERENCIA contra eso, con `SELECT ... FOR UPDATE` para que dos
 *    llamadas simultaneas sobre la MISMA linea de pedido tambien se
 *    serialicen en vez de pisarse.
 *  - Nunca se borran movimientos. Las reversas y correcciones generan
 *    movimientos NUEVOS que referencian al original.
 */

class StockError extends Error {
  constructor(message, code, details) {
    super(message);
    this.code = code || 'STOCK_ERROR';
    this.details = details || {};
  }
}

function recomputeEstado(row) {
  if (row.estado === 'Discontinuada') return row.estado;
  const cantidad = row.cantidad_disponible;
  if (cantidad === null || cantidad === undefined) return 'Pendiente de revision';
  if (cantidad <= 0) return 'Agotada';
  if (cantidad <= (row.stock_minimo || 0)) return 'Stock bajo';
  return 'Disponible';
}

async function getVariantWithStock(tx, variantId) {
  const r = await tx.query(
    `select sv.*, si.cantidad_disponible, si.stock_minimo
     from stamp_variants sv join stamp_inventory si on si.stamp_variant_id = sv.id
     where sv.id = $1`,
    [variantId]
  );
  return r.rows[0] || null;
}

/**
 * Aplica un delta atomico al stock. delta puede ser + o -.
 * Devuelve {stock_anterior, stock_posterior}. Si permitirNegativo=false y el
 * resultado seria negativo, NO aplica el cambio y tira StockError.
 */
async function applyStockDelta(tx, variantId, delta, { permitirNegativo }) {
  const variant = await tx.query('select nombre, codigo from stamp_variants where id = $1', [variantId]);
  if (!variant.rows[0]) throw new StockError(`Estampa ${variantId} no existe`, 'NOT_FOUND');

  const whereGuard = permitirNegativo ? '' : 'and (coalesce(cantidad_disponible,0) + $1) >= 0';
  const r = await tx.query(
    `update stamp_inventory
       set cantidad_disponible = coalesce(cantidad_disponible,0) + $1, updated_at = now()
       where stamp_variant_id = $2 ${whereGuard}
       returning cantidad_disponible as stock_posterior, cantidad_disponible - $1 as stock_anterior`,
    [delta, variantId]
  );

  if (r.rows.length === 0) {
    const current = await tx.query('select cantidad_disponible from stamp_inventory where stamp_variant_id = $1', [variantId]);
    const disponible = current.rows[0] ? (current.rows[0].cantidad_disponible ?? 0) : 0;
    throw new StockError(
      `Stock insuficiente para "${variant.rows[0].nombre}" (${variant.rows[0].codigo}): disponible ${disponible}, se necesitan ${-delta}`,
      'INSUFFICIENT_STOCK',
      { variantId, disponible, requerido: -delta }
    );
  }

  const { stock_anterior, stock_posterior } = r.rows[0];
  const estado = recomputeEstado({ ...(await getVariantWithStock(tx, variantId)) });
  await tx.query('update stamp_variants set estado = $1, updated_at = now() where id = $2', [estado, variantId]);

  return { stock_anterior, stock_posterior };
}

async function insertMovement(tx, f) {
  const r = await tx.query(
    `insert into stamp_movements
       (stamp_variant_id, tipo, cantidad, direccion, stock_anterior, stock_posterior, pedido_id,
        pedido_item_ref, sku, production_order_id, usuario, motivo, evento_origen, idempotency_key,
        movimiento_relacionado_id, correccion_cantidad_anterior, correccion_cantidad_nueva)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     returning id`,
    [f.stamp_variant_id, f.tipo, f.cantidad, f.direccion, f.stock_anterior ?? null, f.stock_posterior ?? null,
     f.pedido_id || null, f.pedido_item_ref || null, f.sku || null, f.production_order_id || null,
     f.usuario || 'sistema', f.motivo || null, f.evento_origen || null, f.idempotency_key || null,
     f.movimiento_relacionado_id || null, f.correccion_cantidad_anterior ?? null, f.correccion_cantidad_nueva ?? null]
  );
  return r.rows[0].id;
}

// ---------------------------------------------------------------------------
// 1) Ingreso manual de stock
// ---------------------------------------------------------------------------
async function ingreso(db, { variantId, cantidad, tipo, usuario, motivo, productionOrderId }) {
  if (!Number.isInteger(cantidad) || cantidad <= 0) {
    throw new StockError('La cantidad de ingreso debe ser un entero positivo', 'INVALID_INPUT');
  }
  return db.transaction(async (tx) => {
    const { stock_anterior, stock_posterior } = await applyStockDelta(tx, variantId, cantidad, { permitirNegativo: true });
    const movementId = await insertMovement(tx, {
      stamp_variant_id: variantId, tipo: tipo || 'ingreso', cantidad, direccion: 'entrada',
      stock_anterior, stock_posterior, usuario, motivo, evento_origen: 'manual',
      production_order_id: productionOrderId || null,
    });
    await tx.query('update stamp_inventory set pendiente_de_contar = false where stamp_variant_id = $1 and pendiente_de_contar = true', [variantId]);
    return { movementId, stock_anterior, stock_posterior };
  });
}

// ---------------------------------------------------------------------------
// 2) Salida manual (perdida / dano)
// ---------------------------------------------------------------------------
async function salidaManual(db, { variantId, cantidad, tipo, usuario, motivo }) {
  if (!Number.isInteger(cantidad) || cantidad <= 0) throw new StockError('La cantidad debe ser un entero positivo', 'INVALID_INPUT');
  if (!['perdida', 'dano'].includes(tipo)) throw new StockError('Tipo invalido para salida manual', 'INVALID_INPUT');
  return db.transaction(async (tx) => {
    const { stock_anterior, stock_posterior } = await applyStockDelta(tx, variantId, -cantidad, { permitirNegativo: false });
    const movementId = await insertMovement(tx, {
      stamp_variant_id: variantId, tipo, cantidad, direccion: 'salida',
      stock_anterior, stock_posterior, usuario, motivo, evento_origen: 'manual',
    });
    return { movementId, stock_anterior, stock_posterior };
  });
}

// ---------------------------------------------------------------------------
// 3) Correccion manual / carga inicial (ajuste_inicial)
// ---------------------------------------------------------------------------
async function correccionManual(db, { variantId, cantidadNueva, usuario, motivo, tipo }) {
  if (!usuario) throw new StockError('Requiere usuario responsable', 'INVALID_INPUT');
  if (!Number.isInteger(cantidadNueva) || cantidadNueva < 0) throw new StockError('La cantidad nueva debe ser un entero >= 0', 'INVALID_INPUT');

  return db.transaction(async (tx) => {
    const current = await tx.query('select cantidad_disponible from stamp_inventory where stamp_variant_id = $1 for update', [variantId]);
    if (!current.rows[0]) throw new StockError(`Estampa ${variantId} no existe`, 'NOT_FOUND');
    const cantidadAnterior = current.rows[0].cantidad_disponible === null ? 0 : current.rows[0].cantidad_disponible;
    const delta = cantidadNueva - cantidadAnterior;

    const { stock_anterior, stock_posterior } = await applyStockDelta(tx, variantId, delta, { permitirNegativo: true });
    const movementId = await insertMovement(tx, {
      stamp_variant_id: variantId, tipo: tipo || 'correccion', cantidad: Math.abs(delta),
      direccion: delta >= 0 ? 'entrada' : 'salida', stock_anterior, stock_posterior, usuario, motivo: motivo || null,
      evento_origen: tipo === 'ajuste_inicial' ? 'carga_inicial' : 'manual',
      correccion_cantidad_anterior: cantidadAnterior, correccion_cantidad_nueva: cantidadNueva,
    });
    await tx.query(
      `update stamp_inventory set pendiente_de_contar = false, contado_en = now(), contado_por = $2
       where stamp_variant_id = $1`,
      [variantId, usuario]
    );
    return { movementId, stock_anterior, stock_posterior };
  });
}

// ---------------------------------------------------------------------------
// 4) Reconciliacion de consumo por pedido -- el corazon de la integracion.
// ---------------------------------------------------------------------------
async function reconcileOrderConsumption(db, { pedidoId, evento, consumos, usuario }) {
  return db.transaction(async (tx) => {
    const resultados = [];
    const advertencias = [];

    for (const c of consumos) {
      const { itemRef, stampVariantId, cantidadRequerida, ubicacion, sku } = c;

      // Lock de la fila de idempotencia para esta linea especifica -- si dos
      // requests para el MISMO (pedido,item,estampa) llegan a la vez, la
      // segunda espera a que la primera termine su transaccion.
      const existing = await tx.query(
        `select * from stamp_processed_events where pedido_id=$1 and pedido_item_ref=$2 and stamp_variant_id=$3 for update`,
        [pedidoId, itemRef, stampVariantId]
      );
      const cantidadAplicada = existing.rows[0] ? existing.rows[0].cantidad_aplicada : 0;
      const delta = cantidadRequerida - cantidadAplicada;

      if (delta === 0) {
        resultados.push({ itemRef, stampVariantId, accion: 'sin_cambios', cantidad: 0 });
        continue;
      }

      let movementId = null;
      const idempotencyKey = `${pedidoId}:${itemRef}:${sku || ''}:${stampVariantId}:${evento}:${cantidadRequerida}:${Date.now()}`;

      if (delta > 0) {
        const inv = await tx.query('select cantidad_disponible, nombre from stamp_inventory si join stamp_variants sv on sv.id=si.stamp_variant_id where si.stamp_variant_id=$1 for update', [stampVariantId]);
        const disponible = inv.rows[0] ? (inv.rows[0].cantidad_disponible ?? 0) : 0;
        if (!inv.rows[0] || disponible < delta) {
          advertencias.push({
            itemRef, stampVariantId, sku, motivo: 'stock_insuficiente',
            detalle: `Se necesitan ${delta} de "${inv.rows[0] ? inv.rows[0].nombre : stampVariantId}" y hay ${disponible} disponibles`,
          });
          resultados.push({ itemRef, stampVariantId, accion: 'advertencia_stock_insuficiente', cantidad: delta });
          continue;
        }
        const stockInfo = await applyStockDelta(tx, stampVariantId, -delta, { permitirNegativo: false });
        movementId = await insertMovement(tx, {
          stamp_variant_id: stampVariantId, tipo: 'descuento_pedido', cantidad: delta, direccion: 'salida',
          stock_anterior: stockInfo.stock_anterior, stock_posterior: stockInfo.stock_posterior,
          pedido_id: pedidoId, pedido_item_ref: itemRef, sku, usuario: usuario || 'sistema',
          motivo: `Transicion "${evento}"${ubicacion ? ' - ' + ubicacion : ''}`,
          evento_origen: evento, idempotency_key: idempotencyKey,
        });
        resultados.push({ itemRef, stampVariantId, accion: 'descuento', cantidad: delta, movementId });
      } else {
        const reintegro = -delta;
        const stockInfo = await applyStockDelta(tx, stampVariantId, reintegro, { permitirNegativo: true });
        movementId = await insertMovement(tx, {
          stamp_variant_id: stampVariantId, tipo: 'reintegro', cantidad: reintegro, direccion: 'entrada',
          stock_anterior: stockInfo.stock_anterior, stock_posterior: stockInfo.stock_posterior,
          pedido_id: pedidoId, pedido_item_ref: itemRef, sku, usuario: usuario || 'sistema',
          motivo: `Reintegro por transicion "${evento}"${ubicacion ? ' - ' + ubicacion : ''}`,
          evento_origen: evento, idempotency_key: idempotencyKey,
          movimiento_relacionado_id: existing.rows[0] ? existing.rows[0].last_movement_id : null,
        });
        resultados.push({ itemRef, stampVariantId, accion: 'reintegro', cantidad: reintegro, movementId });
      }

      await tx.query(
        `insert into stamp_processed_events
           (pedido_id, pedido_item_ref, sku, stamp_variant_id, cantidad_aplicada, ultimo_evento,
            ultima_cantidad_procesada, idempotency_key, last_movement_id, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
         on conflict (pedido_id, pedido_item_ref, stamp_variant_id) do update set
           cantidad_aplicada = excluded.cantidad_aplicada,
           ultimo_evento = excluded.ultimo_evento,
           ultima_cantidad_procesada = excluded.ultima_cantidad_procesada,
           idempotency_key = excluded.idempotency_key,
           last_movement_id = excluded.last_movement_id,
           updated_at = now()`,
        [pedidoId, itemRef, sku || null, stampVariantId, cantidadRequerida, evento, delta, idempotencyKey, movementId]
      );
    }

    const resultado = advertencias.length ? 'advertencia' : 'ok';
    await tx.query(
      `insert into stamp_order_transition_log (pedido_id, evento, resultado, detalle_json) values ($1,$2,$3,$4)`,
      [pedidoId, evento, resultado, JSON.stringify({ resultados, advertencias })]
    );

    return { resultados, advertencias };
  });
}

// ---------------------------------------------------------------------------
// 5) Recepcion de produccion -> ingreso automatico
// ---------------------------------------------------------------------------
async function recibirProduccionItem(db, { orderItemId, cantidadRecibida, usuario }) {
  if (!Number.isInteger(cantidadRecibida) || cantidadRecibida <= 0) {
    throw new StockError('La cantidad recibida debe ser un entero positivo', 'INVALID_INPUT');
  }
  return db.transaction(async (tx) => {
    const item = await tx.query(
      `select poi.*, po.estado as orden_estado
       from stamp_production_order_items poi join stamp_production_orders po on po.id = poi.production_order_id
       where poi.id = $1 for update`,
      [orderItemId]
    );
    if (!item.rows[0]) throw new StockError('Item de orden de produccion no encontrado', 'NOT_FOUND');
    if (item.rows[0].cantidad_recibida != null) throw new StockError('Este item ya fue marcado como recibido', 'ALREADY_RECEIVED');

    const { stock_anterior, stock_posterior } = await applyStockDelta(tx, item.rows[0].stamp_variant_id, cantidadRecibida, { permitirNegativo: true });
    const movementId = await insertMovement(tx, {
      stamp_variant_id: item.rows[0].stamp_variant_id, tipo: 'produccion', cantidad: cantidadRecibida, direccion: 'entrada',
      stock_anterior, stock_posterior, usuario, motivo: `Recepcion de orden de produccion #${item.rows[0].production_order_id} (item ${orderItemId})`,
      evento_origen: 'produccion', production_order_id: item.rows[0].production_order_id,
    });
    await tx.query('update stamp_production_order_items set cantidad_recibida = $1 where id = $2', [cantidadRecibida, orderItemId]);

    const pending = await tx.query(
      'select count(*) n from stamp_production_order_items where production_order_id = $1 and cantidad_recibida is null',
      [item.rows[0].production_order_id]
    );
    if (Number(pending.rows[0].n) === 0) {
      await tx.query(`update stamp_production_orders set estado='Recibido', updated_at=now() where id=$1`, [item.rows[0].production_order_id]);
    }
    return { movementId, stock_anterior, stock_posterior };
  });
}

module.exports = {
  StockError, recomputeEstado, getVariantWithStock,
  ingreso, salidaManual, correccionManual,
  reconcileOrderConsumption, recibirProduccionItem,
};
