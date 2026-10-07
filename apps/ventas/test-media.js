'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMediaOffloader } = require('./lib/media.js');

test('detecta fotos inline sin recorrerlas con el conversor completo', () => {
  const offloader = createMediaOffloader({});
  const inline = `data:image/png;base64,${'a'.repeat(220)}`;

  assert.equal(offloader.hasInlineImages({ orders: [{ items: [{ imageUrl: inline }] }] }), true);
  assert.equal(offloader.hasInlineImages({ orders: [{ items: [{ imageUrl: 'https://example.com/foto.png' }] }] }), false);
});
