'use client'
import { NumberField } from '../NumberField'
import {
  defaultFor,
  humanize,
  isMap,
  issuesAt,
  moveItem,
  nextItemId,
  nullableInner,
  removeAt,
  renameKey,
  summaryOf,
  variantIndex,
  type Issue,
  type JsonSchema,
  type Path,
} from '@/lib/schema-form/model'

/** Fields whose text is prose (case text, answers, explanations): rendered as text areas. */
const LONG_TEXT = /^(response|vignette|debrief|intro|explanation|result|message|summary|story_brief|notes|reason|chief_complaint)$/

export interface FieldProps {
  name: string
  schema: JsonSchema
  value: unknown
  path: Path
  issues: readonly Issue[]
  onChange: (path: Path, value: unknown) => void
}

function FieldIssues({ issues, path }: { issues: readonly Issue[]; path: Path }) {
  const here = issuesAt(issues, path)
  if (here.length === 0) return null
  return (
    <ul className="mt-1 space-y-0.5 text-sm">
      {here.map((i, n) => (
        <li key={n} className={i.severity === 'error' ? 'text-danger' : 'text-warn'}>
          {i.message}
        </li>
      ))}
    </ul>
  )
}

function Help({ schema }: { schema: JsonSchema }) {
  return schema.description ? <span className="field-help block">{schema.description}</span> : null
}

function ScalarField({ name, schema, value, path, issues, onChange }: FieldProps) {
  const label = schema.title ?? humanize(name)
  if (schema.enum) {
    return (
      <label className="block">
        <span className="field-label">{label}</span>
        <select className="field-input" value={String(value ?? '')} onChange={(e) => onChange(path, e.target.value)}>
          {schema.enum.map((option) => (
            <option key={String(option)} value={String(option)}>{humanize(String(option))}</option>
          ))}
        </select>
        <Help schema={schema} />
        <FieldIssues issues={issues} path={path} />
      </label>
    )
  }
  if (schema.type === 'boolean') {
    return (
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(path, e.target.checked)} />
        <span className="font-semibold">{label}</span>
        <FieldIssues issues={issues} path={path} />
      </label>
    )
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    return (
      <div>
        <NumberField label={label} value={typeof value === 'number' ? value : 0} min={schema.minimum} onChange={(n) => onChange(path, schema.type === 'integer' ? Math.round(n) : n)} />
        <Help schema={schema} />
        <FieldIssues issues={issues} path={path} />
      </div>
    )
  }
  const text = typeof value === 'string' ? value : ''
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {LONG_TEXT.test(name) ? (
        <textarea className="field-input min-h-20" value={text} maxLength={20000} onChange={(e) => onChange(path, e.target.value)} />
      ) : (
        <input className="field-input" value={text} maxLength={schema.maxLength ?? 500} onChange={(e) => onChange(path, e.target.value)} />
      )}
      <Help schema={schema} />
      <FieldIssues issues={issues} path={path} />
    </label>
  )
}

/** A list of short strings (keywords, synonyms, accepted terms) edited as one comma-separated line. */
function StringListField({ name, schema, value, path, issues, onChange }: FieldProps) {
  const list = Array.isArray(value) ? (value as string[]) : []
  return (
    <label className="block">
      <span className="field-label">{schema.title ?? humanize(name)} (comma-separated)</span>
      <input
        className="field-input"
        value={list.join(', ')}
        onChange={(e) => onChange(path, e.target.value.split(',').map((s) => s.trimStart()).filter((s, i, all) => s !== '' || i === all.length - 1))}
      />
      <Help schema={schema} />
      <FieldIssues issues={issues} path={path} />
    </label>
  )
}

function ArrayField({ name, schema, value, path, issues, onChange }: FieldProps) {
  const items = Array.isArray(value) ? value : []
  const itemSchema = schema.items ?? {}
  const canRemove = items.length > (schema.minItems ?? 0)
  const add = () => {
    const fresh = defaultFor(itemSchema)
    const withId =
      fresh && typeof fresh === 'object' && !Array.isArray(fresh) && itemSchema.properties?.['id'] !== undefined
        ? { ...(fresh as object), id: nextItemId(name, items) }
        : fresh
    onChange(path, [...items, withId])
  }
  return (
    <fieldset className="space-y-2">
      <legend className="field-label">{schema.title ?? humanize(name)}</legend>
      <Help schema={schema} />
      <FieldIssues issues={issues} path={path} />
      {items.map((item, i) => (
        <details key={i} className="rounded-md border border-line bg-surface" open={items.length <= 2}>
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2">
            <span className="mr-auto font-semibold">{summaryOf(item) || `${humanize(name)} ${i + 1}`}</span>
            {issues.some((x) => x.path.startsWith(`${[...path, i].join('.')}`)) && <span className="pill bg-danger-soft text-danger">check</span>}
          </summary>
          <div className="space-y-3 border-t border-line px-3 py-3">
            <SchemaField name={name} schema={itemSchema} value={item} path={[...path, i]} issues={issues} onChange={onChange} />
            <div className="flex gap-3 text-sm">
              <button type="button" disabled={i === 0} onClick={() => onChange(path, moveItem(items, i, -1))}>↑ Up</button>
              <button type="button" disabled={i === items.length - 1} onClick={() => onChange(path, moveItem(items, i, 1))}>↓ Down</button>
              <button type="button" className="text-danger" disabled={!canRemove} onClick={() => onChange(path, removeAt(items, i))}>Remove</button>
            </div>
          </div>
        </details>
      ))}
      {(schema.maxItems === undefined || items.length < schema.maxItems) && (
        <button type="button" className="btn-secondary" onClick={add}>
          Add {humanize(name).toLowerCase().replace(/ies$/, 'y').replace(/s$/, '')}
        </button>
      )}
    </fieldset>
  )
}

/** A name → value map (e.g. vitals: "Heart rate" → "118 /min"), edited as rows. */
function MapField({ name, schema, value, path, issues, onChange }: FieldProps) {
  const map = (value ?? {}) as Record<string, unknown>
  const entries = Object.entries(map)
  return (
    <fieldset className="space-y-2 rounded-md border border-line p-3">
      <legend className="px-1 font-semibold">{schema.title ?? humanize(name)}</legend>
      <Help schema={schema} />
      {entries.map(([key, v], i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <input
            className="field-input"
            value={key}
            aria-label="Name"
            onChange={(e) => onChange(path, renameKey(map, key, e.target.value))}
          />
          <input className="field-input" value={String(v ?? '')} aria-label={`Value for ${key}`} onChange={(e) => onChange(path, { ...map, [key]: e.target.value })} />
          <button type="button" className="text-sm text-danger" onClick={() => onChange(path, Object.fromEntries(entries.filter(([k]) => k !== key)))}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn-secondary" onClick={() => onChange(path, { ...map, [`New ${entries.length + 1}`]: '' })}>
        Add a row
      </button>
      <FieldIssues issues={issues} path={path} />
    </fieldset>
  )
}

function ObjectFields({ schema, value, path, issues, onChange }: FieldProps) {
  const record = (value ?? {}) as Record<string, unknown>
  const required = new Set(schema.required ?? [])
  return (
    <div className="space-y-3">
      {Object.entries(schema.properties ?? {}).map(([key, prop]) => {
        if (prop.const !== undefined) return null
        const present = key in record
        if (!present && !required.has(key) && prop.default === undefined) {
          return (
            <button key={key} type="button" className="block text-sm text-accent underline" onClick={() => onChange([...path, key], defaultFor(prop))}>
              + {prop.title ?? humanize(key)} (optional)
            </button>
          )
        }
        return <SchemaField key={key} name={key} schema={prop} value={record[key]} path={[...path, key]} issues={issues} onChange={onChange} />
      })}
    </div>
  )
}

/** Renders any part of a definition from its JSON Schema. */
export function SchemaField(props: FieldProps) {
  const { name, schema, value, path, onChange } = props
  const inner = nullableInner(schema)
  if (inner) {
    return (
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value !== null && value !== undefined} onChange={(e) => onChange(path, e.target.checked ? defaultFor(inner) : null)} />
          <span className="font-semibold">{schema.title ?? humanize(name)}</span>
        </label>
        {value !== null && value !== undefined && <SchemaField {...props} schema={{ ...inner, title: schema.title ?? humanize(name) }} />}
      </div>
    )
  }
  if (schema.oneOf) {
    const index = variantIndex(schema, value)
    const variants = schema.oneOf
    const tagOf = (v: JsonSchema) => Object.values(v.properties ?? {}).find((p) => p.const !== undefined)?.const
    return (
      <div className="space-y-3 rounded-md border border-line p-3">
        <label className="block">
          <span className="field-label">{schema.title ?? humanize(name)}: kind</span>
          <select className="field-input" value={index} onChange={(e) => onChange(path, defaultFor(variants[Number(e.target.value)] ?? {}))}>
            {variants.map((v, i) => (
              <option key={i} value={i}>{humanize(String(tagOf(v) ?? i))}</option>
            ))}
          </select>
        </label>
        <ObjectFields {...props} schema={variants[index] ?? {}} />
      </div>
    )
  }
  if (isMap(schema)) return <MapField {...props} />
  if (schema.type === 'object') {
    return path.length === 0 || typeof path.at(-1) === 'number' ? (
      <ObjectFields {...props} />
    ) : (
      <fieldset className="space-y-3 rounded-md border border-line p-3">
        <legend className="px-1 font-semibold">{schema.title ?? humanize(name)}</legend>
        <Help schema={schema} />
        <ObjectFields {...props} />
      </fieldset>
    )
  }
  if (schema.type === 'array') {
    return schema.items?.type === 'string' && !schema.items.enum ? <StringListField {...props} /> : <ArrayField {...props} />
  }
  return <ScalarField {...props} />
}
