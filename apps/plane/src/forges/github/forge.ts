import { WebhookVerificationError } from 'forges'
import { github as githubProvider } from 'forges/github'
import { env } from '../../env'
import {
  ForgeAppSetupFailedError,
  ForgeWebhookUrlNotPublicError,
  InvalidWebhookSignatureError,
} from '../errors'
import type { Forge } from '../forge'

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

// https://docs.github.com/en/webhooks/webhook-events-and-payloads#workflow_job
type WorkflowJobPayload = {
  workflow_job: { id: number; labels: string[] }
  repository: { full_name: string }
}

// GitHub rejects manifests whose webhook URL it can't reach, on a page that
// strands the user there; catch the obvious cases before sending them.
const isLocalHostname = (hostname: string) =>
  hostname === 'localhost' ||
  hostname.endsWith('.localhost') ||
  hostname === '[::1]' ||
  hostname.startsWith('127.')

export const github: Forge = {
  kind: 'github',

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

    return events
      .filter((event) => event.kindRaw === 'workflow_job.queued')
      .map((event) => {
        const payload = event.payload as WorkflowJobPayload
        return {
          type: 'job.queued',
          jobId: String(payload.workflow_job.id),
          repository: payload.repository.full_name,
          labels: payload.workflow_job.labels,
        }
      })
  },
}
