import { describe, expect, it } from 'vitest'
import { extractUserId, isLoggedOut } from './client.js'

// Fragmenty odwzorowuja realny JSGLOBALS z usosweb.ideis.pl.
const LOGGED_OUT = `JSGLOBALS = {\n  user_id: null,\n  action: "news/default"\n};`
const LOGGED_IN = `JSGLOBALS = {\n  user_id: 123456,\n  action: "home/index"\n};`

describe('wykrywanie sesji', () => {
  it('rozpoznaje wylogowanie po user_id: null', () => {
    expect(isLoggedOut(LOGGED_OUT)).toBe(true)
  })

  it('nie myli zalogowanego z wylogowanym', () => {
    expect(isLoggedOut(LOGGED_IN)).toBe(false)
  })

  it('toleruje zmienne bialе znaki', () => {
    expect(isLoggedOut('user_id:null')).toBe(true)
    expect(isLoggedOut('user_id:    null')).toBe(true)
  })

  it('wyciaga user_id gdy zalogowany', () => {
    expect(extractUserId(LOGGED_IN)).toBe('123456')
  })

  it('wyciaga user_id zapisany w cudzyslowach', () => {
    // Instalacja ideis.pl serwuje id jako string, nie liczbe.
    expect(extractUserId('user_id: "654321",')).toBe('654321')
    expect(extractUserId("user_id: '654321',")).toBe('654321')
  })

  it('zwraca null gdy brak identyfikatora', () => {
    expect(extractUserId(LOGGED_OUT)).toBeNull()
  })

  it('cudzyslowy nie psuja detekcji wylogowania', () => {
    expect(isLoggedOut('user_id: "654321"')).toBe(false)
  })
})
