'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('./server');

const buildTransaction = app.locals.buildContableSalesTransaction;

test('Transferencia AD se carga como Venta de producto en Uala AD', () => {
  const row = buildTransaction({
    orderId: 'order-1', internalNumber: '9201', date: '2026-09-14',
    customer: 'Cliente AD', paymentMethod: 'Transferencia', account: 'AD', amount: 43100
  });
  assert.equal(row.categoria, 'Venta de producto');
  assert.equal(row.cuenta, 'Uala AD');
  assert.equal(row.nro_interno, '9201');
  assert.equal(row.ingreso, 43100);
  assert.equal(row.pendiente, false);
});

test('Transferencia EG se carga en Uala EG', () => {
  const row = buildTransaction({
    orderId: 'order-2', internalNumber: '9202', date: '2026-09-14',
    customer: 'Cliente EG', paymentMethod: 'Transferencia', account: 'EG', amount: 68998
  });
  assert.equal(row.cuenta, 'Uala EG');
  assert.equal(row.ingreso, 68998);
});

test('Abonar al recibir se carga en Flux pendiente y sin monto', () => {
  const row = buildTransaction({
    orderId: 'order-3', internalNumber: '9203', date: '2026-09-14',
    customer: 'Cliente Flux', paymentMethod: 'Abonar al recibir', account: 'EG', amount: 99999
  });
  assert.equal(row.cuenta, 'Flux');
  assert.equal(row.ingreso, 0);
  assert.equal(row.pendiente, true);
});

test('La misma venta conserva su ID para no duplicarse al reintentar', () => {
  const base = {
    orderId: 'same-order', internalNumber: '9204', date: '2026-09-14',
    customer: 'Cliente', paymentMethod: 'Transferencia', account: 'AD'
  };
  assert.equal(buildTransaction({ ...base, amount: 10000 }).id, buildTransaction({ ...base, amount: 12000 }).id);
});

test('Una transferencia sin monto se rechaza antes de escribir en Contable', () => {
  assert.throws(() => buildTransaction({
    orderId: 'order-5', internalNumber: '9205', date: '2026-09-14',
    customer: 'Cliente', paymentMethod: 'Transferencia', account: 'EG', amount: 0
  }), /mayor a cero/);
});

test('Ventas pide monto solo para transferencias y espera la confirmacion contable', () => {
  const source = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
  assert.match(html, /id="accountingSaleDialog"/);
  assert.match(source, /payment === "transferencia" \|\| payment === "abonar al recibir"/);
  assert.match(source, /accountingResult = await saveAccountingSale/);
  assert.match(source, /accountingSaleAmountField\.hidden = !info\.requiresAmount/);
});

test('Abonar al recibir pasa a preparacion aunque Contable falle', () => {
  const source = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  assert.match(source, /normalize\(approvedOrder\.paymentMethod\) !== "abonar al recibir"/);
  assert.match(source, /accountingSyncPending: true/);
  assert.match(source, /El pedido paso a preparacion, pero Contable no pudo registrar Flux/);
});
