// What a job's at, as one value: its status until it completes, then how it
// ended (GitHub's conclusions: success, failure, cancelled, skipped,
// timed_out…), or `completed` if the forge didn't say. The jobs list filters
// and sorts by it.

export const jobOutcome = ({
  status,
  conclusion,
}: {
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: string | null
}) => (status === 'completed' && conclusion ? conclusion : status)

// e.g. "Running", "Timed out".
export const jobOutcomeLabel = (outcome: string) => {
  if (outcome === 'in_progress') return 'Running'
  const text = outcome.replaceAll('_', ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// The outcomes the status filter always offers; any other one shows up once a
// job has it.
export const commonOutcomes = [
  'queued',
  'in_progress',
  'success',
  'failure',
  'cancelled',
  'skipped',
  'timed_out',
]
