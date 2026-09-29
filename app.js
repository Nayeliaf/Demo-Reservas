const CONFIG={
  hotel:"Hotel Aurora",
  rooms:[
    {id:"101",name:"Habitación Deluxe",type:"Deluxe",capacity:2,price:120,photo:"assets/deluxe.svg"},
    {id:"102",name:"Habitación Deluxe",type:"Deluxe",capacity:2,price:120,photo:"assets/deluxe-2.svg"},
    {id:"201",name:"Suite Familiar",type:"Suite",capacity:4,price:185,photo:"assets/suite.svg"},
    {id:"202",name:"Suite Familiar",type:"Suite",capacity:4,price:185,photo:"assets/suite-2.svg"},
    {id:"301",name:"Habitación Premium",type:"Premium",capacity:3,price:155,photo:"assets/premium.svg"},
    {id:"302",name:"Habitación Premium",type:"Premium",capacity:3,price:155,photo:"assets/premium-2.svg"}
  ]
};
const KEY="hotel_v3_reservations", STATUS="hotel_v3_status";
const state={checkin:null,checkout:null,rooms:1,adults:2,children:0,selectedRoom:null,cursor:new Date(new Date().getFullYear(),new Date().getMonth(),1)};
function iso(d){return new Date(d).toISOString().slice(0,10)}
function today(){return iso(new Date())}
function addDays(n){const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()+n);return iso(d)}
function dt(s){const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d,12)}
function fmt(s){return dt(s).toLocaleDateString("es-419",{day:"2-digit",month:"short"}).replace(".","")}
function nights(a,b){return a&&b?Math.max(0,Math.round((dt(b)-dt(a))/86400000)):0}
function money(n){return "$"+Number(n).toLocaleString("es-419",{minimumFractionDigits:0})}
function getReservations(){try{return JSON.parse(localStorage.getItem(KEY))||[]}catch{return[]}}
function setReservations(x){localStorage.setItem(KEY,JSON.stringify(x))}
function getStatus(){try{return JSON.parse(localStorage.getItem(STATUS))||{}}catch{return{}}}
function setStatus(x){localStorage.setItem(STATUS,JSON.stringify(x))}
function overlap(a,b,c,d){return dt(a)<dt(d)&&dt(b)>dt(c)}
function seed(){if(!localStorage.getItem(KEY)){setReservations([{id:"RES-1001",roomId:"101",guestName:"María López",guestEmail:"maria@example.com",guests:2,checkin:addDays(1),checkout:addDays(4),total:360,status:"active"},{id:"RES-1002",roomId:"201",guestName:"Carlos Pérez",guestEmail:"carlos@example.com",guests:3,checkin:addDays(3),checkout:addDays(6),total:555,status:"active"}])}}
function available(room,a,b,g){if(!room||room.capacity<g)return false;let s=getStatus()[room.id]||"available";if(s!=="available")return false;return !getReservations().some(r=>r.status==="active"&&r.roomId===room.id&&overlap(a,b,r.checkin,r.checkout))}
function showToast(msg){const t=document.getElementById("toast");if(!t)return;t.textContent=msg;t.classList.remove("hidden");setTimeout(()=>t.classList.add("hidden"),2400)}
function openSheet(id){document.getElementById("backdrop").classList.remove("hidden");document.getElementById(id).classList.remove("hidden")}
function closeSheet(id){document.getElementById(id).classList.add("hidden");if([...document.querySelectorAll(".bottom-sheet")].every(x=>x.classList.contains("hidden")))document.getElementById("backdrop").classList.add("hidden")}
function photoStyle(room){return room.photo?`style="background-image:url('${room.photo}');background-size:cover;background-position:center"`:""}
function renderRooms(){
 const grid=document.getElementById("roomGrid"); if(!grid)return;
 const a=state.checkin||today(),b=state.checkout||addDays(1),g=state.adults+state.children;
 const rooms=CONFIG.rooms.filter(r=>available(r,a,b,g));
 grid.innerHTML=rooms.map(r=>`<article class="room-card"><div class="room-photo" ${photoStyle(r)}><span class="photo-label">${r.photo?"":"COLOCA AQUÍ TU FOTO"}</span></div><div class="room-content"><div class="room-title"><div><span class="eyebrow">${r.type}</span><h3>${r.name}</h3></div><span class="rating">★ 4.8</span></div><p>Una habitación cómoda y luminosa. Sustituye este texto por la descripción real, servicios y características.</p><div class="amenities"><span>♟ ${r.capacity} huéspedes</span><span>Wi-Fi</span><span>Baño privado</span></div><div class="room-footer"><div class="price"><strong>${money(r.price)}</strong> <small>/ noche</small></div><button class="select-room" data-room="${r.id}">Seleccionar</button></div></div></article>`).join("");
 if(!rooms.length)grid.innerHTML=`<div class="empty-room"><h3>No hay habitaciones disponibles</h3><p>Prueba otras fechas o cambia el número de huéspedes.</p></div>`;
 grid.querySelectorAll(".select-room").forEach(b=>b.onclick=()=>{state.selectedRoom=b.dataset.room;updateSummary();document.getElementById("reservationPanel").scrollIntoView({behavior:"smooth",block:"center"});showToast("Habitación seleccionada")});
}
function updateSummary(){
 const a=state.checkin,b=state.checkout,g=state.adults+state.children,r=CONFIG.rooms.find(x=>x.id===state.selectedRoom),n=nights(a,b),sub=r?r.price*n:0,tax=Math.round(sub*.05);
 document.getElementById("dateLabel").textContent=a&&b?`${fmt(a)} → ${fmt(b)}`:"Seleccionar fechas";
 document.getElementById("guestLabel").textContent=`${state.rooms} ${state.rooms===1?"habitación":"habitaciones"}, ${g} ${g===1?"huésped":"huéspedes"}`;
 document.getElementById("sideIn").textContent=a?fmt(a):"—";document.getElementById("sideOut").textContent=b?fmt(b):"—";document.getElementById("sideNights").textContent=`${n} ${n===1?"noche":"noches"}`;
 document.getElementById("sideRoom").textContent=r?`${r.name} · Hab. ${r.id}`:"Selecciona una habitación";document.getElementById("sideGuest").textContent=`${g} huéspedes`;
 document.getElementById("sideSubtotal").textContent=money(sub);document.getElementById("sideTax").textContent=money(tax);document.getElementById("sideTotal").textContent=money(sub+tax);
 document.getElementById("formRoom").textContent=r?`${r.name} #${r.id}`:"—";document.getElementById("formDates").textContent=a&&b?`${fmt(a)} → ${fmt(b)}`:"—";document.getElementById("formTotal").textContent=money(sub+tax);
 document.getElementById("sheetIn").textContent=a?fmt(a):"—";document.getElementById("sheetOut").textContent=b?fmt(b):"—";
}
function renderCalendar(){
 const el=document.getElementById("calendarGrid"),d=state.cursor,y=d.getFullYear(),m=d.getMonth(),first=new Date(y,m,1),days=new Date(y,m+1,0).getDate(),offset=(first.getDay()+6)%7;
 document.getElementById("monthTitle").textContent=d.toLocaleDateString("es-419",{month:"long",year:"numeric"});
 let h=["LUN","MAR","MIÉ","JUE","VIE","SÁB","DOM"].map(x=>`<div class="weekday">${x}</div>`).join("");
 for(let i=0;i<offset;i++)h+="<button class='cal-day disabled'></button>";
 for(let n=1;n<=days;n++){const x=new Date(y,m,n),s=iso(x),disabled=s<today(),selected=s===state.checkin||s===state.checkout,range=state.checkin&&state.checkout&&s>state.checkin&&s<state.checkout;h+=`<button class="cal-day ${disabled?"disabled":""} ${selected?"selected":""} ${range?"range":""}" data-date="${s}" ${disabled?"disabled":""}>${n}</button>`}
 el.innerHTML=h;
 el.querySelectorAll("[data-date]").forEach(b=>b.onclick=()=>pickDate(b.dataset.date));
}
function pickDate(s){
 if(!state.checkin||state.checkout||s<=state.checkin){state.checkin=s;state.checkout=null}
 else {state.checkout=s}
 renderCalendar();updateSummary();
 if(state.checkin&&state.checkout){setTimeout(()=>showToast("Fechas seleccionadas"),150)}
}
function initPublic(){
 seed();state.checkin=today();state.checkout=addDays(1);updateSummary();renderRooms();renderCalendar();
 document.getElementById("openDates").onclick=()=>{openSheet("dateSheet");renderCalendar()};
 document.getElementById("openGuests").onclick=()=>openSheet("guestSheet");
 document.querySelectorAll(".close-sheet").forEach(b=>b.onclick=()=>closeSheet(b.dataset.close));
 document.getElementById("backdrop").onclick=()=>{document.querySelectorAll(".bottom-sheet").forEach(x=>x.classList.add("hidden"));document.getElementById("backdrop").classList.add("hidden")};
 document.getElementById("prevMonth").onclick=()=>{state.cursor.setMonth(state.cursor.getMonth()-1);renderCalendar()};
 document.getElementById("nextMonth").onclick=()=>{state.cursor.setMonth(state.cursor.getMonth()+1);renderCalendar()};
 document.getElementById("dateDone").onclick=()=>{if(!state.checkin||!state.checkout){showToast("Selecciona entrada y salida");return}closeSheet("dateSheet");renderRooms();updateSummary()};
 document.querySelectorAll("[data-counter]").forEach(b=>b.onclick=()=>{const k=b.dataset.counter,dir=Number(b.dataset.dir);state[k]=Math.max(k==="adults"?1:0,Math.min(k==="rooms"?3:k==="adults"?6:6,state[k]+dir));document.getElementById(k+"Count").textContent=state[k];updateSummary()});
 document.getElementById("guestDone").onclick=()=>{closeSheet("guestSheet");renderRooms();updateSummary()};
 document.getElementById("searchBtn").onclick=()=>{if(!state.checkin||!state.checkout){openSheet("dateSheet");return}renderRooms();document.getElementById("rooms").scrollIntoView({behavior:"smooth"})};
 document.getElementById("continueBtn").onclick=()=>{if(!state.selectedRoom){showToast("Primero selecciona una habitación");return}document.getElementById("formGuests").value=state.adults+state.children;document.getElementById("checkout").scrollIntoView({behavior:"smooth"})};
 document.getElementById("bookingForm").onsubmit=submitBooking;
 document.getElementById("year").textContent=new Date().getFullYear();
}
function submitBooking(e){
 e.preventDefault();if(!state.selectedRoom||!state.checkin||!state.checkout){showToast("Completa fechas y habitación");return}
 const r=CONFIG.rooms.find(x=>x.id===state.selectedRoom),g=Number(document.getElementById("formGuests").value);
 if(!available(r,state.checkin,state.checkout,g)){showToast("La habitación ya no está disponible");renderRooms();return}
 const n=nights(state.checkin,state.checkout),total=Math.round(r.price*n*1.05),res={id:"RES-"+Date.now().toString().slice(-7),roomId:r.id,guestName:document.getElementById("guestName").value,guestEmail:document.getElementById("guestEmail").value,guestPhone:document.getElementById("guestPhone").value,guests:g,checkin:state.checkin,checkout:state.checkout,total,status:"active"};
 setReservations([...getReservations(),res]);showToast("¡Reserva confirmada! "+res.id);e.target.reset();state.selectedRoom=null;renderRooms();updateSummary();
}
function initAdmin(){
 seed();document.getElementById("todayText").textContent=new Date().toLocaleDateString("es-419",{weekday:"long",day:"numeric",month:"long",year:"numeric"});let cur=new Date(new Date().getFullYear(),new Date().getMonth(),1);
 document.getElementById("resetData").onclick=()=>{setReservations([]);setStatus({});location.reload()};
 const render=()=>{renderStats();renderStatuses();renderTable();renderAdminCalendar(cur)};
 document.getElementById("reservationFilter").onchange=render;
 document.getElementById("prevAdmin").onclick=()=>{cur.setMonth(cur.getMonth()-1);render()};
 document.getElementById("nextAdmin").onclick=()=>{cur.setMonth(cur.getMonth()+1);render()};render();
}
function renderStats(){const a=getReservations().filter(x=>x.status==="active"),t=today();document.getElementById("arrivals").textContent=a.filter(x=>x.checkin===t).length;document.getElementById("departures").textContent=a.filter(x=>x.checkout===t).length;document.getElementById("occupied").textContent=CONFIG.rooms.filter(r=>a.some(x=>x.roomId===r.id&&overlap(t,addDays(1),x.checkin,x.checkout))).length;document.getElementById("totalReservations").textContent=a.length}
function renderStatuses(){const el=document.getElementById("statusGrid"),map={available:"Disponible",occupied:"Ocupada",dirty:"Vacante sucia"},s=getStatus();el.innerHTML=CONFIG.rooms.map(r=>{let current=s[r.id]||"available";const booked=getReservations().some(x=>x.status==="active"&&x.roomId===r.id&&overlap(today(),addDays(1),x.checkin,x.checkout));if(booked)current="occupied";return `<div class="status-card"><div class="status-card-top"><strong>Hab. ${r.id}</strong><span>${money(r.price)}</span></div><small>${r.name} · hasta ${r.capacity} huéspedes</small><span class="status-badge ${current}">${map[current]}</span><select data-status="${r.id}"><option value="available" ${current==="available"?"selected":""}>Disponible</option><option value="occupied" ${current==="occupied"?"selected":""}>Ocupada</option><option value="dirty" ${current==="dirty"?"selected":""}>Vacante sucia</option></select></div>`}).join("");el.querySelectorAll("[data-status]").forEach(x=>x.onchange=()=>{let s=getStatus();s[x.dataset.status]=x.value;setStatus(s);renderStatuses()})}
function esc(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function renderTable(){const f=document.getElementById("reservationFilter").value,rows=getReservations().filter(x=>f==="all"||x.status===f);document.getElementById("reservationTable").innerHTML=rows.map(r=>`<tr><td><strong>${r.id}</strong></td><td>${esc(r.guestName)}<br><small>${esc(r.guestEmail)}</small></td><td>#${r.roomId}</td><td>${fmt(r.checkin)} → ${fmt(r.checkout)}</td><td>${money(r.total)}</td><td><span class="status-badge ${r.status==="active"?"available":"dirty"}">${r.status==="active"?"Activa":"Cancelada"}</span></td><td>${r.status==="active"?`<button class="cancel" data-cancel="${r.id}">Cancelar</button>`:""}</td></tr>`).join("");document.querySelectorAll("[data-cancel]").forEach(b=>b.onclick=()=>{let x=getReservations();setReservations(x.map(r=>r.id===b.dataset.cancel?{...r,status:"cancelled"}:r));renderTable();renderStats()})}
function renderAdminCalendar(cur){const el=document.getElementById("adminCalendar"),y=cur.getFullYear(),m=cur.getMonth(),first=new Date(y,m,1),last=new Date(y,m+1,0),off=(first.getDay()+6)%7;document.getElementById("adminMonth").textContent=cur.toLocaleDateString("es-419",{month:"long",year:"numeric"});let h=["LUN","MAR","MIÉ","JUE","VIE","SÁB","DOM"].map(x=>`<div class="head">${x}</div>`).join("");for(let i=0;i<off;i++)h+=`<div class="admin-day muted"></div>`;for(let d=1;d<=last.getDate();d++){const s=iso(new Date(y,m,d)),bs=getReservations().filter(r=>r.status==="active"&&r.checkin<=s&&r.checkout>s);h+=`<div class="admin-day"><b>${d}</b>${bs.slice(0,3).map(r=>`<span class="booking-mini">#${r.roomId} ${esc(r.guestName)}</span>`).join("")}</div>`}el.innerHTML=h}
if(document.getElementById("bookingForm"))initPublic();if(document.getElementById("statusGrid"))initAdmin();