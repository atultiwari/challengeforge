'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { postJson } from '@/lib/api'

export interface FieldSpec {
  name: string
  label: string
  type: 'text' | 'email' | 'select' | 'datetime-local' | 'hidden'
  required?: boolean
  value?: string
  maxLength?: number
  help?: string
  /** For selects: [value, label] pairs. */
  options?: readonly (readonly [string, string])[]
}

interface Props {
  url: string
  fields: readonly FieldSpec[]
  submitLabel: string
  /** After success: refresh this page, or go to a path where `{key}` is filled from the reply's data. */
  then?: { refresh: true } | { goTo: string }
  inline?: boolean
}

/** Turns the form into a JSON body: empty optional fields are left out; local date-times become ISO instants. */
function bodyOf(form: FormData, fields: readonly FieldSpec[]): Record<string, string> {
  const body: Record<string, string> = {}
  for (const f of fields) {
    const raw = String(form.get(f.name) ?? '').trim()
    if (raw === '') continue
    body[f.name] = f.type === 'datetime-local' ? new Date(raw).toISOString() : raw
  }
  return body
}

/** A small form that posts JSON to one of our routes. Used for the many one-step teaching actions. */
export function SimpleForm({ url, fields, submitLabel, then = { refresh: true }, inline = false }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // onSubmit, not <form action>: React resets an action form after every submit, which would wipe
  // what the person typed when the server refuses it. Fields stay as typed until a save succeeds.
  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const element = event.currentTarget
    const form = new FormData(element)
    setBusy(true)
    setError(null)
    const r = await postJson<Record<string, unknown>>(url, bodyOf(form, fields))
    setBusy(false)
    if (!r.ok) return setError(r.error.message)
    if ('goTo' in then) router.push(then.goTo.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(String(r.data[k] ?? ''))))
    else {
      // Saved: clear one-off inputs; fields with stored values show them again after the refresh.
      element.reset()
      router.refresh()
    }
  }

  return (
    <form onSubmit={onSubmit} className={inline ? 'flex flex-wrap items-end gap-2' : 'space-y-3'}>
      {fields.map((f) =>
        f.type === 'hidden' ? (
          <input key={f.name} type="hidden" name={f.name} value={f.value ?? ''} />
        ) : (
          <div key={f.name} className={inline ? 'min-w-48 grow' : ''}>
            <label className="field-label" htmlFor={`${url}-${f.name}`}>{f.label}</label>
            {f.type === 'select' ? (
              <select className="field-input" id={`${url}-${f.name}`} name={f.name} defaultValue={f.value} required={f.required}>
                {f.options?.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            ) : (
              <input
                className="field-input"
                id={`${url}-${f.name}`}
                name={f.name}
                type={f.type}
                defaultValue={f.value}
                required={f.required}
                maxLength={f.maxLength ?? 200}
              />
            )}
            {f.help && <p className="field-help">{f.help}</p>}
          </div>
        ),
      )}
      <button type="submit" className="btn-secondary" disabled={busy}>{busy ? 'Please wait…' : submitLabel}</button>
      {error && <p role="alert" className="w-full text-sm text-danger">{error}</p>}
    </form>
  )
}
