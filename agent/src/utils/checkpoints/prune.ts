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
import { writeFile } from 'fs/promises'
import { logForDebugging } from '../debug.js'
import { probeGitAvailable } from './git.js'
import { getLastPrunePath } from './paths.js'

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
 * Skeleton-only: passes 1/2/3 land in subsequent commits. The skeleton
 * locks the entry contract (marker check, git probe, fail-open shape)
 * and lets us exercise the integration site (Phase 4 commit 4) on a
 * no-op implementation first.
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

  // 3-5. Passes land in subsequent commits.
  const report: PruneReport = { skipped: false, gitMissing: false, ...EMPTY_REPORT }

  // 6. Touch marker on success. Hermes `maybe_auto_prune_checkpoints:1508`
  //    — written *only* if the prune body completed without throwing.
  //    Phase 4 fail-open contract means the body can collect errors into
  //    `report.errors[]` and still write the marker; we only suppress the
  //    write if execution itself broke (we never reach this line).
  await writeMarker(report)

  return report
}

/**
 * Returns true when the marker file exists and was written less than
 * `MIN_INTERVAL_HOURS` ago. Any read or parse failure → false (treat as
 * "no recent run"). Hermes `_validate_unix_time:1497` silently passes
 * through corrupt markers.
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
    return ageMs >= 0 && ageMs < minIntervalMs
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
