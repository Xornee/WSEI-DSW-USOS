import { expect, it } from 'vitest'
import {
  applicationNeedsAttention,
  isStagePassed,
  registrationIsOpen,
} from './student-state'
it.each(['Zaliczony', 'Zdany', 'Ukończony'])(
  'explicit passed stage: %s',
  (value) => expect(isStagePassed(value)).toBe(true),
)
it.each([
  'Aktywny',
  'niezaliczony',
  'nie-zdany',
  'Zaliczony warunkowo',
  'w trakcie',
  '',
])('not unconditionally passed: %s', (value) =>
  expect(isStagePassed(value)).toBe(false),
)
it.each(['otwarta', 'aktywna', 'trwa'])('open registration: %s', (value) =>
  expect(registrationIsOpen(value)).toBe(true),
)
it.each([
  'nieaktywna',
  'nie jest otwarta',
  'nie trwa',
  'zakończona',
  'zamknięta',
  'przerwa',
  '',
])('not open registration: %s', (value) =>
  expect(registrationIsOpen(value)).toBe(false),
)
it.each(['do uzupełnienia', 'wymaga poprawy'])(
  'application requires action: %s',
  (value) => expect(applicationNeedsAttention(value)).toBe(true),
)
it.each(['nie wymaga poprawy', 'nie wymaga uzupełnienia', 'wydana', ''])(
  'application requires no known action: %s',
  (value) => expect(applicationNeedsAttention(value)).toBe(false),
)
