'use client'
import { useEffect, useState } from 'react'
import { assetUrl, type InteractionProps } from '../types'
import { DocumentPane } from './DocumentPane'
import { summaryLabel, type CaseFile, type ClickToFlagConfig, type FlagMap } from './types'

/**
 * B7. Read the hospital record, flag what is wrong in each AI summary, then
 * choose the one that is safe to send. Grading happens on the server; nothing
 * here knows which sentences are wrong.
 */
export function ClickToFlag({ challengeId, config: rawConfig, onSubmit, submitting, disabled }: InteractionProps) {
  const config = rawConfig as unknown as ClickToFlagConfig
  const [caseFile, setCaseFile] = useState<CaseFile | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [flags, setFlags] = useState<FlagMap>({})
  const [choice, setChoice] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(assetUrl(challengeId, config.case_ref))
      .then((res) => {
        if (!res.ok) throw new Error('load failed')
        return res.json() as Promise<CaseFile>
      })
      .then((data) => { if (!cancelled) setCaseFile(data) })
      .catch(() => { if (!cancelled) setLoadError('The hospital record could not be loaded. Refresh and try again.') })
    return () => { cancelled = true }
  }, [challengeId, config.case_ref])

  const flag = (id: string, category: string) => setFlags((prev) => ({ ...prev, [id]: category }))
  const unflag = (id: string) =>
    setFlags((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => key !== id)))

  if (loadError) return <p role="alert" className="card text-sm font-medium text-danger">{loadError}</p>
  if (!caseFile) return <p className="card text-sm text-ink-muted">Loading the hospital record…</p>

  const flagCount = Object.keys(flags).length
  const choiceConfig = config.choice
  const canSubmit = !submitting && !disabled && (choiceConfig ? choice !== '' : flagCount > 0)
  const paneProps = {
    caseFile,
    flags,
    categories: config.categories,
    omissionOptions: config.omission_options ?? [],
    categoryPrompt: config.category_prompt ?? 'What is wrong with this sentence?',
    disabled,
    onFlag: flag,
    onUnflag: unflag,
  }

  return (
    <div className="space-y-6">
      <p className="rounded-lg bg-accent-soft px-4 py-3 text-sm text-ink">{config.instructions.trim()}</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <DocumentPane {...paneProps} initialTab="record" />
        <div className="hidden lg:block">
          <DocumentPane {...paneProps} initialTab={caseFile.summaries[0]?.id ?? 'record'} />
        </div>
      </div>

      <section className="card">
        <h2 className="text-base font-bold">{choiceConfig ? 'Your decision' : 'Your review'}</h2>
        <p className="mt-1 text-sm text-ink-muted">
          You have flagged {flagCount} {flagCount === 1 ? 'problem' : 'problems'}.
        </p>

        {choiceConfig && (
          <fieldset className="mt-4">
            <legend className="field-label">{choiceConfig.label}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {caseFile.summaries.map((s) => (
                <label
                  key={s.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm ${
                    choice === s.id ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent'
                  }`}
                >
                  <input
                    type="radio"
                    name="safer_summary"
                    value={s.id}
                    checked={choice === s.id}
                    onChange={() => setChoice(s.id)}
                    disabled={disabled}
                  />
                  <span>{summaryLabel(s)} <span className="text-ink-faint">({s.tool})</span></span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <button
          className="btn-primary mt-6 w-full sm:w-auto"
          disabled={!canSubmit}
          onClick={() =>
            onSubmit({
              ...(choiceConfig ? { [choiceConfig.field]: choice } : {}),
              [config.flags_field]: Object.entries(flags).map(([id, category]) => ({ id, category })),
            })
          }
        >
          {submitting ? 'Checking…' : (config.submit_label ?? 'Submit my review')}
        </button>
      </section>
    </div>
  )
}
