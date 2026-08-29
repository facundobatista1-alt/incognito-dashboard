'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  KommoService,
  botForWhatsappPayload,
  createChatBotForWhatsappPayload,
  isFluxPaymentPending,
  normalizeWhatsappPhone
} = require('./kommo-service');
const {
  assertKommoTestRequestAllowed,
  chooseWhatsappEngine,
  isPhoneAllowedForKommoTest
} = require('./whatsapp-engine');

const config = {
  subdomain: 'incognitoindumentaria',
  accessToken: 'test-token',
  leadTnFieldId: 2443342,
  leadNameFieldId: 2443344,
  botConfirmationFluxId: 102514,
  botOrderContactId: 102516,
  botOrderContactCreateChatName: 'Contacto por pedido - crea chat',
  botOrderContactCreateChatTemplateId: 66802,
  botConfirmationCreateChatName: 'Confirmación de pedido – crea chat',
  botConfirmationCreateChatTemplateId: 66800,
  botFluxPaidCreateChatName: 'Flux abonado – crea chat',
  botFluxPaidCreateChatTemplateId: 30876,
  botFluxPendingCreateChatName: 'Flux sin abonar – crea chat',
  botFluxPendingCreateChatTemplateId: 66774,
  botFluxPendingId: 102520,
  botFluxPaidId: 102522,
  duplicateWindowMs: 120000
};

function jsonResponse(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(data)
  };
}

function textResponse(status, text) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'text/html' },
    text: async () => text
  };
}

function createMockFetch(options = {}) {
  const calls = [];
  const leadFields = new Map();
  const fetch = async (url, request = {}) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const method = request.method;
    const body = request.body ? JSON.parse(request.body) : null;
    calls.push({ url, request, body });

    if (options.timeout && method === 'POST' && path.includes('/api/v4/bots/') && path.endsWith('/run')) {
      throw new Error('Kommo timeout');
    }
    if (options.invalidToken) return jsonResponse(401, { title: 'Unauthorized' });

    if (method === 'GET' && path === '/api/v4/bots') {
      return jsonResponse(200, {
        _embedded: {
          items: [
            { id: 102516, name: 'Contacto por pedido' },
            { id: 103688, name: 'Contacto por pedido - crea chat' },
            { id: 103704, name: 'Confirmación de pedido – crea chat' },
            { id: 103670, name: 'Flux abonado – crea chat' },
            { id: 103702, name: 'Flux sin abonar – crea chat' }
          ]
        }
      });
    }

    if (method === 'GET' && /^\/api\/v4\/bots\/\d+\/?$/.test(path)) {
      const id = Number(path.split('/').filter(Boolean).pop());
      if (options.hideTemplateIds) {
        return jsonResponse(200, { id, name: 'Contacto por pedido - crea chat', settings: { active: true } });
      }
      const byId = {
        103688: { id, name: 'Contacto por pedido - crea chat', settings: { template_id: 66802 } },
        103704: { id, name: 'Confirmación de pedido – crea chat', settings: { template_id: 66800 } },
        103670: { id, name: 'Flux abonado – crea chat', settings: { template_id: 30876 } },
        103702: { id, name: 'Flux sin abonar – crea chat', settings: { template_id: 66774 } }
      };
      return jsonResponse(byId[id] ? 200 : 404, byId[id] || { detail: 'Bot no encontrado' });
    }

    if (method === 'GET' && path === '/api/v4/contacts') {
      if (options.contactExists === false) return jsonResponse(200, { _embedded: { contacts: [] } });
      return jsonResponse(200, {
        _embedded: {
          contacts: [{
            id: 11,
            name: 'Martin',
            custom_fields_values: [{ field_code: 'PHONE', values: [{ value: '+5491128541953' }] }]
          }]
        }
      });
    }

    if (method === 'POST' && path === '/api/v4/contacts') {
      return jsonResponse(200, {
        _embedded: {
          contacts: [{
            id: 12,
            name: body[0].name,
            custom_fields_values: body[0].custom_fields_values
          }]
        }
      });
    }

    if (method === 'POST' && path === '/api/v4/leads') {
      const createdId = Number(options.createdLeadId || 77);
      const fields = body[0]?.custom_fields_values || [];
      leadFields.set(createdId, fields);
      return jsonResponse(200, {
        _embedded: {
          leads: [{
            id: createdId,
            name: body[0].name,
            custom_fields_values: fields,
            _embedded: body[0]._embedded
          }]
        }
      });
    }

    if (method === 'GET' && path === '/api/v4/contacts/chats') {
      if (options.contactHasChat === false) return jsonResponse(200, { _embedded: { chats: [] } });
      return jsonResponse(200, { _embedded: { chats: [{ id: 91, chat_id: 'chat-1', contact_id: 11 }] } });
    }

    if (method === 'GET' && path === '/api/v4/talks') {
      if (options.noTalks) return jsonResponse(200, { _embedded: { talks: [] } });
      if (options.conversationWithoutLead) {
        return jsonResponse(200, {
          _embedded: {
            talks: [{
              talk_id: 501,
              contact_id: 11,
              chat_id: 'chat-1',
              entity_id: null,
              entity_type: null,
              updated_at: 200
            }]
          }
        });
      }
      return jsonResponse(200, {
        _embedded: {
          talks: [{
            talk_id: 501,
            contact_id: 11,
            chat_id: 'chat-1',
            entity_id: Number(options.conversationLeadId || 41),
            entity_type: 'lead',
            updated_at: 200,
            _embedded: {
              leads: [{ id: Number(options.conversationLeadId || 41) }],
              contacts: [{ id: 11 }]
            }
          }]
        }
      });
    }

    if (method === 'GET' && /^\/api\/v4\/contacts\/\d+$/.test(path)) {
      const leadIds = options.contactLeadIds || [Number(options.conversationLeadId || 41), 31, 32];
      return jsonResponse(200, {
        id: 11,
        _embedded: {
          leads: leadIds.map((id, index) => ({ id, name: `Lead ${id}`, updated_at: 1000 - index }))
        }
      });
    }

    if (method === 'PATCH' && path === '/api/v4/leads') {
      body.forEach((lead) => leadFields.set(Number(lead.id), lead.custom_fields_values || []));
      return jsonResponse(200, { _embedded: { leads: body } });
    }

    if (method === 'GET' && /^\/api\/v4\/leads\/\d+$/.test(path)) {
      const id = Number(path.split('/').pop());
      return jsonResponse(200, { id, custom_fields_values: leadFields.get(id) || [] });
    }

    if (method === 'POST' && path.includes('/api/v4/bots/')) {
      const leadId = Number(body?.entity_id || 0);
      if (Array.isArray(options.channelLinkedLeadIds) && !options.channelLinkedLeadIds.includes(leadId)) {
        return jsonResponse(400, { detail: 'Channel must be linked to your client, please setup channel first' });
      }
      if (options.launchBotError) return jsonResponse(500, { detail: 'No se pudo lanzar el bot' });
      return textResponse(202, 'Task to launch a bot has been successfully created');
    }

    return jsonResponse(404, { detail: `No mock for ${method} ${path}` });
  };
  fetch.calls = calls;
  return fetch;
}

test('mapea bots actuales', () => {
  assert.equal(botForWhatsappPayload({ type: 'confirmation' }, config), 102514);
  assert.equal(botForWhatsappPayload({ type: 'order_contact' }, config), 102516);
  assert.equal(botForWhatsappPayload({ type: 'flux', paymentMethod: 'Abonar al recibir' }, config), 102520);
  assert.equal(botForWhatsappPayload({ type: 'flux', paymentMethod: 'Mercado Pago', paymentStatus: 'aprobado' }, config), 102522);
  assert.equal(botForWhatsappPayload({ type: 'flux', paymentMethod: 'Transferencia', paymentStatus: 'pendiente' }, config), 102522);
  assert.equal(botForWhatsappPayload({ type: 'flux', paymentMethod: 'Transferencia', paymentStatus: 'pendiente', fluxCollectAmount: 15000 }, config), 102520);
  assert.equal(isFluxPaymentPending({ paymentStatus: 'pendiente' }), false);
  assert.equal(isFluxPaymentPending({ paymentMethod: 'Transferencia', paymentStatus: 'pendiente' }), false);
  assert.equal(isFluxPaymentPending({ paymentMethod: 'Abonar al recibir' }), true);
  assert.equal(isFluxPaymentPending({ paymentMethod: 'Transferencia', fluxCollectAmount: 15000 }), true);
  assert.deepEqual(createChatBotForWhatsappPayload({ type: 'order_contact' }, config), {
    type: 'order_contact',
    name: 'Contacto por pedido - crea chat',
    templateId: 66802,
    needsOrderFields: true
  });
  assert.deepEqual(createChatBotForWhatsappPayload({ type: 'confirmation' }, config), {
    type: 'confirmation',
    name: 'Confirmación de pedido – crea chat',
    templateId: 66800,
    needsOrderFields: true
  });
  assert.equal(createChatBotForWhatsappPayload({ type: 'flux', paymentMethod: 'Mercado Pago' }, config).templateId, 30876);
  assert.equal(createChatBotForWhatsappPayload({ type: 'flux', paymentMethod: 'Abonar al recibir' }, config).templateId, 66774);
});

test('normaliza telefonos argentinos', () => {
  assert.equal(normalizeWhatsappPhone('11 2854-1953'), '5491128541953');
  assert.equal(normalizeWhatsappPhone('+54 9 11 2854-1953'), '5491128541953');
});

test('Kommo 202 devuelve exito', async () => {
  const fetch = createMockFetch({ channelLinkedLeadIds: [41] });
  const service = new KommoService(config, { fetch });
  const result = await service.sendWhatsappTemplate({ to: '1128541953', type: 'order_contact', orderNumber: '7040', customerName: 'Martin' });
  assert.equal(result.status, 'launch_requested');
  assert.equal(result.message, 'Lanzamiento solicitado a Kommo');
  assert.equal(result.leadId, 41);
  assert.equal(result.botId, 103688);
});

test('confirmation y order_contact sobrescriben TN y Nombre TN en el lead operativo', async () => {
  const fetch = createMockFetch({ channelLinkedLeadIds: [41] });
  const service = new KommoService(config, { fetch });
  await service.sendWhatsappTemplate({ to: '1128541953', type: 'confirmation', orderNumber: '7040', customerName: 'Martin Perez' });
  const patch = fetch.calls.find((call) => call.request.method === 'PATCH' && new URL(call.url).pathname === '/api/v4/leads');
  assert.equal(patch.body[0].id, 41);
  assert.deepEqual(patch.body[0].custom_fields_values, [
    { field_id: 2443342, values: [{ value: '7040' }] },
    { field_id: 2443344, values: [{ value: 'Martin Perez' }] }
  ]);
});

test('Flux lanza el bot sin actualizar campos temporales', async () => {
  const fetch = createMockFetch({ channelLinkedLeadIds: [41] });
  const service = new KommoService(config, { fetch });
  await service.sendWhatsappTemplate({ to: '1128541953', type: 'flux', paymentMethod: 'Mercado Pago', paymentStatus: 'aprobado' });
  assert.equal(fetch.calls.some((call) => call.request.method === 'PATCH' && new URL(call.url).pathname === '/api/v4/leads'), false);
});

test('error de canal no realiza fallback a Meta', async () => {
  const fetch = createMockFetch({ channelLinkedLeadIds: [] });
  const service = new KommoService(config, { fetch });
  await assert.rejects(
    () => service.sendWhatsappTemplate({ to: '1128541953', type: 'order_contact', orderNumber: '7040', customerName: 'Martin' }),
    /Channel must be linked/
  );
  assert.equal(fetch.calls.some((call) => call.url.includes('graph.facebook.com')), false);
});

test('error de token no realiza fallback a Meta', async () => {
  const fetch = createMockFetch({ invalidToken: true });
  const service = new KommoService(config, { fetch });
  await assert.rejects(
    () => service.sendWhatsappTemplate({ to: '1128541953', type: 'order_contact', orderNumber: '7040', customerName: 'Martin' }),
    /autenticacion con Kommo/
  );
  assert.equal(fetch.calls.some((call) => call.url.includes('graph.facebook.com')), false);
});

test('timeout de Kommo no realiza fallback a Meta', async () => {
  const fetch = createMockFetch({ timeout: true });
  const service = new KommoService(config, { fetch });
  await assert.rejects(
    () => service.sendWhatsappTemplate({ to: '1128541953', type: 'order_contact', orderNumber: '7040', customerName: 'Martin' }),
    /Kommo timeout/
  );
  assert.equal(fetch.calls.some((call) => call.url.includes('graph.facebook.com')), false);
});

test('ningun lead operativo valido devuelve error y no envia nada por Meta', async () => {
  const fetch = createMockFetch({ contactLeadIds: [31, 32], channelLinkedLeadIds: [] });
  const service = new KommoService(config, { fetch });
  await assert.rejects(
    () => service.sendWhatsappTemplate({ to: '1128541953', type: 'confirmation', orderNumber: '7040', customerName: 'Martin' }),
    /Channel must be linked/
  );
  assert.equal(fetch.calls.some((call) => call.url.includes('graph.facebook.com')), false);
});

test('solapa manual crea contacto si no existia antes de intentar Kommo', async () => {
  const fetch = createMockFetch({ contactExists: false, contactLeadIds: [], createdLeadId: 88, channelLinkedLeadIds: [88] });
  const service = new KommoService(config, { fetch });
  const result = await service.sendWhatsappTemplate({
    to: '1161631786',
    type: 'order_contact',
    source: 'manual_tab',
    orderNumber: '8888',
    customerName: 'Mariano'
  });
  const createCall = fetch.calls.find((call) => call.request.method === 'POST' && new URL(call.url).pathname === '/api/v4/contacts');
  const leadCall = fetch.calls.find((call) => call.request.method === 'POST' && new URL(call.url).pathname === '/api/v4/leads');
  assert.ok(createCall);
  assert.ok(leadCall);
  assert.equal(createCall.body[0].name, 'Mariano');
  assert.equal(createCall.body[0].custom_fields_values[0].field_code, 'PHONE');
  assert.equal(leadCall.body[0]._embedded.contacts[0].is_main, true);
  assert.equal(result.contactCreated, true);
  assert.equal(result.leadCreated, true);
});

test('order_contact usa el Salesbot nuevo encontrado por nombre exacto', async () => {
  const fetch = createMockFetch({ contactLeadIds: [31, 32, 33], channelLinkedLeadIds: [31] });
  const service = new KommoService(config, { fetch });
  const result = await service.sendWhatsappTemplate({ to: '1128541953', type: 'order_contact', orderNumber: '7040', customerName: 'Martin' });
  const launches = fetch.calls.filter((call) => call.request.method === 'POST' && new URL(call.url).pathname.includes('/api/v4/bots/'));
  assert.equal(result.leadId, 31);
  assert.equal(result.botId, 103688);
  assert.match(new URL(launches[0].url).pathname, /\/api\/v4\/bots\/103688\/run$/);
  assert.deepEqual(launches.map((call) => call.body.entity_id), [31]);
});

test('usa nombre exacto unico si Kommo no expone template_id en el detalle', async () => {
  const fetch = createMockFetch({ hideTemplateIds: true, contactLeadIds: [31], channelLinkedLeadIds: [31] });
  const service = new KommoService(config, { fetch });
  const result = await service.sendWhatsappTemplate({ to: '1128541953', type: 'order_contact', orderNumber: '7040', customerName: 'Martin' });
  assert.equal(result.botId, 103688);
  assert.equal(result.status, 'launch_requested');
});

test('confirmation usa el Salesbot definitivo por nombre y template', async () => {
  const fetch = createMockFetch({ contactLeadIds: [31], channelLinkedLeadIds: [31] });
  const service = new KommoService(config, { fetch });
  const result = await service.sendWhatsappTemplate({ to: '1128541953', type: 'confirmation', orderNumber: '7040', customerName: 'Martin' });
  assert.equal(result.botId, 103704);
  assert.equal(result.status, 'launch_requested');
  assert.equal(result.fieldsVerified, true);
});

test('Flux abonado usa el Salesbot definitivo sin variables', async () => {
  const fetch = createMockFetch({ contactLeadIds: [31], channelLinkedLeadIds: [31] });
  const service = new KommoService(config, { fetch });
  const result = await service.sendWhatsappTemplate({ to: '1128541953', type: 'flux', paymentMethod: 'Mercado Pago', paymentStatus: 'aprobado' });
  assert.equal(result.botId, 103670);
  assert.equal(result.status, 'launch_requested');
  assert.equal(result.fieldsVerified, true);
  assert.equal(fetch.calls.some((call) => call.request.method === 'PATCH' && new URL(call.url).pathname === '/api/v4/leads'), false);
});

test('Flux sin abonar usa el Salesbot definitivo sin variables', async () => {
  const fetch = createMockFetch({ contactLeadIds: [31], channelLinkedLeadIds: [31] });
  const service = new KommoService(config, { fetch });
  const result = await service.sendWhatsappTemplate({ to: '1128541953', type: 'flux', paymentMethod: 'Abonar al recibir' });
  assert.equal(result.botId, 103702);
  assert.equal(result.status, 'launch_requested');
  assert.equal(result.fieldsVerified, true);
});

test('order_contact no prueba un segundo lead ni cae a Meta si falla el canal', async () => {
  const fetch = createMockFetch({ contactLeadIds: [31, 32], channelLinkedLeadIds: [32] });
  const service = new KommoService(config, { fetch });
  await assert.rejects(
    () => service.sendWhatsappTemplate({ to: '1128541953', type: 'order_contact', orderNumber: '7040', customerName: 'Martin' }),
    /Channel must be linked/
  );
  const launches = fetch.calls.filter((call) => call.request.method === 'POST' && new URL(call.url).pathname.includes('/api/v4/bots/'));
  assert.deepEqual(launches.map((call) => call.body.entity_id), [31]);
  assert.equal(fetch.calls.some((call) => call.url.includes('graph.facebook.com')), false);
});

test('dos envios consecutivos del mismo cliente pueden usar TN distintos', async () => {
  const fetch = createMockFetch({ channelLinkedLeadIds: [41] });
  const service = new KommoService({ ...config, duplicateWindowMs: 1 }, {
    fetch,
    now: (() => {
      let now = 1000;
      return () => {
        now += 1000;
        return now;
      };
    })()
  });
  await service.sendWhatsappTemplate({ to: '1128541953', type: 'order_contact', orderNumber: '7040', customerName: 'Martin' });
  await service.sendWhatsappTemplate({ to: '1128541953', type: 'order_contact', orderNumber: '8888', customerName: 'Gabriel' });
  const patches = fetch.calls.filter((call) => call.request.method === 'PATCH' && new URL(call.url).pathname === '/api/v4/leads');
  assert.equal(patches[0].body[0].custom_fields_values[0].values[0].value, '7040');
  assert.equal(patches[1].body[0].custom_fields_values[0].values[0].value, '8888');
});

test('proteccion de duplicados sigue siendo de dos minutos', async () => {
  const fetch = createMockFetch({ channelLinkedLeadIds: [41] });
  const service = new KommoService(config, { fetch });
  const first = await service.sendWhatsappTemplate({ to: '1128541953', type: 'order_contact', orderNumber: '7040', customerName: 'Martin' });
  const second = await service.sendWhatsappTemplate({ to: '1128541953', type: 'order_contact', orderNumber: '7040', customerName: 'Martin' });
  assert.equal(first.status, 'launch_requested');
  assert.equal(second.status, 'duplicate_avoided');
  assert.equal(config.duplicateWindowMs, 120000);
});

test('tracking continua por Meta', () => {
  assert.equal(chooseWhatsappEngine({ to: '1128541953', type: 'tracking' }, { defaultEngine: 'kommo' }), 'meta');
});

test('masivos de despachados compatibles usan Kommo y tracking sigue por Meta', () => {
  assert.equal(chooseWhatsappEngine({ to: '1128541953', type: 'flux', source: 'bulk_dispatched' }, { defaultEngine: 'meta' }), 'kommo');
  assert.equal(chooseWhatsappEngine({ to: '1128541953', type: 'tracking', source: 'bulk_dispatched' }, { defaultEngine: 'kommo' }), 'meta');
  assert.equal(chooseWhatsappEngine({ to: '1128541953', type: 'flux', forceMeta: true }, { defaultEngine: 'kommo' }), 'meta');
});

test('boton normal compatible usa Kommo y telefono fuera de allowlist no puede forzar prueba', () => {
  assert.equal(chooseWhatsappEngine({ to: '1128541953', type: 'order_contact' }, { defaultEngine: 'kommo' }), 'kommo');
  assert.equal(isPhoneAllowedForKommoTest('1128541953', '5491128541953'), true);
  assert.throws(
    () => assertKommoTestRequestAllowed(
      { to: '1100000000', type: 'order_contact', deliveryEngine: 'kommo_test' },
      { testEnabled: true, testPhoneAllowlist: '5491128541953' }
    ),
    /telefono no esta habilitado/
  );
});

test('envio masivo del frontend usa el motor actual y no fuerza Meta', () => {
  const appJs = fs.readFileSync(require.resolve('./public/app.js'), 'utf8');
  assert.match(appJs, /sendWhatsappTemplateForOrder\(order\.id,\s*\{\s*silent:\s*true,\s*source:\s*"bulk_dispatched"\s*\}\)/);
  assert.doesNotMatch(appJs, /sendWhatsappTemplateForOrder\(order\.id,\s*\{\s*silent:\s*true,\s*engine:\s*"meta",\s*forceMeta:\s*true\s*\}\)/);
});

test('solapa manual de WhatsApp identifica su origen para fallback controlado', () => {
  const appJs = fs.readFileSync(require.resolve('./public/app.js'), 'utf8');
  assert.match(appJs, /source:\s*"manual_tab"/);
  assert.match(appJs, /meta_fallback/);
});

test('fallback por canal de Kommo aplica a botones individuales y masivos compatibles', () => {
  const serverJs = fs.readFileSync(require.resolve('./server.js'), 'utf8');
  assert.match(serverJs, /function canFallbackKommoToMeta/);
  assert.match(serverJs, /isKommoCompatibleMessageType\(input\.type\)/);
  assert.doesNotMatch(serverJs, /function canFallbackManualKommoToMeta/);
  assert.doesNotMatch(serverJs, /if \(!isManualWhatsappTabRequest\(input\)\) return false/);
});

test('boton de preparacion muestra el motor real del envio', () => {
  const appJs = fs.readFileSync(require.resolve('./public/app.js'), 'utf8');
  assert.match(appJs, /window\.alert\(whatsappSendSuccessMessage\(data, payload\)\)/);
  assert.match(appJs, /whatsappOrderContactEngine:\s*data\.engine/);
  assert.doesNotMatch(appJs, /window\.alert\("Lanzamiento solicitado a Kommo\."\)/);
});

test('filtro DTF muestra armados pero descarga pendiente los excluye', () => {
  const appJs = fs.readFileSync(require.resolve('./public/app.js'), 'utf8');
  assert.match(appJs, /function orderHasDtfSku\(order\) \{\s*return orderItems\(order\)\.some\(\(item\) => isDtfSku\(item\.sku\)\);\s*\}/);
  assert.match(appJs, /items\.filter\(\(item\) => isDtfSku\(item\.sku\)\)/);
  assert.match(appJs, /function downloadDtfHtml\(\) \{\s*const rows = operationalOrders\(\)/);
  assert.match(appJs, /\.filter\(\(order\) => order\.status === "preparacion"\)/);
  assert.doesNotMatch(appJs, /\.filter\(orderCanHaveDtfPending\)/);
  assert.doesNotMatch(appJs, /return \["preparacion", "armado"\]\.includes\(order\.status\)/);
  assert.match(appJs, /\.filter\(\(item\) => isDtfSku\(item\.sku\) && detailItemStatus\(item\) !== "armado"\)/);
});

test('solo el boton individual presionado se deshabilita temporalmente', () => {
  const appJs = fs.readFileSync(require.resolve('./public/app.js'), 'utf8');
  assert.match(appJs, /const button = options\.button \|\| null/);
  assert.match(appJs, /button\.disabled = true/);
  assert.match(appJs, /button\.disabled = false/);
});

test('las tarjetas muestran editar en cualquier etapa operativa', () => {
  const appJs = fs.readFileSync(require.resolve('./public/app.js'), 'utf8');
  const renderOrderBody = appJs.match(/function renderOrder\(order\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.doesNotMatch(renderOrderBody, /order\.status === "preparacion"\s*\?\s*order\.recordType === "exchange"/);
  assert.match(renderOrderBody, /const editButton = order\.recordType === "exchange"/);
  assert.match(renderOrderBody, /data-edit-exchange="\$\{order\.id\}"/);
  assert.match(renderOrderBody, /data-edit="\$\{order\.id\}"/);
});

test('las tarjetas con cuatro acciones se acomodan en dos filas parejas', () => {
  const appJs = fs.readFileSync(require.resolve('./public/app.js'), 'utf8');
  assert.match(appJs, /actionsCount === 3 \? "three" : ""/);
  assert.doesNotMatch(appJs, /actionsCount >= 3 \? "three" : ""/);
});

test('la carga inicial del dashboard no dispara WhatsApp ni Kommo', () => {
  const appJs = fs.readFileSync(require.resolve('./public/app.js'), 'utf8');
  const initializeBody = appJs.match(/async function initializeApp\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.doesNotMatch(initializeBody, /sendWhatsappTemplate|sendConfirmationWhatsapp|\/api\/whatsapp\/send-template|Kommo/i);
});

test('Stock Estampas se sincroniza por backend y no expone el secreto en frontend', () => {
  const appJs = fs.readFileSync(require.resolve('./public/app.js'), 'utf8');
  const serverJs = fs.readFileSync(require.resolve('./server.js'), 'utf8');
  assert.match(serverJs, /app\.post\('\/api\/stamps\/transition'/);
  assert.match(serverJs, /X-Stamps-Api-Secret/);
  assert.match(serverJs, /AbortSignal\.timeout\(120000\)/);
  assert.doesNotMatch(appJs, /X-Stamps-Api-Secret|Incognito2026!/);
  assert.match(appJs, /fetch\("\/api\/stamps\/transition"/);
  assert.match(appJs, /usuario:\s*options\.usuario \|\| "sistema"/);
});

test('Stock Estampas usa eventos de armado, cancelacion y modificacion sin reversa automatica', () => {
  const appJs = fs.readFileSync(require.resolve('./public/app.js'), 'utf8');
  assert.match(appJs, /"preparacion_a_armado"/);
  assert.doesNotMatch(appJs, /"armado_a_preparacion"/);
  assert.match(appJs, /"cancelacion"/);
  assert.match(appJs, /"modificacion"/);
});

test('Stock Estampas usa el boton Armado por linea y no reenvia lo ya sincronizado', () => {
  const appJs = fs.readFileSync(require.resolve('./public/app.js'), 'utf8');
  assert.match(appJs, /const shouldSyncStampItem = nextStatus === "armado" && !currentItem\.printedGarmentId && isStampSku\(currentItem\.sku\)/);
  assert.match(appJs, /syncOrderStamps\(currentOrder, evento, \{\s*itemIndex: targetIndex\s*\}\)/);
  assert.match(appJs, /stampsSyncedAt: item\.stampsSyncedAt \|\| order\.stampsSyncedAt \|\| \(stampResult\?\.ok && !stampResult\.skipped \? timestamp : ""\)/);
  assert.match(appJs, /stampItemsForOrder\(currentOrder, \{ onlyUnsynced: true \}\)\.length > 0/);
  assert.match(appJs, /syncOrderStamps\(currentOrder, evento, \{ onlyUnsynced: true \}\)/);
  assert.match(appJs, /\.filter\(\(\{ item \}\) => !options\.onlyUnsynced \|\| !item\.stampsSyncedAt\)/);
});

test('Stock Estampas solo considera SKUs DTF o 3D y manda SKU original', () => {
  const appJs = fs.readFileSync(require.resolve('./public/app.js'), 'utf8');
  assert.match(appJs, /function isStampSku/);
  assert.match(appJs, /endsWith\("-dtf"\)/);
  assert.match(appJs, /endsWith\("-3d"\)/);
  assert.match(appJs, /sku:\s*String\(item\.sku/);
});

test('API de Stock Estampas expone DTF pendientes en JSON protegido', () => {
  const serverJs = fs.readFileSync(require.resolve('./server.js'), 'utf8');
  assert.match(serverJs, /app\.get\('\/api\/stamps\/pending-print'/);
  assert.match(serverJs, /req\.get\('x-stamps-api-secret'\)/);
  assert.match(serverJs, /stampsSecretMatches\(req\)/);
  assert.match(serverJs, /pendingPrintRowsFromState/);
  assert.match(serverJs, /order\.status === 'preparacion'/);
  assert.match(serverJs, /isPendingPrintDtfSku\(item\.sku\) && stampPendingItemStatus\(item\) !== 'armado'/);
  assert.match(serverJs, /itemRef:\s*`\$\{pedidoId\}:\$\{index \+ 1\}:\$\{sku\}:\$\{talle\}`/);
  assert.match(serverJs, /res\.json\(\{\s*ok:\s*true,[\s\S]*items:\s*pendingPrintRowsFromState\(state\)/);
});

test('Enviar Flux muestra estado, captura errores y solo cierra modal si envio correctamente', () => {
  const appJs = fs.readFileSync(require.resolve('./public/app.js'), 'utf8');
  assert.match(appJs, /async function sendFluxShipments\(selectedOrders, options = \{\}\)/);
  assert.match(appJs, /button\.textContent = "Enviando\.\.\."/);
  assert.match(appJs, /signal:\s*AbortSignal\.timeout\(120000\)/);
  assert.match(appJs, /await flushRemoteSaveNow\(\)/);
  assert.match(appJs, /return true/);
  assert.match(appJs, /catch \(error\)/);
  assert.match(appJs, /No pude enviar los pedidos a Flux/);
  assert.match(appJs, /const sent = await sendFluxShipments\(selectedOrders, \{ button: sendSelectedFlux \}\)/);
  assert.match(appJs, /if \(sent\) fluxDialog\.close\(\)/);
  assert.doesNotMatch(appJs, /if \(selectedOrders\.length\) fluxDialog\.close\(\)/);
});

test('Flux externo usa timeout largo y concurrencia controlada para lotes', () => {
  const serverJs = fs.readFileSync(require.resolve('./server.js'), 'utf8');
  assert.match(serverJs, /const FLUX_REQUEST_TIMEOUT_MS = Number\(process\.env\.FLUX_REQUEST_TIMEOUT_MS \|\| 60000\)/);
  assert.match(serverJs, /const FLUX_INSERT_CONCURRENCY = Math\.max\(1, Math\.min\(6, Number\(process\.env\.FLUX_INSERT_CONCURRENCY \|\| 2\)\)\)/);
  assert.match(serverJs, /const FLUX_INSERT_RETRIES = Math\.max\(0, Math\.min\(3, Number\(process\.env\.FLUX_INSERT_RETRIES \|\| 2\)\)\)/);
  assert.match(serverJs, /signal:\s*options\.signal \|\| AbortSignal\.timeout\(FLUX_REQUEST_TIMEOUT_MS\)/);
  assert.match(serverJs, /async function mapWithConcurrency/);
  assert.match(serverJs, /mapWithConcurrency\(shipments, FLUX_INSERT_CONCURRENCY/);
  assert.match(serverJs, /Flux tardo demasiado en responder para este pedido/);
  assert.match(serverJs, /function looksLikeHtml/);
  assert.match(serverJs, /function conciseFluxHttpError/);
  assert.match(serverJs, /isFluxTemporaryFailure\(result\)/);
  assert.match(serverJs, /Lightdata devolvio/);
  assert.match(serverJs, /rawText:\s*looksLikeHtml\(result\.rawText\) \? '' : result\.rawText/);
});

test('Flux corrige localidad con base local de CP para Buenos Aires y CABA', () => {
  const appJs = fs.readFileSync(require.resolve('./public/app.js'), 'utf8');
  const localities = JSON.parse(fs.readFileSync(require.resolve('./public/data/flux-localities-ba-caba.json'), 'utf8'));
  assert.equal(localities.provinces['Buenos Aires']['1900'][0], 'LA PLATA');
  assert.equal(localities.provinces.CABA['1424'][0], 'Ciudad Autonoma de Buenos Aires');
  assert.match(appJs, /fetch\("\/data\/flux-localities-ba-caba\.json"/);
  assert.match(appJs, /function correctedFluxLocality\(order\)/);
  assert.match(appJs, /localidad: locality/);
  assert.match(appJs, /await ensureFluxPostalLocalitiesLoaded\(\)/);
});

test('SharePoint guarda el Excel historico y un backup completo JSON en la misma carpeta', () => {
  const serverJs = fs.readFileSync(require.resolve('./server.js'), 'utf8');
  const appJs = fs.readFileSync(require.resolve('./public/app.js'), 'utf8');
  assert.match(serverJs, /const SHAREPOINT_FULL_BACKUP_PATH = \(process\.env\.SHAREPOINT_FULL_BACKUP_PATH \|\| path\.posix\.join\(path\.posix\.dirname\(SHAREPOINT_BACKUP_PATH\), 'backup-completo-incognito-ventas\.json'\)\)/);
  assert.match(serverJs, /function buildFullAppBackupBuffer\(state = \{\}\)/);
  assert.match(serverJs, /type:\s*'incognito-ventas-full-backup'/);
  assert.match(serverJs, /buildFullAppBackupBuffer\(state\)/);
  assert.match(serverJs, /fullBackupFilename: SHAREPOINT_FULL_BACKUP_PATH\.split/);
  assert.match(serverJs, /fullBackupWebUrl: result\.fullBackupItem\?\.webUrl/);
  assert.match(serverJs, /\+ \$\{result\.fullBackupFilename\}/);
  assert.match(appJs, /Backup completo: \$\{data\.fullBackupFilename/);
});

test('Precios SKU filtra pendientes por prefijo y permite buscar/editar cargados', () => {
  const html = fs.readFileSync(require.resolve('./public/index.html'), 'utf8');
  const appJs = fs.readFileSync(require.resolve('./public/app.js'), 'utf8');
  assert.match(html, /id="skuPrefixPriceForm"/);
  assert.match(html, /id="skuPrefixFilter"/);
  assert.match(html, /id="skuLoadedSearch"/);
  assert.match(html, /SKU sin costo cargado/);
  assert.match(html, /Precios cargados/);
  assert.match(appJs, /function skuPrefixKey/);
  assert.match(appJs, /function missingSkuRows/);
  assert.match(appJs, /function saveSkuPrefixPrice/);
  assert.match(appJs, /const matchingSkus = missingSkuRows\(\)\.map\(\(row\) => row\.sku\)/);
  assert.match(appJs, /orders = orders\.map\(\(order\) => applyPurchasePriceToOrder\(order, \(itemSku\) => matchingKeys\.has\(normalize\(itemSku\)\), purchasePrice\)\)/);
  assert.match(appJs, /backupRows = backupRows\.map\(\(row\) => matchingKeys\.has\(normalize\(row\.sku\)\) \? \{ \.\.\.row, purchasePrice \} : row\)/);
  assert.match(appJs, /skuPrefixPriceForm\?\.addEventListener\("submit"/);
  assert.match(appJs, /skuPrefixFilterInput\?\.addEventListener\("input"/);
  assert.match(appJs, /skuLoadedSearchInput\?\.addEventListener\("input"/);
  assert.match(appJs, /data-edit-sku-price/);
  assert.doesNotMatch(appJs, /sales-sku-prefix-prices/);
});

test('Prendas estampadas se guardan aparte y evitan descuentos duplicados', () => {
  const html = fs.readFileSync(require.resolve('./public/index.html'), 'utf8');
  const appJs = fs.readFileSync(require.resolve('./public/app.js'), 'utf8');
  const serverJs = fs.readFileSync(require.resolve('./server.js'), 'utf8');
  assert.match(html, /data-view="prendas-estampadas"/);
  assert.match(html, /id="printedGarmentForm"/);
  assert.match(html, /id="printedGarmentImage"/);
  assert.match(html, /id="cancelPrintedGarmentEdit"/);
  assert.match(html, /id="printedGarmentBody"/);
  assert.match(appJs, /let printedGarments = load\("sales-printed-garments", \[\]\)/);
  assert.match(appJs, /let deletedPrintedGarmentIds = load\("sales-deleted-printed-garments", \[\]\)/);
  assert.match(appJs, /printedGarments,\s*\n\s*deletedPrintedGarmentIds,\s*\n\s*skuPrices/);
  assert.match(appJs, /deletedPrintedGarmentIds/);
  assert.match(appJs, /function printedGarmentMatchKey/);
  assert.match(appJs, /function orderHasAvailablePrintedGarment/);
  assert.match(appJs, /data-use-printed-garment/);
  assert.match(appJs, /async function usePrintedGarmentForItem/);
  assert.match(appJs, /function startEditPrintedGarment/);
  assert.match(appJs, /function duplicatePrintedGarment/);
  assert.match(appJs, /data-edit-printed-garment/);
  assert.match(appJs, /data-duplicate-printed-garment/);
  assert.match(appJs, /Guardar cambios/);
  assert.match(appJs, /cancelPrintedGarmentEdit\?\.addEventListener\("click", resetPrintedGarmentForm\)/);
  assert.match(appJs, /async function savePrintedGarmentUseNow/);
  assert.match(appJs, /printedGarments: \[garment\]/);
  assert.match(appJs, /await savePrintedGarmentUseNow\(updatedOrder, usedGarment\)/);
  assert.match(appJs, /const currentUsed = Boolean\(current\.usedAt \|\| current\.usedOrderId\)/);
  assert.match(appJs, /if \(currentUsed && !incomingUsed\) return \{ \.\.\.incoming, \.\.\.current \}/);
  assert.match(appJs, /data-restore-printed-garment/);
  assert.match(appJs, /data-delete-printed-garment/);
  assert.match(appJs, /deletedPrintedGarmentIds = mergeUniqueStrings\(deletedPrintedGarmentIds, \[deleteKey\]\)/);
  assert.match(appJs, /\.filter\(\(item\) => !item\.printedGarmentId && !item\.stockDeductedAt\)/);
  assert.match(appJs, /\.filter\(\(\{ item \}\) => !item\.printedGarmentId\)/);
  assert.match(appJs, /const shouldSyncStampItem = nextStatus === "armado" && !currentItem\.printedGarmentId/);
  assert.match(appJs, /if \(item\.printedGarmentId \|\| item\.stockDeductedAt \|\| order\.stockDeductedAt\)/);
  assert.match(appJs, /printedGarmentId: "",\s*printedGarmentUsedAt: ""/);
  assert.match(serverJs, /function mergePrintedGarmentState/);
  assert.match(serverJs, /printedGarments: mergePrintedGarments/);
  assert.match(serverJs, /function mergeDeletedPrintedGarmentIds/);
  assert.match(serverJs, /deletedPrintedGarmentIds/);
});

test('En proceso permite filtrar pedidos con prendas ya marcadas dentro', () => {
  const html = fs.readFileSync(require.resolve('./public/index.html'), 'utf8');
  const appJs = fs.readFileSync(require.resolve('./public/app.js'), 'utf8');
  assert.match(html, /id="pickedFilter"/);
  assert.match(html, />Con prendas dentro</);
  assert.match(appJs, /let pickedFilterActive = false/);
  assert.match(appJs, /function orderHasPickedItem\(order\)/);
  assert.match(appJs, /\["separado", "armado"\]\.includes\(detailItemStatus\(item\)\)/);
  assert.match(appJs, /if \(pickedFilterActive && !orderHasPickedItem\(order\)\) return false/);
  assert.match(appJs, /pickedFilter\.classList\.toggle\("active", pickedFilterActive\)/);
});
