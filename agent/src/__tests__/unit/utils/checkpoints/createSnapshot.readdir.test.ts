/**
 * Finding A regression: a transient (non-ENOENT) readdir failure during
 * snapshot staging must NOT silently commit an empty/partial tree, and an
 * empty tree must never be anchored over a non-empty parent.
 *
 * These exercise the two layers of the fix:
 *   A1 — readdir errors propagate → createSnapshot returns transient-error,
 *        no commit lands (the data-loss repro the whole effort started from).
 *   A2 — commitTreeSnapshot refuses an empty tree over a non-empty parent
 *        (`suspicious-empty`), the last backstop if anything else regresses.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { runCheckpointGit } from '../../../../utils/checkpoints/git.js'
import { projectHash, refName } from '../../../../utils/checkpoints/paths.js'
import { ensureStore } from '../../../../utils/checkpoints/store.js'
import {
  createSnapshot,
  createSnapshotFromTree,
} from '../../../../utils/checkpoints/createSnapshot.js'
import { _setReaddirForTesting } from '../../../../utils/checkpoints/snapshotIndex.js'

const GIT_TEST_TIMEOUT_MS = 60_000

let tmpRoot: string
let workTree: string
let storeDir: string
let originalBase: string | undefined

beforeAll(() => {
  originalBase = process.env.AXIOMATE_CHECKPOINT_BASE
})

afterAll(() => {
  if (originalBase === undefined) delete process.env.AXIOMATE_CHECKPOINT_BASE
  else process.env.AXIOMATE_CHECKPOINT_BASE = originalBase
})

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'axiomate-snap-readdir-'))
  process.env.AXIOMATE_CHECKPOINT_BASE = join(tmpRoot, 'cp')
  workTree = mkdtempSync(join(tmpRoot, 'wt-'))
  const r = await ensureStore()
  if (r.ok === false) throw new Error(`ensureStore failed: ${r.reason}`)
  storeDir = r.store
})

afterEach(() => {
  _setReaddirForTesting(null)
  rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function commitCount(ref: string): Promise<number> {
  const r = await runCheckpointGit(['rev-list', '--count', ref], {
    store: storeDir,
    workTree,
    allowedExitCodes: new Set([128]),
  })
  if (r.ok === false) return 0
  return Number.parseInt(r.stdout.trim(), 10) || 0
}

function ioError(code: string): NodeJS.ErrnoException {
  const e = new Error(`simulated ${code}`) as NodeJS.ErrnoException
  e.code = code
  return e
}

describe('createSnapshot — readdir failure must not commit empty/partial tree', () => {
  test(
    'A1: transient readdir failure on workdir root → transient-error, no empty commit',
    async () => {
      writeFileSync(join(workTree, 'a.txt'), 'one')
      const first = await createSnapshot(workTree, { messageId: 'm1', label: 'turn 1' })
      expect(first.ok).toBe(true)
      const ref = refName(projectHash(workTree))
      expect(await commitCount(ref)).toBe(1)

      // Now a real edit exists on disk, but readdir on the root flakes with a
      // non-ENOENT error. Pre-fix this committed an empty tree; post-fix it
      // must abort the snapshot for this turn.
      writeFileSync(join(workTree, 'b.txt'), 'two')
      _setReaddirForTesting(async () => {
        throw ioError('EBUSY')
      })

      const second = await createSnapshot(workTree, { messageId: 'm2', label: 'turn 2' })
      expect(second.ok).toBe(false)
      if (second.ok === false) {
        expect(second.skipped).toBe('transient-error')
      }
      // Crucially: no empty/partial commit landed on top of turn 1.
      expect(await commitCount(ref)).toBe(1)
    },
    GIT_TEST_TIMEOUT_MS,
  )

  test(
    'A2: empty tree over a non-empty parent is refused (suspicious-empty)',
    async () => {
      writeFileSync(join(workTree, 'a.txt'), 'one')
      const first = await createSnapshot(workTree, { messageId: 'm1', label: 'turn 1' })
      expect(first.ok).toBe(true)
      const ref = refName(projectHash(workTree))

      // Persist the empty tree object in the store, then try to anchor it
      // directly over the non-empty parent via createSnapshotFromTree.
      const mk = await runCheckpointGit(['mktree'], {
        store: storeDir,
        workTree,
        input: '',
      })
      expect(mk.ok).toBe(true)
      if (mk.ok === false) return
      const emptyTree = mk.stdout.trim()

      const r = await createSnapshotFromTree(workTree, emptyTree, {
        messageId: 'm2',
        label: 'turn 2',
      })
      expect(r.ok).toBe(false)
      if (r.ok === false) {
        expect(r.skipped).toBe('suspicious-empty')
      }
      // Parent commit untouched.
      expect(await commitCount(ref)).toBe(1)
    },
    GIT_TEST_TIMEOUT_MS,
  )

  test(
    'A1 control: ENOENT (dir genuinely vanished) is still tolerated, snapshot proceeds',
    async () => {
      writeFileSync(join(workTree, 'a.txt'), 'one')
      const first = await createSnapshot(workTree, { messageId: 'm1', label: 'turn 1' })
      expect(first.ok).toBe(true)
      const ref = refName(projectHash(workTree))

      // A subdirectory that ENOENTs during the walk is benign — the snapshot
      // should still succeed on the rest of the tree (here: the root files).
      writeFileSync(join(workTree, 'b.txt'), 'two')
      const realReaddir = (await import('fs/promises')).readdir
      _setReaddirForTesting((async (p: Parameters<typeof realReaddir>[0], opts: never) => {
        if (typeof p === 'string' && p.endsWith('ghost')) throw ioError('ENOENT')
        return realReaddir(p, opts)
      }) as typeof realReaddir)

      const second = await createSnapshot(workTree, { messageId: 'm2', label: 'turn 2' })
      // No 'ghost' dir exists, so this is really just asserting the seam
      // delegates correctly and a normal edit still commits.
      expect(second.ok).toBe(true)
      expect(await commitCount(ref)).toBe(2)
    },
    GIT_TEST_TIMEOUT_MS,
  )
})
