import { decrypt } from '../platform/crypto'
import type { ForgeAppContext, ForgeSecrets } from './forge'

// What a forge needs to act as a stored app: its id and decrypted secrets.
export const appContext = async (app: {
  externalId: string
  secrets: string
}): Promise<ForgeAppContext> => ({
  externalId: app.externalId,
  secrets: JSON.parse(await decrypt(app.secrets)) as ForgeSecrets,
})
