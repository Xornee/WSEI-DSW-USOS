import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDisplayName, parseEmail } from './profile.js'

describe('parseDisplayName', () => {
  it('bierze czesc przed pierwszym mysnikiem', () => {
    expect(parseDisplayName('<title>Anna Kowalczyk - Katalog, Katalog osób - USOSweb</title>'))
      .toBe('Anna Kowalczyk')
  })

  it('odrzuca tytuly stron systemowych', () => {
    expect(parseDisplayName('<title>USOSweb - logowanie</title>')).toBeNull()
    expect(parseDisplayName('<title>Katalog osób</title>')).toBeNull()
  })

  it('zwraca null gdy nie ma tytulu', () => {
    expect(parseDisplayName('<html><body>nic</body></html>')).toBeNull()
  })

  it('normalizuje bialе znaki z zawinietego tytulu', () => {
    expect(parseDisplayName('<title>\n  Jan   Nowak\n  - Katalog - USOSweb</title>')).toBe('Jan Nowak')
  })
})

describe('parseEmail', () => {
  it('czyta adres z mailto', () => {
    expect(parseEmail('<table><tr><th>E-mail:</th><td><a href="mailto:student@example.test">pisz</a></td></tr></table>')).toBe('student@example.test')
  })
  it('zwraca null gdy adres ukryty prywatnoscia', () => {
    expect(parseEmail('<p>Adres widoczny tylko dla wlasciciela</p>')).toBeNull()
  })
})

const FIXTURE = new URL('./fixtures/profile.html', import.meta.url).pathname
const run = existsSync(FIXTURE) ? describe : describe.skip

run('na syntetycznym przykładzie strony profilowej', () => {
  const html = (existsSync(FIXTURE) ? readFileSync(FIXTURE, 'utf8') : '')
  it('wyciaga imie i nazwisko o sensownej dlugosci', () => {
    const name = parseDisplayName(html)
    expect(name).toBeTruthy()
    expect(name!.split(' ').length).toBeGreaterThanOrEqual(2)
  })
})
