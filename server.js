'use strict';
const path = require('path');
const express = require('express');

const app = express();

// --- Stock estampas DTF, montado como sub-app bajo /stock-dtf ---
// server.js exporta el express.app; solo llama a start()/app.listen() cuando
// corre standalone (require.main === module), asi que se puede montar aca
// sin que abra su propio puerto. Igual hay que asegurar el schema a mano,
// porque eso tambien vive adentro de start().
const stockDtfApp = require('./apps/stock-dtf/server/src/server.js');
const { ensureSchema } = require('./apps/stock-dtf/server/src/db.js');

app.use('/stock-dtf', stockDtfApp);

// --- Contable, montado como sub-app bajo /contable ---
// Mismo patron: server.js exporta el app y solo hace listen() standalone.
const contableApp = require('./apps/contable/server.js');

app.use('/contable', contableApp);

// --- Stock, montado como sub-app bajo /stock ---
const stockApp = require('./apps/stock/server.js');

app.use('/stock', stockApp);

// --- Tareas, montado como sub-app bajo /tareas ---
const tareasApp = require('./apps/tareas/server.js');

app.use('/tareas', tareasApp);

// --- Ventas, montado como sub-app bajo /ventas ---
// Igual patron que Tareas (auth por password + cookie, req.baseUrl para
// redirects/cookies, fetch relativos en el frontend). El servicio standalone
// incognito-ventas sigue desplegado aparte y no se toca: Contable (MP
// releases) y Stock DTF (pending-print) todavia le pegan a ese por URL fija,
// asi que esta copia montada queda inerte hasta que se carguen sus propias
// credenciales (Tiendanube, WhatsApp/Kommo, Flux, Mercado Pago) en Render.
const ventasApp = require('./apps/ventas/server.js');

app.use('/ventas', ventasApp);

// --- Estadisticas, montado como sub-app bajo /estadisticas ---
// Mismo patron: password propia (ESTADISTICAS_APP_PASSWORD) y credenciales
// Tiendanube propias (prefijo ESTADISTICAS_TIENDANUBE_...) para no pisar las
// de Ventas, que ya usa TIENDANUBE_CLIENT_ID/SECRET/STORE_ID/ACCESS_TOKEN sin
// prefijo en este mismo proceso. El servicio standalone estadisticas-nube-local
// sigue desplegado aparte y no se toca; esta copia queda inerte hasta cargar
// sus propias credenciales en Render.
const estadisticasApp = require('./apps/estadisticas/server.js');

app.use('/estadisticas', estadisticasApp);

// --- Shell del panel ---
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 10000;

ensureSchema()
  .catch((err) => {
    console.error('[stock-dtf] error asegurando el schema:', err.message);
  })
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Panel de herramientas escuchando en puerto ${PORT}`);
    });
  });
