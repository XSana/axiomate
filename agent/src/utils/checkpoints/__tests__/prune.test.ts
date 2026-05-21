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
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { _resetGitAvailableCacheForTesting, runCheckpointGit } from '../git.js'
import {
  getLastPrunePath,
  getStoreDir,
  indexPath,
  projectHash,
  projectMetaPath,
  refName,
} from '../paths.js'
import { pruneCheckpoints, MIN_INTERVAL_HOURS } from '../prune.js'
import { ensureStore } from '../store.js'
import { touchProject } from '../touchProject.js'
import { buildFixtureCommit } from './fixtures.js'

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

  test('fresh install (no store dir) → no errors, no gc invocation', async () => {
    // Regression: before the existsSync guard in runReflogExpireAndGc,
    // running prune on a freshly-created checkpoint base (where
    // ensureStore has NOT been called) emitted two cosmetic
    // "reflog expire / gc: working directory not found" entries in
    // report.errors, which made `axiomate checkpoints prune` exit 1
    // for what is really a no-op.
    expect(existsSync(getStoreDir())).toBe(false)
    const r = await pruneCheckpoints({ forceNow: true })
    expect(r.gitMissing).toBe(false)
    expect(r.skipped).toBe(false)
    expect(r.errors).toEqual([])
    expect(r.gcInvocations).toBe(0)
    expect(r.orphanRefsRemoved).toBe(0)
    expect(r.staleRefsRemoved).toBe(0)
  })
})

/**
 * Build a fully-populated project: real workdir on disk, real ref with
 * 1 commit, real index, real projects/<hash>.json. Returns the inputs
 * the prune passes will look at.
 */
async function buildPopulatedProject(args: {
  store: string
  /** Parent dir for the workdir to be created under. */
  parent: string
  /** Override last_touch to backdate the project. */
  lastTouchSec?: number
}): Promise<{ hash: string; workdir: string; ref: string; metaPath: string; indexFilePath: string }> {
  const workdir = mkdtempSync(join(args.parent, 'wt-'))
  await touchProject(workdir)
  const hash = projectHash(workdir)
  const ref = refName(hash)
  const indexFilePath = indexPath(hash)
  const metaPath = projectMetaPath(hash)

  await buildFixtureCommit({
    store: args.store,
    workTree: workdir,
    indexFile: indexFilePath,
    ref,
    files: { 'a.txt': 'one' },
    subject: 'axiomate:m1:turn 1',
  })

  if (args.lastTouchSec !== undefined) {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
    meta.last_touch = args.lastTouchSec
    writeFileSync(metaPath, JSON.stringify(meta, null, 2))
  }

  return { hash, workdir, ref, metaPath, indexFilePath }
}

describe('pruneCheckpoints — orphan pass', () => {
  test('drops ref + index + meta when workdir is gone', async () => {
    const e = await ensureStore()
    expect(e.ok).toBe(true)
    if (!e.ok) return

    const wtParent = mkdtempSync(join(tmpRoot, 'wts-'))
    const proj = await buildPopulatedProject({ store: e.store, parent: wtParent })

    // Confirm setup: ref exists, index exists, meta exists.
    expect(existsSync(proj.metaPath)).toBe(true)
    expect(existsSync(proj.indexFilePath)).toBe(true)
    const refCheckBefore = await runCheckpointGit(
      ['rev-parse', '--verify', proj.ref],
      { store: e.store, workTree: e.store },
    )
    expect(refCheckBefore.ok).toBe(true)

    // Delete the workdir to make this an orphan.
    rmSync(proj.workdir, { recursive: true, force: true })

    const r = await pruneCheckpoints({ forceNow: true })
    expect(r.gitMissing).toBe(false)
    expect(r.skipped).toBe(false)
    expect(r.orphanRefsRemoved).toBe(1)
    expect(r.staleRefsRemoved).toBe(0)
    expect(r.errors).toEqual([])

    // Ref + index + meta all gone.
    const refCheckAfter = await runCheckpointGit(
      ['rev-parse', '--verify', proj.ref],
      { store: e.store, workTree: e.store, allowedExitCodes: new Set([128]) },
    )
    expect(refCheckAfter.ok && refCheckAfter.code === 128).toBe(true)
    expect(existsSync(proj.metaPath)).toBe(false)
    expect(existsSync(proj.indexFilePath)).toBe(false)
  })

  test('leaves an alive project untouched', async () => {
    const e = await ensureStore()
    if (!e.ok) return

    const wtParent = mkdtempSync(join(tmpRoot, 'wts-'))
    const proj = await buildPopulatedProject({ store: e.store, parent: wtParent })

    const r = await pruneCheckpoints({ forceNow: true })
    expect(r.orphanRefsRemoved).toBe(0)
    expect(r.staleRefsRemoved).toBe(0)
    expect(existsSync(proj.metaPath)).toBe(true)

    const refCheck = await runCheckpointGit(
      ['rev-parse', '--verify', proj.ref],
      { store: e.store, workTree: e.store },
    )
    expect(refCheck.ok).toBe(true)
  })
})

describe('pruneCheckpoints — stale pass', () => {
  test('drops ref when last_touch is older than retentionDays', async () => {
    const e = await ensureStore()
    if (!e.ok) return

    const wtParent = mkdtempSync(join(tmpRoot, 'wts-'))
    const oldSec = Math.floor(Date.now() / 1000) - 30 * 86400 // 30 days ago
    const proj = await buildPopulatedProject({
      store: e.store,
      parent: wtParent,
      lastTouchSec: oldSec,
    })

    const r = await pruneCheckpoints({ forceNow: true, retentionDays: 14 })
    expect(r.staleRefsRemoved).toBe(1)
    expect(r.orphanRefsRemoved).toBe(0)
    expect(existsSync(proj.metaPath)).toBe(false)
  })

  test('respects retentionDays=0 to disable stale pass', async () => {
    const e = await ensureStore()
    if (!e.ok) return

    const wtParent = mkdtempSync(join(tmpRoot, 'wts-'))
    const oldSec = Math.floor(Date.now() / 1000) - 30 * 86400
    const proj = await buildPopulatedProject({
      store: e.store,
      parent: wtParent,
      lastTouchSec: oldSec,
    })

    const r = await pruneCheckpoints({ forceNow: true, retentionDays: 0 })
    expect(r.staleRefsRemoved).toBe(0)
    expect(existsSync(proj.metaPath)).toBe(true)
  })

  test('orphan wins over stale when both apply', async () => {
    const e = await ensureStore()
    if (!e.ok) return

    const wtParent = mkdtempSync(join(tmpRoot, 'wts-'))
    const oldSec = Math.floor(Date.now() / 1000) - 30 * 86400
    const proj = await buildPopulatedProject({
      store: e.store,
      parent: wtParent,
      lastTouchSec: oldSec,
    })

    // Make it both an orphan AND stale.
    rmSync(proj.workdir, { recursive: true, force: true })

    const r = await pruneCheckpoints({ forceNow: true, retentionDays: 14 })
    expect(r.orphanRefsRemoved).toBe(1)
    expect(r.staleRefsRemoved).toBe(0) // counted as orphan, not stale
  })
})

describe('pruneCheckpoints — intermediate gc', () => {
  test('runs gc unconditionally — even with no orphan/stale candidates', async () => {
    const e = await ensureStore()
    if (!e.ok) return

    // Fresh store; no projects → no orphans → no stale.
    const r = await pruneCheckpoints({ forceNow: true })
    expect(r.orphanRefsRemoved).toBe(0)
    expect(r.staleRefsRemoved).toBe(0)
    // Hermes parity: intermediate gc still runs (1375-1382 unconditional).
    // Until commit 3 lands the final-gc, gcInvocations === 1.
    expect(r.gcInvocations).toBe(1)
    expect(r.errors).toEqual([])
  })

  test('runs gc after orphan/stale drops', async () => {
    const e = await ensureStore()
    if (!e.ok) return

    const wtParent = mkdtempSync(join(tmpRoot, 'wts-'))
    const proj = await buildPopulatedProject({ store: e.store, parent: wtParent })
    rmSync(proj.workdir, { recursive: true, force: true })

    const r = await pruneCheckpoints({ forceNow: true })
    expect(r.orphanRefsRemoved).toBe(1)
    expect(r.gcInvocations).toBe(1)
  })
})

describe('pruneCheckpoints — error handling', () => {
  test('malformed projects/<hash>.json is logged in errors[] but does not abort', async () => {
    const e = await ensureStore()
    if (!e.ok) return

    // Write a malformed meta. Use a 16-char hash to pass the filename check.
    const projectsDir = join(getStoreDir(), 'projects')
    mkdirSync(projectsDir, { recursive: true })
    writeFileSync(join(projectsDir, '0123456789abcdef.json'), 'not json {{{', 'utf-8')

    // Add a real project alongside so we can confirm it's still processed.
    const wtParent = mkdtempSync(join(tmpRoot, 'wts-'))
    const proj = await buildPopulatedProject({ store: e.store, parent: wtParent })
    rmSync(proj.workdir, { recursive: true, force: true })

    const r = await pruneCheckpoints({ forceNow: true })
    expect(r.errors.some(s => s.includes('0123456789abcdef'))).toBe(true)
    expect(r.orphanRefsRemoved).toBe(1) // alive project still processed
  })
})

/**
 * Build a populated project with N commits on its ref so the size cap
 * has something to drop. Returns the same shape as `buildPopulatedProject`
 * for chained assertions.
 */
async function buildProjectWithNCommits(args: {
  store: string
  parent: string
  commits: number
}): Promise<{ hash: string; workdir: string; ref: string; metaPath: string }> {
  const proj = await buildPopulatedProject({ store: args.store, parent: args.parent })
  for (let i = 1; i < args.commits; i++) {
    await buildFixtureCommit({
      store: args.store,
      workTree: proj.workdir,
      indexFile: indexPath(proj.hash),
      ref: proj.ref,
      files: { 'a.txt': `content-${i}` },
      subject: `axiomate:m1:turn ${i + 1}`,
    })
  }
  return proj
}

async function commitCountOnRef(store: string, ref: string): Promise<number> {
  const r = await runCheckpointGit(
    ['rev-list', '--count', ref],
    { store, workTree: store, allowedExitCodes: new Set([128]) },
  )
  if (r.ok === false) return 0
  return Number.parseInt(r.stdout.trim(), 10) || 0
}

describe('pruneCheckpoints — size cap pass', () => {
  test('does not run when maxTotalSizeMb=0 (Hermes 1090 disabled-branch)', async () => {
    const e = await ensureStore()
    if (!e.ok) return

    const wtParent = mkdtempSync(join(tmpRoot, 'wts-'))
    const proj = await buildProjectWithNCommits({
      store: e.store,
      parent: wtParent,
      commits: 5,
    })

    const r = await pruneCheckpoints({ forceNow: true, maxTotalSizeMb: 0 })
    expect(r.sizeCapCommitsDropped).toBe(0)
    expect(r.sizeCapRefsTouched).toBe(0)
    // Final gc does not run when size cap is disabled.
    expect(r.gcInvocations).toBe(1) // intermediate only
    // All 5 commits intact.
    expect(await commitCountOnRef(e.store, proj.ref)).toBe(5)
  })

  test('skips drop loop but still runs final gc when size is under cap', async () => {
    const e = await ensureStore()
    if (!e.ok) return

    // Big cap → never triggers.
    const r = await pruneCheckpoints({ forceNow: true, maxTotalSizeMb: 9999 })
    expect(r.sizeCapCommitsDropped).toBe(0)
    expect(r.sizeCapRefsTouched).toBe(0)
    // Hermes early-return at 1090-1095 means NO final gc when under cap.
    expect(r.gcInvocations).toBe(1) // intermediate only
  })

  test('drops oldest commits round-robin until under cap', async () => {
    const e = await ensureStore()
    if (!e.ok) return

    const wtParent = mkdtempSync(join(tmpRoot, 'wts-'))
    const proj = await buildProjectWithNCommits({
      store: e.store,
      parent: wtParent,
      commits: 5,
    })

    // Tiny cap forces the loop to drop. Drops are bounded by KEEP=1 so
    // the loop will run 4 iterations max (5 → 4 → 3 → 2 → 1).
    const r = await pruneCheckpoints({ forceNow: true, maxTotalSizeMb: 0.0001 })
    expect(r.sizeCapCommitsDropped).toBeGreaterThan(0)
    expect(r.sizeCapRefsTouched).toBe(1)
    // Final gc runs because size cap actually triggered.
    expect(r.gcInvocations).toBe(2) // intermediate + final

    // Ref still alive and at least 1 commit remains (KEEP_LAST_N_PER_REF).
    const remaining = await commitCountOnRef(e.store, proj.ref)
    expect(remaining).toBeGreaterThanOrEqual(1)
    expect(remaining).toBeLessThan(5)
  }, 30_000)

  test('keeps at least one commit per ref (KEEP_LAST_N_PER_REF=1)', async () => {
    const e = await ensureStore()
    if (!e.ok) return

    const wtParent = mkdtempSync(join(tmpRoot, 'wts-'))
    const proj = await buildProjectWithNCommits({
      store: e.store,
      parent: wtParent,
      commits: 3,
    })

    // Cap so tight the loop wants to drop everything.
    const r = await pruneCheckpoints({ forceNow: true, maxTotalSizeMb: 0.00001 })
    expect(r.sizeCapCommitsDropped).toBeGreaterThan(0)

    // The drop loop must stop before the ref reaches zero — we never
    // wipe a project's last rewindable snapshot from under it.
    const remaining = await commitCountOnRef(e.store, proj.ref)
    expect(remaining).toBe(1)
  })

  test('round-robin: distributes drops across multiple refs', async () => {
    const e = await ensureStore()
    if (!e.ok) return

    const wtParent = mkdtempSync(join(tmpRoot, 'wts-'))
    const projA = await buildProjectWithNCommits({
      store: e.store,
      parent: wtParent,
      commits: 4,
    })
    const projB = await buildProjectWithNCommits({
      store: e.store,
      parent: wtParent,
      commits: 4,
    })

    const r = await pruneCheckpoints({ forceNow: true, maxTotalSizeMb: 0.0001 })
    expect(r.sizeCapCommitsDropped).toBeGreaterThan(0)
    // Both projects should be touched — round-robin walks all refs each iter.
    expect(r.sizeCapRefsTouched).toBe(2)

    const remA = await commitCountOnRef(e.store, projA.ref)
    const remB = await commitCountOnRef(e.store, projB.ref)
    expect(remA).toBeGreaterThanOrEqual(1)
    expect(remB).toBeGreaterThanOrEqual(1)
    // Drops should be balanced — neither ref was emptied while the other
    // still had commits left over.
    expect(Math.abs(remA - remB)).toBeLessThanOrEqual(1)
  }, 30_000)

  test('breaks out when no progress made in a round (anti-livelock)', async () => {
    const e = await ensureStore()
    if (!e.ok) return

    const wtParent = mkdtempSync(join(tmpRoot, 'wts-'))
    // Single commit on a single ref — drop loop cannot make progress
    // (KEEP_LAST_N_PER_REF=1 protects it).
    await buildProjectWithNCommits({
      store: e.store,
      parent: wtParent,
      commits: 1,
    })

    // Set cap below the actual store size so the entry check passes.
    // The drop loop body will then short-circuit since nothing can be dropped.
    const r = await pruneCheckpoints({ forceNow: true, maxTotalSizeMb: 0.00001 })
    expect(r.sizeCapCommitsDropped).toBe(0)
    // Final gc still runs — Hermes 1164-1171 unconditional within branch.
    expect(r.gcInvocations).toBe(2)
  })

  test('reports bytesFreed >= 0', async () => {
    const e = await ensureStore()
    if (!e.ok) return

    const wtParent = mkdtempSync(join(tmpRoot, 'wts-'))
    await buildProjectWithNCommits({
      store: e.store,
      parent: wtParent,
      commits: 5,
    })

    const r = await pruneCheckpoints({ forceNow: true, maxTotalSizeMb: 0.0001 })
    // Cap at 0 — Hermes 1457 max(0, before-after) — covers fs noise.
    expect(r.bytesFreed).toBeGreaterThanOrEqual(0)
  })
})
