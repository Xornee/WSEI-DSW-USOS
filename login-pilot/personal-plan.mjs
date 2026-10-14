import { createHash } from 'node:crypto';

export class PlanPreferenceError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const keyOf = entry => JSON.stringify([entry.courseCode || entry.courseName, entry.kind]);
export function groupOptions(entries) {
  const options = new Map();
  for (const entry of entries) {
    if (!entry.group) continue;
    const key = keyOf(entry);
    if (!options.has(key)) options.set(key, { key, courseName: entry.courseName, kindLabel: entry.kindLabel || entry.kind, groups: [] });
    const option = options.get(key);
    if (!option.groups.includes(entry.group)) option.groups.push(entry.group);
  }
  return [...options.values()].filter(option => option.groups.length > 1)
    .map(option => ({ ...option, groups: option.groups.sort((a, b) => a.localeCompare(b, 'pl')) }));
}
export function planScope(plan, identity) {
  return createHash('sha256').update(JSON.stringify([identity, plan.timetable?.trackId || 'ical', plan.from, plan.to])).digest('hex');
}
export function validateChoices(choices, options) {
  if (!choices || Array.isArray(choices) || typeof choices !== 'object' || Object.keys(choices).length > 128)
    throw new PlanPreferenceError(400, 'Nieprawidłowy wybór grup.');
  const allowed = new Map(options.map(option => [option.key, option.groups]));
  const result = Object.create(null);
  for (const [key, groups] of Object.entries(choices)) {
    const values = allowed.get(key);
    if (!values || !Array.isArray(groups) || !groups.length || groups.length > values.length ||
        groups.some(group => typeof group !== 'string' || !values.includes(group)) || new Set(groups).size !== groups.length)
      throw new PlanPreferenceError(400, 'Wybierz grupy dostępne w aktualnym planie.');
    result[key] = [...groups];
  }
  return result;
}
export function personalizePlan(plan, identity, saved = {}) {
  const options = groupOptions(plan.entries), choices = Object.create(null);
  let outdated = false;
  for (const option of options) {
    const value = saved[option.key];
    if (!Array.isArray(value)) continue;
    if (!value.length || value.some(group => !option.groups.includes(group))) { outdated = true; continue; }
    choices[option.key] = value;
  }
  const entries = plan.entries.filter(entry => !entry.group || !choices[keyOf(entry)] || choices[keyOf(entry)].includes(entry.group));
  const unresolved = options.filter(option => !choices[option.key]).length;
  return { ...plan, entries, personal: { scope: planScope(plan, identity), choices, options,
    state: outdated ? 'outdated' : unresolved ? 'choice_required' : options.length ? 'selected' : 'unambiguous',
    message: outdated ? 'Oznaczenia grup zmieniły się. Sprawdź wybór; dla zmienionych zajęć pokazujemy wszystkie grupy.'
      : unresolved ? `Dla ${unresolved} przedmiotów źródło podaje alternatywne grupy. Wybierz swoje grupy; do tego czasu pokazujemy wszystkie.`
      : options.length ? 'Twój wybór grup obowiązuje na Start, w planie i w eksporcie ICS.'
      : 'Źródło nie podaje alternatywnych grup dla tych samych zajęć. Pokazujemy cały dostępny plan.' } };
}
