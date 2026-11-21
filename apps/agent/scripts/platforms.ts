// The platforms the agent is released for. `os` and `cpu` use Node's
// process.platform and process.arch names, which is what npm matches the
// `os` and `cpu` fields of a package against; `target` is Rust's. The Linux
// builds are static (musl), so they run whatever libc the machine has.
export const platforms = [
  { os: 'darwin', cpu: 'arm64', target: 'aarch64-apple-darwin' },
  { os: 'darwin', cpu: 'x64', target: 'x86_64-apple-darwin' },
  { os: 'linux', cpu: 'arm64', target: 'aarch64-unknown-linux-musl' },
  { os: 'linux', cpu: 'x64', target: 'x86_64-unknown-linux-musl' },
] as const satisfies { os: string; cpu: string; target: string }[]

export type Platform = (typeof platforms)[number]

export const platformName = (p: Platform) => `${p.os}-${p.cpu}`

// The release asset, and the file the platform's npm package ships.
export const binaryName = (p: Platform) => `manica-agent-${platformName(p)}`
