import ReactMarkdown from 'react-markdown'

/**
 * Author-written text. react-markdown never renders raw HTML (skipHtml makes
 * that explicit), so a semi-trusted author cannot inject script (PLAN.md §3.4).
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className ?? 'prose-cf'}>
      <ReactMarkdown skipHtml>{children}</ReactMarkdown>
    </div>
  )
}
