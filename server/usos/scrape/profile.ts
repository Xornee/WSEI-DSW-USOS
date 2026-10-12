import { load } from "cheerio";
/**
 * Strona profilowa (`katalog2/osoby/pokazOsobe`) nie ma kafelka z etykietami —
 * imie i nazwisko siedza w <title> w formacie "Imie Nazwisko - Katalog, ...".
 * E-mail bywa ukryty ustawieniem prywatnosci uzytkownika i wtedy go nie ma.
 */
export function parseDisplayName(html: string): string | null {
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]
  if (!title) return null

  const name = title.split(' - ')[0]?.replace(/\s+/g, ' ').trim()
  if (!name || name.length < 3) return null
  // Strona bledu/logowania tez ma <title> — odrzucamy to, co nie wyglada na osobe.
  if (/usosweb|katalog|b[łl][ąa]d|logowanie/i.test(name)) return null
  return name
}

export function parseEmail(html: string): string | null {
  const $ = load(html);
  $('footer, header, nav, #layout-footer, #footer').remove();
  const addresses = new Set<string>();
  $('tr, .inline-keyvalue-list > div, dl').each((_, element) => {
    const row = $(element);
    const label = row.children().first().text().trim();
    if (!/^(e-?mail|adres e-?mail|poczta elektroniczna)\s*:?$/i.test(label)) return;
    row.find('a[href^="mailto:"]').each((_, link) => {
      const address = $(link).attr('href')?.slice(7).split('?')[0];
      if (address && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) addresses.add(address);
    });
  });
  return addresses.size === 1 ? [...addresses][0]! : null;
}
