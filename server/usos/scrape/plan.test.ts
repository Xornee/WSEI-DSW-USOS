import { describe, expect, it } from 'vitest'
import { classifyKind } from './plan.js'

describe('classifyKind', () => {
  it.each([
    ['Wykład', 'wyklad'],
    ['wyklad', 'wyklad'],
    ['Ćwiczenia', 'cwiczenia'],
    ['Cwiczenia audytoryjne', 'cwiczenia'],
    ['Laboratorium', 'laboratorium'],
    ['Seminarium dyplomowe', 'seminarium'],
    ['Lektorat języka angielskiego', 'lektorat'],
  ])('%s -> %s', (label, expected) => {
    expect(classifyKind(label)).toBe(expected)
  })

  it('nieznane etykiety trafiaja do "inne"', () => {
    expect(classifyKind('Praktyka zawodowa')).toBe('inne')
  })

  it('brak etykiety nie wywraca parsera', () => {
    expect(classifyKind(null)).toBe('inne')
    expect(classifyKind(undefined)).toBe('inne')
    expect(classifyKind('')).toBe('inne')
  })
})
