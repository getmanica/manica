// The platforms an agent can run on, chosen when the agent is created.

export const agentOses = ['linux', 'darwin', 'windows'] as const
export type AgentOs = (typeof agentOses)[number]

export const agentArches = ['arm64', 'x86_64'] as const
export type AgentArch = (typeof agentArches)[number]
