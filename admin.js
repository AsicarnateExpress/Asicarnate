import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";

import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  updateDoc,
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
