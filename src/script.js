const RU_DAYS = ["Воскресенье","Понедельник","Вторник","Среда","Четверг","Пятница","Суббота"];
const EN_TO_IDX = {Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
const REFRESH_MS = 15000;

let windowMode = "4";
let selectedKey = null;
let selectedTz = "Asia/Almaty";
let teacherFilter = "";
let groupFilter = "";
let roomFilter = "";
let swapOrder = false;

function getZoned(tz){
  const now = new Date();
  if(tz === "local"){
    return {
      hour: now.getHours(), minute: now.getMinutes(), second: now.getSeconds(),
      dayName: RU_DAYS[now.getDay()],
      dateStr: now.toLocaleDateString("ru-RU", {day:"numeric", month:"long", year:"numeric"})
    };
  }
  const dtf = new Intl.DateTimeFormat("en-US", {timeZone:tz, hour12:false, hour:"2-digit", minute:"2-digit", second:"2-digit", weekday:"short"});
  const parts = dtf.formatToParts(now);
  const get = t => parts.find(p=>p.type===t).value;
  const hour = parseInt(get("hour"),10) % 24;
  const minute = parseInt(get("minute"),10);
  const second = parseInt(get("second"),10);
  const idx = EN_TO_IDX[get("weekday")];
  const dateStr = now.toLocaleDateString("ru-RU", {timeZone:tz, day:"numeric", month:"long", year:"numeric"});
  return {hour, minute, second, dayName: RU_DAYS[idx], dateStr};
}

function pad(n){ return String(n).padStart(2,"0"); }

function typeClass(t){
  if(t === "Лекция") return "type-lecture";
  if(t === "Практика") return "type-practice";
  if(t === "Лабораторная") return "type-lab";
  return "type-other";
}

function roomSortKey(r){
  const m = r.match(/^([0-9]+)/);
  return m ? [0, parseInt(m[1],10), r] : [1, 0, r];
}

function roomSortKeyCmp(a,b){
  const ka=roomSortKey(a), kb=roomSortKey(b);
  if(ka[0]!==kb[0]) return ka[0]-kb[0];
  if(ka[1]!==kb[1]) return ka[1]-kb[1];
  return ka[2].localeCompare(kb[2]);
}

function minutesToLabel(mins){
  mins = Math.round(mins);
  const h = Math.floor(mins/60), m = mins%60;
  return pad(h)+":"+pad(m);
}

function lessonKey(l){
  return l.teacher+"|"+l.day+"|"+l.start+"|"+l.room;
}

function render(){
  const z = getZoned(selectedTz);
  document.getElementById("clock").textContent =
    pad(z.hour)+":"+pad(z.minute)+":"+pad(z.second);
  const todayName = z.dayName;
  document.getElementById("dateline").textContent = todayName + " · " + z.dateStr;

  const nowMin = z.hour*60 + z.minute + z.second/60;
  const todaysAll = LESSONS.filter(l => l.day === todayName);

  const boardwrap = document.getElementById("boardwrap");
  const summary = document.getElementById("summary");

  if(todaysAll.length === 0){
    boardwrap.innerHTML = emptyState(
      "Сегодня, " + todayName.toLowerCase() + ", занятий по кафедре ИС нет",
      "Расписание рабочее с понедельника по пятницу."
    );
    summary.textContent = "";
    return;
  }

  const todaysFiltered = todaysAll.filter(l =>
    (!teacherFilter || l.teacher === teacherFilter) &&
    (!roomFilter || l.room === roomFilter) &&
    (!groupFilter || l.group.toLowerCase().includes(groupFilter.toLowerCase()))
  );

  if(todaysFiltered.length === 0){
    boardwrap.innerHTML = emptyState(
      "По выбранным фильтрам сегодня занятий нет",
      "Попробуйте изменить преподавателя, аудиторию, группу или нажмите «Сбросить фильтры»."
    );
    summary.textContent = "";
    return;
  }

  let winStart, winEnd;
  if(windowMode === "day"){
    let mn = Math.min(nowMin, ...todaysFiltered.map(l=>l.startMin));
    let mx = Math.max(nowMin, ...todaysFiltered.map(l=>l.endMin));
    winStart = Math.max(0, Math.floor((mn-15)/30)*30);
    winEnd = Math.min(1440, Math.ceil((mx+15)/30)*30);
  } else {
    winStart = nowMin - 10;
    winEnd = winStart + parseInt(windowMode,10)*60;
  }

  let visible = todaysFiltered.filter(l => l.endMin > winStart && l.startMin < winEnd);

  if(visible.length === 0){
    const upcoming = todaysFiltered.filter(l => l.startMin >= nowMin).sort((a,b)=>a.startMin-b.startMin)[0];
    if(upcoming){
      boardwrap.innerHTML = emptyState(
        "Сейчас занятий нет",
        "Ближайшее — в " + upcoming.start + ", ауд. " + upcoming.room + " (" + upcoming.discipline + ")"
      );
    } else {
      boardwrap.innerHTML = emptyState("На сегодня занятия закончились", "Следующие занятия — по расписанию другого дня.");
    }
    summary.textContent = "";
    return;
  }

  const rooms = Array.from(new Set(visible.map(l=>l.room))).sort(roomSortKeyCmp);

  const liveCount = visible.filter(l => l.startMin <= nowMin && l.endMin > nowMin).length;
  const filterNote = (teacherFilter || groupFilter || roomFilter) ? " · фильтр активен" : "";
  const windowLabel = windowMode==="day" ? "за весь день" : ("окно <b>"+minutesToLabel(Math.max(winStart,0))+"–"+minutesToLabel(winEnd)+"</b>");
  summary.innerHTML = "Сейчас идёт <b>"+liveCount+"</b> занят"+plural(liveCount)+" · показано "+windowLabel+" · "+rooms.length+" аудитори"+plural2(rooms.length)+filterNote;

  const swapBtn = document.getElementById("swapBtn");
  const isListMode = (windowMode === "1");
  swapBtn.classList.toggle("visible", isListMode);
  swapBtn.classList.toggle("active", swapOrder);

  if(isListMode){
    renderListView(visible, nowMin);
    return;
  }

  const span = winEnd - winStart;
  const ticks = [];
  let t0 = Math.ceil(winStart/30)*30;
  for(let t=t0; t<=winEnd; t+=30){
    ticks.push(t);
  }

  const rulerTicks = ticks.map(t=>{
    const pct = (t-winStart)/span*100;
    return '<div class="tick" style="left:'+pct.toFixed(2)+'%">'+minutesToLabel(t)+'</div>';
  }).join("");

  const rowsHtml = rooms.map(room=>{
    const lessonsInRoom = visible.filter(l=>l.room===room);
    const blocks = lessonsInRoom.map(l=>{
      let left = (l.startMin-winStart)/span*100;
      let right = (l.endMin-winStart)/span*100;
      left = Math.max(0,left); right = Math.min(100,right);
      const width = Math.max(right-left, 2);
      const key = lessonKey(l);
      const cls = typeClass(l.type) + (l.online ? " online" : "") + (key===selectedKey ? " selected" : "");
      const shortTeacher = l.teacher.split(" ").slice(0,2).join(" ");
      return '<div class="block '+cls+'" data-key="'+encodeURIComponent(key)+'" style="left:'+left.toFixed(2)+'%;width:'+width.toFixed(2)+'%">'
        +'<div class="t-name">'+escapeHtml(shortTeacher)+'</div>'
        +'<div class="t-sub">'+escapeHtml(l.discipline)+'</div>'
        +'<div class="t-meta">'+escapeHtml(l.room)+' · '+escapeHtml(l.group)+'</div>'
        +'</div>';
    }).join("");
    return '<div class="row"><div class="room-col">'+escapeHtml(room)+'</div><div class="track">'+vlines(ticks,winStart,span)+blocks+'</div></div>';
  }).join("");

  let nowLineHtml = "";
  if(nowMin >= winStart && nowMin <= winEnd){
    const pct = (nowMin-winStart)/span*100;
    nowLineHtml = '<div class="nowline" id="nowline" style="left:'+pct.toFixed(2)+'%">'
      +'<div class="nowhead"></div><div class="nowtag">'+pad(z.hour)+":"+pad(z.minute)+'</div></div>';
  }

  boardwrap.innerHTML =
    '<div class="board">'
    +'<div class="ruler"><div class="ruler-label-col"></div><div class="ruler-track">'+rulerTicks+'</div></div>'
    +'<div class="rows" style="position:relative">'+rowsHtml+nowLineOverlay(nowLineHtml)+'</div>'
    +'</div>';

  document.querySelectorAll(".block").forEach(el=>{
    el.addEventListener("click", (ev)=>{
      ev.stopPropagation();
      handleItemClick(el, visible);
    });
  });
}

function renderListView(visible, nowMin){
  const boardwrap = document.getElementById("boardwrap");
  const items = visible.slice().sort((a,b)=>
    swapOrder
      ? (roomSortKeyCmp(a.room,b.room) || a.startMin-b.startMin)
      : (a.startMin-b.startMin || a.room.localeCompare(b.room))
  );
  const rows = items.map(l=>{
    const key = lessonKey(l);
    const live = l.startMin<=nowMin && l.endMin>nowMin;
    const cls = typeClass(l.type) + (l.online ? " online" : "") + (key===selectedKey ? " selected" : "");
    const timeHtml = '<div class="list-time mono">'+l.start+'–'+l.end+(live?' <span style="color:var(--now)">●</span>':'')+'</div>';
    const roomHtml = '<div class="list-room mono">'+escapeHtml(l.room)+'</div>';
    const topHtml = swapOrder ? (roomHtml+timeHtml) : (timeHtml+roomHtml);
    return '<div class="list-item '+cls+'" data-key="'+encodeURIComponent(key)+'">'
      +'<div class="li-top">'+topHtml+'</div>'
      +'<div class="li-bottom">'
      +'<div class="list-teacher">'+escapeHtml(l.teacher.split(" ").slice(0,2).join(" "))+'</div>'
      +'<div class="list-subject">'+escapeHtml(l.discipline)+'</div>'
      +'<div class="list-group mono">'+escapeHtml(l.group)+'</div>'
      +'</div>'
      +'</div>';
  }).join("");

  const timeHead = '<span style="width:100px;flex-shrink:0;">Время</span>';
  const roomHead = '<span style="width:84px;flex-shrink:0;">Ауд.</span>';
  const headTop = swapOrder ? (roomHead+timeHead) : (timeHead+roomHead);

  boardwrap.innerHTML =
    '<div class="board">'
    +'<div class="listhead">'+headTop+'<span style="flex:1.2;">Преподаватель</span><span style="flex:2;">Предмет</span><span style="flex:1;">Группа</span></div>'
    +rows
    +'</div>';

  document.querySelectorAll(".list-item").forEach(el=>{
    el.addEventListener("click", (ev)=>{
      ev.stopPropagation();
      handleItemClick(el, items);
    });
  });
}

function handleItemClick(el, sourceArr){
  const key = decodeURIComponent(el.getAttribute("data-key"));
  if(selectedKey === key){
    selectedKey = null;
    hideDetailPopup();
  } else {
    selectedKey = key;
    const lesson = sourceArr.find(l=>lessonKey(l)===key);
    if(lesson) showDetailPopup(lesson, el);
  }
  render();
}

function nowLineOverlay(html){
  if(!html) return "";
  return '<div style="position:absolute; top:0; left:150px; right:0; bottom:0; pointer-events:none;">'+html+'</div>';
}

function vlines(ticks, winStart, span){
  return ticks.map(t=>{
    const pct=(t-winStart)/span*100;
    return '<div class="vline" style="left:'+pct.toFixed(2)+'%"></div>';
  }).join("");
}

function showDetailPopup(l, anchorEl){
  const pop = document.getElementById("detailPopup");
  pop.innerHTML =
    '<button class="closepop" id="closePopBtn" aria-label="Закрыть">×</button>'
    +'<div class="detail-top">'
    +'<div><div class="detail-room mono">'+escapeHtml(l.room)+'</div></div>'
    +'<div class="detail-time mono">'+l.start+'–'+l.end+' · '+escapeHtml(l.day)+'</div>'
    +'</div>'
    +'<div class="detail-subject">'+escapeHtml(l.discipline)+'</div>'
    +'<div class="detail-meta">'
    +'<span class="badge '+typeClass(l.type)+'">'+escapeHtml(l.type)+(l.online?" · онлайн":"")+'</span>'
    +escapeHtml(l.teacher)+'<br>'
    +escapeHtml(l.group)+' · '+escapeHtml(l.level)
    +'</div>';
  pop.classList.add("show");
  document.getElementById("closePopBtn").addEventListener("click", (ev)=>{
    ev.stopPropagation();
    selectedKey = null;
    hideDetailPopup();
    render();
  });

  const rect = anchorEl.getBoundingClientRect();
  pop.style.left = "-9999px";
  pop.style.top = "-9999px";
  requestAnimationFrame(()=>{
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = rect.right + 12;
    let top = rect.top;
    if(left + pw > vw - 10){ left = rect.left - pw - 12; }
    if(left < 10){ left = Math.min(Math.max(rect.left, 10), vw - pw - 10); }
    if(top + ph > vh - 10){ top = vh - ph - 10; }
    if(top < 10) top = 10;
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  });
}

function hideDetailPopup(){
  document.getElementById("detailPopup").classList.remove("show");
}

function emptyState(big, small){
  hideDetailPopup();
  selectedKey = null;
  return '<div class="board"><div class="empty-state"><div class="big">'+escapeHtml(big)+'</div><div>'+escapeHtml(small)+'</div></div></div>';
}

function plural(n){
  const m = n%10, m2=n%100;
  if(m2>=11 && m2<=14) return "ий";
  if(m===1) return "ие";
  if(m>=2 && m<=4) return "ия";
  return "ий";
}
function plural2(n){
  const m = n%10, m2=n%100;
  if(m2>=11 && m2<=14) return "й";
  if(m===1) return "я";
  if(m>=2 && m<=4) return "и";
  return "й";
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

document.getElementById("winbtns").addEventListener("click", (e)=>{
  const btn = e.target.closest(".winbtn");
  if(!btn) return;
  windowMode = btn.getAttribute("data-h");
  document.querySelectorAll(".winbtn").forEach(b=>b.classList.toggle("active", b===btn));
  selectedKey = null;
  hideDetailPopup();
  render();
});
document.querySelector('.winbtn[data-h="4"]').classList.add("active");

document.getElementById("swapBtn").addEventListener("click", ()=>{
  swapOrder = !swapOrder;
  selectedKey = null;
  hideDetailPopup();
  render();
});

document.getElementById("tzSelect").addEventListener("change", (e)=>{
  selectedTz = e.target.value;
  render();
});

const teacherSelectEl = document.getElementById("teacherSelect");
Array.from(new Set(LESSONS.map(l=>l.teacher))).sort((a,b)=>a.localeCompare(b,"ru")).forEach(name=>{
  const opt = document.createElement("option");
  opt.value = name; opt.textContent = name;
  teacherSelectEl.appendChild(opt);
});
teacherSelectEl.addEventListener("change", (e)=>{
  teacherFilter = e.target.value;
  render();
});

const roomSelectEl = document.getElementById("roomSelect");
Array.from(new Set(LESSONS.map(l=>l.room))).sort(roomSortKeyCmp).forEach(room=>{
  const opt = document.createElement("option");
  opt.value = room; opt.textContent = room;
  roomSelectEl.appendChild(opt);
});
roomSelectEl.addEventListener("change", (e)=>{
  roomFilter = e.target.value;
  render();
});

const groupInputEl = document.getElementById("groupInput");
groupInputEl.addEventListener("input", (e)=>{
  groupFilter = e.target.value;
  render();
});

document.getElementById("clearFilters").addEventListener("click", ()=>{
  teacherFilter = ""; groupFilter = ""; roomFilter = "";
  teacherSelectEl.value = ""; groupInputEl.value = ""; roomSelectEl.value = "";
  render();
});

document.addEventListener("click", (e)=>{
  const pop = document.getElementById("detailPopup");
  if(!pop.classList.contains("show")) return;
  if(pop.contains(e.target)) return;
  selectedKey = null;
  hideDetailPopup();
  render();
});
document.addEventListener("keydown", (e)=>{
  if(e.key === "Escape"){
    selectedKey = null;
    hideDetailPopup();
    render();
  }
});

render();
setInterval(render, REFRESH_MS);
setInterval(()=>{
  const z = getZoned(selectedTz);
  const c = document.getElementById("clock");
  if(c) c.textContent = pad(z.hour)+":"+pad(z.minute)+":"+pad(z.second);
}, 1000);
