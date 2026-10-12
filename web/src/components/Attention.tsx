import { ArrowUpRight, Check, CircleAlert, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AccountSection } from '../../../shared/sections'
import type { Grades } from '../../../shared/types'
import { useEndpoint } from '../lib/api'
import { Card, CardHeader } from './Card'
import { fmtDate } from '../lib/format'

import {
  registrationIsOpen,
  applicationNeedsAttention,
} from '../lib/student-state'

interface AttentionItem {
  id: string
  title: string
  detail: string
  href: string
}
function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function AttentionPanel({ userId }: { userId: string | null }) {
  const payments = useEndpoint<AccountSection>('/api/sections/dues')
  const registrations = useEndpoint<AccountSection>(
    '/api/sections/registrations',
  )
  const applications = useEndpoint<AccountSection>('/api/sections/applications')
  const grades = useEndpoint<Grades>('/api/grades')
  const [newGrades, setNewGrades] = useState(0)
  const [snapshot, setSnapshot] = useState<string[]>([])
  const [storageAvailable, setStorageAvailable] = useState(true)
  const storageKey = userId ? `usos-grade-signatures:${userId}` : null
  useEffect(() => {
    if (!grades.data || grades.meta?.stale || !storageKey) return
    let cancelled = false
    const values = grades.data.cycles.flatMap((cycle) =>
      cycle.subjects.flatMap((subject) =>
        subject.grades.map(
          (grade) =>
            `${cycle.name}\0${subject.code ?? subject.name}\0${grade.component}\0${grade.value}`,
        ),
      ),
    )
    Promise.all(
      values.map(async (value) => {
        const digest = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(value),
        )
        return Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('')
      }),
    )
      .then((hashes) => {
        if (cancelled) return
        try {
          const previous = localStorage.getItem(storageKey)
          const parsed: unknown = previous ? JSON.parse(previous) : null
          const valid =
            Array.isArray(parsed) &&
            parsed.every((value) => typeof value === 'string')
          if (!valid) {
            localStorage.setItem(storageKey, JSON.stringify(hashes))
            setNewGrades(0)
          } else
            setNewGrades(hashes.filter((hash) => !parsed.includes(hash)).length)
          setSnapshot(hashes)
        } catch {
          setStorageAvailable(false)
        }
      })
      .catch(() => {
        if (!cancelled) setStorageAvailable(false)
      })
    return () => {
      cancelled = true
    }
  }, [grades.data, grades.meta?.stale, storageKey])
  const now = new Date()
  const limit = new Date(now)
  limit.setDate(limit.getDate() + 14)
  const items: AttentionItem[] = (payments.data?.dues ?? [])
    .filter(
      (due) =>
        due.date &&
        due.date <= dayKey(limit) &&
        due.cents !== null &&
        due.cents > 0,
    )
    .map((due, i) => ({
      id: `due-${i}`,
      title:
        due.date! < dayKey(now)
          ? 'Minął termin należności'
          : 'Zbliża się termin płatności',
      detail: `${due.label} · ${fmtDate(due.date!)} · ${due.amount}`,
      href: '#payments',
    }))
  for (const table of registrations.data?.tables ?? [])
    for (const [i, row] of table.rows.entries()) {
      const stateIndex = table.headers.findIndex((header) =>
        /stan|status/i.test(header),
      )
      const state = row[stateIndex]?.text ?? ''
      if (registrationIsOpen(state))
        items.push({
          id: `registration-${table.title}-${i}`,
          title: 'Rejestracja jest otwarta',
          detail: row
            .map((cell) => cell.text)
            .filter(Boolean)
            .join(' · '),
          href: '#registrations',
        })
    }
  const applicationRecords = [
    ...(applications.data?.records ?? []),
    ...(applications.data?.tables ?? []).flatMap((table) =>
      table.rows.map((row) => ({
        title: row
          .map((cell) => cell.text)
          .filter(Boolean)
          .join(' · '),
        text:
          row[table.headers.findIndex((header) => /stan|status/i.test(header))]
            ?.text ?? '',
      })),
    ),
  ]
  for (const [i, record] of applicationRecords.entries())
    if (applicationNeedsAttention(record.text))
      items.push({
        id: `application-${i}`,
        title: 'Wniosek wymaga uwagi',
        detail: record.title,
        href: '#documents',
      })
  if (newGrades > 0)
    items.push({
      id: 'new-grades',
      title: `Nowe lub zmienione oceny: ${newGrades}`,
      detail:
        'Zmiana wykryta względem ostatniego odczytanego zestawu na tym urządzeniu.',
      href: '#grades',
    })
  const sources = [
    ['Płatności', payments],
    ['Rejestracje', registrations],
    ['Wnioski', applications],
    ['Oceny', grades],
  ] as const
  const loading = sources.some(([, source]) => source.loading)
  const missing = sources.filter(([, source]) => source.error)
  const stale = sources.some(([, source]) => source.meta?.stale)
  return (
    <Card className="attention-card">
      <CardHeader
        title="Wymaga uwagi"
        hint={
          <button
            className="button button-secondary"
            aria-label="Odśwież sprawy wymagające uwagi"
            disabled={loading}
            onClick={() => sources.forEach(([, source]) => source.reload())}
          >
            <RefreshCw size={15} /> Odśwież
          </button>
        }
      />
      {loading ? (
        <p className="attention-status" role="status">
          Sprawdzanie dostępnych danych…
        </p>
      ) : (
        <>
          {items.length ? (
            <div className="attention-list">
              {items.slice(0, 8).map((item) => (
                <a key={item.id} href={item.href}>
                  <span className="attention-icon">
                    <CircleAlert size={17} />
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <ArrowUpRight size={15} />
                </a>
              ))}
            </div>
          ) : (
            <div className="attention-empty">
              <Check size={18} />
              <span>
                {missing.length
                  ? 'Brak alertów w dostępnych źródłach.'
                  : 'Brak wykrytych spraw wymagających uwagi.'}
              </span>
            </div>
          )}
          {items.length > 8 && (
            <p className="attention-status">
              Pozostałe pozycje sprawdzisz w odpowiednich zakładkach.
            </p>
          )}
          {newGrades > 0 && (
            <button
              className="button button-secondary attention-read"
              onClick={() => {
                if (storageKey)
                  try {
                    localStorage.setItem(storageKey, JSON.stringify(snapshot))
                    setNewGrades(0)
                  } catch {
                    setStorageAvailable(false)
                  }
              }}
            >
              Oznacz zmiany ocen jako przeczytane
            </button>
          )}
        </>
      )}
      {missing.length > 0 && (
        <p className="attention-warning">
          Nie sprawdzono: {missing.map(([name]) => name).join(', ')}. Status
          tych sekcji pozostaje nieznany.
        </p>
      )}
      {stale && (
        <p className="attention-warning">
          Część informacji pochodzi ze starszej pamięci podręcznej.
        </p>
      )}
      <p className="attention-footnote">
        Płatności: zaległe i najbliższe 14 dni. Informacje z USOS, nie
        powiadomienia o wykonaniu przelewu.
        {!storageAvailable &&
          ' Zapamiętywanie zmian ocen jest niedostępne w tej przeglądarce.'}
      </p>
    </Card>
  )
}
