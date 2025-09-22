const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const planner = document.getElementById("planner");
let tasks = JSON.parse(localStorage.getItem("tasks")) || {};

// Create day columns
days.forEach(day => {
  const col = document.createElement("div");
  col.className = "bg-white rounded-lg shadow p-2 flex flex-col min-h-[500px]";
  col.innerHTML = `<h2 class="font-bold text-center mb-2">${day}</h2>
                   <div class="day" id="${day}"></div>
                   <button class="addBtn mt-2 bg-blue-200 px-2 py-1 rounded">+ Add Task</button>`;
  planner.appendChild(col);

  col.querySelector(".addBtn").addEventListener("click", () => addTask(day));
});

// Add task function
function addTask(day, title="New Task", color="bg-yellow-200") {
  const task = document.createElement("div");
  task.className = `task ${color} p-2 mb-2 rounded shadow cursor-move`;
  task.textContent = title;
  document.getElementById(day).appendChild(task);
  saveTasks();
  makeDraggable(task);
}

// Save tasks to localStorage
function saveTasks() {
  tasks = {};
  days.forEach(day => {
    tasks[day] = [...document.getElementById(day).children].map(task => ({
      text: task.textContent,
      color: task.classList[1]
    }));
  });
  localStorage.setItem("tasks", JSON.stringify(tasks));
}

// Load tasks from storage
function loadTasks() {
  days.forEach(day => {
    if (tasks[day]) {
      tasks[day].forEach(t => addTask(day, t.text, t.color));
    }
  });
}
loadTasks();

// Make tasks draggable
function makeDraggable(el) {
  interact(el).draggable({
    inertia: true,
    listeners: {
      move(event) {
        const { target, dx, dy } = event;
        target.style.transform =
          (target.style.transform || "translate(0,0)") +
          ` translate(${dx}px, ${dy}px)`;
      },
      end(event) {
        event.target.style.transform = "none";
        saveTasks();
      }
    }
  });
}

// Export JSON
document.getElementById("exportBtn").addEventListener("click", () => {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(tasks));
  const link = document.createElement("a");
  link.href = dataStr;
  link.download = "planner.json";
  link.click();
});

// Import JSON
document.getElementById("importBtn").addEventListener("click", () => {
  document.getElementById("importFile").click();
});
document.getElementById("importFile").addEventListener("change", (event) => {
  const reader = new FileReader();
  reader.onload = () => {
    tasks = JSON.parse(reader.result);
    planner.innerHTML = "";
    location.reload();
  };
  reader.readAsText(event.target.files[0]);
});

// Clear all
document.getElementById("clearBtn").addEventListener("click", () => {
  localStorage.clear();
  location.reload();
});
