const $ = (id) => document.getElementById(id);
const screen = $("screen");
const painter = screen.getContext("2d");
let socket;
let state = "idle";
let operation = false;
let latestFrame = 0;
let movingAt = 0;

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("theme").textContent = theme === "dark" ? "Light mode" : "Dark mode";
  try {
    localStorage.setItem("usos-theme", theme);
  } catch {
    /* Optional local preference. */
  }
}
try {
  setTheme((localStorage.getItem("usos-theme") || localStorage.getItem("usos-pilot-theme")) || "light");
} catch {
  setTheme("light");
}
$("theme").onclick = () =>
  setTheme(
    document.documentElement.dataset.theme === "dark" ? "light" : "dark",
  );

function display(data) {
  if (data.workerRuntime)
    $("viewer-help").textContent =
      data.workerRuntime === "kubernetes"
        ? "1280 × 800 · własny pod Kubernetes · usuwany po weryfikacji"
        : "1280 × 800 · isolated browser process · no recording";
  state = data.state || state;
  const titles = {
    idle: "Ready to connect",
    starting: "Opening Chromium…",
    login: "Complete your login",
    connected: "Backend connected",
    expired: "USOS session expired",
    error: "Login interrupted",
  };
  $("state").textContent = titles[state] || "Disconnected";
  $("origin").textContent =
    data.origin && data.origin !== "null"
      ? data.origin
      : "Chromium · isolated session";
  $("connection").textContent =
    state === "connected" ? "VERIFIED" : state === "login" ? "LIVE" : "OFFLINE";
  $("placeholder").hidden = state === "login" || state === "connected";
  screen.hidden = state !== "login";
  $("focus").hidden = state !== "login";
  $("success").hidden = state !== "connected";
  $("open-dashboard").hidden =
    state !== "connected" || !data.dashboardReady || operation || data.busy;
  $("calendar-card").hidden = state !== "connected" || Boolean(data.timetableSource);
  $("calendar-status").textContent = data.calendarConfigured
    ? "Calendar connected to this account."
    : data.calendarState === "connecting"
      ? "Connecting your calendar automatically…"
      : "Calendar not connected yet. Retry automatic connection below.";
  $("auto-calendar").hidden = Boolean(data.calendarConfigured);
  $("auto-calendar").disabled = Boolean(operation || data.busy);
  if (state !== "connected") $("calendar-url").value = "";
  $("start").textContent =
    state === "idle"
      ? "Połącz USOS / Uruchom Chromium"
      : "Uruchom Chromium ponownie";
  const busy = operation || data.busy;
  $("start").disabled = $("start-main").disabled = busy;
  $("verify").disabled = busy || !["login", "connected"].includes(state);
  $("verify").textContent =
    state === "connected"
      ? "Recheck backend connection"
      : "Verify USOS connection";
  $("disconnect").disabled = busy || state === "idle";
  $("expiry").textContent = data.expiresAt
    ? `Session expiry: ${new Date(data.expiresAt).toLocaleTimeString()}`
    : "";
  const list = data.requests || [];
  $("requests").replaceChildren(
    ...(list.length
      ? list.map((item) => {
          const li = document.createElement("li");
          li.textContent = `${item.destination} · ${item.count}`;
          return li;
        })
      : [
          Object.assign(document.createElement("li"), {
            textContent: "No remote requests yet.",
          }),
        ]),
  );
  if (state === "connected" || state === "idle" || state === "expired") {
    socket?.close();
    socket = null;
    latestFrame++;
    painter.clearRect(0, 0, screen.width, screen.height);
  }
  if (
    state === "login" &&
    !operation &&
    (!socket || socket.readyState === WebSocket.CLOSED)
  )
    connectViewer();
}

async function refresh() {
  try {
    const response = await fetch("/api/status");
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        socket?.close();
        socket = null;
        state = "idle";
        display({ state, requests: [] });
        location.replace("/account");
      }
      $("notice").textContent = data.error;
      return;
    }
    display(data);
  } catch {
    $("notice").textContent =
      "Pilot server is offline. Restart it, then reload this page.";
  }
}

async function action(route) {
  if (operation) return;
  operation = true;
  display({ state, busy: true });
  $("notice").textContent =
    route === "start" ? "Starting a fresh Chromium process…" : "Checking…";
  try {
    const response = await fetch(`/api/${route}`, { method: "POST" });
    const data = await response.json();
    $("notice").textContent = response.ok
      ? route === "verify" || route === "calendar/auto"
        ? data.calendarConfigured
          ? "USOS and calendar connected. Open your dashboard."
          : "USOS connected. Automatic calendar connection did not finish; use Retry in the calendar section."
        : route === "disconnect"
          ? "Browser and backend session cleared. Your other app is unchanged."
          : "Click inside the browser to type. After login returns to USOS, press Verify."
      : data.error;
  } catch {
    $("notice").textContent =
      "Connection interrupted. Check the pilot server and retry.";
  } finally {
    operation = false;
    await refresh();
  }
}
$("start").onclick = $("start-main").onclick = () => action("start");
$("verify").onclick = () => action("verify");
$("disconnect").onclick = () => action("disconnect");
$("auto-calendar").onclick = () => action("calendar/auto");
$("save-calendar").onclick = async () => {
  if (operation) return;
  operation = true;
  $("save-calendar").disabled = true;
  const url = $("calendar-url").value;
  $("calendar-url").value = "";
  try {
    const response = await fetch("/api/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await response.json();
    $("notice").textContent = response.ok
      ? "Calendar connected. Open the dashboard and refresh its plan."
      : data.error;
  } catch {
    $("notice").textContent = "Calendar connection failed. Try again.";
  } finally {
    operation = false;
    $("save-calendar").disabled = false;
    await refresh();
  }
};
$("focus").onclick = () => screen.focus();

function connectViewer() {
  socket = new WebSocket(`${location.origin.replace("http", "ws")}/viewer`);
  const current = socket;
  current.onmessage = (event) => {
    if (current !== socket) return;
    const message = JSON.parse(event.data);
    if (message.type === "status") display(message);
    if (message.type === "frame" && state === "login") {
      const serial = ++latestFrame;
      const frame = new Image();
      frame.onload = () => {
        if (serial === latestFrame && state === "login")
          painter.drawImage(frame, 0, 0, 1280, 800);
      };
      frame.src = `data:image/jpeg;base64,${message.data}`;
    }
  };
  current.onopen = () => {
    $("viewer-help").textContent =
      "Click the page to type · Ctrl+V to paste · complete MFA on your phone";
  };
  current.onclose = () => {
    if (state === "login")
      $("viewer-help").textContent =
        "Viewer disconnected. Reconnecting on the next status check…";
  };
}

function input(event) {
  if (socket?.readyState === WebSocket.OPEN && !operation)
    socket.send(JSON.stringify(event));
}
function pointer(event, action) {
  const rect = screen.getBoundingClientRect();
  input({
    type: "mouse",
    action,
    x: Math.max(
      0,
      Math.min(1279, ((event.clientX - rect.left) * 1280) / rect.width),
    ),
    y: Math.max(
      0,
      Math.min(799, ((event.clientY - rect.top) * 800) / rect.height),
    ),
    ...(action === "mouseWheel"
      ? { deltaY: Math.max(-3000, Math.min(3000, event.deltaY)) }
      : {}),
  });
}
screen.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  screen.focus();
  screen.setPointerCapture(event.pointerId);
  pointer(event, "mousePressed");
});
screen.addEventListener("pointerup", (event) => {
  if (event.button === 0) pointer(event, "mouseReleased");
});
screen.addEventListener("pointermove", (event) => {
  if (Date.now() - movingAt < 80) return;
  movingAt = Date.now();
  pointer(event, "mouseMoved");
});
screen.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    pointer(event, "mouseWheel");
  },
  { passive: false },
);
screen.addEventListener("contextmenu", (event) => event.preventDefault());
screen.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v")
    return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
    event.preventDefault();
    input({ type: "selectAll" });
    return;
  }
  // Escape + Shift lets keyboard users leave the remote canvas.
  if (event.key === "Escape" && event.shiftKey) {
    event.preventDefault();
    $("focus").focus();
    return;
  }
  const special = [
    "Backspace",
    "Tab",
    "Enter",
    "Escape",
    "Delete",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
    "PageUp",
    "PageDown",
  ];
  if (special.includes(event.key)) {
    event.preventDefault();
    input({ type: "key", key: event.key, shift: event.shiftKey });
  } else if (
    event.key.length === 1 &&
    (!event.ctrlKey || event.altKey) &&
    !event.metaKey
  ) {
    event.preventDefault();
    input({ type: "text", text: event.key });
  }
});
screen.addEventListener("paste", (event) => {
  event.preventDefault();
  const text = event.clipboardData.getData("text/plain");
  if (text.length > 2048) {
    $("notice").textContent = "Paste up to 2048 characters at once.";
    return;
  }
  input({ type: "text", text });
});
window.addEventListener("beforeunload", () => socket?.close());
setInterval(refresh, 3000);
void refresh();
