import { EventEmitter } from 'node:events';
export const ROOT = 'https://usosweb.ideis.pl/kontroler.php';
export const page = (id, body) => `<script>const account={user_id: '${id}'};</script><main id="layout-main-content"><div class="usos-ui">${body}</div></main>`;
export const applications = id => page(id, `<h1>Wniosek demonstracyjny</h1><p>Testowy formularz i dokument.</p>
<table><tr><th>Sprawa</th><th>Akcje</th></tr><tr><td>Wniosek testowy</td><td><a href="?_action=dodatki/wnioski/pokaz&id=10">Szczegóły wniosku</a><a href="?_action=dodatki/wnioski/pobierz&id=10">Pobierz PDF</a><a href="?_action=dodatki/wnioski/usun&id=10&csrf=synthetic-url-csrf">Usuń szkic</a></td></tr></table>
<form method="post" action="?_action=dodatki/wnioski/wyslij"><input type="hidden" name="csrf" value="synthetic-hidden-csrf">
<label for="reason">Uzasadnienie</label><textarea id="reason" name="reason" required maxlength="1000"></textarea>
<label for="kind">Rodzaj</label><select id="kind" name="kind"><option value="basic">Podstawowy</option><option value="extended">Rozszerzony</option></select>
<label for="consent">Akceptuję</label><input id="consent" type="checkbox" name="consent" value="yes" required>
<label for="attachment">Załącznik</label><input type="file" id="attachment" name="attachment" accept="application/pdf">
<button type="submit" name="operation" value="send">Wyślij wniosek</button></form>`);
export class WorkflowWorker extends EventEmitter {
  constructor(id = '1001') {
    super(); this.expectedAccount = id; this.replyId = id; this.state = 'connected'; this.calls = []; this.writes = [];
    this.api = { get: (url, options) => this.reply('GET', url, options), post: (url, options) => this.reply('POST', url, options), dispose: async () => { this.disposed = true; } };
  }
  async reply(method, raw, options = {}) {
    const url = new URL(raw), action = url.searchParams.get('_action');
    this.calls.push({ method, url: raw });
    if (method === 'POST' || action.includes('/usun')) this.writes.push({ method, url: raw, body: options.body });
    if (this.failWrite && method === 'POST') throw new Error('Synthetic timeout after send');
    let status = 200, headers = { 'content-type': 'text/html' }, body;
    if (this.override) return this.override(method, raw, options);
    if (action === 'home/index') body = page(this.replyId, '<usos-frame id="info-frame"><ul><li>Numer albumu: <b>1001</b></li></ul></usos-frame>');
    else if (action === 'dodatki/wnioski/wyslij' || action.endsWith('/usun')) {
      if (this.redirect) { status = 303; headers.location = this.redirect; body = ''; }
      else body = page(this.replyId, '<h1>Stan sprawy</h1><p>Przyjęto wniosek testowy.</p>');
    } else if (action === 'dodatki/wnioski/pobierz') { headers = { 'content-type': this.badDownload ? 'text/html' : 'application/pdf', 'content-disposition': 'attachment; filename="synthetic.pdf"' }; body = this.badDownload ? '<h1>Login</h1>' : '%PDF-1.4\nSynthetic document\n%%EOF'; }
    else if (action === 'dodatki/wnioski/pokaz') body = page(this.replyId, '<h1>Szczegóły wniosku</h1><p>Status: szkic testowy.</p><a href="?_action=dodatki/wnioski/index">Lista wniosków</a>');
    else if (action === 'katalog2/przedmioty/index') body = page(this.replyId, '<h1>Katalog przedmiotów</h1><form method="get"><label for="pattern">Nazwa przedmiotu</label><input id="pattern" name="_pattern" required><button>Szukaj</button></form>' + (url.searchParams.has('_pattern') ? '<p>Wynik wyszukiwania: przedmiot testowy.</p>' : ''));
    else if (action === 'dla_stud/rejestracja/przedmioty') body = page(this.replyId, '<h1>Rejestracja demonstracyjna</h1><form method="post" action="?_action=dla_stud/rejestracja/zapisz"><label for="group">Grupa</label><select id="group" name="group"><option value="lab-a">Laboratorium A</option><option value="lab-b">Laboratorium B</option></select><button>Zapisz do grupy</button></form>');
    else if (action === 'dla_stud/rejestracja/zapisz') body = page(this.replyId, '<h1>Wynik rejestracji</h1><p>Testowy zapis: Laboratorium B.</p>');
    else if (action === 'katalog2/osoby/pokazOsobe') body = page(this.replyId, '<title>Student demonstracyjny - Profil</title><p>Testowy profil osoby.</p>');
    else if (action === 'dodatki/wnioski/index') body = applications(this.replyId);
    else body = page(this.replyId, '<h1>Lista demonstracyjna</h1><p>Nie masz żadnych pozycji.</p>');
    const bytes = Buffer.from(body);
    return { status: () => status, text: async () => body, body: async () => bytes, headers: () => headers, dispose: async () => {} };
  }
  record() {}
  status() { return { state: this.state, backendVerified: this.state === 'connected', requests: [] }; }
  async start() { this.state = 'login'; }
  async verify() { this.state = 'connected'; return true; }
  async startStream() {}
  async stopStream() {}
  async close() { this.state = 'disconnected'; }
}
export const validFields = { reason: ['Testowe uzasadnienie'], kind: ['extended'], consent: ['yes'] };
