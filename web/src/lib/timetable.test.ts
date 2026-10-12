import { expect, it } from 'vitest'
import { timetablePlanPath, timetableHomePath } from './timetable'
it('default plan and home ask the server for the account track, not hardcoded 958', () => {
  expect(timetablePlanPath()).toBe('/api/plan')
  expect(timetableHomePath()).toBe('/api/home')
})
it('a candidate choice is numeric, optional and applied equally to plan and home', () => {
  expect(timetablePlanPath('958')).toBe('/api/plan?trackId=958')
  expect(timetableHomePath('958')).toBe('/api/home?trackId=958')
  for (const id of ['0', 'https://localhost/', '958&scope=public', '958/../x']) expect(() => timetablePlanPath(id)).toThrow()
})
