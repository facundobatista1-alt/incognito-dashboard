'use strict';
// Aviso diario por WhatsApp con el resumen del reporte. Solo avisa: nunca
// aplica cambios. Usa la plantilla aprobada en Meta
// (sincronizador_stock_diario_x2jkll) y las mismas credenciales WHATSAPP_*
// que ya usan Tareas y Ventas en este proceso. El telefono se lee de la
// persona en Tareas (tareas.people), no se guarda aca.

const TEMPLATE_NAME = () => process.env.SINCRONIZADOR_WHATSAPP_TEMPLATE || 'sincronizador_stock_diario_x2jkll';
const TEMPLATE_LANGUAGE = () => process.env.SINCRONIZADOR_WHATSAPP_LANGUAGE || process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'es';
const GRAPH_VERSION = () => process.env.WHATSAPP_GRAPH_VERSION || 'v25.0';
// "Facundo" en Tareas.
const PERSON_ID = () => process.env.SINCRONIZADOR_AVISO_PERSON_ID || '267e9ae5-ae67-43a0-bed7-913c8bab35fd';
const GREETING_NAME = () => process.env.SINCRONIZADOR_AVISO_NOMBRE || 'Facu';

function isChange(line) {
  return line.action === 'bajar' || line.action === 'subir';
}

// "5 (Campera Nk Tech, Conjunto Adidas SST y 3 más)" o "ninguno". Meta no
// acepta saltos de linea ni mas de 4 espacios seguidos en un parametro.
function describe(lines, max = 3) {
  if (!lines.length) return 'ninguno';
  const names = [...new Set(lines.map((line) => String(line.productName || line.sku || '').trim()).filter(Boolean))];
  const shown = names.slice(0, max).join(', ');
  const rest = names.length > max ? ` y ${names.length - max} más` : '';
  return `${lines.length} (${shown}${rest})`.replace(/\s+/g, ' ').slice(0, 300);
}

function buildSummary(result) {
  const bajar = result.lines.filter((line) => line.action === 'bajar');
  const subir = result.lines.filter((line) => line.action === 'subir');
  const alertas = result.lines.filter((line) => line.alert);
  const pendingAlerts = result.alerts || [];
  const alertCount = alertas.length + pendingAlerts.length;
  return {
    counts: { bajar: bajar.length, subir: subir.length, alertas: alertCount },
    hasSomething: bajar.length + subir.length + alertCount > 0,
    params: [
      GREETING_NAME(),
      describe(bajar),
      describe(subir),
      alertas.length
        ? describe(alertas)
        : (pendingAlerts.length ? `${pendingAlerts.length} (pedidos sin prenda en Stock)` : 'ninguna')
    ],
    changes: result.lines.filter(isChange).length
  };
}

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

async function loadRecipientPhone() {
  const url = `${(process.env.VENTAS_SUPABASE_URL || '').replace(/\/$/, '')}/rest/v1/people?id=eq.${encodeURIComponent(PERSON_ID())}&select=name,phone,active`;
  const key = process.env.VENTAS_SUPABASE_SERVICE_ROLE_KEY || '';
  const response = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}`, 'Accept-Profile': 'tareas' } });
  const rows = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`No pude leer el destinatario en Tareas (HTTP ${response.status}).`);
  const person = Array.isArray(rows) ? rows[0] : null;
  const phone = normalizeWhatsappPhone(person?.phone);
  if (!phone) throw new Error('La persona de Tareas no tiene teléfono cargado.');
  return phone;
}

// Plantilla del aviso de las 16:45 ("en 15 minutos se aplican estos cambios").
const AUTO_TEMPLATE_NAME = () => process.env.SINCRONIZADOR_WHATSAPP_TEMPLATE_AUTO || 'sincronizador_aplicacion_automatica';

async function sendAutoNotice(to, params) {
  return sendTemplate(to, params, AUTO_TEMPLATE_NAME());
}

async function sendTemplate(to, params, templateName = TEMPLATE_NAME()) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  const token = process.env.WHATSAPP_ACCESS_TOKEN || '';
  if (!phoneNumberId || !token) throw new Error('Falta configurar WhatsApp Cloud API.');
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION()}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: TEMPLATE_LANGUAGE() },
        components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: String(text) })) }]
      }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = data?.error || {};
    throw new Error([err.error_user_msg, err.message, err.code ? `codigo ${err.code}` : ''].filter(Boolean).join(' - ') || `Meta respondio HTTP ${response.status}`);
  }
  return data;
}

// Fecha de hoy en Argentina (el cron corre en UTC).
function todayAR() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
}

// deps: { recompute, alreadySentToday, logAviso, loadPhone, send }
async function runDailyNotice({ force = false, origin = 'cron' } = {}, deps) {
  const fecha = todayAR();
  if (!force && await deps.alreadySentToday(fecha)) {
    return { status: 'ya_enviado', fecha };
  }
  const summary = buildSummary(await deps.recompute());
  if (!summary.hasSomething && !force) {
    await deps.logAviso({ fecha, estado: 'sin_cambios', origen: origin, resumen: summary.counts });
    return { status: 'sin_cambios', fecha, counts: summary.counts };
  }
  try {
    const phone = await deps.loadPhone();
    await deps.send(phone, summary.params);
    await deps.logAviso({ fecha, estado: 'enviado', origen: origin, resumen: summary.counts });
    return { status: 'enviado', fecha, counts: summary.counts };
  } catch (err) {
    await deps.logAviso({ fecha, estado: 'error', origen: origin, resumen: summary.counts, detalle: err.message });
    throw err;
  }
}

module.exports = { buildSummary, describe, runDailyNotice, loadRecipientPhone, sendTemplate, sendAutoNotice, todayAR, normalizeWhatsappPhone, GREETING_NAME };
