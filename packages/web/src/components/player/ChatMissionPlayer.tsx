'use client'
import { useState } from 'react'
import type { ChatMissionView } from '@challengeforge/types'
import { Markdown } from '@/components/Markdown'
import type { SendAction } from './Player'

/**
 * An AI mission: talk to the author's bot. Every reply comes from the server
 * (the browser never sees the bot's instructions), and grading reads only the
 * conversation the server recorded.
 */
export function ChatMissionPlayer({ view, send, busy }: { view: ChatMissionView; send: SendAction; busy: boolean }) {
  const [text, setText] = useState('')
  const left = view.messageCap - view.messagesUsed

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl sm:text-4xl">{view.title}</h1>
        {view.brief && <Markdown className="prose-cf text-lg text-ink-muted">{view.brief}</Markdown>}
      </header>

      <section aria-label={`Conversation with ${view.botName}`} className="card space-y-3">
        {view.transcript.length === 0 && <p className="text-ink-faint">Say something to {view.botName} to begin.</p>}
        <ol className="space-y-3" aria-live="polite">
          {view.transcript.map((turn, i) => (
            <li key={i} className={turn.role === 'user' ? 'ml-8 rounded-md bg-accent-soft px-3 py-2' : 'mr-8 rounded-md bg-surface-sunken px-3 py-2'}>
              <p className="eyebrow">{turn.role === 'user' ? 'You' : view.botName}</p>
              {/* Bot replies are shown as plain text, never as HTML or Markdown: they are untrusted model output. */}
              <p className="whitespace-pre-wrap">{turn.content}</p>
            </li>
          ))}
        </ol>
        {busy && <p className="text-sm text-ink-muted">{view.botName} is replying…</p>}
      </section>

      {!view.finished && (
        <form
          className="card space-y-3"
          onSubmit={async (e) => {
            e.preventDefault()
            if (text.trim() && (await send({ kind: 'send', text: text.trim() }))) setText('')
          }}
        >
          {view.transcript.length === 0 && view.starters.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label="Suggested openers">
              {view.starters.map((s) => (
                <button key={s} type="button" className="pill bg-surface-sunken text-ink hover:bg-accent-soft" onClick={() => setText(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
          <label className="block">
            <span className="field-label">Your message</span>
            <textarea className="field-input min-h-20" value={text} maxLength={view.maxMessageChars} onChange={(e) => setText(e.target.value)} disabled={busy || left <= 0} />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary" disabled={busy || left <= 0 || !text.trim()}>
              Send
            </button>
            <span className="text-sm text-ink-muted">{left} of {view.messageCap} messages left</span>
            <button
              type="button"
              className="btn-secondary ml-auto"
              disabled={busy || view.transcript.length === 0}
              onClick={() => {
                if (window.confirm('Finish and have the conversation graded? You cannot send more messages after this.')) void send({ kind: 'finish' })
              }}
            >
              Finish and grade
            </button>
          </div>
        </form>
      )}

      {view.goals && (
        <section className="card space-y-2" aria-labelledby="goals-heading">
          <h2 id="goals-heading" className="eyebrow">Goals</h2>
          <ul className="space-y-1">
            {view.goals.map((g) => (
              <li key={g.label} className={g.passed ? 'text-good' : 'text-ink-muted'}>
                {g.passed ? '✓' : '✗'} <span className="font-semibold">{g.label}</span>: {g.message}
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
