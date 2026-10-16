import { randomBytes, createHmac } from 'node:crypto';
import { load } from 'cheerio';
import { tsImport } from 'tsx/esm/api';
import { accountId, HOME } from './browser.mjs';

const { ACCOUNT_SECTIONS } = await tsImport('../shared/sections.ts', import.meta.url);
const { UNIVERSITY_RESOURCES } = await tsImport('../shared/university.ts', import.meta.url);
const { STUDENT_SERVICES } = await tsImport('../shared/student-services.ts', import.meta.url);
const { parseAccountSection, navigationLink, sensitiveQueryName, sourceUrlOf } = await tsImport('../server/usos/scrape/sections.ts', import.meta.url);
const ORIGIN = 'https://usosweb.ideis.pl';
const text = value => value.replace(/\s+/g, ' ').trim();
const controller = action => `${ORIGIN}/kontroler.php?_action=${action}`;
export const WORKFLOW_ENTRIES = new Map([
  ...Object.entries(ACCOUNT_SECTIONS).map(([id, section]) => [id, { title: section.title, url: controller(section.action) }]),
  ['course-catalog', { title: 'Katalog przedmiotów', url: controller('katalog2/przedmioty/index') }],
  ['registration-calendar', { title: 'Kalendarz rejestracji', url: controller('news/rejestracje/index') }],
  ['registration-subjects', { title: 'Przedmioty i zapisy', url: controller('dla_stud/rejestracja/przedmioty') }],
  ['study-progress', { title: 'Przebieg studiów', url: controller('dla_stud/studia/zaliczenia/index') }],
  ['contact', { title: 'Kontakt z uczelnią', url: controller('news/kontakt') }],
  ['news', { title: 'Aktualności', url: controller('news/default') }],
  ...UNIVERSITY_RESOURCES.map(resource => [`resource:${resource.id}`, { title: resource.title, url: resource.url }]),
]);
const READ_ROOTS = ['katalog2/przedmioty/', 'katalog2/osoby/', 'katalog2/jednostki/', 'dodatki/platnosci/',
  'dodatki/wnioski/', 'dla_stud/rejestracja/', 'dla_stud/studia/', 'news/',
  ...STUDENT_SERVICES.flatMap(service => service.roots).filter(root => root.endsWith('/'))];
const WRITE_ROOTS = ['dodatki/wnioski/', 'dla_stud/rejestracja/', 'dla_stud/studia/stypendia/', 'dla_stud/studia/mlegitymacja/',
  ...STUDENT_SERVICES.filter(service => ['allocations', 'surveys', 'exams', 'meetings', 'mail', 'internships', 'clearances', 'statements', 'notifications'].includes(service.id))
    .flatMap(service => service.roots).filter(root => root.endsWith('/'))];
const READ_EXACT = new Set(['home/grupy', 'home/index']);
const READ_NAME = /^(?:index|default|lista|list|kalendarz|przedmioty|grupy|grupyDziekanskie|rankingi|wyborJednostki|details|view|show|szczegoly|pokaz\w*|szukaj\w*|wyszukaj\w*|naleznosci\w*|wplaty\w*|kontaWirtualne|planyRatalne|stypendia|pobierz\w*|download\w*|pdf\w*|druk\w*|eksport\w*|kontakt)$/i;
const MUTATION = /(?:usun|usuń|dodaj|zapisz|zarejestr|wyrejestr|rejestruj|unregister|register|delete|accept|cofnij|rezygn|wycof|odrzuc|zmien|przypisz|odepnij|podlacz|odlacz|zglos|przeslij|opublikuj|ukryj|przywroc|zamknij|wlacz|wylacz|activate|deactivate|remove|edit|create|send|change|set(?:$|[^a-z])|potwierdz|zatwierdz|wyslij|wyślij|submit|save|update|anuluj)/i;
const FORBIDDEN = /(?:logowanie|wyloguj|logout|password|haslo|hasło|session|token)/i;
const HIDDEN_NAME = /csrf|token|session|password|haslo/i;
const READ_QUERY = new Set(['_action','id','os_id','prz_kod','cyk_kod','grupa_kod','nr','jed_org_kod','_pattern','lang','lang_id','page','sort','key','csrf','token']);
const STATIC_READ_URLS = new Set(UNIVERSITY_RESOURCES.map(resource => new URL(resource.url).href));
const MAX_TARGETS = 384;
const MAX_FORMS = 128;
const TTL = 10 * 60_000;
const MAX_DOWNLOAD = 8_000_000;

export class WorkflowError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function workflowUrl(raw, base = HOME, write = false, label = '') {
  let url;
  try { url = new URL(raw, base); } catch { throw new WorkflowError(400, 'Nieprawidłowy adres czynności.'); }
  const actions = url.searchParams.getAll('_action');
  if (url.origin !== ORIGIN || url.pathname !== '/kontroler.php' || url.username || url.password || url.hash ||
      url.href.length > 6000 || actions.length !== 1 || FORBIDDEN.test(actions[0]) ||
      !/^[a-zA-Z0-9_/-]+$/.test(actions[0]) || actions[0].split('/').some(p => !p || p === '.' || p === '..') ||
      (!(write ? WRITE_ROOTS : READ_ROOTS).some(root => actions[0].startsWith(root)) && (write || !READ_EXACT.has(actions[0]))))
    throw new WorkflowError(400, 'Ta czynność nie należy do obsługiwanych spraw studenta.');
  const trustedStatic = STATIC_READ_URLS.has(url.href);
  const indexSelection = WRITE_ROOTS.some(root => actions[0].startsWith(root)) && /\/(?:index|default|list|lista)$/i.test(actions[0]) && [...url.searchParams.keys()].some(key => !['_action','lang','lang_id','page','sort'].includes(key.toLowerCase()));
  if (!write && !trustedStatic && (indexSelection || MUTATION.test(actions[0]) || MUTATION.test(label.normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/gi, 'l')) ||
      [...url.searchParams].some(([key, value]) => key !== '_action' && (!READ_QUERY.has(key.toLowerCase()) || MUTATION.test(value))) ||
      !READ_NAME.test(actions[0].split('/').at(-1))))
    throw new WorkflowError(409, 'Ta czynność wymaga potwierdzenia.');
  return url;
}
const keyFor = raw => {
  const result = navigationLink(raw);
  const url = new URL(result || raw);
  for (const name of [...url.searchParams.keys()]) if (sensitiveQueryName(name)) url.searchParams.delete(name);
  return url.href;
};
const UPLOAD_TYPES = { pdf:'application/pdf', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif' };
const UPLOAD_MAGIC = {
  'application/pdf': [Buffer.from('%PDF-')],
  'image/png': [Buffer.from([137,80,78,71,13,10,26,10])],
  'image/jpeg': [Buffer.from([255,216,255])],
  'image/gif': [Buffer.from('GIF87a'), Buffer.from('GIF89a')],
};
const uploadRules = accept => (accept || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
const acceptsType = (rule, extension, type) => rule.startsWith('.') ? rule === '.' + extension : rule.endsWith('/*') ? type.startsWith(rule.slice(0,-1)) : type === rule;
async function validateUpload(field, blob) {
  const name = blob.name || '', type = (blob.type || '').toLowerCase();
  if (!name || name.length > 150 || /[\x00-\x1f\x7f/\\]/.test(name))
    throw new WorkflowError(400, 'Nieprawidłowa nazwa załącznika.');
  const extension = name.toLowerCase().split('.').at(-1), expected = UPLOAD_TYPES[extension];
  if (!expected || !uploadRules(field.accept).some(rule => acceptsType(rule, extension, expected)))
    throw new WorkflowError(400, 'Załącznik nie pasuje do obsługiwanego formatu wymaganego przez uczelnię.');
  const bytes = Buffer.from(await blob.slice(0, 12).arrayBuffer());
  if ((type && type !== expected && type !== 'application/octet-stream') || !UPLOAD_MAGIC[expected].some(magic => bytes.subarray(0,magic.length).equals(magic)))
    throw new WorkflowError(400, 'Zawartość załącznika nie odpowiada deklarowanemu formatowi.');
}

const controlTypes = new Set(['text', 'email', 'number', 'date', 'tel', 'url', 'textarea', 'select', 'checkbox', 'radio', 'file']);

/** Connection-local capability store: URLs/hidden fields never come from the client. */
export class WorkflowConnection {
  constructor(connection) { this.connection = connection; this.targets = new Map(); this.forms = new Map(); this.draftSalt = randomBytes(32); }
  clear() { this.targets.clear(); this.forms.clear(); }
  prune(map, limit) {
    for (const [id, value] of map) if (Date.now() > value.expires) map.delete(id);
    while (map.size >= limit) map.delete(map.keys().next().value);
  }
  issue(url, label, kind = 'page') {
    this.prune(this.targets, MAX_TARGETS);
    const existing = [...this.targets].find(([, t]) => t.url === url && t.kind === kind && t.label === label);
    if (existing) return { target: existing[0], kind };
    const id = randomBytes(24).toString('hex');
    this.targets.set(id, { url, label, kind, expires: Date.now() + TTL });
    return { target: id, kind };
  }
  target(id) {
    this.connection.assertConnected();
    const target = typeof id === 'string' && /^[a-f0-9]{48}$/.test(id) ? this.targets.get(id) : null;
    if (!target || Date.now() > target.expires) throw new WorkflowError(410, 'Odśwież listę spraw — odnośnik wygasł.');
    return target;
  }
  discoveredLink(raw, label, base) {
    try {
      const absolute = new URL(raw, base).href;
      let url, action = false;
      try { url = workflowUrl(absolute, base, false, label); }
      catch { url = workflowUrl(absolute, base, true); action = true; }
      const download = /pobierz|download|pdf|załącznik|zalacznik/i.test(`${url.searchParams.get('_action')} ${label}`);
      const workflow = this.issue(url.href, label, action ? 'action' : download ? 'download' : 'page');
      this.targets.get(workflow.target).returnUrl = base;
      return { label, url: keyFor(url.href), workflow };
    } catch { return null; }
  }
  collectLinks(html, base) {
    const $ = load(html), main = $('#layout-main-content > .usos-ui').first();
    const links = [];
    main.find('a[href],usos-link[href],usos-module-link-tile[href]').each((_, node) => {
      if ($(node).parents('[hidden],script,style').length) return;
      const label = text($(node).text()) || $(node).attr('title') || 'Szczegóły';
      const link = this.discoveredLink($(node).attr('href'), label, base);
      if (link && !links.some(x => x.workflow.target === link.workflow.target)) links.push(link);
    });
    return links;
  }
  decorate(data, html, base) {
    const links = this.collectLinks(html, base);
    const byUrl = new Map();
    for (const link of links) { const key = JSON.stringify([link.url, link.label]); const list = byUrl.get(key) || []; list.push(link); byUrl.set(key, list); }
    const visit = value => {
      if (!value || typeof value !== 'object') return;
      if (typeof value.url === 'string' && typeof value.label === 'string') {
        const raw = sourceUrlOf(value);
        const matches = byUrl.get(JSON.stringify([keyFor(value.url), value.label])) || [];
        // Never correlate distinct capability addresses through a lossy sanitized URL.
        const link = raw ? this.discoveredLink(raw, value.label, base) : matches.length === 1 ? matches[0] : null;
        value.url = keyFor(value.url);
        if (link) value.workflow = link.workflow;
      }
      if (typeof value.text === 'string' && Array.isArray(value.links))
        value.text = text(value.links.reduce((body, link) => body.split(link.label).join(' '), value.text));
      for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(visit);
        else if (child && typeof child === 'object') visit(child);
    };
    visit(data);
    data.workflow = this.issue(base, data.title || 'Pełne szczegóły');
    data.hasForms = load(html)('#layout-main-content > .usos-ui form').length > 0;
    return data;
  }
  registerForm(definition) {
    this.prune(this.forms, MAX_FORMS);
    const id = randomBytes(24).toString('hex');
    this.forms.set(id, { ...definition, expires: Date.now() + TTL });
    const url = new URL(definition.url);
    for (const key of [...url.searchParams.keys()]) if (HIDDEN_NAME.test(key)) url.searchParams.delete(key);
    const draftKey = createHmac('sha256', this.draftSalt).update(JSON.stringify([url.href, definition.method, definition.title, definition.submitLabel,
      definition.hidden.filter(([name]) => !HIDDEN_NAME.test(name)),
      definition.fields.map(field => [field.name, field.type, field.options.map(option => option.value)])])).digest('hex');
    return { id, draftKey, title: definition.title, submitLabel: definition.submitLabel,
      changesAccount: definition.method === 'POST' || definition.mutation, fields: definition.fields };
  }
  parseForms(html, base) {
    const $ = load(html), forms = [], notices = [];
    $('#layout-main-content > .usos-ui form').slice(0, 12).each((_, node) => {
      const element = $(node), fields = [], hidden = [], submits = [];
      let problem = false;
      const method = (element.attr('method') || 'GET').toUpperCase();
      let url;
      try { url = workflowUrl(element.attr('action') || base, base, method === 'POST'); }
      catch { notices.push('Formularz nie wskazuje obsługiwanej czynności studenta.'); return; }
      if (!['GET', 'POST'].includes(method) || element.find('[onclick],[onchange],usos-form,usos-input').length) problem = true;
      if (element.attr('enctype') && !['application/x-www-form-urlencoded', 'multipart/form-data'].includes(element.attr('enctype').toLowerCase())) problem = true;
      element.find('input,select,textarea,button').each((_, control) => {
        const item = $(control), name = item.attr('name') || '', tag = control.tagName.toLowerCase();
        const type = tag === 'input' ? (item.attr('type') || 'text').toLowerCase() : tag === 'button' ? (item.attr('type') || 'submit') : tag;
        if (item.is(':disabled') || item.parents('fieldset[disabled]').length) return;
        if (type === 'reset' || type === 'button') return;
        if (type === 'submit') { submits.push({ label: text(tag === 'input' ? item.attr('value') || 'Zatwierdź' : item.text()), name, value: item.attr('value') || '',
          action: item.attr('formaction'), method: item.attr('formmethod') }); return; }
        if (!name) return;
        if (type !== 'hidden' && name === '_action') { problem = true; return; }
        if (name.length > 200 || name === '__proto__' || name === 'constructor' || name === 'prototype') { problem = true; return; }
        if (type === 'hidden') { hidden.push([name, item.attr('value') || '']); return; }
        if (!controlTypes.has(type) || HIDDEN_NAME.test(name)) { problem = true; return; }
        const label = text(element.find('label').filter((__, l) => $(l).attr('for') === item.attr('id') && !!item.attr('id')).first().text()) ||
          text(item.closest('label').text()) || item.attr('aria-label') || item.attr('title') || name;
        const options = type === 'select' ? item.find('option').map((__, opt) => ({ value: $(opt).attr('value') ?? $(opt).text(), label: text($(opt).text()),
          selected: $(opt).is('[selected]'), disabled: $(opt).is('[disabled]') || $(opt).parents('optgroup[disabled]').length > 0 })).get() : [];
        if (options.length > 500) problem = true;
        let value = type === 'textarea' ? item.text() : item.attr('value') || '';
        if (type === 'checkbox' || type === 'radio') value = item.is('[checked]') ? (item.attr('value') || 'on') : '';
        if (type === 'select') value = options.find(x => x.selected)?.value ?? options.find(x => !x.disabled)?.value ?? '';
        fields.push({ name, label, type, value, required: item.is('[required]'), readonly: item.is('[readonly]'), multiple: item.is('[multiple]'),
          options: type === 'checkbox' || type === 'radio' ? [{ value: item.attr('value') || 'on', label, selected: item.is('[checked]'), disabled: false }] : options,
          maxLength: Math.min(Number(item.attr('maxlength')) || 16000, 16000), min: item.attr('min'), max: item.attr('max'), step: item.attr('step'), accept: item.attr('accept') });
      });
      if (fields.some(field => field.type === 'file' && (method === 'GET' || !uploadRules(field.accept).some(rule => Object.entries(UPLOAD_TYPES).some(([extension, type]) => acceptsType(rule, extension, type)))))) problem = true;
      if (fields.length > 80 || hidden.length > 100 || problem) { notices.push('Formularz zawiera niestandardowe kontrolki; jego obsługa wymaga kalibracji integracji.'); return; }
      const title = text(element.find('legend,h2,h3').first().text()) || text(element.prevAll('h1,h2,h3').first().text()) || 'Formularz sprawy';
      for (const submit of submits.length ? submits : [{ label: method === 'GET' ? 'Szukaj' : 'Zatwierdź', name: '', value: '' }]) {
        let submitUrl, submitMethod = (submit.method || method).toUpperCase();
        try { submitUrl = workflowUrl(submit.action || url.href, base, submitMethod === 'POST'); } catch { continue; }
        if (!['GET', 'POST'].includes(submitMethod)) continue;
        if (fields.some(field => hidden.some(([name]) => name === field.name))) { notices.push('Formularz zawiera niejednoznaczne pola.'); continue; }
        forms.push(this.registerForm({ title, submitLabel: submit.label || 'Zatwierdź', url: submitUrl.href, method: submitMethod, fields, multipart: element.attr('enctype')?.toLowerCase() === 'multipart/form-data',
          hidden: [...hidden, ...(submit.name ? [[submit.name, submit.value]] : [])], mutation: false, returnUrl: base }));
      }
    });
    return { forms, notices };
  }
  render(html, url, label) {
    const $ = load(html), main = $('#layout-main-content > .usos-ui').first();
    if (!main.length) throw new WorkflowError(502, 'Układ strony zmienił się. Odśwież sprawę po aktualizacji integracji.');
    const title = text(main.find('h1,h2,[slot="title"]').first().text()) || label;
    const sections = parseAccountSection(html, 'applications');
    this.decorate(sections, html, url);
    const parsed = this.parseForms(html, url), links = this.collectLinks(html, url);
    const content = main.clone();
    content.find('script,style,iframe,object,embed,form,table,dialog,[hidden],.wrhidden').remove();
    content.find('br').replaceWith('\n');
    const paragraphs = content.find('p,li,dt,dd,.warning,.notice,.inline-keyvalue-list').filter((_, el) => $(el).parents('p,li,.inline-keyvalue-list').length === 0)
      .map((_, el) => text($(el).text())).get().filter(Boolean);
    if (!paragraphs.length) { const body = text(content.text()); if (body) paragraphs.push(body); }
    return { target: this.issue(url, title).target, title, paragraphs: [...new Set(paragraphs)].slice(0, 100), tables: sections.tables, links,
      forms: parsed.forms, notices: parsed.notices };
  }
  async open({ entry, target, refresh = false }) {
    this.connection.assertConnected();
    if ((entry ? 1 : 0) + (target ? 1 : 0) !== 1) throw new WorkflowError(400, 'Wybierz jedną sprawę.');
    const source = entry ? WORKFLOW_ENTRIES.get(entry) : this.target(target);
    if (!source) throw new WorkflowError(404, 'Nieznana sprawa.');
    if (source.result) {
      if (!refresh) return source.result;
      const html = await this.connection.privatePageUrl(source.refreshUrl);
      return this.render(html, source.refreshUrl, source.label);
    }
    if (source.kind === 'download') throw new WorkflowError(400, 'Użyj przycisku pobierania dokumentu.');
    if (source.kind === 'action') {
      const form = this.registerForm({ title: source.label, submitLabel: source.label, url: source.url, method: 'GET', mutation: true, fields: [], hidden: [], returnUrl: source.returnUrl });
      return { target, title: source.label, paragraphs: ['Potwierdź wykonanie tej czynności na swoim koncie uczelnianym.'], tables: [], links: [], forms: [form], notices: [] };
    }
    workflowUrl(source.url);
    const html = await this.connection.privatePageUrl(source.url);
    return this.render(html, source.url, source.title || source.label);
  }
  validateFields(form, submitted, files) {
    if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) throw new WorkflowError(400, 'Nieprawidłowe pola formularza.');
    const names = new Set(form.fields.map(field => field.name));
    if (Object.keys(submitted).some(name => !names.has(name)) || files.some(file => !form.fields.some(f => f.type === 'file' && f.name === file.name)))
      throw new WorkflowError(400, 'Formularz zawiera obce pola.');
    const entries = [...form.hidden];
    for (const name of names) {
      const definitions = form.fields.filter(field => field.name === name), field = definitions[0];
      const values = submitted[name] ?? [];
      if (!Array.isArray(values) || values.length > 100 || values.some(value => typeof value !== 'string' || Buffer.byteLength(value) > 64000 || /\0/.test(value)))
        throw new WorkflowError(400, 'Nieprawidłowa wartość pola.');
      if (field.type === 'file') {
        const selected = files.filter(file => file.name === name);
        if ((field.required && !selected.length) || (!field.multiple && selected.length > 1)) throw new WorkflowError(400, `Sprawdź załącznik: ${field.label}.`);
        for (const file of selected) if (file.blob.size > 5_000_000 || !file.blob.size) throw new WorkflowError(400, 'Załącznik musi mieć od 1 bajta do 5 MB.');
        continue;
      }
      if (!field.multiple && !['checkbox'].includes(field.type) && values.length > 1) throw new WorkflowError(400, 'Pole ma zbyt wiele wartości.');
      if (field.required && (!values.length || values.every(value => !value.trim()))) throw new WorkflowError(400, `Uzupełnij pole: ${field.label}.`);
      const choices = definitions.flatMap(f => f.options).filter(option => !option.disabled).map(option => option.value);
      if (['select', 'checkbox', 'radio'].includes(field.type) && values.some(value => !choices.includes(value))) throw new WorkflowError(400, 'Wybierz dostępną opcję formularza.');
      if (values.some(value => value.length > (field.maxLength ?? 16000))) throw new WorkflowError(400, 'Wartość pola jest zbyt długa.');
      if (field.type === 'number' && values.some(value => value && (!Number.isFinite(Number(value)) ||
          (field.min !== undefined && Number(value) < Number(field.min)) || (field.max !== undefined && Number(value) > Number(field.max)))))
        throw new WorkflowError(400, `Sprawdź liczbę: ${field.label}.`);
      if (field.type === 'email' && values.some(value => value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) throw new WorkflowError(400, `Sprawdź adres e-mail: ${field.label}.`);
      if (field.readonly && (values.length !== 1 || values[0] !== field.value)) throw new WorkflowError(400, 'To pole pozostaje bez zmian.');
      for (const value of values) entries.push([name, value]);
    }
    return entries;
  }
  async submit(input, files = []) {
    this.connection.assertConnected();
    if (!input || Object.keys(input).some(key => !['formId', 'fields', 'confirmed'].includes(key))) throw new WorkflowError(400, 'Nieprawidłowy formularz.');
    const form = typeof input.formId === 'string' ? this.forms.get(input.formId) : null;
    if (!form || Date.now() > form.expires) throw new WorkflowError(410, 'Formularz wygasł lub został już wysłany. Odczytaj sprawę ponownie.');
    const changesAccount = form.method === 'POST' || form.mutation;
    if (changesAccount && input.confirmed !== true) throw new WorkflowError(409, 'Potwierdź zmianę na koncie uczelnianym.');
    const entries = this.validateFields(form, input.fields, files);
    for (const file of files) await validateUpload(form.fields.find(field => field.type === 'file' && field.name === file.name), file.blob);
    // Revalidate identity before consuming the single-use action and before any write.
    await this.connection.privatePage('home/index');
    this.connection.assertConnected();
    if (this.forms.get(input.formId) !== form || Date.now() > form.expires) { this.forms.delete(input.formId); throw new WorkflowError(410, 'Formularz wygasł lub został już wysłany.'); }
    this.forms.delete(input.formId);
    let url = workflowUrl(form.url, HOME, changesAccount);
    let body;
    if (form.method === 'GET') {
      const data = new URLSearchParams(entries);
      for (const name of new Set(data.keys())) url.searchParams.delete(name);
      for (const [name, value] of data) url.searchParams.append(name, value);
      url = workflowUrl(url.href, HOME, changesAccount);
    } else if (files.length || form.multipart) {
      body = new FormData();
      for (const [name, value] of entries) body.append(name, value);
      for (const file of files) body.append(file.name, file.blob, file.blob.name);
    } else body = new URLSearchParams(entries);
    // A timeout may mean the write reached USOS: never retry it automatically.
    const result = await this.connection.privatePageUrl(url.href, { method: form.method, body, mutation: changesAccount, includeUrl: true, beforeRequest: () => { if (Date.now() > form.expires) throw new WorkflowError(410, 'Formularz wygasł przed wysłaniem.'); } });
    if (changesAccount) { this.connection.cache.clear(); this.forms.clear(); }
    const page = this.render(result.html, result.url, form.title);
    // Back/refresh on a POST result never replays the source action.
    const snapshot = this.targets.get(page.target);
    snapshot.result = page; snapshot.resultAt = Date.now();
    try { snapshot.refreshUrl = workflowUrl(result.url).href; }
    catch { snapshot.refreshUrl = workflowUrl(form.returnUrl || controller('dodatki/wnioski/index')).href; }
    const snapshots = [...this.targets].filter(([, target]) => target.result);
    for (const [id] of snapshots.slice(0, Math.max(0, snapshots.length - 32))) this.targets.delete(id);
    return page;
  }
  async download(id) {
    const target = this.target(id);
    if (target.kind !== 'download') throw new WorkflowError(400, 'To nie jest dokument do pobrania.');
    workflowUrl(target.url);
    await this.connection.privatePage('home/index');
    return this.connection.schedule(async () => {
      this.connection.assertConnected();
      this.target(id); // Recheck after identity verification and scheduler wait.
      let response;
      try {
        response = await this.connection.worker.api.get(target.url, { signal: this.connection.controller.signal, maxBytes: MAX_DOWNLOAD });
        this.connection.assertConnected();
        const headers = response.headers?.() || {}, type = (headers['content-type'] || '').split(';')[0].toLowerCase();
        const bytes = await response.body();
        if (response.status() !== 200 || bytes.length > MAX_DOWNLOAD || ![
          'application/pdf', 'application/octet-stream', 'application/zip', 'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/csv', 'image/png', 'image/jpeg',
        ].includes(type) || (type === 'application/pdf' && !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))))
          throw new WorkflowError(502, 'Uczelnia nie zwróciła obsługiwanego dokumentu. Odśwież sprawę.');
        const filename = (headers['content-disposition']?.match(/filename="?([^";]+)/i)?.[1] || `${target.label}${type === 'application/pdf' ? '.pdf' : ''}`)
          .replace(/[^\p{L}\p{N}_. -]/gu, '_').slice(0, 150);
        return { bytes, type, filename: filename || 'dokument' };
      } finally { await response?.dispose().catch(() => {}); }
    });
  }
}
