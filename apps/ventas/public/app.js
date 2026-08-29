const processStatuses = [
  { id: "preparacion", label: "En preparacion" },
  { id: "armado", label: "Armado" },
  { id: "rotulado", label: "Rotulado" },
  { id: "despachado", label: "Despachado" }
];

const backupHeaders = [
  "",
  "FECHA",
  "SKU",
  "CANT",
  "CV",
  "Total C",
  "PV",
  "Total PV",
  "Medio",
  "Cuenta",
  "Envio",
  "Medio de Envio",
  "Medio de Venta",
  "Comision",
  "Ganancia",
  "Cliente",
  "CP",
  "Factura",
  "Color",
  "Talle",
  "Estado",
  "Cancelado",
  "Notas"
];

const accountCommissionRates = {
  FB: 9.8,
  MV: 9.8,
  EG: 0,
  AD: 0,
  Flux: 0
};

const fluxZoneCosts = {
  0: 4200,
  1: 5300,
  2: 8000,
  3: 9000
};

const fluxZoneNames = {
  0: "CABA",
  1: "Primer cordon",
  2: "Segundo cordon",
  3: "Tercer cordon"
};

resetLocalDataIfRequested();

let accountSettings = load("sales-account-settings", {
  mercadoPago: "FB",
  transfer: "EG"
});
let skuPrices = load("sales-sku-prices", {});

// ── Demo de muestra (fallback cuando el backend no está disponible) ────────────
const storeSample = [
  createOrder({
    storeOrderNumber: "1047",
    customer: "Mariana Lopez",
    sku: "SET-LISBOA-NEG",
    color: "Negro",
    size: "Unico",
    purchasePrice: 8500,
    salePrice: 16400,
    quantity: 2,
    shippingValue: 2900,
    shippingCompany: "Correo Argentino",
    salesChannel: "Tienda Nube",
    account: "EG",
    postalCode: "9011",
    invoice: "No",
    paymentMethod: "Mercado Pago",
    paymentStatus: "aprobado",
    notes: "Pago aprobado automaticamente."
  }),
  createOrder({
    storeOrderNumber: "1048",
    customer: "Agustin Rios",
    sku: "BOLSO-TERRA-SU",
    color: "Suela",
    size: "Unico",
    purchasePrice: 12000,
    salePrice: 23900,
    quantity: 1,
    shippingValue: 3200,
    shippingCompany: "Andreani",
    salesChannel: "Tienda Nube",
    account: "EG",
    postalCode: "9011",
    invoice: "No",
    paymentMethod: "Transferencia",
    paymentStatus: "pendiente",
    notes: "Revisar comprobante antes de preparar."
  }),
  createOrder({
    storeOrderNumber: "1049",
    customer: "Carla Pereyra",
    sku: "MOCH-OSAKA-ROJ-M",
    color: "Rojo",
    size: "M",
    purchasePrice: 14600,
    salePrice: 28500,
    quantity: 1,
    shippingValue: 4200,
    shippingCompany: "Flux",
    salesChannel: "Tienda Nube",
    account: "EG",
    postalCode: "9011",
    invoice: "No",
    paymentMethod: "Abonar al recibir",
    paymentStatus: "pendiente",
    notes: "Entra aunque el pago figure pendiente."
  })
];

let orders = load("sales-orders", []);
let exchanges = load("sales-exchanges", []);

let backupRows = load("sales-backup", []);
let stockLogRows = load("sales-stock-log", []);
let printedGarments = load("sales-printed-garments", []);
let deletedPrintedGarmentIds = load("sales-deleted-printed-garments", []);
let dismissedStoreOrders = load("sales-dismissed-store-orders", []);
let dismissedOrderIds = load("sales-dismissed-order-ids", []);
let recoveredStoreOrders = load("sales-recovered-store-orders", []);
let removedBackupInternalNumbers = load("sales-removed-backup-internals", []);
let removedBackupRowIds = load("sales-removed-backup-row-ids", []);
let internalSequence = Number(localStorage.getItem("sales-internal-sequence") || 5999);
let shippingFilter = "todos";
let paymentFilter = "todos";
let processPaymentFilter = "todos";
let preparationSort = "oldest";
let skuFilter = "todos";
let dtfFilterActive = false;
let pickedFilterActive = false;
let dispatchedWhatsappFilter = "todos";
let backupMode = "today";
let pendingSearch = "";
let processSearch = "";
let activeView = "definir";
let editingOrderId = "";
let editingOriginalOrderType = "";
let editingExchangeId = "";
let stockItems = [];
let stockItemsPromise = null;
let fluxPostalLocalities = null;
let fluxPostalLocalitiesPromise = null;
let remoteStateReady = false;
let remoteSaveTimer = 0;
let remoteSaveInFlight = false;
let remoteSaveQueued = false;
let remoteSaveDirty = false;
let remoteRefreshInFlight = false;
let lastLocalSavedAt = localStorage.getItem("sales-saved-at") || "";
let manualSubmitInProgress = false;
let skuPrefixFilterValue = "";
let skuLoadedSearchValue = "";

const board = document.querySelector("#board");
const pendingList = document.querySelector("#pendingList");
const pendingSearchInput = document.querySelector("#pendingSearch");
const processSearchInput = document.querySelector("#processSearch");
const syncStore = document.querySelector("#syncStore");
const singleTnImportForm = document.querySelector("#singleTnImportForm");
const singleTnImportInput = document.querySelector("#singleTnImportInput");
const singleTnImportButton = document.querySelector("#singleTnImportButton");
const singleTnExchangeButton = document.querySelector("#singleTnExchangeButton");
const openManual = document.querySelector("#openManual");
const openExchange = document.querySelector("#openExchange");
const manualDialog = document.querySelector("#manualDialog");
const manualForm = document.querySelector("#manualForm");
const manualFluxCollectField = document.querySelector("#manualFluxCollectField");
const manualFluxAddressFields = document.querySelector("#manualFluxAddressFields");
const exchangeDialog = document.querySelector("#exchangeDialog");
const exchangeForm = document.querySelector("#exchangeForm");
const exchangeFluxAddressFields = document.querySelector("#exchangeFluxAddressFields");
const closeExchange = document.querySelector("#closeExchange");
const cancelExchange = document.querySelector("#cancelExchange");
const exchangeSubmit = document.querySelector("#exchangeSubmit");
const closeManual = document.querySelector("#closeManual");
const cancelManual = document.querySelector("#cancelManual");
const manualSubmit = document.querySelector("#manualSubmit");
const downloadBackup = document.querySelector("#downloadBackup");
const downloadBackupHistory = document.querySelector("#downloadBackupHistory");
const downloadFullStateBackup = document.querySelector("#downloadFullStateBackup");
const uploadSharePointHistory = document.querySelector("#uploadSharePointHistory");
const backupTitle = document.querySelector("#backupTitle");
const backupDescription = document.querySelector("#backupDescription");
const backupTodayCount = document.querySelector("#backupTodayCount");
const backupCancelledCount = document.querySelector("#backupCancelledCount");
const backupHead = document.querySelector("#backupHead");
const backupBody = document.querySelector("#backupBody");
const fluxSettlementForm = document.querySelector("#fluxSettlementForm");
const fluxSettlementInput = document.querySelector("#fluxSettlementInput");
const clearFluxSettlement = document.querySelector("#clearFluxSettlement");
const stockLogBody = document.querySelector("#stockLogBody");
const exchangeBody = document.querySelector("#exchangeBody");
const printedGarmentForm = document.querySelector("#printedGarmentForm");
const printedGarmentBody = document.querySelector("#printedGarmentBody");
const printedGarmentImage = document.querySelector("#printedGarmentImage");
const cancelPrintedGarmentEdit = document.querySelector("#cancelPrintedGarmentEdit");
const whatsappTemplateForm = document.querySelector("#whatsappTemplateForm");
const whatsappTemplateSubmit = document.querySelector("#whatsappTemplateSubmit");
const whatsappTemplateStatus = document.querySelector("#whatsappTemplateStatus");
const skuFilterSelect = document.querySelector("#skuFilter");
const dtfFilter = document.querySelector("#dtfFilter");
const pickedFilter = document.querySelector("#pickedFilter");
const pendingProducts = document.querySelector("#pendingProducts");
const andreaniLabels = document.querySelector("#andreaniLabels");
const andreaniDialog = document.querySelector("#andreaniDialog");
const andreaniDialogCount = document.querySelector("#andreaniDialogCount");
const andreaniSelectAll = document.querySelector("#andreaniSelectAll");
const andreaniSelectList = document.querySelector("#andreaniSelectList");
const closeAndreaniDialog = document.querySelector("#closeAndreaniDialog");
const cancelAndreaniLabels = document.querySelector("#cancelAndreaniLabels");
const downloadSelectedAndreani = document.querySelector("#downloadSelectedAndreani");
const fluxShipments = document.querySelector("#fluxShipments");
const fluxDialog = document.querySelector("#fluxDialog");
const fluxDialogCount = document.querySelector("#fluxDialogCount");
const fluxSelectAll = document.querySelector("#fluxSelectAll");
const fluxSelectList = document.querySelector("#fluxSelectList");
const closeFluxDialog = document.querySelector("#closeFluxDialog");
const cancelFluxShipments = document.querySelector("#cancelFluxShipments");
const sendSelectedFlux = document.querySelector("#sendSelectedFlux");
const bulkLabelDialog = document.querySelector("#bulkLabelDialog");
const bulkLabelCount = document.querySelector("#bulkLabelCount");
const bulkLabelSelectAll = document.querySelector("#bulkLabelSelectAll");
const bulkLabelList = document.querySelector("#bulkLabelList");
const closeBulkLabelDialog = document.querySelector("#closeBulkLabelDialog");
const cancelBulkLabel = document.querySelector("#cancelBulkLabel");
const confirmBulkLabel = document.querySelector("#confirmBulkLabel");
const mpReviewDialog = document.querySelector("#mpReviewDialog");
const mpReviewCount = document.querySelector("#mpReviewCount");
const mpReviewText = document.querySelector("#mpReviewText");
const closeMpReviewDialog = document.querySelector("#closeMpReviewDialog");
const cancelMpReview = document.querySelector("#cancelMpReview");
const copyMpReview = document.querySelector("#copyMpReview");
const dtfActionDialog = document.querySelector("#dtfActionDialog");
const closeDtfActionDialog = document.querySelector("#closeDtfActionDialog");
const downloadDtfPending = document.querySelector("#downloadDtfPending");
const applyDtfFilter = document.querySelector("#applyDtfFilter");
const clearDispatched = document.querySelector("#clearDispatched");
const mercadoPagoAccount = document.querySelector("#mercadoPagoAccount");
const transferAccount = document.querySelector("#transferAccount");
const skuPriceForm = document.querySelector("#skuPriceForm");
const skuPrefixPriceForm = document.querySelector("#skuPrefixPriceForm");
const skuPrefixFilterInput = document.querySelector("#skuPrefixFilter");
const clearSkuPrefixFilter = document.querySelector("#clearSkuPrefixFilter");
const skuLoadedSearchInput = document.querySelector("#skuLoadedSearch");
const skuPriceBody = document.querySelector("#skuPriceBody");
const missingSkuBody = document.querySelector("#missingSkuBody");
const skuOptions = document.querySelector("#skuOptions");
const orderTypeButtons = document.querySelectorAll("[data-order-type]");
const wholesaleHint = document.querySelector("#wholesaleHint");
const wholesaleItems = document.querySelector("#wholesaleItems");
const wholesaleRows = document.querySelector("#wholesaleRows");
const addWholesaleItem = document.querySelector("#addWholesaleItem");
const addWholesaleCurve = document.querySelector("#addWholesaleCurve");
const importWholesaleLink = document.querySelector("#importWholesaleLink");
const applyWholesaleShipping = document.querySelector("#applyWholesaleShipping");
const wholesaleEntryImage = document.querySelector("#wholesaleEntryImage");
const retailImage = document.querySelector("#retailImage");
const retailRows = document.querySelector("#retailRows");
const addRetailItem = document.querySelector("#addRetailItem");
const exchangeRows = document.querySelector("#exchangeRows");
const addExchangeItem = document.querySelector("#addExchangeItem");
const exchangeEntryImage = document.querySelector("#exchangeEntryImage");
const exchangeEntryImageFile = document.querySelector("#exchangeEntryImageFile");
const retailFields = document.querySelectorAll(".retail-field");
let retailImageData = "";
let wholesaleEntryImageData = "";
let exchangeEntryImageData = "";
let printedGarmentImageData = "";
let editingPrintedGarmentId = "";
const orderDetailDialog = document.querySelector("#orderDetailDialog");
const orderDetailBody = document.querySelector("#orderDetailBody");
const orderDetailActions = document.querySelector("#orderDetailActions");
const imagePreviewDialog = document.querySelector("#imagePreviewDialog");
const imagePreview = document.querySelector("#imagePreview");
const closeImagePreview = document.querySelector("#closeImagePreview");
const closeDetail = document.querySelector("#closeDetail");

function today() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date()).reduce((dateParts, part) => {
    dateParts[part.type] = part.value;
    return dateParts;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function resetLocalDataIfRequested() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("reset") !== "ventas") return;

  [
    "sales-orders",
    "sales-backup",
    "sales-stock-log",
    "sales-saved-at",
    "sales-internal-sequence",
    "sales-account-settings",
    "sales-dismissed-store-orders",
    "sales-dismissed-order-ids"
  ].forEach((key) => localStorage.removeItem(key));

  localStorage.setItem("sales-reset-sales-requested", "1");
}

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function markLocalSavedAt(timestamp = new Date().toISOString()) {
  lastLocalSavedAt = timestamp;
  safeLocalSet("sales-saved-at", timestamp);
  return timestamp;
}

function safeLocalSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn(`No se pudo guardar ${key} en este navegador. Se conserva el guardado remoto.`, error);
  }
}

function save() {
  markLocalSavedAt();
  safeLocalSet("sales-orders", JSON.stringify(orders));
  safeLocalSet("sales-exchanges", JSON.stringify(exchanges));
  safeLocalSet("sales-backup", JSON.stringify(backupRows));
  safeLocalSet("sales-stock-log", JSON.stringify(stockLogRows));
  safeLocalSet("sales-printed-garments", JSON.stringify(printedGarments));
  safeLocalSet("sales-deleted-printed-garments", JSON.stringify(deletedPrintedGarmentIds));
  safeLocalSet("sales-sku-prices", JSON.stringify(skuPrices));
  safeLocalSet("sales-internal-sequence", String(internalSequence));
  safeLocalSet("sales-account-settings", JSON.stringify(accountSettings));
  safeLocalSet("sales-dismissed-store-orders", JSON.stringify(dismissedStoreOrders));
  safeLocalSet("sales-dismissed-order-ids", JSON.stringify(dismissedOrderIds));
  safeLocalSet("sales-recovered-store-orders", JSON.stringify(recoveredStoreOrders));
  safeLocalSet("sales-removed-backup-internals", JSON.stringify(removedBackupInternalNumbers));
  safeLocalSet("sales-removed-backup-row-ids", JSON.stringify(removedBackupRowIds));
  scheduleRemoteSave();
}

function currentAppState() {
  return {
    orders,
    exchanges,
    backupRows,
    stockLogRows,
    printedGarments,
    deletedPrintedGarmentIds,
    skuPrices,
    internalSequence,
    accountSettings,
    dismissedStoreOrders,
    dismissedOrderIds,
    recoveredStoreOrders,
    removedBackupInternalNumbers,
    removedBackupRowIds,
    savedAt: lastLocalSavedAt || markLocalSavedAt()
  };
}

function salesResetWasRequested() {
  const params = new URLSearchParams(window.location.search);
  return params.get("reset") === "ventas" || localStorage.getItem("sales-reset-sales-requested") === "1";
}

function clearSalesStateOnly() {
  orders = [];
  backupRows = [];
  stockLogRows = [];
  dismissedStoreOrders = [];
  dismissedOrderIds = [];
  recoveredStoreOrders = [];
  internalSequence = 5999;
}

async function resetSalesStateIfRequested() {
  if (!salesResetWasRequested()) return false;
  clearSalesStateOnly();
  saveLocalOnly();
  await saveRemoteState({ replace: true });
  localStorage.removeItem("sales-reset-sales-requested");
  window.alert("Ventas reseteadas. Se conservaron precios SKU, prendas estampadas y configuracion.");
  window.location.replace(window.location.pathname);
  return true;
}

function applyAppState(state) {
  if (!state || typeof state !== "object") return false;
  orders = Array.isArray(state.orders) ? state.orders.map(splitRepeatedStoreOrderItems) : [];
  exchanges = Array.isArray(state.exchanges) ? state.exchanges : [];
  backupRows = Array.isArray(state.backupRows) ? state.backupRows : [];
  stockLogRows = Array.isArray(state.stockLogRows) ? state.stockLogRows : [];
  deletedPrintedGarmentIds = Array.isArray(state.deletedPrintedGarmentIds) ? state.deletedPrintedGarmentIds : [];
  printedGarments = (Array.isArray(state.printedGarments) ? state.printedGarments : [])
    .filter((garment) => !deletedPrintedGarmentIds.includes(String(garment.id || printedGarmentMatchKey(garment)).trim()));
  skuPrices = state.skuPrices && typeof state.skuPrices === "object" ? state.skuPrices : {};
  internalSequence = Number(state.internalSequence || 5999);
  accountSettings = {
    mercadoPago: state.accountSettings?.mercadoPago || "FB",
    transfer: state.accountSettings?.transfer || "EG"
  };
  dismissedStoreOrders = Array.isArray(state.dismissedStoreOrders) ? state.dismissedStoreOrders : [];
  dismissedOrderIds = Array.isArray(state.dismissedOrderIds) ? state.dismissedOrderIds : [];
  recoveredStoreOrders = Array.isArray(state.recoveredStoreOrders) ? state.recoveredStoreOrders : [];
  removedBackupInternalNumbers = Array.isArray(state.removedBackupInternalNumbers) ? state.removedBackupInternalNumbers : [];
  removedBackupRowIds = Array.isArray(state.removedBackupRowIds) ? state.removedBackupRowIds : [];
  return true;
}

function hasLocalBusinessState() {
  return orders.length > 0 ||
    exchanges.length > 0 ||
    backupRows.length > 0 ||
    stockLogRows.length > 0 ||
    printedGarments.length > 0 ||
    deletedPrintedGarmentIds.length > 0 ||
    dismissedStoreOrders.length > 0 ||
    dismissedOrderIds.length > 0 ||
    recoveredStoreOrders.length > 0 ||
    Object.keys(skuPrices).length > 0;
}

function timestampValue(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function orderKey(order = {}) {
  return String(order.id || order.internalOrderNumber || order.storeOrderNumber || "").trim();
}

function orderRankValue(order = {}) {
  const rank = processStatuses.findIndex((status) => status.id === order.status);
  return rank >= 0 ? rank : -1;
}

function orderTimeValue(order = {}) {
  return Math.max(
    timestampValue(order.updatedAt),
    timestampValue(order.statusUpdatedAt),
    timestampValue(order.stockDeductedAt),
    timestampValue(order.stockBypassedAt),
    timestampValue(order.fluxSentAt),
    timestampValue(order.approvedAt),
    timestampValue(order.insertedAt),
    timestampValue(order.purchasedAt)
  );
}

function mergeSyncedOrder(localOrder = {}, remoteOrder = {}) {
  const localCancelled = Boolean(localOrder.cancelled || localOrder.status === "cancelado");
  const remoteCancelled = Boolean(remoteOrder.cancelled || remoteOrder.status === "cancelado");
  if (localCancelled !== remoteCancelled) {
    return localCancelled ? { ...remoteOrder, ...localOrder } : { ...localOrder, ...remoteOrder };
  }

  const localRank = orderRankValue(localOrder);
  const remoteRank = orderRankValue(remoteOrder);
  if (localRank !== remoteRank && localRank >= 0 && remoteRank >= 0) {
    return localRank > remoteRank ? { ...remoteOrder, ...localOrder } : { ...localOrder, ...remoteOrder };
  }

  if (localOrder.status !== remoteOrder.status) {
    const localStatusTime = timestampValue(localOrder.statusUpdatedAt);
    const remoteStatusTime = timestampValue(remoteOrder.statusUpdatedAt);
    if (Math.abs(localStatusTime - remoteStatusTime) > 100) {
      return localStatusTime > remoteStatusTime ? { ...remoteOrder, ...localOrder } : { ...localOrder, ...remoteOrder };
    }
  }

  const localTime = orderTimeValue(localOrder);
  const remoteTime = orderTimeValue(remoteOrder);
  if (Math.abs(localTime - remoteTime) > 1000) {
    return localTime > remoteTime ? { ...remoteOrder, ...localOrder } : { ...localOrder, ...remoteOrder };
  }
  return { ...remoteOrder, ...localOrder };
}

function mergeOrderList(localItems = [], remoteItems = []) {
  const map = new Map();
  remoteItems.forEach((item) => {
    const key = orderKey(item);
    if (key) map.set(key, item);
  });
  localItems.forEach((item) => {
    const key = orderKey(item);
    if (!key) return;
    map.set(key, map.has(key) ? mergeSyncedOrder(item, map.get(key)) : item);
  });
  return [...map.values()];
}

function mergeUniqueStrings(left = [], right = []) {
  return [...new Set([...left, ...right].map((value) => String(value || "").trim()).filter(Boolean))];
}

function mergeItemsByKey(localItems = [], remoteItems = [], keyFn) {
  const map = new Map();
  remoteItems.forEach((item) => {
    const key = keyFn(item);
    if (key) map.set(key, item);
  });
  localItems.forEach((item) => {
    const key = keyFn(item);
    if (!key) return;
    map.set(key, map.has(key) ? { ...map.get(key), ...item } : item);
  });
  return [...map.values()];
}

function mergePrintedGarments(localItems = [], remoteItems = [], deletedIds = []) {
  const deletedSet = new Set(deletedIds.map((value) => String(value || "").trim()).filter(Boolean));
  const mergePrintedGarment = (current = {}, incoming = {}) => {
    const currentUsed = Boolean(current.usedAt || current.usedOrderId);
    const incomingUsed = Boolean(incoming.usedAt || incoming.usedOrderId);
    if (currentUsed && !incomingUsed) return { ...incoming, ...current };
    if (incomingUsed && !currentUsed) return { ...current, ...incoming };
    return { ...current, ...incoming };
  };
  const map = new Map();
  remoteItems.forEach((item) => {
    const key = String(item.id || printedGarmentMatchKey(item)).trim();
    if (deletedSet.has(key)) return;
    if (key) map.set(key, item);
  });
  localItems.forEach((item) => {
    const key = String(item.id || printedGarmentMatchKey(item)).trim();
    if (!key || deletedSet.has(key)) return;
    map.set(key, map.has(key) ? mergePrintedGarment(map.get(key), item) : item);
  });
  return [...map.values()];
}

function dismissedOrderMatch(order = {}, dismissedStores = [], dismissedIds = []) {
  const storeOrder = String(order.storeOrderNumber || "").trim();
  const ids = [order.id, order.internalOrderNumber]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return (storeOrder && dismissedStores.includes(storeOrder)) ||
    ids.some((id) => dismissedIds.includes(id));
}

function mergeAppStates(localState = {}, remoteState = {}) {
  const localOrders = Array.isArray(localState.orders) ? localState.orders : [];
  const dismissedStoreOrders = mergeUniqueStrings(
    Array.isArray(localState.dismissedStoreOrders) ? localState.dismissedStoreOrders : [],
    Array.isArray(remoteState.dismissedStoreOrders) ? remoteState.dismissedStoreOrders : []
  );
  const recoveredStoreOrders = mergeUniqueStrings(
    Array.isArray(localState.recoveredStoreOrders) ? localState.recoveredStoreOrders : [],
    Array.isArray(remoteState.recoveredStoreOrders) ? remoteState.recoveredStoreOrders : []
  ).filter((number) => !dismissedStoreOrders.includes(number));
  const dismissedOrderIds = mergeUniqueStrings(
    Array.isArray(localState.dismissedOrderIds) ? localState.dismissedOrderIds : [],
    Array.isArray(remoteState.dismissedOrderIds) ? remoteState.dismissedOrderIds : []
  );
  const removedBackupInternalNumbers = mergeUniqueStrings(
    Array.isArray(localState.removedBackupInternalNumbers) ? localState.removedBackupInternalNumbers : [],
    Array.isArray(remoteState.removedBackupInternalNumbers) ? remoteState.removedBackupInternalNumbers : []
  );
  const removedBackupRowIds = mergeUniqueStrings(
    Array.isArray(localState.removedBackupRowIds) ? localState.removedBackupRowIds : [],
    Array.isArray(remoteState.removedBackupRowIds) ? remoteState.removedBackupRowIds : []
  );
  const deletedPrintedGarmentIds = mergeUniqueStrings(
    Array.isArray(localState.deletedPrintedGarmentIds) ? localState.deletedPrintedGarmentIds : [],
    Array.isArray(remoteState.deletedPrintedGarmentIds) ? remoteState.deletedPrintedGarmentIds : []
  );
  const backupRowsMerged = mergeItemsByKey(
    Array.isArray(localState.backupRows) ? localState.backupRows : [],
    Array.isArray(remoteState.backupRows) ? remoteState.backupRows : [],
    (row) => String(row.id || `${row.orderId || row.internalOrderNumber || row.storeOrderNumber || ""}:${row.sku || ""}:${row.size || row.talle || ""}:${row.color || ""}`).trim()
  ).filter((row) =>
    !removedBackupInternalNumbers.includes(String(row.internalOrderNumber || "").trim()) &&
    !removedBackupRowIds.includes(String(row.id || "").trim())
  );
  return {
    ...remoteState,
    ...localState,
    orders: mergeOrderList(
      localOrders,
      Array.isArray(remoteState.orders) ? remoteState.orders : []
    ).filter((order) => !dismissedOrderMatch(order, dismissedStoreOrders, dismissedOrderIds)),
    exchanges: mergeOrderList(
      Array.isArray(localState.exchanges) ? localState.exchanges : [],
      Array.isArray(remoteState.exchanges) ? remoteState.exchanges : []
    ),
    backupRows: backupRowsMerged,
    stockLogRows: mergeItemsByKey(
      Array.isArray(localState.stockLogRows) ? localState.stockLogRows : [],
      Array.isArray(remoteState.stockLogRows) ? remoteState.stockLogRows : [],
      (row) => String(row.id || `${row.date || ""}:${row.orderId || row.orderNumber || ""}:${row.requestedSku || row.sku || ""}:${row.quantity || ""}`).trim()
    ),
    printedGarments: mergePrintedGarments(
      Array.isArray(localState.printedGarments) ? localState.printedGarments : [],
      Array.isArray(remoteState.printedGarments) ? remoteState.printedGarments : [],
      deletedPrintedGarmentIds
    ),
    skuPrices: {
      ...(remoteState.skuPrices && typeof remoteState.skuPrices === "object" ? remoteState.skuPrices : {}),
      ...(localState.skuPrices && typeof localState.skuPrices === "object" ? localState.skuPrices : {})
    },
    accountSettings: {
      ...(remoteState.accountSettings && typeof remoteState.accountSettings === "object" ? remoteState.accountSettings : {}),
      ...(localState.accountSettings && typeof localState.accountSettings === "object" ? localState.accountSettings : {})
    },
    dismissedStoreOrders,
    dismissedOrderIds,
    recoveredStoreOrders,
    removedBackupInternalNumbers,
    removedBackupRowIds,
    deletedPrintedGarmentIds,
    internalSequence: Math.max(Number(localState.internalSequence || 5999), Number(remoteState.internalSequence || 5999)),
    savedAt: remoteState.savedAt || localState.savedAt || lastLocalSavedAt
  };
}

function localAppStateSnapshot() {
  return {
    orders,
    exchanges,
    backupRows,
    stockLogRows,
    printedGarments,
    deletedPrintedGarmentIds,
    skuPrices,
    internalSequence,
    accountSettings,
    dismissedStoreOrders,
    dismissedOrderIds,
    recoveredStoreOrders,
    removedBackupInternalNumbers,
    removedBackupRowIds,
    savedAt: lastLocalSavedAt
  };
}

function downloadJsonFile(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadFullAppBackup() {
  if (!downloadFullStateBackup) return;
  const originalText = downloadFullStateBackup.textContent;
  downloadFullStateBackup.disabled = true;
  downloadFullStateBackup.textContent = "Preparando...";
  try {
    await saveRemoteState({ immediate: true });
    await refreshRemoteState();
  } catch (error) {
    console.warn("No se pudo refrescar el backup completo desde Supabase.", error);
  }

  const createdAt = new Date().toISOString();
  const backup = {
    type: "incognito-ventas-full-backup",
    version: 1,
    createdAt,
    source: window.location.origin,
    state: localAppStateSnapshot()
  };
  const stamp = createdAt.slice(0, 19).replace(/[:T]/g, "-");
  downloadJsonFile(backup, `backup-completo-incognito-ventas-${stamp}.json`);
  downloadFullStateBackup.disabled = false;
  downloadFullStateBackup.textContent = originalText;
}

function touchOrder(order, timestamp = new Date().toISOString()) {
  return {
    ...order,
    updatedAt: timestamp
  };
}

function operationalOrders() {
  return [...orders, ...exchanges].filter((order) =>
    !order.cancelled &&
    order.status !== "cancelado" &&
    !order.clearedFromBoard
  );
}

function findOperationalOrder(id) {
  return orders.find((order) => order.id === id) || exchanges.find((exchange) => exchange.id === id);
}

function updateOperationalOrder(id, updater) {
  let changed = false;
  orders = orders.map((order) => {
    if (order.id !== id) return order;
    changed = true;
    return updater(order);
  });
  exchanges = exchanges.map((exchange) => {
    if (exchange.id !== id) return exchange;
    changed = true;
    return updater(exchange);
  });
  return changed;
}

async function loadRemoteState() {
  try {
    const response = await fetch("api/app-state", { cache: "no-store" });
    if (!response.ok) throw new Error(`El servidor respondio ${response.status}`);
    const data = await response.json();
    if (!data.enabled) throw new Error("La sincronizacion remota no esta habilitada.");

    if (data.state) {
      const remoteSavedAt = data.state.savedAt || data.updatedAt || "";
      const deletedIds = mergeUniqueStrings(
        deletedPrintedGarmentIds,
        Array.isArray(data.state.deletedPrintedGarmentIds) ? data.state.deletedPrintedGarmentIds : []
      );
      const state = {
        ...data.state,
        deletedPrintedGarmentIds: deletedIds,
        printedGarments: mergePrintedGarments([], data.state.printedGarments || [], deletedIds)
      };
      applyAppState(state);
      saveLocalOnly(remoteSavedAt || new Date().toISOString());
      return;
    }

    applyAppState({});
    saveLocalOnly();
  } catch (error) {
    console.warn("No se pudo sincronizar Supabase", error);
    applyAppState({});
  } finally {
    remoteStateReady = true;
  }
}

async function migrateLocalSkuPricesIfRequested() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("migrate") !== "sku-prices") return;
  const localSkuPrices = load("sales-sku-prices", {});
  if (!localSkuPrices || Object.keys(localSkuPrices).length === 0) {
    window.alert("No hay precios SKU locales para migrar.");
    window.location.replace(window.location.pathname);
    return;
  }

  try {
    const response = await fetch("api/app-state/sku-prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skuPrices: localSkuPrices })
    });
    const data = await response.json();
    window.alert(`Precios SKU migrados a la nube: ${data.count || 0}`);
  } catch (error) {
    window.alert("No se pudieron migrar los precios SKU.");
  } finally {
    window.location.replace(window.location.pathname);
  }
}

function saveLocalOnly(timestamp = new Date().toISOString()) {
  markLocalSavedAt(timestamp);
  safeLocalSet("sales-orders", JSON.stringify(orders));
  safeLocalSet("sales-exchanges", JSON.stringify(exchanges));
  safeLocalSet("sales-backup", JSON.stringify(backupRows));
  safeLocalSet("sales-stock-log", JSON.stringify(stockLogRows));
  safeLocalSet("sales-printed-garments", JSON.stringify(printedGarments));
  safeLocalSet("sales-deleted-printed-garments", JSON.stringify(deletedPrintedGarmentIds));
  safeLocalSet("sales-sku-prices", JSON.stringify(skuPrices));
  safeLocalSet("sales-internal-sequence", String(internalSequence));
  safeLocalSet("sales-account-settings", JSON.stringify(accountSettings));
  safeLocalSet("sales-dismissed-store-orders", JSON.stringify(dismissedStoreOrders));
  safeLocalSet("sales-dismissed-order-ids", JSON.stringify(dismissedOrderIds));
  safeLocalSet("sales-recovered-store-orders", JSON.stringify(recoveredStoreOrders));
  safeLocalSet("sales-removed-backup-internals", JSON.stringify(removedBackupInternalNumbers));
  safeLocalSet("sales-removed-backup-row-ids", JSON.stringify(removedBackupRowIds));
}

function scheduleRemoteSave() {
  if (!remoteStateReady) return;
  remoteSaveDirty = true;
  remoteSaveQueued = true;
  window.clearTimeout(remoteSaveTimer);
  remoteSaveTimer = window.setTimeout(saveRemoteState, 450);
}

async function flushRemoteSaveNow(options = {}) {
  if (!remoteStateReady) return true;
  window.clearTimeout(remoteSaveTimer);
  remoteSaveQueued = true;
  for (let attempt = 0; remoteSaveInFlight && attempt < 100; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  await compactStoredImages();
  return saveRemoteState({ immediate: true, ...options });
}

async function waitForRemoteSaveIdle() {
  for (let attempt = 0; remoteSaveInFlight && attempt < 300; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  if (remoteSaveInFlight) {
    throw new Error("hay otro guardado en curso. Espera unos segundos y volve a intentar.");
  }
}

async function compactOrderImages(order = {}) {
  if (!order || typeof order !== "object") return order;
  if (isDataImage(order.imageUrl) && order.imageUrl.length >= 180000) {
    order.imageUrl = await compactImageDataUrl(order.imageUrl);
  }
  for (const item of Array.isArray(order.items) ? order.items : []) {
    if (isDataImage(item.imageUrl) && item.imageUrl.length >= 180000) {
      item.imageUrl = await compactImageDataUrl(item.imageUrl);
    }
  }
  return order;
}

async function saveAppStatePatchNow(patch = {}) {
  if (!remoteStateReady) return true;
  window.clearTimeout(remoteSaveTimer);
  await waitForRemoteSaveIdle();
  const statePatch = {
    ...patch,
    savedAt: new Date().toISOString()
  };
  for (const order of Array.isArray(statePatch.orders) ? statePatch.orders : []) {
    await compactOrderImages(order);
  }
  for (const exchange of Array.isArray(statePatch.exchanges) ? statePatch.exchanges : []) {
    await compactOrderImages(exchange);
  }
  const response = await fetch("api/app-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: statePatch, replace: false })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.saved === false) {
    const detail = typeof data.error === "string"
      ? data.error
      : data.error?.message || data.message || "";
    throw new Error(`El servidor respondio ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  remoteSaveDirty = false;
  remoteSaveQueued = false;
  if (data.savedAt || data.updatedAt) saveLocalOnly(data.savedAt || data.updatedAt);
  return true;
}

async function saveOperationalOrderNow(order) {
  if (!remoteStateReady || !order) return true;
  const key = order.recordType === "exchange" || order.isExchange ? "exchanges" : "orders";
  return saveAppStatePatchNow({ [key]: [order] });
}

async function savePrintedGarmentUseNow(order, garment) {
  if (!remoteStateReady || !order || !garment) return true;
  const key = order.recordType === "exchange" || order.isExchange ? "exchanges" : "orders";
  return saveAppStatePatchNow({
    [key]: [order],
    printedGarments: [garment]
  });
}

async function compactStoredImages() {
  const compactItems = async (items = []) => {
    for (const item of items) {
      if (isDataImage(item.imageUrl) && item.imageUrl.length >= 180000) {
        item.imageUrl = await compactImageDataUrl(item.imageUrl);
      }
    }
  };
  for (const order of [...orders, ...exchanges]) {
    if (isDataImage(order.imageUrl) && order.imageUrl.length >= 180000) {
      order.imageUrl = await compactImageDataUrl(order.imageUrl);
    }
    await compactItems(order.items);
  }
  for (const garment of printedGarments) {
    if (isDataImage(garment.imageUrl) && garment.imageUrl.length >= 180000) {
      garment.imageUrl = await compactImageDataUrl(garment.imageUrl);
    }
  }
}

async function saveRemoteState(options = {}) {
  if (remoteSaveInFlight) {
    remoteSaveQueued = true;
    return false;
  }
  remoteSaveQueued = false;
  remoteSaveInFlight = true;
  const requestSavedAt = lastLocalSavedAt;
  let saved = false;
  try {
    const response = await fetch("api/app-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: currentAppState(), replace: Boolean(options.replace) })
    });
    if (response.ok) {
      saved = true;
      const data = await response.json();
      if (!remoteSaveQueued) remoteSaveDirty = false;
      if (data.state) {
        const localChangedWhileSaving = timestampValue(lastLocalSavedAt) > timestampValue(requestSavedAt);
        if (!localChangedWhileSaving && (!remoteSaveQueued || options.immediate)) {
          applyAppState(data.state);
          saveLocalOnly(data.state.savedAt || data.updatedAt || new Date().toISOString());
          render();
        }
      } else if (data.savedAt || data.updatedAt) {
        saveLocalOnly(data.savedAt || data.updatedAt || new Date().toISOString());
      }
    } else if (options.immediate) {
      const errorData = await response.json().catch(() => ({}));
      const detail = typeof errorData.error === "string"
        ? errorData.error
        : errorData.error?.message || errorData.message || "";
      throw new Error(`El servidor respondio ${response.status}${detail ? `: ${detail}` : ""}`);
    }
  } catch (error) {
    console.warn("No se pudo guardar en Supabase", error);
    if (options.immediate) throw error;
  } finally {
    remoteSaveInFlight = false;
    if (remoteSaveQueued && !options.immediate) scheduleRemoteSave();
  }
  return saved;
}

async function refreshRemoteState() {
  if (!remoteStateReady || remoteSaveInFlight || remoteSaveQueued || remoteRefreshInFlight) return;
  if (document.visibilityState === "hidden") return;

  remoteRefreshInFlight = true;
  try {
    const metaResponse = await fetch("api/app-state/meta", { cache: "no-store" });
    if (!metaResponse.ok) return;
    const meta = await metaResponse.json();
    if (!meta.enabled) return;
    const metaSavedAt = meta.savedAt || meta.updatedAt || "";
    if (timestampValue(metaSavedAt) <= timestampValue(lastLocalSavedAt)) return;

    const response = await fetch("api/app-state", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    if (!data.enabled || !data.state) return;

    const remoteSavedAt = data.state.savedAt || data.updatedAt || "";
    if (timestampValue(remoteSavedAt) <= timestampValue(lastLocalSavedAt)) return;

    const mergedState = mergeAppStates(localAppStateSnapshot(), data.state);
    const needsPushBack = JSON.stringify(mergedState.orders) !== JSON.stringify(data.state.orders || []) ||
      JSON.stringify(mergedState.exchanges) !== JSON.stringify(data.state.exchanges || []) ||
      JSON.stringify(mergedState.printedGarments) !== JSON.stringify(data.state.printedGarments || []) ||
      JSON.stringify(mergedState.deletedPrintedGarmentIds) !== JSON.stringify(data.state.deletedPrintedGarmentIds || []) ||
      JSON.stringify(mergedState.dismissedStoreOrders) !== JSON.stringify(data.state.dismissedStoreOrders || []) ||
      JSON.stringify(mergedState.dismissedOrderIds) !== JSON.stringify(data.state.dismissedOrderIds || []);
    applyAppState(mergedState);
    saveLocalOnly(remoteSavedAt || new Date().toISOString());
    render();
    if (needsPushBack) scheduleRemoteSave();
  } catch (error) {
    console.warn("No se pudo actualizar el tablero desde Supabase", error);
  } finally {
    remoteRefreshInFlight = false;
  }
}

function flushRemoteStateOnClose() {
  if (!remoteStateReady) return;
  if (!remoteSaveDirty && !remoteSaveQueued) return;
  window.clearTimeout(remoteSaveTimer);
  remoteSaveQueued = false;
  const body = JSON.stringify({ state: currentAppState() });
  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon("/api/app-state", blob);
    return;
  }
  fetch("api/app-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true
  }).catch(() => {});
}

async function prepareManualWrite() {
  if (!remoteStateReady) {
    throw new Error("la sincronizacion con la nube todavia no termino. Espera unos segundos y volve a guardar.");
  }
  if (remoteSaveDirty || remoteSaveQueued || remoteSaveInFlight) {
    await flushRemoteSaveNow();
  }
  await refreshRemoteState();
}

function createOrder(input) {
  const now = new Date().toISOString();
  const paymentMethod = input.paymentMethod || "Transferencia";
  const account = accountForPayment(paymentMethod, input.account);
  const items = normalizeOrderItems(input, shouldSplitStoreQuantities(input));
  const firstItem = items[0] || {};
  return {
    id: input.id || createId(),
    orderType: input.orderType || "minorista",
    storeOrderId: input.storeOrderId || "",
    storeOrderNumber: input.storeOrderNumber || "",
    customer: input.customer || "",
    customerPhone: input.customerPhone || "",
    customerEmail: input.customerEmail || "",
    customerDocument: input.customerDocument || "",
    purchasedAt: input.purchasedAt || input.createdAt || now,
    internalOrderNumber: input.internalOrderNumber || "",
    sku: firstItem.sku || "",
    color: firstItem.color || "",
    size: firstItem.size || "",
    purchasePrice: moneyValue(firstItem.purchasePrice),
    salePrice: moneyValue(firstItem.salePrice),
    quantity: Number(firstItem.quantity || 1),
    imageUrl: firstItem.imageUrl || "",
    items,
    shippingValue: moneyValue(input.shippingValue),
    fluxCollectAmount: moneyValue(input.fluxCollectAmount),
    shippingCompany: input.shippingCompany || "",
    shippingOption: input.shippingOption || "",
    shippingAddress: input.shippingAddress || {},
    shippingPickupType: input.shippingPickupType || null,
    shippingPickupDetails: input.shippingPickupDetails || null,
    salesChannel: input.salesChannel || "WhatsApp",
    account,
    postalCode: input.postalCode || "",
    invoice: input.invoice || invoiceStatusForPayment(paymentMethod),
    commissionRate: commissionForAccount(account),
    paymentMethod,
    paymentGatewayId: String(input.paymentGatewayId || input.gatewayId || "").trim(),
    paymentGatewayLink: String(input.paymentGatewayLink || input.gatewayLink || "").trim(),
    paymentStatus: input.paymentStatus || "pendiente",
    isExchange: Boolean(input.isExchange),
    recordType: input.recordType || "sale",
    exchangeReturnProduct: input.exchangeReturnProduct || "",
    exchangeNewProduct: input.exchangeNewProduct || "",
    exchangeDifferenceAmount: moneyValue(input.exchangeDifferenceAmount),
    paymentResolution: input.paymentResolution || "",
    labelReady: Boolean(input.labelReady),
    paymentReviewed: Boolean(input.paymentReviewed),
    stockDeductedAt: input.stockDeductedAt || "",
    stockDeductedItems: Array.isArray(input.stockDeductedItems) ? input.stockDeductedItems : [],
    stockBypassedAt: input.stockBypassedAt || "",
    stampsSyncedAt: input.stampsSyncedAt || "",
    stampsSyncResult: input.stampsSyncResult || null,
    stampsSyncError: input.stampsSyncError || "",
    stampsSyncEvents: Array.isArray(input.stampsSyncEvents) ? input.stampsSyncEvents : [],
    statusUpdatedAt: input.statusUpdatedAt || "",
    packagingNote: input.packagingNote || "",
    clearedFromBoard: Boolean(input.clearedFromBoard),
    clearedFromBoardAt: input.clearedFromBoardAt || "",
    cancelled: Boolean(input.cancelled),
    cancelledAt: input.cancelledAt || "",
    cancelReason: input.cancelReason || "",
    fluxSentAt: input.fluxSentAt || "",
    trackingCode: input.trackingCode || "",
    whatsappTemplateSentAt: input.whatsappTemplateSentAt || "",
    whatsappTemplateType: input.whatsappTemplateType || "",
    whatsappTemplateTrackingUrl: input.whatsappTemplateTrackingUrl || "",
    whatsappConfirmationSentAt: input.whatsappConfirmationSentAt || "",
    whatsappConfirmationResult: input.whatsappConfirmationResult || null,
    whatsappConfirmationError: input.whatsappConfirmationError || "",
    whatsappOrderContactSentAt: input.whatsappOrderContactSentAt || "",
    whatsappOrderContactResult: input.whatsappOrderContactResult || null,
    whatsappOrderContactError: input.whatsappOrderContactError || "",
    whatsappTemplateResult: input.whatsappTemplateResult || null,
    whatsappTemplateError: input.whatsappTemplateError || "",
    customerNotes: input.customerNotes || "",
    externalNotes: input.externalNotes || "",
    internalNotes: input.internalNotes ?? input.notes ?? "",
    notes: input.internalNotes ?? input.notes ?? "",
    createdAt: input.createdAt || today(),
    approvedAt: input.approvedAt || "",
    status: input.status || "definir",
    insertedAt: input.insertedAt || now,
    updatedAt: input.updatedAt || now
  };
}

function normalizeOrderItems(input, splitQuantities = false) {
  const sourceItems = Array.isArray(input.items) && input.items.length
    ? input.items
    : [{
        sku: input.sku,
        name: input.name,
        color: input.color,
        size: input.size,
        purchasePrice: input.purchasePrice,
        salePrice: input.salePrice,
        quantity: input.quantity,
        imageUrl: input.imageUrl
      }];

  const items = sourceItems.map((item) => {
    const sku = String(item.sku || "").trim();
    return {
      sourceItemId: item.sourceItemId || item.itemRef || item.id || "",
      sku,
      name: item.name || "",
      color: item.color || "",
      size: item.size || "",
      purchasePrice: purchasePriceForSku(sku, item.purchasePrice),
      salePrice: moneyValue(item.salePrice),
      quantity: Number(item.quantity || 1),
      imageUrl: item.imageUrl || "",
      picked: Boolean(item.picked),
      pickStatus: item.pickStatus || (item.picked ? "armado" : ""),
      printOwner: detailItemPrintOwner(item),
      printOwnerUpdatedAt: item.printOwnerUpdatedAt || "",
      printedGarmentId: item.printedGarmentId || "",
      printedGarmentUsedAt: item.printedGarmentUsedAt || "",
      stockDeductedAt: item.stockDeductedAt || "",
      stockDeductedItems: Array.isArray(item.stockDeductedItems) ? item.stockDeductedItems : [],
      stockPending: Boolean(item.stockPending),
      stockError: item.stockError || "",
      stampsSyncedAt: item.stampsSyncedAt || "",
      stampsSyncError: item.stampsSyncError || ""
    };
  });
  return splitQuantities ? splitRepeatedItems(items) : items;
}

function shouldSplitStoreQuantities(input = {}) {
  return normalize(input.salesChannel) === "tienda nube" || Boolean(input.storeOrderId || input.storeOrderNumber);
}

function splitRepeatedStoreOrderItems(order) {
  if (!shouldSplitStoreQuantities(order) || !Array.isArray(order.items) || !order.items.length) return order;
  const items = splitRepeatedItems(order.items);
  if (items.length === order.items.length) return order;
  const firstItem = items[0] || {};
  return {
    ...order,
    sku: firstItem.sku || order.sku || "",
    color: firstItem.color || order.color || "",
    size: firstItem.size || order.size || "",
    purchasePrice: moneyValue(firstItem.purchasePrice),
    salePrice: moneyValue(firstItem.salePrice),
    quantity: Number(firstItem.quantity || 1),
    imageUrl: firstItem.imageUrl || order.imageUrl || "",
    items
  };
}

function splitRepeatedItems(items = []) {
  return items.flatMap((item) => {
    const quantity = Number(item.quantity || 1);
    if (!Number.isInteger(quantity) || quantity <= 1) return [item];
    return Array.from({ length: quantity }, () => ({
      ...item,
      quantity: 1,
      picked: Boolean(item.picked),
      pickStatus: item.pickStatus || (item.picked ? "armado" : ""),
      printOwner: detailItemPrintOwner(item),
      printOwnerUpdatedAt: item.printOwnerUpdatedAt || "",
      printedGarmentId: item.printedGarmentId || "",
      printedGarmentUsedAt: item.printedGarmentUsedAt || "",
      stockDeductedAt: item.stockDeductedAt || "",
      stockDeductedItems: Array.isArray(item.stockDeductedItems) ? item.stockDeductedItems : [],
      stockPending: Boolean(item.stockPending),
      stockError: item.stockError || "",
      sourceItemId: item.sourceItemId || item.itemRef || item.id || "",
      stampsSyncedAt: item.stampsSyncedAt || "",
      stampsSyncError: item.stampsSyncError || ""
    }));
  });
}

function purchasePriceForSku(sku, fallback) {
  const storedPrice = storedSkuPrice(sku);
  if (storedPrice > 0) return storedPrice;
  return moneyValue(fallback);
}

function invoiceStatusForPayment(paymentMethod) {
  return normalize(paymentMethod) === "mercado pago" ? "Pendiente de facturacion" : "No";
}

function accountForPayment(paymentMethod, account) {
  const payment = normalize(paymentMethod);
  if (payment === "abonar al recibir") return "Flux";
  if (account) return account;
  if (payment === "mercado pago") return accountSettings.mercadoPago;
  if (payment === "transferencia") return accountSettings.transfer;
  return account || "EG";
}

function commissionForAccount(account) {
  return accountCommissionRates[account] ?? 0;
}

function nextInternalNumber() {
  internalSequence += 1;
  return String(internalSequence);
}

function createId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `order-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function isDismissedStoreOrder(storeOrderNumber) {
  const number = String(storeOrderNumber || "").trim();
  return Boolean(number) && dismissedStoreOrders.includes(number);
}

function rememberDismissedStoreOrder(storeOrderNumber) {
  const number = String(storeOrderNumber || "").trim();
  if (!number || dismissedStoreOrders.includes(number)) return;
  dismissedStoreOrders = [...dismissedStoreOrders, number];
}

function rememberRecoveredStoreOrder(storeOrderNumber) {
  const number = String(storeOrderNumber || "").trim();
  if (!number || recoveredStoreOrders.includes(number)) return;
  recoveredStoreOrders = [...recoveredStoreOrders, number];
}

function rememberDismissedOrder(order) {
  if (!order) return;
  rememberDismissedStoreOrder(order.storeOrderNumber);
  const ids = [order.id, order.internalOrderNumber]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (!ids.length) return;
  dismissedOrderIds = [...new Set([...dismissedOrderIds, ...ids])];
}

function isCancelledBackupStoreOrder(storeOrderNumber) {
  const number = String(storeOrderNumber || "").trim();
  if (!number) return false;
  return backupRows.some((row) =>
    row.cancelled &&
    String(row.storeOrderNumber || "").trim() === number
  );
}

function isBackedUpStoreOrder(storeOrderNumber) {
  const number = String(storeOrderNumber || "").trim();
  if (!number) return false;
  return backupRows.some((row) => String(row.storeOrderNumber || "").trim() === number);
}

function shouldIgnoreStoreOrderForImport(storeOrderNumber) {
  const number = String(storeOrderNumber || "").trim();
  if (!number) return false;
  return !recoveredStoreOrders.includes(number) && (
    isDismissedStoreOrder(number) ||
    isBackedUpStoreOrder(number) ||
    isCancelledBackupStoreOrder(number)
  );
}

// ── Importar desde Tiendanube (backend) con fallback a demo ───────────────────
async function importStoreOrders() {
  syncStore.disabled = true;
  syncStore.textContent = "Importando...";

  let incoming;
  let fromBackend = false;

  try {
    // Mandamos las cuentas activas para que el backend asigne correctamente
    const params = new URLSearchParams({
      mercadoPagoAccount: accountSettings.mercadoPago,
      transferAccount: accountSettings.transfer
    });

    const response = await fetch(`api/tiendanube/orders?${params}`);

    if (!response.ok) {
      throw new Error(`El servidor respondio HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data.success || !Array.isArray(data.orders)) {
      throw new Error(data.error || "Respuesta invalida del servidor");
    }

    // Filtramos antes de crear las tarjetas para no revivir pedidos viejos ni mover numeracion.
    incoming = data.orders
      .filter((order) => !shouldIgnoreStoreOrderForImport(order.storeOrderNumber))
      .map((o) => createOrder(o));
    fromBackend = true;

  } catch (err) {
    // ── Fallback a datos de demo ─────────────────────────────────────────────
    console.warn("[Tiendanube] Backend no disponible, usando demo:", err.message);
    incoming = storeSample;
    showImportNotice(
      "⚠️ Backend no disponible (" + err.message + "). Se cargaron pedidos de demo.",
      "warn"
    );
  }

  // Deduplicar usando el número de orden de Tiendanube
  incoming = incoming.filter((order) => !shouldIgnoreStoreOrderForImport(order.storeOrderNumber));

  const updatedExistingOrders = [];
  orders = orders.map((existing) => {
    const imported = incoming.find(
      (order) =>
        order.storeOrderNumber &&
        existing.storeOrderNumber &&
        order.storeOrderNumber === existing.storeOrderNumber
    );

    if (!imported) return existing;

    if (existing.status !== "definir") {
      return {
        ...existing,
        storeOrderId: imported.storeOrderId || existing.storeOrderId,
        customerPhone: imported.customerPhone || existing.customerPhone,
        customerEmail: imported.customerEmail || existing.customerEmail,
        customerDocument: imported.customerDocument || existing.customerDocument,
        purchasedAt: imported.purchasedAt || existing.purchasedAt,
        paymentGatewayId: imported.paymentGatewayId || existing.paymentGatewayId || "",
        paymentGatewayLink: imported.paymentGatewayLink || existing.paymentGatewayLink || "",
        shippingOption: imported.shippingOption || existing.shippingOption,
        shippingAddress: imported.shippingAddress || existing.shippingAddress,
        shippingPickupType: imported.shippingPickupType ?? existing.shippingPickupType,
        shippingPickupDetails: imported.shippingPickupDetails ?? existing.shippingPickupDetails,
        trackingCode: imported.trackingCode || existing.trackingCode
      };
    }

    const refreshed = {
      ...existing,
      storeOrderId: imported.storeOrderId,
      customerPhone: imported.customerPhone || existing.customerPhone,
      customerEmail: imported.customerEmail || existing.customerEmail,
      customerDocument: imported.customerDocument || existing.customerDocument,
      purchasedAt: imported.purchasedAt || existing.purchasedAt,
      sku: imported.sku,
      color: imported.color,
      size: imported.size,
      purchasePrice: imported.purchasePrice,
      salePrice: imported.salePrice,
      quantity: imported.quantity,
      imageUrl: imported.imageUrl,
      items: imported.items,
      paymentMethod: imported.paymentMethod,
      paymentGatewayId: imported.paymentGatewayId || existing.paymentGatewayId || "",
      paymentGatewayLink: imported.paymentGatewayLink || existing.paymentGatewayLink || "",
      paymentStatus: imported.paymentStatus,
      account: imported.account,
      commissionRate: imported.commissionRate,
      invoice: imported.invoice,
      shippingCompany: imported.shippingCompany,
      shippingOption: imported.shippingOption || existing.shippingOption,
      shippingAddress: imported.shippingAddress || existing.shippingAddress,
      shippingPickupType: imported.shippingPickupType ?? existing.shippingPickupType,
      shippingPickupDetails: imported.shippingPickupDetails ?? existing.shippingPickupDetails,
      shippingValue: imported.shippingValue,
      postalCode: imported.postalCode,
      trackingCode: imported.trackingCode || existing.trackingCode,
      customerNotes: imported.customerNotes || existing.customerNotes || "",
      externalNotes: existing.externalNotes || "",
      internalNotes: existing.internalNotes ?? existing.notes ?? "",
      notes: existing.internalNotes ?? existing.notes ?? ""
    };

    if (imported.status !== "preparacion") return refreshed;

    const prepared = prepareImportedOrder({
      ...refreshed,
      status: "preparacion"
    });
    updatedExistingOrders.push(prepared);
    return prepared;
  });

  const newOrders = incoming.filter(
    (order) =>
      order.storeOrderNumber &&
      !isBackedUpStoreOrder(order.storeOrderNumber) &&
      !orders.some(
        (existing) =>
          existing.storeOrderNumber &&
          existing.storeOrderNumber === order.storeOrderNumber
      )
  );

  if (newOrders.length === 0 && updatedExistingOrders.length === 0) {
    if (fromBackend) {
      showImportNotice("✓ Sin pedidos nuevos en Tiendanube.", "ok");
    }
    syncStore.disabled = false;
    syncStore.textContent = "Importar Tienda Nube";
    return;
  }

  const preparedNewOrders = newOrders.map(prepareImportedOrder);

  orders = [...preparedNewOrders, ...orders];
  save();
  render();

  if (fromBackend) {
    showImportNotice(
      "✓ " + newOrders.length + " pedido(s) importado(s) de Tiendanube.",
      "ok"
    );
  }

  syncStore.disabled = false;
  syncStore.textContent = "Importar Tienda Nube";
}

async function importSingleStoreOrder(event) {
  event?.preventDefault();
  if (!singleTnImportInput || !singleTnImportButton) return;

  const storeOrderNumber = String(singleTnImportInput.value || "").trim();
  if (!storeOrderNumber) {
    window.alert("Escribi el numero TN que queres traer.");
    singleTnImportInput.focus();
    return;
  }

  singleTnImportButton.disabled = true;
  singleTnImportButton.textContent = "Buscando...";

  try {
    await prepareManualWrite();
    const storeOrder = await fetchSingleStoreOrder(storeOrderNumber);

    const imported = createOrder({
      ...storeOrder,
      status: "definir",
      internalOrderNumber: "",
      approvedAt: "",
      statusUpdatedAt: ""
    });

    dismissedStoreOrders = dismissedStoreOrders.filter((value) =>
      String(value || "").trim() !== String(imported.storeOrderNumber || storeOrderNumber).trim()
    );
    dismissedOrderIds = dismissedOrderIds.filter((value) =>
      String(value || "").trim() !== String(imported.storeOrderId || "").trim()
    );
    rememberRecoveredStoreOrder(imported.storeOrderNumber || storeOrderNumber);

    const existingIndex = orders.findIndex((order) =>
      String(order.storeOrderNumber || "").trim() === String(imported.storeOrderNumber || "").trim()
    );
    if (existingIndex >= 0) {
      orders = orders.map((order, index) => index === existingIndex ? {
        ...order,
        ...imported,
        id: order.id || imported.id,
        internalOrderNumber: order.status === "definir" ? "" : order.internalOrderNumber,
        status: order.status === "definir" ? "definir" : order.status,
        paymentGatewayId: imported.paymentGatewayId || order.paymentGatewayId || "",
        paymentGatewayLink: imported.paymentGatewayLink || order.paymentGatewayLink || "",
        externalNotes: order.externalNotes || imported.externalNotes || "",
        internalNotes: order.internalNotes || order.notes || "",
        notes: order.internalNotes || order.notes || ""
      } : order);
    } else {
      orders = [imported, ...orders];
    }

    singleTnImportInput.value = "";
    save();
    render();
    const saved = await flushRemoteSaveNow({ replace: true });
    if (!saved) {
      throw new Error("no se pudo confirmar el TN importado en la nube");
    }
    showImportNotice(`✓ TN ${imported.storeOrderNumber || storeOrderNumber} importado a A definir.`, "ok");
  } catch (error) {
    window.alert(`No pude traer ese TN: ${error.message}`);
  } finally {
    singleTnImportButton.disabled = false;
    singleTnImportButton.textContent = "Traer pedido";
  }
}

async function fetchSingleStoreOrder(storeOrderNumber) {
  const params = new URLSearchParams({
    mercadoPagoAccount: accountSettings.mercadoPago,
    transferAccount: accountSettings.transfer
  });
  const response = await fetch(`api/tiendanube/orders/by-number/${encodeURIComponent(storeOrderNumber)}?${params}`);
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.success || !data.order) {
    throw new Error(data.error || `El servidor respondio HTTP ${response.status}`);
  }

  return data.order;
}

async function importSingleStoreOrderAsExchange() {
  if (!singleTnImportInput || !singleTnExchangeButton) return;

  const storeOrderNumber = String(singleTnImportInput.value || "").trim();
  if (!storeOrderNumber) {
    window.alert("Escribi el numero TN que queres traer como cambio.");
    singleTnImportInput.focus();
    return;
  }

  singleTnExchangeButton.disabled = true;
  if (singleTnImportButton) singleTnImportButton.disabled = true;
  singleTnExchangeButton.textContent = "Buscando...";

  try {
    await prepareManualWrite();
    const storeOrder = await fetchSingleStoreOrder(storeOrderNumber);
    openExchangeFromStoreOrder(createOrder({
      ...storeOrder,
      recordType: "exchange-source",
      isExchange: false
    }));
    singleTnImportInput.value = "";
    showImportNotice(`✓ TN ${storeOrder.storeOrderNumber || storeOrderNumber} cargado como base de cambio.`, "ok");
  } catch (error) {
    window.alert(`No pude traer ese TN como cambio: ${error.message}`);
  } finally {
    singleTnExchangeButton.disabled = false;
    if (singleTnImportButton) singleTnImportButton.disabled = false;
    singleTnExchangeButton.textContent = "Traer como cambio";
  }
}

function prepareImportedOrder(order) {
  if (order.status !== "preparacion") return order;
  const timestamp = new Date().toISOString();
  const prepared = {
    ...order,
    internalOrderNumber: order.internalOrderNumber || nextInternalNumber(),
    approvedAt: order.approvedAt || timestamp,
    statusUpdatedAt: order.statusUpdatedAt || timestamp,
    updatedAt: order.updatedAt || timestamp
  };
  addBackupRow(prepared);
  return prepared;
}

function backupRowsForOrder(order = {}) {
  const internal = String(order.internalOrderNumber || "").trim();
  return backupRows.filter((row) =>
    row.orderId === order.id ||
    row.id === order.id ||
    (internal && String(row.internalOrderNumber || "").trim() === internal)
  );
}

// ── Aviso de importación ──────────────────────────────────────────────────────
function showImportNotice(message, type) {
  const existing = document.querySelector("#importNotice");
  if (existing) existing.remove();

  const notice = document.createElement("p");
  notice.id = "importNotice";
  notice.textContent = message;

  const isWarn = type === "warn";
  notice.style.cssText = [
    "padding: 8px 28px",
    "font-size: 0.86rem",
    "border-top: 1px solid " + (isWarn ? "#fde68a" : "#bbf7d0"),
    "background: " + (isWarn ? "#fffbeb" : "#f0fdf4"),
    "color: " + (isWarn ? "#92400e" : "#15803d"),
    "margin-bottom: 0"
  ].join(";");

  // Lo insertamos entre el topbar y el rules-panel
  const topbar = document.querySelector(".topbar");
  if (topbar && topbar.parentNode) {
    topbar.parentNode.insertBefore(notice, topbar.nextSibling);
  }

  setTimeout(() => {
    if (notice.parentNode) notice.remove();
  }, 6000);
}

// ── Resto de las funciones (sin cambios) ──────────────────────────────────────

async function approveOrder(id, triggerButton = null) {
  const initialOrder = orders.find((order) => order.id === id);
  const requiresConfirmedSave = Boolean(
    initialOrder?.storeOrderId ||
    initialOrder?.storeOrderNumber ||
    normalize(initialOrder?.salesChannel) === "tienda nube"
  );
  if (triggerButton) {
    triggerButton.disabled = requiresConfirmedSave;
    if (requiresConfirmedSave) triggerButton.textContent = "Guardando...";
  }
  if (requiresConfirmedSave) {
    await prepareManualWrite();
  }
  let internalNumber = "";
  let approvedOrder = null;
  const timestamp = new Date().toISOString();
  orders = orders.map((order) => {
    if (order.id !== id) return order;
    const correctedOrder = correctPayOnDeliveryAndreaniToFlux(order);
    const approved = touchOrder({
      ...correctedOrder,
      internalOrderNumber: correctedOrder.internalOrderNumber || nextInternalNumber(),
      status: "preparacion",
      statusUpdatedAt: timestamp,
      approvedAt: timestamp
    }, timestamp);
    internalNumber = approved.internalOrderNumber;
    approvedOrder = approved;
    addBackupRow(approved);
    return approved;
  });
  resetProcessFiltersAfterApproval();
  if (requiresConfirmedSave) {
    saveLocalOnly();
    render();
    await saveAppStatePatchNow({
      orders: approvedOrder ? [approvedOrder] : [],
      backupRows: approvedOrder ? backupRowsForOrder(approvedOrder) : [],
      internalSequence,
      dismissedStoreOrders,
      dismissedOrderIds,
      recoveredStoreOrders
    });
  } else {
    save();
    render();
  }
  if (shouldMarkTiendanubeLoaded(approvedOrder)) {
    try {
      await markTiendanubeOrderLoaded(approvedOrder);
      const noteTimestamp = new Date().toISOString();
      orders = orders.map((order) => order.id === id ? touchOrder({
        ...order,
        tiendanubeOwnerNoteLoadedAt: noteTimestamp,
        tiendanubeOwnerNoteError: ""
      }, noteTimestamp) : order);
      save();
      render();
      flushRemoteSaveNow({ replace: true });
    } catch (error) {
      const noteTimestamp = new Date().toISOString();
      orders = orders.map((order) => order.id === id ? touchOrder({
        ...order,
        tiendanubeOwnerNoteError: error?.message || String(error)
      }, noteTimestamp) : order);
      save();
      render();
      flushRemoteSaveNow({ replace: true });
      window.alert(`El pedido paso a preparacion, pero no pude escribir "Cargado" en Tienda Nube: ${error?.message || error}`);
    }
  }
  if (internalNumber) window.alert(`Numero interno generado: ${internalNumber}`);
}

function shouldMarkTiendanubeLoaded(order) {
  if (!order) return false;
  if (!String(order.storeOrderId || "").trim()) return false;
  if (order.tiendanubeOwnerNoteLoadedAt) return false;
  if (order.recordType === "exchange" || order.isExchange) return false;
  if (normalize(order.salesChannel) !== "tienda nube" && !order.storeOrderNumber) return false;
  return normalize(order.paymentMethod) === "abonar al recibir";
}

async function markTiendanubeOrderLoaded(order) {
  const storeOrderId = String(order.storeOrderId || "").trim();
  if (!storeOrderId) throw new Error("Falta pedido de Tienda Nube.");
  const response = await fetch(`api/tiendanube/orders/${encodeURIComponent(storeOrderId)}/owner-note`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note: "Cargado" })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.error || `El servidor respondio ${response.status}`);
  }
  return data;
}

function resetProcessFiltersAfterApproval() {
  shippingFilter = "todos";
  processPaymentFilter = "todos";
  skuFilter = "todos";
  dtfFilterActive = false;
  dispatchedWhatsappFilter = "todos";
  processSearch = "";
  if (processSearchInput) processSearchInput.value = "";
}

function correctPayOnDeliveryAndreaniToFlux(order) {
  if (!isPayOnDeliveryAndreani(order)) return order;

  const parsed = splitStreetAndNumber(order);
  const postalCode = fluxPostalCode(order) || order.postalCode || "";
  const locality = fluxLocality(order);
  const province = fluxProvince(order);
  const existingAddress = order.shippingAddress || {};
  const correctionNote = "Corregido automaticamente: Abonar al recibir con Andreani pasa a Flux.";

  return {
    ...order,
    shippingCompany: "Flux",
    shippingOption: "Flux",
    account: "Flux",
    commissionRate: commissionForAccount("Flux"),
    postalCode,
    shippingAddress: {
      ...existingAddress,
      street: parsed.street || existingAddress.street || existingAddress.address || "",
      number: parsed.number || existingAddress.number || existingAddress.streetNumber || "",
      fullAddress: [parsed.street, parsed.number].filter(Boolean).join(" ") || existingAddress.fullAddress || "",
      city: existingAddress.city || existingAddress.locality || locality || "",
      locality: existingAddress.locality || existingAddress.city || locality || "",
      neighborhood: existingAddress.neighborhood || existingAddress.barrio || existingAddress.district || existingAddress.area || "",
      barrio: existingAddress.barrio || existingAddress.neighborhood || existingAddress.district || existingAddress.area || "",
      postalCode,
      cp: postalCode,
      province,
      state: province
    },
    notes: compactNotes([order.internalNotes ?? order.notes, correctionNote]),
    internalNotes: compactNotes([order.internalNotes ?? order.notes, correctionNote]),
    externalNotes: order.externalNotes || "",
    fluxAutoCorrectedFromAndreaniAt: order.fluxAutoCorrectedFromAndreaniAt || new Date().toISOString()
  };
}

function addBackupRow(order) {
  const alreadyBackedUp = backupRows.some((row) => (row.orderId === order.id || row.id === order.id) && row.approvedDate === today());
  if (alreadyBackedUp) return;

  const items = orderItems(order);
  const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity || 1), 0) || 1;
  const fluxZone = fluxZoneByPostalCode(order.postalCode);
  const totalShippingValue = normalize(order.shippingCompany).includes("flux") && fluxZone !== null
    ? fluxZoneCosts[fluxZone]
    : Number(order.shippingValue || 0);
  const shippingPerUnit = totalShippingValue / totalQuantity;
  const rows = orderItems(order).map((item, index) => ({
    id: `${order.id}:${index}`,
    orderId: order.id,
    approvedDate: today(),
    storeOrderNumber: order.storeOrderNumber,
    customer: order.customer,
    internalOrderNumber: order.internalOrderNumber,
    sku: item.sku,
    color: item.color,
    size: item.size,
    purchasePrice: item.purchasePrice,
    salePrice: item.salePrice,
    quantity: item.quantity,
    printOwner: detailItemPrintOwner(item),
    printOwnerUpdatedAt: item.printOwnerUpdatedAt || "",
    shippingValue: shippingPerUnit * Number(item.quantity || 1),
    totalShippingValue,
    fluxExpectedZone: fluxZone,
    shippingCompany: order.shippingCompany,
    salesChannel: order.salesChannel,
    account: order.account,
    postalCode: order.postalCode,
    invoice: order.invoice,
    commissionRate: order.commissionRate,
    paymentMethod: order.paymentMethod,
    customerNotes: order.customerNotes || "",
    externalNotes: order.externalNotes || "",
    internalNotes: internalOrderNote(order),
    notes: backupOrderNotes(order)
  }));

  backupRows.unshift(...rows);
}

async function moveOrder(id, direction) {
  await refreshRemoteState();
  const currentOrder = findOperationalOrder(id);
  if (!currentOrder) return false;
  const currentIndex = processStatuses.findIndex((status) => status.id === currentOrder.status);
  const nextIndex = Math.min(Math.max(currentIndex + direction, 0), processStatuses.length - 1);
  const nextStatus = processStatuses[nextIndex]?.id;
  const needsStockDecrement = currentOrder.recordType !== "exchange" && currentOrder.status === "preparacion" && nextStatus === "armado" && !currentOrder.stockDeductedAt && hasRemainingStockItems(currentOrder);
  const needsStampPrepareToAssemble = currentOrder.status === "preparacion" && nextStatus === "armado" && stampItemsForOrder(currentOrder, { onlyUnsynced: true }).length > 0;
  const asksPackagingNote = currentOrder.status === "preparacion" && nextStatus === "armado";
  const shouldNotifyTiendanube = currentOrder.status === "rotulado" && nextStatus === "despachado";
  let packagingNote = currentOrder.packagingNote || "";
  let stockResult = null;
  let stampResult = null;
  let stockBypassed = false;
  let tiendanubeFulfillment = null;

  if (asksPackagingNote) {
    const note = window.prompt("Nota para empaquetado (opcional):", packagingNote);
    packagingNote = note === null ? packagingNote : String(note || "").trim();
  }

  if (needsStockDecrement) {
    stockResult = await decrementOrderStock(currentOrder);
    if (!stockResult.ok) {
      const passAnyway = window.confirm("No se pudo descontar este pedido completo de stock. Se desconto lo disponible y quedaron errores. Queres pasarlo a Armado igual?");
      if (!passAnyway) {
        if (stockResult.deductedItems?.length) {
          const partialTimestamp = new Date().toISOString();
          updateOperationalOrder(id, (order) => {
            if (order.id !== id) return order;
            return touchOrder({
              ...order,
              stockDeductedAt: partialTimestamp,
              stockBypassedAt: partialTimestamp,
              stockDeductedItems: stockResult.deductedItems
            }, partialTimestamp);
          });
          save();
          render();
        }
        return false;
      }
      stockBypassed = true;
    }
  }

  if (needsStampPrepareToAssemble) {
    const evento = "preparacion_a_armado";
    try {
      stampResult = await syncOrderStamps(currentOrder, evento, { onlyUnsynced: true });
      stampResult.evento = evento;
      if (!stampResult.ok) {
        window.alert(`El pedido va a moverse igual, pero no pude sincronizar estampas: ${stampResult.error || "error desconocido"}`);
      }
    } catch (error) {
      stampResult = { ok: false, evento, error: error.message };
      window.alert(`El pedido va a moverse igual, pero no pude conectar con Stock Estampas: ${error.message}`);
    }
  }

  if (shouldNotifyTiendanube && canNotifyTiendanubeTracking(currentOrder)) {
    try {
      tiendanubeFulfillment = await notifyTiendanubeFulfillment(currentOrder);
    } catch (error) {
      const passAnyway = window.confirm(`No pude cargar el seguimiento en Tienda Nube: ${error.message}\n\nQueres pasarlo a Despachado igual?`);
      if (!passAnyway) return false;
    }
  }

  const timestamp = new Date().toISOString();
  updateOperationalOrder(id, (order) => {
    if (order.id !== id) return order;
    return touchOrder(applyStampSyncState({
      ...order,
      status: nextStatus,
      packagingNote: asksPackagingNote ? packagingNote : order.packagingNote,
      statusUpdatedAt: timestamp,
      stockBypassedAt: stockBypassed || stockResult?.errors?.length ? timestamp : order.stockBypassedAt,
      stockDeductedAt: stockResult?.deductedItems?.length ? timestamp : order.stockDeductedAt,
      stockDeductedItems: stockResult?.deductedItems?.length
        ? mergeStockDeductedItems(order.stockDeductedItems, stockResult.deductedItems)
        : order.stockDeductedItems,
      tiendanubeFulfilledAt: tiendanubeFulfillment ? timestamp : order.tiendanubeFulfilledAt,
      tiendanubeTrackingCode: tiendanubeFulfillment ? String(order.trackingCode || "").trim() : order.tiendanubeTrackingCode,
      tiendanubeFulfillmentResult: tiendanubeFulfillment ? tiendanubeFulfillment.result || tiendanubeFulfillment : order.tiendanubeFulfillmentResult
    }, stampResult, timestamp), timestamp);
  });
  backupRows = syncBackupRowsWithOrders(backupRows);
  save();
  render();
  return true;
}

async function decrementOrderStock(order) {
  await loadStockItems();
  const items = orderItems(order)
    .filter((item) => !item.printedGarmentId && !item.stockDeductedAt)
    .flatMap(expandStockItem)
    .map(resolveStockVariantForItem)
    .filter((item) => item.sku && item.size && item.quantity > 0);

  if (!items.length) {
    window.alert("No pude descontar stock porque el pedido no tiene SKU y talle completos.");
    return { ok: false, deductedItems: [], errors: ["Sin SKU o talle completos."] };
  }

  const orderId = order.internalOrderNumber || order.id;
  const deductedItems = [];
  const errors = [];

  for (const [index, item] of items.entries()) {
    const lineOrderId = `${orderId}-stock-${index + 1}`;
    try {
      const result = await requestStockDecrement(lineOrderId, [item]);
      if (result.ok) {
        addStockLogRows(order, result.data);
        deductedItems.push(item);
        continue;
      }
      const message = result.data.errores?.map((error) => `${error.sku}: ${stockErrorMessage(error.error)}`).join("\n") ||
        stockErrorMessage(result.data.error) ||
        "No se pudo descontar stock.";
      errors.push(`${item.sku} / ${item.size || "sin talle"} / ${item.color || "sin color"} x${item.quantity}: ${message}`);
    } catch (error) {
      errors.push(`${item.sku} / ${item.size || "sin talle"} / ${item.color || "sin color"} x${item.quantity}: ${error.message}`);
    }
  }

  if (errors.length) {
    const successMessage = deductedItems.length
      ? `Se descontaron ${deductedItems.length} linea(s).`
      : "No se desconto ninguna linea.";
    window.alert(`${successMessage}\n\nNo se pudo descontar:\n${errors.join("\n")}`);
  }

  return {
    ok: errors.length === 0,
    deductedItems,
    errors
  };
}

function hasRemainingStockItems(order) {
  return orderItems(order).some((item) => !item.printedGarmentId && !item.stockDeductedAt && item.sku && item.size && Number(item.quantity || 1) > 0);
}

function mergeStockDeductedItems(currentItems = [], newItems = []) {
  return [
    ...(Array.isArray(currentItems) ? currentItems : []),
    ...(Array.isArray(newItems) ? newItems : [])
  ];
}

function stockErrorMessage(value) {
  const text = String(value || "").trim();
  if (!text) return "No se pudo descontar stock.";
  if (/<html[\s>]/i.test(text) || /<!doctype html/i.test(text)) {
    const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
    return title ? `El servicio de stock devolvio una pagina: ${title}.` : "El servicio de stock devolvio una pagina HTML en lugar de una respuesta valida.";
  }
  return text.length > 400 ? `${text.slice(0, 400)}...` : text;
}

async function requestStockDecrement(orderId, items) {
  const response = await fetch("api/stock/decrement", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, items })
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok && !data.errores?.length, data };
}

async function requestStockRestore(orderId, items) {
  const response = await fetch("api/stock/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, items })
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok && !data.errores?.length, data };
}

function isStampSku(sku = "") {
  const normalizedSku = normalize(sku).replace(/\s+/g, "-");
  return normalizedSku.endsWith("-dtf") || normalizedSku.endsWith("-3d");
}

function stampPedidoId(order = {}) {
  return String(order.internalOrderNumber || order.storeOrderNumber || order.id || "").trim();
}

function stampItemRef(order = {}, item = {}, index = 0) {
  const pedidoId = stampPedidoId(order);
  const sourceId = String(item.sourceItemId || item.itemRef || item.id || "").trim();
  if (sourceId) return `${pedidoId}:${sourceId}:${index + 1}`;
  return `${pedidoId}:${index + 1}:${String(item.sku || "").trim()}:${String(item.size || "").trim()}`;
}

function stampItemsForOrder(order = {}, options = {}) {
  const hasItemIndex = options.itemIndex !== undefined && Number.isInteger(Number(options.itemIndex));
  const targetIndex = hasItemIndex ? Number(options.itemIndex) : null;
  return orderItems(order)
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => targetIndex === null || index === targetIndex)
    .filter(({ item }) => !item.printedGarmentId)
    .filter(({ item }) => isStampSku(item.sku) && Number(item.quantity || 1) > 0)
    .filter(({ item }) => !options.onlyUnsynced || !item.stampsSyncedAt)
    .map(({ item, index }) => ({
      sku: String(item.sku || "").trim(),
      cantidad: Number(item.quantity || 1),
      itemRef: stampItemRef(order, item, index),
      talle: String(item.size || "").trim(),
      nombre: String(item.name || order.name || item.sku || "").trim()
    }));
}

async function syncOrderStamps(order = {}, evento = "preparacion_a_armado", options = {}) {
  const pedidoId = stampPedidoId(order);
  const items = options.items || stampItemsForOrder(order, {
    itemIndex: options.itemIndex,
    onlyUnsynced: Boolean(options.onlyUnsynced)
  });
  if (!pedidoId || !items.length) return { ok: true, skipped: true, data: null };
  if (evento === "preparacion_a_armado" && order.stampsSyncedAt && !options.force && options.itemIndex === undefined) {
    return { ok: true, skipped: true, data: order.stampsSyncResult || null };
  }

  const response = await fetch("api/stamps/transition", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pedidoId,
      evento,
      usuario: options.usuario || "sistema",
      items
    })
  });
  const data = await response.json().catch(() => ({}));
  return {
    ok: response.ok && data.success !== false,
    data,
    items,
    error: data.error || data.message || `El servidor respondio ${response.status}`
  };
}

function stampSyncEventRow(order = {}, eventResult = null, timestamp = new Date().toISOString()) {
  const eventName = eventResult?.evento || eventResult?.event || "";
  const items = Array.isArray(eventResult?.items) ? eventResult.items : stampItemsForOrder(order);
  return {
    at: timestamp,
    evento: eventName,
    ok: Boolean(eventResult?.ok),
    items: items.map((item) => item.itemRef),
    error: eventResult?.ok ? "" : (eventResult?.error || "No se pudo sincronizar estampas.")
  };
}

function applyStampSyncState(order = {}, eventResult = null, timestamp = new Date().toISOString()) {
  if (!eventResult || eventResult.skipped) return order;
  const eventName = eventResult.evento || eventResult.event || "";
  const eventRow = stampSyncEventRow(order, eventResult, timestamp);
  const nextEvents = [...(Array.isArray(order.stampsSyncEvents) ? order.stampsSyncEvents : []), eventRow].slice(-20);
  if (eventResult.ok && eventName === "preparacion_a_armado") {
    return {
      ...order,
      stampsSyncedAt: timestamp,
      stampsSyncResult: eventResult.data || null,
      stampsSyncError: "",
      stampsSyncEvents: nextEvents
    };
  }
  if (eventResult.ok && eventName === "cancelacion") {
    return {
      ...order,
      stampsSyncedAt: "",
      stampsSyncResult: eventResult.data || order.stampsSyncResult || null,
      stampsSyncError: "",
      stampsSyncEvents: nextEvents
    };
  }
  return {
    ...order,
    stampsSyncError: eventRow.error,
    stampsSyncEvents: nextEvents
  };
}

function expandStockItem(item) {
  const base = {
    sku: stockSkuAlias(item.sku),
    size: String(item.size || "").trim(),
    color: String(item.color || "").trim(),
    quantity: Number(item.quantity || 1)
  };
  const normalizedSku = normalize(base.sku);

  if (normalizedSku === "con-tech-nk") {
    return [
      { ...base, sku: "Camp-Tech-Nk" },
      { ...base, sku: "Pan-Tech-Nk" }
    ];
  }

  if (normalizedSku === "con-sst-ad") {
    return [
      { ...base, sku: "Camp-Sst-Ad" },
      { ...base, sku: "PAN-SST-AD" }
    ];
  }

  if (normalizedSku === "con-camp-3d") {
    return [
      { ...base, sku: "Camp-Clas-3D" },
      { ...base, sku: "Pan-Bag-Dtf" }
    ];
  }

  if (normalizedSku.startsWith("con-") && normalizedSku.endsWith("-dtf")) {
    return [
      { ...base, sku: "Buz-Cang-Dtf" },
      { ...base, sku: "PAN-BAG-DTF" }
    ];
  }

  return [base];
}

function resolveStockVariantForItem(item) {
  const normalizedSku = normalize(item.sku);
  const normalizedSize = normalize(item.size);
  const normalizedColor = normalize(item.color);
  const matches = stockItems.filter((stockItem) =>
    normalize(stockItem.sku) === normalizedSku &&
    normalize(stockItem.talle) === normalizedSize &&
    (!normalizedColor || normalize(stockItem.color) === normalizedColor)
  );
  if (matches.length === 1) {
    const match = matches[0];
    return {
      ...item,
      sku: match.sku || item.sku,
      size: match.talle || item.size,
      color: match.color || item.color
    };
  }
  return item;
}

function stockSkuAlias(sku) {
  const value = String(sku || "").trim();
  const normalizedSku = normalize(value).replace(/[\s_-]+/g, "-");
  const aliases = {
    "pan-bag-3d": "Pan-Bag-Dtf",
    "pan-sst-ad": "PAN-SST-AD",
    "pantalon-sst": "PAN-SST-AD",
    "pantalon-sst-ad": "PAN-SST-AD",
    "pantalon-sst-adidas": "PAN-SST-AD"
  };
  return aliases[normalizedSku] || value;
}

function addStockLogRows(order, data) {
  if (data.status === "already_processed") return;
  const timestamp = new Date().toISOString();
  const orderNumber = order.internalOrderNumber || order.id;
  const rows = (data.actualizados || []).map((item, index) => ({
    id: `${data.orderId || orderNumber}:${item.prenda_id || item.sku || index}:${timestamp}`,
    date: timestamp,
    orderId: data.orderId || orderNumber,
    orderNumber,
    customer: order.customer || "",
    requestedSku: item.requested_sku || item.requestedSku || item.skuSolicitado || item.sku || orderItems(order)[index]?.sku || "",
    deductedSku: item.sku || "",
    product: item.modelo || item.nombre || item.prenda_id || "",
    prendaId: item.prenda_id || item.prendaId || "",
    size: item.talle || item.size || "",
    color: item.color || "",
    quantity: Number(item.quantity || item.cantidad || 1),
    stockBefore: item.stockAnterior ?? item.stock_before ?? "",
    stockAfter: item.stockNuevo ?? item.stock_after ?? "",
    matchType: item.matchType || item.match_type || ""
  }));

  if (!rows.length) return;
  stockLogRows = [...rows, ...stockLogRows].slice(0, 500);
  save();
}

function stockItemsForOrder(order) {
  return orderItems(order)
    .flatMap(expandStockItem)
    .filter((item) => item.sku && item.size && item.quantity > 0);
}

function markBackupRowsCancelled(order, reason) {
  const cancelledAt = new Date().toISOString();
  const orderNumber = order.internalOrderNumber || order.storeOrderNumber || order.id;
  backupRows = backupRows.map((row) => {
    const sameOrder = row.orderId === order.id ||
      row.internalOrderNumber === order.internalOrderNumber ||
      row.storeOrderNumber === order.storeOrderNumber;
    if (!sameOrder) return row;
    return {
      ...row,
      cancelled: true,
      cancelledAt,
      cancelReason: reason || "Cancelado",
      invoice: row.invoice || "Cancelado",
      notes: [row.notes, `Cancelado ${orderNumber}`].filter(Boolean).join(" - ")
    };
  });
}

function cancelledRestoreStatus(row = {}) {
  return "preparacion";
}

function restoreOrderFromCancelledBackup(row) {
  const key = backupGroupKey(row);
  if (!key) return;
  const rows = backupRows.filter((item) => backupGroupKey(item) === key);
  if (!rows.length) return;
  const first = rows[0];
  const orderNumber = first.internalOrderNumber || first.storeOrderNumber || key;
  const confirmed = window.confirm(`Vas a restaurar el pedido ${orderNumber} y volvera al tablero en proceso. ¿Confirmas?`);
  if (!confirmed) return;

  const timestamp = new Date().toISOString();
  const restoredStatus = cancelledRestoreStatus(first);
  const restoredItems = rows.map((item) => ({
    sku: item.sku || "",
    name: item.name || "",
    color: item.color || "",
    size: item.size || "",
    purchasePrice: Number(item.purchasePrice || 0),
    salePrice: Number(item.salePrice || 0),
    quantity: Number(item.quantity || 1),
    imageUrl: item.imageUrl || ""
  }));
  const restoredOrder = createOrder({
    id: first.orderId || createId(),
    orderType: first.orderType || (restoredItems.length > 1 ? "mayorista" : "minorista"),
    storeOrderNumber: first.storeOrderNumber || "",
    customer: first.customer || "",
    customerPhone: first.customerPhone || "",
    customerEmail: first.customerEmail || "",
    customerDocument: first.customerDocument || "",
    purchasedAt: first.purchasedAt || first.createdAt || first.approvedAt || timestamp,
    internalOrderNumber: first.internalOrderNumber || "",
    items: restoredItems,
    shippingValue: Number(first.totalShippingValue || first.shippingValue || 0),
    shippingCompany: first.shippingCompany || "",
    shippingOption: first.shippingOption || "",
    shippingAddress: first.shippingAddress || {},
    salesChannel: first.salesChannel || "WhatsApp",
    account: first.account || "",
    postalCode: first.postalCode || "",
    invoice: first.invoice === "Cancelado" ? invoiceStatusForPayment(first.paymentMethod) : first.invoice,
    paymentMethod: first.paymentMethod || "Transferencia",
    paymentStatus: first.paymentStatus || "aprobado",
    labelReady: Boolean(first.labelReady),
    paymentReviewed: Boolean(first.paymentReviewed),
    stockDeductedAt: "",
    trackingCode: first.trackingCode || "",
    notes: first.notes || "",
    createdAt: first.createdAt || first.approvedDate || today(),
    approvedAt: first.approvedAt || first.approvedDate || timestamp,
    status: restoredStatus,
    insertedAt: timestamp,
    updatedAt: timestamp
  });

  orders = mergeItemsByKey([restoredOrder], orders, orderKey);
  dismissedOrderIds = dismissedOrderIds.filter((value) =>
    String(value || "").trim() !== String(restoredOrder.id || "").trim() &&
    String(value || "").trim() !== String(restoredOrder.internalOrderNumber || "").trim()
  );
  dismissedStoreOrders = dismissedStoreOrders.filter((value) =>
    String(value || "").trim() !== String(restoredOrder.storeOrderNumber || "").trim()
  );
  rememberRecoveredStoreOrder(restoredOrder.storeOrderNumber);
  backupRows = backupRows.map((item) => {
    if (backupGroupKey(item) !== key) return item;
    return {
      ...item,
      orderId: restoredOrder.id,
      cancelled: false,
      cancelledAt: "",
      cancelReason: "",
      invoice: item.invoice === "Cancelado" ? restoredOrder.invoice : item.invoice,
      status: restoredStatus,
      statusLabel: backupStatusLabel(restoredStatus),
      notes: compactNotes([item.notes, `Restaurado ${orderNumber}`])
    };
  });
  save();
  render();
  showView("proceso");
}

async function cancelProcessedOrder(id) {
  const order = findOperationalOrder(id);
  if (!order || !["armado", "rotulado"].includes(order.status)) return;

  const orderLabel = order.internalOrderNumber || order.storeOrderNumber || order.customer || "este pedido";
  const isExchange = order.recordType === "exchange";
  const confirmed = window.confirm(isExchange
    ? `¿Seguro que queres cancelar el cambio ${orderLabel}? Se va a quitar del tablero y quedara marcado en la solapa Cambios.`
    : `¿Seguro que queres cancelar el pedido ${orderLabel}? Se va a quitar del tablero y se intentara devolver el stock.`);
  if (!confirmed) return;

  const reason = window.prompt("Motivo de cancelacion (opcional):", "") || "";
  const items = Array.isArray(order.stockDeductedItems) && order.stockDeductedItems.length
    ? order.stockDeductedItems
    : (!order.stockBypassedAt ? stockItemsForOrder(order) : []);
  let stockReturned = false;
  let stampCancelResult = null;

  if (!isExchange && order.stockDeductedAt && items.length) {
    try {
      const result = await requestStockRestore(`${order.internalOrderNumber || order.id}-cancel`, items);
      stockReturned = result.ok;
      if (!result.ok) {
        const errorMessage = result.data.errores?.map((error) => `${error.sku}: ${stockErrorMessage(error.error)}`).join("\n") || stockErrorMessage(result.data.error) || "No se pudo devolver stock.";
        const passAnyway = window.confirm(`${errorMessage}\n\n¿Queres cancelar el pedido igual y dejar la devolucion de stock pendiente?`);
        if (!passAnyway) return;
      }
    } catch (error) {
      const passAnyway = window.confirm(`No se pudo conectar con stock: ${error.message}\n\n¿Queres cancelar el pedido igual y dejar la devolucion de stock pendiente?`);
      if (!passAnyway) return;
    }
  } else {
    stockReturned = true;
  }

  if (!isExchange && order.stampsSyncedAt) {
    try {
      stampCancelResult = await syncOrderStamps(order, "cancelacion", { force: true });
      stampCancelResult.evento = "cancelacion";
      if (!stampCancelResult.ok) {
        window.alert(`El pedido se va a cancelar igual, pero no pude avisar la cancelacion a Stock Estampas: ${stampCancelResult.error || "error desconocido"}`);
      }
    } catch (error) {
      stampCancelResult = { ok: false, evento: "cancelacion", error: error.message };
      window.alert(`El pedido se va a cancelar igual, pero no pude conectar con Stock Estampas: ${error.message}`);
    }
  }

  if (isExchange) {
    const timestamp = new Date().toISOString();
    exchanges = exchanges.map((exchange) => {
      if (exchange.id !== id) return exchange;
      return touchOrder({
        ...exchange,
        status: "cancelado",
        cancelled: true,
        cancelledAt: timestamp,
        cancelReason: reason || "Cancelado"
      }, timestamp);
    });
  } else {
    rememberDismissedOrder(order);
    markBackupRowsCancelled(order, reason);
    const stampStatus = stampCancelResult
      ? (stampCancelResult.ok ? "Estampas canceladas" : `Estampas pendiente: ${stampCancelResult.error || "error"}`)
      : "";
    stockLogRows = [{
      id: `cancel:${order.id}:${Date.now()}`,
      date: new Date().toISOString(),
      orderId: order.id,
      orderNumber: order.internalOrderNumber || order.storeOrderNumber || order.id,
      customer: order.customer || "",
      requestedSku: orderItems(order).map((item) => item.sku).filter(Boolean).join(", "),
      deductedSku: stockReturned ? "Devuelto" : "Pendiente",
      product: "Cancelacion",
      prendaId: "",
      size: "",
      color: "",
      quantity: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      stockBefore: "",
      stockAfter: stockReturned ? "OK" : "Pendiente",
      matchType: compactNotes(["cancelacion", stampStatus])
    }, ...stockLogRows].slice(0, 500);
    orders = orders.filter((item) => item.id !== id);
  }
  save();
  render();
}

function createManualOrder(formData) {
  evaluateMoneyExpressionInputs(manualForm);
  if (hasMoneyExpressionErrors(manualForm)) {
    alert("Revisa las cuentas marcadas en rojo antes de guardar.");
    return false;
  }
  formData = new FormData(manualForm);
  const formOrderType = formData.get("orderType") || "minorista";
  const items = collectManualItems(formData);
  const firstItem = items[0] || {};
  const validationError = manualOrderValidationError(formData, formOrderType, items);
  if (validationError) {
    alert(validationError);
    return false;
  }
  const fluxAddress = collectManualFluxAddress(formData);

  const payload = {
    storeOrderNumber: "",
    orderType: editingOriginalOrderType || formOrderType,
    customer: formData.get("customer"),
    customerPhone: formData.get("customerPhone"),
    sku: firstItem.sku || formData.get("sku"),
    color: firstItem.color || formData.get("color"),
    size: firstItem.size || formData.get("size"),
    purchasePrice: firstItem.purchasePrice ?? formData.get("purchasePrice"),
    salePrice: firstItem.salePrice ?? formData.get("salePrice"),
    quantity: firstItem.quantity ?? formData.get("quantity"),
    imageUrl: firstItem.imageUrl || retailImageData,
    shippingValue: formData.get("shippingValue"),
    shippingCompany: formData.get("shippingCompany"),
    shippingAddress: fluxAddress,
    salesChannel: formData.get("salesChannel"),
    account: formData.get("account"),
    postalCode: formData.get("postalCode"),
    paymentMethod: formData.get("paymentMethod"),
    fluxCollectAmount: formData.get("fluxCollectAmount"),
    customerNotes: formData.get("customerNotes"),
    externalNotes: formData.get("externalNotes"),
    internalNotes: formData.get("internalNotes"),
    notes: formData.get("internalNotes"),
    items
  };

  if (editingOrderId) {
    const timestamp = new Date().toISOString();
    let editedOrder = null;
    orders = orders.map((order) => {
      if (order.id !== editingOrderId) return order;
      const mergedItems = mergeEditedItemsWithOperationalState(payload.items, orderItems(order));
      editedOrder = createOrder({
        ...order,
        ...payload,
        items: mergedItems,
        id: order.id,
        storeOrderNumber: order.storeOrderNumber,
        storeOrderId: order.storeOrderId,
        internalOrderNumber: order.internalOrderNumber,
        purchasedAt: order.purchasedAt,
        status: order.status,
        statusUpdatedAt: order.statusUpdatedAt,
        approvedAt: order.approvedAt,
        createdAt: order.createdAt,
        insertedAt: order.insertedAt,
        updatedAt: timestamp
      });
      return editedOrder;
    });
    editingOrderId = "";
    editingOriginalOrderType = "";
    backupRows = syncBackupRowsWithOrders(backupRows);
    save();
    render();
    return {
      ok: true,
      stampModificationOrder: editedOrder?.stampsSyncedAt ? editedOrder : null
    };
  }

  orders.unshift(
    createOrder(payload)
  );
  save();
  render();
  return true;
}

function manualOrderValidationError(formData, formOrderType, items) {
  if (!String(formData.get("customer") || "").trim()) {
    return "Completa el nombre del cliente.";
  }
  if (normalize(formData.get("shippingCompany")) === "flux") {
    const missingAddress = [
      ["Provincia", formData.get("fluxProvince")],
      ["Localidad", formData.get("fluxLocality")],
      ["Calle", formData.get("fluxStreet")],
      ["Numero", formData.get("fluxNumber")],
      ["CP", formData.get("fluxPostalCode") || formData.get("postalCode")]
    ].filter(([, value]) => !String(value || "").trim()).map(([label]) => label);
    if (missingAddress.length) {
      return `Completa los datos de envio Flux: ${missingAddress.join(", ")}.`;
    }
  }
  const editingStoredOrder = editingOrderId && orders.some((order) => (
    order.id === editingOrderId && (order.storeOrderId || order.storeOrderNumber || normalize(order.salesChannel) === "tienda nube")
  ));
  if (!editingStoredOrder && normalize(formData.get("paymentMethod")) === "abonar al recibir" && moneyValue(formData.get("fluxCollectAmount")) <= 0) {
    return "Completa cuanto debe cobrar Flux al recibir.";
  }
  if (formOrderType === "mayorista") {
    if (!String(formData.get("customerPhone") || "").trim()) {
      return "Completa el WhatsApp del cliente para el pedido mayorista.";
    }
    if (!items.length) {
      return "Agrega al menos una fila antes de crear el pedido.";
    }
    return "";
  }
  if (!items.length) {
    return "Agrega al menos un producto.";
  }
  if (items.some((item) => Number(item.quantity || 0) < 1)) {
    return "Completa una cantidad valida.";
  }
  return "";
}

function collectManualFluxAddress(formData) {
  if (normalize(formData.get("shippingCompany")) !== "flux") return {};
  const street = String(formData.get("fluxStreet") || "").trim();
  const number = String(formData.get("fluxNumber") || "").trim();
  const locality = String(formData.get("fluxLocality") || "").trim();
  const province = String(formData.get("fluxProvince") || "").trim();
  const postalCode = String(formData.get("fluxPostalCode") || formData.get("postalCode") || "").trim();
  return {
    street,
    number,
    fullAddress: [street, number].filter(Boolean).join(" "),
    city: locality,
    locality,
    postalCode,
    cp: postalCode,
    province
  };
}

function exchangeFluxAddressValidationError(formData, shippingCompany) {
  if (normalize(shippingCompany) !== "flux") return "";
  const missingAddress = [
    ["Provincia", formData.get("exchangeFluxProvince")],
    ["Localidad", formData.get("exchangeFluxLocality")],
    ["Calle", formData.get("exchangeFluxStreet")],
    ["Numero", formData.get("exchangeFluxNumber")],
    ["CP", formData.get("exchangeFluxPostalCode") || formData.get("postalCode")]
  ].filter(([, value]) => !String(value || "").trim()).map(([label]) => label);
  return missingAddress.length ? `Completa los datos de envio Flux del cambio: ${missingAddress.join(", ")}.` : "";
}

function collectExchangeFluxAddress(formData, shippingCompany) {
  if (normalize(shippingCompany) !== "flux") return {};
  const street = String(formData.get("exchangeFluxStreet") || "").trim();
  const number = String(formData.get("exchangeFluxNumber") || "").trim();
  const locality = String(formData.get("exchangeFluxLocality") || "").trim();
  const province = String(formData.get("exchangeFluxProvince") || "").trim();
  const postalCode = String(formData.get("exchangeFluxPostalCode") || formData.get("postalCode") || "").trim();
  return {
    street,
    number,
    fullAddress: [street, number].filter(Boolean).join(" "),
    city: locality,
    locality,
    postalCode,
    cp: postalCode,
    province
  };
}

function createExchange(formData) {
  evaluateMoneyExpressionInputs(exchangeForm);
  if (hasMoneyExpressionErrors(exchangeForm)) {
    alert("Revisa las cuentas marcadas en rojo antes de guardar.");
    return false;
  }
  formData = new FormData(exchangeForm);
  const items = collectExchangeItems();
  if (!items.length) {
    alert("Agrega al menos un producto nuevo para crear el cambio.");
    return false;
  }
  const paymentResolution = String(formData.get("paymentResolution") || "sin-cargo");
  const differenceAmount = paymentResolution === "sin-cargo" ? 0 : moneyValue(formData.get("differenceAmount"));
  const shippingCompany = paymentResolution === "paga-al-recibir"
    ? "Flux"
    : String(formData.get("shippingCompany") || "");
  const exchangeFluxAddressError = exchangeFluxAddressValidationError(formData, shippingCompany);
  if (exchangeFluxAddressError) {
    alert(exchangeFluxAddressError);
    return false;
  }
  const fluxAddress = collectExchangeFluxAddress(formData, shippingCompany);
  const paymentMethod = paymentResolution === "transferencia"
    ? "Transferencia"
    : paymentResolution === "paga-al-recibir"
      ? "Abonar al recibir"
      : "Sin cargo";
  const firstItem = items[0] || {};
  const newSku = String(firstItem.sku || "").trim();
  const newProduct = items.map((item) => item.name || item.sku).filter(Boolean).join(" + ");
  const payload = {
    recordType: "exchange",
    orderType: "cambio",
    isExchange: true,
    customer: formData.get("customer"),
    customerPhone: formData.get("customerPhone"),
    sku: newSku,
    name: newProduct,
    quantity: 1,
    salePrice: 0,
    purchasePrice: 0,
    imageUrl: firstItem.imageUrl || "",
    paymentMethod,
    paymentStatus: paymentResolution === "transferencia" ? "pendiente" : "aprobado",
    paymentResolution,
    exchangeReturnProduct: formData.get("returnProduct"),
    exchangeNewProduct: newProduct,
    exchangeDifferenceAmount: differenceAmount,
    shippingCompany,
    shippingAddress: fluxAddress,
    postalCode: fluxAddress.postalCode || formData.get("postalCode"),
    salesChannel: "Cambio",
    account: paymentResolution === "paga-al-recibir" ? "Flux" : accountSettings.transfer,
    customerNotes: "",
    externalNotes: formData.get("externalNotes"),
    internalNotes: formData.get("internalNotes"),
    notes: formData.get("internalNotes"),
    items
  };

  if (editingExchangeId) {
    const timestamp = new Date().toISOString();
    exchanges = exchanges.map((exchange) => {
      if (exchange.id !== editingExchangeId) return exchange;
      return createOrder({
        ...exchange,
        ...payload,
        id: exchange.id,
        internalOrderNumber: exchange.internalOrderNumber,
        status: exchange.status,
        statusUpdatedAt: exchange.statusUpdatedAt,
        approvedAt: exchange.approvedAt,
        createdAt: exchange.createdAt,
        insertedAt: exchange.insertedAt,
        updatedAt: timestamp
      });
    });
    editingExchangeId = "";
    save();
    render();
    return true;
  }

  const created = createOrder({
    ...payload,
    internalOrderNumber: nextInternalNumber(),
    status: "preparacion",
    approvedAt: new Date().toISOString()
  });
  exchanges.unshift(created);
  save();
  render();
  return true;
}

function collectExchangeItems() {
  return [...exchangeRows.querySelectorAll(".exchange-row")]
    .map((row) => ({
      name: row.querySelector('[name="exchangeProduct"]').value,
      sku: row.querySelector('[name="exchangeSku"]').value,
      size: row.querySelector('[name="exchangeSize"]').value,
      color: row.querySelector('[name="exchangeColor"]').value,
      quantity: row.querySelector('[name="exchangeQuantity"]').value,
      salePrice: 0,
      purchasePrice: 0,
      imageUrl: row.dataset.imageUrl || ""
    }))
    .filter((item) => item.name || item.sku);
}

function collectManualItems(formData) {
  if ((formData.get("orderType") || "minorista") === "mayorista") {
    const rows = collectWholesaleItems();
    const pendingItem = collectWholesaleEntryItem();
    return pendingItem ? [...rows, pendingItem] : rows;
  }

  const rows = collectRetailItems();
  const pendingItem = collectRetailEntryItem(formData);
  return pendingItem ? [...rows, pendingItem] : rows;
}

function collectRetailItems() {
  return collectWholesaleItems(retailRows);
}

function itemOperationalKey(item = {}) {
  return [
    canonicalSkuKey(item.sku),
    normalize(item.size),
    normalize(item.color)
  ].join("|");
}

function sameOperationalItem(left = {}, right = {}) {
  return itemOperationalKey(left) === itemOperationalKey(right);
}

function mergeEditedItemsWithOperationalState(editedItems = [], previousItems = []) {
  return editedItems.map((item, index) => {
    const originalIndex = Number(item._originalIndex);
    const previous = Number.isInteger(originalIndex) && previousItems[originalIndex]
      ? previousItems[originalIndex]
      : previousItems[index];
    if (!previous || !sameOperationalItem(item, previous)) return item;
    return {
      ...item,
      picked: Boolean(previous.picked),
      pickStatus: previous.pickStatus || (previous.picked ? "armado" : ""),
      printOwner: detailItemPrintOwner(previous),
      printOwnerUpdatedAt: previous.printOwnerUpdatedAt || "",
      printedGarmentId: previous.printedGarmentId || "",
      printedGarmentUsedAt: previous.printedGarmentUsedAt || "",
      stockDeductedAt: previous.stockDeductedAt || "",
      stockDeductedItems: Array.isArray(previous.stockDeductedItems) ? previous.stockDeductedItems : [],
      stockPending: Boolean(previous.stockPending),
      stockError: previous.stockError || ""
    };
  });
}

function collectRetailEntryItem(formData) {
  const item = {
    sku: formData.get("sku"),
    color: formData.get("color"),
    size: formData.get("size"),
    purchasePrice: formData.get("purchasePrice"),
    salePrice: formData.get("salePrice"),
    quantity: formData.get("quantity"),
    imageUrl: retailImageData
  };
  return String(item.sku || "").trim() ? item : null;
}

function collectWholesaleItems(container = wholesaleRows) {
  return [...(container || wholesaleRows).querySelectorAll(".wholesale-row")]
    .map((row) => ({
      name: row.querySelector('[name="wholesaleName"]').value,
      sku: row.querySelector('[name="wholesaleSku"]').value,
      color: row.querySelector('[name="wholesaleColor"]').value,
      size: row.querySelector('[name="wholesaleSize"]').value,
      purchasePrice: row.querySelector('[name="wholesalePurchasePrice"]').value,
      salePrice: row.querySelector('[name="wholesaleSalePrice"]').value,
      quantity: row.querySelector('[name="wholesaleQuantity"]').value,
      imageUrl: row.dataset.imageUrl || "",
      _originalIndex: row.dataset.originalIndex
    }))
    .filter((item) => item.sku || item.name);
}

function collectWholesaleEntryItem() {
  if (!manualForm?.elements?.wholesaleEntrySku) return null;
  const item = {
    sku: manualForm.elements.wholesaleEntrySku.value,
    color: manualForm.elements.wholesaleEntryColor.value,
    size: manualForm.elements.wholesaleEntrySize.value,
    purchasePrice: manualForm.elements.wholesaleEntryPurchasePrice.value,
    salePrice: manualForm.elements.wholesaleEntrySalePrice.value,
    quantity: manualForm.elements.wholesaleEntryQuantity.value || 1,
    imageUrl: wholesaleEntryImageData
  };
  return String(item.sku || "").trim() ? item : null;
}

function render() {
  renderAccountSettings();
  if (activeView === "definir") renderPending();
  if (activeView === "proceso") {
    renderSkuFilter();
    renderBoard();
  }
  if (activeView === "precios") renderSkuPrices();
  if (activeView === "backup") renderBackup();
  if (activeView === "stock") renderStockLog();
  if (activeView === "cambios") renderExchanges();
  if (activeView === "prendas-estampadas") renderPrintedGarments();
  if (activeView === "whatsapp") renderWhatsappTemplateTool();

  updateText("#totalOrders", orders.length);
  updateText("#reviewOrders", orders.filter(needsPaymentReview).length);
  updateText("#todayOrders", backupRows.filter((row) => row.approvedDate === today()).length);
  updateText("#monthProducts", monthlyProductCount());
  const stampCounts = printStampCounts();
  updateText("#stampFbCount", stampCounts.FB);
  updateText("#stampMvCount", stampCounts.MV);

  document.querySelectorAll("[data-move]").forEach((button) => {
    button.addEventListener("click", () => moveOrder(button.dataset.id, Number(button.dataset.move)));
  });
  document.querySelectorAll("[data-cancel-order]").forEach((button) => {
    button.addEventListener("click", () => cancelProcessedOrder(button.dataset.cancelOrder));
  });
  document.querySelectorAll("[data-open-bulk-label]").forEach((button) => {
    button.addEventListener("click", openBulkLabelDialog);
  });
  document.querySelectorAll("[data-open-bulk-whatsapp]").forEach((button) => {
    button.addEventListener("click", sendBulkWhatsappTemplates);
  });
  document.querySelectorAll("[data-open-mp-review]").forEach((button) => {
    button.addEventListener("click", openMpReviewDialog);
  });

  document.querySelectorAll("[data-approve]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await approveOrder(button.dataset.approve, button);
      } catch (error) {
        window.alert(`No pude pasar el pedido a preparacion: ${error?.message || error}`);
        render();
      }
    });
  });

  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteOrder(button.dataset.delete));
  });

  document.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => openEditOrder(button.dataset.edit));
  });

  document.querySelectorAll("[data-edit-exchange]").forEach((button) => {
    button.addEventListener("click", () => openEditExchange(button.dataset.editExchange));
  });

  document.querySelectorAll("[data-label-ready]").forEach((button) => {
    button.addEventListener("click", () => toggleLabelReady(button.dataset.labelReady));
  });

  document.querySelectorAll("[data-payment-reviewed]").forEach((button) => {
    button.addEventListener("click", () => togglePaymentReviewed(button.dataset.paymentReviewed));
  });

  document.querySelectorAll("[data-tracking-code]").forEach((input) => {
    input.addEventListener("change", () => updateTrackingCode(input.dataset.trackingCode, input.value));
  });

  document.querySelectorAll("[data-customer-phone]").forEach((input) => {
    input.addEventListener("change", () => updateCustomerPhone(input.dataset.customerPhone, input.value));
  });

  document.querySelectorAll("[data-copy-phone]").forEach((button) => {
    button.addEventListener("click", () => copyCustomerPhone(button.dataset.copyPhone, button));
  });

  document.querySelectorAll("[data-send-whatsapp-template]").forEach((button) => {
    button.addEventListener("click", () => sendWhatsappTemplateForOrder(button.dataset.sendWhatsappTemplate, { button }));
  });

  document.querySelectorAll("[data-send-confirmation-whatsapp]").forEach((button) => {
    button.addEventListener("click", () => sendConfirmationWhatsapp(button.dataset.sendConfirmationWhatsapp, { button }));
  });

  document.querySelectorAll("[data-detail]").forEach((card) => {
    card.addEventListener("dblclick", () => openOrderDetail(card.dataset.detail));
  });

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.onclick = () => showView(button.dataset.view);
  });

  document.querySelectorAll("[data-shipping-filter]").forEach((button) => {
    button.onclick = () => {
      shippingFilter = button.dataset.shippingFilter;
      render();
    };
  });

  document.querySelectorAll("[data-preparation-sort]").forEach((button) => {
    button.onclick = () => {
      preparationSort = button.dataset.preparationSort;
      render();
    };
  });

  document.querySelectorAll("[data-process-payment-filter]").forEach((button) => {
    button.onclick = () => {
      processPaymentFilter = button.dataset.processPaymentFilter;
      render();
    };
  });

  document.querySelectorAll("[data-dispatched-whatsapp-filter]").forEach((button) => {
    button.onclick = () => {
      dispatchedWhatsappFilter = button.dataset.dispatchedWhatsappFilter;
      render();
    };
  });

  document.querySelectorAll("[data-payment-filter]").forEach((button) => {
    button.onclick = () => {
      paymentFilter = button.dataset.paymentFilter;
      render();
    };
  });
}

function updateText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function monthlyProductCount() {
  const monthPrefix = today().slice(0, 7);
  return historicBackupRows().reduce((total, row) => {
    if (row.cancelled) return total;
    if (backupRowMonth(row) !== monthPrefix) return total;
    const quantity = Number(row.quantity ?? row.cantidad ?? 1);
    return total + (Number.isFinite(quantity) ? quantity : 1);
  }, 0);
}

function printStampCounts() {
  const counted = new Set();
  const counts = { FB: 0, MV: 0 };

  backupRows.forEach((row) => {
    if (!isDtfSku(row.sku)) return;
    const owner = detailItemPrintOwner(row);
    if (!owner) return;
    const key = String(row.id || `${row.orderId || row.internalOrderNumber || row.storeOrderNumber || ""}:${row.sku || ""}:${row.size || ""}:${row.color || ""}`).trim();
    if (key && counted.has(key)) return;
    if (key) counted.add(key);
    const quantity = Number(row.quantity || 1);
    counts[owner] = (counts[owner] || 0) + (Number.isFinite(quantity) ? quantity : 1);
  });

  operationalOrders().forEach((order) => {
    orderItems(order).forEach((item, index) => {
      if (!isDtfSku(item.sku)) return;
      const owner = detailItemPrintOwner(item);
      if (!owner) return;
      const key = `${order.id}:${index}`;
      if (counted.has(key)) return;
      counted.add(key);
      const quantity = Number(item.quantity || 1);
      counts[owner] = (counts[owner] || 0) + (Number.isFinite(quantity) ? quantity : 1);
    });
  });

  return counts;
}

function backupRowMonth(row = {}) {
  const raw = String(row.approvedDate || row.date || row.createdAt || "").trim();
  if (!raw) return "";
  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}`;
  match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}`;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric",
      month: "2-digit"
    }).formatToParts(parsed).reduce((dateParts, part) => {
      dateParts[part.type] = part.value;
      return dateParts;
    }, {});
    return `${parts.year}-${parts.month}`;
  }
  return "";
}

function renderPending() {
  const pendingOrders = orders.filter((order) =>
    order.status === "definir" &&
    matchesPaymentFilter(order) &&
    matchesCustomerSearch(order, pendingSearch)
  );
  pendingList.innerHTML = pendingOrders.map(renderPendingOrder).join("") || '<p class="empty">No hay pedidos a definir.</p>';

  document.querySelectorAll("[data-payment-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.paymentFilter === paymentFilter);
  });
}

function renderBoard() {
  board.innerHTML = processStatuses.map(renderColumn).join("");
  document.querySelectorAll("[data-shipping-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.shippingFilter === shippingFilter);
  });
  document.querySelectorAll("[data-preparation-sort]").forEach((button) => {
    button.classList.toggle("active", button.dataset.preparationSort === preparationSort);
  });
  document.querySelectorAll("[data-process-payment-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.processPaymentFilter === processPaymentFilter);
  });
  document.querySelectorAll("[data-dispatched-whatsapp-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.dispatchedWhatsappFilter === dispatchedWhatsappFilter);
  });
}

function renderColumn(status) {
  const columnOrders = sortColumnOrders(status.id, operationalOrders().filter((order) =>
    order.status === status.id &&
    matchesActiveProcessFilters(order, status.id)
  ));
  const bulkAction = status.id === "preparacion"
    ? '<button class="column-action" type="button" data-open-mp-review>Copiar MP sin revisar</button>'
    : status.id === "rotulado"
      ? '<button class="column-action" type="button" data-open-bulk-label>Pasar a despachado</button>'
      : status.id === "despachado"
        ? `
          <div class="column-action-stack">
            <button class="column-action whatsapp-bulk-action" type="button" data-open-bulk-whatsapp>Enviar WhatsApp masivo</button>
            <div class="column-mini-filters" aria-label="Filtro de WhatsApp despachado">
              <button class="column-mini-filter" type="button" data-dispatched-whatsapp-filter="todos">Todos</button>
              <button class="column-mini-filter" type="button" data-dispatched-whatsapp-filter="no-enviado">No enviados</button>
            </div>
          </div>
        `
        : "";
  return `
    <article class="column">
      <header>
        <h2>${status.label}</h2>
        <span class="count">${columnOrders.length}</span>
        ${bulkAction}
      </header>
      <div class="cards">
        ${columnOrders.map(renderOrder).join("") || '<p class="empty">No hay pedidos en este canasto.</p>'}
      </div>
    </article>
  `;
}

function sortColumnOrders(statusId, columnOrders) {
  if (preparationSort === "number-desc") {
    return [...columnOrders].sort((orderA, orderB) => orderSortNumber(orderB) - orderSortNumber(orderA));
  }
  if (statusId !== "preparacion") return columnOrders;
  return [...columnOrders].sort((orderA, orderB) => {
    const timeA = orderSortTime(orderA);
    const timeB = orderSortTime(orderB);
    return preparationSort === "oldest" ? timeA - timeB : timeB - timeA;
  });
}

function orderSortTime(order) {
  return new Date(order.purchasedAt || order.approvedAt || order.insertedAt || order.createdAt || 0).getTime() || 0;
}

function renderPendingOrder(order) {
  const confirmationButton = renderConfirmationWhatsappButton(order);
  const cardClass = orderCardClass(order, "wide");
  return `
    <article class="${cardClass}" data-detail="${order.id}">
      ${confirmationButton}
      ${renderOrderMain(order)}
      <div class="card-actions three">
        <button class="danger-action" type="button" data-delete="${order.id}">Eliminar</button>
        <button type="button" data-edit="${order.id}">Editar</button>
        <button type="button" data-approve="${order.id}">Pasar a preparacion</button>
      </div>
    </article>
  `;
}

function renderOrder(order) {
  const deleteButton =
    order.status === "preparacion" && order.recordType !== "exchange" ? `<button class="danger-action" type="button" data-delete="${order.id}">Eliminar</button>` : "";
  const editButton = order.recordType === "exchange"
    ? `<button type="button" data-edit-exchange="${order.id}">Editar</button>`
    : `<button type="button" data-edit="${order.id}">Editar</button>`;
  const actionButtons = renderProcessActions(order);
  const actionsCount = [deleteButton, editButton, ...actionButtons].filter(Boolean).length;
  const actionsClass = actionsCount === 1 ? "single" : actionsCount === 3 ? "three" : "";
  const cardClass = orderCardClass(order);
  const confirmationButton = renderConfirmationWhatsappButton(order);
  return `
    <article class="${cardClass}" data-detail="${order.id}">
      ${confirmationButton}
      ${renderOrderMain(order)}
      ${renderDispatchPanel(order)}
      <div class="card-actions ${actionsClass}">
        ${deleteButton}
        ${editButton}
        ${actionButtons.join("")}
      </div>
    </article>
  `;
}

function renderConfirmationWhatsappButton(order) {
  if (!canSendConfirmationWhatsapp(order)) return "";
  const sentAt = order.status === "preparacion" ? order.whatsappOrderContactSentAt : order.whatsappConfirmationSentAt;
  return `<button class="pending-whatsapp-action ${sentAt ? "sent" : ""}" type="button" data-send-confirmation-whatsapp="${order.id}">${sentAt ? "Reenviar WhatsApp" : "Enviar WhatsApp"}</button>`;
}

function isPayOnDeliveryAndreani(order) {
  return normalize(order.paymentMethod) === "abonar al recibir" &&
    normalize(order.shippingCompany).includes("andreani");
}

function orderCardClass(order, extra = "") {
  return [
    "order-card",
    extra,
    order.isExchange ? "exchange-order" : "",
    orderHasAvailablePrintedGarment(order) ? "printed-garment-match" : "",
    addressIssues(order).length ? "shipping-suspicious" : "",
    isPayOnDeliveryAndreani(order) ? "pay-on-delivery-andreani" : ""
  ].filter(Boolean).join(" ");
}

function renderDispatchPanel(order) {
  if (order.status !== "despachado") return "";
  const canSendWhatsapp = canSendWhatsappTemplate(order);
  const disabled = canSendWhatsapp ? "" : " disabled";
  const tnNotice = isTiendanubeTrackingCarrier(order) && order.trackingCode
    ? `<span class="dispatch-note">${order.tiendanubeFulfilledAt ? "Tienda Nube avisada" : "Aviso por Tienda Nube"}</span>`
    : "";
  const waNotice = order.whatsappTemplateSentAt
    ? `<span class="dispatch-note">WhatsApp enviado ${escapeHtml(formatDateTime(order.whatsappTemplateSentAt))}</span>`
    : "";
  const phoneValue = escapeHtml(order.customerPhone || "");
  return `
    <div class="dispatch-panel">
      <label>
        WhatsApp
        <span class="dispatch-phone-row">
          <input value="${phoneValue}" placeholder="Ej: 11 5555 5555" data-customer-phone="${order.id}">
          <button class="copy-phone-button" type="button" data-copy-phone="${order.id}" title="Copiar WhatsApp" aria-label="Copiar WhatsApp">&#9633;</button>
        </span>
      </label>
      <label>
        Seguimiento
        <input value="${escapeHtml(order.trackingCode || "")}" placeholder="Codigo de seguimiento" data-tracking-code="${order.id}">
      </label>
      ${tnNotice}
      ${waNotice}
      <button class="whatsapp-action${disabled}" type="button" data-send-whatsapp-template="${order.id}"${canSendWhatsapp ? "" : " disabled"}>Enviar WhatsApp</button>
    </div>
  `;
}

function renderProcessActions(order) {
  const actionsByStatus = {
    preparacion: [
      { direction: 1, label: "Pasar a armado" }
    ],
    armado: [
      { direction: -1, label: "Volver" },
      { direction: 1, label: "Pasar a rotulado" }
    ],
    rotulado: [
      { direction: -1, label: "Volver" },
      { direction: 1, label: "Pasar a despachado" }
    ],
    despachado: [
      { direction: -1, label: "Volver" }
    ]
  };

  const moveActions = (actionsByStatus[order.status] || []).map((action) => (
    `<button type="button" data-id="${order.id}" data-move="${action.direction}">${action.label}</button>`
  ));
  const cancelAction = ["armado", "rotulado"].includes(order.status)
    ? `<button class="danger-action" type="button" data-cancel-order="${order.id}">Cancelar</button>`
    : "";

  return [...moveActions, cancelAction].filter(Boolean);
}

function renderOrderMain(order) {
  const review = order.status === "definir" && needsPaymentReview(order);
  const items = orderItems(order);
  const itemCount = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const visibleDtfItems = dtfFilterActive && order.status === "preparacion"
    ? items.filter((item) => isDtfSku(item.sku))
    : [];
  const detailItems = visibleDtfItems.length ? visibleDtfItems : items;
  const detailItemCount = visibleDtfItems.length
    ? visibleDtfItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
    : itemCount;
  const detailSku = visibleDtfItems.length
    ? visibleDtfItems[0].sku || visibleDtfItems[0].name || "DTF/3D"
    : order.recordType === "exchange" ? order.exchangeNewProduct || order.sku : order.sku;
  const detailPrefix = visibleDtfItems.length ? "DTF/3D: " : "";
  const totalPurchase = items.reduce((sum, item) => sum + Number(item.purchasePrice || 0) * Number(item.quantity || 0), 0);
  const totalSale = items.reduce((sum, item) => sum + Number(item.salePrice || 0) * Number(item.quantity || 0), 0);
  const purchaseTime = formatDateTime(order.purchasedAt || order.approvedAt || order.createdAt);
  const titleNumber = order.status === "definir" && order.storeOrderNumber
    ? `TN ${order.storeOrderNumber}`
    : order.internalOrderNumber || "Sin numero interno";
  const labelButton = ["preparacion", "armado"].includes(order.status)
    ? `<button class="label-ready ${order.labelReady ? "active" : ""}" type="button" data-label-ready="${order.id}">Rotulado</button>`
    : "";
  const paymentReviewedButton = order.status === "preparacion" && normalize(order.paymentMethod) === "mercado pago"
    ? `<button class="payment-reviewed ${order.paymentReviewed ? "active" : ""}" type="button" data-payment-reviewed="${order.id}">Revisado</button>`
    : "";
  const statusButtons = labelButton || paymentReviewedButton
    ? `<div class="status-buttons">${labelButton}${paymentReviewedButton}</div>`
    : "";
  const pickedCount = items.filter((item) => item.picked).length;
  const addressIssueList = addressIssues(order);
  const partialTag = pickedCount > 0 && pickedCount < items.length
    ? `<span class="tag partial">Parcial ${pickedCount}/${items.length}</span>`
    : pickedCount > 0 && items.length > 1
      ? '<span class="tag partial">Todos dentro</span>'
      : "";
  return `
    <div class="order-title">
      <h3>${escapeHtml(titleNumber)} - ${escapeHtml(order.customer)}</h3>
      ${statusButtons}
    </div>
    ${purchaseTime ? `<p class="purchase-time">Compra: ${escapeHtml(purchaseTime)}</p>` : ""}
    <p class="detail-line">${detailPrefix}${escapeHtml(detailSku)}${detailItems.length > 1 ? ` + ${detailItems.length - 1} producto(s)` : ""} | Cant. ${detailItemCount}</p>
    <div class="tags">
      <span class="tag">${escapeHtml(order.salesChannel)}</span>
      ${order.orderType === "mayorista" ? '<span class="tag warn">Mayorista</span>' : ""}
      ${order.recordType === "exchange" || order.isExchange ? '<span class="tag exchange">Cambio</span>' : ""}
      <span class="tag">${escapeHtml(order.paymentMethod)}</span>
      <span class="tag">${escapeHtml(order.shippingCompany || "Sin envio")}</span>
      ${order.fluxSentAt ? '<span class="tag partial">Flux enviado</span>' : ""}
      ${order.whatsappConfirmationSentAt ? '<span class="tag partial">WhatsApp conf.</span>' : ""}
      ${order.tiendanubeFulfilledAt ? '<span class="tag partial">TN avisado</span>' : ""}
      ${isPayOnDeliveryAndreani(order) ? '<span class="tag andreani-cash">Abonar + Andreani</span>' : ""}
      ${orderHasAvailablePrintedGarment(order) ? '<span class="tag printed-garment">Prenda estampada disponible</span>' : ""}
      ${partialTag}
      ${order.storeOrderNumber ? `<span class="tag">TN ${escapeHtml(order.storeOrderNumber)}</span>` : ""}
      ${review ? '<span class="tag warn">Revisar pago</span>' : ""}
      ${addressIssueList.length ? '<span class="tag danger">Envio sospechoso</span>' : ""}
    </div>
    <dl class="order-fields">
      ${order.recordType === "exchange"
        ? `<div><dt>Diferencia por cambio</dt><dd>${formatMoney(order.exchangeDifferenceAmount || 0)}</dd></div>`
        : `<div><dt>Compra</dt><dd>${formatMoney(totalPurchase)}</dd></div><div><dt>Venta</dt><dd>${formatMoney(totalSale)}</dd></div>`}
      <div><dt>Envio</dt><dd>${formatMoney(order.shippingValue)}</dd></div>
    </dl>
    ${order.recordType === "exchange" ? `<p><strong>Devuelve:</strong> ${escapeHtml(order.exchangeReturnProduct || "")}</p>` : ""}
    ${order.packagingNote ? `<p class="packaging-note"><strong>Empaquetado:</strong> ${escapeHtml(order.packagingNote)}</p>` : ""}
    ${internalOrderNote(order) ? `<p>${escapeHtml(internalOrderNote(order))}</p>` : ""}
  `;
}

function toggleLabelReady(id) {
  updateOperationalOrder(id, (order) => {
    if (order.id !== id) return order;
    return touchOrder({ ...order, labelReady: !order.labelReady });
  });
  save();
  render();
}

function togglePaymentReviewed(id) {
  updateOperationalOrder(id, (order) => {
    if (order.id !== id) return order;
    return touchOrder({ ...order, paymentReviewed: !order.paymentReviewed });
  });
  save();
  render();
}

async function updateTrackingCode(id, trackingCode) {
  let updatedOrder = null;
  updateOperationalOrder(id, (order) => {
    if (order.id !== id) return order;
    updatedOrder = touchOrder({ ...order, trackingCode: String(trackingCode || "").trim() });
    return updatedOrder;
  });
  save();
  render();
  if (!updatedOrder || !canNotifyTiendanubeTracking(updatedOrder)) return;
  try {
    const result = await notifyTiendanubeFulfillment(updatedOrder);
    const timestamp = new Date().toISOString();
    updateOperationalOrder(id, (order) => touchOrder({
      ...order,
      tiendanubeFulfilledAt: timestamp,
      tiendanubeTrackingCode: String(updatedOrder.trackingCode || "").trim(),
      tiendanubeFulfillmentResult: result.result || result
    }, timestamp));
    save();
    render();
  } catch (error) {
    window.alert(`No pude cargar el seguimiento en Tienda Nube: ${error.message}`);
  }
}

function updateCustomerPhone(id, customerPhone) {
  updateOperationalOrder(id, (order) => {
    if (order.id !== id) return order;
    return touchOrder({ ...order, customerPhone: String(customerPhone || "").trim() });
  });
  save();
  render();
}

async function copyTextToClipboard(text) {
  const value = String(text || "");
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const fallback = document.createElement("textarea");
    fallback.value = value;
    fallback.setAttribute("readonly", "");
    fallback.style.position = "fixed";
    fallback.style.left = "-9999px";
    document.body.appendChild(fallback);
    fallback.select();
    const copied = document.execCommand("copy");
    fallback.remove();
    if (!copied) throw new Error("No pude copiar al portapapeles.");
  }
}

async function copyCustomerPhone(id, button = null) {
  const order = findOperationalOrder(id);
  const phone = String(order?.customerPhone || "").trim();
  if (!phone) {
    window.alert("Este pedido no tiene WhatsApp cargado.");
    return;
  }
  try {
    await navigator.clipboard.writeText(phone);
  } catch {
    const fallback = document.createElement("textarea");
    fallback.value = phone;
    fallback.setAttribute("readonly", "");
    fallback.style.position = "fixed";
    fallback.style.left = "-9999px";
    document.body.appendChild(fallback);
    fallback.select();
    document.execCommand("copy");
    fallback.remove();
  }
  if (!button) return;
  const original = button.innerHTML;
  button.textContent = "OK";
  button.classList.add("copied");
  setTimeout(() => {
    button.innerHTML = original || "&#9633;";
    button.classList.remove("copied");
  }, 900);
}

function detailItemStatus(item = {}) {
  return item.pickStatus || (item.picked ? "armado" : "");
}

function detailItemWasHandled(item = {}) {
  return Boolean(item.picked || detailItemStatus(item));
}

function detailItemPrintOwner(item = {}) {
  const owner = String(item.printOwner || "").trim().toUpperCase();
  return owner === "FB" || owner === "MV" ? owner : "";
}

function printedGarmentTextKey(value = "") {
  return normalize(value).replace(/[^a-z0-9]+/g, "");
}

function printedGarmentMatchKey(item = {}) {
  return [
    printedGarmentTextKey(item.sku),
    printedGarmentTextKey(item.color),
    printedGarmentTextKey(item.size)
  ].join("|");
}

function printedGarmentIsAvailable(garment = {}) {
  return !garment.usedAt && !garment.usedOrderId;
}

function availablePrintedGarmentsForItem(item = {}) {
  const key = printedGarmentMatchKey(item);
  if (key === "||") return [];
  return printedGarments.filter((garment) =>
    printedGarmentIsAvailable(garment) &&
    printedGarmentMatchKey(garment) === key
  );
}

function printedGarmentForItem(item = {}) {
  const usedId = String(item.printedGarmentId || "").trim();
  if (usedId) return printedGarments.find((garment) => garment.id === usedId) || null;
  return availablePrintedGarmentsForItem(item)[0] || null;
}

function orderHasAvailablePrintedGarment(order = {}) {
  if (!["preparacion", "armado"].includes(order.status)) return false;
  return orderItems(order).some((item) =>
    !item.printedGarmentId &&
    availablePrintedGarmentsForItem(item).length > 0
  );
}

function createPrintedGarment(input = {}) {
  const now = new Date().toISOString();
  return {
    id: input.id || `printed-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    sku: String(input.sku || "").trim(),
    color: String(input.color || "").trim(),
    size: String(input.size || "").trim(),
    note: String(input.note || "").trim(),
    imageUrl: input.imageUrl || "",
    createdAt: input.createdAt || now,
    usedAt: input.usedAt || "",
    usedOrderId: input.usedOrderId || "",
    usedInternalOrderNumber: input.usedInternalOrderNumber || "",
    usedCustomer: input.usedCustomer || ""
  };
}

function renderPrintedGarments() {
  if (!printedGarmentBody) return;
  const rows = [...printedGarments].sort((left, right) => {
    if (printedGarmentIsAvailable(left) !== printedGarmentIsAvailable(right)) {
      return printedGarmentIsAvailable(left) ? -1 : 1;
    }
    return timestampValue(right.createdAt) - timestampValue(left.createdAt);
  });
  printedGarmentBody.innerHTML = rows.map((garment) => {
    const available = printedGarmentIsAvailable(garment);
    const usedOrder = [garment.usedInternalOrderNumber, garment.usedCustomer].filter(Boolean).join(" - ");
    return `
      <tr class="${available ? "" : "printed-garment-used-row"}">
        <td>${garment.imageUrl ? `<img class="table-thumb" src="${escapeHtml(garment.imageUrl)}" alt="">` : ""}</td>
        <td>${escapeHtml(garment.sku)}</td>
        <td>${escapeHtml(garment.color)}</td>
        <td>${escapeHtml(garment.size)}</td>
        <td><span class="printed-garment-status ${available ? "available" : "used"}">${available ? "Disponible" : "Usada"}</span></td>
        <td>${escapeHtml(usedOrder)}</td>
        <td>${escapeHtml(garment.note || "")}</td>
        <td class="printed-garment-actions">
          <button class="table-action" type="button" data-edit-printed-garment="${garment.id}">Editar</button>
          <button class="table-action" type="button" data-duplicate-printed-garment="${garment.id}">Duplicar</button>
          ${available ? "" : `<button class="table-action" type="button" data-restore-printed-garment="${garment.id}">Restaurar</button>`}
          <button class="table-action danger-action" type="button" data-delete-printed-garment="${garment.id}">Eliminar</button>
        </td>
      </tr>
    `;
  }).join("") || '<tr><td colspan="8">No hay prendas estampadas cargadas.</td></tr>';

  printedGarmentBody.querySelectorAll("[data-delete-printed-garment]").forEach((button) => {
    button.addEventListener("click", () => deletePrintedGarment(button.dataset.deletePrintedGarment));
  });
  printedGarmentBody.querySelectorAll("[data-edit-printed-garment]").forEach((button) => {
    button.addEventListener("click", () => startEditPrintedGarment(button.dataset.editPrintedGarment));
  });
  printedGarmentBody.querySelectorAll("[data-duplicate-printed-garment]").forEach((button) => {
    button.addEventListener("click", () => duplicatePrintedGarment(button.dataset.duplicatePrintedGarment));
  });
  printedGarmentBody.querySelectorAll("[data-restore-printed-garment]").forEach((button) => {
    button.addEventListener("click", () => restorePrintedGarment(button.dataset.restorePrintedGarment));
  });
}

function addPrintedGarment(event) {
  event.preventDefault();
  const formData = new FormData(printedGarmentForm);
  const input = {
    sku: formData.get("sku"),
    color: formData.get("color"),
    size: formData.get("size"),
    note: formData.get("note"),
    imageUrl: printedGarmentImageData
  };
  const garment = createPrintedGarment(input);
  if (!garment.sku || !garment.color || !garment.size) {
    window.alert("Completa SKU, color y talle.");
    return;
  }
  if (editingPrintedGarmentId) {
    printedGarments = printedGarments.map((item) => item.id === editingPrintedGarmentId ? {
      ...item,
      sku: garment.sku,
      color: garment.color,
      size: garment.size,
      note: garment.note,
      imageUrl: garment.imageUrl
    } : item);
  } else {
    printedGarments = [garment, ...printedGarments];
  }
  resetPrintedGarmentForm();
  save();
  render();
}

function resetPrintedGarmentForm() {
  editingPrintedGarmentId = "";
  printedGarmentImageData = "";
  setPrintedGarmentImage("");
  printedGarmentForm.reset();
  const submit = printedGarmentForm.querySelector('[type="submit"]');
  if (submit) submit.textContent = "Agregar prenda";
  if (cancelPrintedGarmentEdit) cancelPrintedGarmentEdit.hidden = true;
}

function startEditPrintedGarment(id) {
  const garment = printedGarments.find((item) => item.id === id);
  if (!garment || !printedGarmentForm) return;
  editingPrintedGarmentId = id;
  printedGarmentForm.elements.sku.value = garment.sku || "";
  printedGarmentForm.elements.color.value = garment.color || "";
  printedGarmentForm.elements.size.value = garment.size || "";
  printedGarmentForm.elements.note.value = garment.note || "";
  setPrintedGarmentImage(garment.imageUrl || "");
  const submit = printedGarmentForm.querySelector('[type="submit"]');
  if (submit) submit.textContent = "Guardar cambios";
  if (cancelPrintedGarmentEdit) cancelPrintedGarmentEdit.hidden = false;
  printedGarmentForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

function duplicatePrintedGarment(id) {
  const garment = printedGarments.find((item) => item.id === id);
  if (!garment) return;
  const copy = createPrintedGarment({
    sku: garment.sku,
    color: garment.color,
    size: garment.size,
    note: garment.note,
    imageUrl: garment.imageUrl
  });
  printedGarments = [copy, ...printedGarments];
  save();
  render();
}

async function deletePrintedGarment(id) {
  const garment = printedGarments.find((item) => item.id === id);
  if (!garment) return;
  if (!window.confirm(`Eliminar la prenda estampada ${garment.sku} ${garment.color} ${garment.size}?`)) return;
  const deleteKey = String(garment.id || printedGarmentMatchKey(garment)).trim();
  if (deleteKey) deletedPrintedGarmentIds = mergeUniqueStrings(deletedPrintedGarmentIds, [deleteKey]);
  printedGarments = printedGarments.filter((item) => item.id !== id);
  orders = orders.map((order) => ({
    ...order,
    items: orderItems(order).map((item) => item.printedGarmentId === id ? {
      ...item,
      printedGarmentId: "",
      printedGarmentUsedAt: ""
    } : item)
  }));
  exchanges = exchanges.map((exchange) => ({
    ...exchange,
    items: orderItems(exchange).map((item) => item.printedGarmentId === id ? {
      ...item,
      printedGarmentId: "",
      printedGarmentUsedAt: ""
    } : item)
  }));
  save();
  try {
    await saveRemoteState({ immediate: true });
  } catch (error) {
    window.alert("La prenda se elimino en este navegador, pero no pude confirmar el borrado en la nube. Si vuelve a aparecer, espera unos segundos y recarga.");
  }
  render();
}

function restorePrintedGarment(id) {
  printedGarments = printedGarments.map((garment) => garment.id === id ? {
    ...garment,
    usedAt: "",
    usedOrderId: "",
    usedInternalOrderNumber: "",
    usedCustomer: ""
  } : garment);
  orders = orders.map((order) => ({
    ...order,
    items: orderItems(order).map((item) => item.printedGarmentId === id ? {
      ...item,
      printedGarmentId: "",
      printedGarmentUsedAt: ""
    } : item)
  }));
  exchanges = exchanges.map((order) => ({
    ...order,
    items: orderItems(order).map((item) => item.printedGarmentId === id ? {
      ...item,
      printedGarmentId: "",
      printedGarmentUsedAt: ""
    } : item)
  }));
  save();
  render();
}

async function usePrintedGarmentForItem(orderId, itemIndex, garmentId) {
  const targetIndex = Number(itemIndex);
  const currentOrder = findOperationalOrder(orderId);
  const currentItem = orderItems(currentOrder || {})[targetIndex];
  const garment = printedGarments.find((item) => item.id === garmentId);
  if (!currentOrder || !currentItem || !garment) return false;
  if (!printedGarmentIsAvailable(garment)) {
    window.alert("Esa prenda estampada ya figura como usada.");
    return false;
  }
  if (printedGarmentMatchKey(currentItem) !== printedGarmentMatchKey(garment)) {
    window.alert("La prenda estampada no coincide con SKU, color y talle.");
    return false;
  }

  const timestamp = new Date().toISOString();
  let updatedOrder = null;
  const usedGarment = {
    ...garment,
    usedAt: timestamp,
    usedOrderId: currentOrder.id,
    usedInternalOrderNumber: currentOrder.internalOrderNumber || currentOrder.storeOrderNumber || "",
    usedCustomer: currentOrder.customer || ""
  };
  printedGarments = printedGarments.map((item) => item.id === garmentId ? {
    ...item,
    ...usedGarment
  } : item);
  updateOperationalOrder(orderId, (order) => {
    if (order.id !== orderId) return order;
    const items = orderItems(order).map((item, index) => index === targetIndex ? {
      ...item,
      printedGarmentId: garmentId,
      printedGarmentUsedAt: timestamp,
      stockPending: false,
      stockError: "",
      stampsSyncError: ""
    } : item);
    updatedOrder = touchOrder({ ...order, items }, timestamp);
    return updatedOrder;
  });
  save();
  render();
  openOrderDetail(orderId);
  try {
    await savePrintedGarmentUseNow(updatedOrder, usedGarment);
  } catch (error) {
    console.warn("No se pudo guardar el uso de prenda estampada inmediatamente", error);
    window.alert(`La prenda quedo marcada en esta pantalla, pero no pude confirmarla en la nube: ${error.message}`);
  }
  return true;
}

function syncBackupPrintOwnerForOrder(order) {
  if (!order) return;
  backupRows = backupRows.map((row) => {
    const sameOrder = row.orderId === order.id ||
      (String(row.internalOrderNumber || "").trim() && String(row.internalOrderNumber || "").trim() === String(order.internalOrderNumber || "").trim()) ||
      (String(row.storeOrderNumber || "").trim() && String(row.storeOrderNumber || "").trim() === String(order.storeOrderNumber || "").trim());
    if (!sameOrder) return row;
    const item = itemForBackupRow(order, row);
    if (!item) return row;
    return {
      ...row,
      printOwner: detailItemPrintOwner(item),
      printOwnerUpdatedAt: item.printOwnerUpdatedAt || row.printOwnerUpdatedAt || ""
    };
  });
}

function detailItemStockOrderId(order, itemIndex) {
  const orderNumber = order.internalOrderNumber || order.storeOrderNumber || order.id;
  return `${orderNumber}-item-${Number(itemIndex) + 1}-stock`;
}

async function decrementDetailItemStock(order, item, itemIndex) {
  if (item.printedGarmentId || item.stockDeductedAt || order.stockDeductedAt) {
    return { ok: true, deductedItems: [] };
  }

  await loadStockItems();
  const items = expandStockItem(item)
    .map(resolveStockVariantForItem)
    .filter((stockItem) => stockItem.sku && stockItem.size && Number(stockItem.quantity || 1) > 0);

  if (!items.length) {
    window.alert("No pude descontar stock porque el producto no tiene SKU y talle completos.");
    return { ok: false, deductedItems: [], errors: ["Sin SKU o talle completos."] };
  }

  const deductedItems = [];
  const errors = [];

  for (const [expandedIndex, stockItem] of items.entries()) {
    const lineOrderId = `${detailItemStockOrderId(order, itemIndex)}-${expandedIndex + 1}`;
    try {
      const result = await requestStockDecrement(lineOrderId, [stockItem]);
      if (result.ok) {
        addStockLogRows(order, result.data);
        deductedItems.push(stockItem);
        continue;
      }
      const message = result.data.errores?.map((error) => `${error.sku}: ${stockErrorMessage(error.error)}`).join("\n") ||
        stockErrorMessage(result.data.error) ||
        "No se pudo descontar stock.";
      errors.push(`${stockItem.sku} / ${stockItem.size || "sin talle"} / ${stockItem.color || "sin color"} x${stockItem.quantity}: ${message}`);
    } catch (error) {
      errors.push(`${stockItem.sku} / ${stockItem.size || "sin talle"} / ${stockItem.color || "sin color"} x${stockItem.quantity}: ${error.message}`);
    }
  }

  if (errors.length) {
    const successMessage = deductedItems.length
      ? `Se descontaron ${deductedItems.length} linea(s).`
      : "No se desconto ninguna linea.";
    window.alert(`${successMessage}\n\nNo se pudo descontar:\n${errors.join("\n")}`);
  }

  return { ok: errors.length === 0, deductedItems, errors };
}

async function setDetailItemStatus(orderId, itemIndex, status, options = {}) {
  const targetIndex = Number(itemIndex);
  const nextStatus = status === "separado" ? "separado" : "armado";
  const currentOrder = findOperationalOrder(orderId);
  const currentItem = orderItems(currentOrder || {})[targetIndex];
  if (!currentOrder || !currentItem) return false;

  const currentStatus = detailItemStatus(currentItem);
  const alreadySameStatus = currentStatus === nextStatus;
  if (alreadySameStatus) {
    if (options.keepSameStatus) return true;
    let updatedOrder = null;
    const timestamp = new Date().toISOString();
    updateOperationalOrder(orderId, (order) => {
      if (order.id !== orderId) return order;
      const items = orderItems(order).map((item, index) => (
        index === targetIndex
          ? {
              ...item,
              picked: false,
              pickStatus: "",
              stockPending: false,
              stockError: ""
            }
          : item
      ));
      updatedOrder = touchOrder({ ...order, items }, timestamp);
      return updatedOrder;
    });
    save();
    render();
    if (updatedOrder && options.reopen !== false) openOrderDetail(orderId);
    try {
      await saveOperationalOrderNow(updatedOrder);
    } catch (error) {
      console.warn("No se pudo guardar el desmarcado del producto inmediatamente", error);
      window.alert(`El producto quedo desmarcado en esta pantalla, pero no pude confirmarlo en la nube: ${error.message}`);
    }
    return true;
  }

  const skipStockDecrement = Boolean(options.skipStockDecrement) || (currentStatus === "separado" && nextStatus === "armado");
  const stockResult = skipStockDecrement
    ? { ok: true, deductedItems: [], errors: [] }
    : await decrementDetailItemStock(currentOrder, currentItem, targetIndex);
  const shouldSyncStampItem = nextStatus === "armado" && !currentItem.printedGarmentId && isStampSku(currentItem.sku) && !currentItem.stampsSyncedAt && !currentOrder.stampsSyncedAt;
  let stampResult = null;
  if (shouldSyncStampItem) {
    const evento = "preparacion_a_armado";
    try {
      stampResult = await syncOrderStamps(currentOrder, evento, {
        itemIndex: targetIndex
      });
      stampResult.evento = evento;
      if (!stampResult.ok) {
        window.alert(`El producto queda marcado como armado, pero no pude sincronizar la estampa: ${stampResult.error || "error desconocido"}`);
      }
    } catch (error) {
      stampResult = { ok: false, evento, error: error.message, items: stampItemsForOrder(currentOrder, { itemIndex: targetIndex }) };
      window.alert(`El producto queda marcado como armado, pero no pude conectar con Stock Estampas: ${error.message}`);
    }
  }

  let updatedOrder = null;
  const timestamp = new Date().toISOString();
  updateOperationalOrder(orderId, (order) => {
    if (order.id !== orderId) return order;
    const stampEventRow = stampResult && !stampResult.skipped ? stampSyncEventRow(order, stampResult, timestamp) : null;
    const nextStampEvents = stampEventRow
      ? [...(Array.isArray(order.stampsSyncEvents) ? order.stampsSyncEvents : []), stampEventRow].slice(-20)
      : order.stampsSyncEvents;
    const items = orderItems(order).map((item, index) => (
      index === targetIndex
        ? {
            ...item,
            picked: true,
            pickStatus: nextStatus,
            stockDeductedAt: item.stockDeductedAt || order.stockDeductedAt || (stockResult.deductedItems.length ? timestamp : ""),
            stockDeductedItems: mergeStockDeductedItems(item.stockDeductedItems, stockResult.deductedItems),
            stockPending: skipStockDecrement ? item.stockPending : !stockResult.deductedItems.length,
            stockError: skipStockDecrement ? item.stockError : (stockResult.ok ? "" : (stockResult.errors || []).join("\n")),
            stampsSyncedAt: item.stampsSyncedAt || order.stampsSyncedAt || (stampResult?.ok && !stampResult.skipped ? timestamp : ""),
            stampsSyncError: stampResult ? (stampResult.ok ? "" : (stampResult.error || "No se pudo sincronizar estampas.")) : item.stampsSyncError
          }
        : item
    ));
    const allItemsDeducted = items.length > 0 && items.every((item) => item.stockDeductedAt);
    updatedOrder = touchOrder({
      ...order,
      items,
      stockDeductedAt: order.stockDeductedAt || (allItemsDeducted ? timestamp : ""),
      stockDeductedItems: mergeStockDeductedItems(order.stockDeductedItems, stockResult.deductedItems),
      stampsSyncEvents: nextStampEvents,
      stampsSyncError: stampResult && !stampResult.ok ? (stampResult.error || "No se pudo sincronizar estampas.") : order.stampsSyncError
    }, timestamp);
    return updatedOrder;
  });
  save();
  render();
  if (updatedOrder && options.reopen !== false) openOrderDetail(orderId);
  try {
    await saveOperationalOrderNow(updatedOrder);
  } catch (error) {
    console.warn("No se pudo guardar el estado del producto inmediatamente", error);
    window.alert(`El producto quedo marcado en esta pantalla, pero no pude confirmarlo en la nube: ${error.message}`);
  }
  if (stockResult.deductedItems.length && !options.silentSuccess) {
    window.alert(`Stock descontado correctamente (${stockResult.deductedItems.length} linea(s)).`);
  }
  return true;
}

async function setDetailItemPrintOwner(orderId, itemIndex, owner) {
  const targetIndex = Number(itemIndex);
  const nextOwner = String(owner || "").trim().toUpperCase();
  if (!["FB", "MV"].includes(nextOwner)) return false;
  const currentOrder = findOperationalOrder(orderId);
  const currentItem = orderItems(currentOrder || {})[targetIndex];
  if (!currentOrder || !currentItem || !isDtfSku(currentItem.sku)) return false;

  let updatedOrder = null;
  const timestamp = new Date().toISOString();
  updateOperationalOrder(orderId, (order) => {
    if (order.id !== orderId) return order;
    const items = orderItems(order).map((item, index) => (
      index === targetIndex
        ? {
            ...item,
            printOwner: detailItemPrintOwner(item) === nextOwner ? "" : nextOwner,
            printOwnerUpdatedAt: timestamp
          }
        : item
    ));
    updatedOrder = touchOrder({ ...order, items }, timestamp);
    return updatedOrder;
  });
  syncBackupPrintOwnerForOrder(updatedOrder);
  save();
  render();
  if (updatedOrder) openOrderDetail(orderId);
  try {
    await saveOperationalOrderNow(updatedOrder);
  } catch (error) {
    console.warn("No se pudo guardar la marca de estampa inmediatamente", error);
    window.alert(`La marca quedo en esta pantalla, pero no pude confirmarla en la nube: ${error.message}`);
  }
  return true;
}

function toggleDetailItemPicked(orderId, itemIndex) {
  const targetIndex = Number(itemIndex);
  let updatedOrder = null;
  const timestamp = new Date().toISOString();
  updateOperationalOrder(orderId, (order) => {
    if (order.id !== orderId) return order;
    const items = orderItems(order).map((item, index) => (
      index === targetIndex ? { ...item, picked: !detailItemWasHandled(item), pickStatus: detailItemWasHandled(item) ? "" : "armado" } : item
    ));
    updatedOrder = touchOrder({ ...order, items }, timestamp);
    return updatedOrder;
  });
  save();
  flushRemoteSaveNow().catch((error) => console.warn("No se pudo guardar el marcado parcial inmediatamente", error));
  render();
  if (updatedOrder) openOrderDetail(orderId);
}

async function markAllDetailItemsPicked(orderId) {
  const currentOrder = findOperationalOrder(orderId);
  const total = orderItems(currentOrder || {}).length;
  for (let index = 0; index < total; index += 1) {
    await setDetailItemStatus(orderId, index, "armado", {
      reopen: false,
      silentSuccess: true,
      keepSameStatus: true,
      skipStockDecrement: true
    });
  }
  window.alert("Productos marcados como armados.");
  openOrderDetail(orderId);
}

function orderItems(order) {
  return Array.isArray(order.items) && order.items.length
    ? order.items
    : [{
        sku: order.sku,
        color: order.color,
        size: order.size,
        purchasePrice: order.purchasePrice,
        salePrice: order.salePrice,
        quantity: order.quantity,
        imageUrl: order.imageUrl,
        picked: Boolean(order.picked),
        pickStatus: order.pickStatus || (order.picked ? "armado" : ""),
        printOwner: order.printOwner || "",
        printOwnerUpdatedAt: order.printOwnerUpdatedAt || "",
        printedGarmentId: order.printedGarmentId || "",
        printedGarmentUsedAt: order.printedGarmentUsedAt || "",
        stockDeductedAt: order.stockDeductedAt || "",
        stockDeductedItems: Array.isArray(order.stockDeductedItems) ? order.stockDeductedItems : [],
        stampsSyncedAt: order.stampsSyncedAt || "",
        stampsSyncError: order.stampsSyncError || ""
      }];
}

function buildWhatsappUrl(order) {
  const phone = whatsappPhoneNumber(order.customerPhone);
  if (!phone) return "";
  const message = whatsappMessage(order);
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function canSendConfirmationWhatsapp(order) {
  if (!whatsappPhoneNumber(order.customerPhone)) return false;
  if (order.status === "definir") {
    return normalize(order.paymentMethod) === "abonar al recibir";
  }
  return order.status === "preparacion";
}

function confirmationOrderNumber(order) {
  return String(order.storeOrderNumber || order.internalOrderNumber || "").trim();
}

function whatsappOrderPayloadContext(order = {}) {
  return {
    orderId: order.id || "",
    internalOrderNumber: order.internalOrderNumber || "",
    storeOrderNumber: order.storeOrderNumber || "",
    orderNumber: confirmationOrderNumber(order),
    customerName: order.customer || "",
    paymentMethod: order.paymentMethod || "",
    paymentStatus: order.paymentStatus || "",
    fluxCollectAmount: order.fluxCollectAmount || "",
    shippingCompany: order.shippingCompany || ""
  };
}

async function sendConfirmationWhatsapp(id, options = {}) {
  const order = findOperationalOrder(id);
  if (!order) return;
  if (!canSendConfirmationWhatsapp(order)) {
    window.alert("Este pedido no tiene WhatsApp o no esta habilitado para enviar confirmacion.");
    return;
  }

  const payload = {
    ...whatsappOrderPayloadContext(order),
    to: whatsappPhoneNumber(order.customerPhone),
    type: order.status === "preparacion" ? "order_contact" : "confirmation",
    customerName: firstCustomerName(order.customer),
    orderNumber: confirmationOrderNumber(order)
  };

  const button = options.button || null;
  const originalText = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "Enviando mediante Kommo...";
  }
  try {
    const response = await fetch("api/whatsapp/send-template", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      throw new Error(data.error || `El servidor respondio ${response.status}`);
    }
    const timestamp = new Date().toISOString();
    updateOperationalOrder(id, (current) => touchOrder({
      ...current,
      ...(order.status === "preparacion"
        ? {
            whatsappOrderContactSentAt: timestamp,
            whatsappOrderContactEngine: data.engine || "",
            whatsappOrderContactResult: data.result || data,
            whatsappOrderContactError: ""
          }
        : {
            whatsappConfirmationSentAt: timestamp,
            whatsappConfirmationEngine: data.engine || "",
            whatsappConfirmationResult: data.result || data,
            whatsappConfirmationError: ""
          })
    }, timestamp));
    save();
    render();
    window.alert(whatsappSendSuccessMessage(data, payload));
  } catch (error) {
    updateOperationalOrder(id, (current) => touchOrder({
      ...current,
      ...(order.status === "preparacion"
        ? { whatsappOrderContactError: error.message }
        : { whatsappConfirmationError: error.message })
    }));
    save();
    render();
    window.alert(whatsappNoSendMessage(error));
  } finally {
    if (button && document.body.contains(button)) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

function renderWhatsappTemplateTool() {
  if (!whatsappTemplateStatus || whatsappTemplateStatus.dataset.keepMessage === "true") return;
  whatsappTemplateStatus.textContent = "";
  whatsappTemplateStatus.className = "whatsapp-template-status";
}

function setWhatsappTemplateStatus(message, type = "") {
  if (!whatsappTemplateStatus) return;
  whatsappTemplateStatus.textContent = message;
  whatsappTemplateStatus.className = `whatsapp-template-status ${type}`.trim();
  whatsappTemplateStatus.dataset.keepMessage = message ? "true" : "";
  if (message) {
    window.setTimeout(() => {
      if (!whatsappTemplateStatus || whatsappTemplateStatus.textContent !== message) return;
      whatsappTemplateStatus.dataset.keepMessage = "";
    }, 5000);
  }
}

function formatKommoDebug(debug) {
  if (!debug || typeof debug !== "object") return "";
  return `\n\nDebug Kommo:\n${JSON.stringify(debug, null, 2)}`;
}

function whatsappNoSendMessage(error) {
  const message = String(error?.message || error || "");
  if (message.includes("No se pudo enviar el mensaje mediante Kommo")) return message;
  return `No se pudo enviar. No se envio ningun WhatsApp. ${message}`;
}

function whatsappSendSuccessMessage(data = {}, payload = {}) {
  if (data.engine === "meta_fallback") {
    return "WhatsApp enviado por Meta. No quedo como bot/chat saliente en Kommo.";
  }
  if (payload.type === "tracking") return "WhatsApp enviado correctamente.";
  return "Lanzamiento solicitado a Kommo.";
}

async function sendStandaloneWhatsappTemplate(event) {
  event.preventDefault();
  if (!whatsappTemplateForm) return;
  const form = new FormData(whatsappTemplateForm);
  const payload = {
    to: form.get("phone"),
    type: "order_contact",
    source: "manual_tab",
    customerName: form.get("customerName"),
    orderNumber: form.get("orderNumber")
  };
  if (!String(payload.to || "").trim() || !String(payload.customerName || "").trim() || !String(payload.orderNumber || "").trim()) {
    setWhatsappTemplateStatus("Completa nombre, pedido y WhatsApp.", "error");
    return;
  }

  if (whatsappTemplateSubmit) whatsappTemplateSubmit.disabled = true;
  setWhatsappTemplateStatus("Enviando WhatsApp...", "loading");
  try {
    const response = await fetch("api/whatsapp/send-template", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      const error = new Error(data.error || `El servidor respondio ${response.status}`);
      error.debug = data.debug || null;
      throw error;
    }
    setWhatsappTemplateStatus(whatsappSendSuccessMessage(data, payload), "success");
  } catch (error) {
    setWhatsappTemplateStatus(`No pude enviar el WhatsApp: ${error.message}${formatKommoDebug(error.debug)}`, "error");
  } finally {
    if (whatsappTemplateSubmit) whatsappTemplateSubmit.disabled = false;
  }
}

function firstCustomerName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "Cliente";
}

function whatsappTemplatePayload(order) {
  const phone = whatsappPhoneNumber(order.customerPhone);
  if (!phone) return { error: "Falta WhatsApp del cliente." };
  const context = whatsappOrderPayloadContext(order);

  const company = normalize(order.shippingCompany);
  if (company.includes("flux")) {
    return { ...context, to: phone, type: "flux", trackingUrl: "" };
  }

  const trackingUrl = trackingLinkForOrder(order);
  if (!trackingUrl) return { error: "Falta link de seguimiento para completar la plantilla." };
  return { ...context, to: phone, type: "tracking", trackingUrl };
}

function canSendWhatsappTemplate(order) {
  return !Boolean(whatsappTemplatePayload(order).error);
}

function whatsappTemplateAlreadySent(order) {
  const payload = whatsappTemplatePayload(order);
  if (payload.error || !order.whatsappTemplateSentAt) return false;
  return order.whatsappTemplateType === payload.type &&
    String(order.whatsappTemplateTrackingUrl || "") === String(payload.trackingUrl || "");
}

async function sendWhatsappTemplateForOrder(id, options = {}) {
  const order = findOperationalOrder(id);
  if (!order) return { ok: false, error: "No encontre el pedido." };
  const payload = whatsappTemplatePayload(order);
  if (options.engine) payload.engine = options.engine;
  if (options.forceMeta) payload.forceMeta = true;
  if (options.source) payload.source = options.source;
  if (payload.error) {
    if (!options.silent) window.alert(payload.error);
    return { ok: false, error: payload.error };
  }

  const button = options.button || null;
  const originalText = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = payload.type === "tracking" ? "Enviando..." : "Enviando mediante Kommo...";
  }
  try {
    const response = await fetch("api/whatsapp/send-template", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      throw new Error(data.error || `El servidor respondio ${response.status}`);
    }
    const timestamp = new Date().toISOString();
    updateOperationalOrder(id, (current) => touchOrder({
      ...current,
      whatsappTemplateSentAt: timestamp,
      whatsappTemplateType: payload.type,
      whatsappTemplateTrackingUrl: payload.trackingUrl || "",
      whatsappTemplateResult: data.result || data,
      whatsappTemplateError: ""
    }, timestamp));
    save();
    render();
    if (!options.silent) window.alert(whatsappSendSuccessMessage(data, payload));
    return { ok: true, data };
  } catch (error) {
    updateOperationalOrder(id, (current) => touchOrder({
      ...current,
      whatsappTemplateError: error.message
    }));
    save();
    render();
    if (!options.silent) {
      window.alert(payload.type === "tracking"
        ? `No pude enviar el WhatsApp: ${error.message}`
        : whatsappNoSendMessage(error));
    }
    return { ok: false, error: error.message };
  } finally {
    if (button && document.body.contains(button)) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

function dispatchedWhatsappCandidateOrders() {
  return operationalOrders().filter((order) =>
    order.status === "despachado" &&
    matchesCustomerSearch(order, processSearch) &&
    matchesShippingFilter(order) &&
    matchesSkuFilter(order) &&
    matchesProcessPaymentFilter(order, "despachado") &&
    canSendWhatsappTemplate(order) &&
    !whatsappTemplateAlreadySent(order)
  ).sort((left, right) => orderSortNumber(left) - orderSortNumber(right));
}

async function sendBulkWhatsappTemplates() {
  const selectedOrders = dispatchedWhatsappCandidateOrders();
  if (!selectedOrders.length) {
    window.alert("No hay pedidos despachados visibles con WhatsApp listo para enviar.");
    return;
  }

  const confirmed = window.confirm(`Se van a enviar ${selectedOrders.length} WhatsApp por plantilla a los pedidos despachados visibles segun los filtros actuales. ¿Confirmas?`);
  if (!confirmed) return;

  let sent = 0;
  const errors = [];
  for (const order of selectedOrders) {
    const result = await sendWhatsappTemplateForOrder(order.id, { silent: true, source: "bulk_dispatched" });
    if (result?.ok) sent += 1;
    else errors.push(`${orderLabel(order)}: ${result?.error || "no enviado"}`);
  }
  window.alert([
    `WhatsApp enviados: ${sent}/${selectedOrders.length}`,
    errors.length ? `Errores:\n${errors.slice(0, 8).join("\n")}` : "",
    errors.length > 8 ? `y ${errors.length - 8} mas.` : ""
  ].filter(Boolean).join("\n"));
}

function whatsappPhoneNumber(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("549")) return digits;
  if (digits.startsWith("54")) return `549${digits.slice(2).replace(/^0/, "").replace(/^(\d{2,4})15/, "$1")}`;
  const withoutTrunk = digits.replace(/^0/, "");
  const withoutMobilePrefix = withoutTrunk.replace(/^(\d{2,4})15/, "$1");
  if (withoutMobilePrefix.length >= 8 && withoutMobilePrefix.length <= 11) return `549${withoutMobilePrefix}`;
  return digits;
}

function trackingCodeForUrl(code) {
  return String(code || "").trim().replace(/\s+/g, "");
}

function trackingLinkForOrder(order) {
  const code = trackingCodeForUrl(order.trackingCode);
  if (!code) return "";
  const company = normalize(order.shippingCompany);
  const encoded = encodeURIComponent(code);
  if (company.includes("andreani")) return `https://www.andreani.com/envio/${encoded}`;
  if (company.includes("correo argentino") || company.includes("correoargentino")) {
    return `https://www.correoargentino.com.ar/formularios/e-commerce?id=${encoded}`;
  }
  return "";
}

function isTiendanubeTrackingCarrier(order) {
  const company = normalize(order.shippingCompany);
  return company.includes("andreani") ||
    company.includes("correo argentino") ||
    company.includes("correoargentino");
}

function shouldUseWhatsappForDispatch(order) {
  return !(isTiendanubeTrackingCarrier(order) && String(order.trackingCode || "").trim());
}

function canNotifyTiendanubeTracking(order) {
  const trackingCode = String(order.trackingCode || "").trim();
  if (!trackingCode || !isTiendanubeTrackingCarrier(order)) return false;
  if (order.recordType === "exchange" || order.isExchange) return false;
  if (!String(order.storeOrderId || "").trim()) return false;
  return !(order.tiendanubeFulfilledAt && String(order.tiendanubeTrackingCode || "").trim() === trackingCode);
}

async function notifyTiendanubeFulfillment(order) {
  const storeOrderId = String(order.storeOrderId || "").trim();
  const trackingNumber = String(order.trackingCode || "").trim();
  if (!storeOrderId || !trackingNumber) throw new Error("Falta pedido de Tienda Nube o codigo de seguimiento.");

  const response = await fetch(`api/tiendanube/orders/${encodeURIComponent(storeOrderId)}/fulfill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trackingNumber,
      trackingUrl: trackingLinkForOrder(order),
      notifyCustomer: true
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.error || `El servidor respondio ${response.status}`);
  }
  return data;
}

function whatsappMessage(order) {
  const company = normalize(order.shippingCompany);
  if (company.includes("flux")) {
    return [
      "Buenas",
      "Hoy te visitan de 15 a 22, la logistica se contacta antes de pasar.",
      "Agradecemos una foto cuando te llega."
    ].join("\n");
  }

  const tracking = String(order.trackingCode || "").trim();
  const trackingLink = trackingLinkForOrder(order);
  if (trackingLink) {
    return [
      "Buenas",
      "Tu paquete fue despachado. Podes seguirlo desde este link:",
      trackingLink,
      "Agradecemos una foto cuando te llega."
    ].join("\n");
  }

  if (tracking) {
    return `Tu paquete ya fue despachado. Este es el codigo de seguimiento: ${tracking}.`;
  }

  return "Tu paquete ya fue despachado.";
}

function openOrderDetail(id) {
  const order = findOperationalOrder(id);
  if (!order) return;
  const internalNumber = order.internalOrderNumber || "Sin numero interno";
  const storeNumber = order.recordType === "exchange"
    ? "Cambio"
    : order.storeOrderNumber ? `TN: ${order.storeOrderNumber}` : "TN: sin numero";
  const shippingMethod = String(order.shippingCompany || order.shippingOption || "").trim();
  const shippingKey = normalize(shippingMethod);
  const shippingClass = shippingKey.includes("andreani") ? "andreani"
    : shippingKey.includes("flux") ? "flux"
    : shippingKey.includes("correo") ? "correo"
    : shippingKey.includes("via cargo") || shippingKey.includes("viacargo") ? "via-cargo"
    : "";
  orderDetailDialog.querySelector("h2").innerHTML = `
    <span class="detail-title-main">
      <span>${escapeHtml(internalNumber)} - ${escapeHtml(order.customer)}</span>
      ${shippingMethod ? `<span class="detail-shipping-pill ${shippingClass ? `shipping-${shippingClass}` : ""}">${escapeHtml(shippingMethod)}</span>` : ""}
    </span>
    <small>${escapeHtml(storeNumber)}</small>
  `;
  const addressIssueList = addressIssues(order);
  const address = order.shippingAddress || {};
  const addressParts = [
    [address.street || address.fullAddress, address.number].filter(Boolean).join(" "),
    address.city || address.locality,
    address.province,
    order.postalCode || address.postalCode
  ].filter(Boolean);
  const addressNotice = addressIssueList.length ? `
    <section class="address-issues">
      <strong>Revisar direccion</strong>
      ${addressParts.length ? `<span>${escapeHtml(addressParts.join(" | "))}</span>` : ""}
      <span>${addressIssueList.map(escapeHtml).join(" | ")}</span>
    </section>
  ` : "";
  const packagingNotice = order.packagingNote ? `
    <section class="detail-note">
      <strong>Nota de empaquetado</strong>
      <span>${escapeHtml(order.packagingNote)}</span>
    </section>
  ` : "";
  const exchangeNotice = order.isExchange ? `
    <section class="exchange-detail-alert">CAMBIO</section>
  ` : "";
  const orderNote = internalOrderNote(order);
  const orderNotice = orderNote ? `
    <section class="order-detail-note">
      <strong>NOTA INTERNA</strong>
      <span>${escapeHtml(orderNote)}</span>
    </section>
  ` : "";
  const logisticsNote = logisticsOrderNotes(order);
  const logisticsNotice = logisticsNote ? `
    <section class="logistics-detail-note">
      <strong>Indicaciones para logistica</strong>
      <span>${escapeHtml(logisticsNote)}</span>
    </section>
  ` : "";
  orderDetailBody.innerHTML = exchangeNotice + orderNotice + addressNotice + logisticsNotice + packagingNotice + orderItems(order).map((item, index) => {
    const status = detailItemStatus(item);
    const printOwner = detailItemPrintOwner(item);
    const usedPrintedGarment = item.printedGarmentId ? printedGarmentForItem(item) : null;
    const availablePrintedGarments = item.printedGarmentId ? [] : availablePrintedGarmentsForItem(item);
    const printedGarmentNotice = usedPrintedGarment ? `
      <div class="printed-garment-detail used ${usedPrintedGarment.imageUrl ? "has-image" : ""}">
        ${usedPrintedGarment.imageUrl ? `<img src="${escapeHtml(usedPrintedGarment.imageUrl)}" alt="">` : ""}
        <span>Usa prenda estampada ${escapeHtml(usedPrintedGarment.sku)} / ${escapeHtml(usedPrintedGarment.color)} / ${escapeHtml(usedPrintedGarment.size)}</span>
      </div>
    ` : availablePrintedGarments.length ? `
      <div class="printed-garment-detail ${availablePrintedGarments[0].imageUrl ? "has-image" : ""}">
        ${availablePrintedGarments[0].imageUrl ? `<img src="${escapeHtml(availablePrintedGarments[0].imageUrl)}" alt="">` : ""}
        <span>Disponible: ${escapeHtml(availablePrintedGarments[0].sku)} / ${escapeHtml(availablePrintedGarments[0].color)} / ${escapeHtml(availablePrintedGarments[0].size)}</span>
        <button class="detail-pick printed-use" type="button" data-use-printed-garment="${order.id}" data-item-index="${index}" data-printed-garment-id="${availablePrintedGarments[0].id}">Usar prenda</button>
      </div>
    ` : "";
    const printButtons = isDtfSku(item.sku) ? `
      <button class="detail-pick print-owner fb ${printOwner === "FB" ? "active" : ""}" type="button" data-detail-print-owner="${order.id}" data-item-index="${index}" data-print-owner="FB">FB</button>
      <button class="detail-pick print-owner mv ${printOwner === "MV" ? "active" : ""}" type="button" data-detail-print-owner="${order.id}" data-item-index="${index}" data-print-owner="MV">MV</button>
    ` : "";
    return `
    <article class="detail-item ${detailItemWasHandled(item) ? "picked" : ""} ${status ? `item-${status}` : ""}">
      <div class="thumb">${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="">` : ""}</div>
      <div>
        <strong>${escapeHtml(item.name || item.sku)}</strong>
        <span>${escapeHtml(item.size || "Sin talle")} ${item.color ? `| ${escapeHtml(item.color)}` : ""}</span>
        <span>SKU: ${escapeHtml(item.sku)}</span>
        <b>${Number(item.quantity || 1)}x ${formatMoney(item.salePrice)}</b>
        ${item.stockPending ? '<span class="stock-pending">Stock pendiente</span>' : ""}
        ${printedGarmentNotice}
      </div>
      ${order.status === "preparacion" ? `
        <div class="detail-pick-actions">
          <button class="detail-pick separated ${status === "separado" ? "active" : ""}" type="button" data-detail-item-status="${order.id}" data-item-index="${index}" data-item-status="separado">Separado</button>
          <button class="detail-pick assembled ${status === "armado" ? "active" : ""}" type="button" data-detail-item-status="${order.id}" data-item-index="${index}" data-item-status="armado">Armado</button>
          ${printButtons}
        </div>
      ` : ""}
    </article>
  `}).join("");
  orderDetailActions.innerHTML = order.status === "preparacion"
    ? `
      <button class="button" type="button" data-detail-pick-all="${order.id}">Armar todos</button>
      <button class="button primary" type="button" data-detail-move="${order.id}">Pasar a armado</button>
    `
    : "";
  orderDetailActions.hidden = order.status !== "preparacion";
  orderDetailDialog.showModal();
}

function openImagePreview(imageUrl) {
  if (!imagePreviewDialog || !imagePreview || !imageUrl) return;
  imagePreview.src = imageUrl;
  imagePreviewDialog.showModal();
}

function closeImagePreviewDialog() {
  if (!imagePreviewDialog) return;
  imagePreviewDialog.close();
  if (imagePreview) imagePreview.removeAttribute("src");
}

function addWholesaleItemRow(item = {}, container = wholesaleRows) {
  const row = document.createElement("div");
  const disableSkuAutofill = Boolean(item.disableSkuAutofill);
  row.className = "wholesale-row";
  row.dataset.imageUrl = item.imageUrl || "";
  if (item.originalIndex !== undefined) row.dataset.originalIndex = String(item.originalIndex);
  if (disableSkuAutofill) row.dataset.disableSkuAutofill = "true";
  row.innerHTML = `
    <input name="wholesaleName" value="${escapeHtml(item.name || "")}" placeholder="Producto">
    <input name="wholesaleSku" value="${escapeHtml(item.sku || "")}" ${disableSkuAutofill ? "" : 'list="skuOptions"'} placeholder="SKU">
    <input name="wholesaleSize" value="${escapeHtml(item.size || "")}" placeholder="Talle">
    <input name="wholesaleColor" value="${escapeHtml(item.color || "")}" placeholder="Color">
    <input name="wholesaleQuantity" type="number" min="1" step="1" value="${escapeHtml(item.quantity || 1)}" placeholder="Cant.">
    <input name="wholesaleSalePrice" type="text" inputmode="decimal" value="${escapeHtml(item.salePrice || "")}" placeholder="Venta">
    <input name="wholesalePurchasePrice" type="text" inputmode="decimal" value="${escapeHtml(item.purchasePrice || "")}" placeholder="Compra">
    <div class="row-image ${item.imageUrl ? "has-image" : ""}" tabindex="0" title="Click y Ctrl + V para pegar foto">${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="">` : "Ctrl + V foto"}</div>
    <button class="table-action" type="button" data-duplicate-wholesale>Duplicar</button>
    <button class="table-action danger-action" type="button" data-remove-wholesale>Eliminar</button>
  `;
  attachMoneyExpressionInputs(row);
  row.querySelector(".row-image").addEventListener("click", (event) => event.currentTarget.focus());
  if (!disableSkuAutofill) {
    row.querySelector('[name="wholesaleSku"]').addEventListener("change", async (event) => {
      const stockItem = await findStockItemBySku(event.target.value);
      if (!stockItem) return;
      if (stockItem.talle) row.querySelector('[name="wholesaleSize"]').value = stockItem.talle;
      if (stockItem.color) row.querySelector('[name="wholesaleColor"]').value = stockItem.color;
      if (stockItem.precio !== undefined) row.querySelector('[name="wholesalePurchasePrice"]').value = stockItem.precio || "";
    });
  }
  row.querySelector("[data-duplicate-wholesale]").addEventListener("click", () => {
    addWholesaleItemRow(readWholesaleRow(row), container);
  });
  row.querySelector("[data-remove-wholesale]").addEventListener("click", () => row.remove());
  (container || wholesaleRows).appendChild(row);
}

function readWholesaleRow(row) {
  return {
    name: row.querySelector('[name="wholesaleName"]').value,
    sku: row.querySelector('[name="wholesaleSku"]').value,
    size: row.querySelector('[name="wholesaleSize"]').value,
    color: row.querySelector('[name="wholesaleColor"]').value,
    quantity: row.querySelector('[name="wholesaleQuantity"]').value,
    salePrice: row.querySelector('[name="wholesaleSalePrice"]').value,
    purchasePrice: row.querySelector('[name="wholesalePurchasePrice"]').value,
    imageUrl: row.dataset.imageUrl || "",
    disableSkuAutofill: row.dataset.disableSkuAutofill === "true"
  };
}

function applyShippingValueToWholesaleSales() {
  const shippingInput = manualForm?.elements?.shippingValue;
  if (!shippingInput) return;
  evaluateMoneyExpressionInput(shippingInput);
  if (shippingInput.classList.contains("input-error")) {
    alert("Revisa el valor del envio antes de aplicarlo.");
    return;
  }
  const shippingValue = moneyValue(shippingInput.value);
  if (!shippingValue) {
    alert("Completa un valor de envio para repartir.");
    return;
  }
  const rows = [...wholesaleRows.querySelectorAll(".wholesale-row")];
  const totalQuantity = rows.reduce((sum, row) => {
    return sum + Math.max(1, Number(row.querySelector('[name="wholesaleQuantity"]')?.value || 1));
  }, 0);
  if (!rows.length || !totalQuantity) {
    alert("Primero carga productos mayoristas.");
    return;
  }
  const extraPerUnit = shippingValue / totalQuantity;
  rows.forEach((row) => {
    const saleInput = row.querySelector('[name="wholesaleSalePrice"]');
    if (!saleInput) return;
    evaluateMoneyExpressionInput(saleInput);
    const currentSale = moneyValue(saleInput.value);
    saleInput.classList.remove("input-error");
    saleInput.value = moneyDisplayValue(currentSale + extraPerUnit);
  });
  shippingInput.value = "";
  shippingInput.classList.remove("input-error");
}

function addExchangeItemRow(item = {}) {
  const row = document.createElement("div");
  row.className = "exchange-row";
  row.dataset.imageUrl = item.imageUrl || "";
  row.innerHTML = `
    <input name="exchangeProduct" value="${escapeHtml(item.name || "")}" placeholder="Producto">
    <input name="exchangeSku" value="${escapeHtml(item.sku || "")}" list="skuOptions" placeholder="SKU">
    <input name="exchangeSize" value="${escapeHtml(item.size || "")}" placeholder="Talle">
    <input name="exchangeColor" value="${escapeHtml(item.color || "")}" placeholder="Color">
    <input name="exchangeQuantity" type="number" min="1" step="1" value="${escapeHtml(item.quantity || 1)}" placeholder="Cant.">
    <div class="row-image ${item.imageUrl ? "has-image" : ""}" tabindex="0" title="Click y Ctrl + V para pegar foto">${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="">` : "Ctrl + V foto"}</div>
    <input class="sr-only exchange-row-image-file" type="file" accept="image/*">
    <button class="table-action" type="button" data-duplicate-exchange>Duplicar</button>
    <button class="table-action danger-action" type="button" data-remove-exchange>Eliminar</button>
  `;
  row.querySelector(".row-image").addEventListener("click", (event) => {
    event.currentTarget.focus();
    row.querySelector(".exchange-row-image-file")?.click();
  });
  row.querySelector(".exchange-row-image-file").addEventListener("change", (event) => {
    readExchangeRowImageFile(row, event.target.files?.[0]);
    event.target.value = "";
  });
  row.querySelector('[name="exchangeSku"]').addEventListener("change", async (event) => {
    const stockItem = await findStockItemBySku(event.target.value);
    if (!stockItem) return;
    if (stockItem.talle) row.querySelector('[name="exchangeSize"]').value = stockItem.talle;
    if (stockItem.color) row.querySelector('[name="exchangeColor"]').value = stockItem.color;
    if (stockItem.modelo && !row.querySelector('[name="exchangeProduct"]').value) {
      row.querySelector('[name="exchangeProduct"]').value = stockItem.modelo;
    }
  });
  row.querySelector("[data-duplicate-exchange]").addEventListener("click", () => addExchangeItemRow(readExchangeRow(row)));
  row.querySelector("[data-remove-exchange]").addEventListener("click", () => row.remove());
  exchangeRows.appendChild(row);
}

function readExchangeRow(row) {
  return {
    name: row.querySelector('[name="exchangeProduct"]').value,
    sku: row.querySelector('[name="exchangeSku"]').value,
    size: row.querySelector('[name="exchangeSize"]').value,
    color: row.querySelector('[name="exchangeColor"]').value,
    quantity: row.querySelector('[name="exchangeQuantity"]').value,
    imageUrl: row.dataset.imageUrl || ""
  };
}

function addExchangeEntryAsRow() {
  const item = {
    name: exchangeForm.elements.exchangeEntryProduct.value,
    sku: exchangeForm.elements.exchangeEntrySku.value,
    size: exchangeForm.elements.exchangeEntrySize.value,
    color: exchangeForm.elements.exchangeEntryColor.value,
    quantity: exchangeForm.elements.exchangeEntryQuantity.value || 1,
    imageUrl: exchangeEntryImageData
  };
  if (!String(item.name || item.sku || "").trim()) return;
  addExchangeItemRow(item);
  clearExchangeEntry();
}

function addRetailEntryAsRow() {
  evaluateMoneyExpressionInputs(manualForm);
  if (hasMoneyExpressionErrors(manualForm)) return;
  const item = {
    sku: manualForm.elements.sku.value,
    size: manualForm.elements.size.value,
    color: manualForm.elements.color.value,
    quantity: manualForm.elements.quantity.value || 1,
    salePrice: manualForm.elements.salePrice.value,
    purchasePrice: manualForm.elements.purchasePrice.value,
    imageUrl: retailImageData
  };
  if (!String(item.sku || "").trim()) return;
  addWholesaleItemRow(item, retailRows);
  clearRetailEntry();
}

function clearRetailEntry() {
  [
    "sku",
    "size",
    "color",
    "salePrice",
    "purchasePrice"
  ].forEach((name) => {
    if (manualForm.elements[name]) manualForm.elements[name].value = "";
  });
  if (manualForm.elements.quantity) manualForm.elements.quantity.value = 1;
  setRetailImage("");
}

function clearExchangeEntry() {
  [
    "exchangeEntryProduct",
    "exchangeEntrySku",
    "exchangeEntrySize",
    "exchangeEntryColor"
  ].forEach((name) => {
    if (exchangeForm.elements[name]) exchangeForm.elements[name].value = "";
  });
  if (exchangeForm.elements.exchangeEntryQuantity) exchangeForm.elements.exchangeEntryQuantity.value = 1;
  setExchangeEntryImage("");
}

function addWholesaleEntryAsRow() {
  evaluateMoneyExpressionInputs(manualForm);
  if (hasMoneyExpressionErrors(manualForm)) return;
  const item = {
    sku: manualForm.elements.wholesaleEntrySku.value,
    size: manualForm.elements.wholesaleEntrySize.value,
    color: manualForm.elements.wholesaleEntryColor.value,
    quantity: manualForm.elements.wholesaleEntryQuantity.value || 1,
    salePrice: manualForm.elements.wholesaleEntrySalePrice.value,
    purchasePrice: manualForm.elements.wholesaleEntryPurchasePrice.value,
    imageUrl: wholesaleEntryImageData
  };
  if (!String(item.sku || "").trim()) return;
  addWholesaleItemRow(item);
  clearWholesaleEntry();
}

function addWholesaleCurveRows() {
  evaluateMoneyExpressionInputs(manualForm);
  if (hasMoneyExpressionErrors(manualForm)) return;
  const baseItem = {
    sku: manualForm.elements.wholesaleEntrySku.value,
    color: manualForm.elements.wholesaleEntryColor.value,
    quantity: manualForm.elements.wholesaleEntryQuantity.value || 1,
    salePrice: manualForm.elements.wholesaleEntrySalePrice.value,
    purchasePrice: manualForm.elements.wholesaleEntryPurchasePrice.value,
    imageUrl: wholesaleEntryImageData
  };
  if (!String(baseItem.sku || "").trim()) return;
  ["S", "M", "L", "XL", "XXL"].forEach((size) => {
    addWholesaleItemRow({ ...baseItem, size });
  });
  clearWholesaleEntry();
}

function decodeMayoristaCartParam(value = "") {
  try {
    const padded = String(value || "").replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return [];
  }
}

async function loadMayoristaProducts() {
  const response = await fetch("api/mayorista/products", { cache: "no-store" });
  if (!response.ok) throw new Error(`catalogo HTTP ${response.status}`);
  const products = await response.json();
  return Array.isArray(products) ? products : [];
}

function mayoristaProductImage(product = {}, item = {}) {
  return product.foto || product.foto1 || item.foto || item.imageUrl || "";
}

function mayoristaNameFromCartId(id = "") {
  const text = String(id || "").trim();
  if (!text) return "";
  const withoutPrefix = text.replace(/^tn-\d+-/i, "");
  return withoutPrefix
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function mayoristaItemsFromCart(cart = [], products = []) {
  const productMap = new Map(products.map((product) => [String(product.id || ""), product]));
  return cart.flatMap((item) => {
    const id = item.id || item.i || "";
    const product = productMap.get(String(id)) || {};
    const quantity = Math.max(1, Math.floor(Number(item.quantity || item.cantidad || item.q || 1)));
    const row = {
      name: item.name || item.nombre || item.n || product.nombre || mayoristaNameFromCartId(id) || id,
      sku: item.sku || item.s || product.sku || "",
      size: item.size || item.talle || item.t || "",
      color: item.color || item.c || "",
      quantity: 1,
      salePrice: item.salePrice ?? item.precio ?? product.precio ?? "",
      purchasePrice: item.purchasePrice ?? item.costo ?? "",
      imageUrl: mayoristaProductImage(product, item),
      disableSkuAutofill: true
    };
    return Array.from({ length: quantity }, () => ({ ...row }));
  }).filter((item) => String(item.name || item.sku || "").trim());
}

function appendWholesaleImportItems(items = [], data = {}) {
  if (!items.length) {
    alert("No encontre productos para importar.");
    return;
  }
  setManualOrderType("mayorista", { addRows: false });
  if (wholesaleRows.children.length) {
    const replace = confirm("Ya hay filas cargadas. ¿Querés reemplazarlas por lo importado?");
    if (replace) wholesaleRows.innerHTML = "";
  }
  items.forEach((item) => addWholesaleItemRow(item, wholesaleRows));
  if (data.customer || data.cliente) manualForm.elements.customer.value = data.customer || data.cliente;
  if (data.customerPhone || data.whatsapp || data.telefono) {
    manualForm.elements.customerPhone.value = data.customerPhone || data.whatsapp || data.telefono;
  }
  alert(`Pedido mayorista importado: ${items.length} fila(s).`);
}

async function importWholesaleOrderLink() {
  const link = prompt("Pega el link del carrito mayorista:");
  if (!String(link || "").trim()) return;
  try {
    const url = new URL(String(link).trim());
    const encodedCart = url.searchParams.get("cart");
    if (!encodedCart) {
      alert("Ese link no tiene carrito mayorista.");
      return;
    }
    const cart = decodeMayoristaCartParam(encodedCart);
    if (!Array.isArray(cart) || !cart.length) {
      alert("No pude leer productos en ese link.");
      return;
    }
    const products = await loadMayoristaProducts();
    appendWholesaleImportItems(mayoristaItemsFromCart(cart, products));
  } catch (error) {
    console.error(error);
    alert("No pude importar ese link. Revisá que sea el link completo del carrito mayorista.");
  }
}

function clearWholesaleEntry() {
  [
    "wholesaleEntrySku",
    "wholesaleEntrySize",
    "wholesaleEntryColor",
    "wholesaleEntrySalePrice",
    "wholesaleEntryPurchasePrice"
  ].forEach((name) => {
    if (manualForm.elements[name]) manualForm.elements[name].value = "";
  });
  if (manualForm.elements.wholesaleEntryQuantity) manualForm.elements.wholesaleEntryQuantity.value = 1;
  setWholesaleEntryImage("");
}

function setWholesaleEntryImage(imageUrl) {
  wholesaleEntryImageData = imageUrl || "";
  if (!wholesaleEntryImage) return;
  wholesaleEntryImage.classList.toggle("has-image", Boolean(wholesaleEntryImageData));
  wholesaleEntryImage.innerHTML = wholesaleEntryImageData
    ? `<img src="${escapeHtml(wholesaleEntryImageData)}" alt="">`
    : "Ctrl + V foto";
}

function setRetailImage(imageUrl) {
  retailImageData = imageUrl || "";
  if (!retailImage) return;
  retailImage.classList.toggle("has-image", Boolean(retailImageData));
  retailImage.innerHTML = retailImageData
    ? `<img src="${escapeHtml(retailImageData)}" alt="">`
    : "Ctrl + V foto";
}

function setExchangeEntryImage(imageUrl) {
  exchangeEntryImageData = imageUrl || "";
  if (!exchangeEntryImage) return;
  exchangeEntryImage.classList.toggle("has-image", Boolean(exchangeEntryImageData));
  exchangeEntryImage.innerHTML = exchangeEntryImageData
    ? `<img src="${escapeHtml(exchangeEntryImageData)}" alt="">`
    : "Click o Ctrl + V foto";
}

function setPrintedGarmentImage(imageUrl) {
  printedGarmentImageData = imageUrl || "";
  if (!printedGarmentImage) return;
  printedGarmentImage.classList.toggle("has-image", Boolean(printedGarmentImageData));
  printedGarmentImage.innerHTML = printedGarmentImageData
    ? `<img src="${escapeHtml(printedGarmentImageData)}" alt="">`
    : "Ctrl + V foto";
}

function setWholesaleRowImage(row, imageUrl) {
  const image = row?.querySelector(".row-image");
  if (!row || !image) return;
  row.dataset.imageUrl = imageUrl || "";
  image.classList.toggle("has-image", Boolean(row.dataset.imageUrl));
  image.innerHTML = row.dataset.imageUrl
    ? `<img src="${escapeHtml(row.dataset.imageUrl)}" alt="">`
    : "Ctrl + V foto";
}

async function handleWholesaleImagePaste(event) {
  const rowImage = event.target.closest?.(".row-image");
  const row = rowImage?.closest(".wholesale-row");
  if (!row && manualForm.elements.orderType.value !== "mayorista") return;
  const imageItem = [...(event.clipboardData?.items || [])].find((item) => item.type.startsWith("image/"));
  if (!imageItem) return;
  const file = imageItem.getAsFile();
  if (!file) return;
  event.preventDefault();
  const imageUrl = await compactImageFile(file);
  if (row) {
    setWholesaleRowImage(row, imageUrl);
    return;
  }
  setWholesaleEntryImage(imageUrl);
}

function setExchangeRowImage(row, imageUrl) {
  setWholesaleRowImage(row, imageUrl);
}

async function handleRetailImagePaste(event) {
  if (manualForm.elements.orderType.value !== "minorista") return;
  const target = event.target;
  if (!target.closest?.("#retailImage") && target.closest?.("input, select, textarea, button")) return;
  const imageItem = [...(event.clipboardData?.items || [])].find((item) => item.type.startsWith("image/"));
  if (!imageItem) return;
  const file = imageItem.getAsFile();
  if (!file) return;
  event.preventDefault();
  setRetailImage(await compactImageFile(file));
}

async function handleExchangeImagePaste(event) {
  const target = event.target;
  if (!target.closest?.("#exchangeEntryImage, .exchange-row .row-image") && target.closest?.("input, select, textarea, button")) return;
  const imageItem = [...(event.clipboardData?.items || [])].find((item) => item.type.startsWith("image/"));
  if (!imageItem) return;
  const file = imageItem.getAsFile();
  if (!file) return;
  const rowImage = target.closest?.(".exchange-row .row-image");
  const row = rowImage?.closest(".exchange-row");
  event.preventDefault();
  const imageUrl = await compactImageFile(file);
  if (row) {
    setExchangeRowImage(row, imageUrl);
    return;
  }
  setExchangeEntryImage(imageUrl);
}

async function handlePrintedGarmentImagePaste(event) {
  const target = event.target;
  if (!target.closest?.("#printedGarmentImage") && target.closest?.("input, select, textarea, button")) return;
  const imageItem = [...(event.clipboardData?.items || [])].find((item) => item.type.startsWith("image/"));
  if (!imageItem) return;
  const file = imageItem.getAsFile();
  if (!file) return;
  event.preventDefault();
  setPrintedGarmentImage(await compactImageFile(file));
}

async function readExchangeImageFile(file) {
  if (!file || !file.type?.startsWith("image/")) return;
  setExchangeEntryImage(await compactImageFile(file));
}

async function readExchangeRowImageFile(row, file) {
  if (!file || !file.type?.startsWith("image/")) return;
  setExchangeRowImage(row, await compactImageFile(file));
}

function stopManualEnterSubmit(event) {
  if (event.key !== "Enter") return;
  const target = event.target;
  if (target.closest("textarea, button, .paste-image")) return;
  event.preventDefault();
}

function resetExchangeDialog() {
  editingExchangeId = "";
  exchangeForm.reset();
  exchangeRows.innerHTML = "";
  exchangeForm.elements.differenceAmount.value = 0;
  setExchangeEntryImage("");
  updateExchangeFluxAddressVisibility();
  exchangeDialog.querySelector("h2").textContent = "Nuevo cambio";
  if (exchangeSubmit) exchangeSubmit.textContent = "Crear cambio";
}

function exchangeProductSummary(order = {}) {
  return orderItems(order)
    .map((item) => {
      const parts = [
        item.name || item.sku || "Producto",
        item.sku ? `SKU ${item.sku}` : "",
        [item.size, item.color].filter(Boolean).join(" / "),
        `x${Number(item.quantity || 1)}`
      ].filter(Boolean);
      return parts.join(" - ");
    })
    .join("\n");
}

function openExchangeFromStoreOrder(order = {}) {
  ensureStockItems();
  resetExchangeDialog();
  const storeNumber = order.storeOrderNumber ? `TN ${order.storeOrderNumber}` : "Tienda Nube";
  const address = order.shippingAddress || {};
  const items = orderItems(order);

  exchangeForm.elements.customer.value = order.customer || "";
  exchangeForm.elements.customerPhone.value = order.customerPhone || "";
  exchangeForm.elements.returnProduct.value = exchangeProductSummary(order);
  exchangeForm.elements.differenceAmount.value = 0;
  exchangeForm.elements.paymentResolution.value = "sin-cargo";
  exchangeForm.elements.shippingCompany.value = order.shippingCompany || "";
  exchangeForm.elements.postalCode.value = order.postalCode || address.postalCode || address.cp || "";
  exchangeForm.elements.exchangeFluxProvince.value = address.province || address.state || address.provincia || "";
  exchangeForm.elements.exchangeFluxLocality.value = address.city || address.locality || address.localidad || "";
  exchangeForm.elements.exchangeFluxStreet.value = address.street || "";
  exchangeForm.elements.exchangeFluxNumber.value = address.number || "";
  exchangeForm.elements.exchangeFluxPostalCode.value = address.postalCode || address.cp || order.postalCode || "";
  exchangeForm.elements.externalNotes.value = [order.customerNotes, order.externalNotes].filter(Boolean).join(" / ");
  exchangeForm.elements.internalNotes.value = `Cambio creado desde ${storeNumber}. Modificar productos nuevos antes de guardar.`;
  items.forEach((item) => addExchangeItemRow({
    name: item.name || item.sku || "",
    sku: item.sku || "",
    size: item.size || "",
    color: item.color || "",
    quantity: item.quantity || 1,
    imageUrl: item.imageUrl || ""
  }));
  updateExchangeFluxAddressVisibility();
  exchangeDialog.querySelector("h2").textContent = `Nuevo cambio desde ${storeNumber}`;
  if (exchangeSubmit) exchangeSubmit.textContent = "Crear cambio";
  exchangeDialog.showModal();
}

function openEditExchange(id) {
  const exchange = exchanges.find((item) => item.id === id);
  if (!exchange || exchange.status !== "preparacion") return;
  ensureStockItems();
  resetExchangeDialog();
  editingExchangeId = id;
  exchangeForm.elements.customer.value = exchange.customer || "";
  exchangeForm.elements.customerPhone.value = exchange.customerPhone || "";
  exchangeForm.elements.returnProduct.value = exchange.exchangeReturnProduct || "";
  exchangeForm.elements.differenceAmount.value = exchange.exchangeDifferenceAmount || 0;
  exchangeForm.elements.paymentResolution.value = exchange.paymentResolution || "sin-cargo";
  exchangeForm.elements.shippingCompany.value = exchange.shippingCompany || "";
  exchangeForm.elements.postalCode.value = exchange.postalCode || "";
  const address = exchange.shippingAddress || {};
  exchangeForm.elements.exchangeFluxProvince.value = address.province || address.state || address.provincia || "";
  exchangeForm.elements.exchangeFluxLocality.value = address.city || address.locality || address.localidad || "";
  exchangeForm.elements.exchangeFluxStreet.value = address.street || "";
  exchangeForm.elements.exchangeFluxNumber.value = address.number || "";
  exchangeForm.elements.exchangeFluxPostalCode.value = address.postalCode || address.cp || exchange.postalCode || "";
  exchangeForm.elements.externalNotes.value = exchange.externalNotes || "";
  exchangeForm.elements.internalNotes.value = internalOrderNote(exchange);
  orderItems(exchange).forEach(addExchangeItemRow);
  updateExchangeFluxAddressVisibility();
  exchangeDialog.querySelector("h2").textContent = "Editar cambio";
  if (exchangeSubmit) exchangeSubmit.textContent = "Guardar cambios";
  exchangeDialog.showModal();
}

function openEditOrder(id) {
  const order = orders.find((item) => item.id === id);
  if (!order) return;

  ensureStockItems();
  editingOrderId = id;
  editingOriginalOrderType = order.orderType || "minorista";
  const items = orderItems(order);
  const editAsWholesale = editingOriginalOrderType === "mayorista";
  setManualOrderType(editAsWholesale ? "mayorista" : "minorista", { addRows: false });
  wholesaleRows.innerHTML = "";
  if (retailRows) retailRows.innerHTML = "";
  manualForm.elements.customer.value = order.customer || "";
  manualForm.elements.customerPhone.value = order.customerPhone || "";
  if (editAsWholesale || items.length > 1) {
    clearRetailEntry();
  } else {
    const item = items[0] || order;
    manualForm.elements.sku.value = item.sku || order.sku || "";
    manualForm.elements.color.value = item.color || order.color || "";
    manualForm.elements.size.value = item.size || order.size || "";
    manualForm.elements.purchasePrice.value = item.purchasePrice ?? order.purchasePrice ?? "";
    manualForm.elements.salePrice.value = item.salePrice ?? order.salePrice ?? "";
    manualForm.elements.quantity.value = item.quantity || order.quantity || 1;
    setRetailImage(item.imageUrl || order.imageUrl || "");
  }
  manualForm.elements.shippingValue.value = order.shippingValue || "";
  manualForm.elements.account.value = order.account || "EG";
  manualForm.elements.postalCode.value = order.postalCode || "";
  manualForm.elements.shippingCompany.value = order.shippingCompany || "";
  const address = order.shippingAddress || {};
  manualForm.elements.fluxProvince.value = address.province || address.state || address.provincia || "";
  manualForm.elements.fluxLocality.value = address.city || address.locality || address.localidad || "";
  manualForm.elements.fluxStreet.value = address.street || "";
  manualForm.elements.fluxNumber.value = address.number || "";
  manualForm.elements.fluxPostalCode.value = address.postalCode || address.cp || order.postalCode || "";
  manualForm.elements.salesChannel.value = order.salesChannel || "WhatsApp";
  manualForm.elements.paymentMethod.value = order.paymentMethod || "Transferencia";
  manualForm.elements.fluxCollectAmount.value = order.fluxCollectAmount || "";
  manualForm.elements.customerNotes.value = order.customerNotes || "";
  manualForm.elements.externalNotes.value = order.externalNotes || "";
  manualForm.elements.internalNotes.value = internalOrderNote(order);
  updateManualFluxCollectVisibility();
  updateManualFluxAddressVisibility();
  if (editAsWholesale) {
    items.forEach((item, index) => addWholesaleItemRow({ ...item, originalIndex: index }, wholesaleRows));
  } else if (items.length > 1) {
    items.forEach((item, index) => addWholesaleItemRow({ ...item, originalIndex: index }, retailRows));
  }
  manualDialog.querySelector("h2").textContent = "Editar pedido";
  manualSubmit.textContent = "Guardar cambios";
  manualDialog.showModal();
}

function resetManualDialog() {
  editingOrderId = "";
  editingOriginalOrderType = "";
  wholesaleRows.innerHTML = "";
  if (retailRows) retailRows.innerHTML = "";
  manualForm.reset();
  setRetailImage("");
  setManualOrderType("minorista", { addRows: false });
  updateManualFluxCollectVisibility();
  updateManualFluxAddressVisibility();
  manualDialog.querySelector("h2").textContent = "Cargar pedido manual";
  manualSubmit.textContent = "Crear pedido";
}

function setManualOrderType(type, options = {}) {
  const orderType = type === "mayorista" ? "mayorista" : "minorista";
  manualForm.elements.orderType.value = orderType;
  manualForm.classList.toggle("is-wholesale", orderType === "mayorista");
  orderTypeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.orderType === orderType);
  });
  if (wholesaleHint) wholesaleHint.hidden = orderType !== "mayorista";
  if (wholesaleItems) wholesaleItems.hidden = orderType !== "mayorista";
  retailFields.forEach((field) => {
    field.hidden = orderType === "mayorista";
    field.querySelectorAll("input, select").forEach((input) => {
      if (input.name === "sku" || input.name === "quantity") input.required = orderType !== "mayorista";
    });
  });
  if (manualForm.elements.customerPhone) {
    manualForm.elements.customerPhone.required = orderType === "mayorista";
  }
  if (orderType === "mayorista") {
    setRetailImage("");
  } else {
    clearWholesaleEntry();
  }
}

function updateManualFluxCollectVisibility() {
  if (!manualFluxCollectField || !manualForm?.elements?.paymentMethod) return;
  const visible = normalize(manualForm.elements.paymentMethod.value) === "abonar al recibir";
  manualFluxCollectField.hidden = !visible;
  const input = manualForm.elements.fluxCollectAmount;
  if (input) {
    input.required = visible;
    if (!visible) {
      input.value = "";
      input.classList.remove("input-error");
    }
  }
}

function updateManualFluxAddressVisibility() {
  if (!manualFluxAddressFields || !manualForm?.elements?.shippingCompany) return;
  const visible = normalize(manualForm.elements.shippingCompany.value) === "flux";
  manualFluxAddressFields.hidden = !visible;
  ["fluxProvince", "fluxLocality", "fluxStreet", "fluxNumber", "fluxPostalCode"].forEach((name) => {
    const input = manualForm.elements[name];
    if (!input) return;
    input.required = visible;
    if (!visible) {
      input.value = "";
      input.classList.remove("input-error");
    }
  });
}

function updateExchangeFluxAddressVisibility() {
  if (!exchangeFluxAddressFields || !exchangeForm?.elements?.shippingCompany) return;
  const visible = normalize(exchangeForm.elements.shippingCompany.value) === "flux";
  exchangeFluxAddressFields.hidden = !visible;
  ["exchangeFluxProvince", "exchangeFluxLocality", "exchangeFluxStreet", "exchangeFluxNumber", "exchangeFluxPostalCode"].forEach((name) => {
    const input = exchangeForm.elements[name];
    if (!input) return;
    input.required = visible;
    if (!visible) {
      input.value = "";
      input.classList.remove("input-error");
    }
  });
}

function matchesShippingFilter(order) {
  if (shippingFilter === "todos") return true;
  const company = normalize(order.shippingCompany);
  if (shippingFilter === "flux") return company === "flux";
  if (shippingFilter === "andreani") return company === "andreani";
  return company !== "flux" && company !== "andreani";
}

function matchesPaymentFilter(order) {
  return matchesPaymentValue(order, paymentFilter);
}

function matchesProcessPaymentFilter(order, statusId) {
  if (statusId !== "preparacion") return true;
  return matchesPaymentValue(order, processPaymentFilter);
}

function matchesActiveProcessFilters(order, statusId) {
  return matchesCustomerSearch(order, processSearch) &&
    matchesShippingFilter(order) &&
    matchesSkuFilter(order) &&
    matchesProcessPaymentFilter(order, statusId) &&
    matchesDispatchedWhatsappFilter(order, statusId);
}

function matchesDispatchedWhatsappFilter(order, statusId) {
  if (statusId !== "despachado" || dispatchedWhatsappFilter === "todos") return true;
  if (dispatchedWhatsappFilter === "no-enviado") return !whatsappTemplateAlreadySent(order);
  return true;
}

function matchesDispatchedClearFilters(order) {
  return matchesCustomerSearch(order, processSearch) &&
    matchesShippingFilter(order) &&
    matchesSkuFilter(order) &&
    matchesPaymentValue(order, processPaymentFilter);
}

function matchesPaymentValue(order, filter) {
  if (filter === "todos") return true;
  const payment = normalize(order.paymentMethod);
  if (filter === "transferencia") return payment === "transferencia";
  if (filter === "abonar") return payment === "abonar al recibir";
  if (filter === "mercado-pago") return payment === "mercado pago";
  return true;
}

function matchesCustomerSearch(order, query) {
  const needle = normalize(query);
  if (!needle) return true;
  const digitNeedle = digitsOnly(query);
  const haystack = [
    order.customer,
    order.internalOrderNumber,
    order.storeOrderNumber,
    order.storeOrderId,
    order.customerPhone
  ].map(normalize).join(" ");
  const phoneHaystack = [
    order.customerPhone,
    whatsappPhoneNumber(order.customerPhone)
  ].map(digitsOnly).join(" ");
  return haystack.includes(needle) ||
    (digitNeedle.length >= 3 && phoneHaystack.includes(digitNeedle));
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function addressIssues(order) {
  const address = order.shippingAddress || {};
  const fullAddress = String(address.fullAddress || address.street || address.address || "").trim();
  const street = String(address.street || address.address || fullAddress).trim();
  const number = String(address.number || address.streetNumber || "").trim();
  const city = String(address.city || address.locality || "").trim();
  const province = String(address.province || address.state || "").trim();
  const postalCode = String(order.postalCode || address.postalCode || address.zipcode || "").trim();
  const issues = [];
  const postalDigits = postalCode.replace(/\D/g, "");
  const numberDigits = number.replace(/\D/g, "");

  if (postalCode && !/^\d{4}$|^[A-Z]\d{4}[A-Z]{3}$/i.test(postalCode)) issues.push("Codigo postal con formato raro");
  if (postalDigits && numberDigits && postalDigits === numberDigits) issues.push("Codigo postal igual a altura");
  if (numberDigits && (Number(numberDigits) <= 1 || numberDigits.length > 5)) issues.push("Altura sospechosa");
  if (street && normalize(street).length < 4) issues.push("Calle demasiado corta");
  if (["casa", "domicilio", "sin calle", "centro", "-"].includes(normalize(street))) issues.push("Calle generica");

  return issues;
}

function matchesSkuFilter(order) {
  if (dtfFilterActive && !orderHasDtfSku(order)) return false;
  if (pickedFilterActive && !orderHasPickedItem(order)) return false;
  return skuFilter === "todos" || orderItems(order).some((item) => canonicalSkuKey(item.sku) === skuFilter);
}

function isDtfSku(sku) {
  const normalizedSku = String(sku || "").trim().toUpperCase();
  return normalizedSku.endsWith("DTF") || normalizedSku.endsWith("3D");
}

function orderHasDtfSku(order) {
  return orderItems(order).some((item) => isDtfSku(item.sku));
}

function orderHasPickedItem(order) {
  return orderItems(order).some((item) => ["separado", "armado"].includes(detailItemStatus(item)));
}

function renderSkuFilter() {
  const preparationSkus = new Map();
  operationalOrders()
    .filter((order) => order.status === "preparacion")
    .flatMap((order) => orderItems(order))
    .forEach((item) => {
      const key = canonicalSkuKey(item.sku);
      if (key && !preparationSkus.has(key)) preparationSkus.set(key, displaySkuLabel(item.sku));
    });
  const sortedSkus = [...preparationSkus.entries()].sort((left, right) => left[1].localeCompare(right[1]));
  const selectedStillExists = skuFilter === "todos" || preparationSkus.has(skuFilter);
  if (!selectedStillExists) skuFilter = "todos";

  skuFilterSelect.innerHTML = [
    '<option value="todos">Todos</option>',
    ...sortedSkus.map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`)
  ].join("");
  skuFilterSelect.value = skuFilter;
  if (dtfFilter) dtfFilter.classList.toggle("active", dtfFilterActive);
  if (pickedFilter) pickedFilter.classList.toggle("active", pickedFilterActive);
}

function stockItemLabel(item) {
  return [
    item.sku || "Sin SKU",
    item.modelo || item.nombre || item.id,
    item.talle,
    item.color,
    item.stock !== undefined ? `Stock ${item.stock}` : ""
  ].filter(Boolean).join(" - ");
}

function renderStockSkuOptions() {
  if (!skuOptions) return;
  const dynamicOptions = stockItems
    .filter((item) => item.sku)
    .map((item) => (
      `<option value="${escapeHtml(item.sku)}" label="${escapeHtml(stockItemLabel(item))}"></option>`
    ));
  skuOptions.innerHTML = dynamicOptions.join("") || [
    '<option value="SET-LISBOA-NEG"></option>',
    '<option value="BOLSO-TERRA-SU"></option>',
    '<option value="MOCH-OSAKA-ROJ-M"></option>'
  ].join("");
}

async function loadStockItems() {
  if (stockItemsPromise) return stockItemsPromise;
  stockItemsPromise = (async () => {
    try {
      const response = await fetch("api/stock/items?solo_con_stock=true");
      if (!response.ok) return;
      const data = await response.json();
      stockItems = Array.isArray(data.items) ? data.items : [];
      renderStockSkuOptions();
    } catch {
      stockItems = [];
    }
  })();
  return stockItemsPromise;
}

function ensureStockItems() {
  loadStockItems();
}

async function findStockItemBySku(sku) {
  await loadStockItems();
  return stockItems.find((item) => normalize(item.sku) === normalize(sku));
}

async function fillRetailFromSku(sku) {
  fillRetailFromStockItem(await findStockItemBySku(sku));
}

async function fillWholesaleEntryFromSku(sku) {
  fillWholesaleEntryFromStockItem(await findStockItemBySku(sku));
}

function fillRetailFromStockItem(item) {
  if (!item) return;
  if (manualForm.elements.size && item.talle) manualForm.elements.size.value = item.talle;
  if (manualForm.elements.color && item.color) manualForm.elements.color.value = item.color;
  if (manualForm.elements.purchasePrice && item.precio !== undefined) manualForm.elements.purchasePrice.value = item.precio || "";
}

function fillWholesaleEntryFromStockItem(item) {
  if (!item) return;
  if (manualForm.elements.wholesaleEntrySize && item.talle) manualForm.elements.wholesaleEntrySize.value = item.talle;
  if (manualForm.elements.wholesaleEntryColor && item.color) manualForm.elements.wholesaleEntryColor.value = item.color;
  if (manualForm.elements.wholesaleEntryPurchasePrice && item.precio !== undefined) manualForm.elements.wholesaleEntryPurchasePrice.value = item.precio || "";
}

function renderBackup() {
  const todaysRows = todaysBackupRows();
  const cancelledRows = cancelledBackupRows();
  const visibleRows = backupMode === "cancelled" ? cancelledRows : todaysRows;
  const emptyMessage = backupMode === "cancelled"
    ? "Todavia no hay pedidos cancelados."
    : "Todavia no hay pedidos aprobados hoy.";

  if (backupTitle) {
    backupTitle.textContent = backupMode === "cancelled" ? "Pedidos cancelados" : "Pedidos aprobados hoy";
  }
  if (backupDescription) {
    backupDescription.textContent = backupMode === "cancelled"
      ? "Pedidos que fueron cancelados despues de pasar por el proceso. Siguen quedando en el historico."
      : "Este respaldo se arma con los pedidos que pasaron de A definir a En preparacion durante el dia.";
  }
  if (backupTodayCount) backupTodayCount.textContent = todaysRows.length;
  if (backupCancelledCount) backupCancelledCount.textContent = cancelledRows.length;
  document.querySelectorAll("[data-backup-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.backupMode === backupMode);
  });

  const headers = backupMode === "cancelled" ? [...backupHeaders, "Acciones"] : backupHeaders;
  backupHead.innerHTML = `<tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr>`;
  backupBody.innerHTML =
    visibleRows.map((row, rowIndex) => {
      const key = backupGroupKey(row);
      const previousKey = rowIndex > 0 ? backupGroupKey(visibleRows[rowIndex - 1]) : "";
      const firstInGroup = key !== previousKey;
      const restoreCell = backupMode === "cancelled"
        ? `<td>${firstInGroup ? `<button class="button small" type="button" data-restore-cancelled="${escapeHtml(key)}">Restaurar</button>` : ""}</td>`
        : "";
      return `<tr class="${row.cancelled ? "cancelled-row" : ""}">${backupRowValues(row).map((value, cellIndex) => `<td>${escapeHtml(excelCellValue(value, cellIndex))}</td>`).join("")}${restoreCell}</tr>`;
    }).join("") ||
    `<tr><td colspan="${headers.length}">${emptyMessage}</td></tr>`;

  backupBody.querySelectorAll("[data-restore-cancelled]").forEach((button) => {
    button.addEventListener("click", () => {
      const row = visibleRows.find((item) => backupGroupKey(item) === button.dataset.restoreCancelled);
      if (row) restoreOrderFromCancelledBackup(row);
    });
  });

  downloadBackup.href = "#";
  downloadBackup.download = `backup-pedidos-${today()}.xls`;
  downloadBackup.classList.toggle("disabled", todaysRows.length === 0);
  downloadBackupHistory.href = "#";
  downloadBackupHistory.download = `backup-historico-pedidos.xls`;
  downloadBackupHistory.classList.toggle("disabled", backupRows.length === 0);
}

function todaysBackupRows() {
  return prorateBackupShippingRows(syncBackupRowsWithOrders(backupRows.filter((row) => row.approvedDate === today())));
}

function historicBackupRows() {
  return prorateBackupShippingRows(syncBackupRowsWithOrders(backupRows));
}

function cancelledBackupRows() {
  const rows = backupRows
    .filter((row) => row.cancelled)
    .slice()
    .sort((left, right) => String(right.cancelledAt || right.approvedDate || "").localeCompare(String(left.cancelledAt || left.approvedDate || "")));
  return prorateBackupShippingRows(syncBackupRowsWithOrders(rows));
}

function backupStatusLabel(status) {
  if (status === "cancelado") return "Cancelado";
  if (status === "despachado") return "Despachado";
  return processStatuses.find((item) => item.id === status)?.label || status || "";
}

function compactNotes(parts) {
  const seen = new Set();
  return parts
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .flatMap((value) => value.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean))
    .filter((value) => {
      const key = normalize(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" - ");
}

function backupRowIndex(row) {
  const match = String(row.id || "").match(/:(\d+)$/);
  return match ? Number(match[1]) : -1;
}

function matchingOrderForBackupRow(row) {
  return orders.find((order) =>
    order.id === row.orderId ||
    (String(order.internalOrderNumber || "").trim() && String(order.internalOrderNumber || "").trim() === String(row.internalOrderNumber || "").trim()) ||
    (String(order.storeOrderNumber || "").trim() && String(order.storeOrderNumber || "").trim() === String(row.storeOrderNumber || "").trim())
  );
}

function internalOrderNote(order) {
  return String(order?.internalNotes ?? order?.notes ?? "").trim();
}

function logisticsOrderNotes(order) {
  return compactNotes([order?.customerNotes, order?.externalNotes, addressLogisticsNotes(order)]);
}

function addressLogisticsNotes(order) {
  const address = order?.shippingAddress || {};
  return compactNotes([
    address.floor ? `Piso ${address.floor}` : "",
    address.apartment ? `Depto ${address.apartment}` : "",
    address.unit && address.unit !== address.apartment ? `Unidad ${address.unit}` : "",
    address.door ? `Puerta ${address.door}` : "",
    address.businessName ? `Local ${address.businessName}` : "",
    address.addressNote || ""
  ]);
}

function backupOrderNotes(order, previousNotes = "", cancelReason = "") {
  return compactNotes([
    previousNotes,
    order?.customerNotes ? `Cliente: ${order.customerNotes}` : "",
    order?.externalNotes ? `Externa: ${order.externalNotes}` : "",
    internalOrderNote(order) ? `Interna: ${internalOrderNote(order)}` : "",
    order?.packagingNote ? `Empaquetado: ${order.packagingNote}` : "",
    cancelReason ? `Cancelado: ${cancelReason}` : ""
  ]);
}

function itemForBackupRow(order, row) {
  const items = orderItems(order);
  const index = backupRowIndex(row);
  if (index >= 0 && items[index]) return items[index];
  return items.find((item) => skuEquals(item.sku, row.sku) && normalize(item.size) === normalize(row.size) && normalize(item.color) === normalize(row.color)) ||
    items.find((item) => skuEquals(item.sku, row.sku)) ||
    null;
}

function syncBackupRowsWithOrders(rows) {
  return rows.map((row) => {
    const order = matchingOrderForBackupRow(row);
    if (!order) {
      return {
        ...row,
        statusLabel: row.statusLabel || (row.cancelled ? "Cancelado" : "")
      };
    }
    const item = itemForBackupRow(order, row);
    return {
      ...row,
      customer: order.customer || row.customer,
      internalOrderNumber: order.internalOrderNumber || row.internalOrderNumber,
      storeOrderNumber: order.storeOrderNumber || row.storeOrderNumber,
      postalCode: order.postalCode || row.postalCode,
      shippingCompany: order.shippingCompany || row.shippingCompany,
      salesChannel: order.salesChannel || row.salesChannel,
      account: order.account || row.account,
      invoice: order.invoice || row.invoice,
      commissionRate: order.commissionRate ?? row.commissionRate,
      paymentMethod: order.paymentMethod || row.paymentMethod,
      sku: item?.sku || row.sku,
      color: item?.color || row.color,
      size: item?.size || row.size,
      purchasePrice: Number(item?.purchasePrice || 0) > 0 ? item.purchasePrice : row.purchasePrice,
      salePrice: item ? item.salePrice : row.salePrice,
      quantity: item ? item.quantity : row.quantity,
      printOwner: item ? detailItemPrintOwner(item) : row.printOwner,
      printOwnerUpdatedAt: item?.printOwnerUpdatedAt || row.printOwnerUpdatedAt || "",
      status: order.status || row.status,
      statusLabel: backupStatusLabel(order.status),
      packagingNote: order.packagingNote || row.packagingNote || "",
      customerNotes: order.customerNotes || row.customerNotes || "",
      externalNotes: order.externalNotes || row.externalNotes || "",
      internalNotes: internalOrderNote(order) || row.internalNotes || "",
      notes: backupOrderNotes(order, row.notes, row.cancelReason),
      cancelled: Boolean(row.cancelled || order.cancelled || order.status === "cancelado"),
      cancelledAt: row.cancelledAt || order.cancelledAt || "",
      cancelReason: row.cancelReason || order.cancelReason || ""
    };
  });
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadBackupRows(rows, filename) {
  if (!rows.length) return;
  triggerBlobDownload(buildExcelBlob(rows), filename);
}

function prorateBackupShippingRows(rows) {
  const groups = rows.reduce((map, row) => {
    const key = row.orderId || row.internalOrderNumber || row.storeOrderNumber || row.id;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
    return map;
  }, new Map());

  return rows.map((row) => {
    const key = row.orderId || row.internalOrderNumber || row.storeOrderNumber || row.id;
    const group = groups.get(key) || [row];
    if (group.length <= 1) return row;
    const groupQuantity = group.reduce((sum, item) => sum + Number(item.quantity || 1), 0) || 1;
    const totalShipping = row.totalShippingValue !== undefined
      ? Number(row.totalShippingValue || 0)
      : Math.max(...group.map((item) => Number(item.shippingValue || 0)));
    return {
      ...row,
      shippingValue: (totalShipping / groupQuantity) * Number(row.quantity || 1)
    };
  });
}

function renderStockLog() {
  if (!stockLogBody) return;
  stockLogBody.innerHTML = stockLogRows.map((row) => `
    <tr>
      <td>${escapeHtml(formatDateTime(row.date))}</td>
      <td>${escapeHtml(row.orderNumber || row.orderId)}</td>
      <td>${escapeHtml(row.customer)}</td>
      <td>${escapeHtml(row.requestedSku)}</td>
      <td>${escapeHtml([row.product, row.deductedSku || row.prendaId].filter(Boolean).join(" / "))}</td>
      <td>${escapeHtml(row.size)}</td>
      <td>${escapeHtml(row.color)}</td>
      <td>${escapeHtml(row.quantity)}</td>
      <td>${escapeHtml(row.stockBefore)} -> ${escapeHtml(row.stockAfter)}</td>
      <td>${escapeHtml(row.matchType || "exact")}</td>
    </tr>
  `).join("") || '<tr><td colspan="10">Todavia no hay descuentos de stock registrados.</td></tr>';
}

function renderExchanges() {
  if (!exchangeBody) return;
  exchangeBody.innerHTML = exchanges.map((exchange) => {
    const items = orderItems(exchange);
    const newProducts = items.length
      ? items.map((item) => `${item.name || item.sku || "Producto"}${item.quantity > 1 ? ` x${item.quantity}` : ""}`).join(" / ")
      : exchange.exchangeNewProduct || exchange.sku || "";
    const skus = items.map((item) => item.sku).filter(Boolean).join(" / ") || exchange.sku || "";
    return `
      <tr class="${exchange.cancelled || exchange.status === "cancelado" ? "cancelled-row" : ""}">
        <td>${escapeHtml(exchange.internalOrderNumber || exchange.id)}</td>
        <td>${escapeHtml(exchange.cancelled || exchange.status === "cancelado" ? "Cancelado" : exchange.status === "despachado" ? "Despachado / Cerrado" : processStatuses.find((item) => item.id === exchange.status)?.label || exchange.status)}</td>
        <td>${escapeHtml(exchange.customer || "")}</td>
        <td>${escapeHtml(exchange.customerPhone || "")}</td>
        <td>${escapeHtml(exchange.exchangeReturnProduct || "")}</td>
        <td>${escapeHtml(newProducts)}</td>
        <td>${escapeHtml(skus)}</td>
        <td>${formatMoney(exchange.exchangeDifferenceAmount || 0)}</td>
        <td>${escapeHtml(paymentResolutionLabel(exchange.paymentResolution))}</td>
        <td>${escapeHtml(exchange.shippingCompany || "")}</td>
        <td>${escapeHtml(exchange.postalCode || "")}</td>
        <td>${escapeHtml([exchange.notes, exchange.cancelReason ? `Cancelado: ${exchange.cancelReason}` : ""].filter(Boolean).join(" - "))}</td>
        <td>${exchange.status === "preparacion" && !exchange.cancelled ? `<button class="table-action" type="button" data-edit-exchange="${exchange.id}">Editar</button>` : ""}</td>
      </tr>
    `;
  }).join("") || '<tr><td colspan="13">Todavia no hay cambios cargados.</td></tr>';
}

function paymentResolutionLabel(value) {
  if (value === "sin-cargo") return "Sin cargo";
  if (value === "paga-al-recibir") return "Paga al recibir (Flux)";
  if (value === "transferencia") return "Transferencia";
  return value || "";
}

function skuPrefixKey(value) {
  return String(value || "").trim().slice(0, 3).toUpperCase();
}

function skuMatchesPrefixFilter(sku) {
  return !skuPrefixFilterValue || skuPrefixKey(sku) === skuPrefixFilterValue;
}

function skuMatchesLoadedSearch(sku) {
  return !skuLoadedSearchValue || normalize(sku).includes(skuLoadedSearchValue);
}

function renderSkuPrices() {
  if (skuPrefixFilterInput && skuPrefixFilterInput.value !== skuPrefixFilterValue) {
    skuPrefixFilterInput.value = skuPrefixFilterValue;
  }
  if (skuLoadedSearchInput && normalize(skuLoadedSearchInput.value) !== skuLoadedSearchValue) {
    skuLoadedSearchInput.value = skuLoadedSearchValue;
  }

  const rows = Object.entries(skuPrices)
    .filter(([sku]) => skuMatchesLoadedSearch(sku))
    .sort(([skuA], [skuB]) => skuA.localeCompare(skuB));
  skuPriceBody.innerHTML = rows.map(([sku, price]) => `
    <tr>
      <td>${escapeHtml(sku)}</td>
      <td>${formatMoney(price)}</td>
      <td>
        <div class="sku-price-actions">
          <button class="table-action" type="button" data-edit-sku-price="${escapeHtml(sku)}">Editar</button>
          <button class="table-action danger-action" type="button" data-delete-sku-price="${escapeHtml(sku)}">Eliminar</button>
        </div>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="3">${skuLoadedSearchValue ? "No hay precios cargados para esa busqueda." : "Todavia no hay precios cargados."}</td></tr>`;

  document.querySelectorAll("[data-edit-sku-price]").forEach((button) => {
    button.addEventListener("click", () => editSkuPrice(button.dataset.editSkuPrice));
  });
  document.querySelectorAll("[data-delete-sku-price]").forEach((button) => {
    button.addEventListener("click", () => deleteSkuPrice(button.dataset.deleteSkuPrice));
  });
  renderMissingSkuPrices();
}

function skuEquals(left, right) {
  return normalize(left) === normalize(right);
}

function storedSkuPrice(sku) {
  const entry = Object.entries(skuPrices).find(([savedSku]) => skuEquals(savedSku, sku));
  if (!entry) return 0;
  return Number(entry[1] || 0);
}

function missingSkuRows() {
  const missing = new Map();
  const addMissing = (sku, orderLabel, purchasePrice) => {
    const cleanSku = String(sku || "").trim();
    if (!cleanSku) return;
    if (storedSkuPrice(cleanSku) > 0 || Number(purchasePrice || 0) > 0) return;
    const key = normalize(cleanSku);
    const current = missing.get(key) || { sku: cleanSku, count: 0, orders: new Set() };
    current.count += 1;
    if (orderLabel) current.orders.add(String(orderLabel));
    missing.set(key, current);
  };

  orders.forEach((order) => {
    const orderLabel = order.internalOrderNumber || order.storeOrderNumber || order.customer;
    orderItems(order).forEach((item) => addMissing(item.sku, orderLabel, item.purchasePrice));
  });
  backupRows.forEach((row) => {
    const orderLabel = row.internalOrderNumber || row.storeOrderNumber || row.orderId;
    addMissing(row.sku, orderLabel, row.purchasePrice);
  });

  return Array.from(missing.values())
    .filter((row) => skuMatchesPrefixFilter(row.sku))
    .sort((a, b) => a.sku.localeCompare(b.sku));
}

function renderMissingSkuPrices() {
  if (!missingSkuBody) return;
  const rows = missingSkuRows();
  missingSkuBody.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.sku)}</td>
      <td>${row.count}</td>
      <td>${escapeHtml(Array.from(row.orders).join(", "))}</td>
      <td>
        <form class="missing-sku-price-form" data-missing-sku="${escapeHtml(row.sku)}">
          <input name="purchasePrice" required type="text" inputmode="decimal" placeholder="0">
          <button class="table-action" type="submit">Cargar</button>
        </form>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="4">${skuPrefixFilterValue ? `No hay SKU sin costo para ${escapeHtml(skuPrefixFilterValue)}.` : "Todos los SKU usados tienen costo cargado."}</td></tr>`;

  document.querySelectorAll("[data-missing-sku]").forEach((form) => {
    attachMoneyExpressionInputs(form);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      evaluateMoneyExpressionInputs(form);
      if (hasMoneyExpressionErrors(form)) return;
      const formData = new FormData(form);
      formData.set("sku", form.dataset.missingSku);
      saveSkuPrice(formData);
    });
  });
}

function saveSkuPrice(formData) {
  const sku = String(formData.get("sku") || "").trim();
  const purchasePrice = moneyValue(formData.get("purchasePrice"));
  if (!sku) return;

  skuPrices = { ...skuPrices, [sku]: purchasePrice };
  orders = orders.map((order) => applyPurchasePriceToOrder(order, (itemSku) => skuEquals(itemSku, sku), purchasePrice));
  exchanges = exchanges.map((exchange) => applyPurchasePriceToOrder(exchange, (itemSku) => skuEquals(itemSku, sku), purchasePrice));
  backupRows = backupRows.map((row) => skuEquals(row.sku, sku) ? { ...row, purchasePrice } : row);
  save();
  render();
}

function saveSkuPrefixPrice(formData) {
  const prefix = skuPrefixFilterValue;
  const purchasePrice = moneyValue(formData.get("purchasePrice"));
  if (prefix.length !== 3) {
    window.alert("Filtrá primero con exactamente 3 letras del SKU.");
    return;
  }

  const matchingSkus = missingSkuRows().map((row) => row.sku);
  if (!matchingSkus.length) {
    window.alert(`No hay SKU pendientes para ${prefix}.`);
    return;
  }
  const matchingKeys = new Set(matchingSkus.map((sku) => normalize(sku)));

  const nextPrices = { ...skuPrices };
  matchingSkus.forEach((sku) => {
    nextPrices[sku] = purchasePrice;
  });
  skuPrices = nextPrices;

  orders = orders.map((order) => applyPurchasePriceToOrder(order, (itemSku) => matchingKeys.has(normalize(itemSku)), purchasePrice));
  exchanges = exchanges.map((exchange) => applyPurchasePriceToOrder(exchange, (itemSku) => matchingKeys.has(normalize(itemSku)), purchasePrice));
  backupRows = backupRows.map((row) => matchingKeys.has(normalize(row.sku)) ? { ...row, purchasePrice } : row);

  save();
  render();
  window.alert(`Se cargó ${formatMoney(purchasePrice)} en ${matchingSkus.length} SKU pendiente(s) filtrados por ${prefix}.`);
}

function applyPurchasePriceToOrder(order, matchesSku, purchasePrice) {
  const hasItems = Array.isArray(order.items) && order.items.length;
  const nextItems = hasItems
    ? order.items.map((item) => matchesSku(item.sku) ? { ...item, purchasePrice } : item)
    : order.items;
  const topLevelMatches = matchesSku(order.sku);
  const itemMatches = hasItems && nextItems.some((item, index) => item !== order.items[index]);
  if (!topLevelMatches && !itemMatches) return order;
  return {
    ...order,
    purchasePrice: topLevelMatches ? purchasePrice : order.purchasePrice,
    items: nextItems
  };
}

function editSkuPrice(sku) {
  const currentPrice = skuPrices[sku] ?? "";
  const value = window.prompt(`Nuevo precio de compra para ${sku}:`, currentPrice);
  if (value === null) return;
  const purchasePrice = moneyValue(value);
  if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
    window.alert("Precio invalido.");
    return;
  }
  const formData = new FormData();
  formData.set("sku", sku);
  formData.set("purchasePrice", String(purchasePrice));
  saveSkuPrice(formData);
}

function deleteSkuPrice(sku) {
  const confirmed = window.confirm(`Vas a eliminar el precio guardado para ${sku}. ¿Confirmas?`);
  if (!confirmed) return;
  const nextPrices = { ...skuPrices };
  delete nextPrices[sku];
  skuPrices = nextPrices;
  save();
  render();
}

function resetAfterDialogClose() {
  resetManualDialog();
}

function clearDispatchedOrders() {
  const dispatchedOrders = orders.filter((order) =>
    order.status === "despachado" &&
    matchesDispatchedClearFilters(order)
  );
  const dispatchedExchanges = exchanges.filter((exchange) =>
    exchange.status === "despachado" &&
    !exchange.clearedFromBoard &&
    matchesDispatchedClearFilters(exchange)
  );
  const dispatchedCount = dispatchedOrders.length + dispatchedExchanges.length;
  if (dispatchedCount === 0) return;

  const hasFilters = processSearch.trim() ||
    shippingFilter !== "todos" ||
    skuFilter !== "todos" ||
    dtfFilterActive ||
    processPaymentFilter !== "todos";
  const scope = hasFilters ? "visible(s) con los filtros actuales" : "despachado(s)";
  const confirmed = window.confirm(`Vas a limpiar ${dispatchedCount} pedido(s) ${scope}. El backup diario no se borra. ¿Confirmas?`);
  if (!confirmed) return;

  dispatchedOrders.forEach(syncBackupPrintOwnerForOrder);
  dispatchedExchanges.forEach(syncBackupPrintOwnerForOrder);
  dispatchedOrders.forEach(rememberDismissedOrder);
  const dispatchedOrderIds = new Set(dispatchedOrders.map((order) => order.id));
  const dispatchedExchangeIds = new Set(dispatchedExchanges.map((exchange) => exchange.id));
  orders = orders.filter((order) => !dispatchedOrderIds.has(order.id));
  const timestamp = new Date().toISOString();
  exchanges = exchanges.map((exchange) => {
    if (!dispatchedExchangeIds.has(exchange.id)) return exchange;
    return touchOrder({
      ...exchange,
      clearedFromBoard: true,
      clearedFromBoardAt: timestamp
    }, timestamp);
  });
  save();
  render();
}

function deleteOrder(id) {
  const order = orders.find((item) => item.id === id);
  if (!order) return;
  const hasBackupRows = backupRows.some((row) =>
    row.orderId === order.id ||
    row.internalOrderNumber === order.internalOrderNumber ||
    row.storeOrderNumber === order.storeOrderNumber
  );
  const confirmed = window.confirm(hasBackupRows
    ? `Vas a cancelar el pedido de ${order.customer}. Se quitara del tablero y quedara en la solapa Cancelados. ¿Confirmas?`
    : `Vas a eliminar el pedido de ${order.customer}. ¿Confirmas?`);
  if (!confirmed) return;

  rememberDismissedOrder(order);
  if (hasBackupRows) markBackupRowsCancelled(order, "Cancelado");
  orders = orders.filter((item) => item.id !== id);
  save();
  render();
}

function renderAccountSettings() {
  mercadoPagoAccount.value = accountSettings.mercadoPago;
  transferAccount.value = accountSettings.transfer;
}

function updateAccountSetting(type, value) {
  accountSettings = { ...accountSettings, [type]: value };
  orders = orders.map((order) => {
    if (order.status !== "definir") return order;
    const account = accountForPayment(order.paymentMethod, "");
    return {
      ...order,
      account,
      commissionRate: commissionForAccount(account),
      invoice: invoiceStatusForPayment(order.paymentMethod)
    };
  });
  save();
  render();
}

function backupRowValues(row) {
  const quantity = roundMoney(row.quantity || 0);
  const purchasePrice = roundMoney(row.purchasePrice || 0);
  const salePrice = roundMoney(row.salePrice || 0);
  const shippingValue = roundMoney(row.shippingValue || 0);
  const commissionRate = Number(row.commissionRate || 0);
  const totalCost = roundMoney(purchasePrice * quantity);
  const totalSale = roundMoney(salePrice * quantity);
  const commission = roundMoney(totalSale * (commissionRate / 100));
  const gain = roundMoney(totalSale - totalCost - shippingValue - commission);
  const payOnDelivery = normalize(row.paymentMethod) === "abonar al recibir";
  const payOnDeliveryCollected = row.fluxCollectedValue !== null && row.fluxCollectedValue !== undefined && row.fluxCollectedValue !== "";
  const hideSaleValues = payOnDelivery && !payOnDeliveryCollected;

  return [
    row.internalOrderNumber,
    row.approvedDate,
    row.sku,
    quantity,
    purchasePrice,
    totalCost,
    hideSaleValues ? "" : salePrice,
    hideSaleValues ? "" : totalSale,
    row.paymentMethod,
    row.account,
    shippingValue,
    row.shippingCompany,
    row.salesChannel,
    `${commissionRate.toFixed(3)} %`,
    hideSaleValues ? "" : gain,
    row.customer,
    row.postalCode,
    row.invoice,
    row.color,
    row.size,
    row.statusLabel || backupStatusLabel(row.status),
    row.cancelled ? "Si" : "No",
    row.notes
  ];
}

function roundMoney(value) {
  let number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  while (Math.abs(number) >= 1000000) number /= 1000;
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function formatExcelNumber(value) {
  if (value === "" || value === null || value === undefined) return "";
  const number = roundMoney(value);
  if (!Number.isFinite(number)) return value;
  return number.toFixed(2).replace(".", ",");
}

function excelCellValue(value, cellIndex) {
  const numericColumns = [3, 4, 5, 6, 7, 10, 14].includes(cellIndex);
  return numericColumns ? formatExcelNumber(value) : value;
}

function excelNumericAttribute(value, cellIndex) {
  const numericColumns = [3, 4, 5, 6, 7, 10, 14].includes(cellIndex);
  if (!numericColumns || value === "" || value === null || value === undefined) return "";
  const number = roundMoney(value);
  return Number.isFinite(number) ? ` x:num="${number}"` : "";
}

function backupGroupKey(row) {
  return row.orderId || row.internalOrderNumber || row.storeOrderNumber || row.id;
}

function consecutiveBackupRowspan(rows, startIndex, key) {
  let count = 0;
  for (let index = startIndex; index < rows.length; index += 1) {
    if (backupGroupKey(rows[index]) !== key) break;
    count += 1;
  }
  return count;
}

function buildExcelBlob(rows) {
  const head = backupHeaders.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  let groupIndex = -1;
  const body = rows
    .map((row, rowIndex) => {
      const values = backupRowValues(row);
      const key = backupGroupKey(row);
      const previousKey = rowIndex > 0 ? backupGroupKey(rows[rowIndex - 1]) : "";
      const firstInGroup = key !== previousKey;
      if (firstInGroup) groupIndex += 1;
      const rowClasses = [
        firstInGroup ? "order-start" : "",
        groupIndex % 2 === 0 ? "order-even" : "order-odd",
        row.cancelled ? "cancelled-row" : ""
      ].filter(Boolean).join(" ");
      const cells = values.map((value, cellIndex) => {
        const numericClass = [3, 4, 5, 6, 7, 10, 14].includes(cellIndex) ? " number-cell" : "";
        const displayValue = excelCellValue(value, cellIndex);
        const numericAttribute = excelNumericAttribute(value, cellIndex);
        if (cellIndex !== 0) return `<td class="col-${cellIndex}${numericClass}"${numericAttribute}>${escapeHtml(displayValue)}</td>`;
        if (!firstInGroup) return "";
        const rowspan = consecutiveBackupRowspan(rows, rowIndex, key);
        const rowspanAttribute = rowspan > 1 ? ` rowspan="${rowspan}"` : "";
        return `<td class="order-number"${rowspanAttribute}>${escapeHtml(displayValue)}</td>`;
      }).join("");
      return `<tr class="${rowClasses}">${cells}</tr>`;
    })
    .join("");
  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
      <head>
        <meta charset="utf-8">
        <style>
          body {
            font-family: Arial, sans-serif;
            color: #111827;
          }
          table {
            border-collapse: collapse;
            width: 100%;
          }
          th {
            background: #5330a0;
            color: #ffffff;
            border: 1px solid #3f2479;
            font-size: 12px;
            font-weight: 700;
            padding: 8px 10px;
            text-align: left;
            white-space: nowrap;
          }
          td {
            border: 1px solid #d1d5db;
            font-size: 12px;
            padding: 7px 10px;
            vertical-align: middle;
          }
          .number-cell {
            text-align: right;
            mso-number-format: "#,##0.00";
          }
          .order-number {
            background: #ede8fa;
            border-left: 3px solid #6c3fc5;
            color: #3f2479;
            font-size: 14px;
            font-weight: 700;
            text-align: center;
            vertical-align: middle;
          }
          .order-start td {
            border-top: 3px solid #6c3fc5;
          }
          .order-even td {
            background: #ffffff;
          }
          .order-odd td {
            background: #f9fafb;
          }
          .cancelled-row td,
          .cancelled-row .order-number {
            background: #fce7f3 !important;
            color: #831843;
          }
          .order-even .order-number,
          .order-odd .order-number {
            background: #ede8fa;
          }
          .cancelled-row .order-number {
            background: #fce7f3 !important;
            color: #831843 !important;
          }
          .col-2 {
            font-weight: 700;
          }
          .col-8,
          .col-11,
          .col-12 {
            color: #374151;
          }
          .col-14 {
            font-weight: 700;
          }
        </style>
      </head>
      <body>
        <table>
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </body>
    </html>
  `;
  return new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
}

function parseMoneyInput(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const clean = text
    .replace(/\$/g, "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  return Number(clean || 0);
}

function normalizeFluxZone(value) {
  const normalized = normalize(value);
  if (normalized.includes("caba") || normalized.includes("capital")) return 0;
  if (normalized.includes("primer")) return 1;
  if (normalized.includes("segundo")) return 2;
  if (normalized.includes("tercer")) return 3;
  const clean = normalized.replace(/\D/g, "");
  if (clean === "") return null;
  const zone = Number(clean);
  return Object.prototype.hasOwnProperty.call(fluxZoneCosts, zone) ? zone : null;
}

function fluxZoneByPostalCode(postalCode) {
  const digits = String(postalCode || "").replace(/\D/g, "");
  if (!/^\d{4}$/.test(digits)) return null;
  const code = Number(digits);
  if (code >= 1000 && code <= 1499) return 0;
  return null;
}

function parseFluxSettlementLine(line) {
  const raw = String(line || "").trim();
  if (!raw) return null;

  const tabColumns = raw.includes("\t")
    ? raw.split("\t").map((part) => part.trim())
    : null;
  const columns = tabColumns || raw.split(/[;,|]+/).map((part) => part.trim()).filter(Boolean);

  if (columns.length >= 2) {
    const zone = normalizeFluxZone(columns[1]);
    if (zone === null) return null;
    return {
      internalOrderNumber: columns[0],
      zone,
      collected: columns[2] ? parseMoneyInput(columns[2]) : null,
      shipping: fluxZoneCosts[zone]
    };
  }

  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const internalOrderNumber = parts.shift();
  let zone = null;
  let collected = null;
  for (let splitIndex = 1; splitIndex <= parts.length; splitIndex += 1) {
    const possibleZone = normalizeFluxZone(parts.slice(0, splitIndex).join(" "));
    if (possibleZone === null) continue;
    zone = possibleZone;
    collected = parts.slice(splitIndex).join(" ");
    break;
  }
  if (zone === null) return null;
  return {
    internalOrderNumber,
    zone,
    collected: collected ? parseMoneyInput(collected) : null,
    shipping: fluxZoneCosts[zone]
  };
}

function applyFluxSettlement(event) {
  event.preventDefault();
  const lines = String(fluxSettlementInput.value || "")
    .split(/\r?\n/)
    .map(parseFluxSettlementLine)
    .filter(Boolean);

  if (lines.length === 0) {
    window.alert("Pega al menos una linea con: pedido cordon cobrado-opcional.");
    return;
  }

  const notFound = [];
  const zoneMismatches = [];
  const missingCollected = [];
  let updatedOrders = 0;
  let totalCollected = 0;
  let totalShipping = 0;

  lines.forEach((line) => {
    const rows = backupRows.filter((row) =>
      String(row.internalOrderNumber || "").trim() === String(line.internalOrderNumber).trim() &&
      normalize(row.shippingCompany).includes("flux")
    );
    if (rows.length === 0) {
      notFound.push(line.internalOrderNumber);
      return;
    }

    const totalQuantity = rows.reduce((sum, row) => sum + Number(row.quantity || 1), 0) || 1;
    const salePerUnit = line.collected !== null ? line.collected / totalQuantity : null;
    const shippingPerUnit = line.shipping / totalQuantity;
    const expectedZone = rows
      .map((row) => row.fluxExpectedZone ?? fluxZoneByPostalCode(row.postalCode))
      .find((zone) => zone !== null && zone !== undefined);
    if (expectedZone !== undefined && expectedZone !== line.zone) {
      zoneMismatches.push(`${line.internalOrderNumber}: esperado ${expectedZone} (${fluxZoneNames[expectedZone]}), Flux informo ${line.zone} (${fluxZoneNames[line.zone]})`);
    }

    backupRows = backupRows.map((row) => {
      if (!rows.some((match) => match.id === row.id)) return row;
      const quantity = Number(row.quantity || 1);
      const payOnDelivery = normalize(row.paymentMethod) === "abonar al recibir";
      if (payOnDelivery && salePerUnit === null) missingCollected.push(line.internalOrderNumber);
      return {
        ...row,
        salePrice: payOnDelivery && salePerUnit !== null ? salePerUnit : row.salePrice,
        shippingValue: shippingPerUnit * quantity,
        totalShippingValue: line.shipping,
        fluxZone: line.zone,
        fluxZoneName: fluxZoneNames[line.zone],
        fluxCollectedValue: line.collected,
        fluxSettledAt: new Date().toISOString()
      };
    });

    updatedOrders += 1;
    totalCollected += line.collected || 0;
    totalShipping += line.shipping;
  });

  save();
  render();

  const message = [
    `Liquidacion Flux aplicada.`,
    `Pedidos actualizados: ${updatedOrders}`,
    `Total ingresado: ${formatMoney(totalCollected)}`,
    `Total envios: ${formatMoney(totalShipping)}`,
    zoneMismatches.length ? `Revisar cordon:\n${zoneMismatches.join("\n")}` : "",
    missingCollected.length ? `Abonar al recibir sin cobro informado: ${[...new Set(missingCollected)].join(", ")}` : "",
    notFound.length ? `No encontrados: ${notFound.join(", ")}` : ""
  ].filter(Boolean).join("\n");
  window.alert(message);
}

function downloadDtfHtml() {
  const rows = operationalOrders()
    .filter((order) => order.status === "preparacion")
    .flatMap((order) =>
      orderItems(order)
        .filter((item) => isDtfSku(item.sku) && detailItemStatus(item) !== "armado")
        .map((item) => ({ order, item }))
    )
    .sort((left, right) => pendingProductLabel(left.item).localeCompare(pendingProductLabel(right.item)));

  if (rows.length === 0) {
    window.alert("No hay productos DTF/3D faltantes en preparacion para descargar.");
    return;
  }

  const html = `
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8">
        <title>DTF y 3D pendientes ${today()}</title>
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: #f6f7fb;
            color: #111827;
            font-family: Arial, sans-serif;
          }
          header {
            background: #ffffff;
            border-bottom: 1px solid #e5e7eb;
            padding: 20px 24px;
            position: sticky;
            top: 0;
          }
          h1 {
            font-size: 22px;
            margin: 0 0 4px;
          }
          p {
            color: #6b7280;
            margin: 0;
          }
          main {
            display: grid;
            gap: 14px;
            grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
            padding: 20px;
          }
          article {
            background: #ffffff;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            overflow: hidden;
          }
          .photo {
            align-items: center;
            background: #f3f4f6;
            display: flex;
            height: 190px;
            justify-content: center;
          }
          img {
            max-height: 190px;
            max-width: 100%;
            object-fit: contain;
          }
          .empty-photo {
            color: #9ca3af;
            font-size: 13px;
          }
          .info {
            display: grid;
            gap: 6px;
            padding: 12px;
          }
          strong {
            font-size: 14px;
            line-height: 1.3;
          }
          span {
            color: #4b5563;
            font-size: 13px;
          }
          b {
            color: #111827;
            font-size: 13px;
          }
        </style>
      </head>
      <body>
        <header>
          <h1>DTF y 3D faltantes en preparacion</h1>
          <p>${rows.length} producto(s) - ${today()}</p>
        </header>
        <main>
          ${rows.map(({ order, item }) => `
            <article>
              <div class="photo">
                ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="">` : '<div class="empty-photo">Sin foto</div>'}
              </div>
              <div class="info">
                <strong>${escapeHtml(item.name || item.sku)}</strong>
                <b>SKU: ${escapeHtml(item.sku)}</b>
                <span>Pedido: ${escapeHtml(order.internalOrderNumber || order.storeOrderNumber || "")}</span>
                <span>Cliente: ${escapeHtml(order.customer)}</span>
                <span>Talle: ${escapeHtml(item.size || "Sin talle")} | Color: ${escapeHtml(item.color || "Sin color")}</span>
                <span>Cantidad: ${escapeHtml(item.quantity || 1)}</span>
              </div>
            </article>
          `).join("")}
        </main>
      </body>
    </html>
  `;

  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `dtf-3d-preparacion-${today()}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadPendingProductsHtml() {
  const rows = orders
    .filter((order) => order.status === "preparacion")
    .flatMap((order) =>
      orderItems(order)
        .filter((item) => !detailItemWasHandled(item))
        .flatMap((item) => expandPendingProductItem(item).map((expandedItem) => ({ order, item: expandedItem })))
    );

  if (rows.length === 0) {
    window.alert("No hay productos pendientes en preparacion para descargar.");
    return;
  }

  const groups = groupPendingProducts(rows);
  const totalUnits = rows.reduce((sum, { item }) => sum + Number(item.quantity || 1), 0);
  const html = `
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8">
        <title>Productos pendientes ${today()}</title>
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: #f8fafc;
            color: #111827;
            font-family: Arial, sans-serif;
          }
          header {
            background: #ffffff;
            border-bottom: 1px solid #e5e7eb;
            padding: 20px 24px;
            position: sticky;
            top: 0;
          }
          h1 {
            font-size: 22px;
            margin: 0 0 4px;
          }
          p {
            color: #6b7280;
            margin: 0;
          }
          main {
            display: grid;
            gap: 18px;
            max-width: 900px;
            margin: 0 auto;
            padding: 20px;
          }
          article {
            background: #ffffff;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 18px 20px;
          }
          h2 {
            font-size: 20px;
            margin: 0 0 14px;
          }
          section + section {
            margin-top: 16px;
          }
          h3 {
            color: #374151;
            font-size: 16px;
            margin: 0 0 7px;
          }
          ul {
            list-style: none;
            margin: 0;
            padding: 0;
          }
          li {
            font-size: 16px;
            line-height: 1.55;
          }
        </style>
      </head>
      <body>
        <header>
          <h1>Productos pendientes en preparacion</h1>
          <p>${rows.length} producto(s), ${totalUnits} unidad(es) - ${today()}</p>
        </header>
        <main>
          ${groups.map((product) => `
            <article>
              <h2>${escapeHtml(product.label)}</h2>
              ${product.colors.map((colorGroup) => `
                <section>
                  <h3>${escapeHtml(colorGroup.color)}</h3>
                  <ul>
                    ${colorGroup.sizes.map((sizeGroup) => `
                      <li>${escapeHtml(sizeGroup.size)}${sizeGroup.quantity > 1 ? ` x${sizeGroup.quantity}` : ""}</li>
                    `).join("")}
                  </ul>
                </section>
              `).join("")}
            </article>
          `).join("")}
        </main>
      </body>
    </html>
  `;

  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `pendientes-preparacion-${today()}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function splitCustomerName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || "", lastName: "" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.slice(-1).join(" ")
  };
}

function phoneParts(phone) {
  const digits = String(phone || "").replace(/\D/g, "").replace(/^54/, "").replace(/^0/, "");
  const clean = digits.startsWith("9") ? digits.slice(1) : digits;
  if (clean.length <= 8) return { phoneArea: "", phoneNumber: clean };
  const areaLength = clean.startsWith("11") ? 2 : 3;
  return {
    phoneArea: clean.slice(0, areaLength),
    phoneNumber: clean.slice(areaLength)
  };
}

function andreaniDestination(order) {
  const address = order.shippingAddress || {};
  return [
    address.province || "BUENOS AIRES",
    address.city || address.locality || "",
    order.postalCode || address.postalCode || ""
  ].filter(Boolean).map((part) => String(part).toUpperCase()).join(" / ");
}

function orderDeclaredValue(order) {
  return orderItems(order).reduce((sum, item) => {
    return sum + Number(item.salePrice || 0) * Number(item.quantity || 1);
  }, 0);
}

function firstText(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function pickupDetailValue(details, ...keys) {
  if (!details) return "";
  if (typeof details !== "object") return String(details).trim();

  const wantedKeys = keys.map((key) => normalize(key));
  const seen = new Set();
  const stack = [details];

  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    for (const [key, value] of Object.entries(current)) {
      const normalizedKey = normalize(key);
      const matches = wantedKeys.some((wanted) => normalizedKey.includes(wanted) || wanted.includes(normalizedKey));
      if (matches && value !== null && value !== undefined && typeof value !== "object") {
        const text = String(value).trim();
        if (text) return text;
      }
      if (value && typeof value === "object") stack.push(value);
    }
  }

  return "";
}

function cleanGenericBranchName(value) {
  let text = String(value || "").trim();
  if (!text) return "";
  text = text
    .replace(/\b(punto\s+hop|hop|sucursal\s+andreani|andreani|punto\s+de\s+retiro|punto\s+de\s+entrega|pickup\s+point|retiro\s+en\s+sucursal|retiro\s+sucursal|punto)\b/ig, " ")
    .replace(/[-–—:|()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length >= 3 ? text : "";
}

function andreaniShipmentFromOrder(order) {
  const address = order.shippingAddress || {};
  const name = splitCustomerName(order.customer);
  const phone = phoneParts(order.customerPhone);

  // Detectar si es envío a sucursal (pickup point) o a domicilio
  const pickupDetails = order.shippingPickupDetails || null;
  const pickupType = order.shippingPickupType || null;
  const rawBranchName = firstText(
    pickupDetailValue(pickupDetails, "name", "branch_name", "descripcion", "description", "sucursal", "agency", "office", "store"),
    pickupDetailValue(pickupDetails, "nombre", "nombreSucursal", "nombre_sucursal", "punto_retiro", "pickup_point_name")
  );
  const cleanBranchName = cleanGenericBranchName(rawBranchName);
  const shippingText = normalize([
    order.shippingCompany,
    order.shippingOption,
    pickupType,
    rawBranchName
  ].filter(Boolean).join(" "));
  const hasHomeAddress = Boolean(address.street || address.fullAddress || address.number);
  const hasPickupSignal = Boolean(
    shippingText.includes("sucursal") ||
    shippingText.includes("retiro") ||
    shippingText.includes("pickup") ||
    shippingText.includes("punto de entrega") ||
    shippingText.includes("punto de retiro")
  );
  const isSucursal = Boolean(
    hasPickupSignal ||
    (rawBranchName && !hasHomeAddress) ||
    (pickupType && !["delivery", "home", "domicilio", "envio a domicilio"].includes(normalize(pickupType)) && !hasHomeAddress)
  );
  const branchName = cleanBranchName;

  const missing = [];
  if (!isSucursal) {
    if (!address.street && !address.fullAddress) missing.push("calle");
    if (!address.number) missing.push("altura");
  } else {
    if (!branchName) missing.push("nombre de sucursal");
  }
  if (!phone.phoneArea || !phone.phoneNumber) missing.push("telefono");
  if (!order.customerDocument) missing.push("DNI");
  if (!order.customerEmail) missing.push("email");

  const observations = [
    `Pedido ${order.internalOrderNumber || order.storeOrderNumber || ""}`,
    logisticsOrderNotes(order),
    missing.length ? `Completar/revisar: ${missing.join(", ")}` : ""
  ].filter(Boolean).join(" - ");

  return {
    deliveryType: isSucursal ? "sucursal" : "domicilio",
    packageName: "8 prendas",
    weightGrams: 300,
    heightCm: 30,
    widthCm: 20,
    depthCm: 5,
    declaredValue: orderDeclaredValue(order),
    internalOrderNumber: order.internalOrderNumber || order.storeOrderNumber || "",
    firstName: name.firstName,
    lastName: name.lastName,
    dni: order.customerDocument || "",
    email: order.customerEmail || "",
    phoneArea: phone.phoneArea,
    phoneNumber: phone.phoneNumber,
    // Domicilio
    street: address.street || address.fullAddress || "",
    streetNumber: address.number || "",
    floor: address.floor || "",
    apartment: address.apartment || "",
    destination: andreaniDestination(order),
    province: address.province || "",
    locality: address.city || address.locality || "",
    postalCode: order.postalCode || address.postalCode || "",
    // Sucursal
    branchName,
    branchLookup: {
      rawName: firstText(branchName, cleanGenericBranchName(pickupDetailValue(pickupDetails, "nombre", "description", "descripcion", "name"))),
      code: firstText(pickupDetailValue(pickupDetails, "codigo", "code", "branch_code", "sucursal_codigo", "id")),
      postalCode: firstText(pickupDetailValue(pickupDetails, "codigoPostal", "postalCode", "zipcode", "zip_code", "cp"), order.postalCode, address.postalCode),
      locality: firstText(pickupDetailValue(pickupDetails, "localidad", "city", "locality"), address.city, address.locality),
      province: firstText(pickupDetailValue(pickupDetails, "provincia", "province", "state"), address.province),
      street: firstText(pickupDetailValue(pickupDetails, "calle", "street", "direccion", "address"), address.street),
      number: firstText(pickupDetailValue(pickupDetails, "numero", "number", "street_number", "altura"), address.number)
    },
    observations
  };
}

function andreaniCandidateOrders() {
  return operationalOrders().filter((order) =>
    normalize(order.shippingCompany).includes("andreani") &&
    ["preparacion", "armado"].includes(order.status)
  ).sort((left, right) => orderSortNumber(left) - orderSortNumber(right));
}

function orderSortNumber(order) {
  const value = Number(order.internalOrderNumber || order.orderNumber || order.storeOrderNumber || order.id || 0);
  return Number.isFinite(value) && value > 0 ? value : Number.MAX_SAFE_INTEGER;
}

function shouldPreselectLabelModalOrder(order) {
  return !(["preparacion", "armado"].includes(order.status) && order.labelReady);
}

function openAndreaniLabelsDialog() {
  const selectedOrders = andreaniCandidateOrders();

  if (selectedOrders.length === 0) {
    window.alert("No hay pedidos Andreani en preparacion o armado para exportar.");
    return;
  }

  andreaniDialogCount.textContent = `${selectedOrders.length} pedido(s) Andreani listos para exportar.`;
  andreaniSelectList.innerHTML = selectedOrders.map((order) => {
    const label = order.internalOrderNumber || order.storeOrderNumber || order.id;
    const tn = order.storeOrderNumber ? `TN: ${order.storeOrderNumber}` : "Sin TN";
    const status = processStatuses.find((item) => item.id === order.status)?.label || order.status;
    const checked = shouldPreselectLabelModalOrder(order) ? " checked" : "";
    const address = order.shippingAddress || {};
    const destination = [address.city || address.locality, order.postalCode || address.postalCode]
      .filter(Boolean)
      .join(" - ");
    const note = [order.packagingNote, internalOrderNote(order)]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" - ");
    const noteText = note ? ` (${note})` : "";

    return `
      <label class="andreani-option">
        <input type="checkbox" value="${escapeHtml(order.id)}"${checked}>
        <span>
          <strong>${escapeHtml(label)} - ${escapeHtml(order.customer || "Sin cliente")}${escapeHtml(noteText)}</strong>
          <span>${escapeHtml(tn)} - ${escapeHtml(order.customerPhone || "Sin telefono")} - ${escapeHtml(destination || "Sin destino")} </span>
        </span>
        <b>${escapeHtml(status)}</b>
      </label>
    `;
  }).join("");
  syncAndreaniSelectAllState();
  andreaniDialog.showModal();
}

function syncAndreaniSelectAllState() {
  const boxes = [...andreaniSelectList.querySelectorAll('input[type="checkbox"]')];
  andreaniSelectAll.checked = boxes.length > 0 && boxes.every((box) => box.checked);
  andreaniSelectAll.indeterminate = boxes.some((box) => box.checked) && !andreaniSelectAll.checked;
}

async function downloadAndreaniLabels(selectedOrders) {
  if (!selectedOrders.length) {
    window.alert("Selecciona al menos un pedido Andreani.");
    return;
  }

  const shipments = selectedOrders.map(andreaniShipmentFromOrder);
  const response = await fetch("api/andreani/labels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shipments })
  });

  if (!response.ok) {
    window.alert("No se pudo generar el Excel de Andreani.");
    return;
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `andreani-rotulos-${today()}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fluxCandidateOrders() {
  return operationalOrders().filter((order) =>
    normalize(order.shippingCompany).includes("flux") &&
    ["preparacion", "armado"].includes(order.status)
  ).sort((left, right) => orderSortNumber(left) - orderSortNumber(right));
}

function openFluxShipmentsDialog() {
  const selectedOrders = fluxCandidateOrders();
  fluxDialogCount.textContent = selectedOrders.length
    ? `${selectedOrders.length} pedido(s) Flux listos para enviar.`
    : "No hay pedidos Flux en preparacion o armado.";
  fluxSelectList.innerHTML = selectedOrders.map((order) => {
    const address = order.shippingAddress || {};
    const destination = [address.city || address.locality, order.postalCode || address.postalCode]
      .filter(Boolean)
      .join(" - ");
    const note = [order.packagingNote, internalOrderNote(order)]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" - ");
    const noteText = note ? ` (${note})` : "";
    const sent = order.fluxSentAt ? "Ya enviado" : "Pendiente";
    const checked = shouldPreselectLabelModalOrder(order) ? " checked" : "";
    return `
      <label class="andreani-option">
        <input type="checkbox" value="${escapeHtml(order.id)}"${checked}>
        <span>
          <strong>${escapeHtml(order.internalOrderNumber || order.storeOrderNumber || order.id)} - ${escapeHtml(order.customer)}${escapeHtml(noteText)}</strong>
          <span>${escapeHtml(destination || "Sin localidad/CP")} | ${escapeHtml(order.paymentMethod)}</span>
        </span>
        <b>${escapeHtml(sent)}</b>
      </label>
    `;
  }).join("") || '<p class="empty">No hay pedidos Flux para enviar.</p>';
  syncFluxSelectAllState();
  fluxDialog.showModal();
}

function syncFluxSelectAllState() {
  const boxes = [...fluxSelectList.querySelectorAll('input[type="checkbox"]')];
  fluxSelectAll.checked = boxes.length > 0 && boxes.every((box) => box.checked);
  fluxSelectAll.indeterminate = boxes.some((box) => box.checked) && !fluxSelectAll.checked;
}

function bulkLabelCandidateOrders() {
  return operationalOrders().filter((order) =>
    order.status === "rotulado" &&
    matchesCustomerSearch(order, processSearch) &&
    matchesShippingFilter(order) &&
    matchesSkuFilter(order) &&
    matchesProcessPaymentFilter(order, "rotulado")
  ).sort((left, right) => orderSortNumber(left) - orderSortNumber(right));
}

function mpReviewCandidateOrders() {
  return operationalOrders().filter((order) =>
    order.status === "preparacion" &&
    normalize(order.paymentMethod) === "mercado pago" &&
    !order.paymentReviewed &&
    matchesCustomerSearch(order, processSearch) &&
    matchesShippingFilter(order) &&
    matchesSkuFilter(order) &&
    matchesProcessPaymentFilter(order, "preparacion")
  ).sort((left, right) => orderSortNumber(left) - orderSortNumber(right));
}

function mpReviewLine(order) {
  const date = formatCopyDate(order.purchasedAt || order.approvedAt || order.createdAt);
  const number = String(order.internalOrderNumber || order.storeOrderNumber || order.id || "").trim();
  const paymentId = String(order.paymentGatewayId || order.gatewayId || "").trim();
  return `${date} - ${number} - ${paymentId || "sin payment_id"}`;
}

function openMpReviewDialog() {
  const selectedOrders = mpReviewCandidateOrders();
  const text = selectedOrders.map(mpReviewLine).join("\n");
  mpReviewCount.textContent = selectedOrders.length
    ? `${selectedOrders.length} pedido(s) Mercado Pago en preparacion sin revisar segun los filtros activos.`
    : "No hay pedidos Mercado Pago sin revisar en preparacion con los filtros actuales.";
  mpReviewText.value = text;
  copyMpReview.disabled = selectedOrders.length === 0;
  mpReviewDialog.showModal();
  if (text) {
    mpReviewText.focus();
    mpReviewText.select();
  }
}

async function copyMpReviewAndMark() {
  const selectedOrders = mpReviewCandidateOrders();
  if (!selectedOrders.length) {
    window.alert("No hay pedidos Mercado Pago sin revisar para copiar.");
    return;
  }
  const text = selectedOrders.map(mpReviewLine).join("\n");
  mpReviewText.value = text;
  try {
    await copyTextToClipboard(text);
  } catch {
    mpReviewText.focus();
    mpReviewText.select();
    window.alert("No pude copiar automaticamente. El texto quedo seleccionado para que lo copies manualmente.");
    return;
  }

  const selectedIds = new Set(selectedOrders.map((order) => order.id));
  const timestamp = new Date().toISOString();
  orders = orders.map((order) =>
    selectedIds.has(order.id) ? touchOrder({ ...order, paymentReviewed: true }, timestamp) : order
  );
  exchanges = exchanges.map((exchange) =>
    selectedIds.has(exchange.id) ? touchOrder({ ...exchange, paymentReviewed: true }, timestamp) : exchange
  );
  save();
  render();
  const saved = await flushRemoteSaveNow({ replace: true });
  mpReviewDialog.close();
  window.alert([
    `Copiado y marcado como revisado: ${selectedOrders.length} pedido(s).`,
    saved ? "" : "Ojo: no pude confirmar el guardado en la nube. Revisalo antes de cerrar."
  ].filter(Boolean).join("\n"));
}

function openBulkLabelDialog() {
  const selectedOrders = bulkLabelCandidateOrders();
  bulkLabelCount.textContent = selectedOrders.length
    ? `${selectedOrders.length} pedido(s) en Rotulado segun los filtros activos.`
    : "No hay pedidos en Rotulado para pasar a Despachado con los filtros actuales.";
  bulkLabelList.innerHTML = selectedOrders.map((order) => {
    const address = order.shippingAddress || {};
    const destination = [address.city || address.locality, order.postalCode || address.postalCode]
      .filter(Boolean)
      .join(" - ");
    const note = [order.packagingNote, internalOrderNote(order)]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" - ");
    const noteText = note ? ` (${note})` : "";
    return `
      <label class="andreani-option bulk-label-option">
        <input type="checkbox" value="${escapeHtml(order.id)}" checked>
        <span>
          <strong>${escapeHtml(order.internalOrderNumber || order.storeOrderNumber || order.id)} - ${escapeHtml(order.customer || "Sin cliente")}${escapeHtml(noteText)}</strong>
          <span>${escapeHtml(order.shippingCompany || "Sin envio")} - ${escapeHtml(destination || "Sin destino")}</span>
        </span>
        <input class="bulk-tracking-input" data-bulk-tracking="${escapeHtml(order.id)}" value="${escapeHtml(order.trackingCode || "")}" placeholder="Seguimiento">
      </label>
    `;
  }).join("") || '<p class="empty">No hay pedidos para rotular con los filtros actuales.</p>';
  bulkLabelSelectAll.checked = selectedOrders.length > 0;
  bulkLabelSelectAll.indeterminate = false;
  bulkLabelDialog.showModal();
}

function syncBulkLabelSelectAllState() {
  const boxes = [...bulkLabelList.querySelectorAll('input[type="checkbox"]')];
  bulkLabelSelectAll.checked = boxes.length > 0 && boxes.every((box) => box.checked);
  bulkLabelSelectAll.indeterminate = boxes.some((box) => box.checked) && !bulkLabelSelectAll.checked;
}

function fluxShipmentIdFromValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const text = value.trim();
    if (/^\d+$/.test(text)) return text;
    const match = text.match(/\b\d{3,}\b/);
    return match ? match[0] : "";
  }
  if (typeof value !== "object") return "";
  const candidates = [
    value.id,
    value.idEnvio,
    value.did,
    value.didenvio,
    value.mensaje,
    value.message,
    value.data?.id,
    value.data?.idEnvio,
    value.data?.did,
    value.data?.didenvio
  ];
  return candidates.map(fluxShipmentIdFromValue).find(Boolean) || "";
}

function fluxShipmentId(order) {
  return [
    order.fluxShipmentId,
    order.fluxShipmentCode,
    order.fluxLastResponse
  ].map(fluxShipmentIdFromValue).find(Boolean) || "";
}

function fluxStatusLookupId(order) {
  return fluxShipmentId(order) ||
    String(order.internalOrderNumber || "").trim() ||
    String(order.storeOrderNumber || "").trim();
}

function isFluxOrder(order) {
  return normalize(order.shippingCompany).includes("flux");
}

function fluxStatusAllowsDispatch(statusCode) {
  const code = Number(statusCode);
  return [0, 1, 2, 5, 6].includes(code);
}

async function checkFluxStatusesBeforeDispatch(selectedOrders) {
  const fluxOrders = selectedOrders.filter(isFluxOrder);
  if (!fluxOrders.length) return { allowedIds: new Set(selectedOrders.map((order) => order.id)), statuses: new Map() };

  const missing = fluxOrders.filter((order) => !fluxStatusLookupId(order));
  const consultable = fluxOrders.filter((order) => fluxStatusLookupId(order));
  const statuses = new Map();
  const blocked = [];
  const blockedIds = new Set();
  const errors = [];

  if (consultable.length) {
    try {
      const response = await fetch("api/flux/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: consultable.map(fluxStatusLookupId) })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) {
        throw new Error(data.error || `El servidor respondio ${response.status}`);
      }
      const byFluxId = new Map((data.results || []).map((result) => [String(result.idEnvio || ""), result]));
      consultable.forEach((order) => {
        const result = byFluxId.get(fluxStatusLookupId(order));
        if (!result || result.success === false) {
          errors.push(`${orderLabel(order)}: no pude consultar estado`);
          return;
        }
        statuses.set(order.id, result);
        if (!fluxStatusAllowsDispatch(result.statusCode)) {
          blocked.push(`${orderLabel(order)}: ${result.statusLabel || result.statusCode}`);
          blockedIds.add(order.id);
        }
      });
    } catch (error) {
      errors.push(`No pude consultar Flux: ${error.message}`);
    }
  }

  if (missing.length) {
    errors.push(...missing.map((order) => `${orderLabel(order)}: sin ID de envio Flux guardado`));
  }

  if (blocked.length) {
    window.alert([
      "Estos pedidos Flux siguen sin movimiento suficiente y no se pasan a Despachado:",
      ...blocked
    ].join("\n"));
  }

  if (errors.length) {
    const continueAnyway = window.confirm([
      "Algunos pedidos Flux no se pudieron consultar:",
      ...errors.slice(0, 8),
      errors.length > 8 ? `y ${errors.length - 8} mas.` : "",
      "",
      "¿Queres pasarlos igual?"
    ].filter(Boolean).join("\n"));
    if (!continueAnyway) {
      missing.forEach((order) => blockedIds.add(order.id));
      if (errors.some((message) => message.startsWith("No pude consultar Flux"))) {
        consultable.forEach((order) => blockedIds.add(order.id));
      }
    }
  }

  const allowedIds = new Set(
    selectedOrders
      .filter((order) => !blockedIds.has(order.id))
      .map((order) => order.id)
  );
  return { allowedIds, statuses };
}

async function confirmBulkLabelMove() {
  const selectedIds = [...bulkLabelList.querySelectorAll('input[type="checkbox"]:checked')]
    .map((box) => box.value);
  if (!selectedIds.length) {
    window.alert("Selecciona al menos un pedido.");
    return;
  }

  await refreshRemoteState();
  const trackingById = new Map([...bulkLabelList.querySelectorAll("[data-bulk-tracking]")]
    .map((input) => [input.dataset.bulkTracking, String(input.value || "").trim()]));
  let selectedSet = new Set(selectedIds);
  const currentSelectedOrders = [...orders, ...exchanges].filter((order) => selectedSet.has(order.id) && order.status === "rotulado");
  const fluxCheck = await checkFluxStatusesBeforeDispatch(currentSelectedOrders);
  selectedSet = fluxCheck.allowedIds;
  if (!selectedSet.size) {
    window.alert("No quedo ningun pedido listo para pasar a Despachado.");
    render();
    return;
  }
  const timestamp = new Date().toISOString();
  const tiendanubeResults = new Map();
  const tiendanubeErrors = [];
  let movedCount = 0;

  for (const order of [...orders, ...exchanges]) {
    if (!selectedSet.has(order.id) || order.status !== "rotulado") continue;
    const trackingCode = trackingById.get(order.id) || order.trackingCode || "";
    const effectiveOrder = { ...order, trackingCode };
    if (!canNotifyTiendanubeTracking(effectiveOrder)) continue;
    try {
      const result = await notifyTiendanubeFulfillment(effectiveOrder);
      tiendanubeResults.set(order.id, result.result || result);
    } catch (error) {
      const label = order.internalOrderNumber || order.storeOrderNumber || order.customer || order.id;
      tiendanubeErrors.push(`${label}: ${error.message}`);
    }
  }

  if (tiendanubeErrors.length) {
    const message = [
      "No pude cargar algunos seguimientos en Tienda Nube:",
      ...tiendanubeErrors.slice(0, 8),
      tiendanubeErrors.length > 8 ? `y ${tiendanubeErrors.length - 8} mas.` : "",
      "",
      "¿Queres pasarlos a Despachado igual?"
    ].filter(Boolean).join("\n");
    if (!window.confirm(message)) return;
  }

  orders = orders.map((order) => {
    if (!selectedSet.has(order.id) || order.status !== "rotulado") return order;
    movedCount += 1;
    const trackingCode = trackingById.get(order.id) || order.trackingCode || "";
    const tiendanubeResult = tiendanubeResults.get(order.id);
    return touchOrder({
      ...order,
      status: "despachado",
      statusUpdatedAt: timestamp,
      trackingCode,
      fluxLastStatus: fluxCheck.statuses.get(order.id) || order.fluxLastStatus,
      fluxStatusCheckedAt: fluxCheck.statuses.has(order.id) ? timestamp : order.fluxStatusCheckedAt,
      fluxShipmentId: fluxCheck.statuses.get(order.id)?.fluxShipmentId || order.fluxShipmentId,
      tiendanubeFulfilledAt: tiendanubeResult ? timestamp : order.tiendanubeFulfilledAt,
      tiendanubeTrackingCode: tiendanubeResult ? trackingCode : order.tiendanubeTrackingCode,
      tiendanubeFulfillmentResult: tiendanubeResult || order.tiendanubeFulfillmentResult
    }, timestamp);
  });
  exchanges = exchanges.map((order) => {
    if (!selectedSet.has(order.id) || order.status !== "rotulado") return order;
    movedCount += 1;
    const trackingCode = trackingById.get(order.id) || order.trackingCode || "";
    return touchOrder({
      ...order,
      status: "despachado",
      statusUpdatedAt: timestamp,
      trackingCode,
      fluxLastStatus: fluxCheck.statuses.get(order.id) || order.fluxLastStatus,
      fluxStatusCheckedAt: fluxCheck.statuses.has(order.id) ? timestamp : order.fluxStatusCheckedAt,
      fluxShipmentId: fluxCheck.statuses.get(order.id)?.fluxShipmentId || order.fluxShipmentId
    }, timestamp);
  });

  if (!movedCount) {
    window.alert("Los pedidos seleccionados ya no estan en Rotulado. Actualice la lista.");
    render();
    return;
  }

  save();
  render();
  bulkLabelDialog.close();
}

function splitStreetAndNumber(order) {
  const address = order.shippingAddress || {};
  const street = String(address.street || address.address || address.calle || "").trim();
  const number = String(address.number || address.streetNumber || address.numero || "").trim();
  if (street && number) return { street, number };

  const fullAddress = String(address.fullAddress || address.direccion || street || "").trim();
  const match = fullAddress.match(/^(.*?)(?:\s+(\d{1,6}[a-zA-Z]?))\s*$/);
  if (!match) return { street: fullAddress || street, number };
  return {
    street: (street || match[1] || fullAddress).trim(),
    number: (number || match[2] || "").trim()
  };
}

function fluxLocality(order) {
  const address = order.shippingAddress || {};
  const neighborhood = String(address.neighborhood || address.barrio || address.district || address.area || address.suburb || "").trim();
  const city = String(address.city || address.locality || address.localidad || address.cityName || address.locality_name || "").trim();
  const parts = [neighborhood, city].filter(Boolean);
  if (parts.length < 2) return parts[0] || "";
  const normalized = parts.map((part) => normalize(part));
  if (normalized[0] === normalized[1]) return parts[0];
  return `${parts[0]} - ${parts[1]}`;
}

function fluxPostalCode(order) {
  const address = order.shippingAddress || {};
  return String(order.postalCode || address.postalCode || address.zipcode || address.cp || "").trim();
}

function fluxProvince(order) {
  const address = order.shippingAddress || {};
  return String(address.province || address.state || address.provincia || "Buenos Aires").trim();
}

async function ensureFluxPostalLocalitiesLoaded() {
  if (fluxPostalLocalities) return fluxPostalLocalities;
  if (!fluxPostalLocalitiesPromise) {
    fluxPostalLocalitiesPromise = fetch("data/flux-localities-ba-caba.json", { cache: "force-cache" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        fluxPostalLocalities = data?.provinces || {};
        return fluxPostalLocalities;
      })
      .catch((error) => {
        console.warn("No se pudo cargar la base de localidades Flux", error);
        fluxPostalLocalities = {};
        return fluxPostalLocalities;
      });
  }
  return fluxPostalLocalitiesPromise;
}

function fluxProvinceKey(value = "") {
  const normalized = normalize(value);
  if (normalized.includes("caba") || normalized.includes("capital federal") || normalized.includes("ciudad autonoma")) return "CABA";
  if (normalized.includes("buenos aires")) return "Buenos Aires";
  return "";
}

function correctedFluxLocality(order) {
  const fallback = fluxLocality(order);
  const provinceKey = fluxProvinceKey(fluxProvince(order));
  const postalCode = fluxPostalCode(order).replace(/\D/g, "");
  const options = provinceKey && postalCode ? (fluxPostalLocalities?.[provinceKey]?.[postalCode] || []) : [];
  if (!options.length) return fallback;
  const normalizedFallback = normalize(fallback);
  const matching = options.find((locality) => {
    const normalizedLocality = normalize(locality);
    return normalizedFallback === normalizedLocality ||
      normalizedFallback.includes(normalizedLocality) ||
      normalizedLocality.includes(normalizedFallback);
  });
  return matching || options[0];
}

function fluxShipmentMissingFields(shipment) {
  return [
    ["calle", shipment.calle],
    ["numero", shipment.numero],
    ["localidad", shipment.localidad],
    ["cp", shipment.cp]
  ].filter(([, value]) => !String(value || "").trim()).map(([field]) => field);
}

function orderLabel(order) {
  return order.internalOrderNumber || order.storeOrderNumber || order.customer || order.id;
}

function fluxAddressPromptValue(order, street, number) {
  const currentAddress = [street, number].filter(Boolean).join(" ");
  const address = order.shippingAddress || {};
  return currentAddress ||
    address.fullAddress ||
    address.direccion ||
    logisticsOrderNotes(order).split(/\n| - /)[0].trim();
}

function splitAddressAndLocality(value) {
  const text = String(value || "").trim();
  const parts = text.split(/[,|;]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return { addressText: text, locality: "" };
  return {
    addressText: parts[0],
    locality: parts.slice(1).join(" ")
  };
}

async function completeMissingFluxAddress(order) {
  let { street, number } = splitStreetAndNumber(order);
  let locality = correctedFluxLocality(order);
  const currentAddress = fluxAddressPromptValue(order, street, number);

  if (!street || !number) {
    const enteredAddress = window.prompt(`Direccion para Flux del pedido ${orderLabel(order)} (calle y altura):`, currentAddress || "");
    if (enteredAddress === null) return false;
    const splitAddress = splitAddressAndLocality(enteredAddress);
    const parsed = splitStreetAndNumber({ shippingAddress: { fullAddress: splitAddress.addressText } });
    street = parsed.street;
    number = parsed.number;
    if (!locality && splitAddress.locality) locality = splitAddress.locality;
  }

  if (!locality) {
    const enteredLocality = window.prompt(`Localidad para Flux del pedido ${orderLabel(order)}:`, locality || "");
    if (enteredLocality === null) return false;
    locality = String(enteredLocality || "").trim();
  }

  if (!street || !number || !locality) {
    window.alert(`El pedido ${orderLabel(order)} sigue sin calle, altura o localidad. No lo envio a Flux.`);
    return false;
  }

  const timestamp = new Date().toISOString();
  updateOperationalOrder(order.id, (current) => touchOrder({
    ...current,
    shippingAddress: {
      ...(current.shippingAddress || {}),
      street,
      number,
      fullAddress: [street, number].filter(Boolean).join(" "),
      city: locality,
      locality,
      postalCode: fluxPostalCode(current),
      province: fluxProvince(current)
    }
  }, timestamp));
  return true;
}

async function ensureFluxShipmentsHaveAddress(selectedOrders) {
  for (const order of selectedOrders) {
    const shipment = fluxShipmentFromOrder(order);
    const missing = fluxShipmentMissingFields(shipment);
    if (!missing.length) continue;
    const completed = await completeMissingFluxAddress(order);
    if (!completed) return false;
  }
  save();
  return true;
}

function formatFluxDate(value) {
  const date = value ? new Date(value) : new Date();
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function fluxIsReverseLogistics(order) {
  const markers = [
    order.recordType,
    order.type,
    order.salesChannel,
    order.source,
    internalOrderNote(order),
    order.changeReason
  ].map((value) => normalize(value));
  return Boolean(order.isExchange || order.exchangeId || markers.some((value) => value.includes("cambio")));
}

function fluxShipmentFromOrder(order) {
  const address = order.shippingAddress || {};
  const { street, number } = splitStreetAndNumber(order);
  const locality = correctedFluxLocality(order);
  const payOnDelivery = normalize(order.paymentMethod).includes("abonar");
  const isStoreOrder = Boolean(order.storeOrderId || order.storeOrderNumber || normalize(order.salesChannel) === "tienda nube");
  const orderTotal = orderItems(order).reduce((sum, item) => sum + Number(item.salePrice || 0) * Number(item.quantity || 1), 0) + Number(order.shippingValue || 0);
  const exchangeCollectValue = moneyValue(order.exchangeDifferenceAmount);
  const collectValue = fluxIsReverseLogistics(order) && payOnDelivery && exchangeCollectValue > 0
    ? exchangeCollectValue
    : payOnDelivery
      ? (isStoreOrder ? orderTotal : (moneyValue(order.fluxCollectAmount) || orderTotal))
      : "";
  const floor = [address.floor, address.apartment].filter(Boolean).join(" ");
  const id = order.internalOrderNumber || order.storeOrderNumber || order.id;
  return {
    localOrderId: order.id,
    cliente: "Incognito Indumentaria",
    tipo_servicio: "24hs",
    cantidad_bultos: "1",
    idenvio: String(id),
    email: order.customerEmail || "",
    destinatario: order.customer || "",
    telefono: order.customerPhone || "",
    calle: street,
    numero: number,
    "número": number,
    floor,
    localidad: locality,
    cp: fluxPostalCode(order),
    provincia: fluxProvince(order),
    delivery_preference: "R",
    shipment_id: String(id),
    fechaVenta: formatFluxDate(order.purchasedAt || order.approvedAt || order.createdAt),
    peso: "",
    valor_declarado: "",
    obs: logisticsOrderNotes(order),
    destination_comments: logisticsOrderNotes(order),
    latitude: "",
    longitude: "",
    latitud: "",
    longitud: "",
    tracking_number: String(id),
    logistica_inversa: fluxIsReverseLogistics(order) ? "CAMBIO" : "",
    total_a_cobrar: collectValue === "" ? "" : String(collectValue)
  };
}

async function sendFluxShipments(selectedOrders, options = {}) {
  const button = options.button || null;
  const originalText = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "Enviando...";
  }

  try {
    if (!selectedOrders.length) {
      window.alert("Selecciona al menos un pedido Flux.");
      return false;
    }

    await ensureFluxPostalLocalitiesLoaded();
    const hasRequiredAddress = await ensureFluxShipmentsHaveAddress(selectedOrders);
    if (!hasRequiredAddress) return false;
    selectedOrders = selectedOrders.map((order) => findOperationalOrder(order.id) || order);
    const shipments = selectedOrders.map(fluxShipmentFromOrder);
    const stillMissing = shipments
      .map((shipment, index) => ({ shipment, order: selectedOrders[index], missing: fluxShipmentMissingFields(shipment) }))
      .filter((item) => item.missing.length);
    if (stillMissing.length) {
      window.alert(stillMissing.map((item) => `${orderLabel(item.order)}: falta ${item.missing.join(", ")}`).join("\n"));
      return false;
    }
    const response = await fetch("api/flux/shipments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shipments }),
      signal: AbortSignal.timeout(120000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      const details = fluxErrorDetails(data, response.status);
      window.alert(details);
      console.error("[Flux]", data);
      return false;
    }

    const now = new Date().toISOString();
    const results = Array.isArray(data.results) ? data.results : [];
    orders = orders.map((order) => {
      const shipment = shipments.find((item) => item.localOrderId === order.id);
      if (!shipment) return order;
      const index = shipments.indexOf(shipment);
      const result = results[index] || {};
      return {
        ...order,
        fluxSentAt: now,
        fluxShipmentId: fluxShipmentIdFromValue(result) || order.fluxShipmentId || "",
        fluxShipmentCode: fluxShipmentIdFromValue(result) || result.mensaje || order.fluxShipmentCode || "",
        fluxLastResponse: result
      };
    });
    save();
    await flushRemoteSaveNow();
    render();
    window.alert(`Pedidos enviados a Flux: ${selectedOrders.length}`);
    return true;
  } catch (error) {
    console.error("[Flux]", error);
    const message = error.name === "TimeoutError"
      ? "Flux tardo demasiado en responder. No cierro el modal para que puedas reintentar en un momento."
      : `No pude enviar los pedidos a Flux: ${error.message || error}`;
    window.alert(message);
    return false;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

function fluxErrorDetails(data = {}, status = "") {
  const lines = [];
  if (status) lines.push(`HTTP ${status}`);
  if (data.endpoint) lines.push(`Endpoint: ${data.endpoint}`);
  if (data.error) lines.push(String(data.error));
  const resultMessages = Array.isArray(data.results)
    ? data.results.map((item) => [
        item?.httpStatus ? `HTTP ${item.httpStatus}` : "",
        item?.mensaje || item?.message || item?.error || item?.rawText || ""
      ].filter(Boolean).join(" - ")).filter(Boolean)
    : [];
  lines.push(...resultMessages);
  if (data.raw?.message || data.raw?.mensaje) lines.push(data.raw.message || data.raw.mensaje);
  if (!lines.length) lines.push("No se pudieron enviar los pedidos a Flux.");
  return [...new Set(lines)].join("\n");
}

function groupPendingProducts(rows) {
  const products = new Map();
  rows.forEach(({ item }) => {
    const productKey = pendingProductKey(item);
    const productLabel = pendingProductLabel(item);
    const color = canonicalPendingText(item.color, "Sin color");
    const size = canonicalPendingText(item.size, "Sin talle");
    const quantity = Number(item.quantity || 1);

    if (!products.has(productKey)) {
      products.set(productKey, { label: productLabel, colors: new Map() });
    }
    const product = products.get(productKey);
    if (!product.colors.has(color)) {
      product.colors.set(color, new Map());
    }
    const sizes = product.colors.get(color);
    sizes.set(size, (sizes.get(size) || 0) + quantity);
  });

  return [...products.values()].map((product) => ({
    label: product.label,
    colors: [...product.colors.entries()].map(([color, sizes]) => ({
      color,
      sizes: [...sizes.entries()].map(([size, quantity]) => ({ size, quantity }))
    }))
  }));
}

function expandPendingProductItem(item = {}) {
  const base = {
    ...item,
    sku: String(item.sku || "").trim(),
    color: String(item.color || "").trim(),
    size: String(item.size || "").trim(),
    quantity: Number(item.quantity || 1)
  };
  const normalizedSku = canonicalSkuKey(base.sku);

  if (normalizedSku === "con-tech-nk") {
    return [
      { ...base, sku: "Camp-Tech-Nk" },
      { ...base, sku: "Pan-Tech-Nk" }
    ];
  }

  if (normalizedSku === "con-sst-ad") {
    return [
      { ...base, sku: "Camp-Sst-Ad" },
      { ...base, sku: "Pan-Sst-Ad" }
    ];
  }

  if (normalizedSku === "pan-bag-3d") {
    return [{ ...base, sku: "Pan-Bag-Dtf" }];
  }

  if (normalizedSku.startsWith("pan-") && normalizedSku.endsWith("-dtf")) {
    return [{ ...base, sku: "Pan-Bag-Dtf" }];
  }

  if (normalizedSku.startsWith("buz-") && normalizedSku.endsWith("-dtf")) {
    return [{ ...base, sku: "Buz-Cang-Dtf" }];
  }

  if (normalizedSku === "con-camp-3d") {
    return [
      { ...base, sku: "Camp-Clas-3D" },
      { ...base, sku: "Pan-Bag-Dtf" }
    ];
  }

  if (normalizedSku.startsWith("con-") && normalizedSku.endsWith("-dtf")) {
    return [
      { ...base, sku: "Buz-Cang-Dtf" },
      { ...base, sku: "Pan-Bag-Dtf" }
    ];
  }

  return [base];
}

function pendingProductKey(item) {
  const sku = String(item.sku || "").trim();
  const normalizedSku = canonicalSkuKey(sku);
  if (normalizedSku.startsWith("rem-") && normalizedSku.endsWith("-dtf")) return "REM-*-DTF";
  if (normalizedSku.startsWith("over-") && normalizedSku.endsWith("-dtf")) return "OVER-*-DTF";
  return normalizedSku || canonicalSkuKey(item.name) || "sin-sku";
}

function pendingProductLabel(item) {
  const key = pendingProductKey(item);
  if (key === "REM-*-DTF") return "Remeras DTF";
  if (key === "OVER-*-DTF") return "Remeras Oversize DTF";
  return displaySkuLabel(item.sku || item.name || key || "Sin SKU");
}

function canonicalSkuKey(value) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function displaySkuLabel(value) {
  const parts = canonicalSkuKey(value).split("-").filter(Boolean);
  if (!parts.length) return "Sin SKU";
  return parts.map((part) => part.toUpperCase()).join("-");
}

function canonicalPendingText(value, fallback) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/\s+/)
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : "")
    .join(" ");
}

function showView(view) {
  activeView = view;
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active", section.id === `view-${view}`));
  render();
}

function needsPaymentReview(order) {
  return normalize(order.paymentMethod) === "transferencia" || normalize(order.paymentStatus) === "pendiente";
}

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function mathExpressionToNumber(value) {
  let expression = String(value ?? "").trim();
  if (!expression) return 0;
  expression = expression
    .toLowerCase()
    .replace(/\$/g, "")
    .replace(/\s+/g, "")
    .replace(/más|mas/g, "+")
    .replace(/menos/g, "-")
    .replace(/por|x/g, "*")
    .replace(/dividido|÷/g, "/")
    .replace(/,/g, ".")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "");
  if (!/^[\d+\-*/().]+$/.test(expression)) return Number.NaN;
  try {
    const result = Function(`"use strict"; return (${expression});`)();
    return Number.isFinite(result) ? result : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

function moneyValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const result = mathExpressionToNumber(value);
  return Number.isFinite(result) ? result : 0;
}

function moneyDisplayValue(value) {
  const result = mathExpressionToNumber(value);
  if (!Number.isFinite(result)) return "";
  return Number.isInteger(result) ? String(result) : String(Math.round(result * 100) / 100);
}

function isMoneyExpressionInput(input) {
  return input?.matches?.([
    'input[name="purchasePrice"]',
    'input[name="salePrice"]',
    'input[name="shippingValue"]',
    'input[name="fluxCollectAmount"]',
    'input[name="differenceAmount"]',
    'input[name="wholesaleEntrySalePrice"]',
    'input[name="wholesaleEntryPurchasePrice"]',
    'input[name="wholesaleSalePrice"]',
    'input[name="wholesalePurchasePrice"]'
  ].join(","));
}

function evaluateMoneyExpressionInput(input) {
  if (!isMoneyExpressionInput(input)) return;
  const raw = String(input.value || "").trim();
  if (!raw) return;
  const value = moneyDisplayValue(raw);
  if (value === "") {
    input.classList.add("input-error");
    return;
  }
  input.classList.remove("input-error");
  input.value = value;
}

function attachMoneyExpressionInputs(root = document) {
  root.querySelectorAll?.("input").forEach((input) => {
    if (!isMoneyExpressionInput(input) || input.dataset.moneyExpressionReady) return;
    input.dataset.moneyExpressionReady = "1";
    input.addEventListener("blur", () => evaluateMoneyExpressionInput(input));
  });
}

function evaluateMoneyExpressionInputs(root = document) {
  root.querySelectorAll?.("input").forEach(evaluateMoneyExpressionInput);
}

function hasMoneyExpressionErrors(root = document) {
  return Boolean(root.querySelector?.("input.input-error"));
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0
  });
}

function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatCopyDate(value) {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return safeDate.toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isDataImage(value) {
  return typeof value === "string" && value.startsWith("data:image/");
}

async function compactImageDataUrl(dataUrl, options = {}) {
  if (!isDataImage(dataUrl) || dataUrl.length < 180000) return dataUrl || "";
  const maxSide = options.maxSide || 520;
  const quality = options.quality || 0.68;
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(image.width || 1, image.height || 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round((image.width || 1) * scale));
      canvas.height = Math.max(1, Math.round((image.height || 1) * scale));
      const context = canvas.getContext("2d");
      if (!context) return resolve(dataUrl);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

async function compactImageFile(file) {
  if (!file || !file.type?.startsWith("image/")) return "";
  const dataUrl = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
  return compactImageDataUrl(dataUrl);
}

// ── Event listeners ───────────────────────────────────────────────────────────
syncStore.addEventListener("click", importStoreOrders);
if (singleTnImportForm) {
  singleTnImportForm.addEventListener("submit", importSingleStoreOrder);
}
if (singleTnExchangeButton) {
  singleTnExchangeButton.addEventListener("click", importSingleStoreOrderAsExchange);
}
openManual.addEventListener("click", () => {
  if (!remoteStateReady) {
    window.alert("La app todavia esta sincronizando con la nube. Espera unos segundos antes de cargar un pedido manual.");
    return;
  }
  resetManualDialog();
  ensureStockItems();
  manualDialog.showModal();
});
if (openExchange) {
  openExchange.addEventListener("click", () => {
    resetExchangeDialog();
    exchangeDialog.showModal();
  });
}
closeManual.addEventListener("click", () => {
  manualDialog.close();
  resetManualDialog();
});
cancelManual.addEventListener("click", () => {
  manualDialog.close();
  resetManualDialog();
});
if (closeExchange) closeExchange.addEventListener("click", () => {
  exchangeDialog.close();
  resetExchangeDialog();
});
if (cancelExchange) cancelExchange.addEventListener("click", () => {
  exchangeDialog.close();
  resetExchangeDialog();
});
if (exchangeForm) {
  exchangeForm.elements.paymentResolution.addEventListener("change", () => {
    if (exchangeForm.elements.paymentResolution.value === "paga-al-recibir") {
      exchangeForm.elements.shippingCompany.value = "Flux";
    }
    if (exchangeForm.elements.paymentResolution.value === "sin-cargo") {
      exchangeForm.elements.differenceAmount.value = 0;
    }
    updateExchangeFluxAddressVisibility();
  });
  exchangeForm.elements.shippingCompany?.addEventListener("change", updateExchangeFluxAddressVisibility);
  exchangeForm.elements.exchangeEntrySku?.addEventListener("change", async () => {
    const item = await findStockItemBySku(exchangeForm.elements.exchangeEntrySku.value);
    if (!item) return;
    if (item.modelo && exchangeForm.elements.exchangeEntryProduct && !exchangeForm.elements.exchangeEntryProduct.value) {
      exchangeForm.elements.exchangeEntryProduct.value = item.modelo;
    }
    if (item.talle && exchangeForm.elements.exchangeEntrySize) exchangeForm.elements.exchangeEntrySize.value = item.talle;
    if (item.color && exchangeForm.elements.exchangeEntryColor) exchangeForm.elements.exchangeEntryColor.value = item.color;
  });
  exchangeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const created = createExchange(new FormData(exchangeForm));
    if (!created) return;
    resetExchangeDialog();
    exchangeDialog.close();
  });
}
skuFilterSelect.addEventListener("change", () => {
  skuFilter = skuFilterSelect.value;
  render();
});
if (pendingSearchInput) {
  pendingSearchInput.addEventListener("input", () => {
    pendingSearch = pendingSearchInput.value;
    render();
  });
}
if (processSearchInput) {
  processSearchInput.addEventListener("input", () => {
    processSearch = processSearchInput.value;
    render();
  });
}
if (dtfFilter) {
  dtfFilter.addEventListener("click", () => {
    dtfActionDialog.showModal();
  });
}
if (pickedFilter) {
  pickedFilter.addEventListener("click", () => {
    pickedFilterActive = !pickedFilterActive;
    render();
  });
}
if (closeDtfActionDialog) {
  closeDtfActionDialog.addEventListener("click", () => dtfActionDialog.close());
}
if (downloadDtfPending) {
  downloadDtfPending.addEventListener("click", () => {
    dtfActionDialog.close();
    downloadDtfHtml();
  });
}
if (applyDtfFilter) {
  applyDtfFilter.addEventListener("click", () => {
    dtfFilterActive = !dtfFilterActive;
    dtfActionDialog.close();
    render();
  });
}
if (pendingProducts) {
  pendingProducts.addEventListener("click", downloadPendingProductsHtml);
}
if (andreaniLabels) {
  andreaniLabels.addEventListener("click", openAndreaniLabelsDialog);
}
if (fluxShipments) {
  fluxShipments.addEventListener("click", openFluxShipmentsDialog);
}
if (closeAndreaniDialog) {
  closeAndreaniDialog.addEventListener("click", () => andreaniDialog.close());
}
if (cancelAndreaniLabels) {
  cancelAndreaniLabels.addEventListener("click", () => andreaniDialog.close());
}
if (andreaniSelectAll) {
  andreaniSelectAll.addEventListener("change", () => {
    andreaniSelectAll.indeterminate = false;
    andreaniSelectList
      .querySelectorAll('input[type="checkbox"]')
      .forEach((box) => {
        box.checked = andreaniSelectAll.checked;
      });
  });
}
if (andreaniSelectList) {
  andreaniSelectList.addEventListener("change", (event) => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    syncAndreaniSelectAllState();
  });
}
if (downloadSelectedAndreani) {
  downloadSelectedAndreani.addEventListener("click", async () => {
    const selectedIds = [...andreaniSelectList.querySelectorAll('input[type="checkbox"]:checked')]
      .map((box) => box.value);
    const selectedOrders = andreaniCandidateOrders().filter((order) => selectedIds.includes(order.id));
    await downloadAndreaniLabels(selectedOrders);
    if (selectedOrders.length) andreaniDialog.close();
  });
}
if (closeFluxDialog) {
  closeFluxDialog.addEventListener("click", () => fluxDialog.close());
}
if (cancelFluxShipments) {
  cancelFluxShipments.addEventListener("click", () => fluxDialog.close());
}
if (fluxSelectAll) {
  fluxSelectAll.addEventListener("change", () => {
    fluxSelectAll.indeterminate = false;
    fluxSelectList
      .querySelectorAll('input[type="checkbox"]')
      .forEach((box) => {
        box.checked = fluxSelectAll.checked;
      });
  });
}
if (fluxSelectList) {
  fluxSelectList.addEventListener("change", (event) => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    syncFluxSelectAllState();
  });
}
if (sendSelectedFlux) {
  sendSelectedFlux.addEventListener("click", async () => {
    const selectedIds = [...fluxSelectList.querySelectorAll('input[type="checkbox"]:checked')]
      .map((box) => box.value);
    const selectedOrders = fluxCandidateOrders().filter((order) => selectedIds.includes(order.id));
    const sent = await sendFluxShipments(selectedOrders, { button: sendSelectedFlux });
    if (sent) fluxDialog.close();
  });
}
if (closeBulkLabelDialog) {
  closeBulkLabelDialog.addEventListener("click", () => bulkLabelDialog.close());
}
if (cancelBulkLabel) {
  cancelBulkLabel.addEventListener("click", () => bulkLabelDialog.close());
}
if (bulkLabelSelectAll) {
  bulkLabelSelectAll.addEventListener("change", () => {
    bulkLabelSelectAll.indeterminate = false;
    bulkLabelList
      .querySelectorAll('input[type="checkbox"]')
      .forEach((box) => {
        box.checked = bulkLabelSelectAll.checked;
      });
  });
}
if (bulkLabelList) {
  bulkLabelList.addEventListener("change", (event) => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    syncBulkLabelSelectAllState();
  });
}
if (confirmBulkLabel) {
  confirmBulkLabel.addEventListener("click", confirmBulkLabelMove);
}
if (closeMpReviewDialog) {
  closeMpReviewDialog.addEventListener("click", () => mpReviewDialog.close());
}
if (cancelMpReview) {
  cancelMpReview.addEventListener("click", () => mpReviewDialog.close());
}
if (copyMpReview) {
  copyMpReview.addEventListener("click", copyMpReviewAndMark);
}
clearDispatched.addEventListener("click", clearDispatchedOrders);
if (fluxSettlementForm) {
  fluxSettlementForm.addEventListener("submit", applyFluxSettlement);
}
if (clearFluxSettlement) {
  clearFluxSettlement.addEventListener("click", () => {
    fluxSettlementInput.value = "";
  });
}
downloadBackup.addEventListener("click", (event) => {
  event.preventDefault();
  downloadBackupRows(todaysBackupRows(), `backup-pedidos-${today()}.xls`);
});
downloadBackupHistory.addEventListener("click", (event) => {
  event.preventDefault();
  downloadBackupRows(historicBackupRows(), "backup-historico-pedidos.xls");
});
if (downloadFullStateBackup) {
  downloadFullStateBackup.addEventListener("click", downloadFullAppBackup);
}
if (uploadSharePointHistory) {
  uploadSharePointHistory.addEventListener("click", async () => {
    uploadSharePointHistory.disabled = true;
    const originalText = uploadSharePointHistory.textContent;
    uploadSharePointHistory.textContent = "Actualizando...";
    try {
      await refreshRemoteState();
      const response = await fetch("api/sharepoint/backup-history", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || "No se pudo actualizar SharePoint.");
      }
      window.alert(`Historico actualizado en SharePoint.\nExcel: ${data.filename || "backup-historico-pedidos.xls"}\nBackup completo: ${data.fullBackupFilename || "backup-completo-incognito-ventas.json"}\nFilas: ${data.rows || 0}`);
    } catch (error) {
      window.alert(`No se pudo actualizar SharePoint: ${error.message}`);
    } finally {
      uploadSharePointHistory.disabled = false;
      uploadSharePointHistory.textContent = originalText;
    }
  });
}
document.querySelectorAll("[data-backup-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    backupMode = button.dataset.backupMode;
    renderBackup();
  });
});
mercadoPagoAccount.addEventListener("change", () => updateAccountSetting("mercadoPago", mercadoPagoAccount.value));
transferAccount.addEventListener("change", () => updateAccountSetting("transfer", transferAccount.value));
if (addWholesaleItem) addWholesaleItem.addEventListener("click", addWholesaleEntryAsRow);
if (addWholesaleCurve) addWholesaleCurve.addEventListener("click", addWholesaleCurveRows);
if (importWholesaleLink) importWholesaleLink.addEventListener("click", importWholesaleOrderLink);
if (applyWholesaleShipping) applyWholesaleShipping.addEventListener("click", applyShippingValueToWholesaleSales);
if (addRetailItem) addRetailItem.addEventListener("click", addRetailEntryAsRow);
if (wholesaleEntryImage) wholesaleEntryImage.addEventListener("paste", handleWholesaleImagePaste);
if (retailImage) {
  retailImage.addEventListener("click", () => retailImage.focus());
  retailImage.addEventListener("paste", handleRetailImagePaste);
}
if (addExchangeItem) addExchangeItem.addEventListener("click", addExchangeEntryAsRow);
if (exchangeEntryImage) {
  exchangeEntryImage.addEventListener("click", () => {
    exchangeEntryImage.focus();
    exchangeEntryImageFile?.click();
  });
  exchangeEntryImage.addEventListener("paste", handleExchangeImagePaste);
}
if (exchangeEntryImageFile) {
  exchangeEntryImageFile.addEventListener("change", () => {
    readExchangeImageFile(exchangeEntryImageFile.files?.[0]);
    exchangeEntryImageFile.value = "";
  });
}
manualForm.addEventListener("paste", handleWholesaleImagePaste);
manualForm.addEventListener("paste", handleRetailImagePaste);
if (exchangeForm) exchangeForm.addEventListener("paste", handleExchangeImagePaste);
if (printedGarmentImage) {
  printedGarmentImage.addEventListener("click", () => printedGarmentImage.focus());
  printedGarmentImage.addEventListener("paste", handlePrintedGarmentImagePaste);
}
printedGarmentForm?.addEventListener("paste", handlePrintedGarmentImagePaste);
printedGarmentForm?.addEventListener("submit", addPrintedGarment);
cancelPrintedGarmentEdit?.addEventListener("click", resetPrintedGarmentForm);
manualForm.addEventListener("keydown", stopManualEnterSubmit);
manualForm.elements.sku?.addEventListener("change", () => {
  fillRetailFromSku(manualForm.elements.sku.value);
});
manualForm.elements.wholesaleEntrySku?.addEventListener("change", () => {
  fillWholesaleEntryFromSku(manualForm.elements.wholesaleEntrySku.value);
});
manualForm.elements.paymentMethod?.addEventListener("change", updateManualFluxCollectVisibility);
manualForm.elements.shippingCompany?.addEventListener("change", updateManualFluxAddressVisibility);
orderTypeButtons.forEach((button) => {
  button.addEventListener("click", () => setManualOrderType(button.dataset.orderType));
});
closeDetail.addEventListener("click", () => orderDetailDialog.close());
if (closeImagePreview) closeImagePreview.addEventListener("click", closeImagePreviewDialog);
if (imagePreviewDialog) {
  imagePreviewDialog.addEventListener("click", (event) => {
    if (event.target === imagePreviewDialog) closeImagePreviewDialog();
  });
}
if (orderDetailActions) {
  orderDetailActions.addEventListener("click", async (event) => {
    const pickAllButton = event.target.closest("[data-detail-pick-all]");
    if (pickAllButton) {
      await markAllDetailItemsPicked(pickAllButton.dataset.detailPickAll);
      return;
    }

    const button = event.target.closest("[data-detail-move]");
    if (!button) return;
    const moved = await moveOrder(button.dataset.detailMove, 1);
    if (moved) orderDetailDialog.close();
  });
}
orderDetailBody.addEventListener("click", async (event) => {
  const printedGarmentButton = event.target.closest("[data-use-printed-garment]");
  if (printedGarmentButton) {
    await usePrintedGarmentForItem(
      printedGarmentButton.dataset.usePrintedGarment,
      printedGarmentButton.dataset.itemIndex,
      printedGarmentButton.dataset.printedGarmentId
    );
    return;
  }

  const printOwnerButton = event.target.closest("[data-detail-print-owner]");
  if (printOwnerButton) {
    await setDetailItemPrintOwner(
      printOwnerButton.dataset.detailPrintOwner,
      printOwnerButton.dataset.itemIndex,
      printOwnerButton.dataset.printOwner
    );
    return;
  }

  const statusButton = event.target.closest("[data-detail-item-status]");
  if (statusButton) {
    await setDetailItemStatus(statusButton.dataset.detailItemStatus, statusButton.dataset.itemIndex, statusButton.dataset.itemStatus);
    return;
  }

  const button = event.target.closest("[data-detail-pick]");
  if (!button) return;
  toggleDetailItemPicked(button.dataset.detailPick, button.dataset.itemIndex);
});
orderDetailBody.addEventListener("dblclick", (event) => {
  const image = event.target.closest(".detail-item .thumb img");
  if (!image) return;
  openImagePreview(image.currentSrc || image.src);
});
attachMoneyExpressionInputs(document);
skuPriceForm.addEventListener("submit", (event) => {
  event.preventDefault();
  evaluateMoneyExpressionInputs(skuPriceForm);
  if (hasMoneyExpressionErrors(skuPriceForm)) return;
  saveSkuPrice(new FormData(skuPriceForm));
  skuPriceForm.reset();
});
skuPrefixPriceForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  evaluateMoneyExpressionInputs(skuPrefixPriceForm);
  if (hasMoneyExpressionErrors(skuPrefixPriceForm)) return;
  saveSkuPrefixPrice(new FormData(skuPrefixPriceForm));
  skuPrefixPriceForm.reset();
});
skuPrefixFilterInput?.addEventListener("input", () => {
  skuPrefixFilterValue = skuPrefixKey(skuPrefixFilterInput.value);
  renderSkuPrices();
});
clearSkuPrefixFilter?.addEventListener("click", () => {
  skuPrefixFilterValue = "";
  if (skuPrefixFilterInput) skuPrefixFilterInput.value = "";
  renderSkuPrices();
});
skuLoadedSearchInput?.addEventListener("input", () => {
  skuLoadedSearchValue = normalize(skuLoadedSearchInput.value);
  renderSkuPrices();
});
whatsappTemplateForm?.addEventListener("submit", sendStandaloneWhatsappTemplate);

async function notifyStampModificationAfterEdit(order) {
  if (!order?.stampsSyncedAt || !["armado", "rotulado", "despachado"].includes(order.status)) return;
  let result = null;
  try {
    result = await syncOrderStamps(order, "modificacion", { force: true });
    result.evento = "modificacion";
  } catch (error) {
    result = { ok: false, evento: "modificacion", error: error.message };
  }
  const timestamp = new Date().toISOString();
  let updatedOrder = null;
  updateOperationalOrder(order.id, (current) => {
    if (current.id !== order.id) return current;
    updatedOrder = touchOrder(applyStampSyncState(current, result, timestamp), timestamp);
    return updatedOrder;
  });
  save();
  await saveOperationalOrderNow(updatedOrder).catch((error) => {
    console.warn("No se pudo guardar el estado de estampas despues de editar", error);
  });
  if (!result.ok) {
    window.alert(`El pedido se guardo, pero no pude avisar la modificacion a Stock Estampas: ${result.error || "error desconocido"}`);
  }
}

async function submitManualDialog() {
  if (manualSubmitInProgress) return;
  manualSubmitInProgress = true;
  if (manualSubmit) manualSubmit.disabled = true;
  try {
    await prepareManualWrite();
    const created = createManualOrder(new FormData(manualForm));
    if (!created) return;
    const saved = await flushRemoteSaveNow();
    if (!saved) throw new Error("no se pudo confirmar el guardado en la nube");
    if (created.stampModificationOrder) {
      await notifyStampModificationAfterEdit(created.stampModificationOrder);
    }
    resetManualDialog();
    manualDialog.close();
  } catch (error) {
    console.error(error);
    alert(`No pude guardar el pedido: ${error?.message || error}`);
  } finally {
    manualSubmitInProgress = false;
    if (manualSubmit) manualSubmit.disabled = false;
  }
}

manualForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitManualDialog();
});
if (manualSubmit) manualSubmit.addEventListener("click", submitManualDialog);
window.addEventListener("pagehide", flushRemoteStateOnClose);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushRemoteStateOnClose();
  if (document.visibilityState === "visible") refreshRemoteState();
});
window.setInterval(refreshRemoteState, 5000);

async function initializeApp() {
  try {
    await migrateLocalSkuPricesIfRequested();
    await loadRemoteState();
    if (await resetSalesStateIfRequested()) return;
    render();
  } finally {
    document.body.classList.remove("app-loading");
  }
}

initializeApp();
