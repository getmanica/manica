import { env } from './env'

// AES-256-GCM for secrets at rest, serialized as `v1.<iv>.<ciphertext>`.

const rawKey = Buffer.from(env.encryptionKey, 'base64')
if (rawKey.byteLength !== 32) {
  throw new Error('ENCRYPTION_KEY must be 32 bytes, base64 encoded')
}

const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, [
  'encrypt',
  'decrypt',
])

export const encrypt = async (plaintext: string) => {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  )
  return `v1.${Buffer.from(iv).toString('base64')}.${Buffer.from(ciphertext).toString('base64')}`
}

export const decrypt = async (payload: string) => {
  const [version, iv, ciphertext] = payload.split('.')
  if (version !== 'v1' || !iv || !ciphertext) {
    throw new Error('Unsupported encrypted payload')
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(iv, 'base64') },
    key,
    Buffer.from(ciphertext, 'base64'),
  )
  return new TextDecoder().decode(plaintext)
}
