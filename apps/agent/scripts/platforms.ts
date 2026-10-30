// The platforms the agent is released for. `os` and `cpu` use Node's
// process.platform and process.arch names, which is what npm matches the
// `os` and `cpu` fields of a package against.
export const platforms = [
  { os: 'darwin', cpu: 'arm64', target: 'bun-darwin-arm64' },
  // x64 builds target baseline CPUs: self-hosted machines may predate AVX2.
  { os: 'darwin', cpu: 'x64', target: 'bun-darwin-x64-baseline' },
  { os: 'linux', cpu: 'arm64', target: 'bun-linux-arm64' },
  { os: 'linux', cpu: 'x64', target: 'bun-linux-x64-baseline' },
] as const satisfies {
  os: string
  cpu: string
  target: Bun.Build.CompileTarget
}[]

export type Platform = (typeof platforms)[number]

export const platformName = (p: Platform) => `${p.os}-${p.cpu}`

// The release asset, and the file the platform's npm package ships.
export const binaryName = (p: Platform) => `manica-agent-${platformName(p)}`
