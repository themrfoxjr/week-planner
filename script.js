/***** CONFIG *****/
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const START_HOUR = 5;   // 5:00
const END_HOUR   = 23;  // 23:00
const SLOT_MINUTES = 30;
const SLOT_HEIGHT = parseInt(getComputedStyle(document.documentElement)
  .getPropertyValue('--slot-height')) || 20; // px per 30 minutes

const MINUTES_PER_PIXEL = SLOT_MINUTES / SLOT_HEIGHT; // 30 / slotHeight
const PIXELS_PER_MINUTE = 1 / MINUTES_PER_PIXEL;      // e.g. 1 px = 1.5 min if slot=20px

const DEFAULT_TASK = {
  title: "New Task",
  color: "bg-yellow-200",
  startMin: (9 - START_HOUR) * 60,   // 9:00
  durationMin: 60                    // 1 hour
};

let tasks = loadFromStorage(); // { [day]: Task[] }
const planner = document.getElementById("planner");

/***** INIT UI *****/
buildTimeline();
buildDayColumns();
renderAllTasks();
wireTopButtons();
wireAddButtons();
setupDropzones();

/***** STORAGE *****/
function saveToStorage() {
  localStorage.setItem("tasks_v2", JSON.stringify(tasks));
}
function loadFromStorage() {
  try {
    return JSON.parse(localStorage.getItem("tasks_v2")) || {};
  } catch {
    return {};
  }
}

/***** TIMELINE *****/
function buildTimeline() {
  const tl = document.getElementById("timeline");
  const totalSlots = (END_HOUR - START_HOUR) * 2; // 2 slots per hour

  for (let i = 0; i <= totalSlots; i++) {
    const row = document.createElement("div");
    row.className = "time-row" + (i % 2 === 0 ? " hour" : "");
    tl.appendChild(row);

    // Hour labels at every hour (on the "hour" rows)
    if (i % 2 === 0) {
      const hour = START_HOUR + i / 2;
      const label = document.createElement("div");
      label.className = "time-label";
      label.textContent = formatHour(hour);
      row.appendChild(label);
    }
  }
}

/***** DAYS *****/
function buildDayColumns() {
  // Ensure object keys exist
  for (const d of DAYS) tasks[d] ||= [];

  for (const day of DAYS) {
    const wrap = document.createElement("div");
    wrap.className = "day-col";

    const dayCanvas = document.createElement("div");
    dayCanvas.className = "day";
    dayCanvas.id = `day-${day}`;
    dayCanvas.dataset.day = day;

    // background grid lines (overlay)
    const totalSlots = (END_HOUR - START_HOUR) * 2;
    for (let i = 0; i <= totalSlots; i++) {
      const line = document.createElement("div");
      line.className = "grid-row" + (i % 2 === 0 ? " hour" : "");
      line.style.top = `${i * SLOT_HEIGHT}px`;
      dayCanvas.appendChild(line);
    }

    wrap.appendChild(dayCanvas);
    planner.appendChild(wrap);
  }
}

/***** RENDERING *****/
function renderAllTasks() {
  // Clear existing task nodes
  for (const day of DAYS) {
    const dayEl = document.getElementById(`day-${day}`);
    // Remove existing .task nodes only
    [...dayEl.querySelectorAll('.task')].forEach(n => n.remove());

    for (const t of tasks[day]) {
      renderTask(dayEl, t);
    }
  }
}

function renderTask(dayEl, task) {
  const el = document.createElement("div");
  el.className = `task ${task.color}`;
  el.dataset.id = task.id;
  el.dataset.day = dayEl.dataset.day;

  // position by time
  el.style.top = `${minutesToY(task.startMin)}px`;
  el.style.height = `${task.durationMin * PIXELS_PER_MINUTE}px`;

  el.textContent = task.title;

  // resize handles
  const hTop = document.createElement("div");
  hTop.className = "resize-handle top";
  const hBottom = document.createElement("div");
  hBottom.className = "resize-handle bottom";
  el.appendChild(hTop);
  el.appendChild(hBottom);

  // interactions
  enableInteract(el);

  // simple color cycle on click
  el.addEventListener('click', (e) => {
    if (e.detail === 1) {
      cycleColor(task, el);
      saveToStorage();
    }
  });

  // rename on double click
  el.addEventListener('dblclick', () => {
    const newTitle = prompt('Task name:', task.title);
    if (newTitle !== null) {
      task.title = newTitle.trim() || task.title;
      el.textContent = task.title;
      el.appendChild(hTop); el.appendChild(hBottom);
      saveToStorage();
    }
  });

  dayEl.appendChild(el);
}

/***** INTERACT (drag + resize + drop) *****/
function enableInteract(el) {
  // DRAG
  interact(el).draggable({
    inertia: false,
    listeners: {
      start (evt) {
        el.classList.add('dragging');
        // store initial
        el._startTop = parseFloat(el.style.top) || 0;
      },
      move (evt) {
        // only vertical movement matters inside a day
        const dy = evt.dy || 0;
        const newTop = clamp(el._startTop + dy, 0, dayHeight() - minTaskHeight());
        el.style.top = `${newTop}px`;
      },
      end (evt) {
        el.classList.remove('dragging');
        snapAndPersist(el);
      }
    }
  });

  // RESIZE (top and bottom)
  interact(el).resizable({
    edges: { top: true, bottom: true, left: false, right: false },
    inertia: false,
    listeners: {
      move (evt) {
        const { y, height } = evt.rect;
        const dayEl = el.parentElement;

        const topClamp = clamp(y - dayEl.getBoundingClientRect().top + dayEl.scrollTop, 0, dayHeight());
        const bottom = clamp(topClamp + height, 0, dayHeight());
        const h = Math.max(bottom - topClamp, minTaskHeight());

        el.style.top = `${topClamp}px`;
        el.style.height = `${h}px`;
      },
      end () {
        snapAndPersist(el);
      }
    }
  });
}

function setupDropzones() {
  // Each .day is a dropzone to accept tasks from other days
  interact('.day').dropzone({
    accept: '.task',
    ondrop (evt) {
      const taskEl = evt.relatedTarget;
      const fromDay = taskEl.dataset.day;
      const toDay = evt.target.dataset.day;
      if (fromDay === toDay) return;

      // Move DOM node
      evt.target.appendChild(taskEl);
      taskEl.dataset.day = toDay;

      // Persist: move task object
      const t = takeTaskFromDay(fromDay, taskEl.dataset.id);
      if (t) {
        tasks[toDay].push(t);
        // Adjust top relative to drop target
        const dayRect = evt.target.getBoundingClientRect();
        const pointerY = evt.dragEvent?.clientY ?? dayRect.top;
        const localY = clamp(pointerY - dayRect.top + evt.target.scrollTop, 0, dayHeight() - minTaskHeight());
        taskEl.style.top = `${localY}px`;
        snapAndPersist(taskEl);
      }
      saveToStorage();
    }
  });
}

function takeTaskFromDay(day, id) {
  const idx = tasks[day].findIndex(t => t.id === id);
  if (idx >= 0) {
    const [t] = tasks[day].splice(idx, 1);
    return t;
  }
  return null;
}

function snapAndPersist(el) {
  const day = el.dataset.day;
  const task = findTask(day, el.dataset.id);
  if (!task) return;

  // snap top to 30-min grid
  const top = snapToSlot(parseFloat(el.style.top) || 0);
  el.style.top = `${top}px`;

  // snap height to 30-min grid
  const height = Math.max(minTaskHeight(), snapToSlot(parseFloat(el.style.height)));
  el.style.height = `${height}px`;

  // clamp to bounds
  const maxTop = dayHeight() - height;
  if (parseFloat(el.style.top) > maxTop) {
    el.style.top = `${snapToSlot(maxTop)}px`;
  }

  // store back to model
  task.startMin = yToMinutes(parseFloat(el.style.top));
  task.durationMin = Math.max(SLOT_MINUTES, Math.round(parseFloat(el.style.height) * MINUTES_PER_PIXEL / SLOT_MINUTES) * SLOT_MINUTES);

  saveToStorage();
}

function findTask(day, id) {
  return tasks[day].find(t => t.id === id);
}

/***** ADD / EXPORT / IMPORT / CLEAR *****/
function wireTopButtons() {
  document.getElementById("exportBtn").addEventListener("click", () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(tasks, null, 2));
    const link = document.createElement("a");
    link.href = dataStr;
    link.download = "planner.json";
    link.click();
  });

  document.getElementById("importBtn").addEventListener("click", () => {
    document.getElementById("importFile").click();
  });

  document.getElementById("importFile").addEventListener("change", (event) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        // Basic schema guard
        if (typeof parsed === 'object' && parsed) {
          tasks = parsed;
          saveToStorage();
          renderAllTasks();
        } else {
          alert("Invalid JSON structure.");
        }
      } catch (e) {
        alert("Could not parse JSON.");
      }
    };
    reader.readAsText(event.target.files[0]);
  });

  document.getElementById("clearBtn").addEventListener("click", () => {
    if (!confirm("Clear all tasks?")) return;
    tasks = {};
    for (const d of DAYS) tasks[d] = [];
    saveToStorage();
    renderAllTasks();
  });
}

function wireAddButtons() {
  document.querySelectorAll('.addBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      const day = btn.dataset.day;
      addTask(day);
    });
  });
}

function addTask(day, partial = {}) {
  const t = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    title: partial.title ?? DEFAULT_TASK.title,
    color: partial.color ?? DEFAULT_TASK.color,
    startMin: partial.startMin ?? DEFAULT_TASK.startMin,
    durationMin: partial.durationMin ?? DEFAULT_TASK.durationMin
  };
  tasks[day].push(t);
  saveToStorage();

  const dayEl = document.getElementById(`day-${day}`);
  renderTask(dayEl, t);
}

/***** HELPERS *****/
function formatHour(h) {
  const ampm = h < 12 ? "AM" : "PM";
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:00 ${ampm}`;
}

// Convert minutes-from-START to y px
function minutesToY(mins) {
  return Math.round(mins * PIXELS_PER_MINUTE);
}

// Convert y px to minutes-from-START
function yToMinutes(y) {
  return clamp(Math.round(y * MINUTES_PER_PIXEL / SLOT_MINUTES) * SLOT_MINUTES, 0, (END_HOUR - START_HOUR) * 60);
}

function snapToSlot(px) {
  // snap to slot height increments (30 min)
  const slots = Math.round(px / SLOT_HEIGHT);
  return slots * SLOT_HEIGHT;
}

function minTaskHeight() {
  return SLOT_HEIGHT; // 30 minutes minimum
}

function dayHeight() {
  return (END_HOUR - START_HOUR) * 60 * PIXELS_PER_MINUTE;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// Color cycling on click
const COLORS = ["bg-yellow-200","bg-blue-200","bg-green-200","bg-pink-200","bg-purple-200","bg-orange-200"];
function cycleColor(task, el) {
  const idx = COLORS.indexOf(task.color);
  const next = COLORS[(idx + 1) % COLORS.length];
  // swap classes
  el.classList.remove(task.color);
  el.classList.add(next);
  task.color = next;
}

/***** INITIAL MIGRATION (optional)
 If you previously used a different storage shape (v1), you could read and map it here. *****/
