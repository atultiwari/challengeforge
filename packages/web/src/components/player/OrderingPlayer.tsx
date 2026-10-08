'use client'
import { useState } from 'react'
import type { OrderingView } from '@challengeforge/types'
import { Markdown } from '@/components/Markdown'
import type { SendAction } from './Player'

/**
 * Put steps in order with Move up / Move down buttons: works with a keyboard
 * and a screen reader, which drag-and-drop alone would not.
 */
export function OrderingPlayer({ view, send, busy }: { view: OrderingView; send: SendAction; busy: boolean }) {
  const [order, setOrder] = useState(() => view.steps.map((s) => s.id))
  const textOf = (id: string) => view.steps.find((s) => s.id === id)?.text ?? ''
  const move = (from: number, to: number) =>
    setOrder((current) => {
      if (to < 0 || to >= current.length) return current
      const next = [...current]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item!)
      return next
    })

  return (
    <div className="space-y-6">
      <h1 className="text-3xl sm:text-4xl">{view.title}</h1>
      {view.intro && <Markdown>{view.intro}</Markdown>}
      {view.results ? (
        <div className="grid gap-6 md:grid-cols-2">
          <section className="card space-y-2" aria-labelledby="your-order">
            <h2 id="your-order" className="text-xl">Your order</h2>
            <ol className="list-decimal space-y-1 pl-5">
              {view.results.yourOrder.map((s) => (
                <li key={s.id} className={s.correct ? 'text-good' : 'text-danger'}>
                  {s.text} <span className="sr-only">{s.correct ? '(in place)' : '(out of place)'}</span>
                  <span aria-hidden> {s.correct ? '✓' : '✗'}</span>
                </li>
              ))}
            </ol>
            {view.results.brokenRules.map((r) => (
              <p key={r} role="alert" className="text-sm text-danger">{r}</p>
            ))}
          </section>
          <section className="card space-y-2" aria-labelledby="correct-order">
            <h2 id="correct-order" className="text-xl">The right order</h2>
            <ol className="list-decimal space-y-2 pl-5">
              {view.results.correctOrder.map((s) => (
                <li key={s.id}>
                  {s.text}
                  {s.explanation && <span className="block text-sm text-ink-muted">{s.explanation}</span>}
                </li>
              ))}
            </ol>
          </section>
          {view.debrief && <div className="md:col-span-2"><Markdown>{view.debrief}</Markdown></div>}
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void send({ kind: 'submit', order })
          }}
        >
          <ol className="space-y-2" aria-label="Steps, in your order">
            {order.map((id, i) => (
              <li key={id} className="card flex items-center gap-3 py-3">
                <span className="w-6 text-right font-mono text-sm text-ink-muted" aria-hidden>{i + 1}</span>
                <span className="mr-auto">{textOf(id)}</span>
                <button type="button" className="btn-secondary" aria-label={`Move “${textOf(id)}” up`} disabled={i === 0} onClick={() => move(i, i - 1)}>↑</button>
                <button type="button" className="btn-secondary" aria-label={`Move “${textOf(id)}” down`} disabled={i === order.length - 1} onClick={() => move(i, i + 1)}>↓</button>
              </li>
            ))}
          </ol>
          <button type="submit" className="btn-primary" disabled={busy}>Submit order</button>
        </form>
      )}
    </div>
  )
}
