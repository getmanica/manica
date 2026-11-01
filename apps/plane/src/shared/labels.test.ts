import { describe, expect, test } from 'bun:test'
import {
  agentLabelSet,
  builtInLabels,
  isValidLabel,
  matchesLabels,
  normalizeLabels,
} from './labels'

const mac = { name: 'Studio', os: 'darwin', arch: 'arm64' } as const

describe('builtInLabels', () => {
  test('covers our names, GitHub’s, and both combined', () => {
    expect(builtInLabels(mac)).toEqual([
      'self-hosted',
      'manica',
      'darwin',
      'macos',
      'arm64',
      'darwin-arm64',
      'macos-arm64',
      'studio',
    ])
  })

  test('aliases x86_64 as x64', () => {
    expect(
      builtInLabels({ name: 'box', os: 'linux', arch: 'x86_64' }),
    ).toContain('linux-x64')
  })
})

describe('agentLabelSet', () => {
  test('adds custom labels, without duplicates', () => {
    const labels = agentLabelSet({ ...mac, labels: ['gpu', 'macos'] })
    expect(labels).toContain('gpu')
    expect(labels.filter((label) => label === 'macos')).toHaveLength(1)
  })
})

describe('matchesLabels', () => {
  const set = agentLabelSet({ ...mac, labels: ['xcode-16'] })

  test('matches by architecture or name, case-insensitively', () => {
    expect(matchesLabels(['self-hosted', 'darwin-arm64'], set)).toBe(true)
    expect(matchesLabels(['self-hosted', 'macOS', 'ARM64'], set)).toBe(true)
    expect(matchesLabels(['Studio'], set)).toBe(true)
    expect(matchesLabels(['manica', 'xcode-16'], set)).toBe(true)
  })

  test('needs every label', () => {
    expect(matchesLabels(['self-hosted', 'linux'], set)).toBe(false)
    expect(matchesLabels(['ubuntu-latest'], set)).toBe(false)
  })
})

test('normalizeLabels trims, lowercases and dedupes', () => {
  expect(normalizeLabels([' GPU', 'gpu', 'Xcode-16'])).toEqual([
    'gpu',
    'xcode-16',
  ])
})

test('isValidLabel rejects commas, whitespace and long labels', () => {
  expect(isValidLabel('xcode-16')).toBe(true)
  expect(isValidLabel('a,b')).toBe(false)
  expect(isValidLabel('a b')).toBe(false)
  expect(isValidLabel('a'.repeat(65))).toBe(false)
})
