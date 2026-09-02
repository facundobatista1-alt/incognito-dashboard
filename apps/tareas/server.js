'use strict';

// Force IPv4 DNS resolution — Render free tier has no IPv6 routing
require('dns').setDefaultResultOrder('ipv4first');

require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8123;
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_SCHEMA = process.env.SUPABASE_TASKS_SCHEMA || process.env.SUPABASE_SCHEMA || 'tareas';
const NOTIFICATION_CRON_SECRET = process.env.NOTIFICATION_CRON_SECRET || '';

// Mismas credenciales que ya usa Ventas (proceso compartido en el panel
// unificado, variables sin prefijo en render.yaml).
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || '';
const WHATSAPP_GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v25.0';
const WHATSAPP_TEMPLATE_LANGUAGE = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'es';
const WHATSAPP_TEMPLATE_TASK_ASSIGNED_NAME = process.env.WHATSAPP_TEMPLATE_TASK_ASSIGNED_NAME || '';
const WHATSAPP_TEMPLATE_TASK_DAILY_SUMMARY_NAME = process.env.WHATSAPP_TEMPLATE_TASK_DAILY_SUMMARY_NAME || '';

const STATUSES = new Set(['pending', 'progress', 'blocked', 'done']);
const PRIORITIES = new Set(['high', 'medium', 'low']);
const FREQUENCIES = new Set(['daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'custom']);
const AREAS = new Set(['Compras', 'Contabilidad y Finanzas', 'General', 'Marketing', 'Operaciones', 'Ventas']);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

function parseCookies(header = '') {
  return header.split(';').reduce((cookies, part) => {
    const [key, ...valueParts] = part.trim().split('=');
    if (!key) return cookies;
    cookies[key] = decodeURIComponent(valueParts.join('=') || '');
    return cookies;
  }, {});
}

function sessionSignature() {
  const secret = process.env.APP_SESSION_SECRET || process.env.TAREAS_APP_PASSWORD || 'local-dev';
  return crypto.createHmac('sha256', secret).update(process.env.TAREAS_APP_PASSWORD || '').digest('hex');
}

function isAuthenticated(req) {
  if (!process.env.TAREAS_APP_PASSWORD) return true;
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies.tareas_session === sessionSignature();
}

function isAutomationAuthenticated(req) {
  if (!NOTIFICATION_CRON_SECRET || !req.path.startsWith('/api/notifications/')) return false;
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return bearer === NOTIFICATION_CRON_SECRET || req.headers['x-notification-secret'] === NOTIFICATION_CRON_SECRET;
}

function loginPage(error = '') {
  return `<!doctype html>
  <html lang="es">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Ingresar - Tareas</title>
      <style>
        * { box-sizing: border-box; }
        body {
          min-height: 100vh;
          margin: 0;
          display: grid;
          place-items: center;
          background: #f9fafb;
          color: #111827;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        form {
          width: min(92vw, 380px);
          background: #fff;
          border-radius: 10px;
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.10);
          padding: 24px;
        }
        h1 { font-size: 1.2rem; margin: 0 0 6px; }
        p { color: #6b7280; font-size: 0.9rem; margin: 0 0 18px; }
        label { display: grid; gap: 7px; font-weight: 600; }
        input {
          border: 1px solid #d1d5db;
          border-radius: 8px;
          font: inherit;
          min-height: 42px;
          padding: 8px 12px;
        }
        button {
          width: 100%;
          min-height: 42px;
          margin-top: 14px;
          border: 1px solid #6c3fc5;
          border-radius: 8px;
          background: #6c3fc5;
          color: #fff;
          cursor: pointer;
          font: inherit;
          font-weight: 700;
        }
        .error {
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 8px;
          color: #b91c1c;
          margin-bottom: 12px;
          padding: 9px 10px;
        }
      </style>
    </head>
    <body>
      <form method="post" action="login">
        <h1>Tareas del equipo</h1>
        <p>Ingresa la contrasena para continuar.</p>
        ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
        <label>
          Contrasena
          <input name="password" type="password" autocomplete="current-password" autofocus required>
        </label>
        <button type="submit">Ingresar</button>
      </form>
    </body>
  </html>`;
}

app.get('/login', (req, res) => {
  if (isAuthenticated(req)) return res.redirect((req.baseUrl || '') + '/');
  res.send(loginPage());
});

app.post('/login', (req, res) => {
  if (!process.env.TAREAS_APP_PASSWORD) return res.redirect((req.baseUrl || '') + '/');
  if (String(req.body.password || '') !== process.env.TAREAS_APP_PASSWORD) {
    return res.status(401).send(loginPage('Contrasena incorrecta.'));
  }
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader(
    'Set-Cookie',
    `tareas_session=${sessionSignature()}; HttpOnly; SameSite=Lax; Path=${req.baseUrl || '/'}; Max-Age=2592000${secure ? '; Secure' : ''}`
  );
  res.redirect((req.baseUrl || '') + '/');
});

app.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', `tareas_session=; HttpOnly; SameSite=Lax; Path=${req.baseUrl || '/'}; Max-Age=0`);
  res.redirect((req.baseUrl || '') + '/login');
});

app.use((req, res, next) => {
  if (isAuthenticated(req) || isAutomationAuthenticated(req)) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ success: false, error: 'No autenticado.' });
  }
  return res.redirect((req.baseUrl || '') + '/login');
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (/\.(html|js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    supabase: supabaseEnabled(),
    schema: SUPABASE_SCHEMA,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/bootstrap', asyncHandler(async (_req, res) => {
  await generateDueRecurringTasks();
  const [people, tasks, recurring] = await Promise.all([
    fetchPeople(),
    fetchTasks(),
    fetchRecurringTasks()
  ]);
  res.json({ people, tasks, recurring });
}));

app.get('/api/people', asyncHandler(async (_req, res) => {
  res.json(await fetchPeople());
}));

app.post('/api/people', asyncHandler(async (req, res) => {
  const payload = sanitizePerson(req.body);
  const [person] = await supabaseJson('people', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { Prefer: 'return=representation' }
  });
  res.status(201).json(mapPerson(person));
}));

app.patch('/api/people/:id', asyncHandler(async (req, res) => {
  const payload = sanitizePerson(req.body, { partial: true });
  const [person] = await supabaseJson(`people?id=eq.${encodeURIComponent(req.params.id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    headers: { Prefer: 'return=representation' }
  });
  res.json(mapPerson(person));
}));

app.delete('/api/people/:id', asyncHandler(async (req, res) => {
  await supabaseJson(`people?id=eq.${encodeURIComponent(req.params.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ active: false }),
    headers: { Prefer: 'return=minimal' }
  });
  res.status(204).end();
}));

app.get('/api/tasks', asyncHandler(async (_req, res) => {
  res.json(await fetchTasks());
}));

app.post('/api/tasks', asyncHandler(async (req, res) => {
  const payload = sanitizeTask(req.body);
  const created = await createTaskRecords(payload);
  await notifyAssignedTasks(created);
  res.status(201).json(created);
}));

app.patch('/api/tasks/:id', asyncHandler(async (req, res) => {
  const payload = sanitizeTask(req.body, { partial: true });
  const [previous] = await supabaseJson(`tasks?id=eq.${encodeURIComponent(req.params.id)}&limit=1`);
  const [task] = await supabaseJson(`tasks?id=eq.${encodeURIComponent(req.params.id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    headers: { Prefer: 'return=representation' }
  });
  if (Object.hasOwn(payload, 'assignee_id') && task?.assignee_id && task.assignee_id !== previous?.assignee_id) {
    await notifyAssignedTasks([mapTask(task)]);
  }
  res.json(mapTask(task));
}));

app.delete('/api/tasks/:id', asyncHandler(async (req, res) => {
  await supabaseJson(`tasks?id=eq.${encodeURIComponent(req.params.id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  });
  res.status(204).end();
}));

app.get('/api/recurring', asyncHandler(async (_req, res) => {
  res.json(await fetchRecurringTasks());
}));

app.post('/api/recurring', asyncHandler(async (req, res) => {
  const payload = sanitizeRecurringTask(req.body);
  const [item] = await supabaseJson('recurring_tasks', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { Prefer: 'return=representation' }
  });
  res.status(201).json(mapRecurringTask(item));
}));

app.patch('/api/recurring/:id', asyncHandler(async (req, res) => {
  const payload = sanitizeRecurringTask(req.body, { partial: true });
  const [item] = await supabaseJson(`recurring_tasks?id=eq.${encodeURIComponent(req.params.id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    headers: { Prefer: 'return=representation' }
  });
  res.json(mapRecurringTask(item));
}));

app.delete('/api/recurring/:id', asyncHandler(async (req, res) => {
  await supabaseJson(`recurring_tasks?id=eq.${encodeURIComponent(req.params.id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  });
  res.status(204).end();
}));

app.post('/api/recurring/:id/generate', asyncHandler(async (req, res) => {
  const [item] = await supabaseJson(`recurring_tasks?id=eq.${encodeURIComponent(req.params.id)}&limit=1`);
  if (!item) return res.status(404).json({ success: false, error: 'Repetitiva no encontrada.' });
  const dueDate = req.body?.dueDate || todayISO();
  const created = await createTasksFromRecurring(item, dueDate);
  res.status(201).json(created);
}));

app.get('/api/notifications/preview', asyncHandler(async (req, res) => {
  res.json(await buildDailySummaries({ personId: req.query.personId || '' }));
}));

app.post('/api/notifications/daily-summary', asyncHandler(async (req, res) => {
  const result = await sendDailySummaries({
    force: req.body?.force === true,
    personId: req.body?.personId || ''
  });
  res.json(result);
}));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.statusCode || 500).json({
    success: false,
    error: err.message || 'Error interno.'
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Tareas escuchando en http://localhost:${PORT}`);
  });
}

module.exports = app;

function supabaseEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

async function supabaseRaw(pathname, options = {}) {
  if (!supabaseEnabled()) {
    const error = new Error('Supabase no esta configurado.');
    error.statusCode = 503;
    throw error;
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Profile': SUPABASE_SCHEMA,
      'Content-Profile': SUPABASE_SCHEMA,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const error = new Error(data?.message || data?.hint || `Supabase HTTP ${response.status}`);
    error.statusCode = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

async function supabaseJson(pathname, options = {}) {
  return supabaseRaw(pathname, options);
}

async function fetchPeople() {
  const rows = await supabaseJson('people?active=eq.true&order=name.asc');
  return rows.map(mapPerson);
}

async function fetchTasks() {
  const rows = await supabaseJson('tasks?order=created_at.desc');
  return rows.map(mapTask);
}

async function fetchRecurringTasks() {
  const rows = await supabaseJson('recurring_tasks?order=next_date.asc');
  return rows.map(mapRecurringTask);
}

function mapPerson(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email || '',
    phone: row.phone || ''
  };
}

function mapTask(row) {
  return {
    id: row.id,
    recurringId: row.recurring_task_id || '',
    title: row.title,
    assignee: row.assignee_id || '',
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date || '',
    area: row.area,
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRecurringTask(row) {
  return {
    id: row.id,
    title: row.title,
    assignee: row.assign_to_team ? '__team__' : (row.assignee_id || ''),
    frequency: row.frequency,
    weekday: row.weekday == null ? '1' : String(row.weekday),
    weekdays: normalizeWeekdays(row.weekdays, row.weekday),
    nextDate: row.next_date,
    priority: row.priority,
    area: row.area,
    notes: row.notes || '',
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function sanitizePerson(input, options = {}) {
  const payload = {};
  if (!options.partial || Object.hasOwn(input, 'name')) {
    const name = String(input.name || '').trim();
    if (!name) throw badRequest('El nombre es obligatorio.');
    payload.name = name;
  }
  if (!options.partial || Object.hasOwn(input, 'email')) {
    const email = String(input.email || '').trim();
    payload.email = email || null;
  }
  if (!options.partial || Object.hasOwn(input, 'phone')) {
    const phone = String(input.phone || '').trim();
    payload.phone = phone || null;
  }
  return payload;
}

function sanitizeTask(input, options = {}) {
  const payload = {};
  if (!options.partial || Object.hasOwn(input, 'title')) {
    const title = String(input.title || '').trim();
    if (!title) throw badRequest('El titulo es obligatorio.');
    payload.title = title;
  }
  if (!options.partial || Object.hasOwn(input, 'assignee')) {
    payload.assignee_id = isTeamAssignee(input.assignee) ? '__team__' : (input.assignee || null);
  }
  if (!options.partial || Object.hasOwn(input, 'status')) {
    payload.status = validOrDefault(input.status, STATUSES, 'pending');
    payload.completed_at = payload.status === 'done' ? new Date().toISOString() : null;
  }
  if (!options.partial || Object.hasOwn(input, 'priority')) {
    payload.priority = validOrDefault(input.priority, PRIORITIES, 'medium');
  }
  if (!options.partial || Object.hasOwn(input, 'dueDate')) {
    payload.due_date = input.dueDate || null;
  }
  if (!options.partial || Object.hasOwn(input, 'area')) {
    payload.area = validOrDefault(input.area, AREAS, 'General');
  }
  if (!options.partial || Object.hasOwn(input, 'notes')) {
    payload.notes = String(input.notes || '').trim() || null;
  }
  return payload;
}

function sanitizeRecurringTask(input, options = {}) {
  const payload = {};
  if (!options.partial || Object.hasOwn(input, 'title')) {
    const title = String(input.title || '').trim();
    if (!title) throw badRequest('El titulo es obligatorio.');
    payload.title = title;
  }
  if (!options.partial || Object.hasOwn(input, 'assignee')) {
    payload.assign_to_team = isTeamAssignee(input.assignee);
    payload.assignee_id = payload.assign_to_team ? null : (input.assignee || null);
  }
  if (!options.partial || Object.hasOwn(input, 'frequency')) {
    payload.frequency = validOrDefault(input.frequency, FREQUENCIES, 'weekly');
  }
  if (!options.partial || Object.hasOwn(input, 'weekday') || Object.hasOwn(input, 'weekdays') || Object.hasOwn(input, 'frequency')) {
    const frequency = payload.frequency || input.frequency;
    const selectedWeekdays = normalizeWeekdays(input.weekdays, input.weekday);
    payload.weekday = ['weekly', 'biweekly', 'custom'].includes(frequency) ? Number(selectedWeekdays[0]) : null;
    if (frequency === 'custom') payload.weekdays = selectedWeekdays.map(Number);
  }
  if (!options.partial || Object.hasOwn(input, 'nextDate')) {
    if (!input.nextDate) throw badRequest('La proxima fecha es obligatoria.');
    payload.next_date = input.nextDate;
  }
  if (!options.partial || Object.hasOwn(input, 'priority')) {
    payload.priority = validOrDefault(input.priority, PRIORITIES, 'medium');
  }
  if (!options.partial || Object.hasOwn(input, 'area')) {
    payload.area = validOrDefault(input.area, AREAS, 'General');
  }
  if (!options.partial || Object.hasOwn(input, 'notes')) {
    payload.notes = String(input.notes || '').trim() || null;
  }
  if (Object.hasOwn(input, 'active')) {
    payload.active = input.active !== false;
  }
  return payload;
}

async function createTaskRecords(payload) {
  const assignees = payload.assignee_id === '__team__' ? await fetchTeamAssigneeIds() : [payload.assignee_id || null];
  if (!assignees.length) throw badRequest('No hay responsables activos para asignar al equipo.');
  const records = assignees.map((assigneeId) => ({
    title: payload.title,
    assignee_id: assigneeId,
    status: payload.status || 'pending',
    priority: payload.priority || 'medium',
    due_date: payload.due_date || null,
    area: payload.area || 'General',
    notes: payload.notes || null,
    completed_at: payload.status === 'done' ? new Date().toISOString() : null
  }));
  const rows = await supabaseJson('tasks', {
    method: 'POST',
    body: JSON.stringify(records),
    headers: { Prefer: 'return=representation' }
  });
  return rows.map(mapTask);
}

async function fetchTeamAssigneeIds() {
  const people = await supabaseJson('people?active=eq.true&select=id');
  return people.map((person) => person.id);
}

async function fetchPersonById(personId) {
  if (!personId) return null;
  const [person] = await supabaseJson(`people?id=eq.${encodeURIComponent(personId)}&active=eq.true&limit=1`);
  return person ? mapPerson(person) : null;
}

async function notifyAssignedTasks(tasks) {
  for (const task of tasks) {
    if (!task.assignee || task.status === 'done') continue;
    try {
      const person = await fetchPersonById(task.assignee);
      await sendTaskAssignedNotification({ person, task });
    } catch (error) {
      console.error('No se pudo mandar aviso de asignacion', error);
    }
  }
}

async function buildDailySummaries({ personId = '' } = {}) {
  const today = todayISO();
  const [peopleRows, taskRows] = await Promise.all([
    supabaseJson(`people?active=eq.true${personId ? `&id=eq.${encodeURIComponent(personId)}` : ''}&order=name.asc`),
    supabaseJson(`tasks?status=neq.done&due_date=lte.${today}&assignee_id=not.is.null&order=due_date.asc`)
  ]);
  const peopleById = new Map(peopleRows.map((person) => [person.id, mapPerson(person)]));
  const summaries = new Map();

  for (const row of taskRows) {
    const person = peopleById.get(row.assignee_id);
    if (!person) continue;
    if (!summaries.has(person.id)) {
      summaries.set(person.id, {
        person,
        date: today,
        dueToday: [],
        overdue: [],
        total: 0
      });
    }
    const summary = summaries.get(person.id);
    const task = mapTask(row);
    if (task.dueDate < today) summary.overdue.push(task);
    else summary.dueToday.push(task);
    summary.total += 1;
  }

  return Array.from(summaries.values());
}

async function sendDailySummaries({ force = false, personId = '' } = {}) {
  const summaries = await buildDailySummaries({ personId });
  const results = [];

  for (const summary of summaries) {
    if (!summary.person.phone) {
      await logNotification({
        personId: summary.person.id,
        status: 'skipped',
        errorMessage: 'Responsable sin telefono.',
        metadata: summaryMetadata(summary)
      });
      results.push({ person: summary.person.name, status: 'skipped', reason: 'sin telefono' });
      continue;
    }

    const alreadySent = !force && await hasDailySummaryBeenSent(summary.person.id, summary.date);
    if (alreadySent) {
      results.push({ person: summary.person.name, status: 'skipped', reason: 'ya enviado hoy' });
      continue;
    }

    try {
      await sendWhatsappTemplate({
        to: summary.person.phone,
        templateName: WHATSAPP_TEMPLATE_TASK_DAILY_SUMMARY_NAME,
        params: [summary.person.name, formatTaskNamesForWhatsapp(summary)]
      });
      await logNotification({
        personId: summary.person.id,
        status: 'sent',
        sentTo: summary.person.phone,
        metadata: summaryMetadata(summary)
      });
      results.push({ person: summary.person.name, status: 'sent', phone: summary.person.phone, tasks: summary.total });
    } catch (error) {
      await logNotification({
        personId: summary.person.id,
        status: 'failed',
        sentTo: summary.person.phone,
        errorMessage: error.message,
        metadata: summaryMetadata(summary)
      });
      results.push({ person: summary.person.name, status: 'failed', error: error.message });
    }
  }

  return {
    date: todayISO(),
    summaries: summaries.length,
    results
  };
}

async function hasDailySummaryBeenSent(personId, date) {
  const rows = await supabaseJson(
    `notification_log?person_id=eq.${encodeURIComponent(personId)}&notification_type=eq.daily_summary&status=eq.sent&sent_at=gte.${date}T00:00:00&sent_at=lt.${advanceDate(date, 'daily')}T00:00:00&limit=1`
  );
  return rows.length > 0;
}

async function logNotification({ personId, taskId = null, notificationType = 'daily_summary', status, sentTo = '', errorMessage = '', metadata = {} }) {
  await supabaseJson('notification_log', {
    method: 'POST',
    body: JSON.stringify({
      person_id: personId,
      task_id: taskId,
      notification_type: notificationType,
      channel: 'whatsapp',
      sent_to: sentTo || null,
      status,
      error_message: errorMessage || null,
      metadata
    }),
    headers: { Prefer: 'return=minimal' }
  });
}

async function sendTaskAssignedNotification({ person, task }) {
  if (!person?.phone) {
    await logNotification({
      personId: person?.id || task.assignee || null,
      taskId: task.id,
      notificationType: 'assigned',
      status: 'skipped',
      errorMessage: 'Responsable sin telefono.',
      metadata: { taskId: task.id }
    });
    return;
  }

  try {
    await sendWhatsappTemplate({
      to: person.phone,
      templateName: WHATSAPP_TEMPLATE_TASK_ASSIGNED_NAME,
      params: [person.name, task.title, task.dueDate || 'sin fecha']
    });
    await logNotification({
      personId: person.id,
      taskId: task.id,
      notificationType: 'assigned',
      status: 'sent',
      sentTo: person.phone,
      metadata: { taskId: task.id }
    });
  } catch (error) {
    await logNotification({
      personId: person.id,
      taskId: task.id,
      notificationType: 'assigned',
      status: 'failed',
      sentTo: person.phone,
      errorMessage: error.message,
      metadata: { taskId: task.id }
    });
    throw error;
  }
}

function whatsappApiEnabled() {
  return Boolean(WHATSAPP_PHONE_NUMBER_ID && WHATSAPP_ACCESS_TOKEN);
}

// Mismo algoritmo que apps/ventas/server.js: numero local AR (con o sin 0/15)
// -> formato E.164-ish que espera la Cloud API (549 + codigo de area + numero).
function normalizeWhatsappPhone(phone = '') {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('549')) return digits;
  if (digits.startsWith('54')) return `549${digits.slice(2).replace(/^0/, '').replace(/^(\d{2,4})15/, '$1')}`;
  const withoutTrunk = digits.replace(/^0/, '');
  const withoutMobilePrefix = withoutTrunk.replace(/^(\d{2,4})15/, '$1');
  if (withoutMobilePrefix.length >= 8 && withoutMobilePrefix.length <= 11) return `549${withoutMobilePrefix}`;
  return digits;
}

async function sendWhatsappTemplate({ to, templateName, params = [] }) {
  if (!whatsappApiEnabled()) {
    const error = new Error('Falta configurar WhatsApp Cloud API.');
    error.statusCode = 503;
    throw error;
  }
  if (!templateName) {
    const error = new Error('Falta configurar la plantilla de WhatsApp.');
    error.statusCode = 503;
    throw error;
  }
  const to549 = normalizeWhatsappPhone(to);
  if (!to549) {
    const error = new Error('Falta el telefono del destinatario.');
    error.statusCode = 400;
    throw error;
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: to549,
    type: 'template',
    template: {
      name: templateName,
      language: { code: WHATSAPP_TEMPLATE_LANGUAGE },
      components: [{
        type: 'body',
        parameters: params.map((text) => ({ type: 'text', text: String(text) }))
      }]
    }
  };

  const response = await fetch(`https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${encodeURIComponent(WHATSAPP_PHONE_NUMBER_ID)}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const metaError = data?.error || {};
    const detailParts = [
      metaError.error_user_msg,
      metaError.message,
      metaError.code ? `codigo ${metaError.code}` : '',
      metaError.error_subcode ? `subcodigo ${metaError.error_subcode}` : ''
    ].filter(Boolean);
    const detail = detailParts.join(' - ') || data?.message || `Meta respondio HTTP ${response.status}`;
    const error = new Error(detail);
    error.statusCode = response.status;
    error.meta = data;
    throw error;
  }
  return data;
}

function summaryMetadata(summary) {
  return {
    date: summary.date,
    overdue: summary.overdue.map((task) => task.id),
    dueToday: summary.dueToday.map((task) => task.id),
    total: summary.total
  };
}

// Los parametros de plantilla de WhatsApp no admiten saltos de linea/tabs,
// asi que la lista de tareas va en una sola linea separada por comas.
function joinTaskTitles(tasks, max = 8) {
  const titles = tasks.map((task) => task.title);
  if (titles.length > max) {
    return `${titles.slice(0, max).join(', ')} y ${titles.length - max} mas`;
  }
  return titles.join(', ');
}

function formatTaskNamesForWhatsapp(summary) {
  const sections = [];
  if (summary.overdue.length) sections.push(`Vencidas: ${joinTaskTitles(summary.overdue)}`);
  if (summary.dueToday.length) sections.push(`Para hoy: ${joinTaskTitles(summary.dueToday)}`);
  return sections.join(' — ');
}

async function generateDueRecurringTasks() {
  const today = todayISO();
  const rows = await supabaseJson(`recurring_tasks?active=eq.true&next_date=lte.${today}`);
  for (const item of rows) {
    let guard = 0;
    let current = item.next_date;
    while (current <= today && guard < 30) {
      await createTasksFromRecurring(item, current);
      current = advanceDate(current, item.frequency, item.weekday, item.weekdays);
      guard += 1;
    }
    if (current !== item.next_date) {
      await supabaseJson(`recurring_tasks?id=eq.${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ next_date: current }),
        headers: { Prefer: 'return=minimal' }
      });
    }
  }
}

async function createTasksFromRecurring(item, dueDate) {
  const assignees = item.assign_to_team ? await fetchTeamAssigneeIds() : [item.assignee_id || null];
  const created = [];
  const toNotify = [];
  for (const assigneeId of assignees) {
    const assigneeFilter = assigneeId ? `eq.${assigneeId}` : 'is.null';
    const existing = await supabaseJson(
      `tasks?recurring_task_id=eq.${item.id}&due_date=eq.${dueDate}&assignee_id=${assigneeFilter}&limit=1`
    );
    if (existing.length) continue;
    // Avisar por WhatsApp solo la primera vez que se genera esta repetitiva
    // para este responsable: las regeneraciones automaticas de cada
    // ocurrencia no son una asignacion nueva, son la rutina de siempre.
    const priorOccurrence = await supabaseJson(
      `tasks?recurring_task_id=eq.${item.id}&assignee_id=${assigneeFilter}&limit=1`
    );
    const [task] = await supabaseJson('tasks', {
      method: 'POST',
      body: JSON.stringify({
        recurring_task_id: item.id,
        title: item.title,
        assignee_id: assigneeId,
        status: 'pending',
        priority: item.priority,
        due_date: dueDate,
        area: item.area,
        notes: item.notes
      }),
      headers: { Prefer: 'return=representation' }
    });
    const mappedTask = mapTask(task);
    created.push(mappedTask);
    if (!priorOccurrence.length) toNotify.push(mappedTask);
  }
  if (toNotify.length) await notifyAssignedTasks(toNotify);
  return created;
}

function advanceDate(value, frequency, weekday = 1, weekdays = null) {
  const date = new Date(`${value}T00:00:00`);
  if (frequency === 'daily') date.setDate(date.getDate() + 1);
  else if (frequency === 'weekdays') {
    do {
      date.setDate(date.getDate() + 1);
    } while (date.getDay() === 0 || date.getDay() === 6);
  } else if (frequency === 'weekly' || frequency === 'biweekly') {
    date.setDate(date.getDate() + (frequency === 'biweekly' ? 14 : 7));
    const targetDay = Number(weekday);
    while (date.getDay() !== targetDay) date.setDate(date.getDate() + 1);
  } else if (frequency === 'custom') {
    const targetDays = new Set(normalizeWeekdays(weekdays, weekday).map(Number));
    do {
      date.setDate(date.getDate() + 1);
    } while (!targetDays.has(date.getDay()));
  } else if (frequency === 'monthly') date.setMonth(date.getMonth() + 1);
  else date.setDate(date.getDate() + 7);
  return toISODate(date);
}

function todayISO() {
  return toISODate(new Date());
}

function toISODate(date) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

function validOrDefault(value, validSet, fallback) {
  return validSet.has(value) ? value : fallback;
}

function isTeamAssignee(value) {
  return value === '__team__' || value === 'equipo';
}

function normalizeWeekdays(values, fallback = 1) {
  const source = Array.isArray(values) ? values : String(values ?? '').split(',');
  const normalized = source
    .map((value) => String(value))
    .filter((value) => ['0', '1', '2', '3', '4', '5', '6'].includes(value));
  const unique = [...new Set(normalized)];
  const result = unique.length ? unique : [String(fallback ?? 1)];
  return result.sort((a, b) => (a === '0' ? 7 : Number(a)) - (b === '0' ? 7 : Number(b)));
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}
