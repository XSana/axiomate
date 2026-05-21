/**
 * `pruneCheckpoints` — auto-maintenance for the shadow-git store.
 *
 * Runs three passes against `~/.axiomate/checkpoints/store/`:
 *   1. Orphan — drop refs whose project workdir no longer exists on disk.
 *   2. Stale  — drop refs whose `last_touch` is older than `retentionDays`.
 *   3. Size   — while total store size exceeds `maxTotalSizeMb`, drop the
 *               oldest commit per ref (round-robin) until under cap or no
 *               progress made in a full round.
 *
 * Followed (or interleaved) by `git reflog expire --expire=now --all` +
 * `git gc --prune=now --quiet` (3× timeout). gc runs unconditionally
 * after pass 1+2 and at the end of pass 3 — Hermes 1375-1382 / 1446-1452.
 *
 * Triggered async from `backgroundHousekeeping.ts:runVerySlowOps()` once
 * the user has been idle ≥1 minute and ≥10 minutes after boot. `bareMode`
 * (`--print` and similar) skips the whole housekeeping stack, so prune
 * never runs in non-interactive sessions.
 *
 * Idempotency throttle: writes `~/.axiomate/checkpoints/.last_prune` on
 * success. Subsequent calls within `MIN_INTERVAL_HOURS` short-circuit
 * unless `forceNow=true`. Hermes `maybe_auto_prune_checkpoints:1462-1525`.
 *
 * Fail-open contract: never throws. Per-step failures collect into
 * `report.errors[]`; the caller (`runVerySlowOps`) ignores the report
 * and just lets the next housekeeping cycle retry.
 */

import { existsSync, statSync } from 'fs'
import { readdir, readFile, stat, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { logForDebugging } from '../debug.js'
import {
  DEFAULT_CHECKPOINT_GIT_TIMEOUT_MS,
  probeGitAvailable,
  runCheckpointGit,
} from './git.js'
import {
  getLastPrunePath,
  getStoreDir,
  indexPath,
  projectMetaPath,
  refName,
} from './paths.js'

/**
 * Default retention for stale-pass (days). 14d is a deliberate divergence
 * from Hermes' 7d — Axiomate sessions tend to span longer dogfood arcs and
 * losing rewindability after a week is a sharp UX regression. Re-evaluate
 * after dogfood data lands.
 */
export const DEFAULT_RETENTION_DAYS = 14

/**
 * Default cross-project size cap (MB). Mirrors Hermes' typical operator
 * default; bounded by the per-project ring buffer (MAX_SNAPSHOTS=100) so
 * the cap rarely triggers in normal use.
 */
export const DEFAULT_MAX_TOTAL_SIZE_MB = 500

/**
 * Minimum interval between auto-prune runs. 24h matches Hermes
 * `maybe_auto_prune_checkpoints` default and is the throttle that keeps
 * the maintenance hook cheap on every boot.
 */
export const MIN_INTERVAL_HOURS = 24

export interface PruneOptions {
  /** Override default 14-day retention. Use `0` to disable stale pass. */
  retentionDays?: number
  /** Override default 500 MB cap. Use `0` to disable size pass. */
  maxTotalSizeMb?: number
  /** Bypass the `.last_prune` 24h marker. */
  forceNow?: boolean
}

export interface PruneReport {
  /** True when the marker said "ran recently" and the whole pass was a no-op. */
  skipped: boolean
  /** True when git is unavailable on this host. */
  gitMissing: boolean
  /** Refs deleted because their workdir vanished. */
  orphanRefsRemoved: number
  /** Refs deleted because last_touch was outside the retention window. */
  staleRefsRemoved: number
  /** Refs whose oldest commit was dropped at least once during size cap. */
  sizeCapRefsTouched: number
  /** Total commits dropped across all refs during size cap. */
  sizeCapCommitsDropped: number
  /**
   * 0/1/2 — intermediate gc runs unless we short-circuit on entry; final gc
   * runs only when `maxTotalSizeMb > 0`. Both are unconditional within their
   * branches (Hermes parity).
   */
  gcInvocations: number
  /** Bytes freed (storeBytesBefore − storeBytesAfter). May be 0 or negative on a noisy fs. */
  bytesFreed: number
  /** Per-step errors. Never throws; everything that goes wrong lands here. */
  errors: string[]
}

const EMPTY_REPORT: Omit<PruneReport, 'skipped' | 'gitMissing'> = {
  orphanRefsRemoved: 0,
  staleRefsRemoved: 0,
  sizeCapRefsTouched: 0,
  sizeCapCommitsDropped: 0,
  gcInvocations: 0,
  bytesFreed: 0,
  errors: [],
}

/**
 * Run the full prune cycle. Returns a structured report — never throws.
 *
 * Commit 2 of 5: passes 1+2 (orphan + stale) + unconditional intermediate
 * gc are live. Commit 3 will add pass 3 (size cap) + final gc.
 */
export async function pruneCheckpoints(
  opts: PruneOptions = {},
): Promise<PruneReport> {
  // 1. Soft-disable when git is missing. Same pattern as createSnapshot.
  if (!(await probeGitAvailable())) {
    return { skipped: false, gitMissing: true, ...EMPTY_REPORT }
  }

  // 2. 24h idempotency marker. Hermes `maybe_auto_prune_checkpoints:1488`
  //    — read the marker, compare to now, short-circuit if too recent.
  //    Corrupt or unreadable markers are treated as "no prior run" (Hermes
  //    line 1497 swallows the parse error silently). forceNow bypasses.
  if (!opts.forceNow && isMarkerRecent()) {
    return { skipped: true, gitMissing: false, ...EMPTY_REPORT }
  }

  const retentionDays = opts.retentionDays ?? DEFAULT_RETENTION_DAYS
  const report: PruneReport = {
    skipped: false,
    gitMissing: false,
    ...EMPTY_REPORT,
    errors: [],
  }
  const store = getStoreDir()

  // 3. Pass 1 — orphan: workdir gone from disk → drop ref + index + meta.
  // 4. Pass 2 — stale:  last_touch outside retention window → drop too.
  //    Both passes share `loadProjectMetas` and `dropProjectRef` so the
  //    file IO + ref delete sequence is identical between them. Hermes
  //    `prune_checkpoints` interleaves them in one loop (lines 1255-1370);
  //    we split for clarity since the report fields are separate counts.
  const metas = await loadProjectMetas(report)
  const cutoffSec = retentionDays > 0
    ? Math.floor(Date.now() / 1000) - retentionDays * 86400
    : null

  for (const meta of metas) {
    // Orphan check first — wins over stale if both apply (Hermes 1289-1298).
    const exists = await directoryExists(meta.workdir)
    if (!exists) {
      const dropped = await dropProjectRef(store, meta, report)
      if (dropped) report.orphanRefsRemoved++
      continue
    }
    if (cutoffSec !== null && meta.last_touch < cutoffSec) {
      const dropped = await dropProjectRef(store, meta, report)
      if (dropped) report.staleRefsRemoved++
    }
  }

  // 5. Intermediate gc — reflog expire + gc --prune=now. Runs unconditionally
  //    (Hermes 1375-1382). The `reflog expire --all` step makes commits
  //    unreachable so `gc --prune=now` can actually free objects.
  const gcOk = await runReflogExpireAndGc(store, report)
  if (gcOk) report.gcInvocations++

  // 6. Pass 3 — size cap + final gc land in commit 3.

  // 7. Touch marker on success. Hermes `maybe_auto_prune_checkpoints:1508`.
  await writeMarker(report)

  return report
}

interface ProjectMeta {
  hash: string
  workdir: string
  created_at: number
  last_touch: number
}

/**
 * Read every `projects/<hash16>.json`. Corrupt or unreadable files are
 * pushed into `report.errors` and skipped — never throw, never lose
 * other projects to one bad file. Mirrors Hermes `_load_projects:1233-1252`.
 */
async function loadProjectMetas(report: PruneReport): Promise<ProjectMeta[]> {
  const projectsDir = join(getStoreDir(), 'projects')
  let entries: string[]
  try {
    entries = await readdir(projectsDir)
  } catch (err) {
    // Missing projects/ dir means no snapshots ever taken — not an error.
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      report.errors.push(`readdir projects: ${(err as Error).message}`)
    }
    return []
  }

  const metas: ProjectMeta[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const hash = entry.slice(0, -'.json'.length)
    if (hash.length !== 16) continue // Defensive — projectHash is fixed-width.
    const path = join(projectsDir, entry)
    try {
      const raw = await readFile(path, 'utf-8')
      const obj = JSON.parse(raw) as Partial<ProjectMeta>
      if (
        typeof obj.workdir === 'string' &&
        typeof obj.created_at === 'number' &&
        typeof obj.last_touch === 'number'
      ) {
        metas.push({
          hash,
          workdir: obj.workdir,
          created_at: obj.created_at,
          last_touch: obj.last_touch,
        })
      } else {
        report.errors.push(`malformed meta: ${entry}`)
      }
    } catch (err) {
      report.errors.push(`read meta ${entry}: ${(err as Error).message}`)
    }
  }
  return metas
}

/** True if the path exists on disk and is a directory. */
async function directoryExists(path: string): Promise<boolean> {
  try {
    const st = await stat(path)
    return st.isDirectory()
  } catch {
    return false
  }
}

/**
 * Delete the ref, the index file, and the project meta for `hash`.
 * Steps are best-effort and order-independent — failure of one step
 * still tries the others. Returns true if the ref delete succeeded
 * (the load-bearing step; without it the snapshots remain reachable).
 *
 * Mirrors Hermes `_drop_project_ref` (1311-1340) — same step set,
 * same fail-soft semantics, errors collected rather than raised.
 */
async function dropProjectRef(
  store: string,
  meta: ProjectMeta,
  report: PruneReport,
): Promise<boolean> {
  const ref = refName(meta.hash)

  // 1. Delete the ref. We use the store as workTree because the
  //    project workdir may already be gone (orphan case). update-ref -d
  //    doesn't read the worktree; it only needs GIT_DIR.
  const del = await runCheckpointGit(['update-ref', '-d', ref], {
    store,
    workTree: store,
  })
  if (del.ok === false) {
    report.errors.push(`update-ref -d ${ref}: ${del.message}`)
    return false
  }

  // 2. Delete the per-project index file. Best-effort.
  await safeUnlink(indexPath(meta.hash), report)

  // 3. Delete the project meta. Best-effort.
  await safeUnlink(projectMetaPath(meta.hash), report)

  return true
}

async function safeUnlink(path: string, report: PruneReport): Promise<void> {
  try {
    await unlink(path)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return // Already gone — fine.
    report.errors.push(`unlink ${path}: ${(err as Error).message}`)
  }
}

/**
 * `git reflog expire --expire=now --all` + `git gc --prune=now --quiet`.
 * Both run with 3× the default checkpoint git timeout — Hermes 1378
 * uses a similar long-timeout pattern.
 *
 * Returns true if both commands succeeded. On failure of either,
 * collects the error and returns false (gc invocation does not count
 * toward `report.gcInvocations`).
 */
async function runReflogExpireAndGc(
  store: string,
  report: PruneReport,
): Promise<boolean> {
  const longTimeout = DEFAULT_CHECKPOINT_GIT_TIMEOUT_MS * 3

  const reflog = await runCheckpointGit(
    ['reflog', 'expire', '--expire=now', '--all'],
    { store, workTree: store, timeoutMs: longTimeout },
  )
  if (reflog.ok === false) {
    report.errors.push(`reflog expire: ${reflog.message}`)
    return false
  }

  const gc = await runCheckpointGit(
    ['gc', '--prune=now', '--quiet'],
    { store, workTree: store, timeoutMs: longTimeout },
  )
  if (gc.ok === false) {
    report.errors.push(`gc: ${gc.message}`)
    return false
  }
  return true
}

/**
 * Returns true when the marker file exists and was written less than
 * `MIN_INTERVAL_HOURS` ago. Any read or parse failure → false (treat as
 * "no recent run"). Hermes `_validate_unix_time:1497` silently passes
 * through corrupt markers.
 *
 * Future-dated markers (Windows clock-granularity skew, user clock jumps)
 * are treated as recent — the safe direction is "wait for the marker to
 * age out" rather than "run prune immediately on a wonky clock".
 */
function isMarkerRecent(): boolean {
  const path = getLastPrunePath()
  if (!existsSync(path)) return false
  try {
    // Use mtime rather than file content. The marker's content has been
    // a unix timestamp string in Hermes, but mtime is what `_validate_unix_time`
    // ultimately ends up reading after parsing the body — we save a parse
    // step. Both axes (mtime + content-stamp) tell the same story.
    const st = statSync(path)
    const ageMs = Date.now() - st.mtimeMs
    const minIntervalMs = MIN_INTERVAL_HOURS * 60 * 60 * 1000
    return ageMs < minIntervalMs
  } catch {
    return false
  }
}

/**
 * Write the marker. Body is a unix-ms timestamp for human inspection;
 * `isMarkerRecent` reads mtime, not the body.
 */
async function writeMarker(report: PruneReport): Promise<void> {
  try {
    await writeFile(getLastPrunePath(), String(Date.now()), 'utf-8')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logForDebugging(`pruneCheckpoints: marker write failed: ${msg}`)
    report.errors.push(`marker write: ${msg}`)
  }
}
