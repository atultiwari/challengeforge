import type { Question } from '../questions/types'

/** Public shapes for evidence-quiz missions (I5, I6, A7). No answers here. */
export interface LineChartExhibit {
  type: 'line_chart'
  y_label: string
  y_min: number
  y_max: number
  x_labels: string[]
  series: { label: string; values: number[] }[]
  /** Vertical markers, e.g. "new troponin assay". */
  markers?: { x_index: number; label: string }[]
}
export interface BarChartExhibit {
  type: 'bar_chart'
  value_label: string
  max: number
  bars: { label: string; value: number }[]
}
export interface TableExhibit {
  type: 'table'
  columns: string[]
  rows: (string | number)[][]
}
export interface LogExhibit {
  type: 'log'
  items: { when: string; text: string }[]
}
export interface TextExhibit {
  type: 'text'
  paragraphs: string[]
}
export type Exhibit = { id: string; title: string; caption?: string } & (
  LineChartExhibit | BarChartExhibit | TableExhibit | LogExhibit | TextExhibit
)

export interface EvidenceQuizConfig {
  instructions: string
  answers_field: string
  exhibits: Exhibit[]
  questions: Question[]
  submit_label?: string
}
