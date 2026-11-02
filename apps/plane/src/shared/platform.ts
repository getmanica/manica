// The platforms an agent can run on, chosen when the agent is created.

export const agentOses = ['linux', 'darwin', 'windows'] as const
export type AgentOs = (typeof agentOses)[number]

export const agentArches = ['arm64', 'x86_64'] as const
export type AgentArch = (typeof agentArches)[number]

export const osLabels: Record<AgentOs, string> = {
  linux: 'Linux',
  darwin: 'macOS',
  windows: 'Windows',
}

export const archLabels: Record<AgentArch, string> = {
  arm64: 'ARM64',
  x86_64: 'x86-64',
}

// e.g. "macOS ARM64".
export const formatPlatform = ({
  os,
  arch,
}: {
  os: AgentOs
  arch: AgentArch
}) => `${osLabels[os]} ${archLabels[arch]}`

// A platform as one value, e.g. "darwin-arm64", for filtering by it.
export type PlatformKey = `${AgentOs}-${AgentArch}`

export const platformKey = ({
  os,
  arch,
}: {
  os: AgentOs
  arch: AgentArch
}): PlatformKey => `${os}-${arch}`

export const platformKeys = agentOses.flatMap((os) =>
  agentArches.map((arch) => platformKey({ os, arch })),
) as [PlatformKey, ...PlatformKey[]]

// Oses have no hyphen, so the first one separates the two.
export const parsePlatformKey = (key: PlatformKey) => {
  const at = key.indexOf('-')
  return {
    os: key.slice(0, at) as AgentOs,
    arch: key.slice(at + 1) as AgentArch,
  }
}
