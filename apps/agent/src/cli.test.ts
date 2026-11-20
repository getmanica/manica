import { expect, test } from 'bun:test'
import { parseCli } from './cli'
import { UsageError } from './errors'

test('runs the agent by default', () => {
  expect(parseCli(['-c', '/etc/manica'])).toMatchObject({
    command: 'run',
    configDir: '/etc/manica',
  })
})

test('takes the doctor command, with options', () => {
  expect(parseCli(['doctor', '--config-dir', '/etc/manica'])).toMatchObject({
    command: 'doctor',
    configDir: '/etc/manica',
  })
})

test('rejects unknown commands and extra arguments', () => {
  expect(() => parseCli(['docter'])).toThrow(UsageError)
  expect(() => parseCli(['doctor', 'now'])).toThrow('Unexpected argument: now')
})
