'use strict';
/**
 * Configuracion de valuacion de stock de estampas.
 *
 * SIZE_CATEGORIES son formatos estandar de medida (cm) para estampas sin
 * ancho/alto real cargado. La UI los muestra siempre como medida fisica
 * para evitar confundirlos con talles de prenda.
 */
const SIZE_CATEGORIES = {
  TALLE: { ancho_cm: 4, alto_cm: 2, area_cm2: 8 },
  XS: { ancho_cm: 6, alto_cm: 6, area_cm2: 36 },
  S: { ancho_cm: 20, alto_cm: 10, area_cm2: 200 },
  M: { ancho_cm: 30, alto_cm: 20, area_cm2: 600 },
  L: { ancho_cm: 10, alto_cm: 50, area_cm2: 500 },
  XL: { ancho_cm: 50, alto_cm: 50, area_cm2: 2500 },
};

// Valores validos para stamp_variants.valuation_size (incluye CUSTOM, que
// no tiene medida promedio propia: senala "usar ancho/alto real").
const VALUATION_SIZES = [...Object.keys(SIZE_CATEGORIES), 'CUSTOM'];

module.exports = { SIZE_CATEGORIES, VALUATION_SIZES };
