/**
 * What every ported Lab interaction receives. The configuration is the
 * challenge's PUBLIC interaction config (from the type's view); answers never
 * reach the browser.
 */
export interface InteractionProps {
  challengeId: string
  config: Readonly<Record<string, unknown>>
  /** Submits the learner's answer for server-side grading. */
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
  submitting: boolean
  disabled: boolean
}

export interface ColumnSpec {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean'
}

/** A challenge's asset (dataset, case file), served by the authorised asset route. */
export const assetUrl = (challengeId: string, path: string): string =>
  `/api/challenges/${encodeURIComponent(challengeId)}/assets?path=${encodeURIComponent(path)}`
