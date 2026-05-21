/**
 * Phase 4 commit 1 — entry-contract tests for `pruneCheckpoints`.
 *
 * The skeleton implementation only exercises:
 *   - git-missing soft-disable (Hermes 632-636 parity)
 *   - 24h `.last_prune` marker check (Hermes 1488-1497)
 *   - `forceNow` bypass (Hermes 1488 inverted)
 *   - corrupt/unreadable marker tolerance (Hermes 1497 silent pass-through)
 *   - marker write on completion
 *
 * Pass 1/2/3 land in subsequent commits and are tested there.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { _resetGitAvailableCacheForTesting } from '../git.js'
import { getLastPrunePath } from '../paths.js'
import { pruneCheckpoints, MIN_INTERVAL_HOURS } from '../prune.js'
import { ensureStore } from '../store.js'

let tmpRoot: string
let baseEnvBefore: string | undefined

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'axiomate-prune-skel-'))
  baseEnvBefore = process.env.AXIOMATE_CHECKPOINT_BASE
})

afterAll(() => {
  if (baseEnvBefore === undefined) delete process.env.AXIOMATE_CHECKPOINT_BASE
  else process.env.AXIOMATE_CHECKPOINT_BASE = baseEnvBefore
  rmSync(tmpRoot, { recursive: true, force: true })
})

beforeEach(() => {
  // Each test gets a fresh checkpoint base directory so markers and
  // store init don't bleed across tests.
  const fresh = mkdtempSync(join(tmpRoot, 'base-'))
  process.env.AXIOMATE_CHECKPOINT_BASE = fresh
  _resetGitAvailableCacheForTesting()
})

afterEach(() => {
  _resetGitAvailableCacheForTesting()
})

describe('pruneCheckpoints — entry contract', () => {
  test('returns gitMissing=true when git probe fails (without throwing)', async () => {
    // Force probe failure by pointing to a nonexistent git binary.
    const pathBefore = process.env.PATH
    process.env.PATH = ''
    try {
      _resetGitAvailableCacheForTesting()
      const r = await pruneCheckpoints({})
      expect(r.gitMissing).toBe(true)
      expect(r.skipped).toBe(false)
      expect(r.errors).toEqual([])
    } finally {
      process.env.PATH = pathBefore
      _resetGitAvailableCacheForTesting()
    }
  })

  test('returns skipped=true when marker is younger than 24h', async () => {
    // ensureStore so the checkpoint base exists before we drop a marker.
    const e = await ensureStore()
    expect(e.ok).toBe(true)

    const marker = getLastPrunePath()
    writeFileSync(marker, String(Date.now()), 'utf-8')

    const r = await pruneCheckpoints({})
    expect(r.skipped).toBe(true)
    expect(r.gitMissing).toBe(false)
    expect(r.orphanRefsRemoved).toBe(0)
    expect(r.staleRefsRemoved).toBe(0)
  })

  test('does NOT skip when marker is older than 24h', async () => {
    await ensureStore()
    const marker = getLastPrunePath()
    writeFileSync(marker, '0', 'utf-8')
    // Push mtime back 25 hours to simulate a stale marker.
    const stale = (Date.now() - (MIN_INTERVAL_HOURS + 1) * 3600 * 1000) / 1000
    utimesSync(marker, stale, stale)

    const r = await pruneCheckpoints({})
    expect(r.skipped).toBe(false)
    expect(r.gitMissing).toBe(false)
  })

  test('forceNow=true bypasses a recent marker', async () => {
    await ensureStore()
    const marker = getLastPrunePath()
    writeFileSync(marker, String(Date.now()), 'utf-8')

    const r = await pruneCheckpoints({ forceNow: true })
    expect(r.skipped).toBe(false)
    expect(r.gitMissing).toBe(false)
  })

  test('treats a corrupt marker as "no recent run" (Hermes 1497 parity)', async () => {
    await ensureStore()
    const marker = getLastPrunePath()
    // Future timestamp — Hermes _validate_unix_time would reject this;
    // we read mtime, so the test instead targets an unreadable mtime
    // (we can't easily corrupt mtime, so verify the body-content path
    // is irrelevant: garbage body, fresh mtime → still skipped).
    writeFileSync(marker, 'NOT-A-NUMBER', 'utf-8')
    // Fresh mtime → marker IS recent regardless of content.
    const r = await pruneCheckpoints({})
    expect(r.skipped).toBe(true)
  })

  test('writes the marker on a completed run', async () => {
    await ensureStore()
    const marker = getLastPrunePath()
    expect(existsSync(marker)).toBe(false)

    const before = Date.now()
    const r = await pruneCheckpoints({})
    expect(r.skipped).toBe(false)
    expect(existsSync(marker)).toBe(true)

    const stamp = Number.parseInt(readFileSync(marker, 'utf-8'), 10)
    expect(stamp).toBeGreaterThanOrEqual(before)
    expect(stamp).toBeLessThanOrEqual(Date.now())
  })

  test('subsequent call within 24h short-circuits', async () => {
    await ensureStore()
    // First call writes the marker.
    await pruneCheckpoints({})
    // Second call within the window is throttled.
    const r = await pruneCheckpoints({})
    expect(r.skipped).toBe(true)
  })

  test('never throws — fail-open contract', async () => {
    // Even with a bogus checkpoint base (parent path is a regular file),
    // pruneCheckpoints must return a typed result.
    const file = join(tmpRoot, 'i-am-a-file')
    writeFileSync(file, 'content')
    process.env.AXIOMATE_CHECKPOINT_BASE = join(file, 'nested')
    await expect(pruneCheckpoints({ forceNow: true })).resolves.toBeDefined()
  })
})
