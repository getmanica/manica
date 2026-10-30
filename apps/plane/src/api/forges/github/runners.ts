import { ForgeApiError, NotFoundError } from 'forges'
import { RunnerNameTakenError } from '../errors'
import type { Forge } from '../forge'
import { attempt, type createClients, repoPath } from './client'

// https://docs.github.com/en/rest/actions/self-hosted-runners#create-configuration-for-a-just-in-time-runner-for-a-repository
type JitConfigResponse = {
  runner: { id: number }
  encoded_jit_config: string
}

type RunnersResponse = {
  runners: { id: number; name: string }[]
}

// Repository runners all go in the default group: repositories have no other.
const DEFAULT_RUNNER_GROUP_ID = 1

// Runner registration, on a repository, as an installation of the app.
export const createRunnersApi = (
  clients: ReturnType<typeof createClients>,
): Pick<Forge, 'createRunner' | 'findRunner' | 'deleteRunner'> => ({
  createRunner: ({ app, installationId, repository, name, labels }) =>
    attempt(
      'register a runner',
      async () => {
        const { data } = await clients.installation(
          app,
          installationId,
        )<JitConfigResponse>(
          'POST',
          `${repoPath(repository)}/actions/runners/generate-jitconfig`,
          {
            body: {
              name,
              labels,
              runner_group_id: DEFAULT_RUNNER_GROUP_ID,
              work_folder: '_work',
            },
          },
        )
        return {
          externalRunnerId: String(data.runner.id),
          config: data.encoded_jit_config,
        }
      },
      (error) => {
        if (error instanceof ForgeApiError && error.status === 409) {
          throw new RunnerNameTakenError()
        }
      },
    ),

  findRunner: ({ app, installationId, repository, name }) =>
    attempt('list runners', async () => {
      const { data } = await clients.installation(
        app,
        installationId,
      )<RunnersResponse>('GET', `${repoPath(repository)}/actions/runners`, {
        query: { name },
      })
      const runner = data.runners.find((runner) => runner.name === name)
      return runner && String(runner.id)
    }),

  // GitHub answers 422 while the runner is running a job.
  deleteRunner: ({ app, installationId, repository, externalRunnerId }) =>
    attempt(
      'delete a runner',
      async () => {
        await clients.installation(app, installationId)(
          'DELETE',
          `${repoPath(repository)}/actions/runners/${encodeURIComponent(externalRunnerId)}`,
        )
        return 'deleted' as const
      },
      (error) => {
        if (error instanceof NotFoundError) return 'deleted'
        if (error instanceof ForgeApiError && error.status === 422) {
          return 'busy'
        }
      },
    ),
})
