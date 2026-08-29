'use strict';
const crypto = require('crypto');

// Sube imagenes embebidas como data URL (base64) a Supabase Storage y las
// reemplaza por su URL publica. Se usa tanto en el guardado normal
// (server.js, POST /api/app-state) como en el script de migracion de fotos
// historicas (scripts/offload-images.js), para no duplicar la logica.
//
// Si algo falla al subir una imagen puntual, se devuelve el valor original
// (el data URL) sin tocar: nunca se pierde una foto por un error de red o de
// configuracion, simplemente queda para reintentar en el proximo guardado.
function createMediaOffloader({ supabaseUrl, serviceRoleKey, bucket }) {
  const SUPABASE_URL = String(supabaseUrl || '').replace(/\/$/, '');
  const BUCKET = bucket || 'ventas-fotos';
  const enabled = Boolean(SUPABASE_URL && serviceRoleKey);
  let bucketReady = false;

  async function ensureBucket() {
    if (bucketReady || !enabled) return;
    try {
      await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true })
      });
      // Si el bucket ya existe, Supabase devuelve 400/409 - no es un error real.
    } catch (err) {
      console.error('[media] no se pudo asegurar el bucket de fotos:', err.message);
    } finally {
      bucketReady = true;
    }
  }

  function parseDataUrl(dataUrl) {
    const match = /^data:([^;,]+)(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl || '');
    if (!match) return null;
    const mime = match[1] || 'application/octet-stream';
    const isBase64 = Boolean(match[2]);
    const payload = match[3] || '';
    const buffer = isBase64
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');
    const ext = (mime.split('/')[1] || 'bin').split('+')[0];
    return { mime, buffer, ext };
  }

  async function uploadImageToStorage(dataUrl) {
    if (!enabled) return null;
    const parsed = parseDataUrl(dataUrl);
    if (!parsed || !parsed.buffer.length) return null;

    await ensureBucket();

    const filename = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${parsed.ext}`;
    try {
      const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${filename}`, {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': parsed.mime
        },
        body: parsed.buffer
      });
      if (!response.ok) {
        console.error('[media] error subiendo imagen:', response.status, await response.text().catch(() => ''));
        return null;
      }
      return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${filename}`;
    } catch (err) {
      console.error('[media] error subiendo imagen:', err.message);
      return null;
    }
  }

  function isInlineImage(value) {
    return typeof value === 'string' && value.length > 200 && value.startsWith('data:image/');
  }

  async function offloadInlineImages(value) {
    if (!enabled) return value;
    if (isInlineImage(value)) {
      const uploaded = await uploadImageToStorage(value);
      return uploaded || value;
    }
    if (Array.isArray(value)) {
      return Promise.all(value.map((item) => offloadInlineImages(item)));
    }
    if (value && typeof value === 'object') {
      const entries = await Promise.all(
        Object.entries(value).map(async ([key, val]) => [key, await offloadInlineImages(val)])
      );
      return Object.fromEntries(entries);
    }
    return value;
  }

  return { enabled, offloadInlineImages, uploadImageToStorage, parseDataUrl, isInlineImage };
}

module.exports = { createMediaOffloader };
