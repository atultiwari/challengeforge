import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PLUGIN = path.resolve(import.meta.dirname, '../../../integrations/wordpress/challengeforge/challengeforge.php')
const STUBS = path.resolve(import.meta.dirname, 'fixtures/wp-stubs.php')
const ID = '11111111-2222-3333-4444-555555555555'
const php = (code: string) => execFileSync('php', ['-r', `require '${STUBS}'; ${code} require '${PLUGIN}'; echo challengeforge_shortcode(['challenge' => '${ID}']);`]).toString()

function phpAvailable(): boolean {
  try {
    execFileSync('php', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe.runIf(phpAvailable())('the WordPress plugin shortcode (real PHP)', () => {
  it('renders a nonce form for members, with no sign-on token in the (cacheable) page', () => {
    const html = php('')
    expect(html).toContain('admin-post.php')
    expect(html).toContain('name="challenge" value="11111111-2222-3333-4444-555555555555"')
    expect(html).toContain('name="_cfnonce"')
    expect(html).not.toMatch(/name="token"|eyJ/)
  })

  it('renders a plain link for visitors, and nothing for a malformed id', () => {
    expect(php("$GLOBALS['cf_logged_in'] = false;")).toBe(`<a class="challengeforge-link" href="https://challenges.example.test/play/${ID}" target="_blank" rel="noopener">Start the challenge</a>`)
    const bad = execFileSync('php', ['-r', `require '${STUBS}'; require '${PLUGIN}'; echo challengeforge_shortcode(['challenge' => '"><script>']);`]).toString()
    expect(bad).toBe('')
  })
})
