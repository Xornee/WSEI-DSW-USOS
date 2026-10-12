import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { readLimitedText } from './transport.mjs';

export const TIMETABLE_ORIGIN = 'https://harmonogram.krakow.ideis.pl';
export const DEFAULT_TRACK_ID = '958';
const GRID = 'gridViewPlanyTokow';
const TIMEZONE = 'Europe/Warsaw';
const REQUIRED_COLUMNS = ['Czas od', 'Czas do', 'Grupy', 'Zajęcia', 'Forma zaj.', 'Sala', 'Prowadzący', 'Forma zaliczenia', 'Id uruch.', 'Uwagi'];
const clean = value => value.replace(/\s+/g, ' ').trim();

export class TimetableError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function trackId(value = DEFAULT_TRACK_ID) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,5}$/.test(value))
    throw new TimetableError(400, 'Podaj poprawny numer toku (np. 958).');
  return value;
}
function dateParts(value, separator) {
  const parts = value.split(separator).map(Number);
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (parts.length !== 3 || year < 2000 || year > 2100 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    throw new TimetableError(502, 'Harmonogram zawiera nieprawidłową datę.');
  return parts;
}
const zonedFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
export function warsawInstant(date, time) {
  const [year, month, day] = dateParts(date, '-');
  if (!/^\d{1,2}:\d{2}$/.test(time)) throw new TimetableError(502, 'Nieprawidłowa godzina zajęć.');
  const [hour, minute] = time.split(':').map(Number);
  if (hour > 23 || minute > 59) throw new TimetableError(502, 'Nieprawidłowa godzina zajęć.');
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wanted;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(zonedFormat.formatToParts(instant).map(part => [part.type, Number(part.value)]));
    const observed = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    if (observed === wanted) return new Date(instant).toISOString();
    instant += wanted - observed;
  }
  throw new TimetableError(502, 'Nieistniejąca lokalna godzina zajęć.');
}
function isoDate(parts) { return parts.map((part, i) => String(part).padStart(i === 0 ? 4 : 2, '0')).join('-'); }

export function parseTrackPage(html, id = DEFAULT_TRACK_ID) {
  id = trackId(id);
  const $ = load(html);
  const name = clean($('.card-body p.text-center strong').first().text());
  const range = $('#RadioList_Termin3').attr('value')?.split('\\');
  if (!name || !range || range.length !== 3 || range[2] !== '3')
    throw new TimetableError(502, 'Nie rozpoznano strony toku ani zakresu całego semestru.');
  const from = isoDate(dateParts(range[0], ','));
  const to = isoDate(dateParts(range[1], ','));
  if (from > to || (Date.parse(to) - Date.parse(from)) > 370 * 86400000)
    throw new TimetableError(502, 'Nieprawidłowy zakres semestru.');
  // Parse only quoted state fields, never evaluate JavaScript from the source.
  const marker = `ASPx.createControl(MVCxClientGridView,'${GRID}'`;
  const start = html.indexOf(marker);
  if (start < 0) throw new TimetableError(502, 'Brak tabeli planu toku.');
  const control = html.slice(start, start + 50000);
  const state = {};
  for (const key of ['customOperationState', 'selection', 'callbackState']) {
    const value = control.match(new RegExp(`'${key}':'([^']*)'`))?.[1];
    if (value === undefined || value.length > 20000 || !/^[\w+/=]*$/.test(value))
      throw new TimetableError(502, 'Nie rozpoznano filtra semestru.');
    state[key] = value;
  }
  state.groupLevelState = {};
  state.keys = [];
  return { trackId: id, title: name, from, to, state };
}
function kind(label) {
  const value = label.toLowerCase();
  if (/wyk|^w$/.test(value)) return 'wyklad';
  if (/lab/.test(value)) return 'laboratorium';
  if (/sem/.test(value)) return 'seminarium';
  if (/lek/.test(value)) return 'lektorat';
  if (/ćw|cw|konw|ć|^c$/.test(value)) return 'cwiczenia';
  return 'inne';
}
export function parseTrackGrid(html, info) {
  const $ = load(html);
  const table = $(`#${GRID}_DXMainTable`);
  if (table.length !== 1 || (/'pageCount':\s*([2-9]|\d{2,})/.test(html) && !/'pageIndex':\s*-1\b/.test(html)) || /'visibleStartIndex':\s*[1-9]/.test(html))
    throw new TimetableError(502, 'Harmonogram nie zwrócił kompletnej tabeli semestru.');
  const headers = table.find(`[id=${GRID}_DXHeadersRow0]`).children('td').map((_, cell) => clean($(cell).text())).get();
  if (REQUIRED_COLUMNS.some(column => !headers.includes(column)))
    throw new TimetableError(502, 'Zmieniły się kolumny harmonogramu.');
  let date = null;
  const unique = new Map();
  for (const row of table.children('tbody').children('tr').toArray()) {
    const rowId = $(row).attr('id') || '';
    if (rowId.startsWith(`${GRID}_DXGroupRow`)) {
      const match = $(row).text().match(/Data Zajęć:\s*(\d{4}\.\d{2}\.\d{2})/);
      if (!match) throw new TimetableError(502, 'Nie rozpoznano dnia zajęć.');
      date = isoDate(dateParts(match[1], '.'));
    }
    if (!rowId.startsWith(`${GRID}_DXDataRow`)) continue;
    if (!date || date < info.from || date > info.to)
      throw new TimetableError(502, 'Zajęcia poza zakresem semestru lub bez daty.');
    const cells = $(row).children('td').map((_, cell) => clean($(cell).clone().find('script,style').remove().end().text())).get();
    const value = column => cells[headers.indexOf(column)] || '';
    const start = warsawInstant(date, value('Czas od'));
    const end = warsawInstant(date, value('Czas do'));
    const courseName = value('Zajęcia');
    if (!courseName || end <= start) throw new TimetableError(502, 'Nieprawidłowe zajęcia w harmonogramie.');
    const identifier = [info.trackId, date, start, end, courseName, value('Grupy'), value('Sala'), value('Prowadzący'), value('Forma zaj.'), value('Id uruch.')].join('|');
    const id = 'ideis-' + createHash('sha256').update(identifier).digest('hex').slice(0, 24);
    unique.set(id, {
      id, courseName, courseCode: null, kind: kind(value('Forma zaj.')), kindLabel: value('Forma zaj.') || null,
      start, end, room: value('Sala') || null, building: null,
      lecturer: value('Prowadzący') || null, group: value('Grupy') || null,
      assessment: value('Forma zaliczenia') || null,
      notes: /^(Brak|—|-)$/i.test(value('Uwagi')) ? null : value('Uwagi') || null,
      sourceId: value('Id uruch.') || null,
    });
    if (unique.size > 2000) throw new TimetableError(502, 'Za dużo zajęć w harmonogramie.');
  }
  if (!unique.size && !table.find('[id*=DXEmptyRow]').length)
    throw new TimetableError(502, 'Brak rozpoznanych zajęć lub jawnego pustego planu.');
  return {
    from: warsawInstant(info.from, '00:00'), to: warsawInstant(info.to, '23:59'),
    entries: [...unique.values()].sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id)),
    timetable: { trackId: info.trackId, title: info.title, url: `${TIMETABLE_ORIGIN}/Plany/PlanyTokow/${info.trackId}`, timezone: TIMEZONE, from: info.from, to: info.to },
  };
}
export class TimetableRepository {
  constructor({ defaultTrackId = DEFAULT_TRACK_ID, fetchImpl = fetch, ttl = 900000, intervalMs = 1200 } = {}) {
    this.defaultTrackId = trackId(defaultTrackId);
    this.fetch = fetchImpl; this.ttl = ttl; this.intervalMs = intervalMs;
    this.cache = new Map(); this.pending = new Map(); this.queue = Promise.resolve(); this.lastStart = 0;
  }
  async request(path, options = {}) {
    const run = async () => {
      const wait = this.intervalMs - (Date.now() - this.lastStart);
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      this.lastStart = Date.now();
      const response = await this.fetch(TIMETABLE_ORIGIN + path, {
        ...options, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(20000),
        headers: { 'User-Agent': 'USOS-Local/0.1 Public-Timetable', ...options.headers },
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new TimetableError(502, 'Serwis harmonogramu chwilowo nie odpowiada.');
      }
      return readLimitedText(response, 2000000);
    };
    const pending = this.queue.then(run);
    this.queue = pending.catch(() => {});
    return pending;
  }
  async get(id = this.defaultTrackId) {
    id = trackId(id);
    const cached = this.cache.get(id);
    if (cached && Date.now() - cached.at < this.ttl)
      return { ok: true, data: cached.plan, error: null, meta: { source: 'cache', fetchedAt: new Date(cached.at).toISOString(), stale: false } };
    if (this.pending.has(id)) return this.pending.get(id);
    if (this.pending.size >= 8) throw new TimetableError(429, 'Importy planów są zajęte. Spróbuj za chwilę.');
    const pending = (async () => {
      try {
        const info = parseTrackPage(await this.request(`/Plany/PlanyTokow/${id}`), id);
        const state = JSON.stringify(info.state).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        const body = new URLSearchParams({ DXCallbackName: GRID,
          __DXCallbackArgument: 'c0:KV|2;[];GB|35;14|CUSTOMCALLBACK15|[object Object];',
          [GRID]: state, parametry: `${info.from};${info.to};3;${id}`, id });
        // This is the public table's read-only date filter, not an account mutation.
        const html = await this.request(`/Plany/PlanyTokowGridCustom/${id}`, { method: 'POST', body });
        const plan = parseTrackGrid(html, info);
        const at = Date.now();
        this.cache.delete(id); this.cache.set(id, { plan, at });
        while (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value);
        return { ok: true, data: plan, error: null, meta: { source: 'live', fetchedAt: new Date(at).toISOString(), stale: false } };
      } catch (error) {
        if (error instanceof TimetableError) throw error;
        throw new TimetableError(502, 'Import planu nie powiódł się. Spróbuj ponownie.');
      } finally { this.pending.delete(id); }
    })();
    this.pending.set(id, pending);
    return pending;
  }
}
