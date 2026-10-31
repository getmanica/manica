import type { AgentArch, AgentOs } from '../agents/platform'

// The actions/runner build agents run, picked by the plane so every agent
// runs the latest: GitHub stops sending jobs to outdated runners.
// https://github.com/actions/runner/releases

const LATEST_RELEASE_URL =
  'https://api.github.com/repos/actions/runner/releases/latest'
const REFRESH_MS = 60 * 60 * 1000

type Release = {
  tag_name: string
  body: string
  assets: { name: string; browser_download_url: string }[]
}

export type RunnerDistribution = {
  version: string
  url: string
  sha256: string
}

// actions/runner's names for the platforms.
const osNames: Record<AgentOs, string> = {
  linux: 'linux',
  darwin: 'osx',
  windows: 'win',
}
const archNames: Record<AgentArch, string> = { arm64: 'arm64', x86_64: 'x64' }

// Release notes carry each build's checksum between markers, e.g.
// <!-- BEGIN SHA osx-arm64 -->…<!-- END SHA osx-arm64 -->.
const checksum = (body: string, platform: string) =>
  body.match(
    new RegExp(
      `<!-- BEGIN SHA ${platform} -->([0-9a-f]{64})<!-- END SHA ${platform} -->`,
    ),
  )?.[1]

export const pickDistribution = (
  release: Release,
  { os, arch }: { os: AgentOs; arch: AgentArch },
): RunnerDistribution | undefined => {
  const platform = `${osNames[os]}-${archNames[arch]}`
  const version = release.tag_name.replace(/^v/, '')
  const extension = os === 'windows' ? 'zip' : 'tar.gz'
  const asset = release.assets.find(
    ({ name }) => name === `actions-runner-${platform}-${version}.${extension}`,
  )
  const sha256 = checksum(release.body, platform)
  if (!asset || !sha256) return undefined
  return { version, url: asset.browser_download_url, sha256 }
}

// The latest release, refreshed hourly. Until a first fetch succeeds there
// is none, and agents get no work; afterwards a failed refresh keeps the
// last one.
export const createDistribution = (
  fetch: typeof globalThis.fetch = globalThis.fetch,
) => {
  let latest: Release | undefined
  let fetchedAt = 0
  let refreshing: Promise<void> | undefined

  const refresh = async () => {
    try {
      const response = await fetch(LATEST_RELEASE_URL, {
        headers: { accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      latest = (await response.json()) as Release
    } catch (error) {
      console.error(
        `fetching the latest actions/runner release failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      // Failures wait for the next refresh too, not to hammer GitHub.
      fetchedAt = Date.now()
    }
  }

  return {
    async for(platform: { os: AgentOs; arch: AgentArch }) {
      if (Date.now() - fetchedAt > REFRESH_MS) {
        refreshing ??= refresh().finally(() => {
          refreshing = undefined
        })
        // Only the first fetch is waited for: later ones refresh behind.
        if (!latest) await refreshing
      }
      return latest && pickDistribution(latest, platform)
    },
  }
}
