import type { Metadata, Viewport } from 'next'
import { themeCss, isPreset } from '@/lib/themes'
import { cspNonce, currentSettings } from '@/server/site-settings'
import { Source_Sans_3, Source_Serif_4 } from 'next/font/google'
import { SiteHeader } from '@/components/site/SiteHeader'
import './globals.css'

// Self-hosted by next/font: no request reaches Google at runtime.
const display = Source_Serif_4({ subsets: ['latin'], variable: '--font-display', display: 'swap' })
const text = Source_Sans_3({ subsets: ['latin'], variable: '--font-text', display: 'swap' })

export async function generateMetadata(): Promise<Metadata> {
  const settings = await currentSettings()
  return {
    title: { default: settings.name, template: `%s · ${settings.name}` },
    description: settings.tagline || 'Interactive, auto-graded challenges.',
  }
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

// Pages depend on the signed-in user and live data.
export const dynamic = 'force-dynamic'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [settings, nonce] = await Promise.all([currentSettings(), cspNonce()])
  const { preset, accent } = settings.theme
  // Only a known preset and a validated hex accent reach the stylesheet (themeCss emits custom properties only).
  const css = isPreset(preset) && preset !== 'case-file' || accent ? themeCss({ preset: isPreset(preset) ? preset : 'case-file', ...(accent ? { accent } : {}) }) : null
  return (
    <html lang="en" className={`${display.variable} ${text.variable}`}>
      <head>{css && <style nonce={nonce}>{css}</style>}</head>
      <body className="flex min-h-dvh flex-col antialiased">
        <SiteHeader />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
        {settings.footer && (
          <footer className="border-t border-line bg-surface">
            <p className="mx-auto max-w-5xl whitespace-pre-line px-4 py-6 text-sm text-ink-muted">{settings.footer}</p>
          </footer>
        )}
      </body>
    </html>
  )
}
