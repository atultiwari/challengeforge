import { saveProduct, ValidationError } from '@challengeforge/db'
import { db } from '@/server/db'
import { oneOf, text } from '@/server/body'
import { ok } from '@/server/http'
import { toMinorUnits } from '@/server/payments'
import { mutation } from '@/server/route'

/** Sets the pack's price (in major units, e.g. "499.00") and whether it is on sale. */
export async function POST(request: Request, ctx: { params: Promise<{ packId: string }> }) {
  const { packId } = await ctx.params
  return mutation(request, async ({ scope, body }) => {
    const priceMinor = toMinorUnits(text(body, 'price', 12))
    if (priceMinor === null) throw new ValidationError('Enter a price like 499 or 499.00.')
    return ok(await saveProduct(db(), scope, { packId, priceMinor, currency: text(body, 'currency', 3), active: oneOf(body, 'onSale', ['yes', 'no'] as const) === 'yes' }))
  })
}
