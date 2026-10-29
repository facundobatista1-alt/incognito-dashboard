'use strict';

const DEFAULT_DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizeWhatsappPhone(phone = '') {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('549')) return digits;
  if (digits.startsWith('54')) {
    return `549${digits.slice(2).replace(/^0/, '').replace(/^(\d{2,4})15/, '$1')}`;
  }
  const withoutTrunk = digits.replace(/^0/, '');
  const withoutMobilePrefix = withoutTrunk.replace(/^(\d{2,4})15/, '$1');
  if (withoutMobilePrefix.length >= 8 && withoutMobilePrefix.length <= 11) return `549${withoutMobilePrefix}`;
  return digits;
}

function firstCustomerName(name = '') {
  return String(name || '').trim().split(/\s+/)[0] || 'Cliente';
}

function customFieldValue(fieldId, value) {
  return {
    field_id: Number(fieldId),
    values: [{ value: String(value || '') }]
  };
}

function readCustomField(entity = {}, fieldId) {
  const id = Number(fieldId);
  const field = (entity.custom_fields_values || []).find((item) => Number(item.field_id) === id);
  return String(field?.values?.[0]?.value || '').trim();
}

function contactPhoneValues(contact = {}) {
  return (contact.custom_fields_values || [])
    .filter((field) => String(field.field_code || '').toUpperCase() === 'PHONE')
    .flatMap((field) => field.values || [])
    .map((value) => normalizeWhatsappPhone(value.value))
    .filter(Boolean);
}

function phoneCustomFieldValue(phone) {
  return {
    field_code: 'PHONE',
    values: [{ value: normalizeWhatsappPhone(phone), enum_code: 'WORK' }]
  };
}

function extractEmbedded(data, key) {
  if (Array.isArray(data)) return data;
  const embedded = data && data._embedded;
  if (!embedded) return [];
  return Array.isArray(embedded[key]) ? embedded[key] : [];
}

function extractChats(data) {
  return extractEmbedded(data, 'chats')
    .concat(Array.isArray(data?.chats) ? data.chats : [])
    .concat(Array.isArray(data) ? data : [])
    .filter(Boolean);
}

function extractTalks(data) {
  return extractEmbedded(data, 'talks')
    .concat(Array.isArray(data?.talks) ? data.talks : [])
    .concat(Array.isArray(data) ? data : [])
    .filter(Boolean);
}

function kommoProblemText(data, status) {
  if (!data) return `Kommo respondio HTTP ${status}`;
  if (typeof data === 'string') return data.slice(0, 400) || `Kommo respondio HTTP ${status}`;
  return [
    data.detail,
    data.title,
    data.message,
    data.error,
    data.validation_errors ? JSON.stringify(data.validation_errors).slice(0, 300) : ''
  ].filter(Boolean).join(' - ') || `Kommo respondio HTTP ${status}`;
}

function sanitizedKommoError(error) {
  const text = String(error?.message || error || 'Error de Kommo');
  return text.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [oculto]');
}

function isKommoChannelLinkError(error) {
  const message = sanitizedKommoError(error).toLowerCase();
  return message.includes('channel must be linked') ||
    message.includes('setup channel first') ||
    message.includes('no tiene una conversacion de whatsapp vinculada') ||
    message.includes('la conversacion no esta vinculada');
}

function sanitizeKommoBody(data) {
  if (data === undefined || data === null) return data;
  if (typeof data === 'string') return data.slice(0, 700);
  try {
    return JSON.parse(JSON.stringify(data, (key, value) => (
      /token|authorization|access/i.test(key) ? '[oculto]' : value
    )));
  } catch {
    return String(data).slice(0, 700);
  }
}

function collectTemplateIds(value, ids = new Set()) {
  if (value === null || value === undefined) return ids;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectTemplateIds(entry, ids));
    return ids;
  }
  if (typeof value !== 'object') return ids;
  Object.entries(value).forEach(([key, entry]) => {
    if (/^template_?id$/i.test(key)) {
      const id = Number(entry);
      if (Number.isFinite(id) && id > 0) ids.add(id);
    }
    collectTemplateIds(entry, ids);
  });
  return ids;
}

function botTemplateIds(bot = {}) {
  return Array.from(collectTemplateIds(bot)).sort((left, right) => left - right);
}

function salesbotDebugFromDiagnostics(diagnostics = {}) {
  return {
    normalizedPhone: diagnostics.normalized_phone || null,
    requestedTn: diagnostics.requested_tn || null,
    contactId: diagnostics.contact_id || null,
    contactCreated: diagnostics.contact_created === true,
    chatIdsEncontrados: diagnostics.chat_ids || [],
    selectedChatId: diagnostics.selected_chat_id || null,
    selectedTalkId: diagnostics.selected_conversation_id || diagnostics.talk_id || null,
    conversationEntityId: diagnostics.conversation_entity_id || null,
    conversationEntityType: diagnostics.conversation_entity_type || null,
    leadFoundByTN: diagnostics.lead_id_found_by_tn || null,
    selectedLeadId: diagnostics.selected_lead_id || null,
    selectedLeadCreated: Boolean(diagnostics.lead_id_created),
    linkedContactIds: diagnostics.selected_lead_contact_ids || [],
    botId: diagnostics.bot_id || null,
    launchEntityId: diagnostics.entity_id_used_for_bot || null,
    launchEntityType: diagnostics.entity_type_used_for_bot || null,
    tnFieldUpdate: diagnostics.tn_field_update || null,
    nameFieldUpdate: diagnostics.name_field_update || null,
    verifiedTn: diagnostics.verified_tn || null,
    verifiedName: diagnostics.verified_name || null,
    leadNoteCreated: Boolean(diagnostics.lead_note_created)
  };
}

function createKommoDebug({ normalizedPhone = '', botId = null } = {}) {
  return {
    stage: 'started',
    normalizedPhone,
    requestedTn: null,
    contactId: null,
    contactCreated: null,
    chatIdsEncontrados: [],
    selectedChatId: null,
    selectedTalkId: null,
    conversationEntityId: null,
    conversationEntityType: null,
    leadFoundByTN: null,
    selectedLeadId: null,
    selectedLeadCreated: false,
    linkedContactIds: [],
    botId,
    launchEntityId: null,
    launchEntityType: null,
    tnFieldUpdate: null,
    nameFieldUpdate: null,
    verifiedTn: null,
    verifiedName: null,
    leadNoteCreated: null
  };
}

function logKommoStage(kommoDebug = {}) {
  console.info('[KOMMO_STAGE]', JSON.stringify({
    stage: kommoDebug.stage || null,
    contactId: kommoDebug.contactId || null,
    selectedChatId: kommoDebug.selectedChatId || null,
    selectedLeadId: kommoDebug.selectedLeadId || null,
    botId: kommoDebug.botId || null,
    launchEntityId: kommoDebug.launchEntityId || null,
    launchEntityType: kommoDebug.launchEntityType || null
  }));
}

function setKommoStage(kommoDebug, stage) {
  kommoDebug.stage = stage;
  logKommoStage(kommoDebug);
}

function attachKommoDebug(error, kommoDebug = {}) {
  const enriched = {
    ...kommoDebug,
    failedStage: kommoDebug.stage || null,
    status: error.response?.status || error.status || error.statusCode || null,
    kommoResponse: sanitizeKommoBody(error.response?.data || error.data)
  };
  error.kommoDebug = enriched;
  return error;
}

function isFluxPaymentPending(input = {}) {
  const paymentMethod = normalizeText(input.paymentMethod);
  const collectAmount = Number(input.fluxCollectAmount || input.collectAmount || 0);
  return paymentMethod.includes('abonar') ||
    paymentMethod.includes('recibir') ||
    collectAmount > 0;
}

function botForWhatsappPayload(input = {}, config = {}) {
  const type = String(input.type || '').trim();
  if (type === 'confirmation') return Number(config.botConfirmationFluxId || 0);
  if (type === 'order_contact') return Number(config.botOrderContactId || 0);
  if (type === 'flux') {
    return isFluxPaymentPending(input)
      ? Number(config.botFluxPendingId || 0)
      : Number(config.botFluxPaidId || 0);
  }
  return 0;
}

function createChatBotForWhatsappPayload(input = {}, config = {}) {
  const type = String(input.type || '').trim();
  if (type === 'order_contact') {
    return {
      type: 'order_contact',
      name: config.botOrderContactCreateChatName,
      templateId: Number(config.botOrderContactCreateChatTemplateId || 66802),
      needsOrderFields: true
    };
  }
  if (type === 'confirmation') {
    return {
      type: 'confirmation',
      name: config.botConfirmationCreateChatName,
      templateId: Number(config.botConfirmationCreateChatTemplateId || 66800),
      needsOrderFields: true
    };
  }
  if (type === 'flux') {
    return isFluxPaymentPending(input)
      ? {
          type: 'flux_pending',
          name: config.botFluxPendingCreateChatName,
          templateId: Number(config.botFluxPendingCreateChatTemplateId || 66774),
          needsOrderFields: false
        }
      : {
          type: 'flux_paid',
          name: config.botFluxPaidCreateChatName,
          templateId: Number(config.botFluxPaidCreateChatTemplateId || 30876),
          needsOrderFields: false
        };
  }
  return null;
}

function kommoConfigFromEnv(env = process.env) {
  return {
    subdomain: env.KOMMO_SUBDOMAIN || 'incognitoindumentaria',
    accessToken: env.KOMMO_ACCESS_TOKEN || '',
    leadTnFieldId: Number(env.KOMMO_FIELD_TN_ID || 2443342),
    leadNameFieldId: Number(env.KOMMO_FIELD_NOMBRE_TN_ID || 2443344),
    botConfirmationFluxId: Number(env.KOMMO_BOT_CONFIRMACION_FLUX_ID || 102514),
    botOrderContactId: Number(env.KOMMO_BOT_CONTACTO_PEDIDO_ID || 102516),
    botOrderContactCreateChatName: env.KOMMO_BOT_CONTACTO_PEDIDO_CREATE_CHAT_NAME || 'Contacto por pedido - crea chat',
    botOrderContactCreateChatTemplateId: Number(env.KOMMO_BOT_CONTACTO_PEDIDO_CREATE_CHAT_TEMPLATE_ID || 66802),
    botConfirmationCreateChatName: env.KOMMO_BOT_CONFIRMACION_CREATE_CHAT_NAME || 'Confirmación de pedido – crea chat',
    botConfirmationCreateChatTemplateId: Number(env.KOMMO_BOT_CONFIRMACION_CREATE_CHAT_TEMPLATE_ID || 66800),
    botFluxPaidCreateChatName: env.KOMMO_BOT_FLUX_ABONADO_CREATE_CHAT_NAME || 'Flux abonado – crea chat',
    botFluxPaidCreateChatTemplateId: Number(env.KOMMO_BOT_FLUX_ABONADO_CREATE_CHAT_TEMPLATE_ID || 30876),
    botFluxPendingCreateChatName: env.KOMMO_BOT_FLUX_SIN_ABONAR_CREATE_CHAT_NAME || 'Flux sin abonar – crea chat',
    botFluxPendingCreateChatTemplateId: Number(env.KOMMO_BOT_FLUX_SIN_ABONAR_CREATE_CHAT_TEMPLATE_ID || 66774),
    botFluxPendingId: Number(env.KOMMO_BOT_FLUX_SIN_ABONAR_ID || 102520),
    botFluxPaidId: Number(env.KOMMO_BOT_FLUX_ABONADO_ID || 102522),
    testEntityType: String(env.KOMMO_TEST_ENTITY_TYPE || 'leads').toLowerCase() === 'contacts' ? 'contacts' : 'leads',
    duplicateWindowMs: Number(env.KOMMO_DUPLICATE_WINDOW_MS || DEFAULT_DUPLICATE_WINDOW_MS)
  };
}

class KommoService {
  constructor(config = {}, options = {}) {
    this.config = { ...kommoConfigFromEnv({}), ...config };
    this.fetch = options.fetch || global.fetch;
    this.now = options.now || (() => Date.now());
    this.executions = options.executions || new Map();
    this.operationalLeadByContact = options.operationalLeadByContact || new Map();
    this.phoneLocks = options.phoneLocks || new Map();
    this.botIdByName = options.botIdByName || new Map();
  }

  enabled() {
    return Boolean(this.config.subdomain && this.config.accessToken);
  }

  baseUrl() {
    return `https://${this.config.subdomain}.kommo.com`;
  }

  async request(method, path, options = {}) {
    if (!this.enabled()) {
      const error = new Error('Falta configurar Kommo en el servidor.');
      error.statusCode = 503;
      throw error;
    }
    if (!this.fetch) {
      const error = new Error('Este entorno no tiene fetch disponible para llamar a Kommo.');
      error.statusCode = 500;
      throw error;
    }

    const url = new URL(path, this.baseUrl());
    Object.entries(options.query || {}).forEach(([key, value]) => {
      if (Array.isArray(value)) value.forEach((entry) => url.searchParams.append(key, entry));
      else if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    });

    const headers = {
      Authorization: `Bearer ${this.config.accessToken}`,
      Accept: options.accept || 'application/json'
    };
    let body;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    const response = await this.fetch(url.toString(), { method, headers, body });
    const text = await response.text();
    const contentType = response.headers?.get?.('content-type') || '';
    let data = text;
    if (contentType.includes('json') || /^[\[{]/.test(text.trim())) {
      try { data = JSON.parse(text); } catch { data = text; }
    }

    if (!response.ok) {
      const message = response.status === 401
        ? 'Error de autenticacion con Kommo.'
        : kommoProblemText(data, response.status);
      const error = new Error(message);
      error.statusCode = response.status;
      error.data = data;
      throw error;
    }

    return { status: response.status, data, text };
  }

  async findContactByPhone(phone) {
    const normalizedPhone = normalizeWhatsappPhone(phone);
    if (!normalizedPhone) return null;
    const result = await this.request('GET', '/api/v4/contacts', {
      query: { query: normalizedPhone, with: 'leads' }
    });
    const contacts = extractEmbedded(result.data, 'contacts');
    return contacts.find((contact) => contactPhoneValues(contact).includes(normalizedPhone)) ||
      contacts[0] ||
      null;
  }

  async listBots() {
    const result = await this.request('GET', '/api/v4/bots');
    return extractEmbedded(result.data, 'bots')
      .concat(extractEmbedded(result.data, 'items'))
      .concat(Array.isArray(result.data?.bots) ? result.data.bots : [])
      .concat(Array.isArray(result.data?.items) ? result.data.items : [])
      .concat(Array.isArray(result.data) ? result.data : [])
      .filter(Boolean);
  }

  async botIdByExactName(name) {
    const botName = String(name || '').trim();
    if (!botName) {
      const error = new Error('Falta el nombre del Salesbot de Kommo.');
      error.statusCode = 400;
      throw error;
    }
    if (this.botIdByName.has(botName)) return this.botIdByName.get(botName);
    const bots = await this.listBots();
    const matches = bots.filter((bot) => String(bot.name || '').trim() === botName);
    if (matches.length !== 1) {
      const error = new Error(matches.length
        ? `Hay ${matches.length} Salesbots con el nombre "${botName}".`
        : `No encontre el Salesbot "${botName}" en Kommo.`);
      error.statusCode = 409;
      error.data = { requestedName: botName, matches: matches.map((bot) => ({ id: bot.id, name: bot.name })) };
      throw error;
    }
    const id = Number(matches[0].id || 0);
    if (!id) {
      const error = new Error(`El Salesbot "${botName}" no devolvio un ID valido.`);
      error.statusCode = 409;
      throw error;
    }
    this.botIdByName.set(botName, id);
    return id;
  }

  async readBot(botId) {
    const result = await this.request('GET', `/api/v4/bots/${encodeURIComponent(botId)}/`);
    return result.data || {};
  }

  async botIdByExactNameAndTemplate(name, expectedTemplateId) {
    const botName = String(name || '').trim();
    const templateId = Number(expectedTemplateId || 0);
    const cacheKey = `${botName}|${templateId || 'any'}`;
    if (this.botIdByName.has(cacheKey)) return this.botIdByName.get(cacheKey);
    const bots = await this.listBots();
    const matches = bots.filter((bot) => String(bot.name || '').trim() === botName);
    if (!matches.length) {
      const error = new Error(`No encontre el Salesbot "${botName}" en Kommo.`);
      error.statusCode = 409;
      throw error;
    }

    const checked = [];
    for (const bot of matches) {
      const id = Number(bot.id || 0);
      if (!id) continue;
      let detail = bot;
      try {
        detail = await this.readBot(id);
      } catch {
        detail = bot;
      }
      const templateIds = botTemplateIds(detail).concat(botTemplateIds(bot))
        .filter((value, index, list) => list.indexOf(value) === index);
      checked.push({ id, name: bot.name, templateIds });
      if (!templateId || templateIds.includes(templateId)) {
        this.botIdByName.set(cacheKey, id);
        return id;
      }
    }

    const withoutExposedTemplateIds = checked.every((bot) => !bot.templateIds.length);
    if (matches.length === 1 && checked[0]?.id && withoutExposedTemplateIds) {
      console.warn('[KOMMO_BOT_TEMPLATE_NOT_EXPOSED]', JSON.stringify({
        requestedName: botName,
        requestedTemplateId: templateId,
        selectedBotId: checked[0].id
      }));
      this.botIdByName.set(cacheKey, checked[0].id);
      return checked[0].id;
    }

    const error = new Error(`No encontre el Salesbot "${botName}" con template_id ${templateId}.`);
    error.statusCode = 409;
    error.data = { requestedName: botName, requestedTemplateId: templateId, matches: checked };
    throw error;
  }

  async createContactForPhone({ phone, name }) {
    const normalizedPhone = normalizeWhatsappPhone(phone);
    if (!normalizedPhone) return null;
    const result = await this.request('POST', '/api/v4/contacts', {
      body: [{
        name: String(name || 'Cliente WhatsApp').trim() || 'Cliente WhatsApp',
        custom_fields_values: [phoneCustomFieldValue(normalizedPhone)]
      }]
    });
    return extractEmbedded(result.data, 'contacts')[0] || (Array.isArray(result.data) ? result.data[0] : null);
  }

  async createLeadForContact({ contactId, name, tn }) {
    const customFields = [];
    if (tn) customFields.push(customFieldValue(this.config.leadTnFieldId, tn));
    if (name) customFields.push(customFieldValue(this.config.leadNameFieldId, name));
    const result = await this.request('POST', '/api/v4/leads', {
      body: [{
        name: [`Pedido`, tn || '', name || 'Cliente WhatsApp'].filter(Boolean).join(' - '),
        custom_fields_values: customFields,
        _embedded: {
          contacts: [{ id: Number(contactId), is_main: true }]
        }
      }]
    });
    return extractEmbedded(result.data, 'leads')[0] || (Array.isArray(result.data) ? result.data[0] : null);
  }

  async contactChats(contactId) {
    const result = await this.request('GET', '/api/v4/contacts/chats', {
      query: { contact_id: Number(contactId) }
    });
    return extractChats(result.data);
  }

  async ensureContactHasLinkedChat(contactId) {
    const chats = await this.contactChats(contactId);
    if (chats.length) return chats;
    const error = new Error('El contacto existe en Kommo, pero no tiene una conversacion de WhatsApp vinculada.');
    error.statusCode = 409;
    throw error;
  }

  async contactTalks(contactId) {
    const result = await this.request('GET', '/api/v4/talks', {
      query: {
        'filter[contact_id][]': Number(contactId),
        limit: 10
      }
    });
    return extractTalks(result.data);
  }

  chooseTalkForChats(talks = [], chats = []) {
    const chatIds = new Set(chats.map((chat) => String(chat.chat_id || chat.id || '')).filter(Boolean));
    return talks
      .filter((talk) => !chatIds.size || chatIds.has(String(talk.chat_id || '')))
      .sort((left, right) => Number(right.updated_at || 0) - Number(left.updated_at || 0))[0] || null;
  }

  talkLeadId(talk = {}) {
    return Number(talk.entity_type === 'lead' ? talk.entity_id : 0) ||
      Number(extractEmbedded(talk, 'leads')[0]?.id || 0);
  }

  async conversationLeadForContact(contactId, chats, diagnostics, knownTalks = null) {
    const talks = Array.isArray(knownTalks) ? knownTalks : await this.contactTalks(contactId);
    diagnostics.talk_ids = talks.map((talk) => talk.talk_id || talk.id).filter(Boolean);
    const talk = this.chooseTalkForChats(talks, chats);
    if (!talk) {
      const error = new Error('El contacto tiene un chat de WhatsApp, pero no encontre la conversacion asociada en Kommo.');
      error.statusCode = 409;
      error.kommoDiagnostics = diagnostics;
      throw error;
    }
    diagnostics.talk_id = talk.talk_id || talk.id || null;
    diagnostics.selected_conversation_id = diagnostics.talk_id;
    diagnostics.conversation_chat_id = talk.chat_id || null;
    diagnostics.selected_chat_id = diagnostics.conversation_chat_id;
    diagnostics.conversation_entity_id = talk.entity_id || null;
    diagnostics.conversation_entity_type = talk.entity_type || null;
    diagnostics.conversation_embedded_lead_id = Number(extractEmbedded(talk, 'leads')[0]?.id || 0) || null;
    diagnostics.conversation_embedded_contact_ids = extractEmbedded(talk, 'contacts').map((contact) => contact.id).filter(Boolean);

    const leadId = this.talkLeadId(talk);
    diagnostics.conversation_lead_id = leadId || null;
    if (!leadId) {
      const error = new Error('El contacto tiene un chat de WhatsApp, pero la conversacion no esta vinculada a un lead.');
      error.statusCode = 409;
      error.kommoDiagnostics = diagnostics;
      throw error;
    }
    return { talk, leadId };
  }

  async readLead(leadId, options = {}) {
    const result = await this.request('GET', `/api/v4/leads/${encodeURIComponent(leadId)}`, options);
    return result.data || {};
  }

  async contactLeads(contactId) {
    const result = await this.request('GET', `/api/v4/contacts/${encodeURIComponent(contactId)}`, {
      query: { with: 'leads' }
    });
    return extractEmbedded(result.data, 'leads');
  }

  async chooseOrCreateLeadForContact({ contactId, name, tn, kommoDebug, diagnostics }) {
    let linkedLeads = [];
    try {
      linkedLeads = await this.contactLeads(contactId);
    } catch {
      linkedLeads = [];
    }
    const linkedLeadIds = linkedLeads
      .map((lead) => Number(lead.id || 0))
      .filter(Boolean);
    kommoDebug.linkedContactIds = [Number(contactId)];
    diagnostics.selected_lead_contact_ids = [Number(contactId)];
    diagnostics.contact_linked_lead_ids = linkedLeadIds;
    if (linkedLeads.length) {
      const selected = linkedLeads
        .slice()
        .sort((left, right) => Number(right.updated_at || right.created_at || right.id || 0) - Number(left.updated_at || left.created_at || left.id || 0))[0];
      return { leadId: Number(selected.id), leadCreated: false, contactLinkedAsMain: true };
    }
    const lead = await this.createLeadForContact({ contactId, name, tn });
    const leadId = Number(lead?.id || 0);
    if (!leadId) {
      const error = new Error('Kommo no devolvio el lead creado para ese contacto.');
      error.statusCode = 502;
      throw error;
    }
    return { leadId, leadCreated: true, contactLinkedAsMain: true };
  }

  async updateLeadOrderFields(leadId, { tn, name }) {
    const customFields = [];
    if (tn) customFields.push(customFieldValue(this.config.leadTnFieldId, tn));
    if (name) customFields.push(customFieldValue(this.config.leadNameFieldId, name));
    if (!customFields.length) return { skipped: true };

    const result = await this.request('PATCH', '/api/v4/leads', {
      body: [{
        id: Number(leadId),
        custom_fields_values: customFields
      }]
    });
    return result.data;
  }

  async verifyLeadOrderFields(leadId, { tn, name }) {
    const lead = await this.readLead(leadId);
    const currentTn = readCustomField(lead, this.config.leadTnFieldId);
    const currentName = readCustomField(lead, this.config.leadNameFieldId);
    const expectedTn = String(tn || '').trim();
    const expectedName = String(name || '').trim();
    if ((expectedTn && currentTn !== expectedTn) || (expectedName && currentName !== expectedName)) {
      const error = new Error('Kommo no confirmo la actualizacion de TN y Nombre de TN en el lead. No se lanzo el Salesbot.');
      error.statusCode = 409;
      error.data = {
        expectedTn,
        currentTn,
        expectedName,
        currentName
      };
      throw error;
    }
    return { tn: currentTn, name: currentName };
  }

  async launchSalesbot(botId, entityId, entityType = 'leads', kommoDebug = {}) {
    kommoDebug.botId = Number(botId);
    kommoDebug.launchEntityId = Number(entityId);
    kommoDebug.launchEntityType = entityType;
    console.info('[KOMMO_SALESBOT_DIAGNOSTIC]', JSON.stringify(kommoDebug));
    try {
      return await this.request('POST', `/api/v4/bots/${encodeURIComponent(botId)}/run`, {
        accept: 'text/html',
        body: {
          entity_id: Number(entityId),
          entity_type: entityType
        }
      });
    } catch (error) {
      console.error('[KOMMO_SALESBOT_ERROR]', JSON.stringify({
        ...kommoDebug,
        status: error.response?.status || error.statusCode || null,
        kommoResponse: sanitizeKommoBody(error.response?.data || error.data) || sanitizedKommoError(error)
      }));
      attachKommoDebug(error, kommoDebug);
      throw error;
    }
  }

  duplicateKey(input, botId, tn) {
    return [
      tn || input.orderId || input.internalOrderNumber || input.storeOrderNumber || normalizeWhatsappPhone(input.to),
      botId,
      input.type
    ].join('|');
  }

  findRecentExecution(key) {
    const now = this.now();
    for (const [existingKey, value] of this.executions.entries()) {
      if (now - value.requestedAt > this.config.duplicateWindowMs) this.executions.delete(existingKey);
    }
    return this.executions.get(key) || null;
  }

  rememberExecution(key, values = {}) {
    const entry = { requestedAt: this.now(), ...values };
    this.executions.set(key, entry);
    return entry;
  }

  async withPhoneLock(phone, task) {
    const key = normalizeWhatsappPhone(phone);
    const previous = this.phoneLocks.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    this.phoneLocks.set(key, previous.then(() => current, () => current));
    try {
      await previous.catch(() => {});
      return await task();
    } finally {
      release();
      if (this.phoneLocks.get(key) === current) this.phoneLocks.delete(key);
    }
  }

  uniqueLeadCandidates(ids = []) {
    const seen = new Set();
    return ids
      .map((id) => Number(id || 0))
      .filter((id) => Number.isFinite(id) && id > 0)
      .filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
  }

  async buildOperationalLeadCandidates({ contact, conversationLeadId, realLeadId }) {
    const contactKey = String(contact.id);
    const storedLeadId = Number(this.operationalLeadByContact.get(contactKey) || 0);
    let linkedLeads = [];
    try {
      linkedLeads = await this.contactLeads(contact.id);
    } catch {
      linkedLeads = [];
    }
    const linkedLeadIds = linkedLeads
      .slice()
      .sort((left, right) => Number(right.updated_at || right.created_at || right.id || 0) - Number(left.updated_at || left.created_at || left.id || 0))
      .map((lead) => lead.id);
    return this.uniqueLeadCandidates([storedLeadId, conversationLeadId, ...linkedLeadIds, realLeadId]);
  }

  shouldUpdateTemporaryOrderFields(type = '') {
    return ['confirmation', 'order_contact'].includes(String(type || '').toLowerCase());
  }

  async prepareOperationalLead(leadId, { tn, name, type }, kommoDebug, diagnostics) {
    if (!this.shouldUpdateTemporaryOrderFields(type)) {
      kommoDebug.tnFieldUpdate = 'skipped';
      kommoDebug.nameFieldUpdate = 'skipped';
      diagnostics.tn_field_update = 'skipped';
      diagnostics.name_field_update = 'skipped';
      return;
    }
    await this.updateLeadOrderFields(leadId, { tn, name });
    kommoDebug.tnFieldUpdate = tn ? 'requested' : 'skipped';
    kommoDebug.nameFieldUpdate = name ? 'requested' : 'skipped';
    diagnostics.tn_field_update = kommoDebug.tnFieldUpdate;
    diagnostics.name_field_update = kommoDebug.nameFieldUpdate;
    const verified = await this.verifyLeadOrderFields(leadId, { tn, name });
    kommoDebug.verifiedTn = verified.tn || null;
    kommoDebug.verifiedName = verified.name || null;
    diagnostics.verified_tn = verified.tn || null;
    diagnostics.verified_name = verified.name || null;
  }

  async sendWhatsappTemplate(input = {}) {
    const phone = normalizeWhatsappPhone(input.to);
    if (!phone) {
      const error = new Error('Falta WhatsApp del cliente.');
      error.statusCode = 400;
      throw error;
    }

    const createChatBot = createChatBotForWhatsappPayload(input, this.config);
    if (createChatBot) {
      return this.sendCreateChatWhatsappTemplate(input, phone, createChatBot);
    }

    const botId = botForWhatsappPayload(input, this.config);
    if (!botId) {
      const error = new Error(`No hay Salesbot configurado para ${input.type || 'este mensaje'}.`);
      error.statusCode = 400;
      throw error;
    }

    const kommoDebug = createKommoDebug({ normalizedPhone: phone, botId });
    const tn = String(input.storeOrderNumber || input.orderNumber || input.internalOrderNumber || '').trim();
    const name = String(input.customerName || input.customer || firstCustomerName(input.customerName)).trim();
    kommoDebug.requestedTn = tn || null;
    const diagnostics = {
      normalized_phone: phone,
      bot_id: botId,
      message_type: input.type || '',
      requested_tn: tn || null
    };
    const key = this.duplicateKey(input, botId, tn);
    const duplicate = this.findRecentExecution(key);
    if (duplicate) {
      return {
        success: true,
        engine: 'kommo',
        status: 'duplicate_avoided',
        message: 'Envio duplicado evitado.',
        botId,
        leadId: duplicate.leadId || null,
        contactId: duplicate.contactId || null
      };
    }

    return this.withPhoneLock(phone, async () => {
      const duplicateInsideLock = this.findRecentExecution(key);
      if (duplicateInsideLock) {
        return {
          success: true,
          engine: 'kommo',
          status: 'duplicate_avoided',
          message: 'Envio duplicado evitado.',
          botId,
          leadId: duplicateInsideLock.leadId || null,
          operationalLeadId: duplicateInsideLock.operationalLeadId || null,
          contactId: duplicateInsideLock.contactId || null
        };
      }

    try {
      setKommoStage(kommoDebug, 'contact_lookup');
      let contact = await this.findContactByPhone(phone);
      let contactCreated = false;
      if (!contact) {
        if (input.source === 'manual_tab') {
          contact = await this.createContactForPhone({ phone, name });
          contactCreated = Boolean(contact?.id);
        }
        if (!contact) {
          const error = new Error('No se encontro un contacto de Kommo para ese WhatsApp.');
          error.statusCode = 404;
          throw error;
        }
      }
      kommoDebug.contactId = contact.id;
      kommoDebug.contactCreated = contactCreated;
      diagnostics.contact_id = contact.id;
      diagnostics.contact_created = contactCreated;

      setKommoStage(kommoDebug, 'conversation_lookup');
      const talks = await this.contactTalks(contact.id);
      const talkChatIds = talks.map((talk) => talk.chat_id).filter(Boolean);

      setKommoStage(kommoDebug, 'chat_lookup');
      let chats = talkChatIds.map((chatId) => ({ chat_id: chatId }));
      if (!chats.length) chats = await this.ensureContactHasLinkedChat(contact.id);
      kommoDebug.chatIdsEncontrados = chats.map((chat) => chat.chat_id || chat.id).filter(Boolean);
      diagnostics.chat_ids = kommoDebug.chatIdsEncontrados;
      diagnostics.chat_link_ids = chats.map((chat) => chat.id).filter(Boolean);

      setKommoStage(kommoDebug, 'conversation_lookup');
      const conversation = await this.conversationLeadForContact(contact.id, chats, diagnostics, talks);
      kommoDebug.selectedChatId = diagnostics.selected_chat_id || diagnostics.conversation_chat_id || null;
      kommoDebug.selectedTalkId = diagnostics.selected_conversation_id || diagnostics.talk_id || null;
      kommoDebug.conversationEntityId = diagnostics.conversation_entity_id || null;
      kommoDebug.conversationEntityType = diagnostics.conversation_entity_type || null;

      setKommoStage(kommoDebug, 'lead_selection');
      const candidateLeadIds = await this.buildOperationalLeadCandidates({
        contact,
        conversationLeadId: conversation.leadId,
        realLeadId: null
      });
      kommoDebug.selectedLeadId = candidateLeadIds[0] || null;
      diagnostics.selected_lead_id = kommoDebug.selectedLeadId;
      diagnostics.operational_lead_candidates = candidateLeadIds;

      setKommoStage(kommoDebug, 'salesbot_launch');
      let launch = null;
      let operationalLeadId = null;
      const channelErrors = [];
      for (const candidateLeadId of candidateLeadIds) {
        kommoDebug.operationalLeadCandidate = candidateLeadId;
        diagnostics.operational_lead_candidate = candidateLeadId;
        await this.prepareOperationalLead(candidateLeadId, { tn, name, type: input.type }, kommoDebug, diagnostics);
        try {
          launch = await this.launchSalesbot(botId, candidateLeadId, 'leads', kommoDebug);
          operationalLeadId = candidateLeadId;
          break;
        } catch (candidateError) {
          if (!isKommoChannelLinkError(candidateError)) throw candidateError;
          channelErrors.push({ leadId: candidateLeadId, message: sanitizedKommoError(candidateError) });
        }
      }
      diagnostics.operational_lead_attempt_errors = channelErrors;
      if (!launch || !operationalLeadId) {
        const error = new Error('Ningun lead asociado al contacto acepta el canal de WhatsApp para lanzar el Salesbot.');
        error.statusCode = 409;
        error.data = { channelErrors };
        throw error;
      }
      this.operationalLeadByContact.set(String(contact.id), operationalLeadId);
      diagnostics.operational_lead_id = operationalLeadId;
      diagnostics.entity_id_used_for_bot = operationalLeadId;
      diagnostics.entity_type_used_for_bot = 'leads';
      kommoDebug.operationalLeadId = operationalLeadId;
      kommoDebug.selectedLeadId = operationalLeadId;
      kommoDebug.launchEntityId = operationalLeadId;
      kommoDebug.launchEntityType = 'leads';

      this.rememberExecution(key, {
        leadId: operationalLeadId,
        operationalLeadId,
        contactId: contact.id,
        acceptedAt: this.now()
      });

      return {
        success: true,
        engine: 'kommo',
        status: 'launch_requested',
        message: 'Lanzamiento solicitado a Kommo',
        botId,
        leadId: operationalLeadId,
        operationalLeadId,
        contactId: contact.id,
        responseStatus: launch.status,
        diagnostics,
        kommoDebug
      };
    } catch (error) {
      attachKommoDebug(error, kommoDebug);
      diagnostics.kommo_error_status = error.kommoDebug.status || null;
      diagnostics.kommo_error_body = error.kommoDebug.kommoResponse || null;
      error.kommoDiagnostics = diagnostics;
      throw error;
    }
    });
  }

  async sendCreateChatWhatsappTemplate(input = {}, phone = normalizeWhatsappPhone(input.to), botDefinition = null) {
    const tn = String(input.storeOrderNumber || input.orderNumber || input.internalOrderNumber || '').trim();
    const name = String(input.customerName || input.customer || firstCustomerName(input.customerName)).trim();
    const kommoDebug = createKommoDebug({ normalizedPhone: phone, botId: null });
    kommoDebug.requestedTn = tn || null;
    const diagnostics = {
      normalized_phone: phone,
      message_type: input.type || '',
      requested_tn: tn || null,
      flow: 'create_chat_salesbot',
      bot_name: botDefinition?.name || null,
      expected_template_id: botDefinition?.templateId || null
    };

    try {
      setKommoStage(kommoDebug, 'bot_lookup');
      const botId = await this.botIdByExactNameAndTemplate(botDefinition.name, botDefinition.templateId);
      kommoDebug.botId = botId;
      diagnostics.bot_id = botId;

      const key = this.duplicateKey(input, botId, tn);
      const duplicate = this.findRecentExecution(key);
      if (duplicate) {
        return {
          success: true,
          engine: 'kommo',
          status: 'duplicate_avoided',
          message: 'Envio duplicado evitado.',
          botId,
          leadId: duplicate.leadId || null,
          contactId: duplicate.contactId || null,
          diagnostics
        };
      }

      return this.withPhoneLock(phone, async () => {
        const duplicateInsideLock = this.findRecentExecution(key);
        if (duplicateInsideLock) {
          return {
            success: true,
            engine: 'kommo',
            status: 'duplicate_avoided',
            message: 'Envio duplicado evitado.',
            botId,
            leadId: duplicateInsideLock.leadId || null,
            contactId: duplicateInsideLock.contactId || null,
            diagnostics
          };
        }

        setKommoStage(kommoDebug, 'contact_lookup');
        let contact = await this.findContactByPhone(phone);
        const contactFound = Boolean(contact?.id);
        let contactCreated = false;
        if (!contact) {
          setKommoStage(kommoDebug, 'contact_create');
          contact = await this.createContactForPhone({ phone, name });
          contactCreated = Boolean(contact?.id);
        }
        if (!contact?.id) {
          const error = new Error('No se pudo encontrar ni crear el contacto de Kommo para ese WhatsApp.');
          error.statusCode = 502;
          throw error;
        }
        kommoDebug.contactId = Number(contact.id);
        kommoDebug.contactCreated = contactCreated;
        diagnostics.contact_id = Number(contact.id);
        diagnostics.contact_found = contactFound;
        diagnostics.contact_created = contactCreated;

        setKommoStage(kommoDebug, 'lead_selection');
        const selectedLead = await this.chooseOrCreateLeadForContact({
          contactId: contact.id,
          name,
          tn,
          kommoDebug,
          diagnostics
        });
        kommoDebug.selectedLeadId = selectedLead.leadId;
        kommoDebug.selectedLeadCreated = selectedLead.leadCreated;
        diagnostics.selected_lead_id = selectedLead.leadId;
        diagnostics.lead_id_created = selectedLead.leadCreated ? selectedLead.leadId : null;

        setKommoStage(kommoDebug, 'field_update');
        if (botDefinition.needsOrderFields) {
          await this.prepareOperationalLead(selectedLead.leadId, { tn, name, type: input.type }, kommoDebug, diagnostics);
        } else {
          kommoDebug.tnFieldUpdate = 'skipped';
          kommoDebug.nameFieldUpdate = 'skipped';
          diagnostics.tn_field_update = 'skipped';
          diagnostics.name_field_update = 'skipped';
        }
        const fieldsVerified = !botDefinition.needsOrderFields ||
          ((!tn || kommoDebug.verifiedTn === tn) && (!name || kommoDebug.verifiedName === name));
        if (!fieldsVerified) {
          const error = new Error('Kommo no confirmo TN y Nombre TN en el lead. No se lanzo el Salesbot.');
          error.statusCode = 409;
          throw error;
        }

        setKommoStage(kommoDebug, 'salesbot_launch');
        const launch = await this.launchSalesbot(botId, selectedLead.leadId, 'leads', kommoDebug);
        if (Number(launch.status) !== 202) {
          const error = new Error(`Kommo no devolvio HTTP 202 al lanzar el Salesbot. Estado: ${launch.status}`);
          error.statusCode = 502;
          throw error;
        }

        this.rememberExecution(key, {
          leadId: selectedLead.leadId,
          contactId: contact.id,
          acceptedAt: this.now()
        });

        return {
          success: true,
          engine: 'kommo',
          status: 'launch_requested',
          message: 'Lanzamiento solicitado a Kommo',
          contactFound,
          contactCreated,
          contactId: Number(contact.id),
          leadCreated: selectedLead.leadCreated,
          leadId: selectedLead.leadId,
          contactLinkedAsMain: selectedLead.contactLinkedAsMain,
          fieldsVerified,
          botId,
          launchEntityId: selectedLead.leadId,
          launchEntityType: 'leads',
          kommoStatus: launch.status,
          diagnostics,
          kommoDebug
        };
      });
    } catch (error) {
      error.disableMetaFallback = true;
      attachKommoDebug(error, kommoDebug);
      diagnostics.kommo_error_status = error.kommoDebug.status || null;
      diagnostics.kommo_error_body = error.kommoDebug.kommoResponse || null;
      error.kommoDiagnostics = diagnostics;
      throw error;
    }
  }
}

module.exports = {
  KommoService,
  botForWhatsappPayload,
  isFluxPaymentPending,
  kommoConfigFromEnv,
  normalizeWhatsappPhone,
  sanitizedKommoError,
  readCustomField,
  extractChats,
  extractTalks,
  sanitizeKommoBody,
  botTemplateIds,
  createChatBotForWhatsappPayload,
  salesbotDebugFromDiagnostics,
  createKommoDebug,
  attachKommoDebug
};
