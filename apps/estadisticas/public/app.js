const colors = ["#6c3fc5", "#1aa6a6", "#fb7f62", "#4b83d1", "#13a36f", "#f6b73c", "#9f7aea", "#ef6f9a"];
let stats = null;
const activeVariants = { sales: "all", products: "all", billing: "all", carts: "all", cartProducts: "all", cartAmounts: "all" };
const activePayments = { sales: "platform", products: "platform", billing: "platform", carts: "platform", cartProducts: "platform", cartAmounts: "platform" };
let productQuery = "";
let productPage = 1;
let productPageSize = 5;
let showProductsWithoutSales = false;
const expandedProducts = new Set();
let selectedComboProduct = "";
let currentView = "ventas";
let cartProductQuery = "";
let cartProductPage = 1;
let cartProductPageSize = 5;
const comboPages = { sales: 1, products: 1, billing: 1, carts: 1, cartProducts: 1, cartAmounts: 1 };
let currentPeriod = "7d";
let compareMode = false;
let comparePeriod1 = "7d";
let comparePeriod2 = "";
let periodTarget = 1;
let compareStats = { one: null, two: null };
const activeProvinceViews = { sales: "pie", products: "pie", billing: "pie", carts: "pie", cartProducts: "pie", cartAmounts: "pie" };
const provinceDetailPages = { sales: 1, products: 1, billing: 1, carts: 1, cartProducts: 1, cartAmounts: 1 };
const expandedCategories = new Set();
let argentinaGeojson = null;
let isLoadingStats = false;

const metricConfigs = {
  sales: {
    label: "Ventas",
    unit: "ventas",
    dailyTitle: "Ventas por dia",
    dailyCaption: "Ventas pagadas del periodo.",
    categoryText: "Ventas en el periodo elegido, por categoria:",
    shippingText: "Ventas en el periodo elegido, por forma de envio:",
    shippingPaymentText: "Ventas en el periodo elegido, por pago del envio:",
    genderText: "Ventas en el periodo elegido, por genero de los clientes:",
    weekdayText: "Ventas en el periodo elegido, por dia de la semana:",
    summaryLabels: ["ventas", "ventas por dia"]
  },
  products: {
    label: "Productos vendidos",
    unit: "productos",
    dailyTitle: "Productos vendidos por dia",
    dailyCaption: "Productos vendidos del periodo.",
    categoryText: "Productos vendidos en el periodo elegido, por categoria:",
    shippingText: "Productos vendidos en el periodo elegido, por forma de envio:",
    shippingPaymentText: "Productos vendidos en el periodo elegido, por pago del envio:",
    genderText: "Productos vendidos en el periodo elegido, por genero de los clientes:",
    weekdayText: "Productos vendidos en el periodo elegido, por dia de la semana:",
    summaryLabels: ["productos vendidos", "productos por dia"]
  },
  billing: {
    label: "Facturacion",
    unit: "facturacion",
    dailyTitle: "Facturacion por dia",
    dailyCaption: "Facturacion del periodo.",
    categoryText: "Facturacion en el periodo elegido, por categoria:",
    shippingText: "Gastos de envios en el periodo elegido, por forma de envio:",
    shippingPaymentText: "Gastos de envios en el periodo elegido, por pago del envio:",
    genderText: "Facturacion en el periodo elegido, por genero de los clientes:",
    weekdayText: "Facturacion en el periodo elegido, por dia de la semana:",
    summaryLabels: ["facturacion", "facturacion por dia"]
  },
  carts: {
    label: "Carritos",
    unit: "carritos",
    dailyTitle: "Carritos por dia",
    dailyCaption: "Carritos abandonados del periodo.",
    categoryText: "Carritos abandonados, por categoria:",
    shippingText: "Carritos en el periodo elegido, por forma de envio:",
    shippingPaymentText: "Carritos en el periodo elegido, por pago del envio:",
    genderText: "Carritos abandonados, por genero de los clientes:",
    weekdayText: "Carritos abandonados, por dia de la semana:",
    summaryLabels: ["carritos", "carritos por dia"]
  },
  cartProducts: {
    label: "Productos",
    unit: "productos",
    dailyTitle: "Productos de carritos por dia",
    dailyCaption: "Productos en carritos abandonados del periodo.",
    categoryText: "Productos de carritos abandonados, por categoria:",
    shippingText: "Productos de carritos en el periodo elegido, por forma de envio:",
    shippingPaymentText: "Productos de carritos en el periodo elegido, por pago del envio:",
    genderText: "Productos de carritos abandonados, por genero de los clientes:",
    weekdayText: "Productos de carritos abandonados, por dia de la semana:",
    summaryLabels: ["productos", "productos por dia"]
  },
  cartAmounts: {
    label: "Importes",
    unit: "importes",
    dailyTitle: "Importes por dia",
    dailyCaption: "Importes de carritos abandonados del periodo.",
    categoryText: "Importes de carritos abandonados, por categoria:",
    shippingText: "Gastos de envios en carritos, por forma de envio:",
    shippingPaymentText: "Gastos de envios en carritos, por pago del envio:",
    genderText: "Importes de carritos abandonados, por genero de los clientes:",
    weekdayText: "Importes de carritos abandonados, por dia de la semana:",
    summaryLabels: ["importe total", "importe por dia"]
  }
};

const chartDialogTitles = {
  sales: "Ventas por dia",
  payments: "Pago y financiacion",
  variants: "Variantes",
  provinces: "Provincias",
  age: "Edad",
  hour: "Hora del dia",
  gender: "Genero",
  weekdays: "Dias de la semana"
};

const periodLabels = {
  today: "Hoy",
  yesterday: "Ayer",
  "7d": "Última semana",
  "14d": "Últimas 2 semanas",
  "30d": "Último mes",
  "90d": "Último trimestre",
  "365d": "Último año",
  "year:2026": "2026",
  "year:2025": "2025",
  "month:2026-04": "Abr 26",
  "month:2026-05": "May 26",
  "month:2026-06": "Jun 26"
};

const money = (value) => Number(value || 0).toLocaleString("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0
});

const number = (value) => Number(value || 0).toLocaleString("es-AR", {
  maximumFractionDigits: 1
});

function percent(value, total) {
  return total ? `${number((Number(value || 0) / total) * 100)}%` : "0%";
}

function openComboHelp() {
  const dialog = document.querySelector("#chartDialog");
  document.querySelector("#chartDialogTitle").textContent = "Combinacion de productos";
  document.querySelector("#chartDialogBody").innerHTML = `
    <div class="help-modal">
      <h3>Como se calcula el porcentaje de coincidencia?</h3>
      <p>El porcentaje de coincidencia corresponde a la fraccion de las ventas del primer producto que incluyeron tambien al segundo producto.</p>
      <p><strong>Ejemplo:</strong> si el Producto A se vendio 10 veces, y en 3 de esas ventas se vendio tambien el Producto B, el porcentaje de coincidencia es del 30%.</p>
      <p>Las combinaciones se muestran cuando hay 2 o mas coincidencias.</p>
    </div>
  `;
  if (dialog?.showModal) dialog.showModal();
}

async function loadStats(forceRefresh = false) {
  if (isLoadingStats) return;
  setLoading(true, forceRefresh ? "Actualizando datos..." : "Cargando datos...");
  comparePeriod1 = compareMode ? comparePeriod1 : currentPeriod;
  document.querySelector("#periodLabel").textContent = compareMode ? periodLabel(comparePeriod1) : periodLabel(currentPeriod);
  updateExportLinks();
  try {
    await loadArgentinaGeojson();
    if (compareMode) {
      compareStats.one = await fetchStatsForPeriod(comparePeriod1, forceRefresh);
      compareStats.two = comparePeriod2 ? await fetchStatsForPeriod(comparePeriod2, forceRefresh) : null;
      stats = compareStats.one;
    } else {
      stats = await fetchStatsForPeriod(currentPeriod, forceRefresh);
      compareStats = { one: null, two: null };
    }
    render();
  } finally {
    setLoading(false);
  }
}

async function fetchStatsForPeriod(period, forceRefresh = false) {
  const refreshParam = forceRefresh ? "&refresh=1" : "";
  const response = await fetch(`api/stats?period=${encodeURIComponent(period)}${refreshParam}`, { cache: "no-store" });
  const data = await response.json();
  return data.fallback || data;
}

async function loadArgentinaGeojson() {
  if (argentinaGeojson) return argentinaGeojson;
  const response = await fetch("data/argentina-provinces.geojson", { cache: "force-cache" });
  argentinaGeojson = await response.json();
  return argentinaGeojson;
}

function render() {
  if (!stats) return;
  document.querySelector("#sourceBadge").textContent = stats.source === "tiendanube" ? "Datos reales" : "Modo demo";
  document.body.classList.toggle("compare-mode", compareMode);
  document.querySelector(".compare")?.classList.toggle("active", compareMode);
  document.querySelector("#openComparePeriodModal").hidden = !compareMode;
  document.querySelector("#periodLabel").textContent = compareMode ? `Periodo 1` : periodLabel(currentPeriod);
  document.querySelector("#periodRangeLabel").textContent = compareMode
    ? `${periodLabel(comparePeriod1).toLowerCase()}${compareStats.one?.range ? ` - ${formatDateLabel(compareStats.one.range.from)} a ${formatDateLabel(compareStats.one.range.to)}` : ""}`
    : `${formatDateLabel(stats.range.from)} a ${formatDateLabel(stats.range.to)}`;
  if (compareMode) {
    document.querySelector("#comparePeriodLabel").textContent = comparePeriod2 ? "Periodo 2" : "(elegir)";
    document.querySelector("#comparePeriodRangeLabel").textContent = comparePeriod2 && compareStats.two?.range
      ? `${periodLabel(comparePeriod2).toLowerCase()} - ${formatDateLabel(compareStats.two.range.from)} a ${formatDateLabel(compareStats.two.range.to)}`
      : "";
    renderComparison();
    return;
  }
  renderMetricDashboards();
  renderBars();
  renderSummary();
  renderPaymentPanel("sales");
  renderProvinceChart("sales");
  renderVariants("sales");
  renderCategoryTree("sales");
  renderLineChart("ageChart", stats.ages.map((item) => ({ label: item.label, count: item.count })), "sales");
  renderLineChart("hourChart", stats.hours.map((item) => ({ label: String(item.hour).padStart(2, "0"), count: item.count })), "sales");
  renderShippingPanel("sales");
  renderDonut("genderDonut", "genderLegend", stats.gender || [], "sales");
  renderCombosPanel("sales");
  renderWeekdaysChart("sales");
  renderProducts();
  renderBilling();
  renderCarts();
}

function setLoading(active, message = "Cargando datos...") {
  isLoadingStats = active;
  const overlay = document.querySelector("#loadingOverlay");
  const text = document.querySelector("#loadingText");
  const refreshButton = document.querySelector("#refresh");
  if (text) text.textContent = message;
  if (overlay) overlay.hidden = !active;
  document.body.classList.toggle("app-loading", active);
  if (refreshButton) {
    refreshButton.disabled = active;
    refreshButton.textContent = active ? "Actualizando..." : "Actualizar";
  }
}

function metricData(context) {
  const root = statsForContext(context);
  const base = baseContext(context);
  if (base === "sales") return root.metrics?.sales || root;
  if (base === "carts") return root.cartMetrics?.carts || root.metrics?.sales || root;
  if (base === "cartProducts") return root.cartMetrics?.products || root.metrics?.products || root;
  if (base === "cartAmounts") return root.cartMetrics?.amounts || root.metrics?.billing || root;
  return root.metrics?.[base] || root.metrics?.sales || root;
}

function baseContext(context) {
  return String(context || "sales").replace(/^cmp[12]-/, "");
}

function compareSlot(context) {
  const value = String(context || "");
  if (value.startsWith("cmp1-")) return "one";
  if (value.startsWith("cmp2-")) return "two";
  return "";
}

function statsForContext(context) {
  const slot = compareSlot(context);
  if (slot) return compareStats[slot] || stats;
  return stats;
}

function isMoneyContext(context) {
  return ["billing", "cartAmounts"].includes(baseContext(context));
}

function metricDataOld(context) {
  if (context === "sales") return stats.metrics?.sales || stats;
  if (context === "carts") return stats.cartMetrics?.carts || stats.metrics?.sales || stats;
  if (context === "cartProducts") return stats.cartMetrics?.products || stats.metrics?.products || stats;
  if (context === "cartAmounts") return stats.cartMetrics?.amounts || stats.metrics?.billing || stats;
  return stats.metrics?.[context] || stats.metrics?.sales || stats;
}

function metricConfig(context) {
  return metricConfigs[baseContext(context)] || metricConfigs.sales;
}

function metricTarget(context, name) {
  return context === "sales" ? name : `${context}-${name}`;
}

function metricValue(value, context) {
  return isMoneyContext(context) ? money(value) : number(value);
}

function renderMetricDashboards() {
  document.querySelector("#view-productos").innerHTML = dashboardMarkup("products") + `<div id="productsProductsPanel"></div>`;
  document.querySelector("#view-facturacion").innerHTML = dashboardMarkup("billing") + `<div id="billingProductsPanel"></div>`;
  document.querySelector("#view-carritos").innerHTML = dashboardMarkup("carts", { compactProducts: true });
  document.querySelector("#view-carritos-productos").innerHTML = dashboardMarkup("cartProducts", { compactProducts: true });
  document.querySelector("#view-carritos-importes").innerHTML = dashboardMarkup("cartAmounts", { compactProducts: true });
  ["products", "billing", "carts", "cartProducts", "cartAmounts"].forEach((context) => {
    renderMetricDashboard(context);
  });
}

function dashboardMarkup(context, options = {}) {
  const config = metricConfig(context);
  const cartProductPanel = options.compactProducts ? `
      <article class="panel">
        <div class="panel-title"><span>◇</span><h2>Productos</h2></div>
        <p class="panel-subtitle center">Productos de carritos abandonados, por producto:</p>
        <div id="${metricTarget(context, "cartProductsPanel")}"></div>
      </article>
  ` : "";
  return `
    <div class="layout-main">
      <article class="panel wide">
        <div class="panel-title"><span>▥</span><h2>${config.dailyTitle}</h2><button class="expand-chart" type="button" data-expand-chart="${context}:sales">Expandir</button></div>
        <div class="bars" id="${metricTarget(context, "salesByDay")}"></div>
      </article>
      <article class="summary-panel">
        <div class="panel-title"><span>☑</span><h2>Resumen del periodo</h2></div>
        <div class="summary-grid" id="${metricTarget(context, "summaryGrid")}"></div>
      </article>
    </div>
    <div class="card-grid three">
      <article class="panel">
        <div class="panel-title"><span>▤</span><h2>Pago y financiacion</h2><button class="expand-chart" type="button" data-expand-chart="${context}:payments">Expandir</button></div>
        <div class="segmented payment-tabs">
          <button class="active" data-payment-view="platform" data-metric-context="${context}" type="button">Plataforma</button>
          <button data-payment-view="method" data-metric-context="${context}" type="button">Metodo</button>
          <button data-payment-view="installments" data-metric-context="${context}" type="button">Cuotas</button>
          <button data-payment-view="all" data-metric-context="${context}" type="button">Todo</button>
        </div>
        <div id="${metricTarget(context, "paymentsPanel")}">
          <div class="donut-row payment-donut-row"><div class="donut" id="${metricTarget(context, "paymentDonut")}"></div><div id="${metricTarget(context, "paymentsLegend")}"></div></div>
        </div>
      </article>
      <article class="panel">
        <div class="panel-title"><span>▧</span><h2>Variantes</h2><button class="expand-chart" type="button" data-expand-chart="${context}:variants">Expandir</button></div>
        <p class="panel-subtitle center">${config.label} en el periodo elegido, por variante:</p>
        <div class="segmented centered-tabs">
          <button class="active" data-metric-context="${context}" data-variant="all">Todas</button>
          <button data-metric-context="${context}" data-variant="colors">Color</button>
          <button data-metric-context="${context}" data-variant="sizes">Talle</button>
        </div>
        <div class="rank-list" id="${metricTarget(context, "variantsList")}"></div>
      </article>
      <article class="panel">
        <div class="panel-title"><span>⌖</span><h2>Provincias</h2><button class="expand-chart" type="button" data-expand-chart="${context}:provinces">Expandir</button></div>
        <p class="panel-subtitle center">${config.label} en el periodo elegido, por provincia:</p>
        <div class="segmented compact">
          <button class="active" data-metric-context="${context}" data-province-view="pie">Torta</button>
          <button data-metric-context="${context}" data-province-view="map">Mapa</button>
        </div>
        <div id="${metricTarget(context, "provinceChart")}"></div>
      </article>
    </div>
    <div class="card-grid three">
      <article class="panel">
        <div class="panel-title"><span>♙</span><h2>Edad</h2><button class="expand-chart" type="button" data-expand-chart="${context}:age">Expandir</button></div>
        <div class="line-chart" id="${metricTarget(context, "ageChart")}"></div>
        <p class="muted center" id="${metricTarget(context, "ageAverage")}"></p>
      </article>
      <article class="panel">
        <div class="panel-title"><span>▦</span><h2>Categorias</h2></div>
        <p class="panel-subtitle">${config.categoryText}</p>
        <div class="rank-list" id="${metricTarget(context, "categoriesList")}"></div>
        <div class="category-view">vista: <select><option>arbol</option></select></div>
      </article>
      <article class="panel">
        <div class="panel-title"><span>◷</span><h2>Hora del dia</h2><button class="expand-chart" type="button" data-expand-chart="${context}:hour">Expandir</button></div>
        <div class="line-chart" id="${metricTarget(context, "hourChart")}"></div>
      </article>
    </div>
    <div class="card-grid ${options.compactProducts ? "three" : "three"}">
      ${cartProductPanel}
      <article class="panel">
        <div class="panel-title"><span>▣</span><h2>Envios</h2></div>
        <p class="panel-subtitle center">${config.shippingText}</p>
        <div id="${metricTarget(context, "shippingPanel")}"></div>
      </article>
      <article class="panel">
        <div class="panel-title"><span>⚥</span><h2>Genero</h2><button class="expand-chart" type="button" data-expand-chart="${context}:gender">Expandir</button></div>
        <p class="panel-subtitle center">${config.genderText}</p>
        <div class="donut-row"><div class="donut" id="${metricTarget(context, "genderDonut")}"></div><div id="${metricTarget(context, "genderLegend")}"></div></div>
      </article>
    </div>
    <div class="card-grid two">
      <article class="panel">
        <div class="panel-title"><span>◇</span><h2>Combinacion de productos</h2></div>
        <div id="${metricTarget(context, "combosPanel")}"></div>
      </article>
      <article class="panel">
        <div class="panel-title"><span>▦</span><h2>Dias de la semana</h2><button class="expand-chart" type="button" data-expand-chart="${context}:weekdays">Expandir</button></div>
        <p class="panel-subtitle center">${config.weekdayText}</p>
        <div class="bars" id="${metricTarget(context, "weekdaysChart")}"></div>
      </article>
    </div>
  `;
}

function renderMetricDashboard(context) {
  const data = metricData(context);
  renderMetricBars(context);
  renderMetricSummary(context);
  renderPaymentPanel(context);
  renderProvinceChart(context);
  renderVariants(context);
  renderCategoryTree(context);
  renderLineChart(metricTarget(context, "ageChart"), (data.ages || []).map((item) => ({ label: item.label, count: item.count })), context);
  renderLineChart(metricTarget(context, "hourChart"), (data.hours || []).map((item) => ({ label: String(item.hour).padStart(2, "0"), count: item.count })), context);
  renderShippingPanel(context);
  renderDonut(metricTarget(context, "genderDonut"), metricTarget(context, "genderLegend"), data.gender || [], context);
  renderCartProductsPanel(context);
  renderCombosPanel(context);
  renderWeekdaysChart(context);
}

function renderComparison() {
  const contextsByView = {
    ventas: "sales",
    productos: "products",
    facturacion: "billing",
    carritos: "carts",
    "carritos-productos": "cartProducts",
    "carritos-importes": "cartAmounts"
  };
  Object.entries(contextsByView).forEach(([view, base]) => {
    const section = document.querySelector(`#view-${view}`);
    if (!section) return;
    const leftContext = `cmp1-${base}`;
    const rightContext = `cmp2-${base}`;
    section.innerHTML = compareViewMarkup(leftContext, rightContext);
    renderMetricDashboard(leftContext);
    if (compareStats.two) {
      renderMetricDashboard(rightContext);
      renderSummaryVariation(leftContext, rightContext);
    }
  });
  showView(currentView);
}

function compareViewMarkup(leftContext, rightContext) {
  const right = compareStats.two
    ? comparePaneMarkup(rightContext, "Periodo 2", comparePeriod2)
    : `<div class="compare-empty"><button type="button" class="compare-choose-period" data-open-compare-period>Elegí el segundo período a comparar</button></div>`;
  return `
    <div class="compare-period-row">
      <span>▣ Periodo 1: <strong>${escapeHtml(periodLabel(comparePeriod1).toLowerCase())}</strong></span>
      ${compareStats.two ? `<span>▣ Periodo 2: <strong>${escapeHtml(periodLabel(comparePeriod2).toLowerCase())}</strong></span>` : ""}
    </div>
    <div class="compare-layout">
      ${comparePaneMarkup(leftContext, "Periodo 1", comparePeriod1)}
      ${right}
    </div>
  `;
}

function comparePaneMarkup(context, title, period) {
  return `
    <section class="compare-pane" data-compare-pane="${context}">
      <div class="compare-pane-title">${escapeHtml(title)}: <strong>${escapeHtml(periodLabel(period).toLowerCase())}</strong></div>
      ${dashboardMarkup(context, { compactProducts: baseContext(context).startsWith("cart") })}
    </section>
  `;
}

function renderSummaryVariation(leftContext, rightContext) {
  const leftCards = document.querySelectorAll(`#${metricTarget(leftContext, "summaryGrid")} .metric`);
  const rightCards = document.querySelectorAll(`#${metricTarget(rightContext, "summaryGrid")} .metric`);
  leftCards.forEach((card, index) => {
    const leftValue = parseMetricNumber(card.querySelector("strong")?.textContent || "");
    const rightValue = parseMetricNumber(rightCards[index]?.querySelector("strong")?.textContent || "");
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue) || rightValue === 0) return;
    const change = ((leftValue - rightValue) / Math.abs(rightValue)) * 100;
    const badge = document.createElement("span");
    badge.className = `variation-badge ${change >= 0 ? "positive" : "negative"}`;
    badge.textContent = `${change >= 0 ? "+" : ""}${number(change)}%`;
    card.prepend(badge);
  });
}

function parseMetricNumber(value) {
  const normalized = String(value || "")
    .replace(/\$/g, "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function paymentRowsFor(data, view) {
  if (view === "method") return data.paymentMethods || data.payments || [];
  if (view === "installments") return data.paymentInstallments || [];
  if (view === "all") return data.paymentAll || [];
  return data.paymentPlatforms || data.payments || [];
}

function renderPaymentPanel(context = "sales") {
  const data = metricData(context);
  const view = activePayments[context] || "platform";
  const panel = document.querySelector(`#${metricTarget(context, "paymentsPanel")}`);
  if (!panel) return;
  const rows = paymentRowsFor(data, view);
  document.querySelectorAll(`[data-payment-view][data-metric-context="${context}"]`).forEach((button) => {
    button.classList.toggle("active", button.dataset.paymentView === view);
  });

  if (view === "installments") {
    panel.innerHTML = `<div class="payment-bars">${paymentInstallmentsChart(rows, context)}</div>`;
    return;
  }

  if (view === "all") {
    const total = rows.reduce((sum, item) => sum + Number(item.count || 0), 0);
    panel.innerHTML = miniTableMarkup("Forma de pago", metricConfig(context).label, rows, total, context);
    return;
  }

  panel.innerHTML = `<div class="donut-row payment-donut-row"><div class="donut" id="${metricTarget(context, "paymentDonut")}"></div><div id="${metricTarget(context, "paymentsLegend")}"></div></div>`;
  renderDonut(metricTarget(context, "paymentDonut"), metricTarget(context, "paymentsLegend"), rows, context);
}

function paymentContentMarkup(context = "sales", expanded = false) {
  const data = metricData(context);
  const view = activePayments[context] || "platform";
  const rows = paymentRowsFor(data, view);
  if (view === "installments") {
    return `<div class="payment-bars ${expanded ? "expanded-payment-bars" : ""}">${paymentInstallmentsChart(rows, context, expanded)}</div>`;
  }
  if (view === "all") {
    const total = rows.reduce((sum, item) => sum + Number(item.count || 0), 0);
    return `<div class="${expanded ? "expanded-table-wrap" : ""}">${miniTableMarkup("Forma de pago", metricConfig(context).label, rows, total, context)}</div>`;
  }
  return `<div class="expanded-donut">${donutMarkup(rows, context)}</div>`;
}

function renderProvinceChart(context = "sales") {
  const data = metricData(context);
  const currentView = activeProvinceViews[context] || "pie";
  document.querySelectorAll(`[data-province-view][data-metric-context="${context}"]`).forEach((button) => {
    button.classList.toggle("active", button.dataset.provinceView === currentView);
  });
  const container = document.querySelector(`#${metricTarget(context, "provinceChart")}`);
  if (currentView === "map") {
    container.innerHTML = argentinaProvinceMap(data.provinces || [], context);
    return;
  }
  container.innerHTML = provinceDonutMarkup(data.provinces || [], context);
}

function renderBars() {
  const grouped = groupSalesForPeriod(stats.salesByDay, stats.range.days);
  document.querySelector("#salesByDay").innerHTML = `
    <div class="chart-box">
      ${barChartSvg(grouped)}
    </div>
    <div class="chart-caption">
      <span>${stats.range.days > 45 ? "Agrupado por semana para leer mejor los 90 dias." : "Ventas pagadas del periodo."}</span>
      <strong>${grouped.reduce((sum, item) => sum + item.count, 0)} ventas</strong>
    </div>
  `;
}

function renderMetricBars(context) {
  const data = metricData(context);
  const config = metricConfig(context);
  const root = statsForContext(context);
  const grouped = groupSalesForPeriod(data.byDay || [], root.range.days);
  document.querySelector(`#${metricTarget(context, "salesByDay")}`).innerHTML = `
    <div class="chart-box">
      ${barChartSvg(grouped, context)}
    </div>
    <div class="chart-caption">
      <span>${root.range.days > 45 ? "Agrupado por semana para leer mejor los 90 dias." : config.dailyCaption}</span>
      <strong>${metricValue(grouped.reduce((sum, item) => sum + Number(item.count || 0), 0), context)} ${isMoneyContext(context) ? "" : config.unit}</strong>
    </div>
  `;
}

function renderSummary() {
  const s = stats.summary;
  const cards = [
    [s.sales, "ventas"],
    [number(s.salesPerDay), "ventas por dia"],
    [number(s.productsPerSale), "productos por venta"],
    [money(s.averageTicket), "por venta (ticket promedio)"]
  ];
  document.querySelector("#summaryGrid").innerHTML = cards.map(([value, label]) => `
    <article class="metric"><strong>${value}</strong><span>${label}</span></article>
  `).join("");
}

function renderMetricSummary(context) {
  const config = metricConfig(context);
  const data = metricData(context);
  const root = statsForContext(context);
  const total = (data.byDay || []).reduce((sum, item) => sum + Number(item.count || 0), 0);
  const perDay = root.range?.days ? total / root.range.days : 0;
  const productAverageRevenue = total ? Number(root.summary.revenue || 0) / total : 0;
  const cartTotal = root.summary.abandonedCarts || 0;
  const cartProductsTotal = (root.cartMetrics?.products?.byDay || []).reduce((sum, item) => sum + Number(item.count || 0), 0);
  const cartAmountsTotal = (root.cartMetrics?.amounts?.byDay || []).reduce((sum, item) => sum + Number(item.count || 0), 0);
  const base = baseContext(context);
  const cards = base === "carts"
    ? [
      [metricValue(total, context), "carritos"],
      [metricValue(perDay, context), "carritos por dia"],
      [number(cartTotal ? cartProductsTotal / cartTotal : 0), "productos por carrito"],
      [money(cartTotal ? cartAmountsTotal / cartTotal : 0), "importe por carrito"]
    ]
    : base === "cartProducts"
      ? [
        [metricValue(total, context), "productos"],
        [metricValue(perDay, context), "productos por dia"],
        [number(cartTotal ? total / cartTotal : 0), "productos por carrito"],
        [money(total ? cartAmountsTotal / total : 0), "importe por producto"]
      ]
      : base === "cartAmounts"
        ? [
          [metricValue(total, context), "importe total"],
          [metricValue(perDay, context), "importe por dia"],
          [money(cartTotal ? total / cartTotal : 0), "importe por carrito"],
          [money(cartProductsTotal ? total / cartProductsTotal : 0), "importe por producto"]
        ]
        : base === "billing"
    ? [
      [metricValue(total, context), "total facturado"],
      [metricValue(perDay, context), "por dia"],
      [money(root.summary.averageTicket), "por venta (ticket promedio)"],
      [money(productAverageRevenue), "por producto (promedio)"]
    ]
    : [
      [metricValue(total, context), config.summaryLabels[0]],
      [metricValue(perDay, context), config.summaryLabels[1]],
      [number(root.summary.productsPerSale), "productos por venta"],
      baseContext(context) === "products"
        ? [money(productAverageRevenue), "por producto (promedio)"]
        : [money(root.summary.averageTicket), "ticket promedio"]
    ];
  document.querySelector(`#${metricTarget(context, "summaryGrid")}`).innerHTML = cards.map(([value, label]) => `
    <article class="metric"><strong>${value}</strong><span>${label}</span></article>
  `).join("");
}

function renderDonut(donutId, legendId, rows, context = "sales") {
  const safeRows = (rows || []).filter((item) => Number(item.count || 0) > 0);
  const donut = document.querySelector(`#${donutId}`);
  const legend = document.querySelector(`#${legendId}`);
  if (!safeRows.length) {
    donut.style.background = "conic-gradient(#e8eef5 0deg 360deg)";
    donut.innerHTML = "";
    legend.innerHTML = `<p class="muted center">Sin datos para este periodo.</p>`;
    return;
  }
  const parts = donutParts(safeRows, context);
  donut.style.background = parts.gradient;
  donut.innerHTML = parts.labels;
  legend.innerHTML = parts.legend;
}

function donutParts(rows, context = "sales") {
  const total = rows.reduce((sum, item) => sum + Number(item.count || 0), 0) || 1;
  let cursor = 0;
  const gap = rows.length > 1 ? 2 : 0;
  const slices = rows.map((item, index) => {
    const start = cursor;
    const value = Number(item.count || 0);
    cursor += (value / total) * 360;
    const visualStart = Math.min(start + gap / 2, cursor);
    const visualEnd = Math.max(visualStart, cursor - gap / 2);
    return {
      ...item,
      value,
      start,
      end: cursor,
      visualStart,
      visualEnd,
      color: colors[index % colors.length]
    };
  });
  const stops = slices.map((item) => `#fff ${item.start}deg ${item.visualStart}deg, ${item.color} ${item.visualStart}deg ${item.visualEnd}deg, #fff ${item.visualEnd}deg ${item.end}deg`);
  const labels = donutSliceLabels(slices, context);
  return {
    gradient: `conic-gradient(${stops.join(",") || "#dfe9e8 0deg 360deg"})`,
    labels,
    legend: `<div class="legend">${rows.map((item, index) => `
    <div class="legend-item">
      <span class="swatch" style="background:${colors[index % colors.length]}"></span>
      <span class="legend-label">${escapeHtml(item.label)}</span>
      <span class="legend-percent">${percent(item.count, total)}</span>
    </div>
  `).join("")}</div>`
  };
}

function compactDonutRows(rows, maxVisible = 4) {
  const safeRows = (rows || []).filter((item) => Number(item.count || 0) > 0);
  if (safeRows.length <= maxVisible + 1) return safeRows;
  const sorted = [...safeRows].sort((a, b) => Number(b.count || 0) - Number(a.count || 0));
  const visible = sorted.slice(0, maxVisible);
  const rest = sorted.slice(maxVisible);
  return [
    ...visible,
    {
      label: "otros",
      count: rest.reduce((sum, item) => sum + Number(item.count || 0), 0),
      children: rest
    }
  ];
}

function donutSliceLabels(slices, context = "sales") {
  const isMoney = ["billing", "cartAmounts"].includes(context);
  return slices.map((item) => {
    const mid = ((item.start + item.end) / 2) - 90;
    const radians = mid * (Math.PI / 180);
    const radius = 36;
    const x = 50 + Math.cos(radians) * radius;
    const y = 50 + Math.sin(radians) * radius;
    const value = metricValue(item.value, context);
    const moneyClass = isMoney ? " money" : "";
    return `<span class="donut-slice-value${moneyClass}" style="left:${x.toFixed(1)}%; top:${y.toFixed(1)}%;" title="${escapeHtml(item.label)}: ${escapeHtml(value)}">${escapeHtml(value)}</span>`;
  }).join("");
}

function donutMarkup(rows, context = "sales", options = {}) {
  const compact = options.compact !== false;
  const safeRows = compact ? compactDonutRows(rows) : (rows || []).filter((item) => Number(item.count || 0) > 0);
  if (!safeRows.length) return `<p class="muted center">Sin datos para este periodo.</p>`;
  const parts = donutParts(safeRows, context);
  return `<div class="donut-row"><div class="donut" style="background:${parts.gradient}">${parts.labels}</div><div>${parts.legend}</div></div>`;
}

function provinceDonutMarkup(rows, context = "sales") {
  const safeRows = (rows || []).filter((item) => Number(item.count || 0) > 0);
  if (!safeRows.length) return `<p class="muted center">Sin datos para este periodo.</p>`;
  const total = safeRows.reduce((sum, item) => sum + Number(item.count || 0), 0) || 1;
  let cursor = 0;
  const gap = safeRows.length > 1 ? 2 : 0;
  const slices = safeRows.map((item, index) => {
    const start = cursor;
    const value = Number(item.count || 0);
    cursor += (value / total) * 360;
    const visualStart = Math.min(start + gap / 2, cursor);
    const visualEnd = Math.max(visualStart, cursor - gap / 2);
    return {
      ...item,
      value,
      start,
      end: cursor,
      visualStart,
      visualEnd,
      color: colors[index % colors.length]
    };
  });
  const stops = slices.map((item) => `#fff ${item.start}deg ${item.visualStart}deg, ${item.color} ${item.visualStart}deg ${item.visualEnd}deg, #fff ${item.visualEnd}deg ${item.end}deg`);
  const valueLabels = donutSliceLabels(slices, context);
  const legend = safeRows.map((item, index) => {
    const isOther = ["otros", "otras"].includes(String(item.label || "").toLowerCase()) && Array.isArray(item.children) && item.children.length;
    const detail = isOther ? ` <button class="detail-link" type="button" data-province-detail="${context}">(ver detalle)</button>` : "";
    return `
      <div class="legend-item">
        <span class="swatch" style="background:${colors[index % colors.length]}"></span>
        <span class="legend-label">${escapeHtml(item.label)}</span>
        <span class="legend-percent">${percent(item.count, total)}${detail}</span>
      </div>
    `;
  }).join("");
  return `
    <div class="donut-row province-donut-row">
      <div class="donut province-donut" style="background:conic-gradient(${stops.join(",")})">${valueLabels}</div>
      <div class="legend">${legend}</div>
    </div>
  `;
}

function renderVariants(context = "sales") {
  const data = metricData(context);
  const activeVariant = activeVariants[context] || "colors";
  const rows = data.variants?.[activeVariant] || [];
  const target = document.querySelector(`#${metricTarget(context, "variantsList")}`);
  if (context !== "sales" && activeVariant === "all") {
    target.innerHTML = `<div class="variant-donut">${donutMarkup(rows, context)}</div>`;
  } else {
    renderPillRank(metricTarget(context, "variantsList"), rows, context);
  }
  document.querySelectorAll(`[data-variant][data-metric-context="${context}"]`).forEach((button) => {
    button.classList.toggle("active", button.dataset.variant === activeVariant);
  });
}

function renderPillRank(targetId, rows, context = "sales") {
  document.querySelector(`#${targetId}`).innerHTML = pillRankMarkup(rows, context);
}

function pillRankMarkup(rows, context = "sales") {
  const max = Math.max(...rows.map((item) => Number(item.count || 0)), 1);
  return rows.map((item, index) => {
    const width = Math.max(10, (Number(item.count || 0) / max) * 100);
    return `
      <div class="pill-rank-row">
        <div class="pill-rank-fill" style="width:${width}%; background:${colors[index % colors.length]}" title="${escapeHtml(item.label)}: ${metricValue(item.count, context)}">
          <span>${escapeHtml(item.label)}: <strong>${metricValue(item.count, context)}</strong></span>
        </div>
      </div>
    `;
  }).join("") || `<p class="muted">Sin datos para este periodo.</p>`;
}

function renderRank(targetId, rows, context = "sales") {
  const max = Math.max(...rows.map((item) => item.count), 1);
  document.querySelector(`#${targetId}`).innerHTML = rows.map((item, index) => `
    <div class="rank-row">
      <div class="rank-meta">
        <span class="rank-label">${escapeHtml(item.label)}</span>
        <span class="rank-value">${metricValue(item.count, context)}</span>
      </div>
      <div class="rank-track" title="${escapeHtml(item.label)}: ${metricValue(item.count, context)}">
        <div class="rank-fill" style="width:${Math.max(4, (item.count / max) * 100)}%; background:${colors[index % colors.length]}"></div>
      </div>
    </div>
  `).join("") || `<p class="muted">Sin datos para este periodo.</p>`;
}

function renderCategoryTree(context = "sales") {
  const data = metricData(context);
  const rows = data.categoryTree?.length ? data.categoryTree : (data.categories || []).map((item) => ({ ...item, children: [] }));
  const max = Math.max(...rows.map((item) => item.count), 1);
  document.querySelector(`#${metricTarget(context, "categoriesList")}`).innerHTML = rows.map((item, index) => {
    const hasChildren = Array.isArray(item.children) && item.children.length;
    const expanded = expandedCategories.has(item.label);
    return `
      <div class="category-row">
        <div class="category-main">
          ${hasChildren ? `<button class="category-toggle" type="button" data-metric-context="${context}" data-category-toggle="${escapeHtml(item.label)}">${expanded ? "−" : "+"}</button>` : `<span class="category-spacer"></span>`}
          <div class="category-fill-wrap">
            <div class="rank-meta">
              <span class="rank-label">${escapeHtml(item.label)}</span>
              <span class="rank-value">${metricValue(item.count, context)}</span>
            </div>
            <div class="rank-track" title="${escapeHtml(item.label)}: ${metricValue(item.count, context)}">
              <div class="rank-fill" style="width:${Math.max(4, (item.count / max) * 100)}%; background:${colors[index % colors.length]}"></div>
            </div>
          </div>
        </div>
        ${expanded ? renderCategoryChildren(item.children, item.count, context) : ""}
      </div>
    `;
  }).join("") || `<p class="muted">Sin datos para este periodo.</p>`;
  document.querySelectorAll(`[data-category-toggle][data-metric-context="${context}"]`).forEach((button) => {
    button.addEventListener("click", () => {
      const label = button.dataset.categoryToggle;
      if (expandedCategories.has(label)) expandedCategories.delete(label);
      else expandedCategories.add(label);
      renderCategoryTree(context);
    });
  });
}

function renderCategoryChildren(children, parentCount, context = "sales") {
  return `
    <div class="category-children">
      ${children.map((child) => `
        <div class="category-child">
          <span>${escapeHtml(child.label)}</span>
          <strong>${metricValue(child.count, context)}</strong>
          <small>${percent(child.count, parentCount)}</small>
        </div>
      `).join("")}
    </div>
  `;
}

function renderShippingPanel(context = "sales") {
  const data = metricData(context);
  const config = metricConfig(context);
  const shippingRows = data.shipping || [];
  const paymentRows = data.shippingPayment || [];
  const shippingTotal = shippingRows.reduce((sum, item) => sum + Number(item.count || 0), 0);
  const paymentTotal = paymentRows.reduce((sum, item) => sum + Number(item.count || 0), 0);
  const shippingColumn = context === "billing" || context === "cartAmounts" ? "Importe ($)" : config.label;
  const totalBase = context === "billing" || context === "cartAmounts"
    ? (data.byDay || []).reduce((sum, item) => sum + Number(item.count || 0), 0)
    : shippingTotal;
  document.querySelector(`#${metricTarget(context, "shippingPanel")}`).innerHTML = `
    ${miniTableMarkup("Forma de envio", shippingColumn, shippingRows, shippingTotal, context)}
    <p class="panel-subtitle center shipping-subtitle">${config.shippingPaymentText}</p>
    ${miniTableMarkup("Pago del envio", shippingColumn, paymentRows, paymentTotal, context)}
    <p class="center shipping-total">Total: <strong>${metricValue(shippingTotal, context)}</strong> <span class="muted">(${percent(shippingTotal, totalBase)} del total${context === "billing" ? " facturado" : context === "cartAmounts" ? " de importes" : ""})</span></p>
  `;
}

function miniTableMarkup(leftLabel, rightLabel, rows, total, context = "sales") {
  return `
    <table class="mini-table">
      <thead><tr><th>${escapeHtml(leftLabel)}</th><th>${escapeHtml(rightLabel)}</th></tr></thead>
      <tbody>
        ${rows.map((item) => `
          <tr>
            <td>${escapeHtml(item.label)}</td>
            <td><strong>${metricValue(item.count, context)}</strong> <span class="muted">(${percent(item.count, total)})</span></td>
          </tr>
        `).join("") || `<tr><td colspan="2" class="empty-row">Sin datos para este periodo.</td></tr>`}
      </tbody>
    </table>
  `;
}

function renderCartProductsPanel(context = "sales") {
  const target = document.querySelector(`#${metricTarget(context, "cartProductsPanel")}`);
  if (!target) return;
  if (!target.querySelector(".cart-products-widget")) {
    target.innerHTML = `
      <div class="cart-products-widget">
        <div class="table-actions compact-actions">
          <input class="cart-product-search" value="${escapeHtml(cartProductQuery)}" placeholder="Buscar producto">
        </div>
        <table class="mini-table cart-product-table">
          <thead><tr><th>Producto</th><th class="cart-product-value-heading">Cantidad</th></tr></thead>
          <tbody class="cart-product-table-body"></tbody>
        </table>
        <div class="combo-pagination cart-product-pagination"></div>
      </div>
    `;
    target.querySelector(".cart-product-search")?.addEventListener("input", (event) => {
      cartProductQuery = event.target.value;
      cartProductPage = 1;
      updateCartProductsPanels();
    });
  }
  updateCartProductsPanel(target, context);
}

function updateCartProductsPanels() {
  ["carts", "cartProducts", "cartAmounts"].forEach((context) => {
    const target = document.querySelector(`#${metricTarget(context, "cartProductsPanel")}`);
    if (target) updateCartProductsPanel(target, context);
  });
}

function updateCartProductsPanel(target, context = "sales") {
  const root = statsForContext(context);
  const allRows = root.cartMetrics?.productsTable || [];
  const rows = allRows.filter((item) => normalize(item.label).includes(normalize(cartProductQuery)));
  const useRevenue = context === "cartAmounts";
  const total = allRows.reduce((sum, item) => sum + Number(useRevenue ? item.revenue || 0 : item.count || 0), 0);
  const pageCount = Math.max(1, Math.ceil(rows.length / cartProductPageSize));
  cartProductPage = Math.min(Math.max(cartProductPage, 1), pageCount);
  const start = (cartProductPage - 1) * cartProductPageSize;
  const visibleRows = rows.slice(start, start + cartProductPageSize);
  const heading = target.querySelector(".cart-product-value-heading");
  if (heading) heading.textContent = useRevenue ? "Importe" : "Cantidad";
  const body = target.querySelector(".cart-product-table-body");
  if (body) {
    body.innerHTML = visibleRows.map((item) => {
      const value = useRevenue ? Number(item.revenue || 0) : Number(item.count || 0);
      return `
        <tr>
          <td><span class="product-thumb small-thumb">${item.image ? `<img src="${escapeHtml(item.image)}" alt="">` : ""}</span>${escapeHtml(item.label)}</td>
          <td><strong>${useRevenue ? money(value) : number(value)}</strong> <span class="muted">(${percent(value, total)})</span></td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="2" class="empty-row">Sin productos para este periodo.</td></tr>`;
  }
  const pagination = target.querySelector(".cart-product-pagination");
  if (pagination) {
    pagination.innerHTML = `
      <span>mostrando ${rows.length ? start + 1 : 0} a ${Math.min(start + cartProductPageSize, rows.length)} de ${rows.length}</span>
      <span class="page-buttons">${cartProductPaginationButtons(pageCount, context)}</span>
      <select class="cart-product-page-size" data-metric-context="${context}">
        ${[5, 10, 20].map((size) => `<option value="${size}" ${size === cartProductPageSize ? "selected" : ""}>${size} por pagina</option>`).join("")}
      </select>
    `;
    pagination.querySelectorAll("[data-cart-product-page]").forEach((button) => {
      button.addEventListener("click", () => {
        cartProductPage = Number(button.dataset.cartProductPage || 1);
        updateCartProductsPanels();
      });
    });
    pagination.querySelector(".cart-product-page-size")?.addEventListener("change", (event) => {
      cartProductPageSize = Number(event.target.value || 5);
      cartProductPage = 1;
      updateCartProductsPanels();
    });
  }
  const input = target.querySelector(".cart-product-search");
  if (input && input.value !== cartProductQuery) input.value = cartProductQuery;
}

function cartProductPaginationButtons(pageCount, context) {
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
  const visible = pages.filter((page) => page <= 4 || page === pageCount || Math.abs(page - cartProductPage) <= 1);
  const pieces = [];
  visible.forEach((page, index) => {
    if (index && page - visible[index - 1] > 1) pieces.push(`<span class="page-gap">...</span>`);
    pieces.push(`<button type="button" class="${page === cartProductPage ? "active" : ""}" data-cart-product-page="${page}" data-metric-context="${context}">${page}</button>`);
  });
  return pieces.join("");
}

function renderCombosPanel(context = "sales") {
  const data = baseContext(context).startsWith("cart") ? metricData(context.replace(baseContext(context), "carts")) : metricData(context.replace(baseContext(context), "sales"));
  const comboRows = data.combos || [];
  const products = comboProductOptions(comboRows);
  const selected = selectedComboProduct;
  const comboUnit = context.startsWith("cart") ? "carritos" : "ventas";
  const rows = selected
    ? comboRows
        .filter((item) => comboProducts(item).includes(selected))
        .map((item) => comboRowForSelected(item, selected))
        .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
    : comboRows;
  const pageSize = 5;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  comboPages[context] = Math.min(Math.max(comboPages[context] || 1, 1), totalPages);
  const page = comboPages[context];
  const visibleRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const panel = document.querySelector(`#${metricTarget(context, "combosPanel")}`);
  panel.innerHTML = `
    <div class="combo-controls">
      <select id="${metricTarget(context, "comboProductSelect")}">
        <option value="">Elegi un producto para ver sus coincidencias</option>
        ${products.map((label) => `<option value="${escapeHtml(label)}" ${label === selectedComboProduct ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
      </select>
      <button class="link-button" type="button" data-combo-help>Como se calcula el % de coincidencia?</button>
    </div>
    <table class="mini-table combo-table">
      <thead><tr><th>Productos que mas se vendieron juntos</th><th>Cant. ${comboUnit} /<br>% coincidencia</th></tr></thead>
      <tbody>
        ${visibleRows.map((item) => comboRowMarkup(item, comboUnit)).join("") || `<tr><td colspan="2" class="empty-row">Sin combinaciones para este periodo.</td></tr>`}
      </tbody>
    </table>
    <div class="combo-pagination">
      <span class="page-buttons">${comboPaginationButtons(totalPages, page, context)}</span>
      <select disabled><option>5 por pagina</option></select>
    </div>
  `;
  panel.querySelector(`#${metricTarget(context, "comboProductSelect")}`).addEventListener("change", (event) => {
    selectedComboProduct = event.target.value;
    comboPages[context] = 1;
    renderCombosPanel(context);
  });
  panel.querySelectorAll("[data-combo-page]").forEach((button) => {
    button.addEventListener("click", () => {
      comboPages[context] = Number(button.dataset.comboPage || 1);
      renderCombosPanel(context);
    });
  });
}

function comboProductOptions(rows) {
  return [...new Set(rows.flatMap(comboProducts))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "es"));
}

function paginationButtons(totalPages, activePage, context) {
  const start = Math.max(1, Math.min(activePage - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  const pages = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  return `
    <button type="button" data-combo-page="${Math.max(1, activePage - 1)}" data-metric-context="${context}" ${activePage === 1 ? "disabled" : ""}>‹</button>
    ${start > 1 ? `<button type="button" data-combo-page="1" data-metric-context="${context}">1</button><span class="page-gap">...</span>` : ""}
    ${pages.map((page) => `<button class="${page === activePage ? "active" : ""}" type="button" data-combo-page="${page}" data-metric-context="${context}">${page}</button>`).join("")}
    ${end < totalPages ? `<span class="page-gap">...</span><button type="button" data-combo-page="${totalPages}" data-metric-context="${context}">${totalPages}</button>` : ""}
    <button type="button" data-combo-page="${Math.min(totalPages, activePage + 1)}" data-metric-context="${context}" ${activePage === totalPages ? "disabled" : ""}>›</button>
  `;
}

function comboPaginationButtons(totalPages, activePage, context) {
  const start = Math.max(1, Math.min(activePage - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  const pages = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  return `
    <button type="button" data-combo-page="${Math.max(1, activePage - 1)}" data-metric-context="${context}" ${activePage === 1 ? "disabled" : ""}>Anterior</button>
    ${start > 1 ? `<button type="button" data-combo-page="1" data-metric-context="${context}">1</button><span class="page-gap">...</span>` : ""}
    ${pages.map((page) => `<button class="${page === activePage ? "active" : ""}" type="button" data-combo-page="${page}" data-metric-context="${context}">${page}</button>`).join("")}
    ${end < totalPages ? `<span class="page-gap">...</span><button type="button" data-combo-page="${totalPages}" data-metric-context="${context}">${totalPages}</button>` : ""}
    <button type="button" data-combo-page="${Math.min(totalPages, activePage + 1)}" data-metric-context="${context}" ${activePage === totalPages ? "disabled" : ""}>Siguiente</button>
  `;
}

function comboProducts(item) {
  if (item.first && item.second) return [item.first, item.second];
  if (item.source && item.target) return [item.source, item.target];
  return String(item.label || "").split(" + ");
}

function comboRowForSelected(item, selected) {
  const products = comboProducts(item);
  const other = products.find((label) => label !== selected) || products[0] || "";
  const selectedBase = item.first === selected
    ? item.firstBase
    : item.second === selected
      ? item.secondBase
      : item.source === selected
        ? item.base
        : item.base;
  return {
    ...item,
    label: `${selected} + ${other}`,
    base: selectedBase || item.base || item.count
  };
}

function comboRowMarkup(item, unit = "ventas") {
  const base = Number(item.base || item.count || 0) || 1;
  return `
    <tr>
      <td>${escapeHtml(item.label).replaceAll(" + ", "<br>+<br>")}</td>
      <td><strong>${number(item.count)} ${unit}</strong><br><span class="muted">${percent(item.count, base)}<br>coincidencia</span></td>
    </tr>
  `;
}

function renderWeekdaysChart(context = "sales") {
  const data = metricData(context);
  const rows = (data.weekdays || []).map((item) => ({ label: item.label, count: item.count, title: `${item.label}: ${metricValue(item.count, context)}` }));
  document.querySelector(`#${metricTarget(context, "weekdaysChart")}`).innerHTML = `
    <div class="chart-box weekday-chart">
      ${barChartSvg(rows, context)}
    </div>
  `;
}

function argentinaProvinceMap(rows, context = "sales") {
  if (!argentinaGeojson?.features?.length) {
    return `<p class="muted center">Cargando mapa de Argentina...</p>`;
  }
  const total = rows.reduce((sum, item) => sum + Number(item.count || 0), 0) || 1;
  const provinceRows = rows.filter((item) => !["otros", "otras"].includes(String(item.label || "").toLowerCase()));
  const max = Math.max(...provinceRows.map((item) => Number(item.count || 0)), 1);
  const valuesByProvince = new Map(provinceRows.map((item) => [provinceKey(item.label), Number(item.count || 0)]));
  const bbox = geojsonBbox(argentinaGeojson);
  const width = 430;
  const height = 760;
  const project = createGeoProjector(bbox, width, height);
  const provinceShapes = argentinaGeojson.features.map((feature) => {
    const name = feature.properties?.name || "Provincia";
    const normalizedName = displayProvinceName(name);
    const value = valuesByProvince.get(provinceKey(normalizedName)) || valuesByProvince.get(provinceKey(name)) || 0;
    const fill = provinceMapFill(value, max);
    const path = geoFeaturePath(feature, project);
    const [px, py] = projectedFeatureCenter(feature, project);
    return `
      <g class="map-province ${value ? "has-data" : ""}">
        <path d="${path}" fill="${fill}">
          <title>${escapeHtml(normalizedName)}: ${value ? `${percent(value, total)} (${metricValue(value, context)})` : "sin datos en el periodo"}</title>
        </path>
        ${value ? `<text x="${px}" y="${py - 5}" text-anchor="middle">${escapeHtml(shortProvince(normalizedName))}</text>
        <text class="map-percent" x="${px}" y="${py + 13}" text-anchor="middle">${percent(value, total)}</text>` : ""}
      </g>
    `;
  }).join("");
  const cabaValue = valuesByProvince.get(provinceKey("Capital Federal")) || 0;
  const [cabaX, cabaY] = project([-58.3816, -34.6037]);
  const cabaFill = provinceMapFill(cabaValue, max);
  const cabaMarker = cabaValue ? `
    <g class="map-province has-data caba-marker">
      <circle cx="${cabaX}" cy="${cabaY}" r="11" fill="${cabaFill}">
        <title>Capital Federal: ${percent(cabaValue, total)} (${metricValue(cabaValue, context)})</title>
      </circle>
      <text x="${cabaX + 34}" y="${cabaY - 3}" text-anchor="middle">CABA</text>
      <text class="map-percent" x="${cabaX + 34}" y="${cabaY + 14}" text-anchor="middle">${percent(cabaValue, total)}</text>
    </g>
  ` : "";

  return `
    <div class="province-map-wrap">
      <svg class="province-map real-map" viewBox="0 0 ${width} ${height}" role="img" aria-label="Mapa de ventas por provincia argentina">
        ${provinceShapes}
        ${cabaMarker}
      </svg>
      <div class="map-scale">
        <span>Menor</span><div></div><span>Mayor</span>
      </div>
    </div>
  `;
}

function provinceMapFill(value, max) {
  if (!value) return "#f3eefb";
  const ratio = Math.max(0, Math.min(1, Number(value || 0) / Math.max(Number(max || 1), 1)));
  if (ratio < 0.34) return "#b9a3ea";
  if (ratio < 0.67) return "#8d64d8";
  return "#6c3fc5";
}

function geojsonBbox(geojson) {
  const points = [];
  geojson.features.forEach((feature) => collectGeoPoints(feature.geometry?.coordinates, points));
  return points.reduce((box, [x, y]) => ({
    minX: Math.min(box.minX, x),
    minY: Math.min(box.minY, y),
    maxX: Math.max(box.maxX, x),
    maxY: Math.max(box.maxY, y)
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function collectGeoPoints(coords, points) {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    points.push(coords);
    return;
  }
  coords.forEach((item) => collectGeoPoints(item, points));
}

function createGeoProjector(bbox, width, height) {
  const pad = 18;
  const scale = Math.min((width - pad * 2) / (bbox.maxX - bbox.minX), (height - pad * 2) / (bbox.maxY - bbox.minY));
  const offsetX = (width - (bbox.maxX - bbox.minX) * scale) / 2;
  const offsetY = (height - (bbox.maxY - bbox.minY) * scale) / 2;
  return ([lon, lat]) => [
    offsetX + (lon - bbox.minX) * scale,
    height - (offsetY + (lat - bbox.minY) * scale)
  ];
}

function geoFeaturePath(feature, project) {
  const type = feature.geometry?.type;
  const coords = feature.geometry?.coordinates || [];
  const polygons = type === "MultiPolygon" ? coords : [coords];
  return polygons.map((polygon) => polygon.map((ring) => {
    return ring.map((point, index) => {
      const [x, y] = project(point);
      return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ") + " Z";
  }).join(" ")).join(" ");
}

function projectedFeatureCenter(feature, project) {
  const points = [];
  collectGeoPoints(feature.geometry?.coordinates, points);
  const avg = points.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]);
  return project([avg[0] / points.length, avg[1] / points.length]);
}

function displayProvinceName(name) {
  const map = {
    "Córdoba": "Cordoba",
    "Entre Ríos": "Entre Rios",
    "Neuquén": "Neuquen",
    "Río Negro": "Rio Negro",
    "Tucumán": "Tucuman",
    "Tierra del Fuego, Antártida e Islas del Atlántico Sur": "Tierra del Fuego"
  };
  return map[name] || name;
}

function provinceKey(name) {
  const normalized = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const aliases = {
    "caba": "capital federal",
    "ciudad autonoma de buenos aires": "capital federal",
    "ciudad autónoma de buenos aires": "capital federal",
    "capital federal": "capital federal",
    "buenos aires": "buenos aires",
    "cordoba": "cordoba",
    "neuquen": "neuquen",
    "rio negro": "rio negro",
    "entre rios": "entre rios",
    "tucuman": "tucuman",
    "tierra del fuego antartida e islas del atlantico sur": "tierra del fuego"
  };
  return aliases[normalized] || normalized;
}

function shortProvince(label) {
  const map = {
    "Buenos Aires": "Buenos Aires",
    "Capital Federal": "CABA",
    "Cordoba": "Córdoba"
  };
  return map[label] || label;
}

function renderLineChart(targetId, rows, context = "sales") {
  const total = (rows || []).reduce((sum, item) => sum + Number(item.count || 0), 0);
  document.querySelector(`#${targetId}`).innerHTML = `
    <div class="chart-box">
      ${total ? lineChartSvg(rows, context) : `<div class="empty-chart">Sin datos para este periodo.</div>`}
    </div>
  `;
  if (targetId.endsWith("ageChart")) {
    const weighted = rows.reduce((sum, item) => sum + Number(item.label || 0) * Number(item.count || 0), 0);
    document.querySelector(`#${metricTarget(context, "ageAverage")}`).textContent = total ? `Edad promedio estimada: ${Math.round(weighted / total)} anos` : "Tiendanube no envio edades en estas ordenes.";
  }
}

function openChartDialog(type) {
  if (!stats) return;
  const [contextPart, typePart] = String(type || "").includes(":") ? String(type).split(":") : ["sales", type];
  const context = contextPart || "sales";
  const chartType = typePart || type;
  const dialog = document.querySelector("#chartDialog");
  document.querySelector("#chartDialogTitle").textContent = modalTitle(chartType, context);
  document.querySelector("#chartDialogBody").innerHTML = chartModalContent(chartType, context);
  if (dialog?.showModal) dialog.showModal();
}

function modalTitle(type, context) {
  if (type === "sales") return metricConfig(context).dailyTitle;
  return chartDialogTitles[type] || "Grafico";
}

function chartModalContent(type, context = "sales") {
  const data = metricData(context);
  if (type === "sales") {
    const grouped = groupSalesForPeriod(context === "sales" ? stats.salesByDay : (data.byDay || []), stats.range.days);
    return `
      <div class="chart-box expanded-chart-box">${barChartSvg(grouped, context, { expanded: true })}</div>
      <div class="chart-caption">
        <span>${stats.range.days > 45 ? "Agrupado por semana para leer mejor los 90 dias." : metricConfig(context).dailyCaption}</span>
        <strong>${metricValue(grouped.reduce((sum, item) => sum + Number(item.count || 0), 0), context)}</strong>
      </div>
    `;
  }

  if (type === "payments") {
    return paymentContentMarkup(context, true);
  }

  if (type === "variants") {
    const activeVariant = activeVariants[context] || "colors";
    const rows = data.variants?.[activeVariant] || [];
    if (context !== "sales" && activeVariant === "all") {
      return `<div class="expanded-donut">${donutMarkup(rows, context, { compact: false })}</div>`;
    }
    return `<div class="expanded-rank-list">${pillRankMarkup(rows, context)}</div>`;
  }

  if (type === "provinces") {
    if ((activeProvinceViews[context] || "pie") === "map") return argentinaProvinceMap(data.provinces || [], context);
    return `<div class="expanded-donut">${provinceDonutMarkup(data.provinces || [], context)}</div>`;
  }

  if (type === "age") {
    const rows = (data.ages || []).map((item) => ({ label: item.label, count: item.count }));
    const total = rows.reduce((sum, item) => sum + Number(item.count || 0), 0);
    const weighted = rows.reduce((sum, item) => sum + Number(item.label || 0) * Number(item.count || 0), 0);
    return `
      <div class="chart-box expanded-chart-box">${lineChartSvg(rows, context)}</div>
      <p class="muted center">${total ? `Edad promedio estimada: ${Math.round(weighted / total)} anos` : "Sin edades cargadas"}</p>
    `;
  }

  if (type === "hour") {
    const rows = (data.hours || []).map((item) => ({ label: String(item.hour).padStart(2, "0"), count: item.count }));
    return `<div class="chart-box expanded-chart-box">${lineChartSvg(rows, context)}</div>`;
  }

  if (type === "gender") {
    return `<div class="expanded-donut">${donutMarkup(data.gender || [], context)}</div>`;
  }

  if (type === "weekdays") {
    const rows = (data.weekdays || []).map((item) => ({ label: item.label, count: item.count, title: `${item.label}: ${metricValue(item.count, context)}` }));
    return `<div class="chart-box expanded-chart-box">${barChartSvg(rows, context, { expanded: true })}</div>`;
  }

  return `<p class="muted center">Sin datos para mostrar.</p>`;
}

function openProvinceDetail(context = "sales") {
  provinceDetailPages[context] = provinceDetailPages[context] || 1;
  const dialog = document.querySelector("#chartDialog");
  document.querySelector("#chartDialogTitle").textContent = `${metricConfig(context).label} por provincia`;
  document.querySelector("#chartDialogBody").innerHTML = provinceDetailMarkup(context);
  if (dialog?.showModal && !dialog.open) dialog.showModal();
}

function provinceDetailMarkup(context = "sales") {
  const rows = metricData(context).provinces || [];
  const other = rows.find((item) => ["otros", "otras"].includes(String(item.label || "").toLowerCase()));
  const children = (other?.children || []).filter((item) => Number(item.count || 0) > 0);
  const total = rows.reduce((sum, item) => sum + Number(item.count || 0), 0) || 1;
  const pageSize = 5;
  const pageCount = Math.max(1, Math.ceil(children.length / pageSize));
  const page = Math.min(Math.max(1, provinceDetailPages[context] || 1), pageCount);
  provinceDetailPages[context] = page;
  const visible = children.slice((page - 1) * pageSize, page * pageSize);
  return `
    <div class="province-detail-modal">
      <div class="province-detail-icon">⌖</div>
      <h3>${escapeHtml(metricConfig(context).label)} por provincia</h3>
      <div class="province-detail-total">
        <span>${escapeHtml(other?.label || "otros")}</span>
        <strong>${metricValue(other?.count || 0, context)}</strong>
      </div>
      <p class="muted center">periodo: ${escapeHtml(periodLabel(currentPeriod).toLowerCase())}</p>
      <table class="mini-table province-detail-table">
        <thead><tr><th>Provincia</th><th>${escapeHtml(metricConfig(context).label)}</th><th>%</th></tr></thead>
        <tbody>
          ${visible.map((item) => `
            <tr>
              <td>${escapeHtml(item.label)}</td>
              <td><strong>${metricValue(item.count, context)}</strong></td>
              <td>${percent(item.count, total)}</td>
            </tr>
          `).join("") || `<tr><td colspan="3" class="empty-row">No hay otras provincias para mostrar.</td></tr>`}
        </tbody>
      </table>
      ${pageCount > 1 ? `
        <div class="combo-pagination province-detail-pagination">
          <span class="page-buttons">${provincePaginationButtons(pageCount, page, context)}</span>
          <select disabled><option>5 por pagina</option></select>
        </div>
      ` : ""}
    </div>
  `;
}

function provincePaginationButtons(pageCount, currentPage, context) {
  return Array.from({ length: pageCount }, (_, index) => index + 1)
    .map((page) => `<button type="button" class="${page === currentPage ? "active" : ""}" data-province-detail-page="${context}" data-page="${page}">${page}</button>`)
    .join("");
}

function groupSalesForPeriod(rows, days) {
  if (days <= 31) return rows.map((item) => ({ ...item, title: `${item.label}: ${item.count} ventas` }));

  const groupSize = days > 45 ? 7 : 3;
  const grouped = [];
  for (let index = 0; index < rows.length; index += groupSize) {
    const chunk = rows.slice(index, index + groupSize);
    if (!chunk.length) continue;
    grouped.push({
      label: chunk.length === 1 ? chunk[0].label : `${chunk[0].label}-${chunk[chunk.length - 1].label}`,
      count: chunk.reduce((sum, item) => sum + Number(item.count || 0), 0),
      revenue: chunk.reduce((sum, item) => sum + Number(item.revenue || 0), 0),
      title: `${chunk[0].label} a ${chunk[chunk.length - 1].label}: ${chunk.reduce((sum, item) => sum + Number(item.count || 0), 0)} ventas`
    });
  }
  return grouped;
}

function paymentInstallmentsChart(rows, context = "sales", expanded = false) {
  const cleanRows = (rows || []).filter((item) => Number(item.count || 0) > 0);
  if (!cleanRows.length) return `<p class="muted center">Sin datos para este periodo.</p>`;
  const width = expanded ? 900 : 520;
  const height = expanded ? 430 : 300;
  const pad = expanded
    ? { top: 34, right: 28, bottom: 54, left: 62 }
    : { top: 24, right: 16, bottom: 42, left: 42 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const max = Math.max(...cleanRows.map((item) => Number(item.count || 0)), 1);
  const step = chartW / cleanRows.length;
  const barW = Math.min(expanded ? 86 : 58, step * 0.58);
  const gradientId = `installments-${context}-${Math.random().toString(36).slice(2, 8)}`;
  const yTicks = [0, Math.ceil(max / 2), max];
  const bars = cleanRows.map((item, index) => {
    const value = Number(item.count || 0);
    const h = (value / max) * chartH;
    const x = pad.left + index * step + (step - barW) / 2;
    const y = pad.top + chartH - h;
    return `
      <g>
        <rect class="bar-svg" fill="url(#${gradientId})" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h, 3).toFixed(1)}" rx="6">
          <title>${escapeHtml(item.label)} cuota${item.label === "1" ? "" : "s"}: ${metricValue(value, context)}</title>
        </rect>
        <text class="chart-label" x="${(x + barW / 2).toFixed(1)}" y="${height - 16}" text-anchor="middle">${escapeHtml(item.label)}</text>
        <text class="chart-value" x="${(x + barW / 2).toFixed(1)}" y="${Math.max(16, y - 8).toFixed(1)}" text-anchor="middle">${metricValue(value, context)}</text>
      </g>
    `;
  }).join("");

  return `
    <svg class="installments-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Ventas por cuotas">
      <defs>
        <linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#6c3fc5"/>
          <stop offset="100%" stop-color="#1aa6a6"/>
        </linearGradient>
      </defs>
      ${yTicks.map((tick) => {
        const y = pad.top + chartH - (tick / max) * chartH;
        return `<line class="chart-grid" x1="${pad.left}" x2="${width - pad.right}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"></line>
          <text class="chart-label axis-y" x="${pad.left - 10}" y="${(y + 5).toFixed(1)}" text-anchor="end">${metricValue(tick, context)}</text>`;
      }).join("")}
      <line class="chart-axis" x1="${pad.left}" x2="${width - pad.right}" y1="${pad.top + chartH}" y2="${pad.top + chartH}"></line>
      ${bars}
    </svg>
  `;
}

function barChartSvg(rows, context = "sales", options = {}) {
  const expanded = Boolean(options.expanded);
  const width = expanded ? 1120 : 920;
  const height = expanded ? 380 : 330;
  const gradientId = `barGradient-${context}-${Math.random().toString(36).slice(2, 8)}`;
  const denseAxis = rows.length > 24;
  const pad = { top: 28, right: 24, bottom: denseAxis ? 76 : 54, left: 50 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const max = Math.max(...rows.map((item) => Number(item.count || 0)), 1);
  const step = chartW / Math.max(rows.length, 1);
  const barW = Math.max(8, Math.min(46, step * 0.58));
  const yTicks = [0, Math.ceil(max / 2), max];
  const labelEvery = axisLabelEvery(rows.length, expanded);

  const bars = rows.map((item, index) => {
    const value = Number(item.count || 0);
    const h = (value / max) * chartH;
    const x = pad.left + index * step + (step - barW) / 2;
    const y = pad.top + chartH - h;
    const showLabel = rows.length <= 16 || index === 0 || index === rows.length - 1 || index % labelEvery === 0;
    const labelX = (x + barW / 2).toFixed(1);
    const labelY = height - (denseAxis ? 28 : 22);
    const axisLabel = compactAxisLabel(item.label, rows.length);
    return `
      <g>
        <rect class="bar-svg" fill="url(#${gradientId})" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h, value ? 3 : 0).toFixed(1)}" rx="6">
          <title>${escapeHtml(item.title || `${item.label}: ${metricValue(value, context)}`)}</title>
        </rect>
        ${showLabel ? `<text class="chart-label axis-x ${denseAxis ? "dense-axis" : ""}" x="${labelX}" y="${labelY}" text-anchor="${denseAxis ? "end" : "middle"}" ${denseAxis ? `transform="rotate(-38 ${labelX} ${labelY})"` : ""}>${escapeHtml(axisLabel)}</text>` : ""}
        ${value && rows.length <= 16 ? `<text class="chart-value" x="${(x + barW / 2).toFixed(1)}" y="${Math.max(18, y - 8).toFixed(1)}" text-anchor="middle">${context === "billing" ? money(value) : value}</text>` : ""}
      </g>
    `;
  }).join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Ventas por periodo">
      <defs>
        <linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#6c3fc5"/>
          <stop offset="100%" stop-color="#1aa6a6"/>
        </linearGradient>
      </defs>
      ${yTicks.map((tick) => {
        const y = pad.top + chartH - (tick / max) * chartH;
        return `<line class="chart-grid" x1="${pad.left}" x2="${width - pad.right}" y1="${y}" y2="${y}"></line><text class="chart-label" x="${pad.left - 12}" y="${y + 4}" text-anchor="end">${context === "billing" ? money(tick) : tick}</text>`;
      }).join("")}
      <line class="chart-axis" x1="${pad.left}" x2="${width - pad.right}" y1="${pad.top + chartH}" y2="${pad.top + chartH}"></line>
      <line class="chart-axis" x1="${pad.left}" x2="${pad.left}" y1="${pad.top}" y2="${pad.top + chartH}"></line>
      ${bars}
    </svg>
  `;
}

function axisLabelEvery(length, expanded = false) {
  if (length <= 16) return 1;
  if (length <= 32) return Math.ceil(length / 10);
  return Math.ceil(length / (expanded ? 12 : 8));
}

function compactAxisLabel(label, length) {
  if (length <= 24) return label;
  return String(label || "").split("-")[0] || label;
}

function lineChartSvg(rows, context = "sales") {
  const values = rows.map((item) => Number(item.count || 0));
  const width = 430;
  const height = 330;
  const pad = { top: 22, right: 14, bottom: 54, left: 36 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const max = Math.max(...values, 1);
  const points = rows.map((item, index) => {
    const x = pad.left + (rows.length === 1 ? chartW / 2 : (index / (rows.length - 1)) * chartW);
    const y = pad.top + chartH - (Number(item.count || 0) / max) * chartH;
    return { x, y, label: item.label, count: item.count };
  });
  const line = points.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const area = `${line} L ${pad.left + chartW} ${pad.top + chartH} L ${pad.left} ${pad.top + chartH} Z`;
  const labelEvery = rows.length > 32 ? 3 : Math.max(1, Math.ceil(rows.length / 10));
  const yTicks = [0, Math.ceil(max / 2), max];

  return `
    <svg class="line-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolucion">
      ${yTicks.map((tick) => {
        const y = pad.top + chartH - (tick / max) * chartH;
        return `<line class="chart-grid" x1="${pad.left}" x2="${width - pad.right}" y1="${y}" y2="${y}"></line><text class="chart-label axis-y" x="${pad.left - 10}" y="${y + 5}" text-anchor="end">${context === "billing" ? money(tick) : tick}</text>`;
      }).join("")}
      <line class="chart-axis" x1="${pad.left}" x2="${width - pad.right}" y1="${pad.top + chartH}" y2="${pad.top + chartH}"></line>
      <line class="chart-axis" x1="${pad.left}" x2="${pad.left}" y1="${pad.top}" y2="${pad.top + chartH}"></line>
      <path class="line-area" d="${area}"></path>
      <path class="line-path" d="${line}"></path>
      ${points.map((point, index) => `
        <g>
          <circle class="line-point-svg" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${rows.length > 30 ? 4 : 5}">
            <title>${escapeHtml(point.label)}: ${metricValue(point.count, context)}</title>
          </circle>
          <g class="svg-tooltip" transform="translate(${Math.min(width - 150, Math.max(56, point.x - 55)).toFixed(1)} ${Math.max(12, point.y - 50).toFixed(1)})">
            <rect width="110" height="34" rx="7"></rect>
            <text x="55" y="14" text-anchor="middle">${escapeHtml(point.label)}</text>
            <text x="55" y="28" text-anchor="middle">${metricValue(point.count, context)}</text>
          </g>
          ${index % labelEvery === 0 ? `<text class="chart-label axis-x" x="${point.x.toFixed(1)}" y="${height - 20}" text-anchor="middle" transform="rotate(-90 ${point.x.toFixed(1)} ${height - 20})">${escapeHtml(point.label)}</text>` : ""}
        </g>
      `).join("")}
    </svg>
  `;
}

function renderProducts() {
  const rows = filteredProducts();
  const panels = ["salesProductsPanel", "productsProductsPanel", "billingProductsPanel"];
  panels.forEach((targetId) => {
    const target = document.querySelector(`#${targetId}`);
    if (target) {
      if (!target.querySelector(".products-stat-panel")) {
        target.innerHTML = productTableMarkup(rows);
      } else {
        updateProductTable(rows, target);
      }
    }
  });
  bindProductTableEvents();
}

function filteredProducts() {
  return stats.products.filter((item) => {
    const matchesSearch = normalize(item.label).includes(normalize(productQuery));
    const hasSales = Number(item.sold || 0) > 0;
    return matchesSearch && (showProductsWithoutSales || hasSales);
  });
}

function productTableMarkup(rows) {
  const allRows = stats.products || [];
  const periodTotalSold = allRows.reduce((sum, item) => sum + Number(item.sold || 0), 0);
  const periodTotalRevenue = allRows.reduce((sum, item) => sum + Number(item.revenue || 0), 0);
  const totalSold = rows.reduce((sum, item) => sum + Number(item.sold || 0), 0);
  const totalRevenue = rows.reduce((sum, item) => sum + Number(item.revenue || 0), 0);
  const finiteStockRows = rows.filter((item) => Number.isFinite(Number(item.stock)));
  const stockTotal = finiteStockRows.reduce((sum, item) => sum + Number(item.stock || 0), 0);
  const stockDaysRows = rows.filter((item) => Number.isFinite(Number(item.stockDays)));
  const averageStockDays = stockDaysRows.length ? stockDaysRows.reduce((sum, item) => sum + Number(item.stockDays || 0), 0) / stockDaysRows.length : 0;
  const salesSpeed = stats.range?.days ? totalSold / stats.range.days : 0;
  const pageCount = Math.max(1, Math.ceil(rows.length / productPageSize));
  productPage = Math.min(productPage, pageCount);
  const start = (productPage - 1) * productPageSize;
  const visibleRows = rows.slice(start, start + productPageSize);

  return `
    <article class="panel table-panel products-stat-panel">
      <div class="panel-title"><span>◇</span><h2>Productos</h2></div>
      <p class="panel-subtitle">Estadisticas de productos vendidos en el periodo elegido:</p>
      <div class="table-actions">
        <input class="product-search" value="${escapeHtml(productQuery)}" placeholder="Buscar producto">
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Vendidos</th>
              <th>Stock actual</th>
              <th>Dias restantes de stock</th>
              <th>Velocidad de venta<br><small>(vendidos por dia)</small></th>
              <th>Facturacion</th>
            </tr>
          </thead>
          <tbody class="product-table-body">
            ${productRowsMarkup(visibleRows, periodTotalSold, periodTotalRevenue)}
          </tbody>
        </table>
      </div>
      <div class="table-pagination product-table-pagination">
        ${productPaginationMarkup(rows, start, pageCount)}
      </div>
      <p class="totals">
        Totales tabla: Vendidos: <strong>${number(totalSold)}</strong> -
        Stock actual: <strong>${number(stockTotal)}</strong> -
        Dias restantes de stock (promedio): <strong>${number(averageStockDays)}</strong> -
        Velocidad de venta (promedio): <strong>${number(salesSpeed)}</strong> -
        Facturacion: <strong>${money(totalRevenue)}</strong> <span class="muted">(${percent(totalRevenue, periodTotalRevenue)})</span> -
        Los productos con stock infinito no se consideran para el calculo de los totales.
      </p>
      <div class="product-definitions">
        <p class="table-note">(1) Stock actual: ultima actualizacion: hace unos segundos</p>
        <p class="table-note">(2) Dias restantes de stock: <span class="definition-detail" hidden>estima en cuantos dias se agotaria el stock actual en base a cuantas unidades se vendieron por dia en el periodo seleccionado. Cuenta desde la fecha de la primera venta dentro del periodo. </span><button class="inline-definition" type="button" data-toggle-definition="stockDays">ver definicion</button></p>
        <p class="table-note">(3) Velocidad de venta: <span class="definition-detail" hidden>promedio de unidades vendidas por dia en el periodo seleccionado. Cuenta desde la fecha de la primera venta dentro del periodo. Si el producto ya no tiene stock cuenta hasta la fecha de la ultima venta dentro del periodo. </span><button class="inline-definition" type="button" data-toggle-definition="salesSpeed">ver definicion</button></p>
      </div>
    </article>
  `;
}

function updateProductTable(rows, target) {
  const allRows = stats.products || [];
  const periodTotalSold = allRows.reduce((sum, item) => sum + Number(item.sold || 0), 0);
  const periodTotalRevenue = allRows.reduce((sum, item) => sum + Number(item.revenue || 0), 0);
  const totalSold = rows.reduce((sum, item) => sum + Number(item.sold || 0), 0);
  const totalRevenue = rows.reduce((sum, item) => sum + Number(item.revenue || 0), 0);
  const finiteStockRows = rows.filter((item) => Number.isFinite(Number(item.stock)));
  const stockTotal = finiteStockRows.reduce((sum, item) => sum + Number(item.stock || 0), 0);
  const stockDaysRows = rows.filter((item) => Number.isFinite(Number(item.stockDays)));
  const averageStockDays = stockDaysRows.length ? stockDaysRows.reduce((sum, item) => sum + Number(item.stockDays || 0), 0) / stockDaysRows.length : 0;
  const salesSpeed = stats.range?.days ? totalSold / stats.range.days : 0;
  const pageCount = Math.max(1, Math.ceil(rows.length / productPageSize));
  productPage = Math.min(productPage, pageCount);
  const start = (productPage - 1) * productPageSize;
  const visibleRows = rows.slice(start, start + productPageSize);
  const body = target.querySelector(".product-table-body");
  if (body) body.innerHTML = productRowsMarkup(visibleRows, periodTotalSold, periodTotalRevenue);
  const pagination = target.querySelector(".product-table-pagination");
  if (pagination) pagination.innerHTML = productPaginationMarkup(rows, start, pageCount);
  const totals = target.querySelector(".totals");
  if (totals) {
    totals.innerHTML = `
      Totales tabla: Vendidos: <strong>${number(totalSold)}</strong> -
      Stock actual: <strong>${number(stockTotal)}</strong> -
      Dias restantes de stock (promedio): <strong>${number(averageStockDays)}</strong> -
      Velocidad de venta (promedio): <strong>${number(salesSpeed)}</strong> -
      Facturacion: <strong>${money(totalRevenue)}</strong> <span class="muted">(${percent(totalRevenue, periodTotalRevenue)})</span> -
      Los productos con stock infinito no se consideran para el calculo de los totales.
    `;
  }
}

function productRowsMarkup(visibleRows, periodTotalSold, periodTotalRevenue) {
  return visibleRows.map((item) => `
    <tr>
      <td>
        <div class="product-cell">
          <button class="row-more" type="button" data-product-expand="${escapeHtml(item.label)}" aria-label="Ver detalle">${expandedProducts.has(item.label) ? "-" : "+"}</button>
          <span class="product-thumb">${item.image ? `<img src="${escapeHtml(item.image)}" alt="">` : ""}</span>
          <span>${escapeHtml(item.label)}</span>
        </div>
      </td>
      <td><strong>${number(item.sold)}</strong> <span class="muted">(${percent(item.sold, periodTotalSold)})</span></td>
      <td>${escapeHtml(String(item.stock))}</td>
      <td>${escapeHtml(String(item.stockDays))}</td>
      <td>${number(item.speed)}</td>
      <td>${money(item.revenue)} <span class="muted">(${percent(item.revenue, periodTotalRevenue)})</span></td>
    </tr>
    ${expandedProducts.has(item.label) ? productVariantRows(item, periodTotalSold, periodTotalRevenue) : ""}
  `).join("") || `<tr><td colspan="6" class="empty-row">Sin productos para este filtro.</td></tr>`;
}

function productPaginationMarkup(rows, start, pageCount) {
  return `
    <span>mostrando resultados ${rows.length ? start + 1 : 0} a ${Math.min(start + productPageSize, rows.length)} de ${rows.length}</span>
    <div class="page-buttons">
      ${paginationButtons(pageCount)}
    </div>
    <select class="product-page-size">
      ${[5, 10, 20].map((size) => `<option value="${size}" ${size === productPageSize ? "selected" : ""}>${size} por pagina</option>`).join("")}
    </select>
  `;
}

function paginationButtons(pageCount) {
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
  const visible = pages.filter((page) => page <= 5 || page === pageCount || Math.abs(page - productPage) <= 1);
  const pieces = [];
  visible.forEach((page, index) => {
    if (index && page - visible[index - 1] > 1) pieces.push(`<span class="page-gap">...</span>`);
    pieces.push(`<button type="button" class="${page === productPage ? "active" : ""}" data-product-page="${page}">${page}</button>`);
  });
  return pieces.join("");
}

function productVariantRows(item, totalSold, totalRevenue) {
  const variants = Array.isArray(item.variants) ? item.variants : [];
  if (!variants.length) {
    return `<tr class="product-detail-row"><td colspan="6" class="empty-row">Sin detalle de variantes para este producto.</td></tr>`;
  }
  return variants.map((variant) => `
    <tr class="product-detail-row variant-row">
      <td>
        <div class="product-cell product-cell-detail">
          <span></span>
          <span class="product-thumb small-thumb">${variant.image ? `<img src="${escapeHtml(variant.image)}" alt="">` : ""}</span>
          <span>${escapeHtml(variant.label)}</span>
        </div>
      </td>
      <td><strong>${number(variant.sold)}</strong> <span class="muted">(${percent(variant.sold, totalSold)})</span></td>
      <td>${escapeHtml(String(variant.stock))}</td>
      <td></td>
      <td></td>
      <td>${money(variant.revenue)} <span class="muted">(${percent(variant.revenue, totalRevenue)})</span></td>
    </tr>
    ${(variant.sizes || []).map((size) => `
      <tr class="product-detail-row size-row">
        <td>
          <div class="product-size-cell">
            <span>Talle ${escapeHtml(size.label)}</span>
          </div>
        </td>
        <td>${number(size.sold)}</td>
        <td>${escapeHtml(String(size.stock))}</td>
        <td></td>
        <td></td>
        <td>${money(size.revenue)}</td>
      </tr>
    `).join("")}
  `).join("");
}

function bindProductTableEvents() {
  document.querySelectorAll(".product-search").forEach((input) => {
    input.oninput = (event) => {
      productQuery = event.target.value;
      productPage = 1;
      renderProducts();
    };
  });
  document.querySelectorAll("[data-product-page]").forEach((button) => {
    button.addEventListener("click", () => {
      productPage = Number(button.dataset.productPage);
      renderProducts();
    });
  });
  document.querySelectorAll(".product-page-size").forEach((select) => {
    select.addEventListener("change", (event) => {
      productPageSize = Number(event.target.value);
      productPage = 1;
      renderProducts();
    });
  });
  document.querySelectorAll("[data-toggle-empty-products]").forEach((button) => {
    button.addEventListener("click", () => {
      showProductsWithoutSales = !showProductsWithoutSales;
      productPage = 1;
      renderProducts();
    });
  });
  document.querySelectorAll("[data-product-expand]").forEach((button) => {
    button.addEventListener("click", () => {
      const label = button.dataset.productExpand;
      if (expandedProducts.has(label)) expandedProducts.delete(label);
      else expandedProducts.add(label);
      renderProducts();
    });
  });
  document.querySelectorAll("[data-toggle-definition]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const note = button.closest(".table-note");
      if (!note) return;
      const detail = note.querySelector(".definition-detail");
      if (!detail) return;
      detail.hidden = !detail.hidden;
      button.textContent = detail.hidden ? "ver definicion" : "ver menos";
    });
  });
}

function renderBilling() {
  const billingTotal = document.querySelector("#billingTotal");
  if (!billingTotal) return;
  billingTotal.textContent = money(stats.billing.totalToInvoice);
  document.querySelector("#billingPending").textContent = number(stats.billing.pending);
  document.querySelector("#averageTicket").textContent = money(stats.summary.averageTicket);
}

function renderCarts() {
  if (!document.querySelector("#cartTotal")) return;
  document.querySelector("#cartTotal").textContent = number(stats.summary.abandonedCarts);
  document.querySelector("#cartRecovered").textContent = number(stats.summary.recoveredCarts);
  document.querySelector("#cartRate").textContent = `${number(stats.summary.recoveryRate)}%`;
  document.querySelector("#cartRows").innerHTML = stats.abandonedCarts.slice(0, 12).map((cart) => `
    <tr>
      <td>${new Date(cart.created_at).toLocaleDateString("es-AR")}</td>
      <td>${escapeHtml(cart.customer_email || "sin email")}</td>
      <td>${number(cart.items)}</td>
      <td>${money(cart.total)}</td>
      <td>${cart.recovered ? "recuperado" : "pendiente"}</td>
    </tr>
  `).join("");
}

function showView(view) {
  currentView = view;
  document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active", section.id === `view-${view}`));
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  updateExportLinks();
}

function exportQuery() {
  return `period=${encodeURIComponent(currentPeriod)}&view=${encodeURIComponent(currentView)}`;
}

function updateExportLinks() {
  document.querySelector("#exportExcel")?.setAttribute("href", `/api/export.xls?${exportQuery()}`);
  document.querySelector("#exportPdf")?.setAttribute("href", `/api/export.pdf?${exportQuery()}`);
}

function filenameFromDisposition(disposition, fallback) {
  const match = String(disposition || "").match(/filename\*=UTF-8''([^;]+)|filename="?([^"]+)"?/i);
  return decodeURIComponent(match?.[1] || match?.[2] || fallback);
}

async function downloadExport(event, type) {
  event.preventDefault();
  updateExportLinks();
  const link = event.currentTarget;
  const originalLabel = link.querySelector("span")?.textContent || "";
  const label = link.querySelector("span");
  link.classList.add("loading");
  link.setAttribute("aria-busy", "true");
  if (label) label.textContent = type === "excel" ? "Preparando Excel..." : "Preparando PDF...";
  setLoading(true, type === "excel" ? "Preparando Excel..." : "Preparando PDF...");
  try {
    const response = await fetch(link.href, { cache: "no-store" });
    if (!response.ok) throw new Error("No se pudo preparar el archivo.");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const download = document.createElement("a");
    download.href = url;
    download.download = filenameFromDisposition(response.headers.get("content-disposition"), type === "excel" ? "estadisticas.xls" : "estadisticas.pdf");
    document.body.appendChild(download);
    download.click();
    download.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (error) {
    alert(error.message || "No se pudo exportar el archivo.");
  } finally {
    link.classList.remove("loading");
    link.removeAttribute("aria-busy");
    if (label) label.textContent = originalLabel;
    setLoading(false);
  }
}

function periodLabel(value) {
  if (periodLabels[value]) return periodLabels[value];
  if (value.startsWith("custom:")) {
    const [, from, to] = value.split(":");
    return `${formatDateLabel(from)} a ${formatDateLabel(to)}`;
  }
  return "Periodo personalizado";
}

function selectPeriod(value) {
  if (compareMode) {
    if (periodTarget === 2) {
      comparePeriod2 = value;
    } else {
      comparePeriod1 = value;
      currentPeriod = value;
    }
  } else {
    currentPeriod = value;
    comparePeriod1 = value;
  }
  document.querySelectorAll("[data-period-option]").forEach((button) => {
    button.classList.toggle("active", button.dataset.periodOption === value);
  });
  document.querySelector("#customDatePanel").hidden = true;
  document.querySelector("#periodModal")?.close();
  loadStats();
}

function openCustomPeriod() {
  const panel = document.querySelector("#customDatePanel");
  panel.hidden = !panel.hidden;
  validateCustomPeriod();
}

function applyCustomPeriod() {
  const from = document.querySelector("#customFrom").value;
  const to = document.querySelector("#customTo").value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return;
  if (from > to) return;
  selectPeriod(`custom:${from}:${to}`);
}

function validateCustomPeriod() {
  const from = document.querySelector("#customFrom").value;
  const to = document.querySelector("#customTo").value;
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  document.querySelector("#applyCustomPeriod").disabled = !valid;
}

function formatDateLabel(value) {
  const [year, month, day] = String(value || "").split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

document.querySelector("#refresh").addEventListener("click", () => loadStats(true));
document.querySelector("#exportButton").addEventListener("click", () => {
  updateExportLinks();
  const modal = document.querySelector("#exportDialog");
  if (modal?.showModal) modal.showModal();
});
document.querySelector("#exportExcel")?.addEventListener("click", (event) => downloadExport(event, "excel"));
document.querySelector("#closeExportDialog").addEventListener("click", () => {
  document.querySelector("#exportDialog").close();
});
document.querySelector("#exportDialog").addEventListener("click", (event) => {
  if (event.target.id === "exportDialog") event.target.close();
});
function openPeriodPicker(target = 1) {
  periodTarget = target;
  const modal = document.querySelector("#periodModal");
  document.querySelectorAll("[data-period-option]").forEach((button) => {
    const value = target === 2 ? comparePeriod2 : (compareMode ? comparePeriod1 : currentPeriod);
    button.classList.toggle("active", button.dataset.periodOption === value);
  });
  if (modal?.showModal) modal.showModal();
}

function toggleCompareMode() {
  compareMode = !compareMode;
  comparePeriod1 = currentPeriod;
  if (!compareMode) comparePeriod2 = "";
  loadStats();
}

document.querySelector("#openPeriodModal").addEventListener("click", () => {
  openPeriodPicker(1);
});
document.querySelector("#openComparePeriodModal").addEventListener("click", () => {
  openPeriodPicker(2);
});
document.querySelector(".compare")?.addEventListener("click", toggleCompareMode);
document.querySelector("#periodModal").addEventListener("click", (event) => {
  if (event.target.id === "periodModal") event.target.close();
});
document.querySelectorAll("[data-period-option]").forEach((button) => {
  button.addEventListener("click", () => selectPeriod(button.dataset.periodOption));
});
document.querySelector("#customPeriod").addEventListener("click", openCustomPeriod);
document.querySelector("#applyCustomPeriod").addEventListener("click", applyCustomPeriod);
document.querySelector("#customFrom").addEventListener("input", validateCustomPeriod);
document.querySelector("#customTo").addEventListener("input", validateCustomPeriod);
document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.view));
});
document.addEventListener("click", (event) => {
  if (event.target.closest("[data-open-compare-period]")) {
    openPeriodPicker(2);
    return;
  }

  const paymentButton = event.target.closest("[data-payment-view]");
  if (paymentButton) {
    const context = paymentButton.dataset.metricContext || "sales";
    activePayments[context] = paymentButton.dataset.paymentView;
    renderPaymentPanel(context);
    return;
  }

  const variantButton = event.target.closest("[data-variant]");
  if (variantButton) {
    const context = variantButton.dataset.metricContext || "sales";
    activeVariants[context] = variantButton.dataset.variant;
    renderVariants(context);
    return;
  }

  const provinceButton = event.target.closest("[data-province-view]");
  if (provinceButton) {
    const context = provinceButton.dataset.metricContext || "sales";
    activeProvinceViews[context] = provinceButton.dataset.provinceView;
    renderProvinceChart(context);
    return;
  }

  const provinceDetailButton = event.target.closest("[data-province-detail]");
  if (provinceDetailButton) {
    openProvinceDetail(provinceDetailButton.dataset.provinceDetail || "sales");
    return;
  }

  const provincePageButton = event.target.closest("[data-province-detail-page]");
  if (provincePageButton) {
    const context = provincePageButton.dataset.provinceDetailPage || "sales";
    provinceDetailPages[context] = Number(provincePageButton.dataset.page || 1);
    document.querySelector("#chartDialogBody").innerHTML = provinceDetailMarkup(context);
    return;
  }

  const comboPageButton = event.target.closest("[data-combo-page]");
  if (comboPageButton) {
    const context = comboPageButton.dataset.metricContext || "sales";
    comboPages[context] = Number(comboPageButton.dataset.comboPage || 1);
    renderCombosPanel(context);
    return;
  }

  if (event.target.closest("[data-combo-help]")) {
    openComboHelp();
    return;
  }

  const expandButton = event.target.closest("[data-expand-chart]");
  if (expandButton) {
    openChartDialog(expandButton.dataset.expandChart);
  }
});
document.querySelector("#closeChartDialog").addEventListener("click", () => {
  document.querySelector("#chartDialog").close();
});
document.querySelector("#chartDialog").addEventListener("click", (event) => {
  if (event.target.id === "chartDialog") event.target.close();
});

loadStats();
