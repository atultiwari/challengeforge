/** Shapes of the B7-style case artifact and the public interaction config. */

export interface Sentence {
  id: string
  text: string
}

/** A document the learner flags: an AI summary, a clinic note, a reference list, a draft prompt. */
export interface Summary {
  id: string
  /** Tab name; defaults to "Summary <id>". */
  label?: string
  /** Who or what wrote it, shown above it. */
  tool: string
  /**
   * 'rows' (default): one tappable row per sentence. 'inline': the segments
   * run together as a paragraph, each still tappable - for spotting words
   * and numbers inside running text (B4).
   */
  display?: 'rows' | 'inline'
  sentences: Sentence[]
}

export interface RecordSection {
  id: string
  title: string
  paragraphs?: string[]
  /** A conversation, e.g. a consultation the AI scribe listened to (B1). */
  dialogue?: { speaker: string; text: string }[]
}

/** Everything but the record and the documents is optional, so each mission shows only what it needs. */
export interface CaseFile {
  patient?: Record<string, string | number>
  /** Tab name for the source material; defaults to "Hospital record". */
  record_label?: string
  record: RecordSection[]
  medication_chart?: {
    title: string
    rows: { drug: string; dose: string; route: string; frequency: string; note: string }[]
  }
  labs?: { title: string; columns: string[]; rows: string[][] }
  allergies?: { title: string; entries: { substance: string; reaction: string; advice: string }[] }
  summaries: Summary[]
}

export interface Option {
  id: string
  label: string
}

export interface ClickToFlagConfig {
  case_ref: string
  instructions: string
  categories: Option[]
  /** Items a learner can report as missing; omit to hide the control. */
  omission_options?: Option[]
  /** "Which one is safe to send?" (B7); omit when there is nothing to choose. */
  choice?: { field: string; label: string }
  flags_field: string
  /** Question shown above the category buttons; defaults to the B7 wording. */
  category_prompt?: string
  submit_label?: string
}

export function summaryLabel(summary: Summary): string {
  return summary.label ?? `Summary ${summary.id}`
}

/** sentence or omission id -> category id */
export type FlagMap = Readonly<Record<string, string>>

export const OMISSION_CATEGORY = 'omission'

export function omissionId(summaryId: string, optionId: string): string {
  return `${summaryId}:omit:${optionId}`
}
