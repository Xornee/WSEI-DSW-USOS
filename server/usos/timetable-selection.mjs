import { load } from 'cheerio';
import { TimetableError, trackId } from './timetable.mjs';

const normalize = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const contains = (value, phrase) => (` ${normalize(value)} `).includes(` ${normalize(phrase)} `);
function modeOf(value) {
  const name = normalize(value);
  if (/\bniestacjonarne\b/.test(name) || /\bn\b/.test(name)) return 'N';
  if (/\bstacjonarne\b/.test(name) || /\bs\b/.test(name)) return 'S';
  return null;
}
function degreeOf(name, code = '') {
  const text = normalize(name);
  if (/\bmgr\b|\bmagisterskie\b|drugiego stopnia/.test(text) || /-M(?:gr)?$/i.test(code)) return 'masters';
  if (/\blic\b|\blicencjackie\b/.test(text) || /-Lic$/i.test(code)) return 'bachelors';
  if (/\binz\b|\binzynierskie\b/.test(text) || /-In$/i.test(code)) return 'engineering';
  return null;
}
function cycleOf(stage) {
  const field = stage.fields.find(field => /^cykl\b/i.test(field.label));
  const match = field?.value.match(/^(20\d{2})\s*\/\s*(\d{2}|20\d{2})\s*([ZL])$/i);
  if (!match) return null;
  const year = Number(match[1]);
  if (Number(match[2].length === 2 ? '20' + match[2] : match[2]) !== year + 1) return null;
  return year * 2 + (match[3].toUpperCase() === 'L' ? 1 : 0);
}

/** Only academic attributes are used; names, IDs, grades and credentials never enter public queries. */
export function studyHints(stages) {
  const hints = [];
  for (const programme of stages.programmes ?? []) {
    const active = programme.stages.filter(stage => stage.fields.some(field => field.kind === 'status' && /\bw trakcie\b|\brealizowan/i.test(field.value)));
    // Completed historical studies must not silently become the current programme.
    const eligible = active.length ? active : programme.stages.filter(stage => !stage.fields.some(field => field.kind === 'status'));
    const sorted = eligible.map(stage => ({ stage, cycle: cycleOf(stage) })).filter(item => item.cycle !== null).sort((a, b) => b.cycle - a.cycle);
    if (!sorted.length) continue;
    for (const { stage, cycle } of sorted.filter(item => item.cycle === sorted[0].cycle)) {
      const named = stage.name.match(/\b(\d{1,2})\s*semestr\b/i)?.[1];
      const coded = stage.code?.match(/(?:^|-)E(\d{1,2})(?:$|-)/i)?.[1];
      if (named && coded && named !== coded) continue;
      const semester = Number(named ?? coded);
      if (!Number.isInteger(semester) || semester < 1 || semester > 16) continue;
      const admissionIndex = cycle - semester + 1;
      const cohortYear = Math.floor(admissionIndex / 2);
      if (cohortYear < 2000 || cohortYear > 2100) continue;
      const specialty = clean(stage.name.split(';').slice(1).join(';')).replace(/^(?:ścieżka|specjalność)\s*/i, '') || null;
      const modeField = stage.fields.find(field => /tryb|forma studi/i.test(field.label));
      const nameMode = modeOf(programme.name), fieldMode = modeOf(modeField?.value);
      if (nameMode && fieldMode && nameMode !== fieldMode) continue;
      hints.push({ programme: programme.name, specialty, mode: fieldMode ?? nameMode, degree: degreeOf(programme.name, programme.code), cohortYear, admission: admissionIndex % 2 ? 'L' : 'Z' });
    }
  }
  return hints;
}

function options(html, control) {
  const start = html.indexOf(`MVCxClientListBox,'${control}_DDD_L'`);
  const source = start < 0 ? '' : html.slice(start, start + 30000).match(/'itemsInfo':\[([\s\S]*?)\]/)?.[1];
  if (!source) throw new TimetableError(502, 'Nie rozpoznano filtrów wyszukiwarki toków.');
  const values = [];
  for (const match of source.matchAll(/\{'value':(?:'([0-9]+)'|(-?\d+)),'text':'((?:\\.|[^'\\])*)'\}/g)) {
    const id = match[1] ?? match[2];
    if (Number(id) <= 0) continue;
    let title;
    try { title = JSON.parse('"' + match[3].replace(/\\'/g, "'").replace(/(?<!\\)"/g, '\\"') + '"'); }
    catch { throw new TimetableError(502, 'Nieprawidłowe etykiety wyszukiwarki toków.'); }
    values.push({ id: trackId(id), title: clean(title) });
  }
  if (!values.length) throw new TimetableError(502, 'Wyszukiwarka toków nie zwróciła filtrów.');
  return values;
}
export function parseTrackFilters(html) {
  return { programmes: options(html, 'Kierunki'), admissions: options(html, 'Nabory') };
}
export function parseTrackCandidates(html) {
  const $ = load(html), grid = 'gridViewZnajdzTok';
  const table = $(`#${grid}_DXMainTable`);
  if (table.length !== 1 || /'pageCount':\s*(?:[2-9]|\d{2,})/.test(html) || /'visibleStartIndex':\s*[1-9]/.test(html))
    throw new TimetableError(502, 'Wyszukiwarka nie zwróciła kompletnej listy toków.');
  const columns = table.find(`[id=${grid}_DXHeadersRow0]`).children('td').map((_, cell) => clean($(cell).text())).get();
  if (['Nabór', 'Kierunek', 'Specjalność', 'Nazwa Toku'].some(column => !columns.includes(column)))
    throw new TimetableError(502, 'Zmieniły się kolumny wyszukiwarki toków.');
  const tracks = new Map();
  for (const row of table.children('tbody').children('tr').toArray()) {
    if (!($(row).attr('id') ?? '').startsWith(`${grid}_DXDataRow`)) continue;
    const cells = $(row).children('td').map((_, cell) => clean($(cell).clone().find('script,style').remove().end().text())).get();
    const value = column => cells[columns.indexOf(column)] ?? '';
    const link = $(row).find('a[href*="PlanyTokow/"]');
    const id = link.attr('href')?.match(/^\/Plany\/PlanyTokow\/([1-9]\d{0,5})$/)?.[1];
    const admission = value('Nabór').match(/^(20\d{2})\/(20\d{2})\s+(zimowy|letni)$/i);
    if (link.length !== 1 || !id || !value('Kierunek') || !value('Nazwa Toku') || !admission || Number(admission[2]) !== Number(admission[1]) + 1)
      throw new TimetableError(502, 'Nie rozpoznano toku w wyszukiwarce.');
    const item = { trackId: id, title: value('Nazwa Toku'), programme: value('Kierunek'), specialty: value('Specjalność') || null, cohortYear: Number(admission[1]), admission: admission[3].toLowerCase() === 'zimowy' ? 'Z' : 'L', mode: modeOf(value('Nazwa Toku')), degree: degreeOf(value('Nazwa Toku')) };
    if (tracks.has(id) && JSON.stringify(tracks.get(id)) !== JSON.stringify(item)) throw new TimetableError(502, 'Sprzeczne dane toku.');
    tracks.set(id, item);
  }
  if (!tracks.size && !table.find('[id*=DXEmptyRow]').length) throw new TimetableError(502, 'Brak rozpoznanej listy toków.');
  if (tracks.size > 100) throw new TimetableError(502, 'Zbyt szeroka lista toków.');
  return [...tracks.values()];
}
export function matchingTracks(hint, tracks) {
  return tracks.filter(track => contains(hint.programme, track.programme) && track.cohortYear === hint.cohortYear && track.admission === hint.admission && (!hint.specialty || normalize(track.specialty) === normalize(hint.specialty)) && (!hint.mode || track.mode === hint.mode) && (!hint.degree || track.degree === hint.degree));
}
export function trackSelection(candidates, requestedId) {
  const options = candidates.map(({ trackId, title }) => ({ trackId, title }));
  if (requestedId !== undefined) {
    requestedId = trackId(requestedId);
    if (!options.some(item => item.trackId === requestedId)) throw new TimetableError(400, 'Ten tok nie pasuje do danych podłączonego konta.');
    return { state: 'confirmed', trackId: requestedId, candidates: options, message: 'Tok wybrany z dopasowań dla tego konta.' };
  }
  if (options.length === 1) return { state: 'automatic', trackId: options[0].trackId, candidates: options, message: 'Tok dopasowany automatycznie z kierunku, ścieżki, naboru i trybu studiów w USOS.' };
  return { state: options.length ? 'choice_required' : 'unresolved', trackId: null, candidates: options, message: options.length ? 'Dane USOS pasują do kilku toków. Wybierz swój plan z listy — numer nie jest potrzebny.' : 'USOS nie udostępnił jednoznacznych danych aktywnego toku. Sprawdź aktualny etap studiów lub połącz USOS ponownie.' };
}

/** Cache contains only public catalog data; account-specific matching stays in DashboardConnection. */
export class TrackCatalog {
  constructor(timetable, { ttl = 900000 } = {}) { this.timetable = timetable; this.ttl = ttl; this.cache = new Map(); this.pending = new Map(); }
  async cached(key, fetchValue) {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.at < this.ttl) return entry.value;
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.pending.size >= 8) throw new TimetableError(429, 'Wyszukiwanie toków jest zajęte. Spróbuj za chwilę.');
    const pending = (async () => {
      const value = await fetchValue();
      this.cache.set(key, { value, at: Date.now() });
      while (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value);
      return value;
    })();
    this.pending.set(key, pending);
    try { return await pending; } finally { this.pending.delete(key); }
  }
  async candidates(hints) {
    if (!hints.length) return [];
    const filters = await this.cached('filters', async () => parseTrackFilters(await this.timetable.request('/Plany/ZnajdzTok?Ukryj=True')));
    const result = new Map();
    for (const hint of hints) {
      const programmes = filters.programmes.filter(item => contains(hint.programme, item.title));
      const admissions = filters.admissions.filter(item => normalize(item.title) === `${hint.cohortYear} ${hint.cohortYear + 1} ${hint.admission === 'Z' ? 'zimowy' : 'letni'}`);
      // An ambiguous public filter is not a justification to fetch/guess a different cohort.
      if (programmes.length !== 1 || admissions.length !== 1) continue;
      const query = new URLSearchParams({ TrybStudiowId: '-1', WydzialId: '', naborId: admissions[0].id, kierunekId: programmes[0].id, specjalnoscId: '' });
      const tracks = await this.cached(query.toString(), async () => parseTrackCandidates(await this.timetable.request('/Plany/ZnajdzTok?' + query)));
      for (const track of matchingTracks(hint, tracks)) result.set(track.trackId, track);
    }
    return [...result.values()].sort((a, b) => a.title.localeCompare(b.title, 'pl'));
  }
}
export async function publicPlan(timetable, id) {
  const result = await timetable.get(id);
  return { ...result, data: { ...result.data, selection: { state: 'public', trackId: result.data.timetable.trackId, candidates: [], message: 'Publiczny plan wskazanego toku. Połącz USOS, aby automatycznie dopasować plan do swojego konta.' } } };
}
