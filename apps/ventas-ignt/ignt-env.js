'use strict';
// Configuracion de Ventas IGNT. Es una copia de apps/ventas que corre en el
// mismo proceso que Ventas Incognito, asi que NO lee process.env directo:
// lee este objeto, que es una lista blanca.
//
//   - Compartido con Ventas Incognito: la contrasena (mismo login) y el
//     proyecto Supabase (VENTAS_SUPABASE_*), pero con tablas propias.
//   - Tiendanube IGNT: IGNT_TIENDANUBE_STORE_ID / _ACCESS_TOKEN / _CLIENT_ID /
//     _CLIENT_SECRET.
//   - Cualquier otra integracion (WhatsApp, Kommo, Flux, Mercado Pago,
//     SharePoint, Contable...) queda apagada hasta cargarla con prefijo
//     IGNT_VENTAS_ (ej. IGNT_VENTAS_MERCADOPAGO_ACCESS_TOKEN). Asi nunca
//     usa por accidente las credenciales de Incognito.

const COMPARTIDAS = ['PORT', 'VENTAS_APP_PASSWORD', 'APP_SESSION_SECRET', 'VENTAS_SUPABASE_URL', 'VENTAS_SUPABASE_SERVICE_ROLE_KEY'];

// Fijas: tablas y almacenamiento propios de IGNT. No se pueden pisar.
const FIJAS = {
  VENTAS_SUPABASE_STATE_TABLE: 'ventas_ignt_app_state',
  APP_STATE_ID: 'default',
  // Guardado en un unico JSON: el guardado por fila usa funciones de
  // Supabase atadas a las tablas de Incognito.
  VENTAS_ROW_STORAGE_ENABLED: 'false',
  SUPABASE_MEDIA_BUCKET: 'ventas-ignt-fotos'
};

function buildEnv(source = process.env) {
  const env = {};
  for (const key of COMPARTIDAS) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith('IGNT_VENTAS_')) env[key.slice('IGNT_VENTAS_'.length)] = value;
  }
  const tiendanube = {
    TIENDANUBE_STORE_ID: source.IGNT_TIENDANUBE_STORE_ID,
    TIENDANUBE_ACCESS_TOKEN: source.IGNT_TIENDANUBE_ACCESS_TOKEN,
    TIENDANUBE_CLIENT_ID: source.IGNT_TIENDANUBE_CLIENT_ID,
    TIENDANUBE_CLIENT_SECRET: source.IGNT_TIENDANUBE_CLIENT_SECRET
  };
  for (const [key, value] of Object.entries(tiendanube)) {
    if (value !== undefined) env[key] = value;
  }
  return Object.assign(env, FIJAS);
}

module.exports = buildEnv();
module.exports.buildEnv = buildEnv;
