const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const DEFAULT_SUPABASE_URL = 'https://hspvuakueakgeffiyjzm.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzcHZ1YWt1ZWFrZ2VmZml5anptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0NjI2ODgsImV4cCI6MjA5NDAzODY4OH0.74_AUatbpgaufvciYdMG-gyLlaJ0R4u1orH6rKY6xuo';

let lastSharePointAutoBackupDate = null;
let lastSharePointAutoBackupResult = null;
let sharePointAutoBackupRunning = false;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta configurar ${name}`);
  return value;
}

function buenosAiresDateHour() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false
  }).formatToParts(new Date()).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour)
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchAllSupabase(table, orderColumn) {
  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
  const rows = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const url = new URL(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/${table}`);
    url.searchParams.set('select', '*');
    if (orderColumn) url.searchParams.set('order', `${orderColumn}.asc`);

    const res = await fetch(url, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Range: `${from}-${to}`
      }
    });
    if (!res.ok) throw new Error(`Supabase ${table}: ${res.status} ${await res.text()}`);
    const chunk = await res.json();
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }

  return rows;
}

async function getStoredAppState() {
  const [transactions, transfers] = await Promise.all([
    fetchAllSupabase('transactions', 'fecha'),
    fetchAllSupabase('transfers', 'fecha')
  ]);

  return {
    app: 'incognito-contable',
    generatedAt: new Date().toISOString(),
    transactions,
    transfers,
    counts: {
      transactions: transactions.length,
      transfers: transfers.length
    }
  };
}

function formatNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString('es-AR', { maximumFractionDigits: 2 }) : '';
}

function buildBackupExcelBuffer(state) {
  const txRows = (state.transactions || []).map(t => `
    <tr>
      <td>${escapeHtml(t.fecha)}</td>
      <td>${escapeHtml(t.descripcion)}</td>
      <td>${escapeHtml(t.nro_interno || t.nroInterno || '')}</td>
      <td>${escapeHtml(t.categoria)}</td>
      <td>${escapeHtml(t.cuenta)}</td>
      <td>${formatNumber(t.ingreso)}</td>
      <td>${formatNumber(t.egreso)}</td>
      <td>${escapeHtml(t.pendiente ? 'Pendiente' : 'Completo')}</td>
    </tr>`).join('');

  const trRows = (state.transfers || []).map(t => `
    <tr>
      <td>${escapeHtml(t.fecha)}</td>
      <td>${escapeHtml(t.origen)}</td>
      <td>${escapeHtml(t.destino)}</td>
      <td>${formatNumber(t.monto)}</td>
      <td>${escapeHtml(t.descripcion)}</td>
    </tr>`).join('');

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; }
    h1, h2 { color: #1f2937; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 24px; }
    th { background: #6d3fd1; color: white; font-weight: 700; }
    th, td { border: 1px solid #d1d5db; padding: 6px 8px; }
    td:nth-child(6), td:nth-child(7), .num { text-align: right; }
  </style>
</head>
<body>
  <h1>Backup contable Incognito</h1>
  <p>Generado: ${escapeHtml(state.generatedAt)}</p>

  <h2>Transacciones (${state.counts.transactions})</h2>
  <table>
    <thead>
      <tr><th>Fecha</th><th>Descripción</th><th>N° interno</th><th>Categoría</th><th>Cuenta</th><th>Ingreso</th><th>Egreso</th><th>Estado</th></tr>
    </thead>
    <tbody>${txRows}</tbody>
  </table>

  <h2>Transferencias (${state.counts.transfers})</h2>
  <table>
    <thead>
      <tr><th>Fecha</th><th>Origen</th><th>Destino</th><th>Monto</th><th>Descripción</th></tr>
    </thead>
    <tbody>${trRows}</tbody>
  </table>
</body>
</html>`;

  return Buffer.from(html, 'utf8');
}

function buildFullAppBackupBuffer(state) {
  return Buffer.from(JSON.stringify(state, null, 2), 'utf8');
}

async function getMicrosoftGraphToken() {
  const tenantId = requiredEnv('MICROSOFT_TENANT_ID');
  const clientId = requiredEnv('MICROSOFT_CLIENT_ID');
  const clientSecret = requiredEnv('MICROSOFT_CLIENT_SECRET');
  const params = new URLSearchParams();
  params.set('client_id', clientId);
  params.set('client_secret', clientSecret);
  params.set('scope', 'https://graph.microsoft.com/.default');
  params.set('grant_type', 'client_credentials');

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  if (!res.ok) throw new Error(`Microsoft token: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

function defaultFullBackupPath(excelPath) {
  const normalized = String(excelPath || '').replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  const folder = slash >= 0 ? normalized.slice(0, slash + 1) : '';
  return `${folder}backup-completo-incognito-contable.json`;
}

async function uploadSharePointFile(filePath, buffer, contentType) {
  const driveId = requiredEnv('SHAREPOINT_DRIVE_ID');
  const token = await getMicrosoftGraphToken();
  const cleanPath = String(filePath || '').replace(/^\/+/, '');
  const url = `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/root:/${cleanPath}:/content`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType
    },
    body: buffer
  });
  if (!res.ok) throw new Error(`SharePoint upload ${cleanPath}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function updateSharePointBackupHistory() {
  const excelPath = requiredEnv('SHAREPOINT_BACKUP_PATH');
  const fullPath = process.env.SHAREPOINT_FULL_BACKUP_PATH || defaultFullBackupPath(excelPath);
  const state = await getStoredAppState();
  const excelBuffer = buildBackupExcelBuffer(state);
  const jsonBuffer = buildFullAppBackupBuffer(state);

  const excelUpload = await uploadSharePointFile(
    excelPath,
    excelBuffer,
    'application/vnd.ms-excel; charset=utf-8'
  );
  const fullUpload = await uploadSharePointFile(
    fullPath,
    jsonBuffer,
    'application/json; charset=utf-8'
  );

  return {
    success: true,
    rows: state.counts.transactions,
    transfers: state.counts.transfers,
    filename: path.posix.basename(excelPath),
    webUrl: excelUpload.webUrl,
    fullBackupFilename: path.posix.basename(fullPath),
    fullBackupWebUrl: fullUpload.webUrl,
    generatedAt: state.generatedAt
  };
}

async function runSharePointAutoBackupIfDue() {
  if (process.env.SHAREPOINT_AUTO_BACKUP !== 'true') return null;
  if (sharePointAutoBackupRunning) return null;

  const { date, hour } = buenosAiresDateHour();
  if (hour < Number(process.env.SHAREPOINT_AUTO_BACKUP_HOUR || 23)) return null;
  if (lastSharePointAutoBackupDate === date) return null;

  sharePointAutoBackupRunning = true;
  try {
    const result = await updateSharePointBackupHistory();
    lastSharePointAutoBackupDate = date;
    lastSharePointAutoBackupResult = result;
    console.log(`[sharepoint-backup] OK ${date}`, result);
    return result;
  } catch (error) {
    lastSharePointAutoBackupResult = { success: false, date, error: error.message, generatedAt: new Date().toISOString() };
    console.error('[sharepoint-backup] ERROR', error);
    return lastSharePointAutoBackupResult;
  } finally {
    sharePointAutoBackupRunning = false;
  }
}

app.post('/api/sharepoint/backup-history', async (req, res) => {
  try {
    const result = await updateSharePointBackupHistory();
    res.json(result);
  } catch (error) {
    console.error('[sharepoint-backup-manual] ERROR', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/sharepoint/backup-status', (req, res) => {
  res.json({
    enabled: process.env.SHAREPOINT_AUTO_BACKUP === 'true',
    lastSharePointAutoBackupDate,
    lastSharePointAutoBackupResult
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function start() {
  app.listen(PORT, () => {
    console.log(`Incognito Contable escuchando en puerto ${PORT}`);
    setTimeout(runSharePointAutoBackupIfDue, 30000);
    setInterval(runSharePointAutoBackupIfDue, 60 * 60 * 1000);
  });
}

if (require.main === module) {
  start();
}

module.exports = app;
