import Link from 'next/link'
import { LogoForm } from '@/components/admin/LogoForm'
import { SimpleForm } from '@/components/common/SimpleForm'
import { requirePageRole } from '@/server/guards'
import { currentSettings } from '@/server/site-settings'
import { PRESETS } from '@/lib/themes'

export const metadata = { title: 'Appearance and settings' }

export default async function SettingsPage() {
  await requirePageRole('admin', '/admin/settings')
  const s = await currentSettings()
  return (
    <div className="space-y-10">
      <header>
        <p className="eyebrow"><Link href="/admin" className="hover:underline">Admin</Link></p>
        <h1 className="text-4xl">Appearance and settings</h1>
      </header>
      <section className="card max-w-2xl space-y-3" aria-labelledby="site-settings">
        <h2 id="site-settings" className="text-xl">Site</h2>
        <SimpleForm
          url="/api/admin/site/settings"
          submitLabel="Save settings"
          fields={[
            { name: 'name', label: 'Site name', type: 'text', required: true, maxLength: 100, value: s.name },
            { name: 'tagline', label: 'Tagline', type: 'text', maxLength: 200, value: s.tagline, help: 'Shown to search engines and link previews.' },
            { name: 'footer', label: 'Footer text', type: 'text', maxLength: 500, value: s.footer, help: 'e.g. who runs the site and how to contact them.' },
            { name: 'signupsOpen', label: 'Anyone can create an account', type: 'select', value: s.signupsOpen ? 'yes' : 'no', options: [['yes', 'Yes'], ['no', 'No: people join through an LMS or an admin']] },
            { name: 'currency', label: 'Default currency for prices', type: 'text', required: true, maxLength: 3, value: s.currency },
            { name: 'preset', label: 'Theme', type: 'select', value: s.theme.preset, options: Object.entries(PRESETS).map(([id, p]) => [id, p.label] as const) },
            { name: 'accent', label: 'Custom accent colour (optional)', type: 'text', maxLength: 7, value: s.theme.accent ?? '', help: 'A hex colour such as #6b2d8a. It is refused if text on it, or in it, would be hard to read.' },
          ]}
        />
      </section>
      <section className="card max-w-2xl space-y-3" aria-labelledby="logo-settings">
        <h2 id="logo-settings" className="text-xl">Logo</h2>
        <LogoForm hasLogo={s.hasLogo} />
      </section>
    </div>
  )
}
