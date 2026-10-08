'use client'

/** The browser's own print dialog also saves as PDF; no PDF library needed. */
export function PrintButton() {
  return (
    <button type="button" className="btn-secondary print:hidden" onClick={() => window.print()}>
      Print or save as PDF
    </button>
  )
}
