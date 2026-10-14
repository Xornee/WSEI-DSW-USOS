// RFC 5545: escape TEXT, fold at 75 octets, CRLF, explicit UTC instants.
const escapeText = value => String(value || '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
const timestamp = value => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function fold(line) {
  let result = '', part = '', bytes = 0;
  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    if (bytes + size > 75) { result += part + '\r\n'; part = ' '; bytes = 1; }
    part += char; bytes += size;
  }
  return result + part;
}
export function serializePlan(plan, generatedAt = new Date()) {
  const stamp = timestamp(generatedAt);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//USOS lokalnie//Personal plan//PL', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Mój plan zajęć'];
  const seen = new Set();
  for (const entry of plan.entries) {
    const start = Date.parse(entry.start), end = Date.parse(entry.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('Nieprawidłowy termin zajęć.');
    const identity = JSON.stringify([plan.timetable?.trackId || 'ical', entry.id, entry.start, entry.group]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    // UTF-8 hex is deterministic across browsers and Node and cannot inject a content line.
    const uid = [...new TextEncoder().encode(identity)].map(byte => byte.toString(16).padStart(2, '0')).join('') + '@usos-local';
    lines.push('BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + stamp, 'DTSTART:' + timestamp(start), 'DTEND:' + timestamp(end),
      'SUMMARY:' + escapeText(entry.courseName), 'LOCATION:' + escapeText([entry.room, entry.building].filter(Boolean).join(', ')),
      'DESCRIPTION:' + escapeText([entry.kindLabel, entry.group && `Grupa: ${entry.group}`, entry.lecturer, entry.assessment, entry.notes].filter(Boolean).join('\n')), 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
