import { ForgeError } from 'forges'
import { github as githubProvider } from 'forges/github'
import { ForgeRequestFailedError } from '../errors'
import type { ForgeAppContext } from '../forge'

export type Fetch = typeof fetch
export type GithubRequest = ReturnType<typeof githubProvider>['request']

// `forges` providers authenticated as an app, or as one of its installations.
// They're kept so `forges` can reuse tokens until they expire.
export const createClients = (fetch?: Fetch) => {
  const clients = new Map<string, GithubRequest>()

  const client = (app: ForgeAppContext, installationId?: string) => {
    const key = `${app.externalId}:${installationId ?? ''}`
    let request = clients.get(key)
    if (!request) {
      request = githubProvider({
        auth: {
          type: 'app',
          appId: app.externalId,
          privateKey: app.secrets.privateKey ?? '',
          installationId,
        },
        fetch,
      }).request
      clients.set(key, request)
    }
    return request
  }

  return {
    app: (app: ForgeAppContext) => client(app),
    installation: (app: ForgeAppContext, installationId: string) =>
      client(app, installationId),
  }
}

export const repoPath = (repository: string) => {
  const [owner, name] = repository.split('/')
  if (!owner || !name) throw new Error(`Not an owner/name: ${repository}`)
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
}

// Runs a request, reporting failures as `ForgeRequestFailedError`, unless
// `handle` recognizes the forge's error and returns what to answer instead.
export const attempt = async <T>(
  action: string,
  send: () => Promise<T>,
  handle?: (error: ForgeError) => T | undefined,
): Promise<T> => {
  try {
    return await send()
  } catch (error) {
    if (error instanceof ForgeError) {
      const handled = handle?.(error)
      if (handled !== undefined) return handled
    }
    if (error instanceof ForgeRequestFailedError) throw error
    throw new ForgeRequestFailedError(
      `GitHub failed to ${action}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
