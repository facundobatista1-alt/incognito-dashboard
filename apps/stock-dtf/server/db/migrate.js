const { ensureSchema, DATABASE_URL } = require('../src/db');

ensureSchema()
  .then(() => {
    console.log('Esquema aplicado en', DATABASE_URL ? 'DATABASE_URL' : (process.env.PGLITE_DATA_DIR || 'PGlite local'));
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
