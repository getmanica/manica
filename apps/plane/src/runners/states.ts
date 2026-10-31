// A runner's life, as the plane tracks it:
// - registering: claimed for a job, being registered with the forge.
// - issued: registered, its config sent to the agent, not yet acknowledged.
// - acked: the agent has it (it listed it in a poll) and is starting it.
// - running: the forge says it picked up a job.
// - exited: the agent says its process exited.
// - released: dropped before it ran a job (lease expired, agent restarted,
//   registration failed, or no longer needed).
// - lost: its agent went silent while it ran a job.
export const runnerStates = [
  'registering',
  'issued',
  'acked',
  'running',
  'exited',
  'released',
  'lost',
] as const
export type RunnerState = (typeof runnerStates)[number]

// States that take one of the agent's slots and count as serving a job.
export const liveStates = [
  'registering',
  'issued',
  'acked',
  'running',
] as const satisfies RunnerState[]

// Runner names on the forge: recognizable, and derived from the id so a
// registration whose outcome is unknown can be looked up.
export const runnerName = (id: string) => `manica-${id}`
