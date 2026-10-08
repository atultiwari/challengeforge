import { saveSiteSettings, ValidationError } from '@challengeforge/db'
import { db } from '@/server/db'
import { oneOf, optionalText, text } from '@/server/body'
import { ok } from '@/server/http'
import { mutation } from '@/server/route'
import { clearSiteCache } from '@/server/site'
import { currentSettings } from '@/server/site-settings'
import { PRESETS, themeProblems, type PresetId } from '@/lib/themes'

/** Saves the site's name, texts, switches and theme. A theme that fails contrast checks is refused. */
export async function POST(request: Request) {
  return mutation(request, async ({ scope, body }) => {
    const preset = oneOf(body, 'preset', Object.keys(PRESETS) as PresetId[])
    const accent = optionalText(body, 'accent', 7)?.toLowerCase()
    const problems = themeProblems({ preset, accent })
    if (problems.length > 0) throw new ValidationError(problems[0]!)
    const saved = await saveSiteSettings(db(), scope, await currentSettings(), {
      name: text(body, 'name', 100),
      tagline: optionalText(body, 'tagline', 200) ?? '',
      footer: optionalText(body, 'footer', 500) ?? '',
      signupsOpen: oneOf(body, 'signupsOpen', ['yes', 'no'] as const) === 'yes',
      currency: text(body, 'currency', 3).toUpperCase(),
      theme: { preset, ...(accent ? { accent } : {}) },
    })
    // The site's name is part of the cached site lookup.
    clearSiteCache()
    return ok(saved)
  })
}
