'use strict';

const { isPhoneAllowedForKommoTest } = require('./whatsapp-engine');

function safeKommoFrontendDebug(diagnostics = {}) {
  if (!diagnostics) return null;
  if (Object.prototype.hasOwnProperty.call(diagnostics, 'chatIdsEncontrados')) return diagnostics;
  return {
    normalizedPhone: diagnostics.normalized_phone || null,
    contactId: diagnostics.contact_id || null,
    contactCreated: diagnostics.contact_created === true,
    chatIdsEncontrados: diagnostics.chat_ids || [],
    selectedChatId: diagnostics.selected_chat_id || diagnostics.conversation_chat_id || null,
    selectedTalkId: diagnostics.selected_conversation_id || diagnostics.talk_id || null,
    conversationEntityId: diagnostics.conversation_entity_id || null,
    conversationEntityType: diagnostics.conversation_entity_type || null,
    leadFoundByTN: diagnostics.lead_id_found_by_tn || null,
    selectedLeadId: diagnostics.selected_lead_id || diagnostics.conversation_lead_id || null,
    linkedContactIds: diagnostics.selected_lead_contact_ids || [],
    botId: diagnostics.bot_id || null,
    launchEntityId: diagnostics.entity_id_used_for_bot || null,
    launchEntityType: diagnostics.entity_type_used_for_bot || null
  };
}

function shouldExposeKommoTestDebug(input = {}, engine = '', config = {}) {
  return engine === 'kommo' &&
    config.testEnabled === true &&
    String(input.engine || '').toLowerCase() === 'kommo' &&
    isPhoneAllowedForKommoTest(input.to, config.testPhoneAllowlist || '');
}

function buildWhatsappTemplateErrorPayload({
  err,
  input,
  engine,
  testEnabled,
  testPhoneAllowlist,
  sanitizedMessage
}) {
  const payload = { success: false, error: sanitizedMessage };
  if (err.kommoDiagnostics) payload.diagnostics = err.kommoDiagnostics;
  if (shouldExposeKommoTestDebug(input, engine, { testEnabled, testPhoneAllowlist })) {
    payload.debug = safeKommoFrontendDebug(err.kommoDebug || err.kommoDiagnostics || null);
  }
  if (err.meta) payload.meta = err.meta;
  return payload;
}

module.exports = {
  buildWhatsappTemplateErrorPayload,
  safeKommoFrontendDebug,
  shouldExposeKommoTestDebug
};
