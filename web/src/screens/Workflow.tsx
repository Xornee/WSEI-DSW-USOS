import { ArrowLeft, FileText, RefreshCw } from 'lucide-react'
import { useId, useState } from 'react'
import type { WorkflowForm, WorkflowPage } from '../../../shared/workflows'
import { useEndpoint } from '../lib/api'
import { useWorkflow, WorkflowLink, workflowHref } from '../lib/workflows'
import { SourceTableView } from '../components/SourceData'
import { ScreenSkeleton } from '../components/Skeleton'
import { StateBanner } from '../components/StateBanner'

export function WorkflowScreen() {
  const request = useWorkflow()!
  const [fresh, setFresh] = useState(false)
  const params = new URLSearchParams({ [request.kind]: request.value, refresh: fresh ? '1' : '0' })
  const { data, meta, error, loading, reload } = useEndpoint<WorkflowPage>(`/api/workflows?${params}`)
  return <section className="screen workflow-screen" aria-label="Sprawa studenta">
    <header className="page-header">
      <div><button className="text-link" onClick={() => {
        if (history.length > 1) history.back(); else location.hash = '#home'
      }}><ArrowLeft size={16} /> Wróć</button><h1>{data?.title || 'Szczegóły sprawy'}</h1>
        <p className="page-description">Szczegóły i działania bez wychodzenia z aplikacji.</p></div>
      <button className="button button-secondary" disabled={loading} onClick={() => { setFresh(true); reload() }}><RefreshCw size={15} /> Odśwież sprawę</button>
    </header>
    <StateBanner meta={meta} error={error} onReload={reload} />
    {loading && !data && <ScreenSkeleton />}
    {data && <>
      <div className="workflow-prose">{data.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
      {data.notices.map((notice, index) => <p className="workflow-error" role="status" key={index}>{notice}</p>)}
      {data.tables.filter(table => table.rows.length).map((table, index) => <SourceTableView table={table} key={index} copyable />)}
      <div className="workflow-forms">{data.forms.map(form => <NativeForm key={form.id} form={form} />)}</div>
      <nav className="workflow-links" aria-label="Dalsze kroki">{data.links.filter(link => !data.tables.some(table => table.rows.some(row => row.some(cell =>
        cell.links.some(item => item.workflow?.target === link.workflow?.target && !!item.workflow)
      )))).map((link, index) => <WorkflowLink key={index} link={link} className="button button-secondary">
        <FileText size={15} /> {link.label}
      </WorkflowLink>)}</nav>
      {!data.paragraphs.length && !data.tables.length && !data.forms.length && !data.links.length && <p>Uczelnia nie udostępniła pozycji ani działań dla tej sprawy.</p>}
    </>}
  </section>
}

function NativeForm({ form }: { form: WorkflowForm }) {
  const prefix = useId()
  const [review, setReview] = useState<FormData | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [consumed, setConsumed] = useState(false)
  async function send(data: FormData, confirmed: boolean) {
    if (busy || consumed) return
    setBusy(true); setError('')
    const fields: Record<string, string[]> = Object.create(null)
    for (const field of form.fields) if (field.type !== 'file' && !Object.hasOwn(fields, field.name))
      fields[field.name] = data.getAll(field.name).filter((value): value is string => typeof value === 'string')
    const payload = { formId: form.id, fields, confirmed }
    const uploads = form.fields.filter(field => field.type === 'file').flatMap(field =>
      data.getAll(field.name).filter((value): value is File => value instanceof File && value.size > 0).map(file => ({ name: field.name, file })))
    try {
      const multipart = new FormData()
      multipart.append('payload', JSON.stringify(payload))
      uploads.forEach(({ name, file }) => multipart.append(`file:${name}`, file))
      if (uploads.some(({ file }) => file.size > 5_000_000) || uploads.reduce((sum, { file }) => sum + file.size, 0) > 9_000_000)
        throw new Error('Jeden załącznik może mieć do 5 MB, wszystkie łącznie do 9 MB.')
      const response = await fetch('/api/workflows/submit', { method: 'POST',
        headers: { 'X-USOS-Connection': document.querySelector('meta[name="usos-connection"]')?.getAttribute('content') || '',
          ...(uploads.length ? {} : { 'Content-Type': 'application/json' }) },
        body: uploads.length ? multipart : JSON.stringify(payload) })
      const result = await response.json()
      if (!response.ok || !result.ok) {
        if (response.status >= 500 || response.status === 410) setConsumed(true)
        throw new Error(result.error || 'Odczytaj aktualny status sprawy.')
      }
      setConsumed(true)
      location.hash = workflowHref('target', result.data.target)
    } catch (failure) {
      if (!(failure instanceof Error) || failure instanceof TypeError) setConsumed(true)
      setError(failure instanceof Error ? failure.message : 'Sprawdź status sprawy — odpowiedź nie została potwierdzona.')
    } finally { setBusy(false) }
  }
  return <form className="workflow-form" onSubmit={event => {
    event.preventDefault(); if (busy || consumed) return
    const data = new FormData(event.currentTarget)
    if (form.changesAccount) { setReview(data); setError('') } else void send(data, false)
  }}>
    <h2>{form.title}</h2>
    <fieldset disabled={busy || consumed || !!review}>
      {form.fields.map((field, index) => {
        const id = `${prefix}-${index}`, common = { id, name: field.name, required: field.required,
          readOnly: field.readonly, 'aria-describedby': field.required ? `${id}-required` : undefined }
        return <div className="workflow-field" key={index}>
          <label htmlFor={id}>{field.label}{field.required && <span id={`${id}-required`}> (wymagane)</span>}</label>
          {field.type === 'select' ? <select {...common} multiple={field.multiple}
            defaultValue={field.multiple ? field.options.filter(option => option.selected).map(option => option.value) : field.value}>
            {field.options.map((option, i) => <option key={i} value={option.value} disabled={option.disabled}>{option.label}</option>)}
          </select> : field.type === 'textarea' ? <textarea {...common} defaultValue={field.value} maxLength={field.maxLength} rows={5} />
            : ['checkbox', 'radio'].includes(field.type) ? <input {...common} type={field.type} value={field.options[0]?.value || 'on'} defaultChecked={!!field.value} />
              : field.type === 'file' ? <input {...common} type="file" multiple={field.multiple} accept={field.accept} />
                : <input {...common} type={field.type} defaultValue={field.value} maxLength={field.maxLength} min={field.min} max={field.max} step={field.step} />}
        </div>
      })}
    </fieldset>
    {review ? <section className="workflow-review" aria-label="Potwierdzenie czynności">
      <h3>Potwierdź: {form.submitLabel}</h3>
      <p>Ta czynność zostanie wykonana na Twoim koncie uczelnianym.</p>
      <dl>{form.fields.map((field, index) => <div key={index}><dt>{field.label}</dt><dd>{review.getAll(field.name).map(value => typeof value === 'string' ? field.options.find(option => option.value === value)?.label || value : value.name).filter(Boolean).join(', ') || 'Nie wybrano'}</dd></div>)}</dl>
      <div className="workflow-actions"><button type="button" className="button button-primary" disabled={busy || consumed} onClick={() => void send(review, true)}>{busy ? 'Wysyłanie…' : 'Potwierdzam i wykonuję'}</button>
        <button type="button" className="button button-secondary" disabled={busy || consumed} onClick={() => setReview(null)}>Wróć do edycji</button></div>
    </section> : <button type="submit" className="button button-primary" disabled={busy || consumed}>{busy ? 'Pobieranie…' : form.submitLabel}</button>}
    {error && <p className="workflow-error" role="alert">{error}</p>}
    {consumed && <p role="status">Odczytaj ponownie szczegóły sprawy przed następną czynnością.</p>}
  </form>
}
