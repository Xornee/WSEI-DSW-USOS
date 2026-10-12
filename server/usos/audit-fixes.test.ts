import { describe,it,expect } from 'vitest'
import { parseIcal,parseIcsDate } from './ical.js'
import { parseTerms } from './public-repository.js'
import { parseEmail } from './scrape/profile.js'
const cal = (body:string) => `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:synthetic\nDTSTART;TZID=Europe/Warsaw:20260920T100000\n${body}\nSUMMARY:Example\\; text\nEND:VEVENT\nEND:VCALENDAR`
describe('audit data regressions',()=>{
 it('C08 timezone is Warsaw independently of server TZ and DST',()=>{
  expect(parseIcal(cal('DURATION:PT1H')).entries[0]?.start).toBe('2026-09-20T08:00:00.000Z')
  expect(parseIcsDate('20260329T023000')).toBeNull()
  expect(parseIcsDate('20260920')).toBe('2026-09-19T22:00:00.000Z')
  expect(parseIcsDate('20261220T100000')).toBe('2026-12-20T09:00:00.000Z')
  expect(parseIcsDate('20260920T100000','Europe/Warsaw')).toBe('2026-09-20T08:00:00.000Z')
 })
 it('C09 duration, cancelled and escaped semicolon',()=>{
  const entry = parseIcal(cal('DURATION:PT1H')).entries[0]
  expect(entry?.end).toBe('2026-09-20T09:00:00.000Z')
  expect(entry?.courseName).toBe('Example; text')
  expect(parseIcal(cal('DURATION:PT1H\nSTATUS:CANCELLED')).entries).toHaveLength(0)
 })
 it.each(['RRULE:FREQ=DAILY;COUNT=3','RDATE:20260921T080000Z','EXDATE:20260920T080000Z','RECURRENCE-ID:20260920T080000Z'])('C09 refuses unsupported recurrence explicitly: %s',rule=>{
  expect(()=>parseIcal(cal(`DURATION:PT1H\n${rule}`))).toThrow(/cykle lub wyjątki/)
 })
 it('C11 unrelated mailto and footer never become student address',()=>{
  expect(parseEmail('<main><p>E-mail ukryty</p></main><footer><a href="mailto:contact@example.test">Kontakt</a></footer>')).toBeNull()
  expect(parseEmail('<a href="mailto:contact@example.test">Kontakt</a>')).toBeNull()
  expect(parseEmail('<table><tr><th>E-mail:</th><td><a href="mailto:student@example.test">Napisz</a></td></tr></table>')).toBe('student@example.test')
 })
 it('C14 invalid dates and reversed event interval are rejected',()=>{
  expect(parseIcsDate('20260230T100000Z')).toBeNull()
  expect(()=>parseIcal(cal('DTEND:20260920T070000Z'))).toThrow(/Koniec/)
  expect(()=>parseIcal(cal('DTEND:20260230T110000Z'))).toThrow(/datę/)
 })
 it('C14 academic dates validate round-trip and ordering',()=>{
  const term={id:'synthetic',name:{pl:'Test'},start_date:'2026-02-01',end_date:'2026-02-28',finish_date:'2026-03-01'}
  expect(parseTerms([term]).terms).toHaveLength(1)
  expect(()=>parseTerms([{...term,end_date:'2026-02-30'}])).toThrow(/data/)
  expect(()=>parseTerms([{...term,finish_date:'2026-01-01'}])).toThrow(/zakres/)
 })
})
