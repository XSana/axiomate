/**
 * Finding E regression: the fresh-start (`!hasRef`) update-ref must use an
 * empty-old-value CAS so two worktrees of the same project both taking their
 * first-ever snapshot can't silently clobber each other.
 *
 * Deterministic repro without flaky wall-clock racing: mock the tip-resolution
 * `rev-parse ...^{commit}` to report "no ref" (forcing the `!hasRef` branch),
 * while the ref actually EXISTS in the real store. The real
 * `update-ref <ref> <new> ''` then must fail (ref exists, empty old-value
 * asserts non-existence) → `skipped: 'race'`. Pre-fix the bare 2-arg form
 * would have overwritten the existing ref and returned ok.
 */

import { mkdtempSync, rmSync } from 'fs'
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
  vi,
} from 'vitest'
import type { CheckpointGitResult } from '../../../../utils/checkpoints/git.js'

const INJECT: { forceNoRef: boolean; updateRefArgs: string[][] } = {
  forceNoRef: false,
  updateRefArgs: [],
}

vi.mock('../../../../utils/checkpoints/git.js', async () => {
  const real = await vi.importActual<typeof import('../../../../utils/checkpoints/git.js')>(
    '../../../../utils/checkpoints/git.js',
  )
  return {
    ...real,
    runCheckpointGit: vi.fn(async (args: string[], opts: unknown) => {
      // Force the tip-resolution rev-parse to report "no ref" so the snapshot
      // takes the fresh-start branch even though the ref exists on disk.
      if (
        INJECT.forceNoRef &&
        args[0] === 'rev-parse' &&
        args.includes('--verify') &&
        args.some(a => a.endsWith('^{commit}'))
      ) {
        return { ok: true, code: 128, stdout: '', stderr: '' } satisfies CheckpointGitResult
      }
      if (args[0] === 'update-ref' && args[1] !== '-d') {
        INJECT.updateRefArgs.push([...args])
      }
      return real.runCheckpointGit(
        args,
        opts as Parameters<typeof real.runCheckpointGit>[1],
      )
    }),
  }
})

import { runCheckpointGit } from '../../../../utils/checkpoints/git.js'
import { indexPath, projectHash, refName } from '../../../../utils/checkpoints/paths.js'
import { ensureStore } from '../../../../utils/checkpoints/store.js'
import { createSnapshotFromTree } from '../../../../utils/checkpoints/createSnapshot.js'
import { buildFixtureCommit } from './fixtures.js'

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
  tmpRoot = mkdtempSync(join(tmpdir(), 'axiomate-freshcas-'))
  process.env.AXIOMATE_CHECKPOINT_BASE = join(tmpRoot, 'cp')
  workTree = mkdtempSync(join(tmpRoot, 'wt-'))
  const r = await ensureStore()
  if (r.ok === false) throw new Error(`ensureStore failed: ${r.reason}`)
  storeDir = r.store
})

afterEach(() => {
  INJECT.forceNoRef = false
  INJECT.updateRefArgs = []
  rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('createSnapshot — fresh-start update-ref CAS', () => {
  test(
    'fresh-start writer loses CAS when ref already exists (no silent clobber)',
    async () => {
      const ref = refName(projectHash(workTree))
      const idx = indexPath(projectHash(workTree))

      // Real existing ref at commit C (a concurrent winner already landed).
      const winner = await buildFixtureCommit({
        store: storeDir,
        workTree,
        indexFile: idx,
        ref,
        files: { 'a.txt': 'winner' },
        subject: 'winner',
      })

      // Build a distinct non-empty tree for the losing writer.
      const blob = await runCheckpointGit(['hash-object', '-w', '--stdin'], {
        store: storeDir,
        workTree,
        input: 'loser',
      })
      expect(blob.ok).toBe(true)
      if (blob.ok === false) return
      const tree = await runCheckpointGit(['mktree'], {
        store: storeDir,
        workTree,
        input: `100644 blob ${blob.stdout.trim()}\tb.txt\n`,
      })
      expect(tree.ok).toBe(true)
      if (tree.ok === false) return

      // Force the fresh-start branch; the real CAS update-ref must reject it.
      INJECT.forceNoRef = true
      const r = await createSnapshotFromTree(workTree, tree.stdout.trim(), {
        messageId: 'loser',
        label: 'loser',
      })

      expect(r.ok).toBe(false)
      if (r.ok === false) expect(r.skipped).toBe('race')

      // Stop forcing the no-ref path so the verification rev-parse below
      // sees the real store state.
      INJECT.forceNoRef = false

      // The fresh-start update-ref was issued with the 4-arg empty-old-value
      // CAS form, not the unsafe 2-arg form.
      const freshUpdate = INJECT.updateRefArgs.find(
        a => a[1] === ref && a.length === 4 && a[3] === '',
      )
      expect(freshUpdate).toBeDefined()

      // Winner's commit survives untouched.
      const tip = await runCheckpointGit(['rev-parse', '--verify', `${ref}^{commit}`], {
        store: storeDir,
        workTree,
      })
      expect(tip.ok).toBe(true)
      if (tip.ok === true) expect(tip.stdout.trim()).toBe(winner)
    },
    GIT_TEST_TIMEOUT_MS,
  )
})
