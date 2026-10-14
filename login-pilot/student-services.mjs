import { load } from 'cheerio';
import { tsImport } from 'tsx/esm/api';
const { STUDENT_SERVICES } = await tsImport('../shared/student-services.ts', import.meta.url);

/** Inventory actual connected-account links, not guessed endpoints or global API capabilities. */
export function discoverStudentServices(html, workflows, base) {
  const $ = load(html), discovered = new Map();
  $('a[href],usos-link[href],usos-module-link-tile[href]').slice(0, 1500).each((_, node) => {
    if ($(node).parents('[hidden],script,style').length) return;
    let action;
    try { action = new URL($(node).attr('href'), base).searchParams.get('_action') || ''; } catch { return; }
    const service = STUDENT_SERVICES.find(item => item.roots.some(root => root.endsWith('/') ? action.startsWith(root) : action === root || action.startsWith(root + '/')));
    if (!service || discovered.has(service.id)) return;
    const link = workflows.discoveredLink($(node).attr('href'), $(node).text().replace(/\s+/g, ' ').trim() || service.title, base);
    // Never load an action/download just to render the module inventory.
    if (link?.workflow.kind === 'page') discovered.set(service.id, link);
  });
  return { inspectedAt: new Date().toISOString(), services: STUDENT_SERVICES.map(({ id, title, description }) => ({
    id, title, description, state: discovered.has(id) ? 'discovered' : 'not_discovered', link: discovered.get(id) || null,
  })) };
}
