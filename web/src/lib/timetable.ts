import { useEffect, useState } from 'react'

// Choice exists only in this document/connection. Never reuse another account's localStorage ID.
let choice: string | null = null
export function timetablePlanPath(selected: string | null = null): string {
  if (selected !== null && !/^[1-9]\d{0,5}$/.test(selected)) throw new Error('Nieprawidłowy tok')
  if (typeof document !== 'undefined' && document.querySelector('meta[name="usos-public-plan"]')?.getAttribute('content') === 'true')
    return selected === null ? '/api/plan?scope=public' : `/api/plan?scope=public&trackId=${selected}`
  return selected === null ? '/api/plan' : `/api/plan?trackId=${selected}`
}
export function timetableHomePath(selected: string | null = null): string {
  return timetablePlanPath(selected).replace('/api/plan', '/api/home')
}
export function useTimetableTrack(): [string | null, (id: string | null) => void] {
  const [track, setTrack] = useState(choice)
  useEffect(() => {
    const update = () => setTrack(choice)
    window.addEventListener('usos-timetable-change', update)
    return () => window.removeEventListener('usos-timetable-change', update)
  }, [])
  return [track, (id) => {
    timetablePlanPath(id)
    choice = id
    setTrack(id)
    window.dispatchEvent(new Event('usos-timetable-change'))
  }]
}
