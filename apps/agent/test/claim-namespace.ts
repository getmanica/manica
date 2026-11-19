// A process claiming a VM namespace, for the lock's tests:
//   bun test/claim-namespace.ts <namespace> <lock dir> [hold|orphan]
// Prints "ok" or "in use: <message>". With `hold`, it then keeps the claim
// until killed; with `orphan`, it starts a long-running child and exits,
// leaving the child behind.
import { claimNamespace } from '../src/vm/namespace-lock'

const [namespace = '', lockDir = '', mode] = process.argv.slice(2)
try {
  await claimNamespace(namespace, lockDir)
  console.log('ok')
} catch (error) {
  console.log(`in use: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}
if (mode === 'hold') setInterval(() => {}, 1 << 30)
if (mode === 'orphan') {
  Bun.spawn(['sleep', '30'], { stdio: ['ignore', 'ignore', 'ignore'] }).unref()
}
