import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { beforeEach, expect, test } from 'vitest'
import { createOrganization } from '../../../test/fixtures'
import { encrypt } from '../platform/crypto'
import { db } from '../platform/db'
import { forgeApp } from '../platform/db/schema'
import { forgeWebhooksService } from './webhooks.service'

const SECRET = 'webhook-secret'

let appId: string

beforeEach(async () => {
  const { app } = await createOrganization()
  appId = app.id
  await db
    .update(forgeApp)
    .set({
      secrets: await encrypt(
        JSON.stringify({ privateKey: 'test', webhookSecret: SECRET }),
      ),
    })
    .where(eq(forgeApp.id, appId))
})

const ping = (secret: string) => {
  const body = JSON.stringify({ zen: 'Keep it logically awesome.' })
  const signature = createHmac('sha256', secret).update(body).digest('hex')
  return {
    appId,
    body,
    headers: new Headers({
      'content-type': 'application/json',
      'x-github-event': 'ping',
      'x-github-delivery': crypto.randomUUID(),
      'x-hub-signature-256': `sha256=${signature}`,
    }),
  }
}

const lastDeliveryAt = async () => {
  const [app] = await db
    .select({ lastDeliveryAt: forgeApp.lastDeliveryAt })
    .from(forgeApp)
    .where(eq(forgeApp.id, appId))
  return app?.lastDeliveryAt
}

test('records when a signed delivery arrives', async () => {
  await forgeWebhooksService.receive(ping(SECRET))
  expect(await lastDeliveryAt()).toBeInstanceOf(Date)
})

test("doesn't count a delivery with a bad signature", async () => {
  await expect(forgeWebhooksService.receive(ping('wrong'))).rejects.toThrow()
  expect(await lastDeliveryAt()).toBeNull()
})
