'use client'
import { useState } from 'react'
import type { PendingJob } from '@challengeforge/db'
import type { PromptHardeningView } from '@challengeforge/types'
import { Markdown } from '@/components/Markdown'
import type { SendAction } from './Player'

const pct = (n: number) => `${Math.round(n * 100)}%`

/** Write defensive instructions, then run the hidden battery (a background job) and read the report. */
export function PromptHardeningPlayer({ view, pendingJob, send, busy }: { view: PromptHardeningView; pendingJob: PendingJob | null; send: SendAction; busy: boolean }) {
  const [text, setText] = useState(view.prompt)
  const report = view.lastReport
  const running = pendingJob !== null
  const done = (pendingJob?.progress as { replies?: unknown[] } | null)?.replies?.length ?? 0

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl sm:text-4xl">{view.title}</h1>
        {view.brief && <Markdown className="prose-cf text-lg text-ink-muted">{view.brief}</Markdown>}
        <p className="text-sm text-ink-muted">
          To pass: block at least {pct(view.thresholds.attackBlockRate)} of the attacks and still help with {pct(view.thresholds.benignHelpRate)} of
          ordinary questions. {view.maxRuns - view.runs} of {view.maxRuns} evaluation runs left.
        </p>
      </header>

      {!view.finished && (
        <section className="card space-y-3">
          <label className="block">
            <span className="field-label">Your instructions for {view.botName}</span>
            <textarea className="field-input min-h-40 font-mono text-sm" value={text} maxLength={view.maxPromptChars} disabled={running} onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn-secondary" disabled={busy || running || text === view.prompt} onClick={() => send({ kind: 'save_prompt', text })}>
              Save instructions
            </button>
            <button type="button" className="btn-primary" disabled={busy || running || text !== view.prompt || !view.prompt.trim()} onClick={() => send({ kind: 'evaluate' })}>
              {running ? 'Evaluating…' : 'Run the evaluation'}
            </button>
          </div>
          {text !== view.prompt && <p className="text-sm text-warn">Save your instructions before running the evaluation.</p>}
          {running && (
            <p role="status" className="text-sm text-ink-muted">
              Testing your bot: {done} replies so far. You can leave this page open; it keeps going.
            </p>
          )}
        </section>
      )}

      {report && (
        <section className="card space-y-3" aria-labelledby="report-heading">
          <h2 id="report-heading" className="text-2xl">
            Last run: {report.attacksBlocked}/{report.attacksTotal} attacks blocked · {report.benignHelped}/{report.benignTotal} questions answered
          </h2>
          <ul className="divide-y divide-line">
            {report.items.map((item, i) => (
              <li key={i} className="space-y-1 py-2">
                <p className={item.passed ? 'text-good' : 'text-danger'}>
                  {item.passed ? '✓' : '✗'} <span className="font-semibold">{item.kind === 'attack' ? `Attack: ${item.label}` : `Question: ${item.label}`}</span>
                </p>
                {/* Model output is untrusted: shown as plain text. */}
                <p className="whitespace-pre-wrap text-sm text-ink-muted">{item.reply}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {view.debrief && (
        <section className="card">
          <Markdown>{view.debrief}</Markdown>
        </section>
      )}
    </div>
  )
}
