/**
 * Session-transcript scanner used by the 6C1 anchor-keep pass in
 * `pruneCheckpoints`. Walks recent JSONL transcripts under
 * `~/.axiomate/projects/<sanitized-workdir>/` and extracts the set of
 * `gitHash` values referenced by `file-history-snapshot` entries.
 *
 * Why a dedicated module instead of reusing `sessionStorage.loadTranscriptFile`:
 *
 *   1. Cost. `loadTranscriptFile` does pre-compact buffer skipping,
 *      content-replacement reconstruction, attribution-snapshot stripping,
 *      worktree-state replay, and a dozen other things prune doesn't need.
 *      Prune runs once per 24h in background housekeeping — pulling in
 *      that pipeline (and its transitive imports) per session is wasteful.
 *   2. Failure surface. `loadTranscriptFile` throws on a handful of corrupt
 *      transcript states. Prune's contract is fail-soft: every per-session
 *      error must surface as a `report.errors[]` entry, never a thrown
 *      exception. A purpose-built scanner that only pattern-matches
 *      `file-history-snapshot` lines keeps that contract trivially.
 *   3. Concurrency. The transcript file may be appended to by a live
 *      session while we read it. We don't care about partial-line
 *      tails — a corrupt last line is just skipped. Full-pipeline parse
 *      would surface that as a structured error.
 *
 * The on-disk shape we depend on is small and stable:
 *   `{ "type": "file-history-snapshot", "snapshot": { "gitHash": "<hex>", ... }, ... }`
 * One JSON object per line, append-only. See `sessionStorage.ts:947` for
 * the writer side and `sessionStorage.ts:3268` for the reader side.
 */

import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { getConfigHomeDir } from '../envUtils.js'
import { sanitizePath } from '../path.js'
import { validateCommitHash } from './validate.js'

/** Default window: anchor-keep refs persist for 28 days. */
export const DEFAULT_KEEP_WINDOW_DAYS = 28

/** Cap on session JSONLs scanned per project per prune cycle. */
export const SESSION_SCAN_CAP = 50

/** Bytes read per JSONL — defends against an unbounded malicious transcript. */
const MAX_JSONL_BYTES = 32 * 1024 * 1024

export interface SessionScanCandidate {
  /** Session UUID derived from the JSONL filename (without `.jsonl` suffix). */
  sessionId: string
  /** Absolute path to the JSONL transcript. */
  jsonlPath: string
  /** Mtime in epoch seconds. */
  mtimeSec: number
}

/**
 * Resolve `~/.axiomate/projects/<sanitized-workdir>/` and list candidate
 * session JSONLs whose mtime falls within `windowDays`.
 *
 * Returns at most `SESSION_SCAN_CAP` entries, ranked most-recent-first.
 * Missing directory is not an error — returns `[]`. Errors during
 * `readdir` or `stat` are swallowed; the caller works with what we found.
 */
export async function listRecentSessionsForWorkdir(
  workdir: string,
  opts?: { windowDays?: number; nowSec?: number },
): Promise<SessionScanCandidate[]> {
  const windowDays = opts?.windowDays ?? DEFAULT_KEEP_WINDOW_DAYS
  const nowSec = opts?.nowSec ?? Math.floor(Date.now() / 1000)
  const cutoffSec = nowSec - windowDays * 86400
  const sessionDir = join(getConfigHomeDir(), 'projects', sanitizePath(workdir))

  let names: string[]
  try {
    names = await readdir(sessionDir)
  } catch {
    return []
  }

  const candidates: SessionScanCandidate[] = []
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue
    const sessionId = name.slice(0, -'.jsonl'.length)
    if (sessionId.length === 0) continue
    const jsonlPath = join(sessionDir, name)
    let mtimeSec: number
    try {
      const st = await stat(jsonlPath)
      if (!st.isFile()) continue
      mtimeSec = Math.floor(st.mtimeMs / 1000)
    } catch {
      continue
    }
    if (mtimeSec < cutoffSec) continue
    candidates.push({ sessionId, jsonlPath, mtimeSec })
  }

  candidates.sort((a, b) => b.mtimeSec - a.mtimeSec)
  return candidates.slice(0, SESSION_SCAN_CAP)
}

/**
 * Read a JSONL transcript and return the set of distinct `gitHash` values
 * referenced by `file-history-snapshot` entries.
 *
 * Hashes are validated through `validateCommitHash` before being yielded —
 * a corrupt or injection-shaped value (e.g. starts with `-`) is silently
 * skipped, never returned. This is the same contract the live writer
 * enforces; we mirror it to defend against future changes to the writer.
 *
 * The reader is line-oriented and best-effort: a single malformed line
 * doesn't fail the whole scan; we just skip it. A truncated final line
 * (writer was mid-append) likewise gets dropped. This trades exhaustive
 * coverage for not blocking prune on any single corrupt session.
 *
 * **Partial-scan signal.** A *newline-terminated* snapshot-shaped line that
 * fails to parse is real mid-file corruption, not a benign live-append tail.
 * We can't be sure we extracted every hash this session referenced, so we
 * set `partial: true`. The anchor-keep pass treats a partial scan as
 * "uncertain": if it didn't independently find an anchor-worthy hash it
 * must NOT let the project ref be dropped on the strength of this scan.
 * A truncated FINAL line (no trailing newline → writer mid-append) does
 * NOT set `partial` — that case is expected and harmless.
 *
 * Bounds: file is read all-at-once into memory but capped at
 * `MAX_JSONL_BYTES`. Transcripts above the cap are skipped entirely
 * (returns empty set + the path appearing in `errors`).
 */
export async function extractGitHashes(jsonlPath: string): Promise<{
  hashes: Set<string>
  error: string | null
  /** True when a complete (newline-terminated) snapshot line failed to parse. */
  partial: boolean
}> {
  let buf: Buffer
  try {
    const st = await stat(jsonlPath)
    if (st.size > MAX_JSONL_BYTES) {
      return {
        hashes: new Set(),
        error: `transcript exceeds ${MAX_JSONL_BYTES} bytes; skipped`,
        partial: false,
      }
    }
    buf = await readFile(jsonlPath)
  } catch (err) {
    return { hashes: new Set(), error: (err as Error).message, partial: false }
  }

  const hashes = new Set<string>()
  let partial = false
  // Cheap pre-filter: every line we care about contains the string
  // `"type":"file-history-snapshot"` (no whitespace — the writer at
  // `sessionStorage.ts:947` uses JSON.stringify which is whitespace-free).
  // This avoids JSON.parse on the 95%+ of lines that are tool calls,
  // text blocks, etc.
  const text = buf.toString('utf-8')
  let start = 0
  while (start < text.length) {
    const nl = text.indexOf('\n', start)
    const end = nl < 0 ? text.length : nl
    const isTerminated = nl >= 0
    const line = text.slice(start, end)
    start = end + 1
    if (line.length === 0) continue
    if (!line.includes('"file-history-snapshot"')) continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      // A snapshot-shaped line that won't parse: corruption if the line is
      // complete (newline-terminated), benign truncation if it's the final
      // unterminated line the writer is mid-append on.
      if (isTerminated) partial = true
      continue
    }
    if (!isFileHistorySnapshotLine(entry)) continue
    const gitHash = entry.snapshot.gitHash
    if (validateCommitHash(gitHash) !== null) continue
    hashes.add(gitHash)
  }
  return { hashes, error: null, partial }
}

function isFileHistorySnapshotLine(value: unknown): value is {
  type: 'file-history-snapshot'
  snapshot: { gitHash: string }
} {
  if (typeof value !== 'object' || value === null) return false
  const o = value as Record<string, unknown>
  if (o.type !== 'file-history-snapshot') return false
  const snap = o.snapshot
  if (typeof snap !== 'object' || snap === null) return false
  const s = snap as Record<string, unknown>
  return typeof s.gitHash === 'string'
}
