'use strict';
// Negocios que maneja el sincronizador. Incognito es el original: Ventas,
// automatico y avisos por WhatsApp. IGNT es la cascara para el segundo
// negocio: lee su propia tabla de Stock (prendas_ignt) y su propia tienda de
// Tiendanube (variables IGNT_TIENDANUBE_*). Todavia no tiene panel de Ventas,
// automatico ni avisos; cuando exista su Ventas se conecta en `ventas`.

const NEGOCIOS = {
  incognito: {
    id: 'incognito',
    nombre: 'Incognito',
    tablaPrendas: 'prendas',
    tiendanube: {
      storeId: () => process.env.TIENDANUBE_STORE_ID || '',
      accessToken: () => process.env.TIENDANUBE_ACCESS_TOKEN || '',
      clientId: () => process.env.TIENDANUBE_CLIENT_ID || '',
      envStoreId: 'TIENDANUBE_STORE_ID',
      envAccessToken: 'TIENDANUBE_ACCESS_TOKEN'
    },
    ventas: true,
    automatico: true,
    // SKUs de Tiendanube que van en infinito a proposito aunque no esten en
    // Stock. En Incognito eso lo decide EXCLUDED_PRENDA_SKUS (mapping.js).
    infinitoEsperado: () => false
  },
  ignt: {
    id: 'ignt',
    nombre: 'IGNT',
    tablaPrendas: 'prendas_ignt',
    tiendanube: {
      storeId: () => process.env.IGNT_TIENDANUBE_STORE_ID || '',
      accessToken: () => process.env.IGNT_TIENDANUBE_ACCESS_TOKEN || '',
      clientId: () => process.env.IGNT_TIENDANUBE_CLIENT_ID || '',
      envStoreId: 'IGNT_TIENDANUBE_STORE_ID',
      envAccessToken: 'IGNT_TIENDANUBE_ACCESS_TOKEN'
    },
    ventas: false,
    automatico: false,
    // Remeras oversize y musculosas DTF se estampan a pedido: infinito.
    infinitoEsperado: (sku) => /^(over|musc)-/i.test(String(sku || '').trim())
  }
};

function getNegocio(id) {
  return NEGOCIOS[id] || NEGOCIOS.incognito;
}

// Lo que llega de la pantalla (?negocio=ignt). Cualquier otra cosa es Incognito.
function negocioId(value) {
  return NEGOCIOS[value] ? value : 'incognito';
}

module.exports = { NEGOCIOS, getNegocio, negocioId };
