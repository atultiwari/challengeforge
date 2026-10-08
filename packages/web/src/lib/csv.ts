/**
 * CSV for spreadsheet exports. Values are quoted when needed, and a value
 * that a spreadsheet would run as a formula (=, +, -, @, tab, carriage
 * return at the start) gets a leading apostrophe: names and answers come
 * from learners, and must never execute in an instructor's spreadsheet.
 */
export type CsvValue = string | number | boolean | null | undefined | Date

const FORMULA_START = /^[=+\-@\t\r]/

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  const safe = FORMULA_START.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Rows to CSV text, with a byte-order mark so spreadsheets read UTF-8 names correctly. */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  return '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** A safe download file name: letters, digits, dashes. */
export const csvFileName = (base: string): string => `${base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'export'}.csv`
