'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { postJson, requestJson } from '@/lib/api'
import type { Issue } from './IssuesList'

const LINT_DELAY_MS = 600

/**
 * What every author form shares: the draft definition, lint as you type
 * (newest reply wins), and saving as a new draft version.
 */
export function useDefinitionDraft<T>(typeId: string, challengeId: string | null, initial: T) {
  const router = useRouter()
  const [def, setDef] = useState(initial)
  const [issues, setIssues] = useState<Issue[]>([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const lintSeq = useRef(0)

  useEffect(() => {
    const timer = setTimeout(async () => {
      const seq = ++lintSeq.current
      const r = await postJson<{ issues: Issue[] }>('/api/author/lint', { typeId, definition: def })
      if (r.ok && seq === lintSeq.current) setIssues(r.data.issues)
    }, LINT_DELAY_MS)
    return () => clearTimeout(timer)
  }, [def, typeId])

  async function save() {
    setSaving(true)
    setMessage(null)
    const result = challengeId
      ? await requestJson<{ version: number }>('PUT', `/api/author/challenges/${challengeId}`, { definition: def })
      : await postJson<{ id: string }>('/api/author/challenges', { typeId, definition: def })
    setSaving(false)
    if (!result.ok) {
      setMessage(result.error.message)
      if (result.error.issues) setIssues(result.error.issues as Issue[])
      return
    }
    // The page shows the "saved" notice from the URL, so it survives the editor remounting on the new version.
    if ('id' in result.data) router.push(`/author/${result.data.id}?saved=1`)
    else router.replace(`/author/${challengeId}?saved=${result.data.version}`)
    router.refresh()
  }

  return { def, setDef, issues, saving, message, save }
}
