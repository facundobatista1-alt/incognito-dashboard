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
