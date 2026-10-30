import { WebhookVerificationError } from 'forges'
import { github as githubProvider } from 'forges/github'
import type { JobStatus } from '../../platform/db/schema'
import { env } from '../../platform/env'
import {
  ForgeAppSetupFailedError,
  ForgeWebhookUrlNotPublicError,
  InvalidWebhookSignatureError,
} from '../errors'
import type { Forge, JobEvent } from '../forge'
import { createClients } from './client'
import { type GithubJob, toJobEvent } from './jobs'
import { createReconcileApi } from './reconcile'
import { createRunnersApi } from './runners'

const apiHeaders = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
}

// https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
type ManifestConversion = {
  id: number
  slug: string
  name: string
  html_url: string
  owner: { login: string }
  client_id: string
  client_secret: string
  webhook_secret: string
  pem: string
}

type WorkflowJobPayload = {
  workflow_job: GithubJob
  repository: { full_name: string }
  installation: { id: number }
}

// `waiting` (for a deployment environment's approval) is followed by a
// `queued` once approved, so it needs no handling of its own.
const jobStatusByAction: Record<string, JobStatus> = {
  'workflow_job.queued': 'queued',
  'workflow_job.in_progress': 'in_progress',
  'workflow_job.completed': 'completed',
}

// GitHub rejects manifests whose webhook URL it can't reach, on a page that
// strands the user there; catch the obvious cases before sending them.
const isLocalHostname = (hostname: string) =>
  hostname === 'localhost' ||
  hostname.endsWith('.localhost') ||
  hostname === '[::1]' ||
  hostname.startsWith('127.')

const clients = createClients()

export const github: Forge = {
  kind: 'github',
  ...createRunnersApi(clients),
  ...createReconcileApi(clients),

  setup({ appId, state, owner }) {
    if (isLocalHostname(new URL(env.publicUrl).hostname)) {
      throw new ForgeWebhookUrlNotPublicError(env.publicUrl)
    }

    const manifest = {
      name: 'Manica',
      url: env.betterAuthUrl,
      hook_attributes: {
        url: `${env.publicUrl}/api/forge-apps/${appId}/webhooks`,
        active: true,
      },
      redirect_url: `${env.betterAuthUrl}/api/forge-apps/setup/callback`,
      setup_url: `${env.betterAuthUrl}/forge-apps`,
      setup_on_update: true,
      public: false,
      default_permissions: {
        metadata: 'read',
        // Required to receive `workflow_job`.
        actions: 'read',
        // Registering just-in-time runners on repositories and organizations.
        administration: 'write',
        organization_self_hosted_runners: 'write',
      },
      default_events: ['workflow_job'],
    }

    const base = owner
      ? `https://github.com/organizations/${encodeURIComponent(owner)}/settings/apps/new`
      : 'https://github.com/settings/apps/new'

    return {
      url: `${base}?state=${encodeURIComponent(state)}`,
      method: 'POST',
      fields: { manifest: JSON.stringify(manifest) },
    }
  },

  async complete({ code }) {
    const response = await fetch(
      `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
      { method: 'POST', headers: apiHeaders },
    )
    if (!response.ok) {
      throw new ForgeAppSetupFailedError(
        `GitHub manifest conversion failed with ${response.status}`,
      )
    }
    const app = (await response.json()) as ManifestConversion

    return {
      externalId: String(app.id),
      slug: app.slug,
      name: app.name,
      url: app.html_url,
      installUrl: `${app.html_url}/installations/new`,
      owner: app.owner.login,
      secrets: {
        clientId: app.client_id,
        clientSecret: app.client_secret,
        webhookSecret: app.webhook_secret,
        privateKey: app.pem,
      },
    }
  },

  async receive({ headers, body, secrets }) {
    // `forges` has no CI job event kind: `workflow_job` comes through as
    // `other`, with the raw payload.
    const events = await githubProvider()
      .webhooks.ingest({ headers, body, secret: secrets.webhookSecret })
      .catch((error) => {
        if (error instanceof WebhookVerificationError) {
          throw new InvalidWebhookSignatureError()
        }
        throw error
      })

    return events.flatMap((event): JobEvent[] => {
      const status = event.kindRaw && jobStatusByAction[event.kindRaw]
      if (!status) return []
      const {
        workflow_job: job,
        repository,
        installation,
      } = event.payload as WorkflowJobPayload
      return [
        toJobEvent(job, status, {
          repository: repository.full_name,
          installationId: String(installation.id),
        }),
      ]
    })
  },
}
