const test = require('node:test');
const assert = require('node:assert/strict');

const app = require('./server');
const { mergeAppState } = app.__ventasRowStorageTestHelpers;

test('a stale dismissal cannot remove an explicitly recovered store order', () => {
  const order = {
    id: 'order-10289',
    storeOrderNumber: '10289',
    internalOrderNumber: '9589',
    customer: 'Valentin Peluffo',
    status: 'preparacion'
  };

  const currentState = {
    orders: [order],
    dismissedStoreOrders: [],
    recoveredStoreOrders: ['10289']
  };
  const staleBrowserState = {
    orders: [],
    dismissedStoreOrders: ['10289'],
    recoveredStoreOrders: []
  };

  const merged = mergeAppState(staleBrowserState, currentState);

  assert.equal(merged.orders.length, 1);
  assert.equal(merged.orders[0].storeOrderNumber, '10289');
  assert.deepEqual(merged.dismissedStoreOrders, []);
  assert.deepEqual(merged.recoveredStoreOrders, ['10289']);
});

test('an explicit later deletion still wins through the current order id', () => {
  const order = {
    id: 'order-10289',
    storeOrderNumber: '10289',
    internalOrderNumber: '9589',
    status: 'preparacion'
  };

  const merged = mergeAppState({
    orders: [],
    dismissedStoreOrders: ['10289'],
    dismissedOrderIds: ['order-10289'],
    recoveredStoreOrders: []
  }, {
    orders: [order],
    dismissedStoreOrders: [],
    dismissedOrderIds: [],
    recoveredStoreOrders: ['10289']
  });

  assert.deepEqual(merged.orders, []);
  assert.deepEqual(merged.dismissedStoreOrders, []);
  assert.deepEqual(merged.dismissedOrderIds, ['order-10289']);
});
