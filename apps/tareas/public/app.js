const STORAGE_KEY = "incognito-task-manager-v2";
const OLD_STORAGE_KEY = "incognito-task-manager-v1";

const statuses = [
  { id: "pending", label: "Pendiente" },
  { id: "progress", label: "En curso" },
  { id: "blocked", label: "Bloqueada" },
  { id: "done", label: "Lista" }
];

const priorities = [
  { id: "high", label: "Alta" },
  { id: "medium", label: "Media" },
  { id: "low", label: "Baja" }
];

const frequencies = [
  { id: "daily", label: "Todos los dias" },
  { id: "weekdays", label: "Lunes a viernes" },
  { id: "weekly", label: "Semanal" },
  { id: "biweekly", label: "Cada 2 semanas" },
  { id: "monthly", label: "Mensual" },
  { id: "custom", label: "Personalizada" }
];

const weekdays = [
  { id: "1", label: "Lunes" },
  { id: "2", label: "Martes" },
  { id: "3", label: "Miercoles" },
  { id: "4", label: "Jueves" },
  { id: "5", label: "Viernes" },
  { id: "6", label: "Sabado" },
  { id: "0", label: "Domingo" }
];

const areas = [
  "Compras",
  "Contabilidad y Finanzas",
  "General",
  "Marketing",
  "Operaciones",
  "Ventas"
];

const defaultState = {
  view: "planner",
  selectedPerson: "mariano",
  hideDoneList: true,
  calendarMonth: todayISO().slice(0, 7),
  people: [
    { id: "mariano", name: "Mariano", email: "" },
    { id: "facu", name: "Facu", email: "" }
  ],
  tasks: [
    {
      id: crypto.randomUUID(),
      title: "Cargar tareas reales del equipo",
      assignee: "equipo",
      status: "pending",
      priority: "high",
      dueDate: todayISO(),
      area: "General",
      notes: "Reemplazar estos ejemplos por el flujo real de trabajo.",
      createdAt: new Date().toISOString()
    },
    {
      id: crypto.randomUUID(),
      title: "Revisar pendientes de ventas",
      assignee: "mariano",
      status: "progress",
      priority: "medium",
      dueDate: "",
      area: "Ventas",
      notes: "Agrupar lo que esta trabado y marcar responsables.",
      createdAt: new Date().toISOString()
    }
  ],
  recurring: [
    {
      id: crypto.randomUUID(),
      title: "Mandar codigos",
      assignee: "equipo",
      frequency: "daily",
      nextDate: todayISO(),
      priority: "high",
      area: "Ventas",
      notes: "Tarea diaria programada.",
      active: true,
      createdAt: new Date().toISOString()
    },
    {
      id: crypto.randomUUID(),
      title: "Preparar informe semanal",
      assignee: "facu",
      frequency: "weekly",
      weekday: "1",
      nextDate: nextWeekISO(),
      priority: "medium",
      area: "General",
      notes: "Resumen de pendientes, avances y bloqueos.",
      active: true,
      createdAt: new Date().toISOString()
    }
  ]
};

let state = loadState();
ensureSelectedPerson();
ensureCalendarMonth();
let apiOnline = false;
let filters = {
  query: "",
  assignee: "all",
  status: "all",
  priority: "all"
};

const els = {
  plannerTab: document.querySelector("#plannerTab"),
  myListTab: document.querySelector("#myListTab"),
  calendarTab: document.querySelector("#calendarTab"),
  recurringTab: document.querySelector("#recurringTab"),
  teamTab: document.querySelector("#teamTab"),
  plannerView: document.querySelector("#plannerView"),
  listView: document.querySelector("#listView"),
  calendarView: document.querySelector("#calendarView"),
  recurringView: document.querySelector("#recurringView"),
  teamView: document.querySelector("#teamView"),
  pendingCount: document.querySelector("#pendingCount"),
  progressCount: document.querySelector("#progressCount"),
  overdueCount: document.querySelector("#overdueCount"),
  recurringCount: document.querySelector("#recurringCount"),
  searchInput: document.querySelector("#searchInput"),
  assigneeFilter: document.querySelector("#assigneeFilter"),
  statusFilter: document.querySelector("#statusFilter"),
  priorityFilter: document.querySelector("#priorityFilter"),
  clearFiltersBtn: document.querySelector("#clearFiltersBtn"),
  peopleList: document.querySelector("#peopleList"),
  personNameInput: document.querySelector("#personNameInput"),
  personEmailInput: document.querySelector("#personEmailInput"),
  savePersonBtn: document.querySelector("#savePersonBtn"),
  sendNotificationBtn: document.querySelector("#sendNotificationBtn"),
  notificationStatus: document.querySelector("#notificationStatus"),
  listPersonSelect: document.querySelector("#listPersonSelect"),
  hideDoneList: document.querySelector("#hideDoneList"),
  listTitle: document.querySelector("#listTitle"),
  listSummary: document.querySelector("#listSummary"),
  taskTableBody: document.querySelector("#taskTableBody"),
  calendarTitle: document.querySelector("#calendarTitle"),
  calendarGrid: document.querySelector("#calendarGrid"),
  prevMonthBtn: document.querySelector("#prevMonthBtn"),
  todayMonthBtn: document.querySelector("#todayMonthBtn"),
  nextMonthBtn: document.querySelector("#nextMonthBtn"),
  newTaskBtn: document.querySelector("#newTaskBtn"),
  taskDialog: document.querySelector("#taskDialog"),
  taskForm: document.querySelector("#taskForm"),
  dialogTitle: document.querySelector("#dialogTitle"),
  closeDialogBtn: document.querySelector("#closeDialogBtn"),
  cancelTaskBtn: document.querySelector("#cancelTaskBtn"),
  deleteTaskBtn: document.querySelector("#deleteTaskBtn"),
  taskId: document.querySelector("#taskId"),
  taskTitle: document.querySelector("#taskTitle"),
  taskAssignee: document.querySelector("#taskAssignee"),
  taskStatus: document.querySelector("#taskStatus"),
  taskPriority: document.querySelector("#taskPriority"),
  taskDueDate: document.querySelector("#taskDueDate"),
  taskArea: document.querySelector("#taskArea"),
  taskNotes: document.querySelector("#taskNotes"),
  newRecurringBtn: document.querySelector("#newRecurringBtn"),
  recurringList: document.querySelector("#recurringList"),
  recurringDialog: document.querySelector("#recurringDialog"),
  recurringForm: document.querySelector("#recurringForm"),
  recurringDialogTitle: document.querySelector("#recurringDialogTitle"),
  closeRecurringDialogBtn: document.querySelector("#closeRecurringDialogBtn"),
  cancelRecurringBtn: document.querySelector("#cancelRecurringBtn"),
  deleteRecurringBtn: document.querySelector("#deleteRecurringBtn"),
  recurringId: document.querySelector("#recurringId"),
  recurringTitle: document.querySelector("#recurringTitle"),
  recurringAssignee: document.querySelector("#recurringAssignee"),
  recurringFrequency: document.querySelector("#recurringFrequency"),
  recurringWeekdayField: document.querySelector("#recurringWeekdayField"),
  recurringWeekday: document.querySelector("#recurringWeekday"),
  recurringWeekdays: document.querySelector("#recurringWeekdays"),
  recurringNextDate: document.querySelector("#recurringNextDate"),
  recurringPriority: document.querySelector("#recurringPriority"),
  recurringArea: document.querySelector("#recurringArea"),
  recurringNotes: document.querySelector("#recurringNotes"),
  exportBtn: document.querySelector("#exportBtn"),
  importInput: document.querySelector("#importInput"),
  toast: document.querySelector("#toast")
};

initializeApp();

async function initializeApp() {
  try {
    await refreshFromApi();
    apiOnline = true;
  } catch (error) {
    console.warn("La API no esta disponible, uso datos locales.", error);
    generateDueRecurringTasks();
  }
  render();
}

async function apiFetch(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    let message = `Error ${response.status}`;
    try {
      const data = await response.json();
      message = data.error || message;
    } catch {}
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function refreshFromApi() {
  const remote = await apiFetch("api/bootstrap");
  state = {
    ...state,
    people: normalizePeople(remote.people || []),
    tasks: normalizeTasks(remote.tasks || []),
    recurring: normalizeRecurring(remote.recurring || [])
  };
  ensureSelectedPerson();
  ensureCalendarMonth();
}

async function syncAfterRemoteChange(message) {
  await refreshFromApi();
  render();
  if (message) showToast(message);
}

function handleRemoteError(error) {
  console.error(error);
  showToast(error.message || "No pude guardar el cambio.");
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(OLD_STORAGE_KEY);
  if (!saved) return structuredClone(defaultState);

  try {
    const parsed = JSON.parse(saved);
    return {
      view: ["planner", "list", "calendar", "recurring", "team"].includes(parsed.view) ? parsed.view : "planner",
      selectedPerson: parsed.selectedPerson || parsed.people?.[0]?.id || defaultState.selectedPerson,
      hideDoneList: parsed.hideDoneList !== false,
      calendarMonth: parsed.calendarMonth || todayISO().slice(0, 7),
      people: normalizePeople(Array.isArray(parsed.people) ? parsed.people : defaultState.people),
      tasks: normalizeTasks(Array.isArray(parsed.tasks) ? parsed.tasks : defaultState.tasks),
      recurring: normalizeRecurring(Array.isArray(parsed.recurring) ? parsed.recurring : defaultState.recurring)
    };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizePeople(people) {
  return people
    .filter((person) => person.id !== "equipo")
    .map((person) => ({
      id: person.id,
      name: person.name,
      email: person.email || ""
    }));
}

function normalizeTasks(tasks) {
  return tasks.map((task) => ({
    ...task,
    assignee: task.assignee === "equipo" ? "" : task.assignee,
    area: normalizeArea(task.area)
  }));
}

function normalizeRecurring(items) {
  return items.map((item) => ({
    ...item,
    assignee: item.assignee === "equipo" ? "__team__" : item.assignee,
    weekday: String(item.weekday ?? "1"),
    weekdays: normalizeWeekdays(item.weekdays, item.weekday),
    area: normalizeArea(item.area)
  }));
}

function normalizeArea(area) {
  return areas.includes(area) ? area : "General";
}

function ensureSelectedPerson() {
  if (state.people.some((person) => person.id === state.selectedPerson)) return;
  state.selectedPerson = state.people[0]?.id || "";
}

function ensureCalendarMonth() {
  if (/^\d{4}-\d{2}$/.test(state.calendarMonth || "")) return;
  state.calendarMonth = todayISO().slice(0, 7);
}

function render() {
  renderTabs();
  renderSelects();
  renderPeople();
  renderSummary();
  renderPlanner();
  renderPersonalList();
  renderCalendar();
  renderRecurring();
  saveState();
}

function renderTabs() {
  const tabs = [els.plannerTab, els.myListTab, els.calendarTab, els.recurringTab, els.teamTab];
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === state.view));
  els.plannerView.hidden = state.view !== "planner";
  els.listView.hidden = state.view !== "list";
  els.calendarView.hidden = state.view !== "calendar";
  els.recurringView.hidden = state.view !== "recurring";
  els.teamView.hidden = state.view !== "team";
}

function renderSelects() {
  els.assigneeFilter.innerHTML = optionList(state.people, filters.assignee, "Todos");
  els.statusFilter.innerHTML = optionList(statuses, filters.status, "Todos");
  els.priorityFilter.innerHTML = optionList(priorities, filters.priority, "Todas");

  const peopleOptions = state.people.map((person) => `<option value="${person.id}">${escapeHtml(person.name)}</option>`).join("");
  const assigneeOptions = `<option value="">Sin asignar</option><option value="__team__">Equipo completo</option>${peopleOptions}`;
  els.taskAssignee.innerHTML = assigneeOptions;
  els.recurringAssignee.innerHTML = assigneeOptions;
  els.listPersonSelect.innerHTML = peopleOptions;

  if (!state.people.some((person) => person.id === state.selectedPerson)) {
    ensureSelectedPerson();
  }
  els.listPersonSelect.value = state.selectedPerson;

  els.taskStatus.innerHTML = statuses.map((status) => `<option value="${status.id}">${status.label}</option>`).join("");
  els.taskPriority.innerHTML = priorities.map((priority) => `<option value="${priority.id}">${priority.label}</option>`).join("");
  els.recurringPriority.innerHTML = priorities.map((priority) => `<option value="${priority.id}">${priority.label}</option>`).join("");
  els.taskArea.innerHTML = areas.map((area) => `<option value="${area}">${area}</option>`).join("");
  els.recurringArea.innerHTML = areas.map((area) => `<option value="${area}">${area}</option>`).join("");
}

function optionList(items, selected, allLabel) {
  return [
    `<option value="all">${allLabel}</option>`,
    ...items.map((item) => `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${escapeHtml(item.name || item.label)}</option>`)
  ].join("");
}

function renderPeople() {
  els.peopleList.innerHTML = state.people.map((person) => {
    const activeCount = state.tasks.filter((task) => task.assignee === person.id && task.status !== "done").length;
    return `
      <div class="person-row">
        <div>
          <strong>${escapeHtml(person.name)}</strong>
          <span>${activeCount} activas</span>
          ${person.email ? `<small>${escapeHtml(person.email)}</small>` : `<small>Sin email</small>`}
        </div>
        <button class="icon-button" type="button" title="Quitar" aria-label="Quitar ${escapeHtml(person.name)}" data-remove-person="${person.id}">x</button>
      </div>
    `;
  }).join("");
}

function renderSummary() {
  els.pendingCount.textContent = state.tasks.filter((task) => task.status === "pending").length;
  els.progressCount.textContent = state.tasks.filter((task) => task.status === "progress").length;
  els.overdueCount.textContent = state.tasks.filter((task) => isOverdue(task)).length;
  els.recurringCount.textContent = state.recurring.filter((item) => item.active !== false).length;
}

function renderPlanner() {
  const visibleTasks = filteredTasks();
  els.plannerView.innerHTML = statuses.map((status) => {
    const tasks = visibleTasks.filter((task) => task.status === status.id).sort(sortByPriorityAndDueDate);
    return `
      <article class="planner-column" data-status="${status.id}">
        <div class="column-header">
          <h2>${status.label}</h2>
          <span class="count-badge">${tasks.length}</span>
        </div>
        <div class="task-list">
          ${tasks.length ? tasks.map(taskCard).join("") : `<p class="empty-state">Sin tareas.</p>`}
        </div>
      </article>
    `;
  }).join("");
}

function renderPersonalList() {
  const person = state.people.find((item) => item.id === state.selectedPerson);
  const tasks = filteredTasks({ ignoreAssignee: true })
    .filter((task) => task.assignee === state.selectedPerson)
    .filter((task) => !state.hideDoneList || task.status !== "done")
    .sort(sortByDueDate);
  const overdueCount = tasks.filter((task) => isOverdue(task)).length;

  els.hideDoneList.checked = state.hideDoneList;
  els.listTitle.textContent = person ? `Lista de ${person.name}` : "Mi lista";
  els.listSummary.textContent = `${tasks.length} tareas visibles${overdueCount ? `, ${overdueCount} vencidas` : ""}.`;

  els.taskTableBody.innerHTML = tasks.length ? tasks.map((task) => {
    const status = statuses.find((item) => item.id === task.status);
    const priority = priorities.find((item) => item.id === task.priority);
    return `
      <tr data-task-id="${task.id}">
        <td>
          <strong>${escapeHtml(task.title)}</strong>
          <small>${escapeHtml(task.notes || "")}</small>
        </td>
        <td>
          <select class="inline-status" data-list-status-task="${task.id}">
            ${statuses.map((item) => `<option value="${item.id}" ${item.id === task.status ? "selected" : ""}>${item.label}</option>`).join("")}
          </select>
        </td>
        <td><span class="badge priority-${task.priority}">${priority?.label || ""}</span></td>
        <td>${escapeHtml(task.area || "-")}</td>
        <td><span class="due ${isOverdue(task) ? "overdue" : ""}">${task.dueDate ? formatDate(task.dueDate) : "Sin fecha"}</span></td>
      </tr>
    `;
  }).join("") : `
    <tr>
      <td colspan="5" class="empty-state">No hay tareas para esta persona con los filtros actuales.</td>
    </tr>
  `;
}

function renderCalendar() {
  const [year, month] = state.calendarMonth.split("-").map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const startDate = new Date(firstDay);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  startDate.setDate(firstDay.getDate() - mondayOffset);

  els.calendarTitle.textContent = new Intl.DateTimeFormat("es-AR", {
    month: "long",
    year: "numeric"
  }).format(firstDay);

  const tasksByDate = [...filteredTasks(), ...projectRecurringForCalendar(startDate)].reduce((map, task) => {
    if (!task.dueDate) return map;
    if (!map[task.dueDate]) map[task.dueDate] = [];
    map[task.dueDate].push(task);
    return map;
  }, {});

  const weekdays = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];
  const cells = weekdays.map((day) => `<div class="calendar-weekday">${day}</div>`);

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    const iso = toISODate(date);
    const dayTasks = (tasksByDate[iso] || []).sort(sortByPriorityAndDueDate);
    const visibleTasks = dayTasks.slice(0, 3);
    const outside = date.getMonth() !== month - 1;
    cells.push(`
      <div class="calendar-day ${outside ? "outside" : ""}">
        <span class="calendar-date">${date.getDate()}</span>
        ${visibleTasks.map((task) => calendarEvent(task)).join("")}
        ${dayTasks.length > visibleTasks.length ? `<span class="calendar-more">+${dayTasks.length - visibleTasks.length} mas</span>` : ""}
      </div>
    `);
  }

  els.calendarGrid.innerHTML = cells.join("");
}

function calendarEvent(task) {
  const person = state.people.find((item) => item.id === task.assignee);
  const classes = [
    "calendar-event",
    task.virtualRecurring ? "recurring" : "",
    isOverdue(task) ? "overdue" : "",
    task.status === "done" ? "done" : ""
  ].filter(Boolean).join(" ");
  const dataAttribute = task.virtualRecurring ? `data-recurring-id="${task.recurringId}"` : `data-task-id="${task.id}"`;
  return `
    <button class="${classes}" type="button" ${dataAttribute}>
      ${escapeHtml(task.title)}
      <small>${task.virtualRecurring ? "Repetitiva - " : ""}${escapeHtml(person?.name || "Sin asignar")}</small>
    </button>
  `;
}

function projectRecurringForCalendar(startDate) {
  const rangeStart = toISODate(startDate);
  const rangeEndDate = new Date(startDate);
  rangeEndDate.setDate(rangeEndDate.getDate() + 41);
  const rangeEnd = toISODate(rangeEndDate);
  const existingKeys = new Set(state.tasks.map((task) => `${task.recurringId || ""}|${task.dueDate || ""}|${task.assignee || ""}`));
  const projections = [];

  filteredRecurring().forEach((item) => {
    if (item.active === false || !item.nextDate) return;
    let current = item.nextDate;
    let guard = 0;
    while (current < rangeStart && guard < 180) {
      current = advanceDate(current, item.frequency, item.weekday, item.weekdays);
      guard += 1;
    }
    while (current <= rangeEnd && guard < 240) {
      const assignees = isTeamAssignee(item.assignee) ? teamAssignees() : [item.assignee];
      assignees.filter(Boolean).forEach((assignee) => {
        const key = `${item.id}|${current}|${assignee}`;
        if (existingKeys.has(key)) return;
        projections.push({
          id: `recurring-${item.id}-${current}-${assignee}`,
          recurringId: item.id,
          title: item.title,
          assignee,
          status: "pending",
          priority: item.priority,
          dueDate: current,
          area: normalizeArea(item.area),
          notes: item.notes,
          virtualRecurring: true
        });
      });
      current = advanceDate(current, item.frequency, item.weekday, item.weekdays);
      guard += 1;
    }
  });

  return projections;
}

function renderRecurring() {
  const items = filteredRecurring().sort((a, b) => Number(a.active === false) - Number(b.active === false) || (a.nextDate || "").localeCompare(b.nextDate || ""));
  els.recurringList.innerHTML = items.length ? items.map((item) => {
    const person = state.people.find((personItem) => personItem.id === item.assignee);
    const priority = priorities.find((priorityItem) => priorityItem.id === item.priority);
    const frequency = frequencies.find((frequencyItem) => frequencyItem.id === item.frequency);
    return `
      <article class="recurring-card">
        <div>
          <h3>${escapeHtml(item.title)}</h3>
          <div class="recurring-meta">
            <span class="badge status-progress">${frequency?.label || ""}</span>
            ${["weekly", "biweekly", "custom"].includes(item.frequency) ? `<span class="badge area">${formatSelectedWeekdays(item)}</span>` : ""}
            <span class="badge priority-${item.priority}">${priority?.label || ""}</span>
            <span class="badge area">${escapeHtml(person?.name || "Sin asignar")}</span>
            <span class="badge area">Proxima: ${item.nextDate ? formatDate(item.nextDate) : "-"}</span>
            ${item.active === false ? `<span class="badge status-blocked">Pausada</span>` : ""}
          </div>
          ${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ""}
        </div>
        <div class="recurring-actions">
          <button class="button" type="button" data-generate-recurring="${item.id}">Crear ahora</button>
          <button class="button" type="button" data-toggle-recurring="${item.id}">${item.active === false ? "Activar" : "Pausar"}</button>
          <button class="button" type="button" data-edit-recurring="${item.id}">Editar</button>
        </div>
      </article>
    `;
  }).join("") : `<p class="empty-state">${state.recurring.length ? "No hay repetitivas con esos filtros." : "Todavia no hay tareas repetitivas."}</p>`;
}

function filteredRecurring() {
  const query = filters.query.trim().toLowerCase();
  return state.recurring.filter((item) => {
    const person = state.people.find((personItem) => personItem.id === item.assignee);
    const haystack = [item.title, item.area, item.notes, person?.name].join(" ").toLowerCase();
    return (!query || haystack.includes(query))
      && (filters.assignee === "all" || item.assignee === filters.assignee)
      && (filters.priority === "all" || item.priority === filters.priority);
  });
}

function taskCard(task) {
  const person = state.people.find((item) => item.id === task.assignee);
  const tone = taskTone(task);
  return `
    <article class="task-card ${tone}" draggable="true" tabindex="0" data-task-id="${task.id}">
      <div class="task-card-header">
        <h3>${escapeHtml(task.title)}</h3>
        ${task.status !== "done" ? `<button class="quick-done" type="button" title="Marcar como lista" aria-label="Marcar como lista ${escapeHtml(task.title)}" data-complete-task="${task.id}">Lista</button>` : ""}
      </div>
      <p class="task-notes">${escapeHtml(task.notes || "Sin detalle cargado.")}</p>
      <div class="task-footer">
        <span>${escapeHtml(person?.name || "Sin asignar")}</span>
        <span>${task.dueDate ? formatDate(task.dueDate) : "Sin fecha"}</span>
      </div>
    </article>
  `;
}

function taskTone(task) {
  if (task.status === "done") return "is-done";
  if (isOverdue(task)) return "is-overdue";
  if (isDueToday(task)) return "is-today";
  return "is-ok";
}

function filteredTasks(options = {}) {
  const query = filters.query.trim().toLowerCase();
  return state.tasks.filter((task) => {
    const person = state.people.find((item) => item.id === task.assignee);
    const haystack = [task.title, task.area, task.notes, person?.name].join(" ").toLowerCase();
    return (!query || haystack.includes(query))
      && (options.ignoreAssignee || filters.assignee === "all" || task.assignee === filters.assignee)
      && (filters.status === "all" || task.status === filters.status)
      && (filters.priority === "all" || task.priority === filters.priority);
  });
}

function isTeamAssignee(value) {
  return value === "__team__" || value === "equipo";
}

function openTaskDialog(task = null) {
  const isEditing = Boolean(task);
  els.dialogTitle.textContent = isEditing ? "Editar tarea" : "Nueva tarea";
  els.deleteTaskBtn.hidden = !isEditing;
  els.taskId.value = task?.id || "";
  els.taskTitle.value = task?.title || "";
  els.taskAssignee.value = task?.assignee || "";
  els.taskStatus.value = task?.status || "pending";
  els.taskPriority.value = task?.priority || "medium";
  els.taskDueDate.value = task?.dueDate || "";
  els.taskArea.value = normalizeArea(task?.area);
  els.taskNotes.value = task?.notes || "";
  els.taskDialog.showModal();
  els.taskTitle.focus();
}

async function upsertTask() {
  const taskId = els.taskId.value;
  const task = {
    id: taskId || crypto.randomUUID(),
    title: els.taskTitle.value.trim(),
    assignee: els.taskAssignee.value,
    status: els.taskStatus.value,
    priority: els.taskPriority.value,
    dueDate: els.taskDueDate.value,
    area: normalizeArea(els.taskArea.value),
    notes: els.taskNotes.value.trim(),
    createdAt: state.tasks.find((item) => item.id === els.taskId.value)?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (!task.title) return;

  if (apiOnline) {
    try {
      if (taskId && isTeamAssignee(task.assignee)) {
        await apiFetch(`api/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
        await apiFetch("api/tasks", { method: "POST", body: JSON.stringify(task) });
      } else {
        await apiFetch(taskId ? `api/tasks/${encodeURIComponent(taskId)}` : "api/tasks", {
          method: taskId ? "PATCH" : "POST",
          body: JSON.stringify(task)
        });
      }
      els.taskDialog.close();
      await syncAfterRemoteChange(taskId ? "Tarea actualizada." : "Tarea creada.");
    } catch (error) {
      handleRemoteError(error);
    }
    return;
  }

  if (isTeamAssignee(task.assignee)) {
    const assignees = teamAssignees();
    if (!assignees.length) {
      showToast("No hay responsables cargados para asignar al equipo.");
      return;
    }

    if (taskId) {
      const index = state.tasks.findIndex((item) => item.id === taskId);
      if (index >= 0) state.tasks[index] = { ...task, assignee: assignees[0] };
      assignees.slice(1).forEach((assignee) => state.tasks.unshift({ ...task, id: crypto.randomUUID(), assignee }));
    } else {
      assignees.forEach((assignee) => state.tasks.unshift({ ...task, id: crypto.randomUUID(), assignee }));
    }
  } else {
    const index = state.tasks.findIndex((item) => item.id === task.id);
    if (index >= 0) state.tasks[index] = task;
    else state.tasks.unshift(task);
  }

  els.taskDialog.close();
  render();
}

async function deleteCurrentTask() {
  if (!window.confirm("Eliminar esta tarea?")) return;
  if (apiOnline) {
    try {
      await apiFetch(`api/tasks/${encodeURIComponent(els.taskId.value)}`, { method: "DELETE" });
      els.taskDialog.close();
      await syncAfterRemoteChange("Tarea eliminada.");
    } catch (error) {
      handleRemoteError(error);
    }
    return;
  }
  state.tasks = state.tasks.filter((task) => task.id !== els.taskId.value);
  els.taskDialog.close();
  render();
  showToast("Tarea eliminada.");
}

function openRecurringDialog(item = null) {
  const isEditing = Boolean(item);
  els.recurringDialogTitle.textContent = isEditing ? "Editar repetitiva" : "Nueva repetitiva";
  els.deleteRecurringBtn.hidden = !isEditing;
  els.recurringId.value = item?.id || "";
  els.recurringTitle.value = item?.title || "";
  els.recurringAssignee.value = item?.assignee || "";
  els.recurringFrequency.value = item?.frequency || "weekly";
  setRecurringWeekdays(item ? normalizeWeekdays(item.weekdays, item.weekday) : [nextWeekdayFromDate(item?.nextDate || todayISO())]);
  els.recurringNextDate.value = item?.nextDate || todayISO();
  els.recurringPriority.value = item?.priority || "medium";
  els.recurringArea.value = normalizeArea(item?.area);
  els.recurringNotes.value = item?.notes || "";
  toggleRecurringWeekdayField();
  els.recurringDialog.showModal();
  els.recurringTitle.focus();
}

function syncRecurringNextDate() {
  toggleRecurringWeekdayField();
  if (!["weekly", "biweekly", "custom"].includes(els.recurringFrequency.value)) return;
  els.recurringNextDate.value = nextOccurrenceForWeekdays(selectedRecurringWeekdays());
}

function toggleRecurringWeekdayField() {
  const shouldShow = ["weekly", "biweekly", "custom"].includes(els.recurringFrequency.value);
  if (shouldShow) {
    els.recurringWeekdayField.removeAttribute("hidden");
    els.recurringWeekdayField.style.display = "grid";
  } else {
    els.recurringWeekdayField.setAttribute("hidden", "");
    els.recurringWeekdayField.style.display = "none";
  }
  updateRecurringWeekdayButtons();
}

function selectedRecurringWeekdays() {
  return normalizeWeekdays(els.recurringWeekday.value.split(","));
}

function setRecurringWeekdays(values) {
  const normalized = normalizeWeekdays(values);
  els.recurringWeekday.value = normalized.join(",");
  updateRecurringWeekdayButtons();
}

function updateRecurringWeekdayButtons() {
  if (!els.recurringWeekdays) return;
  const selected = new Set(selectedRecurringWeekdays());
  els.recurringWeekdays.querySelectorAll("[data-recurring-weekday]").forEach((button) => {
    button.classList.toggle("active", selected.has(button.dataset.recurringWeekday));
  });
}

function toggleRecurringWeekday(value) {
  const current = selectedRecurringWeekdays();
  const isCustom = els.recurringFrequency.value === "custom";
  let next = [];
  if (isCustom) {
    next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
    if (!next.length) next = [value];
  } else {
    next = [value];
  }
  setRecurringWeekdays(next);
  syncRecurringNextDate();
}

async function upsertRecurring() {
  const item = {
    id: els.recurringId.value || crypto.randomUUID(),
    title: els.recurringTitle.value.trim(),
    assignee: els.recurringAssignee.value,
    frequency: els.recurringFrequency.value,
    weekday: selectedRecurringWeekdays()[0] || "1",
    weekdays: selectedRecurringWeekdays(),
    nextDate: els.recurringNextDate.value,
    priority: els.recurringPriority.value,
    area: normalizeArea(els.recurringArea.value),
    notes: els.recurringNotes.value.trim(),
    active: true,
    createdAt: state.recurring.find((existing) => existing.id === els.recurringId.value)?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (!item.title || !item.nextDate) return;

  if (apiOnline) {
    try {
      await apiFetch(item.id === els.recurringId.value ? `api/recurring/${encodeURIComponent(item.id)}` : "api/recurring", {
        method: item.id === els.recurringId.value ? "PATCH" : "POST",
        body: JSON.stringify(item)
      });
      els.recurringDialog.close();
      await syncAfterRemoteChange(item.id === els.recurringId.value ? "Repetitiva actualizada." : "Repetitiva creada.");
    } catch (error) {
      handleRemoteError(error);
    }
    return;
  }

  const index = state.recurring.findIndex((existing) => existing.id === item.id);
  if (index >= 0) state.recurring[index] = item;
  else state.recurring.unshift(item);

  els.recurringDialog.close();
  generateDueRecurringTasks();
  render();
}

async function deleteCurrentRecurring() {
  if (!window.confirm("Eliminar esta tarea repetitiva?")) return;
  if (apiOnline) {
    try {
      await apiFetch(`api/recurring/${encodeURIComponent(els.recurringId.value)}`, { method: "DELETE" });
      els.recurringDialog.close();
      await syncAfterRemoteChange("Repetitiva eliminada.");
    } catch (error) {
      handleRemoteError(error);
    }
    return;
  }
  state.recurring = state.recurring.filter((item) => item.id !== els.recurringId.value);
  els.recurringDialog.close();
  render();
  showToast("Repetitiva eliminada.");
}

function generateDueRecurringTasks() {
  const today = todayISO();
  let changed = false;

  state.recurring.forEach((item) => {
    if (item.active === false || !item.nextDate) return;
    let guard = 0;
    while (item.nextDate <= today && guard < 30) {
      createTaskFromRecurring(item, item.nextDate);
      item.nextDate = advanceDate(item.nextDate, item.frequency, item.weekday, item.weekdays);
      item.updatedAt = new Date().toISOString();
      changed = true;
      guard += 1;
    }
  });

  if (changed) saveState();
}

function createTaskFromRecurring(item, dueDate = todayISO()) {
  const assignees = isTeamAssignee(item.assignee) ? teamAssignees() : [item.assignee];
  if (!assignees.length) return false;
  let created = false;

  assignees.forEach((assignee) => {
    const alreadyExists = state.tasks.some((task) => task.recurringId === item.id && task.dueDate === dueDate && task.assignee === assignee);
    if (alreadyExists) return;

    state.tasks.unshift({
      id: crypto.randomUUID(),
      recurringId: item.id,
      title: item.title,
      assignee,
      status: "pending",
      priority: item.priority,
      dueDate,
      area: normalizeArea(item.area),
      notes: item.notes,
      createdAt: new Date().toISOString()
    });
    created = true;
  });

  return created;
}

async function generateRecurringNow(id) {
  if (apiOnline) {
    try {
      const created = await apiFetch(`api/recurring/${encodeURIComponent(id)}/generate`, {
        method: "POST",
        body: JSON.stringify({ dueDate: todayISO() })
      });
      await syncAfterRemoteChange(created?.length ? "Tarea creada para hoy." : "Ya existe una tarea de esta repetitiva para hoy.");
    } catch (error) {
      handleRemoteError(error);
    }
    return;
  }
  const item = state.recurring.find((existing) => existing.id === id);
  if (!item) return;
  const created = createTaskFromRecurring(item, todayISO());
  render();
  showToast(created ? "Tarea creada para hoy." : "Ya existe una tarea de esta repetitiva para hoy.");
}

async function toggleRecurring(id) {
  const item = state.recurring.find((existing) => existing.id === id);
  if (!item) return;
  if (apiOnline) {
    try {
      await apiFetch(`api/recurring/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ active: item.active === false })
      });
      await syncAfterRemoteChange(item.active === false ? "Repetitiva activada." : "Repetitiva pausada.");
    } catch (error) {
      handleRemoteError(error);
    }
    return;
  }
  item.active = item.active === false;
  item.updatedAt = new Date().toISOString();
  render();
  showToast(item.active ? "Repetitiva activada." : "Repetitiva pausada.");
}

async function moveTaskToStatus(taskId, status) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || task.status === status) return;
  if (apiOnline) {
    try {
      await apiFetch(`api/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      await syncAfterRemoteChange(`Tarea movida a ${statuses.find((item) => item.id === status)?.label || "otro estado"}.`);
    } catch (error) {
      handleRemoteError(error);
    }
    return;
  }
  task.status = status;
  task.updatedAt = new Date().toISOString();
  render();
  showToast(`Tarea movida a ${statuses.find((item) => item.id === status)?.label || "otro estado"}.`);
}

async function completeTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  if (apiOnline) {
    try {
      await apiFetch(`api/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "done" })
      });
      await syncAfterRemoteChange("Tarea marcada como lista.");
    } catch (error) {
      handleRemoteError(error);
    }
    return;
  }
  task.status = "done";
  task.updatedAt = new Date().toISOString();
  render();
  showToast("Tarea marcada como lista.");
}

async function updateTaskStatus(taskId, status) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  if (apiOnline) {
    try {
      await apiFetch(`api/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      await syncAfterRemoteChange("Estado actualizado.");
    } catch (error) {
      handleRemoteError(error);
    }
    return;
  }
  task.status = status;
  task.updatedAt = new Date().toISOString();
  render();
  showToast("Estado actualizado.");
}

function teamAssignees() {
  return state.people.map((person) => person.id);
}

async function addPerson() {
  const name = els.personNameInput.value.trim();
  const email = els.personEmailInput.value.trim();
  if (!name) return;
  if (apiOnline) {
    try {
      await apiFetch("api/people", {
        method: "POST",
        body: JSON.stringify({ name, email })
      });
      els.personNameInput.value = "";
      els.personEmailInput.value = "";
      await syncAfterRemoteChange("Responsable agregado.");
    } catch (error) {
      handleRemoteError(error);
    }
    return;
  }
  state.people.push({ id: slugify(name), name, email });
  els.personNameInput.value = "";
  els.personEmailInput.value = "";
  render();
}

async function removePerson(id) {
  const person = state.people.find((item) => item.id === id);
  if (!person) return;
  const confirmation = window.prompt(`Para quitar a ${person.name}, escribi su nombre exacto. Sus tareas quedan sin asignar.`);
  if (confirmation !== person.name) {
    showToast("No se quito el responsable.");
    return;
  }
  if (apiOnline) {
    try {
      await apiFetch(`api/people/${encodeURIComponent(id)}`, { method: "DELETE" });
      await syncAfterRemoteChange("Responsable quitado.");
    } catch (error) {
      handleRemoteError(error);
    }
    return;
  }
  state.people = state.people.filter((person) => person.id !== id);
  state.tasks = state.tasks.map((task) => task.assignee === id ? { ...task, assignee: "" } : task);
  state.recurring = state.recurring.map((item) => item.assignee === id ? { ...item, assignee: "" } : item);
  render();
  showToast("Responsable quitado.");
}

async function sendDailyNotifications() {
  if (!els.sendNotificationBtn || !els.notificationStatus) return;
  if (!apiOnline) {
    showToast("Los mails se activan cuando la app esta conectada a Supabase.");
    return;
  }
  els.sendNotificationBtn.disabled = true;
  els.notificationStatus.textContent = "Enviando...";
  try {
    const result = await apiFetch("api/notifications/daily-summary", {
      method: "POST",
      body: JSON.stringify({})
    });
    const sent = result.results.filter((item) => item.status === "sent").length;
    const skipped = result.results.filter((item) => item.status === "skipped").length;
    const failed = result.results.filter((item) => item.status === "failed").length;
    els.notificationStatus.textContent = `${sent} enviados, ${skipped} omitidos, ${failed} con error.`;
    showToast("Resumen de mails procesado.");
  } catch (error) {
    els.notificationStatus.textContent = error.message || "No pude mandar los mails.";
    handleRemoteError(error);
  } finally {
    els.sendNotificationBtn.disabled = false;
  }
}

function exportTasks() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `incognito-tareas-${todayISO()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function importTasks(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported.people) || !Array.isArray(imported.tasks)) return;
      state = {
        view: imported.view || "planner",
        selectedPerson: imported.selectedPerson || imported.people[0]?.id || "",
        hideDoneList: imported.hideDoneList !== false,
        calendarMonth: imported.calendarMonth || todayISO().slice(0, 7),
        people: normalizePeople(imported.people),
        tasks: normalizeTasks(imported.tasks),
        recurring: normalizeRecurring(Array.isArray(imported.recurring) ? imported.recurring : [])
      };
      ensureSelectedPerson();
      ensureCalendarMonth();
      generateDueRecurringTasks();
      render();
    } catch {
      window.alert("No pude importar ese archivo.");
    }
  };
  reader.readAsText(file);
}

function sortByDueDate(a, b) {
  if (!a.dueDate && !b.dueDate) return a.title.localeCompare(b.title);
  if (!a.dueDate) return 1;
  if (!b.dueDate) return -1;
  return a.dueDate.localeCompare(b.dueDate);
}

function sortByPriorityAndDueDate(a, b) {
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  const priorityDiff = (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3);
  if (priorityDiff !== 0) return priorityDiff;
  return sortByDueDate(a, b);
}

function isOverdue(task) {
  if (!task.dueDate || task.status === "done") return false;
  return task.dueDate < todayISO();
}

function isDueToday(task) {
  return task.dueDate === todayISO() && task.status !== "done";
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short" }).format(date);
}

function todayISO() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function toISODate(date) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

function nextWeekISO() {
  return advanceDate(todayISO(), "weekly");
}

function shiftMonth(value, amount) {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(year, month - 1 + amount, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function nextOccurrenceForWeekdays(values, from = todayISO()) {
  const targetDays = new Set(normalizeWeekdays(values).map(Number));
  const date = new Date(`${from}T00:00:00`);
  while (!targetDays.has(date.getDay())) {
    date.setDate(date.getDate() + 1);
  }
  return toISODate(date);
}

function advanceDate(value, frequency, weekday = "1", weekdaysValue = null) {
  const date = new Date(`${value}T00:00:00`);
  if (frequency === "daily") date.setDate(date.getDate() + 1);
  else if (frequency === "weekdays") {
    do {
      date.setDate(date.getDate() + 1);
    } while (date.getDay() === 0 || date.getDay() === 6);
  }
  else if (frequency === "weekly" || frequency === "biweekly") {
    date.setDate(date.getDate() + (frequency === "biweekly" ? 14 : 7));
    const targetDay = Number(weekday);
    while (date.getDay() !== targetDay) {
      date.setDate(date.getDate() + 1);
    }
  }
  else if (frequency === "custom") {
    const targetDays = new Set(normalizeWeekdays(weekdaysValue, weekday).map(Number));
    do {
      date.setDate(date.getDate() + 1);
    } while (!targetDays.has(date.getDay()));
  }
  else if (frequency === "monthly") date.setMonth(date.getMonth() + 1);
  else date.setDate(date.getDate() + 7);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function nextWeekdayFromDate(value) {
  return String(new Date(`${value}T00:00:00`).getDay());
}

function normalizeWeekdays(values, fallback = "1") {
  const source = Array.isArray(values) ? values : String(values ?? "").split(",");
  const normalized = source
    .map((value) => String(value))
    .filter((value) => weekdays.some((weekday) => weekday.id === value));
  const unique = [...new Set(normalized)];
  const result = unique.length ? unique : [String(fallback ?? "1")];
  return result.sort((a, b) => weekdaySortValue(a) - weekdaySortValue(b));
}

function weekdaySortValue(value) {
  return value === "0" ? 7 : Number(value);
}

function formatSelectedWeekdays(item) {
  const selected = normalizeWeekdays(item.weekdays, item.weekday);
  return selected.map((value) => weekdays.find((weekday) => weekday.id === value)?.label.slice(0, 3) || "").filter(Boolean).join(", ");
}

function slugify(value) {
  const base = value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  let id = base || crypto.randomUUID();
  let suffix = 2;
  while (state.people.some((person) => person.id === id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

let toastTimer = null;

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 2600);
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    state.view = tab.dataset.view;
    render();
  });
});

els.searchInput.addEventListener("input", (event) => {
  filters.query = event.target.value;
  renderPlanner();
  renderPersonalList();
  renderCalendar();
  renderRecurring();
});

els.assigneeFilter.addEventListener("change", (event) => {
  filters.assignee = event.target.value;
  renderPlanner();
  renderPersonalList();
  renderCalendar();
  renderRecurring();
});

els.statusFilter.addEventListener("change", (event) => {
  filters.status = event.target.value;
  renderPlanner();
  renderPersonalList();
  renderCalendar();
  renderRecurring();
});

els.priorityFilter.addEventListener("change", (event) => {
  filters.priority = event.target.value;
  renderPlanner();
  renderPersonalList();
  renderCalendar();
  renderRecurring();
});

els.clearFiltersBtn.addEventListener("click", () => {
  filters = {
    query: "",
    assignee: "all",
    status: "all",
    priority: "all"
  };
  els.searchInput.value = "";
  render();
  showToast("Filtros limpiados.");
});

els.listPersonSelect.addEventListener("change", (event) => {
  state.selectedPerson = event.target.value;
  render();
});

els.hideDoneList.addEventListener("change", (event) => {
  state.hideDoneList = event.target.checked;
  render();
});

els.prevMonthBtn.addEventListener("click", () => {
  state.calendarMonth = shiftMonth(state.calendarMonth, -1);
  render();
});

els.todayMonthBtn.addEventListener("click", () => {
  state.calendarMonth = todayISO().slice(0, 7);
  render();
});

els.nextMonthBtn.addEventListener("click", () => {
  state.calendarMonth = shiftMonth(state.calendarMonth, 1);
  render();
});

els.savePersonBtn.addEventListener("click", addPerson);
if (els.sendNotificationBtn) {
  els.sendNotificationBtn.addEventListener("click", sendDailyNotifications);
}
els.personNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addPerson();
});
els.personEmailInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addPerson();
});

els.peopleList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-person]");
  if (button) removePerson(button.dataset.removePerson);
});

els.newTaskBtn.addEventListener("click", () => openTaskDialog());
els.closeDialogBtn.addEventListener("click", () => els.taskDialog.close());
els.cancelTaskBtn.addEventListener("click", () => els.taskDialog.close());
els.taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  upsertTask();
});
els.deleteTaskBtn.addEventListener("click", deleteCurrentTask);

els.plannerView.addEventListener("click", (event) => {
  const completeButton = event.target.closest("[data-complete-task]");
  if (completeButton) {
    completeTask(completeButton.dataset.completeTask);
    return;
  }

  const card = event.target.closest("[data-task-id]");
  if (!card) return;
  openTaskDialog(state.tasks.find((task) => task.id === card.dataset.taskId));
});

els.plannerView.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const card = event.target.closest("[data-task-id]");
  if (!card) return;
  openTaskDialog(state.tasks.find((task) => task.id === card.dataset.taskId));
});

els.plannerView.addEventListener("dragstart", (event) => {
  const card = event.target.closest("[data-task-id]");
  if (!card) return;
  event.dataTransfer.setData("text/plain", card.dataset.taskId);
  event.dataTransfer.effectAllowed = "move";
  card.classList.add("dragging");
});

els.plannerView.addEventListener("dragend", (event) => {
  const card = event.target.closest("[data-task-id]");
  if (card) card.classList.remove("dragging");
  document.querySelectorAll(".planner-column.drag-over").forEach((column) => column.classList.remove("drag-over"));
});

els.plannerView.addEventListener("dragover", (event) => {
  const column = event.target.closest("[data-status]");
  if (!column) return;
  event.preventDefault();
  column.classList.add("drag-over");
});

els.plannerView.addEventListener("dragleave", (event) => {
  const column = event.target.closest("[data-status]");
  if (!column || column.contains(event.relatedTarget)) return;
  column.classList.remove("drag-over");
});

els.plannerView.addEventListener("drop", (event) => {
  const column = event.target.closest("[data-status]");
  if (!column) return;
  event.preventDefault();
  column.classList.remove("drag-over");
  const taskId = event.dataTransfer.getData("text/plain");
  moveTaskToStatus(taskId, column.dataset.status);
});

els.taskTableBody.addEventListener("click", (event) => {
  if (event.target.closest("select, option, label, button, input")) return;
  const row = event.target.closest("[data-task-id]");
  if (!row) return;
  openTaskDialog(state.tasks.find((task) => task.id === row.dataset.taskId));
});

els.taskTableBody.addEventListener("change", (event) => {
  const statusSelect = event.target.closest("[data-list-status-task]");
  if (!statusSelect) return;
  updateTaskStatus(statusSelect.dataset.listStatusTask, statusSelect.value);
});

els.calendarGrid.addEventListener("click", (event) => {
  const eventButton = event.target.closest("[data-task-id]");
  if (eventButton) {
    openTaskDialog(state.tasks.find((task) => task.id === eventButton.dataset.taskId));
    return;
  }
  const recurringButton = event.target.closest("[data-recurring-id]");
  if (recurringButton) {
    openRecurringDialog(state.recurring.find((item) => item.id === recurringButton.dataset.recurringId));
  }
});

els.newRecurringBtn.addEventListener("click", () => openRecurringDialog());
els.closeRecurringDialogBtn.addEventListener("click", () => els.recurringDialog.close());
els.cancelRecurringBtn.addEventListener("click", () => els.recurringDialog.close());
els.recurringFrequency.addEventListener("input", syncRecurringNextDate);
if (els.recurringWeekdays) {
  els.recurringWeekdays.addEventListener("click", (event) => {
    const button = event.target.closest("[data-recurring-weekday]");
    if (button) toggleRecurringWeekday(button.dataset.recurringWeekday);
  });
}
els.recurringForm.addEventListener("submit", (event) => {
  event.preventDefault();
  upsertRecurring();
});
els.deleteRecurringBtn.addEventListener("click", deleteCurrentRecurring);
els.recurringFrequency.addEventListener("change", syncRecurringNextDate);

els.recurringList.addEventListener("click", (event) => {
  const generateButton = event.target.closest("[data-generate-recurring]");
  if (generateButton) {
    generateRecurringNow(generateButton.dataset.generateRecurring);
    return;
  }

  const toggleButton = event.target.closest("[data-toggle-recurring]");
  if (toggleButton) {
    toggleRecurring(toggleButton.dataset.toggleRecurring);
    return;
  }

  const editButton = event.target.closest("[data-edit-recurring]");
  if (editButton) {
    openRecurringDialog(state.recurring.find((item) => item.id === editButton.dataset.editRecurring));
  }
});

els.exportBtn.addEventListener("click", exportTasks);
els.importInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) importTasks(file);
  event.target.value = "";
});
