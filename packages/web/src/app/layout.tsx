import type { Metadata, Viewport } from 'next'
import { Source_Sans_3, Source_Serif_4 } from 'next/font/google'
import { SiteHeader } from '@/components/site/SiteHeader'
import './globals.css'

// Self-hosted by next/font: no request reaches Google at runtime.
const display = Source_Serif_4({ subsets: ['latin'], variable: '--font-display', display: 'swap' })
const text = Source_Sans_3({ subsets: ['latin'], variable: '--font-text', display: 'swap' })

export const metadata: Metadata = {
  title: { default: 'ChallengeForge', template: '%s · ChallengeForge' },
  description: 'Interactive, auto-graded challenges.',
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

// Pages depend on the signed-in user and live data.
export const dynamic = 'force-dynamic'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${text.variable}`}>
      <body className="flex min-h-dvh flex-col antialiased">
        <SiteHeader />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
      </body>
    </html>
  )
}
