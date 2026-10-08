'use client'
import { useState } from 'react'
import { SourceRecord } from './SourceRecord'
import { SummaryView } from './SummaryView'
import { summaryLabel, type CaseFile, type FlagMap, type Option } from './types'

export interface DocumentPaneProps {
  caseFile: CaseFile
  initialTab: string
  flags: FlagMap
  categories: Option[]
  omissionOptions: Option[]
  categoryPrompt: string
  disabled: boolean
  onFlag: (id: string, category: string) => void
  onUnflag: (id: string) => void
}

/** A tabbed viewer: the record or either summary. Laptops show two side by side. */
export function DocumentPane({ caseFile, initialTab, ...summaryProps }: DocumentPaneProps) {
  const [tab, setTab] = useState(initialTab)
  const tabs = [
    { id: 'record', label: caseFile.record_label ?? 'Hospital record' },
    ...caseFile.summaries.map((s) => ({ id: s.id, label: summaryLabel(s) })),
  ]
  const summary = caseFile.summaries.find((s) => s.id === tab)

  return (
    <div className="card min-w-0">
      <div role="tablist" className="flex gap-1 rounded-lg bg-surface-sunken p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold sm:text-sm ${
              tab === t.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-4" role="tabpanel">
        {summary ? <SummaryView summary={summary} {...summaryProps} /> : <SourceRecord caseFile={caseFile} />}
      </div>
    </div>
  )
}
