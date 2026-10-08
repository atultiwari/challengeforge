'use client'
import { useEffect, useState } from 'react'

const COMPLETE_NUMBER = /^-?(\d+\.?\d*|\.\d+)$/

interface Props {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  className?: string
}

/**
 * A number input that keeps what the author is typing ("0.", "-", "-3.") as
 * text and only reports a value once it is a complete number, so decimals
 * and negatives can be typed naturally.
 */
export function NumberField({ label, value, onChange, min, className }: Props) {
  const [text, setText] = useState(String(value))

  // Follow outside changes (e.g. a reset), but never fight the author mid-edit.
  useEffect(() => {
    if (Number(text) !== value) setText(String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <label className={className ?? 'block'}>
      <span className="field-label">{label}</span>
      <input
        className="field-input"
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          const next = e.target.value.trim()
          setText(e.target.value)
          if (COMPLETE_NUMBER.test(next)) {
            const n = Number(next)
            onChange(min !== undefined ? Math.max(min, n) : n)
          }
        }}
        onBlur={() => setText(String(value))}
      />
    </label>
  )
}
