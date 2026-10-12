const bar = document.createElement("div");
bar.id = "connection-bar";
const link = document.createElement("a");
link.href = "/";
link.textContent = "Połączenie USOS / kalendarz";
const label = document.createElement("span");
label.textContent = "Osobna sesja konta · sprawdzanie połączenia…";
const accountLink = document.createElement("a");
accountLink.href = "/account";
accountLink.textContent = "Moje konto";
const menu = document.createElement("nav");
menu.setAttribute("aria-label", "Menu konta");
menu.append(accountLink, document.createTextNode(" · "), link);
bar.append(label, menu);
document.body.prepend(bar);
const publicSchedule = document.querySelector('meta[name="usos-public-plan"]')?.content === "true";
if (publicSchedule) {
  label.textContent = "Plan zajęć · harmonogram IDEIS Kraków";
  link.textContent = "Połącz USOS — automatyczny tok, oceny i profil";
}
let checking = false;
async function checkConnection() {
  if (publicSchedule || checking) return;
  checking = true;
  try {
    const response = await fetch("/api/status", { signal: AbortSignal.timeout(10_000) });
    if (response.status >= 500 || response.status === 429) throw new Error("Transient status failure");
    const data = await response.json();
    if (
      !response.ok ||
      data.state !== "connected" ||
      data.connectionId !==
        document.querySelector('meta[name="usos-connection"]')?.content
    ) {
      document.getElementById("root")?.replaceChildren();
      location.replace("/");
      return;
    }
    label.textContent = data.timetableSource
      ? "USOS połączony · plan z harmonogramu IDEIS Kraków"
      : data.calendarConfigured
      ? "USOS połączony · kalendarz tego konta podłączony"
      : "USOS połączony · plan niepodłączony (dodaj link iCal)";
  } catch {
    label.textContent = "Chwilowy brak połączenia. Ponawiam automatycznie…";
  } finally {
    checking = false;
  }
}
window.addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload();
});
window.addEventListener("pagehide", () =>
  document.getElementById("root")?.replaceChildren(),
);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void checkConnection();
});
setInterval(checkConnection, 3000);
void checkConnection();
