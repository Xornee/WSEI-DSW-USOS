// Volatile, connection-keyed drafts only. Never store CSRF, files or account content in localStorage.
const drafts = new Map<string, { values: Record<string, string[]>; expires: number }>()
const scope = () => document.querySelector('meta[name="usos-connection"]')?.getAttribute('content') || ''
const key = (id: string) => `${scope()}:${id}`
export function readDraft(id?: string): Record<string, string[]> | undefined {
  if (!id || !scope()) return
  const entry = drafts.get(key(id))
  if (entry && entry.expires > Date.now()) return entry.values
  drafts.delete(key(id))
}
export function writeDraft(id: string | undefined, values: Record<string, string[]>) {
  if (!id || !scope() || JSON.stringify(values).length > 100_000) return
  for (const [draftKey, entry] of drafts) if (entry.expires < Date.now()) drafts.delete(draftKey)
  if (drafts.size >= 20 && !drafts.has(key(id))) drafts.delete(drafts.keys().next().value!)
  drafts.set(key(id), { values, expires: Date.now() + 30 * 60_000 })
}
export function deleteDraft(id?: string) { if (id) drafts.delete(key(id)) }
