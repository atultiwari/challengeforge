import { describe, expect, it } from 'vitest'
import { csvCell, csvFileName, toCsv } from '../src/lib/csv'

describe('csv', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
  })

  it('neutralises spreadsheet formulas from learner-supplied text', () => {
    expect(csvCell('=HYPERLINK("http://evil.test")')).toBe(`"'=HYPERLINK(""http://evil.test"")"`)
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('-2')).toBe("'-2")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell(-2)).toBe('-2')
  })

  it('formats other values', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell(true)).toBe('yes')
    expect(csvCell(Number.NaN)).toBe('')
    expect(csvCell(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02T03:04:05.000Z')
  })

  it('builds a document with a BOM and CRLF rows, and safe file names', () => {
    expect(toCsv(['a', 'b'], [[1, 'x']])).toBe('﻿a,b\r\n1,x\r\n')
    expect(csvFileName('Year 3, 2026 / Progress')).toBe('year-3-2026-progress.csv')
    expect(csvFileName('***')).toBe('export.csv')
  })
})
