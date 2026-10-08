/**
 * The first complete JSON value that starts with `open` ('{' or '['), found by
 * matching brackets outside strings. Models add code fences, prose or a stray
 * closing brace after the JSON (Gemini 3.5 Flash-Lite did, 23 Sep 2026), so
 * "first brace to last brace" is not good enough. Returns null if none.
 */
export function extractFirstJson(text: string, open: '{' | '['): string | null {
  const close = open === '{' ? '}' : ']'
  const start = text.indexOf(open)
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') depth += 1
    else if (ch === '}' || ch === ']') {
      depth -= 1
      if (depth === 0) return ch === close ? text.slice(start, i + 1) : null
    }
  }
  return null
}
