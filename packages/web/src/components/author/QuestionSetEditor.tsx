'use client'
import { newItem, type ItemType, type QuestionItem, type QuestionSetDef } from '@challengeforge/types'
import { moveItem as move } from '@/lib/schema-form/model'
import { IssuesList } from './IssuesList'
import { ItemEditor } from './ItemEditor'
import { useDefinitionDraft } from './useDefinitionDraft'

/**
 * The "WordPress for challenges" form for question sets: edit, see problems
 * as you type (server-side schema + lint), save as a new draft version.
 */
export function QuestionSetEditor({ challengeId, initial }: { challengeId: string | null; initial: QuestionSetDef }) {
  const { def, setDef, issues, saving, message, save } = useDefinitionDraft('question-set', challengeId, initial)

  const update = (patch: Partial<QuestionSetDef>) => setDef({ ...def, ...patch })
  const setItem = (index: number, item: QuestionItem) => update({ items: def.items.map((it, i) => (i === index ? item : it)) })
  const addItem = (type: ItemType) => update({ items: [...def.items, newItem(type, def.items.map((i) => i.id))] })

  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <label className="block">
          <span className="field-label">Title</span>
          <input className="field-input" maxLength={300} value={def.title} onChange={(e) => update({ title: e.target.value })} />
        </label>
        <label className="block">
          <span className="field-label">Introduction or case (Markdown)</span>
          <textarea className="field-input min-h-28" maxLength={20000} value={def.intro} onChange={(e) => update({ intro: e.target.value })} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">Pass mark (%)</span>
            <input
              className="field-input"
              inputMode="numeric"
              value={Math.round(def.pass_fraction * 100)}
              onChange={(e) => update({ pass_fraction: Math.min(100, Math.max(0, Number(e.target.value) || 0)) / 100 })}
            />
          </label>
          <label className="block">
            <span className="field-label">Points for a full score</span>
            <input
              className="field-input"
              inputMode="numeric"
              value={def.scoring.base_points}
              onChange={(e) => update({ scoring: { base_points: Math.max(1, Math.round(Number(e.target.value) || 1)) } })}
            />
          </label>
        </div>
      </section>

      <ol className="space-y-4">
        {def.items.map((item, index) => (
          <ItemEditor
            key={item.id}
            item={item}
            index={index}
            count={def.items.length}
            onChange={(next) => setItem(index, next)}
            onMove={(delta) => update({ items: move(def.items, index, delta) })}
            onRemove={() => update({ items: def.items.filter((_, i) => i !== index) })}
          />
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <span className="self-center text-sm text-ink-muted">Add a question:</span>
        {(['single', 'multi', 'numeric', 'short_text'] as const).map((type) => (
          <button key={type} type="button" className="btn-secondary" onClick={() => addItem(type)}>
            {type === 'short_text' ? 'Short text' : type[0]?.toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      <label className="card block">
        <span className="field-label">Debrief (shown after submission, Markdown)</span>
        <textarea className="field-input min-h-24" maxLength={20000} value={def.debrief} onChange={(e) => update({ debrief: e.target.value })} />
      </label>

      <IssuesList issues={issues} />
      <div className="sticky bottom-0 flex items-center gap-4 border-t border-line bg-paper py-3">
        <button type="button" className="btn-primary" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : challengeId ? 'Save draft' : 'Create draft'}
        </button>
        {message && <p role="status" className="text-sm text-ink-muted">{message}</p>}
      </div>
    </div>
  )
}
