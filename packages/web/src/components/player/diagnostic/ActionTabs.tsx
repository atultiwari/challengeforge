'use client'
import { useState } from 'react'
import type { DiagnosticSimView } from '@challengeforge/types'
import type { SendAction } from '../Player'

type Category = 'history' | 'examination' | 'investigations' | 'treatments'

const TABS: readonly { category: Category; label: string; verb: 'ask' | 'examine' | 'order' | 'treat'; button: string; placeholder: string }[] = [
  { category: 'history', label: 'History', verb: 'ask', button: 'Ask', placeholder: 'What do you want to ask? e.g. insulin, pain, pregnancy' },
  { category: 'examination', label: 'Examine', verb: 'examine', button: 'Examine', placeholder: 'What do you want to examine? e.g. abdomen, chest' },
  { category: 'investigations', label: 'Investigate', verb: 'order', button: 'Order', placeholder: 'Which test? e.g. glucose, blood gas, ECG' },
  { category: 'treatments', label: 'Treat', verb: 'treat', button: 'Give', placeholder: 'Which treatment? e.g. fluids, insulin' },
]

/**
 * Search-to-reveal (PLAN.md §3.5): the learner names what they want and the
 * case answers with matching items. There is no menu to browse, so the
 * options never cue the answer.
 */
export function ActionTabs({ view, send, busy }: { view: DiagnosticSimView; send: SendAction; busy: boolean }) {
  const [active, setActive] = useState<Category>('history')
  const [query, setQuery] = useState('')
  const tab = TABS.find((t) => t.category === active) ?? TABS[0]!
  const results = view.search?.category === active ? view.search.results : null

  return (
    <section aria-label="Actions" className="card space-y-4">
      <div role="tablist" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.category}
            role="tab"
            type="button"
            aria-selected={t.category === active}
            className={t.category === active ? 'btn-primary' : 'btn-secondary'}
            onClick={() => {
              setActive(t.category)
              setQuery('')
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (query.trim()) void send({ kind: 'search', category: active, query: query.trim().slice(0, 60) })
        }}
      >
        <input
          className="field-input"
          value={query}
          maxLength={60}
          placeholder={tab.placeholder}
          aria-label={`Search ${tab.label.toLowerCase()}`}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="btn-secondary" disabled={busy || !query.trim()}>
          Search
        </button>
      </form>
      {results && results.length === 0 && <p className="text-sm text-ink-muted">Nothing matches “{view.search?.query}”. Try other words.</p>}
      {results && results.length > 0 && (
        <ul className="divide-y divide-line">
          {results.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2">
              <span className="mr-auto">{r.label}</span>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => send({ kind: tab.verb, item: r.id })}>
                {tab.button}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
