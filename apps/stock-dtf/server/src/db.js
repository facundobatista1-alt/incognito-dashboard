'use strict';
/**
 * Capa de acceso a datos -- Postgres/Supabase en produccion.
 *
 * Se conecta con node-postgres (`pg`) a DATABASE_URL (el connection string
 * de Supabase, usando el service_role / conexion directa -- NUNCA la anon
 * key, que queda solo para el frontend si algun dia hiciera falta).
 *
 * Para desarrollo/pruebas SIN credenciales de Supabase a mano, si no hay
 * DATABASE_URL configurada se cae a PGlite (Postgres real compilado a WASM,
 * en memoria o en un archivo local) -- mismo dialecto SQL, mismas
 * transacciones, mismas constraints. Esto es SOLO para desarrollo local:
 * no es una base remota persistente y no sirve para produccion en Render
 * (cada instancia tendria su propio archivo local). Ver docs/SUPABASE.md.
 */
const path = require('path');

const RAW_DATABASE_URL = process.env.DATABASE_URL || '';
const PGLITE_DATA_DIR = process.env.PGLITE_DATA_DIR || path.join(__dirname, '..', 'data', 'pglite');
const SUPABASE_POOLER_REGION = process.env.SUPABASE_POOLER_REGION || 'us-east-2';
const DATABASE_URL = normalizeDatabaseUrl(RAW_DATABASE_URL);

let _impl = null;

function normalizeDatabaseUrl(connectionString) {
  if (!connectionString) return '';
  try {
    const url = new URL(connectionString);
    const match = url.hostname.match(/^db\.([^.]+)\.supabase\.co$/i);
    if (!match) return connectionString;
    const ref = match[1];
    url.username = `postgres.${ref}`;
    url.hostname = `aws-0-${SUPABASE_POOLER_REGION}.pooler.supabase.com`;
    url.port = '5432';
    return url.toString();
  } catch (e) {
    return connectionString;
  }
}

function needsSsl(connectionString) {
  return /supabase\.(co|com)/i.test(connectionString);
}

function makePgAdapter() {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: needsSsl(DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  return {
    kind: 'postgres',
    async query(text, params) {
      return pool.query(text, params);
    },
    async execRaw(sql) {
      return pool.query(sql);
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: (text, params) => client.query(text, params) });
        await client.query('COMMIT');
        return result;
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch (e2) { /* noop */ }
        throw e;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

function makePgliteAdapter() {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite(PGLITE_DATA_DIR);

  return {
    kind: 'pglite',
    async query(text, params) {
      return db.query(text, params);
    },
    async execRaw(sql) {
      return db.exec(sql);
    },
    async transaction(fn) {
      return db.transaction(async (tx) => {
        return fn({ query: (text, params) => tx.query(text, params) });
      });
    },
    async close() {
      await db.close();
    },
  };
}

function getDb() {
  if (_impl) return _impl;
  _impl = DATABASE_URL ? makePgAdapter() : makePgliteAdapter();
  if (!DATABASE_URL) {
    console.warn(
      '[db] ADVERTENCIA: no hay DATABASE_URL configurada. Usando PGlite local ' +
      '(solo para desarrollo, NO es una base remota persistente). ' +
      'Ver docs/SUPABASE.md para configurar Supabase real.'
    );
  }
  return _impl;
}

async function ensureSchema() {
  const fs = require('fs');
  const db = getDb();
  const migrationsDir = path.join(__dirname, '..', '..', 'supabase', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf-8').replace(/^\uFEFF/, '');
    await db.execRaw(sql);
  }
}

module.exports = { getDb, ensureSchema, DATABASE_URL };
