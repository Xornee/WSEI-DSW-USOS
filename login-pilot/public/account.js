const $ = (id) => document.getElementById(id);
let registering = false;
let setup = false;
let registrationEnabled = false;
let busy = false;
let connectionState = "idle";
let providerState = [];
let linkedProviders = [];
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("theme").textContent = theme === "dark" ? "Tryb jasny" : "Tryb ciemny";
  try {
    localStorage.setItem("usos-theme", theme);
  } catch {}
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
async function request(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Spróbuj ponownie.");
  return data;
}
function mode() {
  $("form-title").textContent = setup
    ? "Utwórz pierwsze konto"
    : registering
      ? "Dołącz do aplikacji"
      : "Zaloguj się";
  $("form-help").textContent = setup
    ? "Utwórz konto aplikacji z kodem od administratora. Logowanie do uczelni pozostaje osobnym krokiem."
    : "Użyj hasła aplikacji lub powiązanego konta Google / Microsoft. Logowanie do USOS pozostaje osobnym krokiem.";
  $("name-field").hidden = !registering;
  $("name").required = registering;
  $('registration-code-field').hidden = !registering;
  $('registration-code').required = registering;
  $('registration-code-help').textContent = registrationEnabled
    ? 'Kod otrzymasz od administratora platformy. Jest wymagany przy tworzeniu konta.'
    : 'Rejestracja jest zamknięta. Administrator musi skonfigurować kod.';
  $('submit-account').disabled = busy || (registering && !registrationEnabled);
  $("password").autocomplete = registering
    ? "new-password"
    : "current-password";
  $("submit-account").textContent = registering
    ? "Utwórz konto →"
    : "Zaloguj się →";
  $("switch-mode").hidden = setup;
  $("switch-mode").textContent = registering
    ? "Mam już konto — zaloguj się"
    : "Utwórz nowe konto";
}
async function refresh() {
  try {
    const response = await fetch("/api/auth/me");
    if (!response.ok) throw new Error("Serwer kont jest niedostępny.");
    const data = await response.json();
    setup = data.setupRequired;
    registrationEnabled = data.registrationEnabled === true;
    const providersResponse = await fetch('/api/auth/providers');
    if (!providersResponse.ok) throw new Error('Sprawdzanie dostawców nie powiodło się. Odśwież stronę.');
    const providers = await providersResponse.json();
    providerState = providers.providers; linkedProviders = providers.linked;
    renderProviders();
    $("signed-out").hidden = Boolean(data.user);
    $("signed-in").hidden = !data.user;
    $("connection-nav").hidden = !data.user;
    if (!data.user) {
      registering = setup || registering;
      mode();
      return;
    }
    $("profile-name").textContent = data.user.name;
    $("profile-login").textContent =
      `@${data.user.username} · ${data.user.role === "admin" ? "Administrator" : "Użytkownik"}`;
    const statusResponse = await fetch("/api/status");
    if (!statusResponse.ok) {
      location.reload();
      return;
    }
    const status = await statusResponse.json();
    connectionState = status.state;
    $("launch-connection").textContent = ["login", "connected"].includes(
      connectionState,
    )
      ? "Otwórz moje połączenie USOS ↗"
      : "Połącz USOS / Uruchom Chromium ↗";
    $("connection-status").textContent =
      status.state === "connected"
        ? "● USOS połączony"
        : status.state === "login"
          ? status.workerRuntime === "kubernetes"
            ? "● Chromium w Kubernetes — dokończ logowanie"
            : "● Chromium działa — dokończ logowanie"
          : "○ USOS niepołączony";
    $("my-dashboard").hidden = status.state !== "connected";
  } catch (error) {
    $("account-notice").textContent = error.message;
  }
}
$("switch-mode").onclick = () => {
  registering = !registering;
  $("password").value = "";
  $("registration-code").value = "";
  mode();
};
$("account-form").onsubmit = async (event) => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  $("submit-account").disabled = true;
  $("account-notice").textContent = "Chwila…";
  try {
    const input = {
      username: $("username").value,
      password: $("password").value,
    };
    if (registering)
      Object.assign(input, {
        name: $("name").value,
        registrationCode: $("registration-code").value,
      });
    await request(`/api/auth/${registering ? "register" : "login"}`, input);
    $("password").value = "";
    location.replace("/account");
  } catch (error) {
    $("account-notice").textContent = error.message;
  } finally {
    busy = false;
    $("registration-code").value = "";
    mode();
  }
};
$("logout").onclick = async () => {
  $("logout").disabled = true;
  try {
    await request("/api/auth/logout");
    location.replace("/account");
  } catch (error) {
    $("account-notice").textContent = error.message;
  } finally {
    $("logout").disabled = false;
  }
};
window.addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload();
});
window.addEventListener("pagehide", () => {
  $("password").value = "";
  $("signed-in").hidden = true;
});
void finishSocialLogin().then(refresh).then(() => {
  if ($("account-notice").textContent.trim() === "Sprawdzanie konta…")
    $("account-notice").textContent = "";
});

$("launch-connection").onclick = async () => {
  $("launch-connection").disabled = true;
  $("account-notice").textContent = "Otwieranie połączenia…";
  try {
    if (!["login", "connected"].includes(connectionState))
      await request("/api/start");
    location.assign("/");
  } catch (error) {
    $("account-notice").textContent = error.message;
  } finally {
    $("launch-connection").disabled = false;
  }
};
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refresh();
});

setInterval(() => {
  if (!document.hidden && !busy) void refresh();
}, 15000);

function clearSecrets() {
  for (const id of ['password','registration-code','provider-password','current-password','new-password','recovery-code','recover-password']) $(id).value = '';
  $('generated-recovery').textContent = '';
  $('generated-recovery').hidden = $('recovery-help').hidden = $('hide-recovery').hidden = true;
}
$('hide-recovery').onclick = clearSecrets;
window.addEventListener('pagehide', clearSecrets);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearSecrets(); });
$('security-form').onsubmit = async event => {
  event.preventDefault(); if (busy) return; busy = true;
  const action = event.submitter?.value;
  try {
    const data = await request(`/api/auth/${action}`, { currentPassword: $('current-password').value, newPassword: $('new-password').value });
    clearSecrets();
    if (action === 'recovery-code') {
      $('generated-recovery').textContent = data.recoveryCode;
      $('generated-recovery').hidden = $('recovery-help').hidden = $('hide-recovery').hidden = false;
    } else location.replace('/account');
  } catch(error) { $('account-notice').textContent = error.message; }
  finally { busy = false; $('current-password').value = ''; $('new-password').value = ''; }
};
$('recover-form').onsubmit = async event => {
  event.preventDefault(); if (busy) return; busy = true;
  try {
    await request('/api/auth/recover', { username: $('recover-username').value, recoveryCode: $('recovery-code').value.trim(), newPassword: $('recover-password').value });
    clearSecrets(); $('account-notice').textContent = 'Hasło zmienione. Zaloguj się nowym hasłem.';
  } catch(error) { $('account-notice').textContent = error.message; }
  finally { busy = false; $('recover-password').value = ''; $('recovery-code').value = ''; }
};

function renderProviders() {
  for (const provider of providerState) {
    const linked = linkedProviders.includes(provider.id);
    const login = $(`login-${provider.id}`), link = $(`link-${provider.id}`);
    login.disabled = busy || !provider.enabled;
    login.textContent = `Zaloguj przez ${provider.label}`;
    login.title = provider.message;
    link.disabled = busy || (!provider.enabled && !linked);
    link.textContent = `${linked ? 'Odłącz' : 'Połącz'} ${provider.label}`;
    $(`${provider.id}-status`).textContent = `${provider.label} · ${linked ? 'połączone' : provider.enabled ? 'niepołączone' : 'wymaga konfiguracji'}`;
  }
  $('social-help').textContent = providerState.some(provider => provider.enabled)
    ? 'Działa dla kont powiązanych wcześniej w profilu. Pierwszy raz? Utwórz konto lokalne poniżej.'
    : 'Google i Microsoft wymagają konfiguracji OAuth przez administratora. Na razie użyj konta lokalnego.';
}
async function finishSocialLogin() {
  const params = new URLSearchParams(location.search);
  if (params.get('oauth') !== 'complete') return;
  history.replaceState(null, '', '/account');
  busy = true;
  $('account-notice').textContent = 'Potwierdzanie logowania…';
  try {
    await request('/api/auth/oauth/complete');
    $('account-notice').textContent = 'Logowanie potwierdzone. Dostawca jest powiązany z kontem platformy.';
  } catch (error) { $('account-notice').textContent = error.message; }
  finally { busy = false; }
}
async function providerAction(id, action) {
  if (busy) return;
  if (action === 'unlink' && !confirm('Odłączyć ten sposób logowania? Hasło aplikacji nadal działa.')) return;
  busy = true; renderProviders();
  $('account-notice').textContent = action === 'unlink' ? 'Odłączanie dostawcy…' : 'Przekierowanie do dostawcy…';
  try {
    const input = action === 'start' ? {} : { currentPassword: $('provider-password').value };
    const result = await request(`/api/auth/oauth/${id}/${action}`, input);
    $('provider-password').value = '';
    if (action === 'unlink') {
      $('account-notice').textContent = 'Dostawca odłączony. Możesz używać hasła aplikacji.';
      await refresh();
    } else {
      const target = new URL(result.url);
      if (!['https:', 'http:'].includes(target.protocol)) throw new Error('Nieprawidłowy adres dostawcy.');
      location.assign(target.href);
    }
  } catch (error) { $('account-notice').textContent = error.message; }
  finally { busy = false; $('provider-password').value = ''; renderProviders(); }
}
for (const id of ['google', 'microsoft']) {
  $(`login-${id}`).onclick = () => providerAction(id, 'start');
  $(`link-${id}`).onclick = () => providerAction(id, linkedProviders.includes(id) ? 'unlink' : 'link');
}
