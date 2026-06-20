import { lstat, mkdtemp, rm, rmdir, unlink } from 'fs/promises'
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'path'
import { prepareSnapshotTree, MAX_FILE_SIZE_MB } from './createSnapshot.js'
import { dropOversizeFromIndex } from './dropOversizeFromIndex.js'
import { runCheckpointGit } from './git.js'
import { stageWorktreeSnapshotIndex } from './snapshotIndex.js'
import { logForDebugging } from '../debug.js'
import { isENOENT } from '../errors.js'
import { logError } from '../log.js'
import { expandPath } from '../path.js'
import {
  readNulPathspecFile,
  streamGitPathspecFromDiff,
} from '../fileHistoryRewindPathspec.js'
import {
  getRewindTempRoot,
  REWIND_TEMP_PREFIX,
  writeRewindTempOwnerFile,
} from './rewindTempCleanup.js'

const DIFF_HAS_CHANGES = new Set([0, 1])

/**
 * Argv-safety bounds for the positional-pathspec touched-path verify.
 * Mirror the staging batcher (snapshotIndex.ts) — Windows caps a command
 * line near 32 KB, so keep batches well under that.
 */
const MAX_DIFF_PATHSPEC_BATCH = 256
const MAX_DIFF_PATHSPEC_BYTES = 24_000

type WorktreeReconcileTestHooks = {
  cleanup?: (plan: WorktreeReconcilePlan) => void | Promise<void>
}

let worktreeReconcileTestHooks: WorktreeReconcileTestHooks | undefined

export function _setWorktreeReconcileTestHooksForTesting(
  hooks: WorktreeReconcileTestHooks | undefined,
): void {
  worktreeReconcileTestHooks = hooks
}

type WorktreeReconcilePlanLifecycle =
  | 'prepared'
  | 'applying'
  | 'applied'
  | 'failed'
  | 'cleaned'

export type WorktreeReconcilePlan = {
  store: string
  workdir: string
  /** Per-rewind scratch index used by restore/verify git commands. */
  indexFile: string
  targetHash: string
  currentTree: string
  tempDir: string
  checkoutPathspecFile: string
  deletePathspecFile: string
  checkoutCount: number
  deleteCount: number
  touchedCount: number
  /**
   * Runtime guard for the plan's private temp files and scratch index.
   * A plan belongs to one rewind transaction and must not be applied
   * again after it has been consumed or cleaned.
   */
  lifecycleState: WorktreeReconcilePlanLifecycle
}

export async function prepareWorktreeReconcilePlan(
  workdir: string,
  targetHash: string,
): Promise<WorktreeReconcilePlan> {
  const tempDir = await mkdtemp(join(getRewindTempRoot(), REWIND_TEMP_PREFIX))
  try {
    await writeRewindTempOwnerFile(tempDir).catch(error => {
      const detail = error instanceof Error ? error.message : String(error)
      logForDebugging(
        `WorktreeReconcile: owner marker write failed for ${tempDir}: ${detail}`,
      )
    })
    const reconcileIndexFile = join(tempDir, 'reconcile.index')
    const prepared = await prepareSnapshotTree(expandPath(workdir), {
      indexFile: reconcileIndexFile,
    })
    if (prepared.ok === false) {
      if (prepared.skipped === 'too-many-files') {
        throw new Error('too-many-files')
      }
      throw new Error(prepared.message ?? prepared.skipped)
    }

    const checkoutPathspecFile = join(tempDir, 'checkout-paths.nul')
    const deletePathspecFile = join(tempDir, 'delete-paths.nul')
    const deleteCount = await writePathspecFromDiff({
      store: prepared.store,
      workdir: prepared.canonical,
      indexFile: prepared.indexFile,
      args: [
        'diff',
        '--name-only',
        '--no-renames',
        '-z',
        '--diff-filter=A',
        targetHash,
        prepared.treeHash,
      ],
      pathspecFile: deletePathspecFile,
    })
    const checkoutCount = await writePathspecFromDiff({
      store: prepared.store,
      workdir: prepared.canonical,
      indexFile: prepared.indexFile,
      args: [
        'diff',
        '--name-only',
        '--no-renames',
        '-z',
        '--diff-filter=AMT',
        prepared.treeHash,
        targetHash,
      ],
      pathspecFile: checkoutPathspecFile,
    })

    return {
      store: prepared.store,
      workdir: prepared.canonical,
      indexFile: reconcileIndexFile,
      targetHash,
      currentTree: prepared.treeHash,
      tempDir,
      checkoutPathspecFile,
      deletePathspecFile,
      checkoutCount,
      deleteCount,
      touchedCount: checkoutCount + deleteCount,
      lifecycleState: 'prepared',
    }
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

async function writePathspecFromDiff(args: {
  store: string
  workdir: string
  indexFile: string
  args: string[]
  pathspecFile: string
}): Promise<number> {
  const diff = await streamGitPathspecFromDiff({
    store: args.store,
    workTree: args.workdir,
    indexFile: args.indexFile,
    gitArgs: args.args,
    pathspecFile: args.pathspecFile,
  })
  if (diff.ok === false) throw new Error(`diff: ${diff.message}`)
  return diff.count
}

export async function applyWorktreeReconcilePlan(
  plan: WorktreeReconcilePlan,
): Promise<void> {
  assertPlanLifecycle(plan, 'apply', ['prepared'])
  plan.lifecycleState = 'applying'
  logForDebugging(
    `WorktreeReconcile: path apply delete=${plan.deleteCount} checkout=${plan.checkoutCount}`,
  )
  try {
    if (plan.checkoutCount > 0) {
      await removeCheckoutConflicts(plan)
      const checkout = await runCheckpointGit(
        [
          'restore',
          `--source=${plan.targetHash}`,
          `--pathspec-from-file=${plan.checkoutPathspecFile}`,
          '--pathspec-file-nul',
        ],
        {
          store: plan.store,
          workTree: plan.workdir,
          indexFile: plan.indexFile,
          timeoutMs: 60_000,
        },
      )
      if (checkout.ok === false) {
        throw new Error(`checkout: ${checkout.message}`)
      }
    }

    await deletePathspecPaths(plan)
    plan.lifecycleState = 'applied'
  } catch (error) {
    plan.lifecycleState = 'failed'
    throw error
  }
}

async function removeCheckoutConflicts(plan: WorktreeReconcilePlan): Promise<void> {
  for await (const rel of readNulPathspecFile(plan.checkoutPathspecFile)) {
    const abs = resolveGitRelativePathForReconcile(plan.workdir, rel)
    // Only clear type conflicts that would make `git checkout <target> -- path`
    // fail: a target file path currently occupied by a directory, or a target
    // descendant whose parent is currently a file. Current-only files are
    // deleted later, after checkout succeeds.
    await removeFileAncestors(abs, plan.workdir)
    try {
      const stat = await lstat(abs)
      if (stat.isDirectory()) await rm(abs, { recursive: true, force: true })
    } catch (err: unknown) {
      if (!isENOENT(err)) logError(err)
    }
  }
}

async function removeFileAncestors(abs: string, root: string): Promise<void> {
  const normalizedRoot = canonicalPathKey(root)
  let current = dirname(abs)
  while (isPathInsideRoot(current, normalizedRoot)) {
    try {
      const stat = await lstat(current)
      if (stat.isFile()) {
        await unlink(current)
        return
      }
    } catch (err: unknown) {
      if (!isENOENT(err)) logError(err)
      return
    }
    current = dirname(current)
  }
}

async function deletePathspecPaths(plan: WorktreeReconcilePlan): Promise<void> {
  if (plan.deleteCount === 0) return
  for await (const rel of readNulPathspecFile(plan.deletePathspecFile)) {
    const abs = resolveGitRelativePathForReconcile(plan.workdir, rel)
    try {
      await unlink(abs)
      await removeEmptyParents(dirname(abs), plan.workdir)
      logForDebugging(`WorktreeReconcile: Deleted ${abs}`)
    } catch (err: unknown) {
      if (!isENOENT(err)) logError(err)
    }
  }
}

export function resolveGitRelativePathForReconcile(workdir: string, rel: string): string {
  if (rel.length === 0) throw new Error('empty pathspec record')
  if (rel.includes('\0')) throw new Error('pathspec record contains null byte')
  if (isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) {
    throw new Error(`unsafe absolute pathspec record: ${rel}`)
  }
  const normalizedWorkdir = normalize(resolve(expandPath(workdir)))
  const abs = resolve(normalizedWorkdir, rel)
  if (!isPathInsideRoot(abs, canonicalPathKey(normalizedWorkdir))) {
    throw new Error(`unsafe pathspec record outside worktree: ${rel}`)
  }
  return abs
}

function canonicalPathKey(path: string): string {
  const normalized = normalize(resolve(path))
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function isPathInsideRoot(path: string, root: string): boolean {
  const relFromRoot = relative(root, canonicalPathKey(path))
  return (
    relFromRoot.length > 0 &&
    !relFromRoot.startsWith('..') &&
    !isAbsolute(relFromRoot)
  )
}

async function removeEmptyParents(dir: string, root: string): Promise<void> {
  const normalizedRoot = canonicalPathKey(root)
  let current = dir
  while (isPathInsideRoot(current, normalizedRoot)) {
    try {
      await rmdir(current)
    } catch {
      return
    }
    current = dirname(current)
  }
}

/**
 * Outcome of a post-apply verification step.
 *   - `'ok'`           — verified: disk matches the target for this scope.
 *   - `'mismatch'`     — confident NO: disk does NOT match. Caller must fail
 *                        the rewind (today's throw path).
 *   - `'inconclusive'` — the verification itself could not run (git/stage
 *                        error). We neither confirm nor deny the match.
 *                        Previously collapsed into `'ok'` (silent false pass);
 *                        callers now surface this as "applied but unverified".
 */
export type WorktreeReconcileVerifyResult = 'ok' | 'mismatch' | 'inconclusive'

export async function verifyWorktreeReconcileTouchedPaths(
  plan: WorktreeReconcilePlan,
): Promise<WorktreeReconcileVerifyResult> {
  assertPlanLifecycle(plan, 'verify touched paths', ['prepared', 'applied'])
  if (plan.touchedCount === 0) return 'ok'
  // Two gotchas this code threads:
  //  1. `git diff` does NOT support `--pathspec-from-file` (exits 129). An
  //     earlier version passed that flag and the failure was swallowed by a
  //     `return true`, so this targeted check never actually ran.
  //  2. `apply` restores files into the WORKING TREE only, and type swaps
  //     (file↔directory) can't be reconciled into the index with a targeted
  //     `update-index` on explicit paths. The only mechanism that stages disk
  //     correctly in all cases — untracked restores, deletions, and type
  //     swaps — is the full snapshot scanner.
  // So: stage the whole worktree the same way the full-tree verify does
  // (correct for every case), then scope the *diff* to the touched pathspecs.
  // This keeps the two-stage design (a targeted check distinct from the
  // whole-tree check) while being correct. The subsequent full-tree verify
  // re-stages, so mutating the scratch index here is safe.
  const stage = await stageWorktreeSnapshotIndex({
    store: plan.store,
    workTree: plan.workdir,
    indexFile: plan.indexFile,
  })
  if (stage.ok === false) {
    logForDebugging(
      `WorktreeReconcile: touched-path verification stage failed ` +
        `(${stage.message}); treating as inconclusive`,
    )
    return 'inconclusive'
  }
  await dropOversizeFromIndex({
    store: plan.store,
    workTree: plan.workdir,
    indexFile: plan.indexFile,
    maxFileSizeMb: MAX_FILE_SIZE_MB,
  })

  const files = [
    [plan.checkoutPathspecFile, plan.checkoutCount] as const,
    [plan.deletePathspecFile, plan.deleteCount] as const,
  ]
  let sawInconclusive = false
  for (const [pathspecFile, count] of files) {
    if (count === 0) continue
    for await (const batch of batchPathspecRecords(pathspecFile)) {
      const diff = await runCheckpointGit(
        ['diff', '--cached', '--quiet', plan.targetHash, '--', ...batch],
        {
          store: plan.store,
          workTree: plan.workdir,
          indexFile: plan.indexFile,
          allowedExitCodes: DIFF_HAS_CHANGES,
        },
      )
      if (diff.ok === false) {
        logForDebugging(
          `WorktreeReconcile: touched-path verification diff failed ` +
            `(${diff.message}); treating as inconclusive`,
        )
        // Keep checking other batches — a confident mismatch elsewhere
        // should still win over inconclusive.
        sawInconclusive = true
        continue
      }
      if (diff.code === 1) return 'mismatch'
    }
  }
  return sawInconclusive ? 'inconclusive' : 'ok'
}

/**
 * Yield batches of pathspec records from a NUL-delimited file, bounded by
 * both record count and total byte length so a `git diff -- <paths...>`
 * invocation can't exceed the OS argv cap (Windows ~32 KB).
 */
async function* batchPathspecRecords(
  pathspecFile: string,
): AsyncGenerator<string[]> {
  let batch: string[] = []
  let bytes = 0
  for await (const rel of readNulPathspecFile(pathspecFile)) {
    const recBytes = Buffer.byteLength(rel, 'utf-8') + 1
    if (
      batch.length > 0 &&
      (batch.length >= MAX_DIFF_PATHSPEC_BATCH ||
        bytes + recBytes > MAX_DIFF_PATHSPEC_BYTES)
    ) {
      yield batch
      batch = []
      bytes = 0
    }
    batch.push(rel)
    bytes += recBytes
  }
  if (batch.length > 0) yield batch
}

export async function verifyWorktreeReconcileFullTree(
  plan: WorktreeReconcilePlan,
): Promise<WorktreeReconcileVerifyResult> {
  assertPlanLifecycle(plan, 'verify full tree', ['prepared', 'applied'])
  const stage = await stageWorktreeSnapshotIndex({
    store: plan.store,
    workTree: plan.workdir,
    indexFile: plan.indexFile,
  })
  if (stage.ok === false) {
    logForDebugging(
      `WorktreeReconcile: final full-tree verification stage failed (${stage.message}); treating as inconclusive`,
    )
    return 'inconclusive'
  }

  await dropOversizeFromIndex({
    store: plan.store,
    workTree: plan.workdir,
    indexFile: plan.indexFile,
    maxFileSizeMb: MAX_FILE_SIZE_MB,
  })

  const diff = await runCheckpointGit(
    ['diff', '--cached', '--quiet', plan.targetHash, '--'],
    {
      store: plan.store,
      workTree: plan.workdir,
      indexFile: plan.indexFile,
      allowedExitCodes: DIFF_HAS_CHANGES,
    },
  )
  if (diff.ok === false) {
    logForDebugging(
      `WorktreeReconcile: final full-tree verification diff failed (${diff.message}); treating as inconclusive`,
    )
    return 'inconclusive'
  }
  return diff.code === 0 ? 'ok' : 'mismatch'
}

export async function cleanupWorktreeReconcilePlan(
  plan: WorktreeReconcilePlan,
): Promise<void> {
  if (plan.lifecycleState === 'cleaned') return
  assertPlanLifecycle(plan, 'cleanup', ['prepared', 'applied', 'failed'])
  plan.lifecycleState = 'cleaned'
  try {
    await worktreeReconcileTestHooks?.cleanup?.(plan)
    await rm(plan.tempDir, { recursive: true, force: true })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    logForDebugging(
      `WorktreeReconcile: cleanup failed for ${plan.tempDir}: ${detail}`,
    )
  }
}

function assertPlanLifecycle(
  plan: WorktreeReconcilePlan,
  operation: string,
  allowed: readonly WorktreeReconcilePlanLifecycle[],
): void {
  if (allowed.includes(plan.lifecycleState)) return
  throw new Error(
    `WorktreeReconcilePlan cannot ${operation} from ${plan.lifecycleState} state`,
  )
}
