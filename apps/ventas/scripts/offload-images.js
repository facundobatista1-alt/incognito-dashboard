'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createMediaOffloader } = require('../lib/media.js');

// Migra las fotos que ya quedaron guardadas en base64 adentro del estado de
// Ventas hacia Supabase Storage, para que dejen de viajar enteras en cada
// sincronizacion. No escribe nada en Supabase salvo que se lo llame con
// --apply (por defecto es un dry-run que solo cuenta e informa).
//
// Uso:
//   node scripts/offload-images.js            -> dry-run, no toca nada
//   node scripts/offload-images.js --apply     -> sube las fotos y guarda
//
// Necesita las mismas variables de entorno que server.js: SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, y opcionalmente SUPABASE_STATE_TABLE,
// APP_STATE_ID, SUPABASE_MEDIA_BUCKET.

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_STATE_TABLE = process.env.SUPABASE_STATE_TABLE || 'ventas_app_state';
const SUPABASE_MEDIA_BUCKET = process.env.SUPABASE_MEDIA_BUCKET || 'ventas-fotos';
const APP_STATE_ID = process.env.APP_STATE_ID || 'default';
const APPLY = process.argv.includes('--apply');

async function callSupabase(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: response.ok, status: response.status, data };
}

function byteSize(value) {
  return Buffer.byteLength(JSON.stringify(value) || '');
}

function countInlineImages(value, offloader) {
  let count = 0;
  (function walk(v) {
    if (offloader.isInlineImage(v)) {
      count += 1;
      return;
    }
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') return Object.values(v).forEach(walk);
  })(value);
  return count;
}

async function offloadAndCount(value, offloader) {
  let uploaded = 0;
  let failed = 0;
  async function walk(v) {
    if (offloader.isInlineImage(v)) {
      const url = await offloader.uploadImageToStorage(v);
      if (url) uploaded += 1;
      else failed += 1;
      return url || v;
    }
    if (Array.isArray(v)) return Promise.all(v.map(walk));
    if (v && typeof v === 'object') {
      const entries = await Promise.all(Object.entries(v).map(async ([k, val]) => [k, await walk(val)]));
      return Object.fromEntries(entries);
    }
    return v;
  }
  const result = await walk(value);
  return { result, uploaded, failed };
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno.');
    process.exit(1);
  }

  console.log(APPLY ? '=== Modo APLICAR (va a escribir en Supabase) ===' : '=== Modo DRY-RUN (no escribe nada) ===');

  const query = `${SUPABASE_STATE_TABLE}?id=eq.${encodeURIComponent(APP_STATE_ID)}&select=state,updated_at`;
  const current = await callSupabase(query, { method: 'GET' });
  if (!current.ok) {
    console.error('No se pudo leer el estado actual:', current.status, current.data);
    process.exit(1);
  }
  const row = Array.isArray(current.data) ? current.data[0] : null;
  if (!row || !row.state) {
    console.error('No hay estado guardado para id =', APP_STATE_ID);
    process.exit(1);
  }

  const before = row.state;
  const beforeBytes = byteSize(before);
  console.log('Tamano actual del estado:', (beforeBytes / 1024 / 1024).toFixed(2), 'MB');

  const offloader = createMediaOffloader({
    supabaseUrl: SUPABASE_URL,
    serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    bucket: SUPABASE_MEDIA_BUCKET
  });

  const imageCount = countInlineImages(before, offloader);
  console.log('Imagenes en base64 encontradas:', imageCount);

  if (!APPLY) {
    console.log('Nada mas para hacer en dry-run. Corre de nuevo con --apply para subir las fotos de verdad y actualizar Supabase.');
    return;
  }

  if (imageCount === 0) {
    console.log('No hay nada para migrar.');
    return;
  }

  // Backup local del estado ORIGINAL antes de escribir nada, por las dudas.
  const backupPath = path.join(__dirname, `backup-state-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(row), 'utf8');
  console.log('Backup local del estado original guardado en', backupPath);

  const { result: after, uploaded, failed } = await offloadAndCount(before, offloader);
  const afterBytes = byteSize(after);
  console.log('Imagenes subidas OK:', uploaded, '| fallidas (quedaron en base64, no se perdieron):', failed);
  console.log('Tamano nuevo del estado:', (afterBytes / 1024 / 1024).toFixed(2), 'MB');

  const updatedAt = new Date().toISOString();
  const result = await callSupabase(`${SUPABASE_STATE_TABLE}?on_conflict=id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: APP_STATE_ID, state: after, updated_at: updatedAt })
  });

  if (!result.ok) {
    console.error('No se pudo guardar el estado actualizado en Supabase:', result.status, result.data);
    console.log('No se perdio nada: el backup local sigue en', backupPath, 'y Supabase no se toco.');
    process.exit(1);
  }

  console.log('Listo. Estado actualizado en Supabase.');
  console.log('Backup de seguridad del estado ANTERIOR (por si hay que revertir):', backupPath);
}

main().catch((err) => {
  console.error('Error inesperado:', err);
  process.exit(1);
});
