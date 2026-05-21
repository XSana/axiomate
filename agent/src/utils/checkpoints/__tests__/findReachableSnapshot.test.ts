/**
 * Behavior tests for `findReachableSnapshot` (6A).
 *
 * Three scenarios:
 *   1. Reachable: gitHash is the tip of the project's ref — must
 *      return `'reachable'`.
 *   2. Unreachable (orphaned by prune): build N commits, then
 *      `update-ref` the project ref backwards so the older commit
 *      objects exist but are no longer ancestors. Must return
 *      `'unreachable'` — this is the failure shape the resumed-but-
 *      pruned hint exists to catch.
 *   3. Cross-worktree: gitHash exists in *another* project's ref but
 *      not the queried workdir's. Must return `'unreachable'` from
 *      the queried project's perspective. (6B will scan across
 *      worktrees; 6A's contract is per-project only.)
 *
 * All tests use a real shadow git store via `AXIOMATE_CHECKPOINT_BASE`
 * redirect so the cat-file / merge-base codepaths are exercised end
 * to end against actual git.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'vitest'
import { findReachableSnapshot } from '../findReachableSnapshot.js'
import { _resetGitAvailableCacheForTesting } from '../git.js'
import { indexPath, projectHash, refName } from '../paths.js'
import { ensureStore } from '../store.js'
import { runCheckpointGit } from '../git.js'
import { buildFixtureCommit } from './fixtures.js'

let tmpRoot: string
let baseEnvBefore: string | undefined

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'axiomate-reach-'))
  baseEnvBefore = process.env.AXIOMATE_CHECKPOINT_BASE
})

afterAll(() => {
  if (baseEnvBefore === undefined) delete process.env.AXIOMATE_CHECKPOINT_BASE
  else process.env.AXIOMATE_CHECKPOINT_BASE = baseEnvBefore
  rmSync(tmpRoot, { recursive: true, force: true })
})

beforeEach(() => {
  const fresh = mkdtempSync(join(tmpRoot, 'base-'))
  process.env.AXIOMATE_CHECKPOINT_BASE = fresh
  _resetGitAvailableCacheForTesting()
})

afterEach(() => {
  delete process.env.AXIOMATE_CHECKPOINT_BASE
})

async function bootstrapProject(name: string): Promise<{
  workdir: string
  hash: string
  ref: string
  store: string
}> {
  const ensured = await ensureStore()
  if (ensured.ok === false) throw new Error('ensureStore failed in setup')
  const workdir = mkdtempSync(join(tmpRoot, `wt-${name}-`))
  const hash = projectHash(workdir)
  const ref = refName(hash)
  return { workdir, hash, ref, store: ensured.store }
}

describe('findReachableSnapshot', () => {
  test('reachable: tip-of-ref hash returns "reachable"', async () => {
    const p = await bootstrapProject('a')
    const sha = await buildFixtureCommit({
      store: p.store,
      workTree: p.workdir,
      indexFile: indexPath(p.hash),
      ref: p.ref,
      files: { 'foo.txt': 'one\n' },
      subject: 'snap 1',
    })
    const r = await findReachableSnapshot({
      workdir: p.workdir,
      gitHash: sha,
    })
    expect(r).toBe('reachable')
  })

  test('reachable: ancestor (not tip) still resolves "reachable"', async () => {
    const p = await bootstrapProject('b')
    const sha1 = await buildFixtureCommit({
      store: p.store,
      workTree: p.workdir,
      indexFile: indexPath(p.hash),
      ref: p.ref,
      files: { 'foo.txt': 'v1\n' },
      subject: 'snap 1',
    })
    await buildFixtureCommit({
      store: p.store,
      workTree: p.workdir,
      indexFile: indexPath(p.hash),
      ref: p.ref,
      files: { 'foo.txt': 'v2\n' },
      subject: 'snap 2',
    })
    const r = await findReachableSnapshot({
      workdir: p.workdir,
      gitHash: sha1,
    })
    expect(r).toBe('reachable')
  })

  test('unreachable: detached commit (ref rolled back) returns "unreachable"', async () => {
    const p = await bootstrapProject('c')
    const sha1 = await buildFixtureCommit({
      store: p.store,
      workTree: p.workdir,
      indexFile: indexPath(p.hash),
      ref: p.ref,
      files: { 'foo.txt': 'v1\n' },
      subject: 'snap 1',
    })
    const sha2 = await buildFixtureCommit({
      store: p.store,
      workTree: p.workdir,
      indexFile: indexPath(p.hash),
      ref: p.ref,
      files: { 'foo.txt': 'v2\n' },
      subject: 'snap 2',
    })
    // Simulate a prune that dropped sha2 from the ref tip — sha1 is
    // still the tip; sha2 is a detached object (still exists in the
    // object DB until gc, but no longer reachable from the ref).
    await runCheckpointGit(
      ['update-ref', p.ref, sha1],
      { store: p.store, workTree: p.workdir, indexFile: indexPath(p.hash) },
    )
    const r = await findReachableSnapshot({
      workdir: p.workdir,
      gitHash: sha2,
    })
    expect(r).toBe('unreachable')
  })

  test('unreachable: hash from different project does not satisfy this project', async () => {
    const a = await bootstrapProject('cross-a')
    const b = await bootstrapProject('cross-b')
    const shaA = await buildFixtureCommit({
      store: a.store,
      workTree: a.workdir,
      indexFile: indexPath(a.hash),
      ref: a.ref,
      files: { 'foo.txt': 'a\n' },
      subject: 'a snap',
    })
    // Project B has its own ref + commits; A's sha is in the shared
    // object DB but not reachable from B's ref.
    await buildFixtureCommit({
      store: b.store,
      workTree: b.workdir,
      indexFile: indexPath(b.hash),
      ref: b.ref,
      files: { 'foo.txt': 'b\n' },
      subject: 'b snap',
    })
    const r = await findReachableSnapshot({
      workdir: b.workdir,
      gitHash: shaA,
    })
    expect(r).toBe('unreachable')
  })

  test('malformed gitHash returns "unknown" without spawning git', async () => {
    const p = await bootstrapProject('mal')
    await buildFixtureCommit({
      store: p.store,
      workTree: p.workdir,
      indexFile: indexPath(p.hash),
      ref: p.ref,
      files: { 'a.txt': 'x' },
      subject: 's',
    })
    expect(
      await findReachableSnapshot({ workdir: p.workdir, gitHash: '-p' }),
    ).toBe('unknown')
    expect(
      await findReachableSnapshot({ workdir: p.workdir, gitHash: 'xyz' }),
    ).toBe('unknown')
    expect(
      await findReachableSnapshot({ workdir: p.workdir, gitHash: '' }),
    ).toBe('unknown')
  })

  test('no project ref yet → unreachable, not unknown', async () => {
    const p = await bootstrapProject('empty')
    // Don't build any commit; ref doesn't exist. cat-file -e against
    // a never-seen 40-hex returns 1 → unreachable.
    const r = await findReachableSnapshot({
      workdir: p.workdir,
      gitHash: 'a'.repeat(40),
    })
    expect(r).toBe('unreachable')
  })
})
