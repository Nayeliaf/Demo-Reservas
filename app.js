// ================================================================
// HOTEL AURORA - SISTEMA DE RESERVAS
// Frontend + integración con Google Apps Script
// ================================================================

// ========== CONFIGURACIÓN ==========
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz_hsQmnphUFGnNDRYs3KmgwVA0vvxBQcRAE3JWKG9wg4zwODfakdgLI0eWarvrEdBE/exec'; // Pegar URL al desplegar
// Si está vacío, usa modo demo (localStorage)
const DEMO_MODE = !APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes('TU_URL');

// ========== ESTADO GLOBAL ==========
const state = {
  checkin: null,
  checkout: null,
  rooms: 1,
  adults: 2,
  children: 0,
  selectedType: null,
  cursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  config: null,
  bcvRate: 36.50,
  currentReservation: null,
  currentPaymentMethod: null,
  captureFile: null,
  captureBase64: null,
  reservations: [],
  roomStatus: {},
  adminCursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
};

// ========== UTILIDADES ==========
function iso(d) { return new Date(d).toISOString().slice(0, 10); }
function today() { return iso(new Date()); }
function addDays(n) {
  const d = new Date(); d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n); return iso(d);
}
function dt(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); }
function fmt(s) { return dt(s).toLocaleDateString('es-419', { day: '2-digit', month: 'short' }); }
function nights(a, b) { return a && b ? Math.max(1, Math.round((dt(b) - dt(a)) / 86400000)) : 0; }
function money(n) { return '$ ' + Number(n).toLocaleString('es-419', { minimumFractionDigits: 0 }); }
function moneyBcv(n) { return 'Bs. ' + Number(n).toLocaleString('es-419', { minimumFractionDigits: 2 }); }
function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast ' + type;
  setTimeout(() => t.classList.add('hidden'), 3000);
}

// ========== API CLIENT ==========
async function api(action, data = {}) {
  if (DEMO_MODE) return demoApi(action, data);
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...data })
    });
    const json = await res.json();
    if (json && json.error) throw new Error(json.error);
    return json;
  } catch (err) {
    console.warn('API error, usando demo local:', err);
    showToast('Backend no disponible. Se continúa en modo demo local.', 'error');
    return demoApi(action, data);
  }
}

async function apiGet(action, params = {}) {
  if (DEMO_MODE) return demoApi(action, params);
  try {
    const url = new URL(APPS_SCRIPT_URL);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString());
    const json = await res.json();
    if (json && json.error) throw new Error(json.error);
    return json;
  } catch (err) {
    console.warn('API GET error, usando demo local:', err);
    return demoApi(action, params);
  }
}

// ========== MODO DEMO (localStorage) ==========
const DEMO_KEY = 'hotel_aurora_demo_v5';
const DEMO_STATUS_KEY = 'hotel_aurora_status_v5';

function demoApi(action, data) {
  return new Promise(resolve => {
    setTimeout(() => {
      let store = JSON.parse(localStorage.getItem(DEMO_KEY) || '{"reservations":[]}');
      let statuses = JSON.parse(localStorage.getItem(DEMO_STATUS_KEY) || '{}');

      if (action === 'config') {
        resolve(getDefaultConfig());
      } else if (action === 'rate') {
        resolve({ rate: 36.50, date: new Date().toISOString(), source: 'demo' });
      } else if (action === 'reservations') {
        let res = store.reservations;
        if (data.status && data.status !== 'all') res = res.filter(r => r.status === data.status);
        resolve(res);
      } else if (action === 'rooms') {
        const config = getDefaultConfig();
        const status = {};
        const t = today();

        config.roomTypes.forEach(type => {
          const prefix = type.id === 'junior' ? 'J' : 'D';
          for (let i = 1; i <= type.total; i++) {
            const id = prefix + i;
            let st = statuses[id] || 'available';

            const active = store.reservations.filter(r =>
              r.roomId === id &&
              !['cancelled', 'checked-out'].includes(r.status)
            );

            const checkedInRes = active.find(r => r.status === 'checked-in');
            const currentRes = checkedInRes ||
              active.find(r => r.status === 'confirmed' && r.checkin <= t && r.checkout > t);

            if (st === 'dirty') {
              // Manual dirty state wins until reception marks it clean.
            } else if (checkedInRes) {
              st = 'occupied';
            } else if (currentRes) {
              st = 'reserved';
            } else {
              st = 'available';
            }

            status[id] = {
              status: st,
              type: type.name,
              roomType: type.id,
              currentReservation: currentRes || null
            };
          }
        });
        resolve(status);
      } else if (action === 'book') {
        const config = getDefaultConfig();
        const type = config.roomTypes.find(t => t.id === data.roomType);
        // Verificar disponibilidad
        const conflicts = store.reservations.filter(r =>
          r.roomType === data.roomType &&
          ['pending', 'confirmed', 'checked-in'].includes(r.status) &&
          datesOverlap(r.checkin, r.checkout, data.checkin, data.checkout)
        );
        if (conflicts.length >= type.total) {
          resolve({ error: 'No hay habitaciones disponibles de este tipo' });
          return;
        }
        // Asignar habitación
        let roomId = null;
        const prefix = type.id === 'junior' ? 'J' : 'D';
        for (let i = 1; i <= type.total; i++) {
          const id = prefix + i;
          const occupied = store.reservations.some(r =>
            r.roomId === id &&
            ['pending', 'confirmed', 'checked-in'].includes(r.status) &&
            datesOverlap(r.checkin, r.checkout, data.checkin, data.checkout)
          );
          if (!occupied) { roomId = id; break; }
        }
        const ns = nights(data.checkin, data.checkout);
        const total = ns * type.price;
        const res = {
          id: 'RES-' + Date.now().toString().slice(-8),
          roomType: data.roomType,
          roomId: roomId,
          guest: data.guest,
          checkin: data.checkin,
          checkout: data.checkout,
          checkinTime: '',
          checkoutTime: '',
          nights: ns,
          usdTotal: total,
          bcvTotal: (total * state.bcvRate).toFixed(2),
          paymentMethod: data.paymentMethod,
          paymentStatus: data.paymentMethod === 'efectivo' ? 'pending-cash' : 'pending-capture',
          captureUrl: '',
          status: 'pending',
          createdAt: new Date().toISOString()
        };
        store.reservations.push(res);
        localStorage.setItem(DEMO_KEY, JSON.stringify(store));
        resolve({ success: true, reservation: res });
      } else if (action === 'uploadCapture') {
        const idx = store.reservations.findIndex(r => r.id === data.reservationId);
        if (idx >= 0) {
          store.reservations[idx].captureUrl = data.captureBase64;
          store.reservations[idx].paymentStatus = 'pending-review';
          localStorage.setItem(DEMO_KEY, JSON.stringify(store));
        }
        resolve({ success: true });
      } else if (action === 'confirmPayment') {
        const idx = store.reservations.findIndex(r => r.id === data.reservationId);
        if (idx >= 0) {
          store.reservations[idx].status = 'confirmed';
          store.reservations[idx].paymentStatus = 'paid';
          localStorage.setItem(DEMO_KEY, JSON.stringify(store));
        }
        resolve({ success: true });
      } else if (action === 'checkin') {
        const idx = store.reservations.findIndex(r => r.id === data.reservationId);
        if (idx >= 0) {
          store.reservations[idx].status = 'checked-in';
          store.reservations[idx].checkinTime = new Date().toISOString();
          localStorage.setItem(DEMO_KEY, JSON.stringify(store));
        }
        if (data.roomId) statuses[data.roomId] = 'occupied';
        localStorage.setItem(DEMO_STATUS_KEY, JSON.stringify(statuses));
        resolve({ success: true });
      } else if (action === 'checkout') {
        const idx = store.reservations.findIndex(r => r.id === data.reservationId);
        if (idx >= 0) {
          store.reservations[idx].status = 'checked-out';
          store.reservations[idx].checkoutTime = new Date().toISOString();
          localStorage.setItem(DEMO_KEY, JSON.stringify(store));
        }
        if (data.roomId) statuses[data.roomId] = 'dirty';
        localStorage.setItem(DEMO_STATUS_KEY, JSON.stringify(statuses));
        resolve({ success: true });
      } else if (action === 'clean') {
        if (data.roomId) statuses[data.roomId] = 'available';
        localStorage.setItem(DEMO_STATUS_KEY, JSON.stringify(statuses));
        resolve({ success: true });
      } else if (action === 'cancel') {
        const idx = store.reservations.findIndex(r => r.id === data.reservationId);
        if (idx >= 0) {
          store.reservations[idx].status = 'cancelled';
          localStorage.setItem(DEMO_KEY, JSON.stringify(store));
        }
        resolve({ success: true });
      } else if (action === 'updateDates') {
        const idx = store.reservations.findIndex(r => r.id === data.reservationId);
        if (idx < 0) { resolve({ error: 'Reserva no encontrada' }); return; }

        const r = store.reservations[idx];
        if (data.checkout <= data.checkin) {
          resolve({ error: 'El check-out debe ser posterior al check-in' }); return;
        }

        const conflict = store.reservations.some(x =>
          x.id !== r.id &&
          x.roomType === r.roomType &&
          x.roomId === r.roomId &&
          ['pending', 'confirmed', 'checked-in'].includes(x.status) &&
          datesOverlap(x.checkin, x.checkout, data.checkin, data.checkout)
        );
        if (conflict) {
          resolve({ error: 'Las nuevas fechas chocan con otra reserva de la misma habitación' }); return;
        }

        const type = getDefaultConfig().roomTypes.find(t => t.id === r.roomType);
        r.checkin = data.checkin;
        r.checkout = data.checkout;
        r.nights = nights(data.checkin, data.checkout);
        r.usdTotal = r.nights * type.price;
        r.bcvTotal = (r.usdTotal * state.bcvRate).toFixed(2);
        localStorage.setItem(DEMO_KEY, JSON.stringify(store));
        resolve({ success: true, reservation: r });
      }
      resolve({});
    }, 200);
  });
}

function getDefaultConfig() {
  return {
    hotel: 'Hotel Aurora',
    roomTypes: [
      {
        id: 'junior', name: 'Habitación Junior',
        description: 'Acogedora habitación ideal para viajeros individuales o parejas. Cama queen, vista lateral, baño privado con ducha.',
        capacity: { min: 1, max: 2 }, total: 2, price: 80,
        includes: ['Wi-Fi', 'A/C', 'TV 42"', 'Baño privado', 'Desayuno'],
        photo: 'junior.svg'
      },
      {
        id: 'doble', name: 'Habitación Doble',
        description: 'Amplia habitación para familias o grupos. Dos camas matrimoniales, sala de estar, baño completo con tina.',
        capacity: { min: 3, max: 4 }, total: 3, price: 140,
        includes: ['Wi-Fi', 'A/C', 'TV 50"', 'Sala de estar', 'Baño con tina', 'Desayuno', 'Minibar'],
        photo: 'doble.svg'
      }
    ],
    paymentMethods: [
      {
        id: 'pago_movil', name: 'Pago Móvil',
        details: { banco: 'Banco de Venezuela', telefono: '0412-1234567', cedula: 'V-12345678' },
        instructions: 'Realiza el pago móvil y sube la captura.'
      },
      {
        id: 'transferencia', name: 'Transferencia Bancaria',
        details: { banco: 'Banesco', cuenta: '0134-0000-00-0000000000', titular: 'Hotel Aurora C.A.', rif: 'J-12345678-9' },
        instructions: 'Realiza la transferencia y sube el comprobante.'
      },
      {
        id: 'zelle', name: 'Zelle (Internacional)',
        details: { email: 'pagos@hotelaurora.com', titular: 'Hotel Aurora LLC' },
        instructions: 'Envía el pago por Zelle y adjunta el recibo.'
      },
      {
        id: 'efectivo', name: 'Efectivo USD (al llegar)',
        details: { nota: 'Se paga al momento del check-in en recepción.' },
        instructions: 'No requiere captura. Pagarás al llegar.'
      }
    ]
  };
}

function datesOverlap(a1, a2, b1, b2) {
  const ad1 = new Date(a1), ad2 = new Date(a2);
  const bd1 = new Date(b1), bd2 = new Date(b2);
  return ad1 < bd2 && ad2 > bd1;
}

// ========== MODALES ==========
function openSheet(id) {
  document.getElementById('backdrop').classList.remove('hidden');
  document.getElementById(id).classList.remove('hidden');
}
function closeSheet(id) {
  document.getElementById(id).classList.add('hidden');
  const anyOpen = [...document.querySelectorAll('.bottom-sheet')].some(x => !x.classList.contains('hidden'));
  if (!anyOpen) document.getElementById('backdrop').classList.add('hidden');
}
function closeAllSheets() {
  document.querySelectorAll('.bottom-sheet').forEach(x => x.classList.add('hidden'));
  document.getElementById('backdrop').classList.add('hidden');
}

// ========== INICIALIZACIÓN PÚBLICA ==========
async function initPublic() {
  state.checkin = today();
  state.checkout = addDays(1);
  await loadConfig();
  await loadBcvRate();
  await refreshPublicAvailability();

  document.getElementById('year').textContent = new Date().getFullYear();

  // Event listeners
  document.getElementById('openDates').onclick = () => { openSheet('dateSheet'); renderPublicCalendar(); };
  document.getElementById('openGuests').onclick = () => openSheet('guestSheet');
  document.querySelectorAll('.close-sheet').forEach(b => b.onclick = () => closeSheet(b.dataset.close));
  document.getElementById('backdrop').onclick = closeAllSheets;
  document.getElementById('prevMonth').onclick = () => { state.cursor.setMonth(state.cursor.getMonth() - 1); renderPublicCalendar(); };
  document.getElementById('nextMonth').onclick = () => { state.cursor.setMonth(state.cursor.getMonth() + 1); renderPublicCalendar(); };
  document.getElementById('dateDone').onclick = () => {
    if (!state.checkin || !state.checkout) { showToast('Selecciona entrada y salida', 'error'); return; }
    closeSheet('dateSheet'); refreshPublicAvailability().then(() => { renderRoomTypes(); updatePublicSummary(); });
  };
  document.querySelectorAll('[data-counter]').forEach(b => b.onclick = () => {
    const k = b.dataset.counter, dir = Number(b.dataset.dir);
    const min = k === 'adults' ? 1 : 0;
    const max = k === 'rooms' ? 3 : 10;
    state[k] = Math.max(min, Math.min(max, state[k] + dir));
    document.getElementById(k + 'Count').textContent = state[k];
    updatePublicSummary();
  });
  document.getElementById('guestDone').onclick = () => { closeSheet('guestSheet'); refreshPublicAvailability().then(() => { renderRoomTypes(); updatePublicSummary(); }); };
  document.getElementById('searchBtn').onclick = async () => {
    if (!state.checkin || !state.checkout) { openSheet('dateSheet'); return; }
    await refreshPublicAvailability();
    renderRoomTypes();
    document.getElementById('rooms').scrollIntoView({ behavior: 'smooth' });
  };
  document.getElementById('continueBtn').onclick = () => {
    if (!state.selectedType) { showToast('Primero selecciona una habitación', 'error'); return; }
    openInvoiceSheet();
  };
  document.getElementById('guestForm').onsubmit = onGuestFormSubmit;
  document.getElementById('captureInput').onchange = onCaptureSelect;
  document.getElementById('confirmBookingBtn').onclick = confirmBooking;

  renderRoomTypes();
  updatePublicSummary();
}

async function loadConfig() {
  const cfg = await apiGet('config');
  state.config = cfg.error ? getDefaultConfig() : cfg;
}

async function loadBcvRate() {
  const r = await apiGet('rate');
  if (r.rate) {
    state.bcvRate = r.rate;
    document.querySelectorAll('.bcv-rate').forEach(el => el.textContent = state.bcvRate.toFixed(2));
  }
}

// Devuelve cuántas unidades de un tipo siguen libres para las fechas elegidas.
// La asignación real se vuelve a verificar en Apps Script al guardar la reserva.
function availableUnits(type, a, b) {
  const reservations = state.reservations || [];
  const used = reservations.filter(r =>
    r.roomType === type.id &&
    ['pending', 'confirmed', 'checked-in'].includes(r.status) &&
    datesOverlap(r.checkin, r.checkout, a, b)
  ).length;
  return Math.max(0, type.total - used);
}

async function refreshPublicAvailability() {
  try {
    const rs = await apiGet('reservations', { status: 'all' });
    state.reservations = rs.error ? [] : rs;
  } catch (_) {
    state.reservations = [];
  }
}

// ========== RENDER PÚBLICO ==========
function renderRoomTypes() {
  const grid = document.getElementById('roomGrid');
  if (!grid || !state.config) return;

  const a = state.checkin || today(), b = state.checkout || addDays(1);
  const g = state.adults + state.children;

  grid.innerHTML = state.config.roomTypes.map(type => {
    const fits = g >= type.capacity.min && g <= type.capacity.max;
    const available = availableUnits(type, a, b);
    const ns = nights(a, b);
    const totalUsd = ns * type.price;
    const totalBcv = totalUsd * state.bcvRate;
    const canSelect = fits && available >= state.rooms;

    return `
      <article class="room-card">
        <div class="room-photo" style="background-image:url('${esc(type.photo)}')">
          <span class="photo-label">${esc(type.name)}</span>
          <span class="availability-pill ${available ? 'available' : 'soldout'}">
            ${available ? `${available} disponible${available === 1 ? '' : 's'}` : 'Agotada'}
          </span>
        </div>
        <div class="room-content">
          <div class="room-title">
            <div>
              <span class="eyebrow">${type.capacity.min}-${type.capacity.max} HUÉSPEDES</span>
              <h3>${esc(type.name)}</h3>
            </div>
          </div>
          <p>${esc(type.description)}</p>
          <div class="amenities">${type.includes.map(i => `<span>${esc(i)}</span>`).join('')}</div>
          <div class="price-block">
            <div class="usd">${money(type.price)} <small>/ noche</small></div>
            <div class="bcv">${moneyBcv(type.price * state.bcvRate)} / noche · ${ns} ${ns === 1 ? 'noche' : 'noches'} = ${money(totalUsd)}</div>
          </div>
          <div class="room-footer">
            <div style="font-size:11px;color:var(--muted)">
              ${type.total} unidades · ${available} libres
            </div>
            <button class="select-room" data-type="${type.id}" ${!canSelect ? 'disabled' : ''}>
              ${!fits ? 'No admite este grupo' : !available ? 'Sin disponibilidad' : `Seleccionar ${state.rooms > 1 ? state.rooms + ' hab.' : ''}`}
            </button>
          </div>
        </div>
      </article>`;
  }).join('');

  grid.querySelectorAll('.select-room').forEach(b => b.onclick = () => {
    state.selectedType = b.dataset.type;
    updatePublicSummary();
    document.getElementById('reservationPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast('Habitación seleccionada', 'success');
  });
}

function updatePublicSummary() {
  const a = state.checkin, b = state.checkout;
  const g = state.adults + state.children;
  const type = state.config?.roomTypes.find(t => t.id === state.selectedType);
  const ns = nights(a, b);
  const sub = type ? type.price * ns : 0;
  const tax = Math.round(sub * 0.05);
  const total = sub + tax;

  document.getElementById('dateLabel').textContent = a && b ? `${fmt(a)} → ${fmt(b)}` : 'Seleccionar fechas';
  document.getElementById('guestLabel').textContent = `${state.rooms} hab., ${state.adults} adultos${state.children ? ', ' + state.children + ' niños' : ''}`;
  document.getElementById('sideIn').textContent = a ? fmt(a) : '—';
  document.getElementById('sideOut').textContent = b ? fmt(b) : '—';
  document.getElementById('sideNights').textContent = `${ns} ${ns === 1 ? 'noche' : 'noches'}`;
  document.getElementById('sideRoom').textContent = type ? type.name : 'Selecciona una habitación';
  document.getElementById('sideGuest').textContent = `${g} ${g === 1 ? 'huésped' : 'huéspedes'}`;
  document.getElementById('sideSubtotal').textContent = money(sub);
  document.getElementById('sideTax').textContent = money(tax);
  document.getElementById('sideTotal').textContent = money(total);
  document.getElementById('sideBcv').textContent = `≈ ${moneyBcv(total * state.bcvRate)}`;
}

function renderPublicCalendar() {
  const el = document.getElementById('calendarGrid');
  const d = state.cursor, y = d.getFullYear(), m = d.getMonth();
  const first = new Date(y, m, 1);
  const days = new Date(y, m + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7;

  document.getElementById('monthTitle').textContent = d.toLocaleDateString('es-419', { month: 'long', year: 'numeric' });

  let h = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'].map(x => `<div class="weekday">${x}</div>`).join('');
  for (let i = 0; i < offset; i++) h += `<button class="cal-day disabled"></button>`;
  for (let n = 1; n <= days; n++) {
    const x = new Date(y, m, n), s = iso(x);
    const disabled = s < today();
    const selected = s === state.checkin || s === state.checkout;
    const range = state.checkin && state.checkout && s > state.checkin && s < state.checkout;
    h += `<button class="cal-day ${disabled ? 'disabled' : ''} ${selected ? 'selected' : ''} ${range ? 'range' : ''}" data-date="${s}" ${disabled ? 'disabled' : ''}>${n}</button>`;
  }
  el.innerHTML = h;
  el.querySelectorAll('[data-date]').forEach(b => b.onclick = () => pickPublicDate(b.dataset.date));

  document.getElementById('sheetIn').textContent = state.checkin ? fmt(state.checkin) : '—';
  document.getElementById('sheetOut').textContent = state.checkout ? fmt(state.checkout) : '—';
}

function pickPublicDate(s) {
  if (!state.checkin || state.checkout || s <= state.checkin) {
    state.checkin = s; state.checkout = null;
  } else {
    state.checkout = s;
  }
  renderPublicCalendar();
  if (state.checkin && state.checkout) setTimeout(() => showToast('Fechas seleccionadas', 'success'), 150);
}

// ========== FACTURA / CHECKOUT ==========
function openInvoiceSheet() {
  const type = state.config.roomTypes.find(t => t.id === state.selectedType);
  if (!type) return;
  const ns = nights(state.checkin, state.checkout);
  const sub = type.price * ns;
  const tax = Math.round(sub * 0.05);
  const total = sub + tax;

  const invId = 'PRO-' + Date.now().toString().slice(-6);
  document.getElementById('invId').textContent = invId;
  document.getElementById('invDate').textContent = new Date().toLocaleDateString('es-419');
  document.getElementById('invRoom').textContent = `${type.name} (${type.capacity.min}-${type.capacity.max} pax)`;
  document.getElementById('invCheckin').textContent = fmt(state.checkin);
  document.getElementById('invCheckout').textContent = fmt(state.checkout);
  document.getElementById('invNights').textContent = `${ns} noches`;
  document.getElementById('invGuests').textContent = `${state.adults} adultos, ${state.children} niños`;
  document.getElementById('invBody').innerHTML = `
    <tr>
      <td>${esc(type.name)} · ${ns} noches a ${money(type.price)}</td>
      <td>${ns}</td>
      <td>${money(type.price)}</td>
      <td style="text-align:right">${money(sub)}</td>
    </tr>
    <tr><td>Impuestos (5%)</td><td></td><td></td><td style="text-align:right">${money(tax)}</td></tr>`;
  document.getElementById('invSubtotal').textContent = money(sub);
  document.getElementById('invTax').textContent = money(tax);
  document.getElementById('invTotal').textContent = money(total);
  document.getElementById('invBcvTotal').textContent = moneyBcv(total * state.bcvRate);
  document.getElementById('invRate').textContent = state.bcvRate.toFixed(2);

  document.getElementById('payAmount').textContent = money(total);
  document.getElementById('payBcv').textContent = `≈ ${moneyBcv(total * state.bcvRate)}`;

  renderPaymentMethods();
  goToStep(1);
  openSheet('invoiceSheet');
}

function renderPaymentMethods() {
  const container = document.getElementById('paymentMethods');
  if (!state.config) return;
  container.innerHTML = state.config.paymentMethods.map(m => `
    <div class="payment-method" data-method="${m.id}">
      <h4>${esc(m.name)}</h4>
      <p>${esc(m.instructions)}</p>
      <div class="payment-details">
        ${Object.entries(m.details).map(([k, v]) => `<div class="detail-row"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('')}
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.payment-method').forEach(el => el.onclick = () => {
    container.querySelectorAll('.payment-method').forEach(x => x.classList.remove('selected'));
    el.classList.add('selected');
    state.currentPaymentMethod = el.dataset.method;
    document.getElementById('captureSection').classList.toggle('hidden', state.currentPaymentMethod === 'efectivo');
  });
}

function goToStep(n) {
  [1, 2, 3].forEach(i => {
    const el = document.getElementById('invoiceStep' + i);
    if (el) el.classList.toggle('hidden', i !== n);
  });
  document.querySelectorAll('.step').forEach(el => {
    const s = Number(el.dataset.step);
    el.classList.remove('active', 'done');
    if (s < n) el.classList.add('done');
    else if (s === n) el.classList.add('active');
  });
}

async function onGuestFormSubmit(e) {
  e.preventDefault();
  const guest = {
    name: document.getElementById('gName').value.trim(),
    idNumber: document.getElementById('gId').value.trim(),
    age: Number(document.getElementById('gAge').value),
    phone: document.getElementById('gPhone').value.trim(),
    email: document.getElementById('gEmail').value.trim(),
    adults: Number(document.getElementById('gAdults').value),
    children: Number(document.getElementById('gChildren').value),
    specialRequest: document.getElementById('gSpecial').value.trim()
  };
  if (guest.adults + guest.children < 1) { showToast('Debe haber al menos 1 huésped', 'error'); return; }
  state.currentReservation = { guest };
  goToStep(3);
}

function onCaptureSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Archivo demasiado grande (máx 5MB)', 'error'); return; }
  state.captureFile = file;
  const reader = new FileReader();
  reader.onload = ev => {
    state.captureBase64 = ev.target.result;
    document.getElementById('capturePreview').src = ev.target.result;
    document.getElementById('capturePreview').classList.remove('hidden');
    document.getElementById('captureLabel').classList.add('has-file');
  };
  reader.readAsDataURL(file);
}

async function confirmBooking() {
  if (!state.currentPaymentMethod) { showToast('Selecciona un método de pago', 'error'); return; }
  if (state.currentPaymentMethod !== 'efectivo' && !state.captureBase64) {
    showToast('Debes subir la captura del pago', 'error'); return;
  }

  const btn = document.getElementById('confirmBookingBtn');
  btn.disabled = true; btn.textContent = 'Procesando...';

  try {
    const res = await api('book', {
      roomType: state.selectedType,
      checkin: state.checkin,
      checkout: state.checkout,
      guest: state.currentReservation.guest,
      paymentMethod: state.currentPaymentMethod
    });

    if (res.error) { showToast(res.error, 'error'); btn.disabled = false; btn.textContent = 'Confirmar reserva ✓'; return; }

    // Subir captura si aplica
    if (state.currentPaymentMethod !== 'efectivo' && state.captureBase64) {
      const fileName = state.currentReservation.guest.name.replace(/[^a-z0-9]/gi, '_');
      await api('uploadCapture', { reservationId: res.reservation.id, captureBase64: state.captureBase64, fileName });
    }

    closeSheet('invoiceSheet');
    document.getElementById('successId').textContent = res.reservation.id;
    openSheet('successSheet');

    // Reset
    state.selectedType = null; state.captureBase64 = null; state.captureFile = null; state.currentPaymentMethod = null;
    document.getElementById('guestForm').reset();
    document.getElementById('capturePreview').classList.add('hidden');
    document.getElementById('captureLabel').classList.remove('has-file');
    renderRoomTypes(); updatePublicSummary();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
  btn.disabled = false; btn.textContent = 'Confirmar reserva ✓';
}

// ========== ADMIN ==========
function initAdmin() {
  document.getElementById('todayText').textContent = new Date().toLocaleDateString('es-419', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  document.getElementById('resetData').onclick = async () => {
    if (!confirm('¿Restaurar datos demo? Se borrarán todas las reservas locales.')) return;
    localStorage.removeItem(DEMO_KEY); localStorage.removeItem(DEMO_STATUS_KEY);
    location.reload();
  };
  document.getElementById('reservationFilter').onchange = renderAdmin;
  document.getElementById('prevAdmin').onclick = () => { state.adminCursor.setMonth(state.adminCursor.getMonth() - 1); renderAdmin(); };
  document.getElementById('nextAdmin').onclick = () => { state.adminCursor.setMonth(state.adminCursor.getMonth() + 1); renderAdmin(); };
  document.querySelectorAll('.close-sheet').forEach(b => b.onclick = () => closeSheet(b.dataset.close));
  document.getElementById('backdrop').onclick = closeAllSheets;
  document.getElementById('editDatesForm').onsubmit = onEditDates;
  renderAdmin();
}

async function renderAdmin() {
  const reservations = await apiGet('reservations', { status: 'all' });
  const roomStatus = await apiGet('rooms');
  state.reservations = reservations.error ? [] : reservations;
  state.roomStatus = roomStatus.error ? {} : roomStatus;
  renderAdminStats();
  renderAdminStatuses();
  renderAdminTable();
  renderAdminCalendar();
}

function renderAdminStats() {
  const t = today();
  const active = state.reservations.filter(r => ['confirmed', 'checked-in'].includes(r.status));
  document.getElementById('statArrivals').textContent = active.filter(r => r.checkin === t).length;
  document.getElementById('statDepartures').textContent = active.filter(r => r.checkout === t).length;
  document.getElementById('statOccupied').textContent = Object.values(state.roomStatus).filter(s => s.status === 'occupied').length;
  document.getElementById('statTotal').textContent = state.reservations.filter(r => r.status !== 'cancelled').length;
}

function renderAdminStatuses() {
  const el = document.getElementById('statusGrid');
  const labels = {
    available: 'Disponible', occupied: 'Ocupada',
    dirty: 'Vacante Sucia', reserved: 'Reservada'
  };
  el.innerHTML = Object.entries(state.roomStatus).map(([id, info]) => {
    const st = info.status;
    const res = info.currentReservation;
    return `
      <div class="status-card">
        <div class="status-card-top">
          <strong>Hab. ${esc(id)}</strong>
          <small>${esc(info.type)}</small>
        </div>
        <small>Estado actual</small>
        <span class="status-badge status-${st}">${labels[st] || st}</span>
        ${res ? `<div style="font-size:11px;color:var(--muted);margin-top:5px">
          🏷 ${esc(res.id)} · ${esc(res.guest?.name || '—')}<br>
          ${res.checkin} → ${res.checkout}
        </div>` : ''}
        <div class="status-actions">
          ${res && (st === 'reserved' || st === 'confirmed') && res.checkin <= today() ? `<button class="btn-checkin" onclick="adminCheckin('${esc(id)}','${res?.id || ''}')">Check-in</button>` : ''}
          ${res && st === 'occupied' && res.checkout <= today() ? `<button class="btn-checkout" onclick="adminCheckout('${esc(id)}','${res?.id || ''}')">Check-out</button>` : ''}
          ${st === 'dirty' ? `<button class="btn-clean" onclick="adminClean('${esc(id)}')">Marcar limpia</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

function reservationStatusLabel(status) {
  return ({
    pending: 'Pendiente de pago',
    confirmed: 'Confirmada',
    'checked-in': 'Ocupada / Check-in',
    'checked-out': 'Finalizada',
    cancelled: 'Cancelada'
  })[status] || status;
}

function renderAdminTable() {
  const filter = document.getElementById('reservationFilter').value;
  const rows = state.reservations.filter(r => filter === 'all' || r.status === filter);
  const tbody = document.getElementById('reservationTable');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--muted)">No hay reservas</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td><strong style="cursor:pointer;color:var(--teal-dark)" onclick="openReservationDetail('${r.id}')">${esc(r.id)}</strong></td>
      <td>${esc(r.guest?.name || '—')}<br><small>${esc(r.guest?.email || '')}</small></td>
      <td>#${esc(r.roomId || '?')}</td>
      <td>${fmt(r.checkin)} → ${fmt(r.checkout)}</td>
      <td>${money(r.usdTotal || 0)}</td>
      <td><span class="status-badge status-${r.status}">${reservationStatusLabel(r.status)}</span></td>
      <td>
        <button class="btn-edit" onclick="openReservationDetail('${r.id}')">Ver</button>
      </td>
    </tr>
  `).join('');
}

function renderAdminCalendar() {
  const el = document.getElementById('adminCalendar');
  const cur = state.adminCursor;
  const y = cur.getFullYear(), m = cur.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const off = (first.getDay() + 6) % 7;
  const todayIso = today();

  document.getElementById('adminMonth').textContent = cur.toLocaleDateString('es-419', { month: 'long', year: 'numeric' });

  let h = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'].map(x => `<div class="head">${x}</div>`).join('');
  for (let i = 0; i < off; i++) h += `<div class="admin-day muted"></div>`;
  for (let d = 1; d <= last.getDate(); d++) {
    const s = iso(new Date(y, m, d));
    const bookings = state.reservations.filter(r =>
      r.status !== 'cancelled' && r.checkin <= s && r.checkout > s
    );
    const isToday = s === todayIso;
    h += `<div class="admin-day ${isToday ? 'today' : ''} ${bookings.length ? 'clickable' : ''}" ${bookings.length ? `onclick="openDaySheet('${s}')"` : ''}>
      <b>${d}</b>
      ${bookings.slice(0, 3).map(r => `
        <span class="booking-mini status-${r.status}" onclick="event.stopPropagation();openReservationDetail('${r.id}')">
          #${esc(r.roomId)} ${esc(r.guest?.name || '—')}
        </span>
      `).join('')}
      ${bookings.length > 3 ? `<small style="color:var(--muted)">+${bookings.length - 3} más</small>` : ''}
    </div>`;
  }
  el.innerHTML = h;
}

function openDaySheet(date) {
  document.getElementById('dayTitle').textContent = 'Reservas del ' + fmt(date);
  const bookings = state.reservations.filter(r => r.status !== 'cancelled' && r.checkin <= date && r.checkout > date);
  const content = document.getElementById('dayContent');
  if (!bookings.length) {
    content.innerHTML = '<p style="color:var(--muted)">No hay reservas este día</p>';
  } else {
    content.innerHTML = bookings.map(r => `
      <div style="padding:10px;background:var(--paper);border-radius:10px;margin-bottom:8px;cursor:pointer" onclick="closeSheet('daySheet');openReservationDetail('${r.id}')">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>#${esc(r.roomId)} · ${esc(r.guest?.name)}</strong>
          <span class="status-badge status-${r.status}">${r.status}</span>
        </div>
        <small style="color:var(--muted)">${fmt(r.checkin)} → ${fmt(r.checkout)}</small>
      </div>
    `).join('');
  }
  openSheet('daySheet');
}

async function openReservationDetail(id) {
  const r = state.reservations.find(x => x.id === id);
  if (!r) return;
  document.getElementById('detailTitle').textContent = 'Reserva ' + r.id;
  const statusLabels = {
    pending: 'Pendiente', confirmed: 'Confirmada', 'checked-in': 'Check-in',
    'checked-out': 'Check-out', cancelled: 'Cancelada'
  };

  const content = document.getElementById('reservationDetailContent');
  content.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px">
      <div>
        <strong style="font-size:18px;color:var(--plum)">#${esc(r.roomId || '?')} · ${esc(r.roomType || '?')}</strong>
      </div>
      <span class="status-badge status-${r.status}">${statusLabels[r.status] || r.status}</span>
    </div>
    <div class="guest-info">
      <h4>Datos del huésped</h4>
      <div class="info-row"><b>Nombre</b><span>${esc(r.guest?.name || '—')}</span></div>
      <div class="info-row"><b>Documento</b><span>${esc(r.guest?.idNumber || '—')}</span></div>
      <div class="info-row"><b>Edad</b><span>${r.guest?.age || '—'}</span></div>
      <div class="info-row"><b>Teléfono</b><span>${esc(r.guest?.phone || '—')}</span></div>
      <div class="info-row"><b>Correo</b><span>${esc(r.guest?.email || '—')}</span></div>
      <div class="info-row"><b>Adultos / Niños</b><span>${r.guest?.adults || 0} / ${r.guest?.children || 0}</span></div>
      <div class="info-row"><b>Solicitud</b><span>${esc(r.guest?.specialRequest || '—')}</span></div>
    </div>
    <div class="guest-info">
      <h4>Estadía</h4>
      <div class="info-row"><b>Check-in</b><span>${r.checkin} ${r.checkinTime ? '(' + new Date(r.checkinTime).toLocaleString('es-419') + ')' : ''}</span></div>
      <div class="info-row"><b>Check-out</b><span>${r.checkout} ${r.checkoutTime ? '(' + new Date(r.checkoutTime).toLocaleString('es-419') + ')' : ''}</span></div>
      <div class="info-row"><b>Noches</b><span>${r.nights || nights(r.checkin, r.checkout)}</span></div>
      <div class="info-row"><b>Total USD</b><span>${money(r.usdTotal || 0)}</span></div>
      <div class="info-row"><b>Total Bs</b><span>${moneyBcv(r.bcvTotal || 0)}</span></div>
      <div class="info-row"><b>Método de pago</b><span>${esc(r.paymentMethod || '—')}</span></div>
      <div class="info-row"><b>Estado de pago</b><span>${esc(r.paymentStatus || '—')}</span></div>
    </div>
    ${r.captureUrl ? `
      <div style="margin-top:10px">
        <strong>Captura del pago:</strong><br>
        <img src="${esc(r.captureUrl)}" class="capture-preview" style="max-width:100%">
      </div>` : ''}
    <div class="actions">
      ${r.status === 'pending' ? `<button class="btn-confirm" onclick="adminConfirm('${r.id}')">✓ Confirmar pago</button>` : ''}
      ${(r.status === 'confirmed' || r.status === 'reserved') ? `<button class="btn-checkin" onclick="adminCheckin('${r.roomId}','${r.id}')">Check-in</button>` : ''}
      ${r.status === 'checked-in' ? `<button class="btn-checkout" onclick="adminCheckout('${r.roomId}','${r.id}')">Check-out</button>` : ''}
      ${r.status !== 'cancelled' && r.status !== 'checked-out' ? `<button class="btn-edit" onclick="openEditDates('${r.id}','${r.checkin}','${r.checkout}')">Editar fechas</button>` : ''}
      ${r.status !== 'cancelled' && r.status !== 'checked-out' ? `<button class="btn-cancel" onclick="adminCancel('${r.id}')">Cancelar</button>` : ''}
    </div>
  `;
  openSheet('reservationDetailSheet');
}

async function adminConfirm(id) {
  if (!confirm('¿Confirmar pago y enviar ticket al huésped?')) return;
  await api('confirmPayment', { reservationId: id });
  showToast('Pago confirmado. Ticket enviado al huésped.', 'success');
  closeSheet('reservationDetailSheet');
  renderAdmin();
}

async function adminCheckin(roomId, resId) {
  if (!resId) { showToast('Sin reserva activa', 'error'); return; }
  if (!confirm('¿Hacer check-in del huésped?')) return;
  await api('checkin', { reservationId: resId, roomId });
  showToast('Check-in realizado. Habitación ocupada.', 'success');
  closeSheet('reservationDetailSheet');
  renderAdmin();
}

async function adminCheckout(roomId, resId) {
  if (!resId) { showToast('Sin reserva activa', 'error'); return; }
  if (!confirm('¿Hacer check-out? La habitación pasará a Vacante Sucia.')) return;
  await api('checkout', { reservationId: resId, roomId });
  showToast('Check-out realizado. Habitación marcada como sucia.', 'success');
  closeSheet('reservationDetailSheet');
  renderAdmin();
}

async function adminClean(roomId) {
  if (!confirm('¿Marcar habitación como limpia y disponible?')) return;
  await api('clean', { roomId });
  showToast('Habitación disponible nuevamente.', 'success');
  renderAdmin();
}

async function adminCancel(id) {
  if (!confirm('¿Cancelar esta reserva?')) return;
  await api('cancel', { reservationId: id });
  showToast('Reserva cancelada', 'success');
  closeSheet('reservationDetailSheet');
  renderAdmin();
}

function openEditDates(id, checkin, checkout) {
  document.getElementById('editResId').value = id;
  document.getElementById('editCheckin').value = checkin;
  document.getElementById('editCheckout').value = checkout;
  closeSheet('reservationDetailSheet');
  openSheet('editDatesSheet');
}

async function onEditDates(e) {
  e.preventDefault();
  const id = document.getElementById('editResId').value;
  const checkin = document.getElementById('editCheckin').value;
  const checkout = document.getElementById('editCheckout').value;
  if (checkout <= checkin) { showToast('El check-out debe ser posterior', 'error'); return; }
  const result = await api('updateDates', { reservationId: id, checkin, checkout });
  if (result.error) { showToast(result.error, 'error'); return; }
  showToast('Fechas actualizadas y total recalculado', 'success');
  closeSheet('editDatesSheet');
  renderAdmin();
}

// ========== BOOTSTRAP ==========
if (document.getElementById('bookingForm') || document.getElementById('roomGrid')) initPublic();
if (document.getElementById('statusGrid')) initAdmin();