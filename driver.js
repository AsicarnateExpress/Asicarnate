/* =========================================================
   driver.js  -  Driver app: take jobs, update trips, remit via GCash
   Uses the same Firebase project and "orders" collection as admin.js.

   SETUP (one time)
   1. Add drivers from the admin panel (Drivers section in admin.js).
   2. (Not needed any more) Manual way: Firebase Auth user + Firestore doc drivers/{uid}
        with name, phone, active: true
   3. Edit PLATFORM_RATE and ADMIN_GCASH below.
   4. Add Firestore rules (merge with yours). Helper functions:
        function isDriver() { return exists(/databases/$(database)/documents/drivers/$(request.auth.uid))
          && get(/databases/$(database)/documents/drivers/$(request.auth.uid)).data.active != false; }
      match /drivers/{uid} { allow read: if request.auth.uid == uid || isAdmin(); allow write: if isAdmin(); }
      match /orders/{id} {
        allow read:   if isDriver() && (resource.data.status == "pending" || resource.data.driverId == request.auth.uid);
        allow update: if isDriver()
          && (resource.data.driverId == request.auth.uid || (resource.data.status == "pending" && !("driverId" in resource.data)))
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(
               ["status","driverId","driverName","driverPhone","acceptedMs","completedMs","remitId"]);
      }
      match /remittances/{id} {
        allow create: if isDriver() && request.resource.data.driverId == request.auth.uid
                      && request.resource.data.status == "pending";
        allow read:   if resource.data.driverId == request.auth.uid || isAdmin();
        allow update: if isAdmin();
      }
========================================================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, getDocs, collection, query, where,
  runTransaction, writeBatch, updateDoc
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

// ---------- Firebase ----------
const firebaseConfig = {
  apiKey: "AIzaSyBB80cl3pVsse-6wa113swLABwjGlCB7G0",
  authDomain: "gabriel-f559e.firebaseapp.com",
  projectId: "gabriel-f559e",
  storageBucket: "gabriel-f559e.firebasestorage.app",
  messagingSenderId: "1065791350150",
  appId: "1:1065791350150:web:b77db4000428fa061f7807",
  measurementId: "G-6D5240BSMV"
};

const app = initializeApp(firebaseConfig, "driver");   // own login session
const auth = getAuth(app);
const db = getFirestore(app);

// ---------- Settings ----------
const PLATFORM_RATE = 0.20;   // your cut of each order (20%). Driver keeps the rest.
const ADMIN_GCASH = { name: "AsicarnateExpress", number: "0993 621 2745" };   // where drivers send remittances

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
const money = (n) => `₱${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const round2 = (n) => Math.round(n * 100) / 100;
const share = (o) => round2((Number(o.total) || 0) * (1 - PLATFORM_RATE));   // driver earns
const cut = (o) => round2((Number(o.total) || 0) * PLATFORM_RATE);           // driver remits (cash orders)
// "Cash" only. (GCash orders are paid to you directly, so drivers do not remit them.)
const isCash = (o) => /^\s*cash\b/i.test(o.payment || "");
const VEHICLE_ICONS = { motorcycle: "🏍️", sedan: "🚗", van: "🚐", truck: "🚚" };
const STATUS = {
  pending:   ["Finding driver", "wait"],
  accepted:  ["Driver assigned", "ok"],
  ontheway:  ["On the way", "ok"],
  completed: ["Completed", "ok"],
  cancelled: ["Cancelled", "bad"]
};
const NEXT = { accepted: ["ontheway", "Start trip"], ontheway: ["completed", "Mark delivered"] };

const escapeHtml = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

function msg(text, success = false) {
  $("message").textContent = text;
  $("message").style.color = success ? "#21834b" : "#c0392b";
}

function show(name) {
  $("loginBox").hidden = name !== "login";
  $("app").hidden = name !== "app";
}

// ---------- State ----------
let me = null, driver = null, tab = "jobs";
let openJobs = [], myOrders = [], remits = [];

// ---------- Login ----------
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  msg("");
  const btn = $("loginBtn");
  btn.disabled = true; btn.textContent = "Signing in...";
  try {
    await signInWithEmailAndPassword(auth, $("loginEmail").value.trim(), $("loginPass").value);
  } catch (err) {
    msg(err.code === "auth/invalid-credential" ? "Incorrect email or password." : `${err.code || "Error"}: ${err.message}`);
  } finally {
    btn.disabled = false; btn.textContent = "Sign In";
  }
});

$("logoutBtn").addEventListener("click", async () => {
  if (confirm("Log out?")) await signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  if (!user) { me = null; driver = null; closeMap(); show("login"); return; }
  me = user;

  let snap = null;
  try { snap = await getDoc(doc(db, "drivers", user.uid)); } catch (err) { console.error(err); }
  if (!me || me.uid !== user.uid) return;

  if (!snap || !snap.exists() || snap.data().active === false) {
    await signOut(auth);
    msg("This account is not an approved driver. Ask the owner to add you.");
    return;
  }

  driver = snap.data();
  msg("");
  $("welcome").textContent = `Hi, ${driver.name || user.email}` + (driver.vehicleName ? ` · ${VEHICLE_ICONS[driver.vehicleId] || ""} ${driver.vehicleName}` : "");
  show("app");
  loadAll();
});

// ---------- Load ----------
async function loadAll() {
  $("jobs").innerHTML = `<p class="empty">Loading...</p>`;
  try {
    const [pend, mine, rem] = await Promise.all([
      getDocs(query(collection(db, "orders"), where("status", "==", "pending"))),
      getDocs(query(collection(db, "orders"), where("driverId", "==", me.uid))),
      getDocs(query(collection(db, "remittances"), where("driverId", "==", me.uid)))
    ]);
    const rows = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }));
    openJobs  = rows(pend).filter((o) => !o.driverId && (!driver.vehicleId || o.vehicleId === driver.vehicleId)).sort((a, b) => (a.createdMs || 0) - (b.createdMs || 0));
    myOrders  = rows(mine).sort((a, b) => (b.createdMs || 0) - (a.createdMs || 0));
    remits    = rows(rem).sort((a, b) => (b.createdMs || 0) - (a.createdMs || 0));
    render();
  } catch (err) {
    console.error("Load error:", err);
    $("jobs").innerHTML = `<p class="empty">Could not load: ${escapeHtml(err.code || err.message)}</p>`;
  }
}

// Completed cash orders that still need to be remitted (never submitted, or the last submission was rejected)
function dueOrders() {
  const status = Object.fromEntries(remits.map((r) => [r.id, r.status]));
  return myOrders.filter((o) =>
    o.status === "completed" && isCash(o) && (!o.remitId || status[o.remitId] === "rejected")
  );
}

// ---------- Render ----------
function jobCard(o, mine) {
  const [label, tone] = STATUS[o.status] || [o.status, "wait"];
  const next = NEXT[o.status];
  return `
    <article class="booking-card">
      <div class="booking-top">
        <h3>${escapeHtml(o.orderNo)}</h3>
        <span class="badge ${tone}">${escapeHtml(label)}</span>
      </div>
      <p>${VEHICLE_ICONS[o.vehicleId] || ""} ${escapeHtml(o.vehicleName)} · ${escapeHtml(String(o.distanceKm))} km</p>
      <p><strong>From:</strong> ${escapeHtml(o.pickup)}</p>
      <p><strong>To:</strong> ${escapeHtml(o.dropoff)}</p>
      <p>📦 ${escapeHtml(o.item)}${o.notes ? ` — “${escapeHtml(o.notes)}”` : ""}</p>
      <p>🕒 ${escapeHtml(o.scheduledFor)}${o.helper ? " · helper" : ""}${o.roundTrip ? " · round trip" : ""}</p>
      ${mine ? `
        <p><strong>Customer:</strong> ${escapeHtml(o.customerName)} · <a href="tel:${escapeHtml(o.phone)}">${escapeHtml(o.phone)}</a></p>
        <p><strong>Receiver:</strong> ${escapeHtml(o.receiver)} · <a href="tel:${escapeHtml(o.receiverPhone)}">${escapeHtml(o.receiverPhone)}</a></p>` : ""}
      <p class="price">You earn ${money(share(o))} · ${escapeHtml(o.payment)}</p>
      ${isCash(o) && o.status !== "completed" && o.status !== "cancelled"
        ? `<p class="hint">💵 Collect ${money(o.total)} cash from the customer.</p>` : ""}
      <div class="admin-actions">
        <button type="button" class="ghost-btn small" data-act="map" data-id="${o.id}">📍 View on map</button>
        ${!mine ? `<button type="button" class="main-btn small" data-act="accept" data-id="${o.id}">Accept job</button>` : ""}
        ${mine && next ? `<button type="button" class="main-btn small" data-act="advance" data-id="${o.id}">${next[1]}</button>` : ""}
      </div>
    </article>`;
}

function render() {
  const active = myOrders.filter((o) => o.status === "accepted" || o.status === "ontheway");
  const done = myOrders.filter((o) => o.status === "completed");
  const due = dueOrders();
  const dueAmount = round2(due.reduce((s, o) => s + cut(o), 0));
  const earned = round2(done.reduce((s, o) => s + share(o), 0));

  $("stats").innerHTML = `
    <div class="stat"><strong>${active.length}</strong><span>Active</span></div>
    <div class="stat"><strong>${money(earned)}</strong><span>Earned</span></div>
    <div class="stat"><strong>${money(dueAmount)}</strong><span>To remit</span></div>`;

  $("jobs").innerHTML = openJobs.length
    ? openJobs.map((o) => jobCard(o, false)).join("")
    : `<p class="empty">No open jobs for your vehicle right now. Tap Refresh to check again.</p>`;

  const trips = [...active, ...myOrders.filter((o) => o.status !== "accepted" && o.status !== "ontheway")];
  $("mine").innerHTML = trips.length
    ? trips.map((o) => jobCard(o, true)).join("")
    : `<p class="empty">You have no trips yet.</p>`;

  renderRemit(due, dueAmount);
}

function renderRemit(due, dueAmount) {
  const stamp = { pending: ["wait", "Waiting for admin"], confirmed: ["paid", "Confirmed"], rejected: ["bad", "Rejected"] };
  $("remit").innerHTML = `
    <div class="gx-pay">
      <p class="gx-name">Send your remittance by GCash</p>
      <p class="gx-name">${escapeHtml(ADMIN_GCASH.name)}</p>
      <p class="gx-num">${escapeHtml(ADMIN_GCASH.number)}</p>
      <p class="gx-amt">${money(dueAmount)}</p>
      <p class="hint">${due.length} cash order${due.length === 1 ? "" : "s"} · ${Math.round(PLATFORM_RATE * 100)}% platform share</p>
      <label for="remitRef">GCash reference no.</label>
      <input id="remitRef" inputmode="numeric" maxlength="13" placeholder="13-digit reference number" ${dueAmount > 0 ? "" : "disabled"}>
      <p class="hint">Send the exact amount in your GCash app first, then enter the reference number from the receipt.</p>
      <button type="button" class="main-btn" id="remitBtn" ${dueAmount > 0 ? "" : "disabled"}>
        ${dueAmount > 0 ? "Submit remittance" : "Nothing to remit"}
      </button>
    </div>
    <h2 class="section-title">Remittance history</h2>
    ${remits.length ? remits.map((r) => {
      const [tone, text] = stamp[r.status] || ["wait", r.status];
      return `
        <article class="booking-card">
          <div class="booking-top"><h3>${money(r.amount)}</h3><span class="gx-stamp ${tone}">${text}</span></div>
          <p>Ref ${escapeHtml(r.gcashRef)} · ${r.orderIds?.length || 0} order(s)</p>
          <p class="hint">${new Date(r.createdMs).toLocaleString()}</p>
        </article>`;
    }).join("") : `<p class="empty">No remittances yet.</p>`}`;

  $("remitBtn")?.addEventListener("click", submitRemit);
  // Reference number: digits only, max 13
  $("remitRef")?.addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 13);
  });
}

// ---------- Actions ----------
async function acceptJob(id, btn) {
  btn.disabled = true; btn.textContent = "Accepting...";
  const ref = doc(db, "orders", id);
  try {
    // Transaction: only one driver can take a job
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const o = snap.data();
      if (!snap.exists() || o.status !== "pending" || o.driverId) throw new Error("taken");
      tx.update(ref, {
        status: "accepted",
        driverId: me.uid,
        driverName: driver.name || me.email,
        driverPhone: driver.phone || "",
        acceptedMs: Date.now()
      });
    });
    msg("Job accepted. See it under My trips.", true);
    setTab("mine");
  } catch (err) {
    msg(err.message === "taken" ? "Sorry, another driver already took this job." : `Could not accept: ${err.code || err.message}`);
  }
  loadAll();
}

// Keeps the public "slots" list in step with the order, so a completed or
// cancelled order makes the vehicle available again for other customers.
async function syncSlot(orderId, status) {
  try {
    await updateDoc(doc(db, "slots", orderId), {
      status,
      active: !["completed", "cancelled"].includes(status)
    });
  } catch (error) {
    console.warn("Availability not updated:", error.code || error.message);
  }
}

async function advance(id, btn) {
  const order = myOrders.find((o) => o.id === id);
  const next = order && NEXT[order.status];
  if (!next) return;
  if (next[0] === "completed" && !confirm(`Mark ${order.orderNo} as delivered?`)) return;

  btn.disabled = true; btn.textContent = "Saving...";
  try {
    await updateDoc(doc(db, "orders", id), {
      status: next[0],
      ...(next[0] === "completed" ? { completedMs: Date.now() } : {})
    });
    await syncSlot(id, next[0]);
    msg(`${order.orderNo} is now "${STATUS[next[0]][0]}".`, true);
  } catch (err) {
    msg(`Could not update: ${err.code || err.message}`);
  }
  loadAll();
}

async function submitRemit() {
  const due = dueOrders();
  const amount = round2(due.reduce((s, o) => s + cut(o), 0));
  const ref = $("remitRef").value.replace(/\s/g, "");

  if (!due.length || amount <= 0) return;
  if (!/^\d{13}$/.test(ref)) { msg("The GCash reference number must be exactly 13 digits."); return; }
  if (!confirm(`Submit ${money(amount)} remittance with ref ${ref}?`)) return;

  const btn = $("remitBtn");
  btn.disabled = true; btn.textContent = "Submitting...";

  // Duplicate check: a GCash reference number can only be used once
  const refDoc = doc(db, "remitrefs", ref);
  try {
    if ((await getDoc(refDoc)).exists()) {
      msg("This GCash reference number was already used. Enter the reference from your latest payment.");
      btn.disabled = false; btn.textContent = "Submit remittance";
      return;
    }
  } catch (err) {
    console.warn("Reference pre-check skipped:", err.code || err.message);   // the write below still enforces it
  }

  try {
    const batch = writeBatch(db);
    const rRef = doc(collection(db, "remittances"));
    // Reserves the reference number. If it already exists, the whole batch is refused.
    batch.set(refDoc, { driverId: me.uid, remitId: rRef.id, createdMs: Date.now() });
    batch.set(rRef, {
      driverId: me.uid,
      driverName: driver.name || me.email,
      amount,
      gcashRef: ref,
      orderIds: due.map((o) => o.id),
      orderNos: due.map((o) => o.orderNo),
      status: "pending",          // admin sets "confirmed" or "rejected"
      createdMs: Date.now()
    });
    due.forEach((o) => batch.update(doc(db, "orders", o.id), { remitId: rRef.id }));
    await batch.commit();
    msg("Remittance submitted. The admin will confirm it.", true);
  } catch (err) {
    msg(err.code === "permission-denied"
      ? "Could not submit. This reference number may already be used. Check it and try again."
      : `Could not submit: ${err.code || err.message}`);
  }
  loadAll();
}

// ---------- Tabs + clicks ----------
function setTab(name) {
  tab = name;
  document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  ["jobs", "mine", "remit"].forEach((id) => { $(id).hidden = id !== name; });
}

document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
$("refreshBtn").addEventListener("click", loadAll);

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  if (btn.dataset.act === "accept") acceptJob(btn.dataset.id, btn);
  if (btn.dataset.act === "advance") advance(btn.dataset.id, btn);
  if (btn.dataset.act === "map") showMap(btn.dataset.id);
});


/* =========================================================
   MAP  -  shows the client's pin-point (pick-up), the drop-off
   and the driver's own live location.
   Free OpenStreetMap services, no API key:
   Leaflet (map) + Nominatim (address -> pin) + OSRM (route)
========================================================= */
const GEO_COUNTRY_CODE = "ph";          // "" = worldwide
const MAP_CENTER = [11.45, 123.15];     // same start area as the customer page
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let map = null, mapLayer = null, meMarker = null, watchId = null;
let myPos = null, lastRoutePos = null, mapToken = 0, mapOrder = null, mapPoints = {};
const geoCache = new Map();
let lastGeocode = 0;

const pinIcon = (emoji) => L.divIcon({
  className: "emoji-pin", html: emoji, iconSize: [30, 30], iconAnchor: [15, 28], popupAnchor: [0, -26]
});

function initDriverMap() {
  if (map) { map.invalidateSize(); return true; }
  if (typeof L === "undefined") { msg("The map could not load. Check your internet connection."); return false; }
  map = L.map("driverMap").setView(MAP_CENTER, 11);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);
  mapLayer = L.layerGroup().addTo(map);
  setTimeout(() => map.invalidateSize(), 200);
  return true;
}

// Find a pin for an address. Uses saved coordinates if the order has them,
// otherwise searches the address (trying shorter versions if needed).
async function geocodeOnce(q) {
  const gap = Date.now() - lastGeocode;
  if (gap < 1100) await wait(1100 - gap);      // free service: max 1 request / second
  lastGeocode = Date.now();
  const params = new URLSearchParams({ format: "json", limit: "1", q });
  if (GEO_COUNTRY_CODE) params.set("countrycodes", GEO_COUNTRY_CODE);
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Address search failed");
  const found = await res.json();
  return found.length ? { lat: parseFloat(found[0].lat), lon: parseFloat(found[0].lon) } : null;
}

async function locate(order, kind) {
  const lat = Number(order[`${kind}Lat`]), lon = Number(order[`${kind}Lon`]);
  if (Number.isFinite(lat) && Number.isFinite(lon) && order[`${kind}Lat`] != null) return { lat, lon, exact: true };

  const text = String(order[kind] || "").trim();
  if (!text) return null;
  if (geoCache.has(text)) return geoCache.get(text);

  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  let point = null;
  try {
    for (let i = 0; i < Math.min(parts.length, 3) && !point; i++) {
      point = await geocodeOnce(parts.slice(i).join(", "));
      if (point && i > 0) point.exact = false;   // only the wider area was found
    }
  } catch (err) { console.error("Geocode error:", err); }
  geoCache.set(text, point);
  return point;
}

async function getRoute(a, b) {
  try {
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`);
    const d = await r.json();
    if (d.code === "Ok" && d.routes?.[0]) return d.routes[0];
  } catch (err) { console.error("Route error:", err); }
  return null;
}

function setMapInfo(html) { $("mapInfo").innerHTML = html; }

async function showMap(id) {
  const order = [...myOrders, ...openJobs].find((o) => o.id === id);
  if (!order) return;
  if (!initDriverMap()) return;

  mapOrder = order;
  mapPoints = {};
  const token = ++mapToken;
  $("mapPanel").hidden = false;
  $("mapTitle").textContent = `${order.orderNo} · client location`;
  $("mapNavBtn").hidden = true;
  mapLayer.clearLayers();
  meMarker = null; lastRoutePos = null;
  setMapInfo("Finding the client's pin-point…");
  $("mapPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  setTimeout(() => map.invalidateSize(), 250);

  const pickup = await locate(order, "pickup");
  if (token !== mapToken) return;
  if (pickup) {
    mapPoints.pickup = pickup;
    L.marker([pickup.lat, pickup.lon], { icon: pinIcon("📍") }).addTo(mapLayer)
      .bindPopup(`<strong>Client pick-up</strong><br>${escapeHtml(order.pickup)}<br>${escapeHtml(order.customerName || "")}`);
    map.setView([pickup.lat, pickup.lon], 16);
    $("mapNavBtn").href = `https://www.google.com/maps/dir/?api=1&destination=${pickup.lat},${pickup.lon}&travelmode=driving`;
    $("mapNavBtn").hidden = false;
    setMapInfo(pickup.exact === false
      ? "Exact house not found — pin shows the nearest area. Call the customer to confirm."
      : "Client pick-up found.");
  } else {
    setMapInfo("Could not find the pick-up address on the map. Call the customer to confirm.");
  }

  const dropoff = await locate(order, "dropoff");
  if (token !== mapToken) return;
  if (dropoff) {
    mapPoints.dropoff = dropoff;
    L.marker([dropoff.lat, dropoff.lon], { icon: pinIcon("🏁") }).addTo(mapLayer)
      .bindPopup(`<strong>Drop-off</strong><br>${escapeHtml(order.dropoff)}`);
  }

  startTracking();          // shows the driver's own position + route
  if (myPos) drawRoutes(token);
  else fitAll();
}

function fitAll() {
  const pts = [mapPoints.pickup, mapPoints.dropoff, myPos].filter(Boolean).map((p) => [p.lat, p.lon]);
  if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40] });
  else if (pts.length === 1) map.setView(pts[0], 16);
}

async function drawRoutes(token = mapToken) {
  if (!map || !mapOrder) return;
  mapLayer.eachLayer((l) => { if (l instanceof L.Polyline) mapLayer.removeLayer(l); });
  const info = [];

  if (myPos && mapPoints.pickup) {
    const r = await getRoute(myPos, mapPoints.pickup);
    if (token !== mapToken) return;
    if (r) {
      L.geoJSON(r.geometry, { style: { color: "#7c3aed", weight: 5 } }).addTo(mapLayer);
      info.push(`🛵 You → client: <strong>${(r.distance / 1000).toFixed(1)} km</strong> · about ${Math.max(1, Math.round(r.duration / 60))} min`);
    }
    lastRoutePos = { ...myPos };
  }
  if (mapPoints.pickup && mapPoints.dropoff) {
    const r = await getRoute(mapPoints.pickup, mapPoints.dropoff);
    if (token !== mapToken) return;
    if (r) {
      L.geoJSON(r.geometry, { style: { color: "#0ea5e9", weight: 4, dashArray: "8 8" } }).addTo(mapLayer);
      info.push(`📍 Client → drop-off: <strong>${(r.distance / 1000).toFixed(1)} km</strong>`);
    }
  }
  if (info.length) setMapInfo(info.join("<br>"));
  fitAll();
}

// Driver's live GPS position
function startTracking() {
  if (watchId !== null) return;
  if (!navigator.geolocation) { setMapInfo("Your device has no GPS, so only the client's pin is shown."); return; }
  watchId = navigator.geolocation.watchPosition((pos) => {
    myPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    if (!map) return;
    if (!meMarker) {
      meMarker = L.marker([myPos.lat, myPos.lon], { icon: pinIcon("🛵"), zIndexOffset: 1000 }).addTo(mapLayer).bindPopup("You are here");
    } else {
      meMarker.setLatLng([myPos.lat, myPos.lon]);
    }
    // Draw the route the first time, and again after moving more than ~200 m
    const moved = lastRoutePos ? map.distance([lastRoutePos.lat, lastRoutePos.lon], [myPos.lat, myPos.lon]) : Infinity;
    if (!$("mapPanel").hidden && moved > 200) drawRoutes();
  }, (err) => {
    console.warn("GPS:", err.message);
    setMapInfo("Turn on location permission to see your position and the route to the client.");
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}

function stopTracking() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null; myPos = null; lastRoutePos = null;
}

function closeMap() {
  mapToken++;
  stopTracking();
  mapOrder = null;
  $("mapPanel").hidden = true;
  mapLayer?.clearLayers();
  meMarker = null;
}

$("mapCloseBtn").addEventListener("click", closeMap);
$("mapLocateBtn").addEventListener("click", () => {
  if (!map) return;
  if (myPos) { map.setView([myPos.lat, myPos.lon], 16); meMarker?.openPopup(); }
  else { startTracking(); setMapInfo("Getting your location…"); }
});
