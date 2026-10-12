import { load, type CheerioAPI, type Cheerio } from 'cheerio'
import type { Element } from 'domhandler'
import type { StageField, Stages, StudyProgramme, StudyStage } from '../../../shared/types.js'
import { ParserNotCalibratedError } from './errors.js'

/**
 * Zrodlo: `dla_stud/studia/zaliczenia/index`.
 * <usos-frame> = program studiow (nazwa w <h2 slot="title">),
 * <usos-frame-section section-title="..."> = etap,
 * <div class="inline-keyvalue-list"> = pary etykieta/wartosc.
 */

const text = (el: Cheerio<Element>): string => el.text().replace(/\s+/g, ' ').trim()

/** "Nazwa [KOD]" -> nazwa + kod. Puste nawiasy daja null. */
export function splitCoded(raw: string): { name: string; code: string | null } {
  const m = raw.match(/^(.*?)\s*\[([^\]]*)\]\s*$/)
  if (!m) return { name: raw.trim(), code: null }
  return { name: m[1]!.trim(), code: m[2]!.trim() || null }
}

/** Wartosc bywa data (<local-time datetime>) albo statusem (<usos-tag>). */
function readValue($: CheerioAPI, cell: Cheerio<Element>): { value: string; kind: StageField['kind'] } {
  const time = cell.find('local-time[datetime]').first()
  if (time.length > 0) {
    const iso = time.attr('datetime')?.trim()
    if (iso) return { value: iso, kind: 'date' }
  }
  const tag = cell.find('usos-tag').first()
  if (tag.length > 0) return { value: text(tag), kind: 'status' }
  return { value: text(cell), kind: 'text' }
}

function parseFields($: CheerioAPI, section: Cheerio<Element>): StageField[] {
  const fields: StageField[] = []
  section.find('.inline-keyvalue-list > div').each((_, pairEl) => {
    const cells = $(pairEl).children('div')
    if (cells.length < 2) return
    const label = text(cells.eq(0)).replace(/:\s*$/, '')
    const { value, kind } = readValue($, cells.eq(1))
    if (label && value) fields.push({ label, value, kind })
  })
  return fields
}

export function parseStages(html: string): Stages {
  const $ = load(html)
  // Ramki bez listy par to dialogi i naglowki — pomijamy je.
  const frames = $('usos-frame').filter((_, el) => $(el).find('.inline-keyvalue-list').length > 0)
  if (frames.length === 0) throw new ParserNotCalibratedError('stages')

  const programmes: StudyProgramme[] = []
  frames.each((_, frameEl) => {
    const frame = $(frameEl)
    const { name, code } = splitCoded(text(frame.find('h2[slot="title"]').first()))
    if (!name) return

    const stages: StudyStage[] = []
    frame.find('usos-frame-section').each((__, sectionEl) => {
      const section = $(sectionEl)
      const title = section.attr('section-title')?.trim()
      if (!title) return
      const { name: stageName, code: stageCode } = splitCoded(title)
      stages.push({ name: stageName, code: stageCode, fields: parseFields($, section) })
    })

    if (stages.length > 0) programmes.push({ name, code, stages })
  })

  return { programmes }
}
