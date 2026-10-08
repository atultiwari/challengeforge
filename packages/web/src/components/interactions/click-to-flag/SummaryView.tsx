'use client'
import { useState } from 'react'
import { OMISSION_CATEGORY, omissionId, summaryLabel, type FlagMap, type Option, type Summary } from './types'

interface SummaryViewProps {
  summary: Summary
  flags: FlagMap
  categories: Option[]
  omissionOptions: Option[]
  categoryPrompt: string
  disabled: boolean
  onFlag: (id: string, category: string) => void
  onUnflag: (id: string) => void
}

interface SegmentProps {
  id: string
  text: string
  category: string | undefined
  categoryLabel: string | undefined
  isOpen: boolean
  inline: boolean
  disabled: boolean
  onToggle: () => void
}

/** One tappable piece of a document: a whole sentence, or a phrase in running text. */
function Segment({ text, category, categoryLabel, isOpen, inline, disabled, onToggle }: SegmentProps) {
  if (inline) {
    return (
      <button
        type="button"
        disabled={disabled}
        aria-expanded={isOpen}
        onClick={onToggle}
        className={`rounded px-0.5 text-left underline decoration-dotted decoration-ink-faint underline-offset-4 transition-colors ${
          category ? 'bg-danger-soft font-semibold text-danger decoration-danger' : 'hover:bg-accent-soft'
        }`}
      >
        {text}
        {category && <span className="sr-only"> (flagged: {categoryLabel})</span>}
      </button>
    )
  }
  return (
    <button
      type="button"
      disabled={disabled}
      aria-expanded={isOpen}
      onClick={onToggle}
      className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
        category ? 'border-danger/60 border-l-4 border-l-danger bg-danger-soft' : 'border-line bg-surface hover:border-accent'
      }`}
    >
      <span className="text-ink">{text}</span>
      {category && <span className="mt-1 block text-xs font-semibold text-danger">Flagged: {categoryLabel}</span>}
    </button>
  )
}

/**
 * One document to review. Sentences are rows (easy tap targets on a phone),
 * or, for spotting words inside running text, inline phrases. Tapping opens
 * the category choice.
 */
export function SummaryView({
  summary,
  flags,
  categories,
  omissionOptions,
  categoryPrompt,
  disabled,
  onFlag,
  onUnflag,
}: SummaryViewProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [omissionsOpen, setOmissionsOpen] = useState(false)
  const labelFor = (categoryId: string) => categories.find((c) => c.id === categoryId)?.label ?? categoryId
  const labelOrUndefined = (categoryId: string | undefined) => (categoryId ? labelFor(categoryId) : undefined)
  const sentenceCategories = categories.filter((c) => c.id !== OMISSION_CATEGORY)
  const chosenOmissions = omissionOptions.filter((o) => flags[omissionId(summary.id, o.id)])
  const inline = summary.display === 'inline'
  const open = summary.sentences.find((s) => s.id === openId)

  const picker = (id: string) => (
    <div className="mt-1.5 rounded-lg border border-line bg-surface-sunken p-2">
      <p className="px-1 pb-1.5 text-xs font-semibold text-ink-muted">{categoryPrompt}</p>
      <div className="flex flex-wrap gap-1.5">
        {sentenceCategories.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={flags[id] === c.id}
            onClick={() => { onFlag(id, c.id); setOpenId(null) }}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
              flags[id] === c.id ? 'border-danger bg-danger text-on-danger' : 'border-line bg-surface text-ink hover:border-danger'
            }`}
          >
            {c.label}
          </button>
        ))}
        {flags[id] && (
          <button
            type="button"
            onClick={() => { onUnflag(id); setOpenId(null) }}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted"
          >
            Remove flag
          </button>
        )}
      </div>
    </div>
  )

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-faint">Written by {summary.tool}</p>

      {inline ? (
        <div>
          <p className="rounded-lg border border-line bg-surface p-3 text-sm leading-8 text-ink">
            {summary.sentences.map((s) => (
              <Segment
                key={s.id}
                id={s.id}
                text={s.text}
                category={flags[s.id]}
                categoryLabel={labelOrUndefined(flags[s.id])}
                isOpen={openId === s.id}
                inline
                disabled={disabled}
                onToggle={() => setOpenId(openId === s.id ? null : s.id)}
              />
            )).reduce<React.ReactNode[]>((acc, el, i) => (i === 0 ? [el] : [...acc, ' ', el]), [])}
          </p>
          {open && !disabled && (
            <div>
              <p className="mt-2 text-xs text-ink-muted">Selected: &ldquo;{open.text}&rdquo;</p>
              {picker(open.id)}
            </div>
          )}
        </div>
      ) : (
        <ol className="space-y-1.5">
          {summary.sentences.map((s) => (
            <li key={s.id}>
              <Segment
                id={s.id}
                text={s.text}
                category={flags[s.id]}
                categoryLabel={labelOrUndefined(flags[s.id])}
                isOpen={openId === s.id}
                inline={false}
                disabled={disabled}
                onToggle={() => setOpenId(openId === s.id ? null : s.id)}
              />
              {openId === s.id && !disabled && picker(s.id)}
            </li>
          ))}
        </ol>
      )}

      {omissionOptions.length > 0 && (
        <div className="rounded-lg border border-dashed border-line p-3">
          <button
            type="button"
            disabled={disabled}
            aria-expanded={omissionsOpen}
            onClick={() => setOmissionsOpen((o) => !o)}
            className="text-sm font-semibold text-accent-dark hover:underline"
          >
            Something important is missing from {summaryLabel(summary)}
          </button>

          {chosenOmissions.length > 0 && !omissionsOpen && (
            <ul className="mt-2 space-y-1">
              {chosenOmissions.map((o) => (
                <li key={o.id} className="text-xs font-semibold text-danger">Missing: {o.label}</li>
              ))}
            </ul>
          )}

          {omissionsOpen && (
            <fieldset className="mt-2 space-y-1.5">
              <legend className="sr-only">What is missing from {summaryLabel(summary)}?</legend>
              {omissionOptions.map((o) => {
                const id = omissionId(summary.id, o.id)
                const checked = Boolean(flags[id])
                return (
                  <label key={o.id} className="flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => (checked ? onUnflag(id) : onFlag(id, OMISSION_CATEGORY))}
                    />
                    <span>{o.label}</span>
                  </label>
                )
              })}
            </fieldset>
          )}
        </div>
      )}
    </div>
  )
}
