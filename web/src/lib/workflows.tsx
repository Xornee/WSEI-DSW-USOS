import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { SourceLink } from '../../../shared/sections'
import { ACCOUNT_SECTIONS, sectionUrl } from '../../../shared/sections'
import { UNIVERSITY_RESOURCES } from '../../../shared/university'

export type WorkflowRequest = { kind: 'entry' | 'target'; value: string }
function requestFromHash(): WorkflowRequest | null {
  const match = window.location.hash.match(/^#workflow\/(entry|target)\/([^/]+)$/)
  if (!match) return null
  try { return { kind: match[1] as WorkflowRequest['kind'], value: decodeURIComponent(match[2]!) } } catch { return null }
}
const WorkflowContext = createContext<WorkflowRequest | null>(null)
export function WorkflowProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState(requestFromHash)
  useEffect(() => {
    const changed = () => setRequest(requestFromHash())
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  return <WorkflowContext.Provider value={request}>{children}</WorkflowContext.Provider>
}
export const useWorkflow = () => useContext(WorkflowContext)
export const workflowHref = (kind: WorkflowRequest['kind'], value: string) => `#workflow/${kind}/${encodeURIComponent(value)}`
const entries = new Map<string, string>([
  ...Object.keys(ACCOUNT_SECTIONS).map(id => [sectionUrl(id as keyof typeof ACCOUNT_SECTIONS), id] as [string, string]),
  ...UNIVERSITY_RESOURCES.map(resource => [resource.url, `resource:${resource.id}`] as [string, string]),
  ['https://usosweb.ideis.pl/kontroler.php?_action=katalog2/przedmioty/index', 'course-catalog'],
  ['https://usosweb.ideis.pl/kontroler.php?_action=dla_stud/rejestracja/przedmioty', 'registration-subjects'],
  ['https://usosweb.ideis.pl/kontroler.php?_action=news/rejestracje/index', 'registration-calendar'],
  ['https://usosweb.ideis.pl/kontroler.php?_action=news/kontakt', 'contact'],
  ['https://usosweb.ideis.pl/kontroler.php?_action=news/default', 'news'],
])

export function WorkflowLink({ link, entry, className, children }: {
  link: SourceLink; entry?: string; className?: string; children?: ReactNode
}) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const knownEntry = entry || entries.get(link.url)
  if (link.workflow?.kind === 'download') return <>
    <button type="button" className={className || 'text-link'} disabled={busy} onClick={async () => {
      setBusy(true); setError('')
      try {
        const response = await fetch(`/api/workflows/download?target=${encodeURIComponent(link.workflow!.target)}`)
        if (!response.ok) { const body = await response.json(); throw new Error(body.error || 'Pobieranie nie powiodło się.') }
        const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = document.createElement('a')
        anchor.href = url; anchor.download = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || 'dokument'
        anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      } catch (failure) { setError(failure instanceof Error ? failure.message : 'Pobieranie nie powiodło się.') }
      finally { setBusy(false) }
    }}>{busy ? 'Pobieranie…' : children || link.label}</button>
    {error && <span className="workflow-error" role="alert">{error}</span>}
  </>
  if (link.workflow || knownEntry) return <a className={className}
    href={link.workflow ? workflowHref('target', link.workflow.target) : workflowHref('entry', knownEntry!)}>{children || link.label}</a>
  // Only non-USOS services retain an external link. No cosmetic hiding of an unimplemented task.
  if (new URL(link.url, window.location.origin).hostname === 'usosweb.ideis.pl') return <span className="workflow-unavailable" title="Ten odnośnik nie został rozpoznany w aktualnej sesji. Odśwież sekcję.">{children || link.label} — odśwież sekcję</span>
  return <a className={className} href={link.url} target="_blank" rel="noopener noreferrer">{children || link.label}</a>
}
