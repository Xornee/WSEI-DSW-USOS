import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseStudent } from './student.js'

// Przykład jest syntetyczny — testy sprawdzaja KSZTALT, nie prywatne dane,
// zeby nie utrwalac danych osobowych w repozytorium.
const FIXTURE = new URL('./fixtures/home.html', import.meta.url).pathname
const run = existsSync(FIXTURE) ? describe : describe.skip

run('parseStudent na syntetycznym przykładzie home/index', () => {
  const html = (existsSync(FIXTURE) ? readFileSync(FIXTURE, 'utf8') : '')

  it('wyciaga identyfikator z JSGLOBALS', () => {
    expect(parseStudent(html).id).toMatch(/^\d+$/)
  })

  it('wyciaga numer albumu', () => {
    expect(parseStudent(html).albumNumber).toMatch(/^\d+$/)
  })

  it('wyciaga role uzytkownika', () => {
    const { roles } = parseStudent(html)
    expect(roles.length).toBeGreaterThan(0)
    expect(roles.every((r) => r.length > 0)).toBe(true)
  })

  it('wyciaga wydzial z linku do katalogu jednostek', () => {
    expect(parseStudent(html).faculty).toBeTruthy()
  })

  it('"brak danych" mapuje na null zamiast na tekst', () => {
    const { libraryCard } = parseStudent(html)
    if (libraryCard === null) return // uczelnia nie ma tej danej — poprawny wynik
    expect(libraryCard).not.toMatch(/^brak/i)
    expect(libraryCard.length).toBeGreaterThan(0)
  })
})

describe('parseStudent — odpornosc', () => {
  it('odmawia gdy kafelka nie ma, zamiast zwracac pusty profil', () => {
    expect(() => parseStudent('<html><body>nic</body></html>')).toThrow(/nie jest jeszcze skalibrowany/)
  })
})
