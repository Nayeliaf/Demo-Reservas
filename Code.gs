/*******************************************************
 * HOTEL AURORA — BACKEND GOOGLE APPS SCRIPT
 * 
 * 1. Pega este archivo en tu proyecto de Apps Script.
 * 2. Ejecuta una vez setup() desde el editor.
 * 3. Implementa como Aplicación web:
 *    - Ejecutar como: tú
 *    - Acceso: cualquiera con el enlace
 * 4. Usa la URL /exec en app.js.
 *******************************************************/

const APP = {
  HOTEL: 'Hotel Aurora',
  BCV_URL: 'https://www.bcv.org.ve/',
  SHEET_NAME: 'Reservas',
  ROOMS_SHEET: 'Habitaciones',
  PROP_SS_ID: 'HOTEL_AURORA_SS_ID',
  PROP_DRIVE_ID: 'HOTEL_AURORA_DRIVE_ID',
  TAX: 0.05
};

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  return json(handleAction(action, e.parameter || {}));
}

function doPost(e) {
  try {
    const body = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    return json(handleAction(body.action || '', body));
  } catch (err) {
    return json({ error: err.message });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function setup() {
  const ss = getSpreadsheet_();
  const sh = getReservationsSheet_();
  const rooms = getRoomsSheet_();

  if (sh.getLastRow() === 0) {
    sh.appendRow([
      'id','createdAt','roomType','roomId','guestName','idNumber','age',
      'phone','email','adults','children','specialRequest',
      'checkin','checkout','nights','usdTotal','bcvTotal','bcvRate',
      'paymentMethod','paymentStatus','status','captureFileUrl',
      'checkinTime','checkoutTime'
    ]);
  }

  if (rooms.getLastRow() === 0) {
    rooms.appendRow(['roomId','roomType','typeName','status']);
    [['J1','junior','Habitación Junior','available'],
     ['J2','junior','Habitación Junior','available'],
     ['D1','doble','Habitación Doble','available'],
     ['D2','doble','Habitación Doble','available'],
     ['D3','doble','Habitación Doble','available']]
      .forEach(r => rooms.appendRow(r));
  }

  return { success:true, spreadsheetId:ss.getId(), spreadsheetUrl:ss.getUrl() };
}

function handleAction(action, data) {
  switch (action) {
    case 'config': return getConfig_();
    case 'rate': return { rate:getBcvRate_(), date:new Date().toISOString(), source:APP.BCV_URL };
    case 'reservations': return getReservations_(data.status || 'all');
    case 'rooms': return getRooms_();
    case 'book': return createBooking_(data);
    case 'uploadCapture': return uploadCapture_(data);
    case 'confirmPayment': return confirmPayment_(data);
    case 'checkin': return changeStayStatus_(data, 'checked-in');
    case 'checkout': return changeStayStatus_(data, 'checked-out');
    case 'clean': return cleanRoom_(data.roomId);
    case 'cancel': return cancelBooking_(data.reservationId);
    case 'updateDates': return updateDates_(data);
    default: return { error:'Acción no reconocida: ' + action };
  }
}

function getConfig_() {
  return {
    hotel: APP.HOTEL,
    roomTypes: [
      {
        id:'junior',
        name:'Habitación Junior',
        description:'Acogedora habitación ideal para viajeros individuales o parejas. Cama queen, baño privado y espacio funcional.',
        capacity:{min:1,max:2},
        total:2,
        price:80,
        includes:['Wi-Fi','A/C','TV','Baño privado','Desayuno'],
        photo:'assets/junior.svg'
      },
      {
        id:'doble',
        name:'Habitación Doble',
        description:'Habitación amplia para familias o grupos de 3 a 4 personas, con dos camas y baño completo.',
        capacity:{min:3,max:4},
        total:3,
        price:140,
        includes:['Wi-Fi','A/C','TV','Baño privado','Desayuno','Minibar'],
        photo:'assets/doble.svg'
      }
    ],
    paymentMethods: [
      {
        id:'pago_movil',
        name:'Pago Móvil',
        details:{banco:'Banco de Venezuela',telefono:'0412-1234567',cedula:'V-12345678'},
        instructions:'Realiza el pago por Pago Móvil y adjunta la captura.'
      },
      {
        id:'transferencia',
        name:'Transferencia Bancaria',
        details:{banco:'Banesco',cuenta:'0134-0000-00-0000000000',titular:'Hotel Aurora C.A.',rif:'J-12345678-9'},
        instructions:'Realiza la transferencia y adjunta el comprobante.'
      },
      {
        id:'zelle',
        name:'Zelle (Internacional)',
        details:{email:'pagos@hotelaurora.com',titular:'Hotel Aurora LLC'},
        instructions:'Envía el pago y adjunta el recibo.'
      },
      {
        id:'efectivo',
        name:'Efectivo USD (al llegar)',
        details:{nota:'Se paga en recepción al momento del check-in.'},
        instructions:'No requiere captura. El pago queda pendiente hasta el check-in.'
      }
    ]
  };
}

/* ---------------- RESERVAS ---------------- */

function createBooking_(d) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    const cfg = getConfig_();
    const type = cfg.roomTypes.find(t => t.id === d.roomType);
    if (!type) return {error:'Tipo de habitación no válido.'};

    const checkin = String(d.checkin || '');
    const checkout = String(d.checkout || '');
    if (!checkin || !checkout || checkout <= checkin) {
      return {error:'Las fechas no son válidas.'};
    }

    const guest = d.guest || {};
    const people = Number(guest.adults || 0) + Number(guest.children || 0);
    if (people < type.capacity.min || people > type.capacity.max) {
      return {error:'La cantidad de huéspedes no corresponde a la capacidad de esta habitación.'};
    }

    const roomsRequested = Math.max(1, Number(d.roomsRequested || 1));
    const reservations = getReservations_('all').filter(r =>
      ['pending','confirmed','checked-in'].indexOf(r.status) >= 0 &&
      r.roomType === type.id
    );

    const roomIds = getRoomIds_(type.id);
    const free = roomIds.filter(id =>
      !reservations.some(r => r.roomId === id && overlap_(r.checkin,r.checkout,checkin,checkout))
    );

    if (free.length < roomsRequested) {
      return {error:`No hay suficientes habitaciones ${type.name} disponibles para esas fechas.`};
    }

    // Esta demo reserva una habitación por registro. Si luego se requiere
    // reservar varias habitaciones, el frontend puede crear un registro por unidad.
    const roomId = free[0];
    const n = diffNights_(checkin,checkout);
    const usd = n * Number(type.price);
    const rate = Number(d.bcvRate || getBcvRate_());
    const bcv = usd * rate;

    const id = 'RES-' + Utilities.getUuid().slice(0,8).toUpperCase();
    const now = new Date();

    const row = [
      id, now.toISOString(), type.id, roomId,
      guest.name || '', guest.idNumber || '', guest.age || '',
      guest.phone || '', guest.email || '', guest.adults || 0,
      guest.children || 0, guest.specialRequest || '',
      checkin, checkout, n, usd, bcv, rate,
      d.paymentMethod || '', d.paymentMethod === 'efectivo' ? 'pending-cash' : 'pending-capture',
      'pending', '', '', ''
    ];

    getReservationsSheet_().appendRow(row);
    return {success:true,reservation:rowToReservation_(row)};
  } finally {
    lock.releaseLock();
  }
}

function getReservations_(status) {
  const sh = getReservationsSheet_();
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return [];
  let rows = values.slice(1).map(rowToReservation_);
  if (status && status !== 'all') rows = rows.filter(r => r.status === status);
  return rows;
}

function rowToReservation_(r) {
  return {
    id:String(r[0]||''),
    createdAt:String(r[1]||''),
    roomType:String(r[2]||''),
    roomId:String(r[3]||''),
    guest:{
      name:String(r[4]||''), idNumber:String(r[5]||''), age:Number(r[6]||0),
      phone:String(r[7]||''), email:String(r[8]||''),
      adults:Number(r[9]||0), children:Number(r[10]||0),
      specialRequest:String(r[11]||'')
    },
    checkin:formatDate_(r[12]),
    checkout:formatDate_(r[13]),
    nights:Number(r[14]||0),
    usdTotal:Number(r[15]||0),
    bcvTotal:Number(r[16]||0),
    bcvRate:Number(r[17]||0),
    paymentMethod:String(r[18]||''),
    paymentStatus:String(r[19]||''),
    status:String(r[20]||''),
    captureUrl:String(r[21]||''),
    checkinTime:String(r[22]||''),
    checkoutTime:String(r[23]||'')
  };
}

function findReservationRow_(id) {
  const sh = getReservationsSheet_();
  const values = sh.getDataRange().getValues();
  for (let i=1;i<values.length;i++) {
    if (String(values[i][0]) === String(id)) return {sheet:sh,row:i+1,values:values[i]};
  }
  return null;
}

function confirmPayment_(d) {
  const found = findReservationRow_(d.reservationId);
  if (!found) return {error:'Reserva no encontrada.'};

  found.sheet.getRange(found.row,21).setValue('confirmed');
  found.sheet.getRange(found.row,20).setValue('paid');

  const r = rowToReservation_(found.sheet.getRange(found.row,1,1,24).getValues()[0]);
  sendTicket_(r);

  return {success:true,reservation:r,emailSent:!!r.guest.email};
}

function uploadCapture_(d) {
  const found = findReservationRow_(d.reservationId);
  if (!found) return {error:'Reserva no encontrada.'};
  if (!d.captureBase64) return {error:'No se recibió la captura.'};

  const match = String(d.captureBase64).match(/^data:(.+?);base64,(.*)$/);
  if (!match) return {error:'Formato de captura inválido.'};

  const folder = getDriveFolder_();
  const bytes = Utilities.base64Decode(match[2]);
  const mime = match[1];
  const safeName = sanitize_(d.fileName || found.values[4] || 'huésped');
  const file = folder.createFile(Utilities.newBlob(bytes,mime,safeName + '_' + d.reservationId));
  found.sheet.getRange(found.row,22).setValue(file.getUrl());
  found.sheet.getRange(found.row,20).setValue('pending-review');

  return {success:true,url:file.getUrl()};
}

function changeStayStatus_(d,status) {
  const found = findReservationRow_(d.reservationId);
  if (!found) return {error:'Reserva no encontrada.'};

  const r = rowToReservation_(found.values);
  if (status === 'checked-in') {
    if (r.status !== 'confirmed') return {error:'La reserva debe estar confirmada antes del check-in.'};
    found.sheet.getRange(found.row,21).setValue('checked-in');
    found.sheet.getRange(found.row,23).setValue(new Date().toISOString());
    setRoomStatus_(r.roomId,'occupied');
  } else {
    if (r.status !== 'checked-in') return {error:'La habitación no está ocupada por esta reserva.'};
    found.sheet.getRange(found.row,21).setValue('checked-out');
    found.sheet.getRange(found.row,24).setValue(new Date().toISOString());
    setRoomStatus_(r.roomId,'dirty');
  }
  return {success:true};
}

function cleanRoom_(roomId) {
  setRoomStatus_(roomId,'available');
  return {success:true};
}

function cancelBooking_(id) {
  const found = findReservationRow_(id);
  if (!found) return {error:'Reserva no encontrada.'};
  found.sheet.getRange(found.row,21).setValue('cancelled');
  return {success:true};
}

function updateDates_(d) {
  const found = findReservationRow_(d.reservationId);
  if (!found) return {error:'Reserva no encontrada.'};
  if (String(d.checkout) <= String(d.checkin)) return {error:'El check-out debe ser posterior al check-in.'};

  const r = rowToReservation_(found.values);
  const others = getReservations_('all').filter(x =>
    x.id !== r.id &&
    x.roomId === r.roomId &&
    ['pending','confirmed','checked-in'].indexOf(x.status) >= 0 &&
    overlap_(x.checkin,x.checkout,d.checkin,d.checkout)
  );
  if (others.length) return {error:'Las nuevas fechas chocan con otra reserva de la misma habitación.'};

  const type = getConfig_().roomTypes.find(t => t.id === r.roomType);
  const n = diffNights_(d.checkin,d.checkout);
  const usd = n * Number(type.price);
  const rate = getBcvRate_();

  found.sheet.getRange(found.row,13).setValue(d.checkin);
  found.sheet.getRange(found.row,14).setValue(d.checkout);
  found.sheet.getRange(found.row,15).setValue(n);
  found.sheet.getRange(found.row,16).setValue(usd);
  found.sheet.getRange(found.row,17).setValue(usd*rate);
  found.sheet.getRange(found.row,18).setValue(rate);

  return {success:true};
}

/* ---------------- HABITACIONES ---------------- */

function getRooms_() {
  const cfg = getConfig_();
  const reservations = getReservations_('all');
  const sheetRooms = getRoomsSheet_().getDataRange().getValues().slice(1);
  const out = {};
  const t = Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyy-MM-dd');

  sheetRooms.forEach(row => {
    const id=String(row[0]), typeId=String(row[1]), typeName=String(row[2]);
    let status=String(row[3]||'available');
    const active = reservations.filter(r =>
      r.roomId===id && ['pending','confirmed','checked-in'].indexOf(r.status)>=0
    );
    const checked = active.find(r=>r.status==='checked-in');

    if (status !== 'dirty') {
      if (checked) status='occupied';
      else if (active.some(r => r.checkin <= t && r.checkout > t && r.status==='confirmed')) status='reserved';
      else status='available';
    }

    const currentReservation = checked ||
      active.find(r => r.checkin <= t && r.checkout > t && r.status==='confirmed') ||
      active.find(r => r.checkin > t);

    out[id]={status,type:typeName,roomType:typeId,currentReservation:currentReservation||null};
  });
  return out;
}

function setRoomStatus_(roomId,status) {
  const sh=getRoomsSheet_();
  const values=sh.getDataRange().getValues();
  for(let i=1;i<values.length;i++){
    if(String(values[i][0])===String(roomId)){
      sh.getRange(i+1,4).setValue(status);
      return;
    }
  }
}

/* ---------------- BCV ---------------- */

function getBcvRate_() {
  const cache=CacheService.getScriptCache();
  const cached=cache.get('BCV_USD_RATE');
  if(cached) return Number(cached);

  try {
    const html=UrlFetchApp.fetch(APP.BCV_URL,{muteHttpExceptions:true,followRedirects:true}).getContentText();
    // El sitio puede cambiar su HTML. Probamos varias formas de localizar USD.
    const patterns=[
      /(?:USD|Dólar|Dolar)[\s\S]{0,500}?([0-9]{1,3}[.,][0-9]{2,4})/i,
      /([0-9]{2,3}[.,][0-9]{2})[\s\S]{0,80}Bs\.?[\s\S]{0,80}(?:USD|Dólar|Dolar)/i
    ];
    for(const re of patterns){
      const m=html.match(re);
      if(m){
        const n=parseFloat(String(m[1]).replace(/\./g,'').replace(',','.'));
        if(n>1 && n<10000){ cache.put('BCV_USD_RATE',String(n),21600); PropertiesService.getScriptProperties().setProperty('LAST_BCV_RATE',String(n)); return n; }
      }
    }
  } catch(e) {
    console.warn('BCV:',e);
  }

  // Último valor válido guardado.
  const props=PropertiesService.getScriptProperties();
  const last=Number(props.getProperty('LAST_BCV_RATE')||0);
  if(last) return last;
  return 36.50;
}

/* ---------------- TICKET ---------------- */

function sendTicket_(r) {
  if (!r.guest.email) return false;

  const cfg=getConfig_();
  const type=cfg.roomTypes.find(t=>t.id===r.roomType);
  const subject='Reserva confirmada ' + r.id + ' — ' + APP.HOTEL;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:650px;margin:auto">
      <h2>${APP.HOTEL}</h2>
      <p>Tu pago fue verificado y tu reserva está <b>CONFIRMADA</b>.</p>
      <hr>
      <p><b>Reserva:</b> ${r.id}</p>
      <p><b>Huésped:</b> ${escapeHtml_(r.guest.name)}</p>
      <p><b>Documento:</b> ${escapeHtml_(r.guest.idNumber)}</p>
      <p><b>Habitación:</b> ${escapeHtml_(type ? type.name : r.roomType)} · Hab. ${r.roomId}</p>
      <p><b>Check-in:</b> ${r.checkin}</p>
      <p><b>Check-out:</b> ${r.checkout}</p>
      <p><b>Noches:</b> ${r.nights}</p>
      <p><b>Total:</b> $ ${r.usdTotal.toFixed(2)} · Bs. ${r.bcvTotal.toFixed(2)}</p>
      <p><b>Condiciones:</b> presenta tu documento en recepción. El check-out finaliza la estadía y la habitación pasa a limpieza.</p>
      ${r.guest.specialRequest ? '<p><b>Solicitud especial:</b> '+escapeHtml_(r.guest.specialRequest)+'</p>' : ''}
      <hr>
      <p style="font-size:12px;color:#666">Este correo fue generado automáticamente después de la verificación manual del pago.</p>
    </div>`;

  MailApp.sendEmail({
    to:r.guest.email,
    subject:subject,
    htmlBody:html,
    body:stripHtml_(html)
  });
  return true;
}

/* ---------------- HELPERS ---------------- */

function getSpreadsheet_(){
  const props=PropertiesService.getScriptProperties();
  let id=props.getProperty(APP.PROP_SS_ID);
  if(id) return SpreadsheetApp.openById(id);

  const active=SpreadsheetApp.getActiveSpreadsheet();
  const ss=active || SpreadsheetApp.create(APP.HOTEL+' — Reservas');
  props.setProperty(APP.PROP_SS_ID,ss.getId());
  return ss;
}

function getReservationsSheet_(){
  const ss=getSpreadsheet_();
  let sh=ss.getSheetByName(APP.SHEET_NAME);
  if(!sh) sh=ss.insertSheet(APP.SHEET_NAME);
  if(sh.getLastRow()===0){
    sh.appendRow(['id','createdAt','roomType','roomId','guestName','idNumber','age','phone','email','adults','children','specialRequest','checkin','checkout','nights','usdTotal','bcvTotal','bcvRate','paymentMethod','paymentStatus','status','captureFileUrl','checkinTime','checkoutTime']);
  }
  return sh;
}

function getRoomsSheet_(){
  const ss=getSpreadsheet_();
  let sh=ss.getSheetByName(APP.ROOMS_SHEET);
  if(!sh) sh=ss.insertSheet(APP.ROOMS_SHEET);
  if(sh.getLastRow()===0){
    sh.appendRow(['roomId','roomType','typeName','status']);
    [['J1','junior','Habitación Junior','available'],['J2','junior','Habitación Junior','available'],['D1','doble','Habitación Doble','available'],['D2','doble','Habitación Doble','available'],['D3','doble','Habitación Doble','available']]
      .forEach(r=>sh.appendRow(r));
  }
  return sh;
}

function getRoomIds_(typeId){
  return getRoomsSheet_().getDataRange().getValues().slice(1)
    .filter(r=>String(r[1])===String(typeId)).map(r=>String(r[0]));
}

function overlap_(a1,a2,b1,b2){
  return String(a1)<String(b2) && String(a2)>String(b1);
}

function diffNights_(a,b){
  const x=new Date(a+'T12:00:00'), y=new Date(b+'T12:00:00');
  return Math.max(1,Math.round((y-x)/86400000));
}

function formatDate_(v){
  if(v instanceof Date) return Utilities.formatDate(v,Session.getScriptTimeZone(),'yyyy-MM-dd');
  return String(v||'').slice(0,10);
}

function getDriveFolder_(){
  const props=PropertiesService.getScriptProperties();
  let id=props.getProperty(APP.PROP_DRIVE_ID);
  if(id) return DriveApp.getFolderById(id);
  const folder=DriveApp.createFolder(APP.HOTEL+' — Comprobantes de pago');
  props.setProperty(APP.PROP_DRIVE_ID,folder.getId());
  return folder;
}

function sanitize_(s){
  return String(s||'archivo').replace(/[^\w\- áéíóúÁÉÍÓÚñÑ]/g,'_').slice(0,80);
}

function escapeHtml_(s){
  return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function stripHtml_(s){ return String(s).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(); }
