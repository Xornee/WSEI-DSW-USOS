import { describe, expect, it } from 'vitest'
import { isFresh } from './cache.js'

describe('isFresh', () => {
  it('swieze w granicach TTL', () => {
    expect(isFresh(Date.now() - 60_000, 900)).toBe(true)
  })

  it('przeterminowane po TTL', () => {
    expect(isFresh(Date.now() - 901_000, 900)).toBe(false)
  })

  it('granica TTL nie jest swieza', () => {
    expect(isFresh(Date.now() - 900_000, 900)).toBe(false)
  })
})
