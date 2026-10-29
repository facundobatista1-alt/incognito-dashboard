'use strict';

const { normalizeWhatsappPhone } = require('./kommo-service');

function parsePhoneAllowlist(value = '') {
  return new Set(
    String(value || '')
      .split(',')
      .map((phone) => normalizeWhatsappPhone(phone))
      .filter(Boolean)
  );
}

function isPhoneAllowedForKommoTest(phone, allowlistValue = '') {
  const normalized = normalizeWhatsappPhone(phone);
  if (!normalized) return false;
  return parsePhoneAllowlist(allowlistValue).has(normalized);
}

function isKommoCompatibleMessageType(type = '') {
  return ['confirmation', 'order_contact', 'flux'].includes(String(type || '').toLowerCase());
}

function isExplicitKommoTestRequest(input = {}) {
  return String(input.deliveryEngine || '').toLowerCase() === 'kommo_test' ||
    String(input.engine || '').toLowerCase() === 'kommo';
}

function assertKommoTestRequestAllowed(input = {}, config = {}) {
  if (input.forceMeta || !isExplicitKommoTestRequest(input)) return;
  const testEnabled = config.testEnabled === true || String(config.testEnabled || '').toLowerCase() === 'true';
  const allowlist = config.testPhoneAllowlist || '';
  if (!testEnabled) {
    const error = new Error('La prueba de Kommo no esta habilitada.');
    error.statusCode = 403;
    throw error;
  }
  if (!isKommoCompatibleMessageType(input.type)) {
    const error = new Error('Este tipo de mensaje no esta habilitado para prueba Kommo.');
    error.statusCode = 400;
    throw error;
  }
  if (!isPhoneAllowedForKommoTest(input.to, allowlist)) {
    const error = new Error('Este telefono no esta habilitado para prueba Kommo.');
    error.statusCode = 403;
    throw error;
  }
}

function chooseWhatsappEngine(input = {}, config = {}) {
  const defaultEngine = String(config.defaultEngine || 'meta').toLowerCase();
  const type = String(input.type || '').toLowerCase();
  const testEnabled = config.testEnabled === true || String(config.testEnabled || '').toLowerCase() === 'true';
  const allowlist = config.testPhoneAllowlist || '';

  if (input.forceMeta || type === 'tracking') return 'meta';
  if (String(input.source || '').toLowerCase() === 'bulk_dispatched' && isKommoCompatibleMessageType(type)) return 'kommo';
  if (defaultEngine === 'kommo' && isKommoCompatibleMessageType(type)) return 'kommo';
  if (isExplicitKommoTestRequest(input) && testEnabled && isKommoCompatibleMessageType(type) && isPhoneAllowedForKommoTest(input.to, allowlist)) return 'kommo';
  return 'meta';
}

module.exports = {
  assertKommoTestRequestAllowed,
  chooseWhatsappEngine,
  isExplicitKommoTestRequest,
  isKommoCompatibleMessageType,
  isPhoneAllowedForKommoTest,
  parsePhoneAllowlist
};
