'use client'
import { changeItemType, nextId, type ItemType, type QuestionItem } from '@challengeforge/types'
import { NumberField } from './NumberField'

const TYPE_LABELS: Record<ItemType, string> = {
  single: 'Single choice',
  multi: 'Multiple choice (all that apply)',
  numeric: 'Number',
  short_text: 'Short text answer',
}

interface Props {
  item: QuestionItem
  index: number
  count: number
  onChange: (item: QuestionItem) => void
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
}

function OptionsEditor({ item, onChange }: { item: Extract<QuestionItem, { type: 'single' | 'multi' }>; onChange: (item: QuestionItem) => void }) {
  const isCorrect = (id: string) => (item.type === 'single' ? item.answer === id : item.answers.includes(id))
  const toggleCorrect = (id: string) => {
    if (item.type === 'single') return onChange({ ...item, answer: id })
    const answers = item.answers.includes(id) ? item.answers.filter((a) => a !== id) : [...item.answers, id]
    return onChange({ ...item, answers })
  }
  const remove = (id: string) => {
    const options = item.options.filter((o) => o.id !== id)
    if (item.type === 'single') return onChange({ ...item, options, answer: item.answer === id ? (options[0]?.id ?? '') : item.answer })
    return onChange({ ...item, options, answers: item.answers.filter((a) => a !== id) })
  }
  return (
    <fieldset className="space-y-2">
      <legend className="field-label">Options (tick the correct {item.type === 'single' ? 'one' : 'ones'})</legend>
      {item.options.map((o) => (
        <div key={o.id} className="flex items-center gap-2">
          <input
            type={item.type === 'single' ? 'radio' : 'checkbox'}
            name={`correct-${item.id}`}
            checked={isCorrect(o.id)}
            onChange={() => toggleCorrect(o.id)}
            aria-label={`Mark "${o.text}" correct`}
          />
          <input
            className="field-input"
            value={o.text}
            maxLength={300}
            onChange={(e) => onChange({ ...item, options: item.options.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)) })}
            aria-label="Option text"
          />
          <button type="button" className="text-sm text-danger" disabled={item.options.length <= 2} onClick={() => remove(o.id)}>
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn-secondary"
        disabled={item.options.length >= 12}
        onClick={() => {
          const id = nextId('o', item.options.map((o) => o.id))
          onChange({ ...item, options: [...item.options, { id, text: `Option ${item.options.length + 1}` }] })
        }}
      >
        Add option
      </button>
    </fieldset>
  )
}

function AnswerEditor({ item, onChange }: { item: QuestionItem; onChange: (item: QuestionItem) => void }) {
  if (item.type === 'single' || item.type === 'multi') return <OptionsEditor item={item} onChange={onChange} />
  if (item.type === 'numeric') {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        <NumberField label="Correct value" value={item.value} onChange={(value) => onChange({ ...item, value })} />
        <NumberField label="Accepted ±" value={item.tolerance} min={0} onChange={(tolerance) => onChange({ ...item, tolerance })} />
        <label className="block">
          <span className="field-label">Unit (optional)</span>
          <input className="field-input" maxLength={20} value={item.unit ?? ''} onChange={(e) => onChange({ ...item, unit: e.target.value || undefined })} />
        </label>
      </div>
    )
  }
  return (
    <label className="block">
      <span className="field-label">Accepted answers, one per line (synonyms and abbreviations)</span>
      <textarea
        className="field-input min-h-24"
        value={item.accepted.join('\n')}
        // Blank lines are dropped except the one being typed at the end.
        onChange={(e) => onChange({ ...item, accepted: e.target.value.split('\n').map((t) => t.trimStart()).filter((t, i, all) => t !== '' || i === all.length - 1) })}
      />
      <span className="field-help">Case, accents and punctuation are ignored when matching.</span>
    </label>
  )
}

export function ItemEditor({ item, index, count, onChange, onMove, onRemove }: Props) {
  return (
    <li className="card space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="eyebrow">Question {index + 1}</span>
        <select
          className="field-input w-auto"
          value={item.type}
          onChange={(e) => onChange(changeItemType(item, e.target.value as ItemType))}
          aria-label="Question type"
        >
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <div className="ml-auto flex gap-2 text-sm">
          <button type="button" disabled={index === 0} onClick={() => onMove(-1)}>↑ Up</button>
          <button type="button" disabled={index === count - 1} onClick={() => onMove(1)}>↓ Down</button>
          <button type="button" className="text-danger" disabled={count <= 1} onClick={onRemove}>Delete</button>
        </div>
      </div>
      <label className="block">
        <span className="field-label">Question</span>
        <textarea className="field-input min-h-20" maxLength={2000} value={item.prompt} onChange={(e) => onChange({ ...item, prompt: e.target.value })} />
      </label>
      <AnswerEditor item={item} onChange={onChange} />
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <label className="block">
          <span className="field-label">Explanation (shown after the learner answers)</span>
          <textarea className="field-input min-h-16" maxLength={4000} value={item.explanation} onChange={(e) => onChange({ ...item, explanation: e.target.value })} />
        </label>
        <NumberField label="Marks" value={item.weight} min={0} onChange={(weight) => onChange({ ...item, weight })} />
      </div>
    </li>
  )
}
