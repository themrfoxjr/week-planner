/***** CONFIG *****/
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const START_HOUR = 5;
const END_HOUR   = 23;
const SLOT_MINUTES = 30;

let SLOT_HEIGHT = readSlotHeight();               // px per 30-min slot (dynamic)
let MINUTES_PER_PIXEL = SLOT_MINUTES / SLOT_HEIGHT;
let PIXELS_PER_MINUTE = 1 / MINUTES_PER_PIXEL;

const DEFAULT_TASK = {
  title: "New Task",
  color: "color-blue",                 // Google-y palette class (see CSS)
  startMin: (9 - START_HOUR) * 60,     // defaults to 9:00 AM
  durationMin: 60                      // defaults to 60 min
};

let tasks = loadFromStorage(); // { [day]: Task[] }
const planner = document.getElementById("planner");

/***** INIT *****/
buildTimeline();
buildDayColumns();
renderAllTasks();
wireTopButtons();
wireAddButtons();
setupDropzones();
fitCalendarToViewport();         // <- compute height & slot size initially
drawNowLine();
setInterval(drawNowLine, 60 * 1000);
window.addEventListener('resize', debounce(()=> {
  fitCalendarToViewport();
  drawNowLine();
}, 80));

/***** STORAGE *****/
function saveToStorage(){ localStorage.setItem("tasks_v3", JSON.stringify(tasks)); }
function loadFromStorage(){ try{ return JSON.parse(localStorage.getItem("tasks_v3")) || {}; }catch{ return {}; }}

/***** UTILS FOR DYNAMIC METRICS *****/
function readSlotHeight(){
  return parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue('--slot-height')) || 24;
}
function setSlotHeight(px){
  document.documentElement.style.setProperty('--slot-height', `${px}px`);
  SLOT_HEIGHT = px;
  MINUTES_PER_PIXEL = SLOT_MINUTES / SLOT_HEIGHT;
  PIXELS_PER_MINUTE = 1 / MINUTES_PER_PIXEL;
}

/***** TIMELINE *****/
function buildTimeline(){
  const tl = document.getElementById("timeline");
  const total = (END_HOUR - START_HOUR) * 2;
  for(let i=0;i<=total;i++){
    const row = document.createElement("div");
    row.className = "time-row" + (i%2===0?" hour":"");
    tl.appendChild(row);
    if(i%2===0){
      const hour = START_HOUR + i/2;
      const label = document.createElement("div");
      label.className = "time-label";
      label.textContent = formatHour(hour);
      row.appendChild(label);
    }
  }
}

/***** DAYS *****/
function buildDayColumns(){
  for(const d of DAYS) tasks[d] ||= [];
  for(const day of DAYS){
    const col = document.createElement("div");
    col.className = "day-col";

    const dayCanvas = document.createElement("div");
    dayCanvas.className = "day";
    dayCanvas.id = `day-${day}`;
    dayCanvas.dataset.day = day;

    const total = (END_HOUR - START_HOUR) * 2;
    for(let i=0;i<=total;i++){
      const line = document.createElement("div");
      line.className = "grid-row" + (i%2===0?" hour":"");
      line.style.top = `${i * SLOT_HEIGHT}px`;
      dayCanvas.appendChild(line);
    }

    const nowLine = document.createElement("div");
    nowLine.className = "now-line";
    nowLine.style.display = "none";
    nowLine.innerHTML = '<div class="now-dot"></div>';
    dayCanvas.appendChild(nowLine);

    col.appendChild(dayCanvas);
    planner.appendChild(col);
  }
}

/***** RENDER *****/
function renderAllTasks(){
  for(const day of DAYS){
    const el = document.getElementById(`day-${day}`);
    [...el.querySelectorAll('.task')].forEach(n=>n.remove());
    tasks[day].forEach(t => renderTask(el,t));
  }
  autosizeAllTaskText();
}

function renderTask(dayEl, task){
  const node = document.createElement("div");
  node.className = `task ${task.color}`;
  node.dataset.id = task.id;
  node.dataset.day = dayEl.dataset.day;
  node.style.top = `${minutesToY(task.startMin)}px`;
  node.style.height = `${task.durationMin * PIXELS_PER_MINUTE}px`;

  // title container for clamping/auto-size
  const title = document.createElement('div');
  title.className = 'task-title';
  title.textContent = task.title;
  node.appendChild(title);

  // resize handles
  const hTop = document.createElement("div"); hTop.className="resize-handle top";
  const hBot = document.createElement("div"); hBot.className="resize-handle bottom";
  node.appendChild(hTop); node.appendChild(hBot);

  enableInteract(node);

  // click: cycle color
  node.addEventListener('click', e=>{
    if(e.detail===1){ cycleColor(task,node); saveToStorage(); }
  });
  // dblclick: rename
  node.addEventListener('dblclick', ()=>{
    const t = prompt("Task name:", task.title);
    if(t!==null){
      task.title = t.trim() || task.title;
      node.querySelector('.task-title').textContent = task.title;
      saveToStorage();
      autosizeTaskText(node);
    }
  });

  dayEl.appendChild(node);
  autosizeTaskText(node);
}

/***** INTERACT: DRAG + RESIZE *****
  - DRAG uses transform for live feedback, then commits to `top` on end.
  - RESIZE captures true edges (top/bottom) and uses deltaRect.
************************************/
function enableInteract(el){
  // DRAG
  interact(el).draggable({ inertia:false })
  .on('dragstart', ()=>{
    el.classList.add('dragging');
    el._startTop = parseFloat(el.style.top) || 0;
    el._dy = 0;
    el.style.transform = 'translateY(0px)';
  })
  .on('dragmove', (evt)=>{
    el._dy += evt.dy || 0;
    el.style.transform = `translateY(${el._dy}px)`;   // live feedback
  })
  .on('dragend', ()=>{
    const h = parseFloat(el.style.height) || minTaskHeight();
    const targetTop = clamp(el._startTop + el._dy, 0, dayHeight() - h);
    el.style.transform = 'translateY(0px)';
    el.style.top = `${snapPx(targetTop)}px`;
    el.classList.remove('dragging');
    snapAndPersist(el);
    autosizeTaskText(el);
  });

  // RESIZE
  interact(el).resizable({
    edges: { top: true, bottom: true, left: false, right: false },
    inertia:false
  })
  .on('resizestart', ()=>{
    el.style.transform = 'translateY(0px)';
    el.classList.add('dragging');
  })
  .on('resizemove', (evt)=>{
    const curTop = parseFloat(el.style.top) || 0;
    const curH   = parseFloat(el.style.height) || minTaskHeight();

    let newTop = curTop + (evt.deltaRect.top || 0);
    let newH   = curH   + (evt.deltaRect.height || 0);

    newTop = clamp(newTop, 0, dayHeight() - minTaskHeight());
    newH   = clamp(newH,   minTaskHeight(), dayHeight() - newTop);

    el.style.top = `${newTop}px`;
    el.style.height = `${newH}px`;
    autosizeTaskText(el);
  })
  .on('resizeend', ()=>{
    el.classList.remove('dragging');
    snapAndPersist(el);
    autosizeTaskText(el);
  });
}

function setupDropzones(){
  interact('.day').dropzone({
    accept: '.task',
    ondrop(evt){
      const card = evt.relatedTarget;
      const from = card.dataset.day;
      const to   = evt.target.dataset.day;
      if(from===to) return;

      const moved = takeTaskFromDay(from, card.dataset.id);
      if(!moved) return;

      tasks[to].push(moved);
      evt.target.appendChild(card);
      card.dataset.day = to;

      const rect = evt.target.getBoundingClientRect();
      const y = clamp((evt.dragEvent?.clientY ?? rect.top) - rect.top + evt.target.scrollTop,
                      0, dayHeight()-minTaskHeight());
      card.style.transform = 'translateY(0px)';
      card.style.top = `${snapPx(y)}px`;
      snapAndPersist(card);
      saveToStorage();
      autosizeTaskText(card);
    }
  });
}

/***** PERSIST/SNAP *****/
function takeTaskFromDay(day, id){
  const i = tasks[day].findIndex(t=>t.id===id);
  if(i>=0){ const [t]=tasks[day].splice(i,1); return t; }
  return null;
}

function snapAndPersist(el){
  const day = el.dataset.day;
  const t = findTask(day, el.dataset.id);
  if(!t) return;

  const top = snapPx(parseFloat(el.style.top) || 0);
  const height = Math.max(minTaskHeight(), snapPx(parseFloat(el.style.height) || minTaskHeight()));
  const maxTop = dayHeight() - height;

  el.style.top = `${Math.min(top, snapPx(maxTop))}px`;
  el.style.height = `${height}px`;

  t.startMin    = yToMinutes(parseFloat(el.style.top));
  t.durationMin = Math.max(
    SLOT_MINUTES,
    Math.round((parseFloat(el.style.height) * MINUTES_PER_PIXEL) / SLOT_MINUTES) * SLOT_MINUTES
  );

  saveToStorage();
}

function findTask(day,id){ return tasks[day].find(t=>t.id===id); }

/***** FIT TO VIEWPORT (vertical responsiveness) *****/
function fitCalendarToViewport(){
  const body = document.querySelector('.cal-body');
  const totalSlots = (END_HOUR - START_HOUR) * 2;

  // How much vertical space do we have from the top of the grid to bottom of viewport?
  const top = body.getBoundingClientRect().top + window.scrollY;
  const available = window.innerHeight - (body.getBoundingClientRect().top) - 24; // 24px bottom buffer

  // Choose slot size; keep a sensible minimum so tasks remain clickable
  const slot = Math.max(12, available / totalSlots);

  // Apply to CSS var and set the body height (so everything lines up)
  setSlotHeight(slot);
  body.style.height = `${slot * totalSlots}px`;

  // Reposition grid lines (we set absolute tops in build)
  document.querySelectorAll('.day').forEach(dayEl=>{
    const lines = dayEl.querySelectorAll('.grid-row');
    lines.forEach((line, idx)=> line.style.top = `${idx * SLOT_HEIGHT}px`);
  });

  // Reposition tasks with the new scale
  DAYS.forEach(day=>{
    const dayEl = document.getElementById(`day-${day}`);
    tasks[day].forEach(t=>{
      const el = dayEl.querySelector(`.task[data-id="${t.id}"]`);
      if(!el) return;
      el.style.top = `${minutesToY(t.startMin)}px`;
      el.style.height = `${t.durationMin * PIXELS_PER_MINUTE}px`;
      autosizeTaskText(el);
    });
  });
}

/***** TEXT AUTOSIZING *****/
function autosizeAllTaskText(){
  document.querySelectorAll('.task').forEach(el => autosizeTaskText(el));
}
function autosizeTaskText(el){
  const title = el.querySelector('.task-title') || el;
  const h = el.clientHeight || 0;

  // font size scales with card height (clamped)
  const fs = Math.max(10, Math.min(16, Math.floor(h * 0.40))); // 10–16px
  title.style.fontSize = `${fs}px`;
  title.style.lineHeight = '1.2';

  // compute how many lines fit and clamp
  const lines = Math.max(1, Math.floor((h - 8) / (fs * 1.2)));
  title.style.display = '-webkit-box';
  title.style.webkitBoxOrient = 'vertical';
  title.style.setProperty('-webkit-line-clamp', String(lines));
}

/***** NOW LINE (visual only) *****/
function drawNowLine(){
  const now = new Date();
  const minutes = now.getHours()*60 + now.getMinutes();
  const start = START_HOUR*60, end = END_HOUR*60;
  const visible = minutes>=start && minutes<=end;

  for(const day of DAYS){
    const dayEl = document.getElementById(`day-${day}`);
    const line = dayEl.querySelector('.now-line');
    if(!visible){ line.style.display="none"; continue; }
    line.style.display="block";
    const y = minutesToY(minutes-start);
    line.style.top = `${y}px`;
  }
}

/***** BUTTONS *****/
function wireTopButtons(){
  document.getElementById("exportBtn").addEventListener("click", ()=>{
    const data = "data:text/json;charset=utf-8,"+encodeURIComponent(JSON.stringify(tasks,null,2));
    const a = document.createElement("a"); a.href=data; a.download="planner.json"; a.click();
  });
  document.getElementById("importBtn").addEventListener("click", ()=> document.getElementById("importFile").click());
  document.getElementById("importFile").addEventListener("change", (e)=>{
    const r = new FileReader();
    r.onload = ()=>{
      try{
        const parsed = JSON.parse(r.result);
        if(typeof parsed==='object' && parsed){
          tasks = parsed; saveToStorage(); renderAllTasks(); fitCalendarToViewport();
        } else alert("Invalid JSON.");
      }catch{ alert("Could not parse JSON."); }
    };
    r.readAsText(e.target.files[0]);
  });
  document.getElementById("clearBtn").addEventListener("click", ()=>{
    if(!confirm("Clear all tasks?")) return;
    tasks={}; for(const d of DAYS) tasks[d]=[];
    saveToStorage(); renderAllTasks(); fitCalendarToViewport();
  });
}

function wireAddButtons(){
  document.querySelectorAll('.addBtn').forEach(b=>{
    b.addEventListener('click', ()=> addTask(b.dataset.day));
  });
}

function addTask(day, partial={}){
  const t = {
    id: crypto.randomUUID? crypto.randomUUID() : String(Date.now()+Math.random()),
    title: partial.title ?? DEFAULT_TASK.title,
    color: partial.color ?? DEFAULT_TASK.color,
    startMin: partial.startMin ?? DEFAULT_TASK.startMin,
    durationMin: partial.durationMin ?? DEFAULT_TASK.durationMin
  };
  tasks[day].push(t); saveToStorage();
  renderTask(document.getElementById(`day-${day}`), t);
  fitCalendarToViewport(); // ensure fonts/positions correct with current scale
}

/***** HELPERS *****/
function formatHour(h){
  const ampm = h<12 ? "AM":"PM";
  const hh = ((h+11)%12)+1;
  return `${hh}:00 ${ampm}`;
}
function minutesToY(mins){ return Math.round(mins * PIXELS_PER_MINUTE); }
function yToMinutes(y){
  return clamp(Math.round(y * MINUTES_PER_PIXEL / SLOT_MINUTES)*SLOT_MINUTES,
               0, (END_HOUR-START_HOUR)*60);
}
function snapPx(px){ return Math.round(px / SLOT_HEIGHT) * SLOT_HEIGHT; }
function minTaskHeight(){ return SLOT_HEIGHT; }
function dayHeight(){ return (END_HOUR-START_HOUR)*60*PIXELS_PER_MINUTE; }
function clamp(v,min,max){ return Math.max(min, Math.min(max,v)); }
function debounce(fn,ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }

const COLORS = ["color-blue","color-green","color-yellow","color-pink","color-purple","color-orange"];
function cycleColor(task, el){
  const next = COLORS[(COLORS.indexOf(task.color)+1)%COLORS.length];
  el.classList.remove(task.color); el.classList.add(next);
  task.color = next;
}
