import { describe, expect, it } from 'vitest'
import type { ClassEntry } from '../../../shared/types'
import {
  addDays,
  dateKey,
  dayMinutes,
  entriesOnDay,
  layoutEntries,
  startOfWeek,
  validEntries,
} from './calendar'
import { gradeStyle, statusStyle } from './format'

const entry = (id: string, start: string, end: string): ClassEntry => ({
  id,
  start,
  end,
  courseName: id,
  courseCode: null,
  kind: 'wyklad',
  kindLabel: null,
  room: null,
  building: null,
  lecturer: null,
  group: null,
})
const at = (hour: number, minute = 0) =>
  new Date(2026, 8, 14, hour, minute).toISOString()

describe('desktop calendar', () => {
  it('starts a Sunday week on Monday without mutating the input', () => {
    const sunday = new Date(2026, 8, 20, 12)
    expect(dateKey(startOfWeek(sunday))).toBe('2026-8-14')
    expect(sunday.getHours()).toBe(12)
  })
  it('moves across month and year boundaries', () => {
    expect(dateKey(addDays(new Date(2026, 11, 31), 1))).toBe('2027-0-1')
  })
  it('sorts events and discards invalid or non-positive intervals', () => {
    expect(
      validEntries([
        entry('later', at(12), at(13)),
        entry('bad', 'bad', at(12)),
        entry('zero', at(9), at(9)),
        entry('earlier', at(8), at(10)),
      ]).map((e) => e.id),
    ).toEqual(['earlier', 'later'])
  })
  it('places overlapping events in separate columns', () => {
    const result = layoutEntries([
      entry('one', at(8), at(10)),
      entry('two', at(9), at(11)),
    ])
    expect(result.map(({ column, columns }) => [column, columns])).toEqual([
      [0, 2],
      [1, 2],
    ])
  })
  it('reuses a column for adjacent events in a chained overlap', () => {
    const result = layoutEntries([
      entry('a', at(8), at(10)),
      entry('b', at(9), at(12)),
      entry('c', at(10), at(11)),
    ])
    expect(result.map(({ column, columns }) => [column, columns])).toEqual([
      [0, 2],
      [1, 2],
      [0, 2],
    ])
  })
  it('resets column width after an overlap group ends', () => {
    const result = layoutEntries([
      entry('a', at(8), at(10)),
      entry('b', at(9), at(11)),
      entry('c', at(11), at(12)),
    ])
    expect(result[2]?.columns).toBe(1)
  })
  it('includes overnight events on both days but not after an exclusive midnight end', () => {
    const day = new Date(2026, 8, 14)
    const overnight = entry(
      'night',
      at(23),
      new Date(2026, 8, 15, 1).toISOString(),
    )
    expect(entriesOnDay([overnight], day)).toHaveLength(1)
    expect(entriesOnDay([overnight], addDays(day, 1))).toHaveLength(1)
    expect(
      entriesOnDay(
        [entry('midnight', at(23), addDays(day, 1).toISOString())],
        addDays(day, 1),
      ),
    ).toHaveLength(0)
  })
  it('clips overnight coordinates to the local day', () => {
    const day = new Date(2026, 8, 14)
    expect(dayMinutes(addDays(day, -1).toISOString(), day)).toBe(0)
    expect(dayMinutes(addDays(day, 1).toISOString(), day)).toBe(1440)
    expect(dayMinutes(at(9, 30), day)).toBe(570)
  })
})

describe('semantic light-theme states', () => {
  it.each([
    'niezaliczony',
    'nie zaliczono',
    'niezdany',
    'nie ukończono',
    'nieaktywny',
    'skreślony',
  ])('marks %s as negative', (value) => {
    expect(statusStyle(value)).toBe('tone-rose')
  })
  it.each(['zaliczony', 'ukończony', 'aktywny'])(
    'marks %s as positive',
    (value) => {
      expect(statusStyle(value)).toBe('tone-green')
    },
  )
  it('distinguishes in-progress, missing and failing grades', () => {
    expect(statusStyle('w trakcie')).toBe('tone-amber')
    expect(gradeStyle(null)).toBe('tone-neutral')
    expect(gradeStyle(2)).toBe('tone-rose')
  })
})
