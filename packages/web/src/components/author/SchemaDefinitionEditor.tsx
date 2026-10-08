'use client'
import type { JsonSchema, Path } from '@/lib/schema-form/model'
import { setAt } from '@/lib/schema-form/model'
import { IssuesList } from './IssuesList'
import { SchemaField } from './schema-form/SchemaField'
import { useDefinitionDraft } from './useDefinitionDraft'

interface Props {
  typeId: string
  challengeId: string | null
  /** The type's definition schema as JSON Schema (generated on the server from Zod). */
  schema: JsonSchema
  initial: unknown
}

/**
 * The generic author form (PLAN.md §3.8): any challenge type is authorable
 * from its own schema, with the type's lint shown next to the field it is about.
 */
export function SchemaDefinitionEditor({ typeId, challengeId, schema, initial }: Props) {
  const { def, setDef, issues, saving, message, save } = useDefinitionDraft(typeId, challengeId, initial)
  const onChange = (path: Path, value: unknown) => setDef((current: unknown) => setAt(current, path, value))
  return (
    <div className="space-y-6">
      <div className="card">
        <SchemaField name="challenge" schema={schema} value={def} path={[]} issues={issues} onChange={onChange} />
      </div>
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
