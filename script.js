/***** CONFIG *****/
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const START_HOUR = 5;
const END_HOUR   = 23;
const SLOT_MINUTES = 30;

const SLOT_HEIGHT = parseInt(getComputedStyle(document.documentElement)
  .getPropertyValue('--slot-height')) || 24;
const MINUTES_PER_PIXEL = SLOT_MINUTES / SLOT_HEIGHT;
const PIXELS_PER_MINUTE = 1 / MINUTES_PER_PIXEL;

const DEFAULT_TASK = {
  title: "New Task",
  color: "color-blue",     // uses the Google-y color classes
  startMin: (9 - START_HOUR) * 60,
  durationMin: 60
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
drawNowLine(); // optional visual
setInterval(drawNowLine, 60 * 1000);

/***** STORAGE *****/
function saveToStorage(){ localStorage.setItem("tasks_v3", JSON.stringify(tasks)); }
function loadFromStorage(){ try{ return JSON.parse(localStorage.getItem("tasks_v3")) || {}; }catch{ return {}; }}

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

    // container for now-line per day
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
}

function renderTask(dayEl, task){
  const node = document.createElement("div");
  node.className = `task ${task.color}`;
  node.dataset.id = task.id;
  node.dataset.day = dayEl.dataset.day;
  node.style.top = `${minutesToY(task.startMin)}px`;
  node.style.height = `${task.durationMin * PIXELS_PER_MINUTE}px`;
  node.textContent = task.title;

  const hTop = document.createElement("div"); hTop.className="resize-handle top";
  const hBot = document.createElement("div"); hBot.className="resize-handle bottom";
  node.appendChild(hTop); node.appendChild(hBot);

  // interactions
  enableInteract(node);

  // quick color cycle
  node.addEventListener('click', e=>{
    if(e.detail===1){ cycleColor(task,node); saveToStorage(); }
  });

  // rename
  node.addEventListener('dblclick', ()=>{
    const t = prompt("Task name:", task.title);
    if(t!==null){
      task.title = t.trim() || task.title;
      node.textContent = task.title;
      node.appendChild(hTop); node.appendChild(hBot);
      saveToStorage();
    }
  });

  dayEl.appendChild(node);
}

/***** INTERACT *****/
function enableInteract(el){
  interact(el).draggable({
    inertia:false,
    listeners:{
      start(){ el.classList.add('dragging'); el._startTop = parseFloat(el.style.top)||0; },
      move(evt){
        const dy = evt.dy||0;
        const newTop = clamp(el._startTop + dy, 0, dayHeight() - minTaskHeight());
        el.style.top = `${newTop}px`;
      },
      end(){ el.classList.remove('dragging'); snapAndPersist(el); }
    }
  });

  interact(el).resizable({
    edges:{top:true,bottom:true,left:false,right:false},
    listeners:{
      move(evt){
        const dayEl = el.parentElement;
        const topLocal = clamp(evt.rect.y - dayEl.getBoundingClientRect().top + dayEl.scrollTop, 0, dayHeight());
        const bottom = clamp(topLocal + evt.rect.height, 0, dayHeight());
        const h = Math.max(bottom - topLocal, minTaskHeight());
        el.style.top = `${topLocal}px`;
        el.style.height = `${h}px`;
      },
      end(){ snapAndPersist(el); }
    }
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

      evt.target.appendChild(card);
      card.dataset.day = to;

      const rect = evt.target.getBoundingClientRect();
      const y = clamp((evt.dragEvent?.clientY ?? rect.top) - rect.top + evt.target.scrollTop, 0, dayHeight()-minTaskHeight());
      card.style.top = `${y}px`;
      snapAndPersist(card);

      tasks[to].push(moved);
      saveToStorage();
    }
  });
}

function takeTaskFromDay(day, id){
  const i = tasks[day].findIndex(t=>t.id===id);
  if(i>=0){ const [t]=tasks[day].splice(i,1); return t; }
  return null;
}

function snapAndPersist(el){
  const day = el.dataset.day;
  const t = findTask(day, el.dataset.id);
  if(!t) return;

  const top = snapPx(parseFloat(el.style.top)||0);
  const height = Math.max(minTaskHeight(), snapPx(parseFloat(el.style.height)));
  const maxTop = dayHeight() - height;

  el.style.top = `${Math.min(top, snapPx(maxTop))}px`;
  el.style.height = `${height}px`;

  t.startMin   = yToMinutes(parseFloat(el.style.top));
  t.durationMin = Math.max(SLOT_MINUTES, Math.round(parseFloat(el.style.height)*MINUTES_PER_PIXEL / SLOT_MINUTES)*SLOT_MINUTES);
  saveToStorage();
}

function findTask(day,id){ return tasks[day].find(t=>t.id===id); }

/***** UI BUTTONS *****/
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
          tasks = parsed; saveToStorage(); renderAllTasks();
        } else alert("Invalid JSON.");
      }catch{ alert("Could not parse JSON."); }
    };
    r.readAsText(e.target.files[0]);
  });
  document.getElementById("clearBtn").addEventListener("click", ()=>{
    if(!confirm("Clear all tasks?")) return;
    tasks={}; for(const d of DAYS) tasks[d]=[];
    saveToStorage(); renderAllTasks();
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
}

/***** NOW LINE (optional, purely visual) *****/
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

/***** HELPERS *****/
function formatHour(h){
  const ampm = h<12 ? "AM":"PM";
  const hh = ((h+11)%12)+1;
  return `${hh}:00 ${ampm}`;
}
function minutesToY(mins){ return Math.round(mins * PIXELS_PER_MINUTE); }
function yToMinutes(y){
  return clamp(Math.round(y * MINUTES_PER_PIXEL / SLOT_MINUTES)*SLOT_MINUTES, 0, (END_HOUR-START_HOUR)*60);
}
function snapPx(px){ return Math.round(px / SLOT_HEIGHT) * SLOT_HEIGHT; }
function minTaskHeight(){ return SLOT_HEIGHT; }
function dayHeight(){ return (END_HOUR-START_HOUR)*60*PIXELS_PER_MINUTE; }
function clamp(v,min,max){ return Math.max(min, Math.min(max,v)); }

const COLORS = ["color-blue","color-green","color-yellow","color-pink","color-purple","color-orange"];
function cycleColor(task, el){
  const next = COLORS[(COLORS.indexOf(task.color)+1)%COLORS.length];
  el.classList.remove(task.color); el.classList.add(next);
  task.color = next;
}
