import { beforeEach, describe, expect, test } from 'bun:test'
import { fakeGithub, type Reply, scope } from '../../../../test/github'
import { ForgeRequestFailedError, RunnerNameTakenError } from '../errors'
import { createClients } from './client'
import { createRunnersApi } from './runners'

const runners = '/repos/acme/widgets/actions/runners'

describe('createRunner', () => {
  let github: ReturnType<typeof fakeGithub>

  beforeEach(() => {
    github = fakeGithub({
      [`POST ${runners}/generate-jitconfig`]: {
        status: 201,
        body: { runner: { id: 99 }, encoded_jit_config: 'jit' },
      },
    })
  })

  test('registers a repository runner with the job’s labels', async () => {
    const api = createRunnersApi(createClients(github.fetch))
    const created = await api.createRunner({
      ...scope,
      name: 'manica-1',
      labels: ['self-hosted', 'macos'],
    })
    expect(created).toEqual({ externalRunnerId: '99', config: 'jit' })
    expect(github.calls.at(-1)).toMatchObject({
      method: 'POST',
      body: {
        name: 'manica-1',
        labels: ['self-hosted', 'macos'],
        runner_group_id: 1,
      },
    })
  })

  test('reuses the installation token', async () => {
    const api = createRunnersApi(createClients(github.fetch))
    const input = { ...scope, name: 'manica-1', labels: ['manica'] }
    await api.createRunner(input)
    await api.createRunner(input)
    const mints = github.calls.filter((call) =>
      call.path.endsWith('/access_tokens'),
    )
    expect(mints).toHaveLength(1)
  })

  test('reports a taken name', async () => {
    const api = createRunnersApi(
      createClients(
        fakeGithub({
          [`POST ${runners}/generate-jitconfig`]: {
            status: 409,
            body: { message: 'Already exists' },
          },
        }).fetch,
      ),
    )
    const created = api.createRunner({ ...scope, name: 'x', labels: ['a'] })
    await expect(created).rejects.toBeInstanceOf(RunnerNameTakenError)
  })

  test('reports other failures as typed errors', async () => {
    const api = createRunnersApi(
      createClients(
        fakeGithub({
          [`POST ${runners}/generate-jitconfig`]: {
            status: 403,
            body: { message: 'Resource not accessible by integration' },
          },
        }).fetch,
      ),
    )
    const created = api.createRunner({ ...scope, name: 'x', labels: ['a'] })
    await expect(created).rejects.toBeInstanceOf(ForgeRequestFailedError)
  })
})

test('findRunner looks a runner up by name', async () => {
  const github = fakeGithub({
    [`GET ${runners}`]: {
      status: 200,
      body: { runners: [{ id: 5, name: 'manica-1' }] },
    },
  })
  const api = createRunnersApi(createClients(github.fetch))
  expect(await api.findRunner({ ...scope, name: 'manica-1' })).toBe('5')
  expect(github.calls.at(-1)?.search).toBe('?name=manica-1')
  expect(await api.findRunner({ ...scope, name: 'manica-2' })).toBeUndefined()
})

describe('deleteRunner', () => {
  const deleting = (reply: Reply) =>
    createRunnersApi(
      createClients(fakeGithub({ [`DELETE ${runners}/5`]: reply }).fetch),
    ).deleteRunner({ ...scope, externalRunnerId: '5' })

  test('deletes', async () => {
    expect(await deleting({ status: 204 })).toBe('deleted')
  })

  test('treats a missing runner as deleted', async () => {
    expect(
      await deleting({ status: 404, body: { message: 'Not Found' } }),
    ).toBe('deleted')
  })

  test('reports a runner that’s running a job as busy', async () => {
    expect(
      await deleting({ status: 422, body: { message: 'still running a job' } }),
    ).toBe('busy')
  })
})
