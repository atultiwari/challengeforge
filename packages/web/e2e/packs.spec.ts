import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { expect, test } from '@playwright/test'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { E2E_ADMIN } from './config'
import { signIn } from './helpers'

const quiz = {
  title: 'Registry quiz (synthetic)',
  story_brief: 'Pick b.',
  interaction: 'scenario_quiz',
  interaction_config: { options: ['a', 'b'] },
  rule: { type: 'exact', field: 'answer', expected: 'b' },
  scoring: { base_points: 100, hint_costs: [], wrong_attempt_penalty: 0, reveal_after_attempts: null },
  hints: [],
  debrief: 'Done.',
}
const packZip = (slug: string, title: string) =>
  zipSync({
    'pack.json': strToU8(JSON.stringify({ format: 1, slug, title, description: 'E2E', sections: [], challenges: [{ slug: `${slug}-quiz`, type: 'lab-legacy@1', definition: 'challenges/q.json' }] })),
    'challenges/q.json': strToU8(JSON.stringify(quiz)),
  })

let registry: Server
test.beforeAll(async () => {
  const zip = packZip('e2e-registry-pack', 'E2E registry pack')
  const index = { format: 1, packs: [{ slug: 'e2e-registry-pack', title: 'E2E registry pack', description: 'From a local registry', version: '1', url: 'http://localhost:3298/pack.zip', sha256: createHash('sha256').update(zip).digest('hex') }] }
  registry = createServer((req, res) => {
    if (req.url === '/index.json') return res.end(JSON.stringify(index))
    if (req.url === '/pack.zip') return res.end(Buffer.from(zip))
    res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => registry.listen(3298, resolve))
})
test.afterAll(() => new Promise<void>((resolve) => registry.close(() => resolve())))

test('an admin imports a pack zip, installs one from the registry, and downloads a pack', async ({ page }) => {
  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password)
  await page.goto('/admin/packs')
  await page.waitForLoadState('networkidle')

  // Upload: a broken zip is refused with a reason; a good one is imported.
  await page.getByLabel('Pack (.zip, up to 32 MB)').setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip') })
  await page.getByRole('button', { name: 'Import pack' }).click()
  await expect(page.getByRole('alert').filter({ hasText: /zip|pack\.json/ })).toBeVisible()
  await page.getByLabel('Pack (.zip, up to 32 MB)').setInputFiles({ name: 'upload.zip', mimeType: 'application/zip', buffer: Buffer.from(packZip('e2e-uploaded-pack', 'E2E uploaded pack')) })
  await page.getByLabel('Publish right away').check()
  await page.getByRole('button', { name: 'Import pack' }).click()
  await expect(page.getByText(/Imported: 1 new/)).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'E2E uploaded pack' })).toBeVisible()

  // Registry: install by slug; the checksum is verified on the server.
  const card = page.getByRole('listitem').filter({ hasText: 'From a local registry' })
  await card.getByRole('button', { name: 'Install' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'E2E registry pack' }).first()).toBeVisible()

  // Download: a zip another site could import.
  const row = page.getByRole('listitem').filter({ hasText: 'E2E uploaded pack' })
  const href = await row.getByRole('link', { name: 'Download .zip' }).getAttribute('href')
  const res = await page.request.get(href!)
  expect(res.headers()['content-type']).toBe('application/zip')
  const files = unzipSync(new Uint8Array(await res.body()))
  expect(JSON.parse(new TextDecoder().decode(files['pack.json']!)).slug).toBe('e2e-uploaded-pack')
})
