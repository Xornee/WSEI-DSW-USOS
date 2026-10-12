import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const DIR = new URL('../../.cache/', import.meta.url).pathname

interface Entry<T> {
  value: T
  storedAt: number
}

const keyToFile = (key: string) =>
  join(DIR, `${key.replace(/[^a-z0-9_-]/gi, '_')}.json`)

export async function readCache<T>(key: string): Promise<Entry<T> | null> {
  try {
    return JSON.parse(await readFile(keyToFile(key), 'utf8')) as Entry<T>
  } catch {
    return null // brak pliku lub uszkodzony JSON — traktujemy jak pusty cache
  }
}

export async function writeCache<T>(key: string, value: T): Promise<void> {
  try {
    await mkdir(DIR, { recursive: true, mode: 0o700 })
    const entry: Entry<T> = { value, storedAt: Date.now() }
    await writeFile(keyToFile(key), JSON.stringify(entry), {
      encoding: 'utf8',
      mode: 0o600,
    })
  } catch (err) {
    // Cache jest optymalizacja, nie zrodlem prawdy — nie wywracamy requestu.
    console.warn(`[cache] zapis ${key} nieudany:`, err)
  }
}

export const isFresh = (storedAt: number, ttlSeconds: number) =>
  Date.now() - storedAt < ttlSeconds * 1000
