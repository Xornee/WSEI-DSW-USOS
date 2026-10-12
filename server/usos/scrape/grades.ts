import { load, type CheerioAPI, type Cheerio } from 'cheerio'
import type { Element } from 'domhandler'
import type { GradeCycle, GradeValue, GradedSubject, Grades } from '../../../shared/types.js'
import { ParserNotCalibratedError } from './errors.js'

/**
 * Zrodlo: `dla_stud/studia/oceny/index`, kafelek `usos-frame#oceny`.
 * Kazdy cykl dydaktyczny to <usos-frame-section section-title="...">
 * z tabela: Przedmiot | Program | Ocena | Akcje.
 */

const text = (el: Cheerio<Element>): string => el.text().replace(/\s+/g, ' ').trim()

/** "4,5" -> 4.5; oceny opisowe ("zal", "zwolniony") -> null. */
export function toNumeric(value: string): number | null {
  const n = Number(value.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** "Inżynieria danych [IN-101]" -> nazwa + kod. Puste nawiasy sa ignorowane. */
export function splitSubject(raw: string): { name: string; code: string | null } {
  const m = raw.match(/^(.*?)\s*\[([^\]]*)\]\s*$/)
  if (!m) return { name: raw.trim(), code: null }
  return { name: m[1]!.trim(), code: m[2]!.trim() || null }
}

/** Komorka ocen: kazdy <div> to "Forma: <span>ocena</span>". */
function parseGradeCell($: CheerioAPI, cell: Cheerio<Element>): GradeValue[] {
  const out: GradeValue[] = []
  cell.find('div').each((_, el) => {
    const div = $(el)
    if (div.find('div').length > 0) return // tylko liscie, zeby nie liczyc dwa razy
    const value = text(div.find('span').first())
    const component = text(div).replace(value, '').replace(/:\s*$/, '').replace(/:$/, '').trim()
    if (value) out.push({ component: component || 'Ocena', value, numeric: toNumeric(value) })
  })
  return out
}

const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100

const numericOf = (subjects: readonly GradedSubject[]): number[] =>
  subjects.flatMap((s) => s.grades.map((g) => g.numeric).filter((n): n is number => n !== null))

export function parseGrades(html: string): Grades {
  const $ = load(html)
  const frame = $('#oceny')
  if (frame.length === 0) throw new ParserNotCalibratedError('grades')

  const cycles: GradeCycle[] = []

  frame.find('usos-frame-section').each((_, sectionEl) => {
    const section = $(sectionEl)
    const name = section.attr('section-title')?.trim()
    if (!name) return

    const subjects: GradedSubject[] = []
    section.find('tr').each((__, rowEl) => {
      const cells = $(rowEl).find('td')
      if (cells.length < 3) return // wiersz naglowkowy albo separator

      const { name: subjectName, code } = splitSubject(text(cells.eq(0)))
      if (!subjectName) return

      const programme = text(cells.eq(1)).replace(/^\((.*)\)$/, '$1') || null
      subjects.push({
        name: subjectName,
        code,
        programme: programme === 'niepodpięty' ? null : programme,
        grades: parseGradeCell($, cells.eq(2)),
      })
    })

    if (subjects.length > 0) {
      cycles.push({ name, subjects, average: mean(numericOf(subjects)) })
    }
  })

  const all = cycles.flatMap((c) => numericOf(c.subjects))
  return { cycles, average: mean(all), gradeCount: all.length }
}
