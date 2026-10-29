import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";

import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  setDoc,
  collection
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

// Named app = separate login session from the client page (index.js uses the default app),
// so signing in as admin no longer replaces the customer's account.
const app = initializeApp(firebaseConfig, "admin");
const auth = getAuth(app);
const db = getFirestore(app);


// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
const CURRENCY = "₱";
const money = (n) => `${CURRENCY}${Math.round(n).toLocaleString()}`;

const VEHICLE_ICONS = { motorcycle: "🏍️", sedan: "🚗", van: "🚐", truck: "🚚" };

const STATUS = {
  pending:   ["Finding driver", "wait"],
  accepted:  ["Driver assigned", "ok"],
  ontheway:  ["On the way", "ok"],
  completed: ["Completed", "ok"],
  cancelled: ["Cancelled", "bad"]
};

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function showMessage(text, success = false) {
  const box = $("message");
  box.textContent = text;
  box.style.color = success ? "#21834b" : "#c0392b";
}

function showScreen(name) {
  $("loginBox").hidden = name !== "login";
  $("dashboard").hidden = name !== "dashboard";
  $("container").classList.toggle("wide", name === "dashboard");
}

let adminOrders = [];
let currentUid = null;


// ---------- Branding ----------
const BUSINESS_NAME = "AsicarnateExpress";
document.title = `${BUSINESS_NAME} Admin`;

function addBrand() {
  ["loginBox", "dashboard"].forEach((id) => {
    const box = $(id);
    if (!box || box.querySelector(".brand-name")) return;
    const html = `<p class="brand-name">🚚 ${escapeHtml(BUSINESS_NAME)}</p>`;
    const heading = box.querySelector("h1");
    if (heading) heading.insertAdjacentHTML("beforebegin", html);
    else box.insertAdjacentHTML("afterbegin", html);
  });
}
addBrand();


// ---------- Login ----------
$("togglePass").addEventListener("click", () => {
  const input = $("loginPass");
  const hidden = input.type === "password";
  input.type = hidden ? "text" : "password";
  $("togglePass").textContent = hidden ? "Hide" : "Show";
});

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");

  const email = $("loginEmail").value.trim();
  const password = $("loginPass").value;
  const button = $("loginBtn");

  button.disabled = true;
  button.textContent = "Signing in...";

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    console.error("Login error:", error);
    showMessage(
      error.code === "auth/invalid-credential"
        ? "Incorrect email or password."
        : `${error.code || "Error"}: ${error.message}`
    );
  } finally {
    button.disabled = false;
    button.textContent = "Sign In";
  }
});

$("logoutBtn").addEventListener("click", async () => {
  if (!confirm("Log out of the admin panel?")) return;
  await signOut(auth);
});


// ---------- Admin check ----------
// Put your admin email(s) here, in lowercase. Must match firestore.rules.
const ADMIN_EMAILS = ["admin@asicarnate.com"];

async function isAdmin(user) {
  if (ADMIN_EMAILS.includes((user.email || "").toLowerCase())) return true;

  try {
    const snapshot = await getDoc(doc(db, "admins", user.uid));
    return snapshot.exists();
  } catch (error) {
    console.error("Admin check error:", error);
    return false;
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUid = null;
    adminOrders = [];
    showScreen("login");
    return;
  }

  currentUid = user.uid;
  const admin = await isAdmin(user);

  // Ignore the result if someone else signed in while we were checking
  if (currentUid !== user.uid) return;

  if (!admin) {
    await signOut(auth);
    showMessage("This account is not an admin. Ask the owner to add you.");
    return;
  }

  showMessage("");
  $("welcome").textContent = "Signed in as " + (user.email || "admin");
  showScreen("dashboard");
  loadOrders();
  loadRemittances();
  loadDrivers();
});


// ---------- Revenue chart, week calendar, completion ring ----------
// Revenue = total of orders marked "Completed".
// Bars show each day of the selected week (by the day the order was placed).
let weekOffset = 0;   // 0 = this week, -1 = last week, ...

function shortMoney(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n));
}

function renderRevenue() {
  if (!$("revChart")) return;

  const done = adminOrders.filter((o) => o.status === "completed");
  const allTime = done.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
  $("revTotal").textContent = money(allTime);

  // Monday of the selected week
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + weekOffset * 7);

  const days = Array.from({ length: 7 }, (_, i) => {
    const from = new Date(monday);
    from.setDate(monday.getDate() + i);
    const to = new Date(from);
    to.setDate(from.getDate() + 1);

    const orders = done.filter((o) => o.createdMs >= from.getTime() && o.createdMs < to.getTime());
    return {
      date: from,
      revenue: orders.reduce((sum, o) => sum + (Number(o.total) || 0), 0),
      count: orders.length,
      isToday: from.getTime() === now.getTime()
    };
  });

  const weekTotal = days.reduce((sum, d) => sum + d.revenue, 0);
  const max = Math.max(...days.map((d) => d.revenue), 1);
  const dayName = (d) => d.date.toLocaleDateString("en-US", { weekday: "short" });

  // Bar chart
  $("revChart").innerHTML = `
    <p class="rev-week">This week: <strong>${money(weekTotal)}</strong></p>
    <div class="rev-bars">
      ${days.map((d) => `
        <div class="rev-col ${d.isToday ? "today" : ""}">
          <span class="rev-val">${d.revenue ? shortMoney(d.revenue) : ""}</span>
          <div class="rev-bar-wrap">
            <div class="rev-bar ${d.revenue ? "" : "empty"}" style="height:${d.revenue ? Math.max(6, (d.revenue / max) * 100) : 3}%"></div>
          </div>
          <span class="rev-day">${dayName(d)}</span>
        </div>
      `).join("")}
    </div>
  `;

  // Week calendar
  const fmt = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  $("calTitle").textContent = `${fmt(days[0].date)} – ${fmt(days[6].date)}`;
  $("calDays").innerHTML = days.map((d) => `
    <div class="cal-day ${d.isToday ? "today" : ""} ${d.count ? "has" : ""}">
      <span>${dayName(d).slice(0, 3)}</span>
      <strong>${d.date.getDate()}</strong>
    </div>
  `).join("");

  // Completion ring (cancelled orders are not counted)
  const counted = adminOrders.filter((o) => o.status !== "cancelled").length;
  const pct = counted ? Math.round((done.length / counted) * 100) : 0;
  $("completionSub").textContent = `${done.length} of ${counted} orders completed`;
  $("completionRing").style.setProperty("--pct", pct);
  $("completionRing").querySelector("span").textContent = `${pct}%`;
}

$("calPrev")?.addEventListener("click", () => {
  weekOffset--;
  renderRevenue();
});

$("calNext")?.addEventListener("click", () => {
  if (weekOffset < 0) weekOffset++;
  renderRevenue();
});


// ---------- Orders ----------
async function loadOrders() {
  const list = $("adminList");
  list.innerHTML = `<p class="empty">Loading...</p>`;

  try {
    const snapshot = await getDocs(collection(db, "orders"));

    adminOrders = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdMs || 0) - (a.createdMs || 0));

    render();
  } catch (error) {
    console.error("Load orders error:", error);
    list.innerHTML = `<p class="empty">Could not load orders: ${escapeHtml(error.code || error.message)}</p>`;
  }
}

function render() {
  const list = $("adminList");
  const filter = $("adminFilter").value;
  const search = $("adminSearch").value.trim().toLowerCase();

  const count = (status) => adminOrders.filter((o) => o.status === status).length;
  const sales = adminOrders
    .filter((o) => o.status === "completed")
    .reduce((sum, o) => sum + (Number(o.total) || 0), 0);

  $("adminStats").innerHTML = `
    <div class="stat"><strong>${adminOrders.length}</strong><span>All orders</span></div>
    <div class="stat"><strong>${count("pending")}</strong><span>Pending</span></div>
    <div class="stat"><strong>${count("accepted") + count("ontheway")}</strong><span>Active</span></div>
    <div class="stat"><strong>${money(sales)}</strong><span>Completed sales</span></div>
  `;

  renderRevenue();
  renderRemittances();

  const shown = adminOrders.filter((o) => {
    if (filter !== "all" && o.status !== filter) return false;
    if (!search) return true;

    return [o.orderNo, o.customerName, o.customerEmail, o.phone, o.receiver, o.pickup, o.dropoff]
      .some((field) => String(field ?? "").toLowerCase().includes(search));
  });

  if (!shown.length) {
    list.innerHTML = `<p class="empty">No orders match.</p>`;
    return;
  }

  list.innerHTML = shown.map((o) => {
    const [label, tone] = STATUS[o.status] || [o.status, "wait"];
    const options = Object.keys(STATUS).map((key) =>
      `<option value="${key}" ${key === o.status ? "selected" : ""}>${escapeHtml(STATUS[key][0])}</option>`
    ).join("");

    return `
      <article class="booking-card ${o.status === "cancelled" ? "cancelled" : ""}">
        <div class="booking-top">
          <h3>${escapeHtml(o.orderNo)}</h3>
          <span class="badge ${tone}">${escapeHtml(label)}</span>
        </div>
        <p><strong>Customer:</strong> ${escapeHtml(o.customerName)} · ${escapeHtml(o.phone)}</p>
        <p>${escapeHtml(o.customerEmail)}</p>
        <p>${VEHICLE_ICONS[o.vehicleId] || ""} ${escapeHtml(o.vehicleName)} · ${escapeHtml(String(o.distanceKm))} km</p>
        <p><strong>From:</strong> ${escapeHtml(o.pickup)}</p>
        <p><strong>To:</strong> ${escapeHtml(o.dropoff)}</p>
        <p><strong>Receiver:</strong> ${escapeHtml(o.receiver)} · ${escapeHtml(o.receiverPhone)}</p>
        <p>📦 ${escapeHtml(o.item)}${o.notes ? ` — “${escapeHtml(o.notes)}”` : ""}</p>
        <p>🕒 ${escapeHtml(o.scheduledFor)}${o.helper ? " · helper" : ""}${o.roundTrip ? " · round trip" : ""}</p>
        <p class="price">Total: ${money(o.total)} · ${escapeHtml(o.payment)}</p>
        <div class="admin-actions">
          <select data-status-for="${o.id}" aria-label="Order status">${options}</select>
          <button type="button" class="main-btn small" data-save-status="${o.id}">Update</button>
        </div>
      </article>
    `;
  }).join("");

  list.querySelectorAll("[data-save-status]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const id = btn.dataset.saveStatus;
      const select = list.querySelector(`[data-status-for="${id}"]`);
      updateStatus(id, select.value, btn);
    })
  );
}

async function updateStatus(orderId, status, button) {
  const order = adminOrders.find((o) => o.id === orderId);
  if (!order || !STATUS[status] || order.status === status) return;

  if (status === "cancelled" && !confirm(`Cancel order ${order.orderNo}?`)) return;

  button.disabled = true;
  button.textContent = "Saving...";

  try {
    await updateDoc(doc(db, "orders", orderId), { status });
    order.status = status;
    showMessage(`Order ${order.orderNo} is now "${STATUS[status][0]}".`, true);
    render();
  } catch (error) {
    console.error("Status update error:", error);
    showMessage("Could not update: " + (error.code || error.message));
    button.disabled = false;
    button.textContent = "Update";
  }
}

$("adminFilter").addEventListener("change", render);
$("adminSearch").addEventListener("input", render);
$("adminRefresh").addEventListener("click", loadOrders);


// ---------- Drivers: add / enable / disable ----------
// Adds a "Drivers" panel to the dashboard (built here, no HTML change needed).
let drivers = [];

function ensureDriversPanel() {
  if ($("driversPanel")) return;
  const panel = document.createElement("details");
  panel.id = "driversPanel";
  panel.className = "gx-admin";
  panel.innerHTML = `
    <summary><strong>🚚 Drivers <span id="driverCount"></span></strong></summary>
    <form id="driverForm" autocomplete="off">
      <label for="drvName">Name</label>
      <input id="drvName" required>
      <label for="drvPhone">Phone</label>
      <input id="drvPhone" inputmode="tel" required>
      <label for="drvEmail">Email (driver login)</label>
      <input id="drvEmail" type="email" required>
      <label for="drvPass">Temporary password</label>
      <input id="drvPass" type="text" minlength="6" required>
      <button class="main-btn" id="drvBtn" type="submit">Add driver</button>
    </form>
    <div id="driverList"></div>`;
  $("adminStats").insertAdjacentElement("beforebegin", panel);
  $("driverForm").addEventListener("submit", addDriver);
}

async function loadDrivers() {
  ensureDriversPanel();
  try {
    const snapshot = await getDocs(collection(db, "drivers"));
    drivers = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    renderDrivers();
  } catch (error) {
    console.error("Load drivers error:", error);
    $("driverList").innerHTML = `<p class="empty">Could not load drivers: ${escapeHtml(error.code || error.message)}</p>`;
  }
}

function renderDrivers() {
  $("driverCount").textContent = drivers.length ? `(${drivers.length})` : "";
  $("driverList").innerHTML = drivers.length
    ? drivers.map((d) => {
        const off = d.active === false;
        return `
          <article class="booking-card ${off ? "cancelled" : ""}">
            <div class="booking-top">
              <h3>${escapeHtml(d.name)}</h3>
              <span class="badge ${off ? "bad" : "ok"}">${off ? "Disabled" : "Active"}</span>
            </div>
            <p>${escapeHtml(d.phone)} · ${escapeHtml(d.email)}</p>
            <div class="admin-actions">
              <button type="button" class="ghost-btn small" data-driver-toggle="${d.id}">${off ? "Enable" : "Disable"}</button>
            </div>
          </article>`;
      }).join("")
    : `<p class="empty">No drivers yet.</p>`;

  $("driverList").querySelectorAll("[data-driver-toggle]").forEach((btn) =>
    btn.addEventListener("click", () => toggleDriver(btn.dataset.driverToggle, btn))
  );
}

async function addDriver(event) {
  event.preventDefault();
  const name = $("drvName").value.trim();
  const phone = $("drvPhone").value.trim();
  const email = $("drvEmail").value.trim();
  const pass = $("drvPass").value;
  const btn = $("drvBtn");

  btn.disabled = true;
  btn.textContent = "Adding...";

  // A separate Firebase app creates the login, so you stay signed in as admin.
  const temp = initializeApp(firebaseConfig, "driver-create-" + Date.now());
  try {
    const cred = await createUserWithEmailAndPassword(getAuth(temp), email, pass);
    await setDoc(doc(db, "drivers", cred.user.uid), {
      name, phone, email, active: true, createdMs: Date.now()
    });
    showMessage(`Driver ${name} added. Give them the email and password to log in at driver.html.`, true);
    $("driverForm").reset();
    await loadDrivers();
  } catch (error) {
    console.error("Add driver error:", error);
    showMessage(
      error.code === "auth/email-already-in-use" ? "That email already has an account."
      : error.code === "auth/weak-password" ? "Password must be at least 6 characters."
      : error.code === "permission-denied" ? "Login created, but saving the driver was blocked. Update your Firestore rules (drivers: admin can write)."
      : `Could not add driver: ${error.code || error.message}`
    );
  } finally {
    await deleteApp(temp).catch(() => {});
    btn.disabled = false;
    btn.textContent = "Add driver";
  }
}

async function toggleDriver(id, button) {
  const d = drivers.find((x) => x.id === id);
  if (!d) return;
  const makeActive = d.active === false;
  if (!makeActive && !confirm(`Disable ${d.name}? They will no longer be able to use the driver app.`)) return;

  button.disabled = true;
  try {
    await updateDoc(doc(db, "drivers", id), { active: makeActive });
    d.active = makeActive;
    showMessage(`${d.name} is now ${makeActive ? "active" : "disabled"}.`, true);
    renderDrivers();
  } catch (error) {
    console.error("Toggle driver error:", error);
    showMessage("Could not update driver: " + (error.code || error.message));
    button.disabled = false;
  }
}


// ---------- Remittances: verify your drivers' GCash payments ----------
// Must match PLATFORM_RATE in driver.js
const PLATFORM_RATE = 0.20;
const isCash = (o) => /cash/i.test(o.payment || "");
const cutOf = (o) => Math.round((Number(o.total) || 0) * PLATFORM_RATE * 100) / 100;

let remits = [];
let remitFilter = "pending";

function ensureRemitPanel() {
  if ($("remitPanel")) return;
  const panel = document.createElement("details");
  panel.id = "remitPanel";
  panel.className = "gx-admin";
  panel.innerHTML = `
    <summary><strong>💸 Driver remittances <span id="remitCount"></span></strong></summary>
    <div class="gx-sum" id="remitSum"></div>
    <div class="gx-info" id="remitOwed"></div>
    <div class="gx-tabs" id="remitTabs">
      <button type="button" data-rf="pending">Pending</button>
      <button type="button" data-rf="confirmed">Confirmed</button>
      <button type="button" data-rf="rejected">Rejected</button>
      <button type="button" data-rf="all">All</button>
    </div>
    <div id="remitList"></div>`;
  $("adminStats").insertAdjacentElement("beforebegin", panel);

  $("remitTabs").querySelectorAll("[data-rf]").forEach((b) =>
    b.addEventListener("click", () => { remitFilter = b.dataset.rf; renderRemittances(); })
  );
}

async function loadRemittances() {
  ensureRemitPanel();
  try {
    const snapshot = await getDocs(collection(db, "remittances"));
    remits = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdMs || 0) - (a.createdMs || 0));
    renderRemittances();
  } catch (error) {
    console.error("Load remittances error:", error);
    $("remitList").innerHTML = `<p class="empty">Could not load remittances: ${escapeHtml(error.code || error.message)}</p>`;
  }
}

function renderRemittances() {
  ensureRemitPanel();

  const total = (list) => list.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const by = (status) => remits.filter((r) => r.status === status);
  const pending = by("pending");
  $("remitCount").textContent = pending.length ? `(${pending.length} pending)` : "";

  // Still owed: delivered cash orders not covered by a pending or confirmed remittance
  const covered = new Set(remits.filter((r) => r.status !== "rejected").flatMap((r) => r.orderIds || []));
  const owedOrders = adminOrders.filter((o) =>
    o.status === "completed" && o.driverId && isCash(o) && !covered.has(o.id)
  );
  const owed = owedOrders.reduce((s, o) => s + cutOf(o), 0);

  const perDriver = {};
  owedOrders.forEach((o) => {
    const key = o.driverName || o.driverId;
    perDriver[key] = perDriver[key] || { amount: 0, count: 0 };
    perDriver[key].amount += cutOf(o);
    perDriver[key].count += 1;
  });

  $("remitSum").innerHTML = `
    <div><strong>${money(owed)}</strong><span>Owed by drivers</span></div>
    <div><strong>${money(total(pending))}</strong><span>To verify</span></div>
    <div><strong>${money(total(by("confirmed")))}</strong><span>Confirmed</span></div>`;

  $("remitOwed").innerHTML = Object.keys(perDriver).length
    ? "<strong>Still owed:</strong><br>" + Object.entries(perDriver).map(([name, v]) =>
        `${escapeHtml(name)}: ${money(v.amount)} (${v.count} order${v.count === 1 ? "" : "s"})`).join("<br>")
    : "No driver owes you anything right now. ✅";

  $("remitTabs").querySelectorAll("[data-rf]").forEach((b) =>
    b.classList.toggle("active", b.dataset.rf === remitFilter)
  );

  const shown = remitFilter === "all" ? remits : by(remitFilter);
  const stamp = { pending: ["wait", "Pending"], confirmed: ["paid", "Confirmed"], rejected: ["bad", "Rejected"] };
  const isDuplicate = (r) => remits.some((x) => x.id !== r.id && String(x.gcashRef) === String(r.gcashRef));

  $("remitList").innerHTML = shown.length ? shown.map((r) => {
    const [tone, text] = stamp[r.status] || ["wait", r.status];
    return `
      <article class="booking-card ${r.status === "rejected" ? "cancelled" : ""}">
        <div class="booking-top">
          <h3>${money(r.amount)} · ${escapeHtml(r.driverName)}</h3>
          <span class="gx-stamp ${tone}">${text}</span>
        </div>
        <p><strong>GCash ref:</strong> ${escapeHtml(r.gcashRef)}</p>
        ${isDuplicate(r) ? `<p style="color:#b91c1c"><strong>⚠ This reference number was used in another remittance.</strong></p>` : ""}
        <p>Orders: ${escapeHtml((r.orderNos || []).join(", "))}</p>
        <p class="hint">Submitted ${new Date(r.createdMs || 0).toLocaleString()}</p>
        ${r.status === "pending" ? `
          <p class="hint">Check your GCash transactions: same amount and same reference number.</p>
          <div class="admin-actions">
            <button type="button" class="main-btn small" data-remit-ok="${r.id}">Confirm</button>
            <button type="button" class="ghost-btn small danger" data-remit-no="${r.id}">Reject</button>
          </div>` : ""}
      </article>`;
  }).join("") : `<p class="empty">No ${remitFilter === "all" ? "" : remitFilter + " "}remittances.</p>`;

  $("remitList").querySelectorAll("[data-remit-ok]").forEach((btn) =>
    btn.addEventListener("click", () => setRemitStatus(btn.dataset.remitOk, "confirmed", btn)));
  $("remitList").querySelectorAll("[data-remit-no]").forEach((btn) =>
    btn.addEventListener("click", () => setRemitStatus(btn.dataset.remitNo, "rejected", btn)));
}

async function setRemitStatus(id, status, button) {
  const r = remits.find((x) => x.id === id);
  if (!r) return;

  const ask = status === "confirmed"
    ? `Confirm ${money(r.amount)} from ${r.driverName} (ref ${r.gcashRef})?\n\nOnly confirm if you see this payment in your GCash history.`
    : `Reject this remittance from ${r.driverName}? They will have to submit it again.`;
  if (!confirm(ask)) return;

  button.disabled = true;
  try {
    await updateDoc(doc(db, "remittances", id), {
      status,
      [status === "confirmed" ? "confirmedMs" : "rejectedMs"]: Date.now(),
      reviewedBy: auth.currentUser?.email || "admin"
    });
    r.status = status;
    showMessage(`Remittance from ${r.driverName} ${status}.`, true);
    renderRemittances();
  } catch (error) {
    console.error("Remittance update error:", error);
    showMessage("Could not update: " + (error.code || error.message));
    button.disabled = false;
  }
}
