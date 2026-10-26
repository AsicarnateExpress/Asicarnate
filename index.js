// =====================================
// 1. FIREBASE IMPORTS
// =====================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  collection,
  query,
  where,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";


// =====================================
// 2. FIREBASE CONFIGURATION
// =====================================
const firebaseConfig = {
  apiKey: "AIzaSyBB80cl3pVsse-6wa113swLABwjGlCB7G0",
  authDomain: "gabriel-f559e.firebaseapp.com",
  projectId: "gabriel-f559e",
  storageBucket: "gabriel-f559e.firebasestorage.app",
  messagingSenderId: "1065791350150",
  appId: "1:1065791350150:web:b77db4000428fa061f7807",
  measurementId: "G-6D5240BSMV"
};


// =====================================
// 3. CONNECT TO FIREBASE
// =====================================
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);


// =====================================
// 4. HELPER FUNCTIONS
// =====================================
function getElement(id) {
  return document.getElementById(id);
}

function valueOf(id) {
  return getElement(id)?.value.trim() || "";
}

function showMessage(message, success = false) {
  const box = getElement("message");

  if (box) {
    box.textContent = message;
    box.style.color = success ? "#21834b" : "#c0392b";
  } else {
    alert(message);
  }
}

function clearMessage() {
  showMessage("");
}

function setVisible(id, visible) {
  const element = getElement(id);

  if (element) {
    element.hidden = !visible;
  }
}

// Show exactly one main screen; widen the card for the dashboard
function showOnly(id) {
  ["loginBox", "signupBox", "forgotBox", "dashboard"].forEach((screen) =>
    setVisible(screen, screen === id)
  );
  getElement("container")?.classList.toggle("wide", id === "dashboard");
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}


// =====================================
// 5. SHOW AND HIDE PAGES
// =====================================
window.showSignup = function () {
  showOnly("signupBox");
  clearMessage();
};

window.showLogin = function () {
  showOnly("loginBox");
  clearMessage();
};

window.showForgotPassword = function () {
  showOnly("forgotBox");
  clearMessage();
};


// =====================================
// 6. SHOW / HIDE PASSWORD
// =====================================
window.togglePassword = function (inputId, button) {
  const input = getElement(inputId);

  if (!input) return;

  if (input.type === "password") {
    input.type = "text";
    button.textContent = "Hide";
  } else {
    input.type = "password";
    button.textContent = "Show";
  }
};


// =====================================
// 7. PASSWORD REQUIREMENTS
// =====================================
function validPassword(password) {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

function updatePasswordRequirements() {
  const passwordInput = getElement("signupPass");

  if (!passwordInput) return;

  const password = passwordInput.value;

  const requirements = {
    reqLength: password.length >= 8,
    reqUpper: /[A-Z]/.test(password),
    reqNumber: /\d/.test(password),
    reqSpecial: /[^A-Za-z0-9]/.test(password)
  };

  for (const id in requirements) {
    const item = getElement(id);

    if (!item) continue;

    const passed = requirements[id];

    item.classList.toggle("valid", passed);

    const check = item.querySelector(".check");

    if (check) {
      check.textContent = passed ? "✓" : "○";
    }
  }

  updateConfirmPassword();
}

function updateConfirmPassword() {
  const password = getElement("signupPass");
  const confirm = getElement("confirmPass");
  const message = getElement("matchMessage");

  if (!password || !confirm || !message) return;

  if (!confirm.value) {
    message.textContent = "";
    message.className = "match-message";
  } else if (password.value === confirm.value) {
    message.textContent = "✓ Passwords match";
    message.className = "match-message valid";
  } else {
    message.textContent = "✗ Passwords do not match";
    message.className = "match-message invalid";
  }
}

getElement("signupPass")?.addEventListener("input", updatePasswordRequirements);
getElement("confirmPass")?.addEventListener("input", updateConfirmPassword);

updatePasswordRequirements();


// =====================================
// 8. DISPLAY FIREBASE ERRORS
// =====================================
function firebaseError(error) {
  console.error("Firebase error:", error.code, error.message);

  const errors = {
    "auth/email-already-in-use": "This email is already registered.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/weak-password": "Your password is too weak.",
    "auth/operation-not-allowed": "Please enable Email/Password in Firebase Authentication.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/network-request-failed": "Check your internet connection.",
    "auth/too-many-requests": "Too many attempts. Please try again later."
  };

  showMessage(
    errors[error.code] ||
    `${error.code || "Error"}: ${error.message || "Please try again."}`
  );
}


// =====================================
// 9. SIGN UP
// =====================================
getElement("signupForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage();

  const firstName = valueOf("firstName");
  const lastName = valueOf("lastName");
  const username = valueOf("username").toLowerCase();
  const email = valueOf("signupEmail");
  const birthday = valueOf("birthday");
  const gender = valueOf("gender");
  const password = getElement("signupPass")?.value || "";
  const confirmPassword = getElement("confirmPass")?.value || "";
  const terms = getElement("terms");
  const button = getElement("signupButton");

  if (!firstName || !lastName || !username || !email ||
      !birthday || !gender || !password || !confirmPassword) {
    showMessage("Please complete all fields.");
    return;
  }

  if (!/^[a-z0-9_.]{3,20}$/.test(username)) {
    showMessage("Username must be 3–20 letters, numbers, dots, or underscores.");
    return;
  }

  if (!validPassword(password)) {
    showMessage("Please follow all four password requirements.");
    return;
  }

  if (password !== confirmPassword) {
    showMessage("Passwords do not match.");
    return;
  }

  if (!terms?.checked) {
    showMessage("Please agree to the Terms and Privacy Policy.");
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Creating account...";
  }

  let user = null;
  let step = "creating your account";

  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    user = credential.user;

    step = "saving your username";

    const usernameRef = doc(db, "usernames", username);
    const usernameSnapshot = await getDoc(usernameRef);

    if (usernameSnapshot.exists()) {
      showMessage(
        "Your account was created, but this username is already taken. Sign in with your email and choose another username."
      );
      return;
    }

    await setDoc(usernameRef, { username: username, uid: user.uid });

    step = "saving your profile";

    await setDoc(doc(db, "users", user.uid), {
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`,
      username,
      email,
      birthday,
      gender,
      createdAt: new Date().toISOString()
    });

    showMessage("Account created successfully!", true);

  } catch (error) {
    console.error("Sign-up step failed:", step, error);

    if (user) {
      showMessage(
        `Your Firebase account was created, but the next step failed while ${step}. Error: ${error.code || error.message}. You can sign in with your email; do not create another account with the same email.`
      );
    } else {
      firebaseError(error);
    }

  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Sign Up";
    }
  }
});


// =====================================
// 10. SIGN IN
// =====================================
getElement("loginForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage();

  const email = valueOf("loginEmail");
  const password = getElement("loginPass")?.value || "";

  if (!email || !password) {
    showMessage("Please enter your email and password.");
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
    showMessage("Login successful!", true);
  } catch (error) {
    firebaseError(error);
  }
});


// =====================================
// 11. FORGOT PASSWORD
// =====================================
getElement("forgotForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage();

  const email = valueOf("forgotEmail");

  if (!email) {
    showMessage("Please enter your email address.");
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    showMessage("Password reset email sent. Check your inbox and spam folder.", true);
  } catch (error) {
    firebaseError(error);
  }
});


// =====================================
// 12. DELIVERY SETTINGS
// =====================================
const CURRENCY = "₱";            // change to "$", "€", etc.
const HELPER_FEE = 150;          // loading helper
const ROUND_TRIP_RATE = 0.8;     // return trip adds 80% of the fare
const MAX_KM = 100;
const PHONE_DIGITS = 11;         // phone numbers must be exactly this many digits

const VEHICLES = [
  { id: "motorcycle", name: "Motorcycle", load: "Up to 20 kg",    base: 50,  perKm: 8,  icon: "🏍️" },
  { id: "sedan",      name: "Sedan",      load: "Up to 200 kg",   base: 120, perKm: 14, icon: "🚗" },
  { id: "van",        name: "L300 van",   load: "Up to 1,000 kg", base: 350, perKm: 25, icon: "🚐" },
  { id: "truck",      name: "Truck",      load: "Up to 2,000 kg", base: 600, perKm: 40, icon: "🚚" }
];

// Order status → label + badge color. Admins change these from admin.html.
const STATUS = {
  pending:   ["Finding driver", "wait"],
  accepted:  ["Driver assigned", "ok"],
  ontheway:  ["On the way", "ok"],
  completed: ["Completed", "ok"],
  cancelled: ["Cancelled", "bad"]
};

const money = (n) => `${CURRENCY}${Math.round(n).toLocaleString()}`;

function todayString() {
  const d = new Date();
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

function calcFare(vehicle, km, helper, roundTrip) {
  const base = vehicle.base;
  const distance = vehicle.perKm * km;
  const returnFee = roundTrip ? (base + distance) * ROUND_TRIP_RATE : 0;
  const helperFee = helper ? HELPER_FEE : 0;

  return {
    base,
    distance,
    returnFee,
    helperFee,
    total: Math.round(base + distance + returnFee + helperFee)
  };
}

// Phone fields accept digits only, max 11
["dlPhone", "dlReceiverPhone"].forEach((id) =>
  getElement(id)?.addEventListener("input", (event) => {
    event.target.value = event.target.value.replace(/\D/g, "").slice(0, PHONE_DIGITS);
  })
);


// =====================================
// 13. DASHBOARD + TABS
// =====================================
let currentUser = null;
let currentProfile = null;
let selectedVehicleId = "motorcycle";
let loadedOrders = [];

function switchTab(tabId) {
  document.querySelectorAll(".tab").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.tab === tabId)
  );
  document.querySelectorAll(".tab-panel").forEach((panel) =>
    panel.hidden = panel.id !== tabId
  );
  if (tabId === "tabOrders") loadOrders();
}

document.querySelectorAll(".tab").forEach((btn) =>
  btn.addEventListener("click", () => switchTab(btn.dataset.tab))
);

async function showDashboard(user) {
  currentUser = user;
  showOnly("dashboard");
  switchTab("tabBook");
  renderVehicles();

  getElement("dlDate").min = todayString();
  getElement("dlHelperLabel").textContent = `Need a loading helper (+${money(HELPER_FEE)})`;
  updateFare();
  initMap();

  getElement("welcome").textContent = "Welcome, " + (user.email || "User") + "!";
  getElement("profileName").textContent = "Loading...";
  getElement("profileEmail").textContent = user.email || "";
  getElement("profileUsername").textContent = "-";

  try {
    const profileSnapshot = await getDoc(doc(db, "users", user.uid));

    if (profileSnapshot.exists()) {
      currentProfile = profileSnapshot.data();

      getElement("profileName").textContent =
        currentProfile.fullName || currentProfile.firstName || "User";
      getElement("profileUsername").textContent = currentProfile.username || "-";
      getElement("welcome").textContent =
        "Welcome, " + (currentProfile.firstName || user.email) + "!";
    } else {
      getElement("profileName").textContent = "User";
    }
  } catch (error) {
    console.error("Profile error:", error);
    getElement("profileName").textContent = "User";
  }

}


// =====================================
// 14. VEHICLES + FARE ESTIMATE
// =====================================
function currentVehicle() {
  return VEHICLES.find((v) => v.id === selectedVehicleId) || VEHICLES[0];
}

function renderVehicles() {
  const list = getElement("vehicleList");
  if (!list) return;

  list.innerHTML = VEHICLES.map((v) => `
    <button type="button" class="vehicle-card ${v.id === selectedVehicleId ? "selected" : ""}" data-vehicle="${v.id}">
      <span class="v-icon">${v.icon}</span>
      <strong>${escapeHtml(v.name)}</strong>
      <small>${escapeHtml(v.load)}</small>
      <small>from ${money(v.base)}</small>
    </button>
  `).join("");

  list.querySelectorAll("[data-vehicle]").forEach((btn) =>
    btn.addEventListener("click", () => {
      selectedVehicleId = btn.dataset.vehicle;
      renderVehicles();
      updateFare();
    })
  );
}

function kmValue() {
  const km = parseFloat(getElement("dlKm").value);
  return Number.isFinite(km) ? km : 0;
}

function updateFare() {
  const box = getElement("fareSummary");
  if (!box) return;

  const km = kmValue();

  if (km <= 0) {
    box.textContent = "Add your addresses to see your fare";
    return;
  }

  const v = currentVehicle();
  const f = calcFare(v, km, getElement("dlHelper").checked, getElement("dlRoundTrip").checked);

  const row = (label, amount) =>
    `<div class="fare-row"><span>${label}</span><span>${money(amount)}</span></div>`;

  box.innerHTML =
    row(`${escapeHtml(v.name)} base fare`, f.base) +
    row(`Distance (${km} km × ${money(v.perKm)})`, f.distance) +
    (f.helperFee ? row("Loading helper", f.helperFee) : "") +
    (f.returnFee ? row("Round trip", f.returnFee) : "") +
    `<div class="fare-row total"><span>Total</span><span>${money(f.total)}</span></div>`;
}

["dlKm", "dlHelper", "dlRoundTrip"].forEach((id) =>
  getElement(id)?.addEventListener("input", updateFare)
);

getElement("dlWhen")?.addEventListener("change", () => {
  setVisible("dlLater", getElement("dlWhen").value === "later");
  getElement("orderBtn").textContent =
    getElement("dlWhen").value === "later" ? "Book for later" : "Book now";
});


// =====================================
// 14b. AUTOMATIC DISTANCE
// =====================================
// Uses free OpenStreetMap services (no API key): Nominatim finds the
// addresses and OSRM calculates the driving distance between them.
const GEO_COUNTRY_CODE = "ph";   // limits the address search to one country; use "" for worldwide
const KM_HINT = "Distance is calculated automatically from your addresses. You can also type it in.";

let distanceAuto = false;
let distanceRun = 0;

function setKmStatus(text, tone) {
  const el = getElement("dlKmStatus");
  if (!el) return;

  el.textContent = text;
  el.style.color = tone === "ok" ? "#21834b" : tone === "bad" ? "#c0392b" : "#64748b";
}

function resetDistanceStatus() {
  distanceAuto = false;
  setKmStatus(KM_HINT);
  clearMapPoints();
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function geocode(address) {
  const params = new URLSearchParams({ format: "json", limit: "1", q: address });
  if (GEO_COUNTRY_CODE) params.set("countrycodes", GEO_COUNTRY_CODE);

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) throw new Error("Address search failed");

  const results = await response.json();
  if (!results.length) return null;

  return { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) };
}

// Straight-line distance, used only if the route service is down
function straightKm(a, b) {
  const rad = (deg) => deg * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;

  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

async function routeKm(a, b) {
  try {
    const response = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`
    );
    const data = await response.json();

    if (data.code === "Ok" && data.routes?.[0]) {
      return { km: data.routes[0].distance / 1000, exact: true, geometry: data.routes[0].geometry };
    }
  } catch (error) {
    console.error("Route error:", error);
  }

  return { km: straightKm(a, b) * 1.3, exact: false, geometry: null };
}

// ---- Map: tap or drag pins to choose the pick-up and drop-off ----
// Leaflet + OpenStreetMap tiles (free, no API key)
const MAP_CENTER = [11.45, 123.15];   // where the map starts (Estancia, Iloilo)

let routeMap = null;
let routeLayer = null;
let pickupPoint = null;
let dropoffPoint = null;
let pickMode = null;
let lastGeocode = 0;
const markers = { pickup: null, dropoff: null };

function initMap() {
  if (routeMap) {
    routeMap.invalidateSize();
    return;
  }

  if (typeof L === "undefined" || !getElement("routeMap")) {
    setKmStatus("The map couldn't load. Check your internet connection, or type the distance yourself.", "bad");
    return;
  }

  routeMap = L.map("routeMap").setView(MAP_CENTER, 11);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(routeMap);

  routeMap.on("click", (event) => {
    if (pickMode) choosePoint(pickMode, event.latlng.lat, event.latlng.lng);
  });

  setTimeout(() => routeMap.invalidateSize(), 200);
}

function setPoint(kind, lat, lon, text) {
  const point = { lat, lon, text };

  if (kind === "pickup") pickupPoint = point;
  else dropoffPoint = point;

  if (!routeMap) return;

  if (markers[kind]) {
    markers[kind].setLatLng([lat, lon]);
    return;
  }

  const marker = L.marker([lat, lon], { draggable: true })
    .addTo(routeMap)
    .bindPopup(kind === "pickup" ? "Pick-up" : "Drop-off");

  // Dragging a pin moves the location and recalculates
  marker.on("dragend", () => {
    const p = marker.getLatLng();
    choosePoint(kind, p.lat, p.lng);
  });

  markers[kind] = marker;
}

async function reverseGeocode(lat, lon) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lon}`,
      { headers: { Accept: "application/json" } }
    );
    const data = await response.json();

    if (data.display_name) {
      return data.display_name.split(", ").slice(0, 3).join(", ");
    }
  } catch (error) {
    console.error("Reverse geocode error:", error);
  }

  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

async function choosePoint(kind, lat, lon) {
  pickMode = null;
  updatePickButtons();
  setPoint(kind, lat, lon, "");

  const input = getElement(kind === "pickup" ? "dlPickup" : "dlDropoff");
  input.value = "Finding address...";

  const text = await reverseGeocode(lat, lon);
  input.value = text;

  const point = kind === "pickup" ? pickupPoint : dropoffPoint;
  if (point) point.text = text;

  if (pickupPoint && dropoffPoint) {
    calculateDistance();
  } else {
    setKmStatus(
      kind === "pickup"
        ? "Pick-up set. Now choose the drop-off."
        : "Drop-off set. Now choose the pick-up.",
      "ok"
    );
  }
}

function updatePickButtons() {
  getElement("dlPickMapBtn")?.classList.toggle("active", pickMode === "pickup");
  getElement("dlDropMapBtn")?.classList.toggle("active", pickMode === "dropoff");
  getElement("routeMap")?.classList.toggle("picking", !!pickMode);
}

function startPick(kind) {
  pickMode = pickMode === kind ? null : kind;
  updatePickButtons();

  if (pickMode) {
    setKmStatus(`Tap the map to set the ${kind === "pickup" ? "pick-up" : "drop-off"} location.`);
    getElement("routeMap").scrollIntoView({ behavior: "smooth", block: "center" });
  } else {
    setKmStatus(KM_HINT);
  }
}

getElement("dlPickMapBtn")?.addEventListener("click", () => startPick("pickup"));
getElement("dlDropMapBtn")?.addEventListener("click", () => startPick("dropoff"));

function drawRoute(geometry) {
  if (!routeMap || !pickupPoint || !dropoffPoint) return;

  if (routeLayer) routeLayer.remove();

  routeLayer = geometry
    ? L.geoJSON(geometry, { style: { color: "#2563eb", weight: 5 } })
    : L.polyline(
        [[pickupPoint.lat, pickupPoint.lon], [dropoffPoint.lat, dropoffPoint.lon]],
        { color: "#2563eb", weight: 4, dashArray: "8 8" }
      );

  routeLayer.addTo(routeMap);
  routeMap.invalidateSize();
  routeMap.fitBounds(routeLayer.getBounds(), { padding: [30, 30] });
}

function clearMapPoints() {
  pickupPoint = null;
  dropoffPoint = null;
  pickMode = null;

  ["pickup", "dropoff"].forEach((kind) => {
    if (markers[kind]) {
      markers[kind].remove();
      markers[kind] = null;
    }
  });

  if (routeLayer) {
    routeLayer.remove();
    routeLayer = null;
  }

  updatePickButtons();
  routeMap?.setView(MAP_CENTER, 11);
}

// Uses the pin if one is already placed for this address, otherwise searches for it
async function pointFor(kind) {
  const text = valueOf(kind === "pickup" ? "dlPickup" : "dlDropoff");
  const existing = kind === "pickup" ? pickupPoint : dropoffPoint;

  if (existing && existing.text === text) return existing;

  const gap = Date.now() - lastGeocode;
  if (gap < 1100) await wait(1100 - gap);   // the free address service allows 1 request per second
  lastGeocode = Date.now();

  const found = await geocode(text);
  if (!found) return null;

  setPoint(kind, found.lat, found.lon, text);
  return kind === "pickup" ? pickupPoint : dropoffPoint;
}

async function calculateDistance() {
  const from = valueOf("dlPickup");
  const to = valueOf("dlDropoff");

  if (from.length < 5 || to.length < 5) {
    setKmStatus("Enter the pick-up and drop-off addresses first.", "bad");
    return;
  }

  const run = ++distanceRun;
  const button = getElement("dlAutoBtn");

  button.disabled = true;
  button.textContent = "Calculating...";
  setKmStatus("Finding your route...");

  try {
    const a = await pointFor("pickup");
    if (run !== distanceRun) return;

    const b = await pointFor("dropoff");
    if (run !== distanceRun) return;

    if (!a || !b) {
      setKmStatus(
        `Couldn't find the ${!a ? "pick-up" : "drop-off"} address. Add a barangay or city, tap it on the map, or type the distance yourself.`,
        "bad"
      );
      return;
    }

    const route = await routeKm(a, b);
    if (run !== distanceRun) return;

    const km = Math.max(1, Math.round(route.km * 10) / 10);

    getElement("dlKm").value = km;
    distanceAuto = true;
    updateFare();
    drawRoute(route.geometry);

    setKmStatus(
      route.exact
        ? `Distance calculated automatically: ${km} km`
        : `Estimated distance: ${km} km (route service unavailable)`,
      "ok"
    );

  } catch (error) {
    console.error("Distance error:", error);
    if (run === distanceRun) {
      setKmStatus("Couldn't calculate the distance. Check your connection or type it yourself.", "bad");
    }

  } finally {
    if (run === distanceRun) {
      button.disabled = false;
      button.textContent = "Calculate distance";
    }
  }
}

getElement("dlAutoBtn")?.addEventListener("click", calculateDistance);

// When the customer leaves an address field, pin it on the map.
// If both addresses are filled in, also calculate the distance and route.
async function pinAddress(kind) {
  const bothFilled =
    valueOf("dlPickup").length >= 5 && valueOf("dlDropoff").length >= 5;

  if (bothFilled) {
    calculateDistance();   // pins both and draws the route
    return;
  }

  const text = valueOf(kind === "pickup" ? "dlPickup" : "dlDropoff");
  if (text.length < 5) return;

  setKmStatus("Finding the address on the map...");

  try {
    const point = await pointFor(kind);

    if (!point) {
      setKmStatus(
        `Couldn't find the ${kind === "pickup" ? "pick-up" : "drop-off"} address. Add a barangay or city, or tap it on the map.`,
        "bad"
      );
      return;
    }

    routeMap?.setView([point.lat, point.lon], 15);
    setKmStatus(
      kind === "pickup"
        ? "Pick-up pinned. Now enter the drop-off."
        : "Drop-off pinned. Now enter the pick-up.",
      "ok"
    );
  } catch (error) {
    console.error("Pin error:", error);
    setKmStatus("Couldn't find that address. Check your connection or tap it on the map.", "bad");
  }
}

// Pin automatically ~1.2 seconds after the customer stops typing
// (also fires when they leave the field, e.g. on phones)
const pinTimers = {};

function schedulePin(kind) {
  clearTimeout(pinTimers[kind]);
  pinTimers[kind] = setTimeout(() => pinAddress(kind), 1200);
}

[["dlPickup", "pickup"], ["dlDropoff", "dropoff"]].forEach(([id, kind]) => {
  const input = getElement(id);
  input?.addEventListener("input", () => schedulePin(kind));
  input?.addEventListener("change", () => {
    clearTimeout(pinTimers[kind]);
    pinAddress(kind);
  });
});

// Typing the distance yourself switches back to manual
getElement("dlKm")?.addEventListener("input", () => {
  distanceAuto = false;
  setKmStatus("Distance entered manually.");
});


// =====================================
// 15. BOOK A DELIVERY
// =====================================
getElement("orderForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser) return;

  const msg = getElement("orderMessage");
  const button = getElement("orderBtn");
  const fail = (text) => { msg.textContent = text; msg.style.color = "#c0392b"; };
  const validPhone = (text) => new RegExp(`^\\d{${PHONE_DIGITS}}$`).test(text);

  const vehicle = currentVehicle();
  const km = kmValue();
  const pickup = valueOf("dlPickup");
  const dropoff = valueOf("dlDropoff");
  const phone = valueOf("dlPhone");
  const receiver = valueOf("dlReceiver");
  const receiverPhone = valueOf("dlReceiverPhone");
  const item = valueOf("dlItem");
  const notes = valueOf("dlNotes");
  const when = getElement("dlWhen").value;
  const helper = getElement("dlHelper").checked;
  const roundTrip = getElement("dlRoundTrip").checked;
  const payment = getElement("dlPayment").value;

  msg.textContent = "";

  if (pickup.length < 5) return fail("Enter the pick-up address.");
  if (!validPhone(phone)) return fail(`Your phone number must be ${PHONE_DIGITS} digits.`);
  if (dropoff.length < 5) return fail("Enter the drop-off address.");
  if (!receiver) return fail("Enter the receiver's name.");
  if (!validPhone(receiverPhone)) return fail(`The receiver's phone must be ${PHONE_DIGITS} digits.`);
  if (phone === receiverPhone) return fail("Your phone number and the receiver's phone number can't be the same.");
  if (km < 1 || km > MAX_KM) return fail(`Distance must be between 1 and ${MAX_KM} km. Tap Calculate distance.`);
  if (!item) return fail("Tell us what we're delivering.");

  let scheduledFor = "Now";

  if (when === "later") {
    const date = getElement("dlDate").value;
    const time = getElement("dlTime").value;
    const at = new Date(`${date}T${time}`);

    if (!date || !time || isNaN(at) || at < new Date()) {
      return fail("Choose a pick-up date and time in the future.");
    }
    scheduledFor = `${date} ${time}`;
  }

  const fare = calcFare(vehicle, km, helper, roundTrip);
  const orderRef = doc(collection(db, "orders"));
  const stamp = todayString().slice(2).replaceAll("-", "");
  const orderNo = `GB-${stamp}-${Math.floor(1000 + Math.random() * 9000)}`;

  button.disabled = true;
  button.textContent = "Booking...";

  try {
    await setDoc(orderRef, {
      uid: currentUser.uid,
      orderNo,
      customerName: currentProfile?.fullName || currentUser.email,
      customerEmail: currentUser.email,
      phone,
      vehicleId: vehicle.id,
      vehicleName: vehicle.name,
      pickup,
      dropoff,
      receiver,
      receiverPhone,
      item,
      notes,
      distanceKm: km,
      distanceAuto,
      scheduleType: when,
      scheduledFor,
      helper,
      roundTrip,
      payment,
      total: fare.total,
      status: "pending",
      createdMs: Date.now(),
      createdAt: serverTimestamp()
    });

    getElement("orderForm").reset();
    resetDistanceStatus();
    setVisible("dlLater", false);
    updateFare();
    showMessage(`Order ${orderNo} placed. We're finding you a driver.`, true);
    switchTab("tabOrders");

  } catch (error) {
    console.error("Order error:", error);

    if (error.code === "permission-denied") {
      fail("Permission denied. Publish the rules in firestore.rules in your Firebase Console (Firestore Database → Rules).");
    } else {
      fail(error.message || "Could not place your order. Try again.");
    }

  } finally {
    button.disabled = false;
    button.textContent = getElement("dlWhen").value === "later" ? "Book for later" : "Book now";
  }
});


// =====================================
// 16. MY ORDERS + CANCEL
// =====================================
async function loadOrders() {
  const list = getElement("orderList");
  if (!list || !currentUser) return;

  list.innerHTML = `<p class="empty">Loading...</p>`;

  try {
    const snapshot = await getDocs(
      query(collection(db, "orders"), where("uid", "==", currentUser.uid))
    );

    loadedOrders = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdMs || 0) - (a.createdMs || 0));

    if (!loadedOrders.length) {
      list.innerHTML = `<p class="empty">No orders yet. Book your first delivery.</p>`;
      return;
    }

    list.innerHTML = loadedOrders.map((o) => {
      const [label, tone] = STATUS[o.status] || [o.status, "wait"];
      const vehicle = VEHICLES.find((v) => v.id === o.vehicleId);

      return `
        <article class="booking-card ${o.status === "cancelled" ? "cancelled" : ""}">
          <div class="booking-top">
            <h3>${escapeHtml(o.orderNo)}</h3>
            <span class="badge ${tone}">${escapeHtml(label)}</span>
          </div>
          <p>${vehicle ? vehicle.icon : ""} ${escapeHtml(o.vehicleName)} · ${escapeHtml(String(o.distanceKm))} km</p>
          <p><strong>From:</strong> ${escapeHtml(o.pickup)}</p>
          <p><strong>To:</strong> ${escapeHtml(o.dropoff)} (${escapeHtml(o.receiver)})</p>
          <p>📦 ${escapeHtml(o.item)}</p>
          <p>🕒 ${escapeHtml(o.scheduledFor)}${o.helper ? " · helper" : ""}${o.roundTrip ? " · round trip" : ""}</p>
          <p class="price">Total: ${money(o.total)} · ${escapeHtml(o.payment)}</p>
          ${o.status === "pending"
            ? `<button type="button" class="ghost-btn small danger" data-cancel-order="${o.id}">Cancel order</button>`
            : ""}
        </article>
      `;
    }).join("");

    list.querySelectorAll("[data-cancel-order]").forEach((btn) =>
      btn.addEventListener("click", () => cancelOrder(btn.dataset.cancelOrder))
    );

  } catch (error) {
    console.error("Load orders error:", error);
    list.innerHTML = `<p class="empty">Could not load orders: ${escapeHtml(error.code || error.message)}</p>`;
  }
}

async function cancelOrder(orderId) {
  const order = loadedOrders.find((o) => o.id === orderId);
  if (!order) return;

  if (!confirm(`Cancel order ${order.orderNo}?`)) return;

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "orders", orderId), { status: "cancelled" });
    await batch.commit();

    showMessage("Order cancelled.", true);
    loadOrders();

  } catch (error) {
    console.error("Cancel error:", error);
    showMessage("Could not cancel: " + (error.code || error.message));
  }
}


// =====================================
// 18. LOG OUT
// =====================================
window.logout = async function () {
  if (!confirm("Are you sure you want to log out?")) {
    return;
  }

  try {
    await signOut(auth);
    showMessage("You have logged out successfully.", true);
  } catch (error) {
    firebaseError(error);
  }
};


// =====================================
// 19. CHECK LOGIN STATUS
// =====================================
onAuthStateChanged(auth, (user) => {
  if (user) {
    showDashboard(user);
  } else {
    currentUser = null;
    currentProfile = null;
    showOnly("loginBox");
  }
});
