import { load } from 'cheerio'
import type { ClassEntry, ClassKind, Plan } from '../../../shared/types.js'
import { ParserNotCalibratedError } from './errors.js'

const KIND_MAP: ReadonlyArray<readonly [RegExp, ClassKind]> = [
  [/wyk[łl]ad/i, 'wyklad'],
  [/[ćc]wiczen/i, 'cwiczenia'],
  [/laborator/i, 'laboratorium'],
  [/seminar/i, 'seminarium'],
  [/lektorat|j[eę]zyk/i, 'lektorat'],
]

export const classifyKind = (label: string | null | undefined): ClassKind => {
  if (!label) return 'inne'
  return KIND_MAP.find(([re]) => re.test(label))?.[1] ?? 'inne'
}

/**
 * Kalibracja: fixtures/plan.html -> selektory ponizej.
 * Zanim zrzut istnieje, jawnie odmawiamy zamiast zwracac wymyslone dane.
 */
export function parsePlan(html: string): Plan {
  const $ = load(html)
  const entries: ClassEntry[] = []

  // TODO(kalibracja): podmienic na selektory z fixtures/plan.html.
  // Placeholder celowo nie zgaduje struktury USOSweb.
  if (entries.length === 0) throw new ParserNotCalibratedError('plan')

  const times = entries.map((e) => e.start).sort()
  return { from: times[0]!, to: times[times.length - 1]!, entries }
}
