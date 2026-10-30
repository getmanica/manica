import type { AgentArch, AgentOs } from './platform'

// The runs-on labels an agent answers to. A job goes to an agent when every
// one of its labels is in the agent's set. Labels compare case-insensitively,
// as on GitHub, so they're kept lowercased.

export const MAX_CUSTOM_LABELS = 32
export const MAX_LABEL_LENGTH = 64

// Each platform under our name first, then the one GitHub gives its own
// self-hosted runners (`macOS`, `X64`), so workflows written for those work
// unchanged.
const osNames: Record<AgentOs, string[]> = {
  linux: ['linux'],
  darwin: ['darwin', 'macos'],
  windows: ['windows'],
}

const archNames: Record<AgentArch, string[]> = {
  arm64: ['arm64'],
  x86_64: ['x86_64', 'x64'],
}

export const normalizeLabel = (label: string) => label.trim().toLowerCase()

// Labels go in a comma-separated list on the forge's side, and in YAML
// unquoted, so neither commas nor whitespace are allowed.
export const isValidLabel = (label: string) =>
  label.length > 0 && label.length <= MAX_LABEL_LENGTH && !/[\s,]/.test(label)

// Normalizes custom labels and drops duplicates, keeping their order.
export const normalizeLabels = (labels: string[]) => [
  ...new Set(labels.map(normalizeLabel)),
]

// The labels every agent has, whatever its custom ones.
export const builtInLabels = ({
  name,
  os,
  arch,
}: {
  name: string
  os: AgentOs
  arch: AgentArch
}) => {
  const oses = osNames[os]
  const arches = archNames[arch]
  return normalizeLabels([
    'self-hosted',
    'manica',
    ...oses,
    ...arches,
    ...oses.flatMap((o) => arches.map((a) => `${o}-${a}`)),
    name,
  ])
}

export const agentLabelSet = (agent: {
  name: string
  os: AgentOs
  arch: AgentArch
  labels: string[]
}) => normalizeLabels([...builtInLabels(agent), ...agent.labels])

// Whether an agent with `agentLabels` can run a job asking for `jobLabels`.
export const matchesLabels = (jobLabels: string[], agentLabels: string[]) => {
  const available = new Set(agentLabels.map(normalizeLabel))
  return jobLabels.every((label) => available.has(normalizeLabel(label)))
}
