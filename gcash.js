/* =====================================================================
 * GCash add-on  (does not touch your existing index.js / admin.js)
 *
 *  1. GCash QR code shown when payment = GCash
 *  2. Receipt (resibo) after booking, plus "My receipts"
 *  3. GCash payment check: reference no. -> admin verifies -> PAID
 *  4. Driver remittance tracker (admin)
 *  5. Same date + time: a vehicle that is already taken cannot be booked
 *
 *  Works on index.html (customer) and admin.html (admin) automatically.
 * ===================================================================== */
(function () {
  'use strict';

  /* ---------------- EDIT THESE ---------------- */
  var CONFIG = {
    gcashName:   'AsicarnateExpress',
    gcashNumber: '09XXXXXXXXX',
    qrImage:     'gcash-qr.png',     // put your GCash QR picture next to index.html
    commissionRate: 0.20,            // company share the driver remits from cash (20%)
    remitInstructions:
      'Driver remits the company share of every CASH order by GCash to the number above ' +
      'within 24 hours after the trip, then sends the GCash reference no. to admin.',
    slotHours: 2,                    // how long one booking blocks the vehicle
    defaultFleet: 1,                 // vehicles available per type
    fleet: {}                        // e.g. { 'Motorcycle': 3, 'Van': 1 }  (key = vehicle name)
  };

  /* ---------------- storage ----------------
   * Uses this browser's localStorage so it works right now.
   * To share between customer + admin devices, replace load()/save()
   * with reads/writes to your database (see notes in the chat).      */
  var KEY = 'gx_bookings_v1';
  var Store = {
    load: function () {
      try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
    },
    save: function (list) {
      try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
    }
  };

  /* ---------------- helpers ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function peso(n) {
    return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmt(ts) {
    return new Date(ts).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
  }
  function val(id) { var el = $(id); return el ? String(el.value || '').trim() : ''; }
  function fleetSize(v) {
    return CONFIG.fleet[v] != null ? CONFIG.fleet[v] : CONFIG.defaultFleet;
  }

  /* ======================================================================
   *  CUSTOMER PAGE
   * ==================================================================== */
  function customerInit() {
    var form = $('orderForm');
    var payment = $('dlPayment');
    var fareBox = $('fareSummary');
    if (!form || !payment || !fareBox) return;

    function selectedVehicle() {
      var c = document.querySelector('#vehicleList .vehicle-card.selected');
      if (!c) return null;
      var k = c.cloneNode(true);
      [].forEach.call(k.querySelectorAll('.v-icon, small'), function (n) { n.remove(); });
      return k.textContent.replace(/\s+/g, ' ').trim() || null;
    }

    function startTime() {
      if (val('dlWhen') === 'later') {
        var d = val('dlDate'), t = val('dlTime') || '09:00';
        if (!d) return null;
        var ts = new Date(d + 'T' + t).getTime();
        return isNaN(ts) ? null : ts;
      }
      return Date.now();
    }

    function currentFare() {
      var el = fareBox.querySelector('.fare-row.total') || fareBox;
      var m = (el.textContent || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/g);
      return m ? parseFloat(m[m.length - 1]) : 0;
    }

    function takenCount(vehicle, start) {
      var span = CONFIG.slotHours * 3600000;
      return Store.load().filter(function (b) {
        return b.vehicle === vehicle && b.status !== 'cancelled' && b.payStatus !== 'rejected' &&
          Math.abs(b.start - start) < span;
      }).length;
    }

    function isAvailable(vehicle, start) {
      return takenCount(vehicle, start) < fleetSize(vehicle);
    }

    /* ---- availability banner ---- */
    var avail = document.createElement('div');
    avail.className = 'gx-avail';
    avail.setAttribute('role', 'status');
    fareBox.insertAdjacentElement('beforebegin', avail);

    function refreshAvail() {
      var v = selectedVehicle(), s = startTime();
      if (!v || s == null) { avail.className = 'gx-avail'; avail.textContent = ''; return; }
      if (isAvailable(v, s)) {
        avail.className = 'gx-avail ok';
        avail.textContent = '✅ ' + v + ' is available on ' + fmt(s) + '.';
      } else {
        avail.className = 'gx-avail bad';
        avail.textContent = '❌ ' + v + ' is already booked on ' + fmt(s) +
          '. Please pick another time, date or vehicle.';
      }
    }

    /* ---- GCash panel ---- */
    var panel = document.createElement('div');
    panel.className = 'gx-pay';
    panel.hidden = true;
    panel.innerHTML =
      '<img id="gxQr" alt="GCash QR code" src="' + esc(CONFIG.qrImage) + '">' +
      '<p class="gx-noqr" id="gxNoQr" hidden>QR image not found — add <b>' + esc(CONFIG.qrImage) + '</b> next to this page.</p>' +
      '<p class="gx-name">' + esc(CONFIG.gcashName) + '</p>' +
      '<p class="gx-num">' + esc(CONFIG.gcashNumber) + '</p>' +
      '<p class="gx-amt" id="gxAmt">' + peso(0) + '</p>' +
      '<label for="gxRef">GCash reference no.</label>' +
      '<input type="text" id="gxRef" placeholder="13-digit reference no." maxlength="13" inputmode="numeric" autocomplete="off">' +
      '<p class="hint">Scan the QR, pay the exact amount, then type the reference no. from your GCash receipt. ' +
      'Admin will verify it and mark your order as PAID.</p>';
    payment.insertAdjacentElement('afterend', panel);

    var qr = panel.querySelector('#gxQr');
    qr.addEventListener('error', function () { qr.hidden = true; panel.querySelector('#gxNoQr').hidden = false; });

    function refreshPanel() {
      panel.hidden = payment.value !== 'GCash';
      panel.querySelector('#gxAmt').textContent = currentFare() ? 'Pay ' + peso(currentFare()) : 'Enter distance to see amount';
    }

    function refreshAll() { refreshAvail(); refreshPanel(); }

    ['change', 'input', 'click'].forEach(function (ev) { document.addEventListener(ev, refreshAll); });
    new MutationObserver(refreshAll).observe(fareBox, { childList: true, subtree: true, characterData: true });
    var vl = $('vehicleList');
    if (vl) new MutationObserver(refreshAll).observe(vl, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    refreshAll();

    /* ---- submit guard + record ---- */
    function say(text) {
      var m = $('orderMessage');
      if (m) { m.textContent = text; m.style.color = '#b91c1c'; }
    }

    form.addEventListener('submit', function (e) {
      var v = selectedVehicle(), s = startTime();
      var isGcash = payment.value === 'GCash';
      var ref = val('gxRef').replace(/\s+/g, '');
      var error = '';

      if (v && s != null && !isAvailable(v, s)) {
        error = v + ' is already booked on ' + fmt(s) + '. Please choose another time, date or vehicle.';
      } else if (isGcash && v) {
        if (!/^\d{13}$/.test(ref)) {
          error = 'Enter the 13-digit GCash reference no. after you pay.';
        } else if (Store.load().some(function (b) { return b.ref === ref; })) {
          error = 'That GCash reference no. was already used for another order.';
        }
      }

      if (error) {
        e.preventDefault();
        e.stopImmediatePropagation();
        say(error);
        return;
      }

      var complete = v && s != null && val('dlPickup') && val('dlDropoff') && val('dlPhone') &&
        val('dlReceiver') && val('dlReceiverPhone') && val('dlItem');
      if (!complete) return; // let your own validation in index.js show its message

      var b = {
        id: 'GX' + Date.now().toString(36).toUpperCase(),
        created: Date.now(),
        vehicle: v,
        start: s,
        pickup: val('dlPickup'),
        dropoff: val('dlDropoff'),
        receiver: val('dlReceiver'),
        phone: val('dlPhone'),
        item: val('dlItem'),
        payment: payment.value,
        amount: currentFare(),
        ref: isGcash ? ref : '',
        payStatus: isGcash ? 'pending' : 'cash',   // pending | verified | rejected | cash
        status: 'active',
        remit: null                                  // { ref, at } once driver remits (cash only)
      };
      var list = Store.load();
      list.push(b);
      Store.save(list);
      setTimeout(function () { showReceipt(b.id); refreshAll(); }, 500);
    }, true);

    /* ---- receipts ---- */
    function stampFor(b) {
      if (b.payStatus === 'verified') return ['paid', '✔ PAID — GCash verified'];
      if (b.payStatus === 'pending')  return ['wait', '⏳ GCash payment awaiting verification'];
      if (b.payStatus === 'rejected') return ['bad',  '✖ GCash payment rejected — contact admin'];
      return ['cash', '💵 Cash — pay the driver on delivery'];
    }

    function receiptHTML(b) {
      var st = stampFor(b);
      function row(a, c) { return '<tr><td>' + a + '</td><td>' + esc(c) + '</td></tr>'; }
      return '<div class="contract-box gx-receipt">' +
        '<h3>Official Receipt</h3>' +
        '<p class="c-no">' + esc(b.id) + ' · ' + esc(fmt(b.created)) + '</p>' +
        '<table class="c-table">' +
          row('Vehicle', b.vehicle) + row('Schedule', fmt(b.start)) +
          row('Pick-up', b.pickup) + row('Drop-off', b.dropoff) +
          row('Receiver', b.receiver) + row('Item', b.item) +
          row('Payment', b.payment) + (b.ref ? row('GCash ref.', b.ref) : '') +
          '<tr class="c-total"><td>Total</td><td>' + peso(b.amount) + '</td></tr>' +
        '</table>' +
        '<div class="gx-stamp ' + st[0] + '">' + st[1] + '</div>' +
        '</div>';
    }

    function openModal(inner) {
      var old = document.querySelector('.gx-print-modal');
      if (old) old.remove();
      var m = document.createElement('div');
      m.className = 'modal gx-print-modal';
      m.innerHTML = '<div class="modal-card wide-card">' + inner + '</div>';
      m.addEventListener('click', function (e) { if (e.target === m) m.remove(); });
      document.body.appendChild(m);
      return m;
    }

    function showReceipt(id) {
      var b = Store.load().filter(function (x) { return x.id === id; })[0];
      if (!b) return;
      var m = openModal(
        '<h2 class="gx-noprint">Booking receipt</h2>' + receiptHTML(b) +
        '<div class="card-actions gx-noprint">' +
          '<button type="button" class="main-btn small" data-gx="print">Print / Save PDF</button>' +
          '<button type="button" class="ghost-btn small" data-gx="close">Close</button>' +
        '</div>');
      m.querySelector('[data-gx="print"]').addEventListener('click', function () { window.print(); });
      m.querySelector('[data-gx="close"]').addEventListener('click', function () { m.remove(); });
    }

    function showList() {
      var list = Store.load().slice().reverse();
      var rows = list.length ? list.map(function (b) {
        return '<div class="gx-receipt-row"><div><strong>' + esc(b.id) + '</strong>' +
          '<small>' + esc(b.vehicle) + ' · ' + esc(fmt(b.start)) + ' · ' + peso(b.amount) + '</small></div>' +
          '<button type="button" class="ghost-btn small" data-id="' + esc(b.id) + '">View</button></div>';
      }).join('') : '<p class="empty">No receipts yet.</p>';
      var m = openModal('<h2>My receipts</h2><div class="gx-receipt-list">' + rows + '</div>' +
        '<div class="card-actions"><button type="button" class="ghost-btn small" data-gx="close">Close</button></div>');
      m.addEventListener('click', function (e) {
        var t = e.target;
        if (t.getAttribute('data-gx') === 'close') m.remove();
        else if (t.getAttribute('data-id')) showReceipt(t.getAttribute('data-id'));
      });
    }

    var orders = $('tabOrders');
    if (orders) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ghost-btn';
      btn.textContent = '🧾 My receipts';
      btn.addEventListener('click', showList);
      orders.insertBefore(btn, orders.firstChild);
    }
  }

  /* ======================================================================
   *  ADMIN PAGE
   * ==================================================================== */
  function adminInit() {
    var logout = $('logoutBtn');
    if (!logout || !$('adminList')) return;

    var box = document.createElement('div');
    box.className = 'gx-admin';
    box.id = 'gxAdmin';
    logout.parentNode.insertBefore(box, logout);

    var tab = 'pay';

    function badge(b) {
      if (b.payStatus === 'verified') return '<span class="badge ok">Verified</span>';
      if (b.payStatus === 'rejected') return '<span class="badge bad">Rejected</span>';
      return '<span class="badge wait">Needs verification</span>';
    }

    function card(b, extra, top) {
      return '<div class="booking-card"><div class="booking-top"><h3>' + esc(b.id) + ' · ' + esc(b.vehicle) + '</h3>' +
        top + '</div>' +
        '<p>' + esc(b.pickup) + ' → ' + esc(b.dropoff) + '</p>' +
        '<p>' + esc(fmt(b.start)) + '</p>' + extra + '</div>';
    }

    function render() {
      var all = Store.load().slice().reverse();
      var html = '<h2>Payments &amp; remittance</h2>' +
        '<div class="gx-tabs"><button type="button" data-tab="pay" class="' + (tab === 'pay' ? 'active' : '') + '">GCash payments</button>' +
        '<button type="button" data-tab="remit" class="' + (tab === 'remit' ? 'active' : '') + '">Driver remittance</button></div>';

      if (tab === 'pay') {
        var g = all.filter(function (b) { return b.payment === 'GCash'; });
        var pend = g.filter(function (b) { return b.payStatus === 'pending'; }).length;
        var ver = g.filter(function (b) { return b.payStatus === 'verified'; });
        html += '<div class="gx-sum"><div><strong>' + pend + '</strong><span>To verify</span></div>' +
          '<div><strong>' + ver.length + '</strong><span>Verified</span></div>' +
          '<div><strong>' + peso(ver.reduce(function (s, b) { return s + b.amount; }, 0)) + '</strong><span>GCash received</span></div></div>';
        html += g.length ? g.map(function (b) {
          var extra = '<p class="price">' + peso(b.amount) + ' <span>· Ref ' + esc(b.ref) + '</span></p>';
          if (b.payStatus === 'pending') {
            extra += '<div class="gx-actions"><button type="button" class="gx-btn" data-act="verify" data-id="' + esc(b.id) + '">Verify paid</button>' +
              '<button type="button" class="gx-btn danger" data-act="reject" data-id="' + esc(b.id) + '">Reject</button></div>';
          }
          return card(b, extra, badge(b));
        }).join('') : '<p class="empty">No GCash payments yet.</p>';
      } else {
        var c = all.filter(function (b) { return b.payment === 'Cash'; });
        function owed(b) { return Math.round(b.amount * CONFIG.commissionRate * 100) / 100; }
        var open = c.filter(function (b) { return !b.remit; });
        var done = c.filter(function (b) { return b.remit; });
        html += '<div class="gx-sum"><div><strong>' + peso(open.reduce(function (s, b) { return s + owed(b); }, 0)) + '</strong><span>Still to remit</span></div>' +
          '<div><strong>' + peso(done.reduce(function (s, b) { return s + owed(b); }, 0)) + '</strong><span>Remitted</span></div>' +
          '<div><strong>' + open.length + '</strong><span>Open cash orders</span></div></div>';
        html += '<div class="gx-info"><b>How drivers remit:</b> ' + esc(CONFIG.remitInstructions) +
          '<br>GCash: <b>' + esc(CONFIG.gcashNumber) + '</b> (' + esc(CONFIG.gcashName) + ') · Company share: <b>' +
          Math.round(CONFIG.commissionRate * 100) + '%</b> of the fare.</div>';
        html += c.length ? c.map(function (b) {
          var extra = '<p class="price">Collected ' + peso(b.amount) + ' <span>· remit ' + peso(owed(b)) + '</span></p>';
          var top;
          if (b.remit) {
            top = '<span class="badge ok">Remitted</span>';
            extra += '<p>Ref ' + esc(b.remit.ref) + ' · ' + esc(fmt(b.remit.at)) + '</p>';
          } else {
            top = '<span class="badge wait">Not remitted</span>';
            extra += '<div class="gx-actions"><input type="text" placeholder="Driver’s GCash ref. no." data-ref="' + esc(b.id) + '" inputmode="numeric" maxlength="13">' +
              '<button type="button" class="gx-btn" data-act="remit" data-id="' + esc(b.id) + '">Mark remitted</button></div>';
          }
          return card(b, extra, top);
        }).join('') : '<p class="empty">No cash orders yet.</p>';
      }
      box.innerHTML = html;
    }

    box.addEventListener('click', function (e) {
      var t = e.target;
      if (t.getAttribute('data-tab')) { tab = t.getAttribute('data-tab'); render(); return; }
      var act = t.getAttribute('data-act'), id = t.getAttribute('data-id');
      if (!act) return;
      var list = Store.load();
      var b = list.filter(function (x) { return x.id === id; })[0];
      if (!b) return;
      if (act === 'verify') b.payStatus = 'verified';
      if (act === 'reject') b.payStatus = 'rejected';
      if (act === 'remit') {
        var input = box.querySelector('[data-ref="' + id + '"]');
        var ref = input ? input.value.replace(/\s+/g, '') : '';
        if (!/^\d{13}$/.test(ref)) { alert('Enter the 13-digit GCash reference no. of the remittance.'); return; }
        b.remit = { ref: ref, at: Date.now() };
      }
      Store.save(list);
      render();
    });

    render();
    var dash = $('dashboard');
    if (dash) new MutationObserver(render).observe(dash, { attributes: true, attributeFilter: ['hidden'] });
    var refresh = $('adminRefresh');
    if (refresh) refresh.addEventListener('click', render);
    window.addEventListener('storage', function (e) { if (e.key === KEY) render(); });
  }

  function boot() { customerInit(); adminInit(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
