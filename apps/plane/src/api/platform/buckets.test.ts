import { describe, expect, test } from 'vitest'
import { firstBucket } from './buckets'

const now = new Date('2026-10-31T12:30:00Z')

describe('firstBucket', () => {
  test('ends with the bar now falls in', () => {
    expect(firstBucket(now, 60 * 60 * 1000, 24, 0)).toEqual(
      new Date('2026-10-30T13:00:00Z'),
    )
  })

  test("starts day bars at the viewer's midnight", () => {
    const day = 24 * 60 * 60 * 1000
    // 12:30 UTC is 14:30 two hours ahead: that day starts at 22:00 UTC.
    expect(firstBucket(now, day, 1, 120)).toEqual(
      new Date('2026-10-30T22:00:00Z'),
    )
  })
})
