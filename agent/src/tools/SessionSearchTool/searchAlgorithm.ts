/**
 * SessionSearchTool — top-level orchestrator (Stages 1+2+3+4).
 *
 * Composes the pure-function helpers (preFilter, scoring, snippet, streamScan)
 * into the full search pipeline. No LLM / no Tool wiring at this layer —
 * those live in SessionSearchTool.ts (Step 2).
 *
 * Algorithm:
 *   1. Stage 1 — mtime filter (cheap)
 *   2. For each surviving candidate (parallel):
 *      - Stage 2: tail-window metadata scan
 *      - Stage 3: full streaming body scan
 *   3. Stage 4: rank via scoring.scoreHit + snippet via snippet.pickWindow
 *   4. Sort desc by score, slice to limit
 *
 * Note: an "early-skip Stage 3 when Stage 2 satisfies limit*3" optimization
 * was considered (see plan Step 1b) but deferred. At axiomate's current
 * scale the body scan over 100 small files completes in <500ms, making the
 * complexity not worth it. Phase 2 may revisit if profiling shows pain.
 *
 * Plan: see C:\Users\kiro\.claude\plans\ai-agent-harness-enginneering-hermes-ag-lucky-cloud.md
 */
import { filterByMtime, scanMetadata } from './preFilter.js'
import { scoreHit } from './scoring.js'
import { pickWindow } from './snippet.js'
import { scanSessionForQuery } from './streamScan.js'
import type {
  MetadataMatch,
  SessionFileInfo,
  SessionSearchHit,
  SessionSearchInput,
} from './types.js'

const DAY_MS = 86_400_000
const DEFAULT_RECENT_DAYS = 30
const DEFAULT_LIMIT = 3
const MIN_LIMIT = 1
const MAX_LIMIT = 5
const SNIPPET_MAX_CHARS = 100_000

export interface RunSearchOpts {
  /** Project directory containing <sessionId>.jsonl files. */
  projectDir: string
  /**
   * Optional session ID to exclude. By default the current session IS
   * included — axiomate's compact loses original message text, so the
   * agent benefits from being able to recall its own pre-compact history
   * via this tool. (Differs from hermes which excludes current session.)
   */
  excludeSessionId?: string
  /** For deterministic recency math in tests. Defaults to Date.now(). */
  now?: number
}

interface CandidateScanResult {
  info: SessionFileInfo
  meta: MetadataMatch | null
  bodyText: string
  bodyMatchCount: number
}

async function scanCandidate(
  info: SessionFileInfo,
  query: string,
  roleFilter: SessionSearchInput['role_filter'],
): Promise<CandidateScanResult> {
  const meta = await scanMetadata(info.filePath, query)
  // Stream body and aggregate matched messages for snippet windowing
  const bodyTexts: string[] = []
  let matchCount = 0
  for await (const hit of scanSessionForQuery(info.filePath, {
    query,
    roleFilter,
  })) {
    bodyTexts.push(hit.text)
    matchCount += hit.matchPositions.length
  }
  return {
    info,
    meta,
    bodyText: bodyTexts.join('\n\n'),
    bodyMatchCount: matchCount,
  }
}

function buildHit(
  candidate: CandidateScanResult,
  query: string,
  now: number,
): SessionSearchHit | null {
  const { info, meta, bodyText, bodyMatchCount } = candidate

  // No match at any layer → skip
  if (!meta && bodyMatchCount === 0) return null

  const recencyDays = (now - info.mtime) / DAY_MS
  const score = scoreHit({
    termFreq: bodyMatchCount,
    contentLength: bodyText.length,
    metadataMatches: meta?.fields,
    recencyDays,
  })

  // Build snippet
  let snippet: string
  if (bodyMatchCount > 0) {
    const window = pickWindow(bodyText, query, SNIPPET_MAX_CHARS)
    snippet =
      (window.earlierTruncated ? '...[earlier conversation truncated]...\n' : '') +
      window.window +
      (window.laterTruncated ? '\n...[later conversation truncated]...' : '')
  } else {
    // Metadata-only hit — show the matched values
    snippet = Object.values(meta!.matchedValues).filter(Boolean).join(' · ')
  }

  return {
    sessionId: info.sessionId,
    filePath: info.filePath,
    mtime: info.mtime,
    snippet,
    score,
    matchCount: bodyMatchCount,
    metadataMatches: meta?.fields,
  }
}

/**
 * Full search pipeline. Returns top-N hits sorted by relevance descending.
 *
 * Empty / whitespace query returns []. Caller (Tool surface, Step 2)
 * should switch to "recent mode" — different code path that just calls
 * filterByMtime and returns metadata-only listings.
 */
export async function runSearch(
  input: SessionSearchInput,
  opts: RunSearchOpts,
): Promise<SessionSearchHit[]> {
  const query = input.query?.trim() ?? ''
  if (!query) return []

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(MIN_LIMIT, input.limit ?? DEFAULT_LIMIT),
  )
  const recentDays = input.recent_days ?? DEFAULT_RECENT_DAYS
  const now = opts.now ?? Date.now()

  // Stage 1: mtime filter
  let candidates = await filterByMtime(opts.projectDir, recentDays, now)
  if (opts.excludeSessionId) {
    candidates = candidates.filter(c => c.sessionId !== opts.excludeSessionId)
  }
  if (candidates.length === 0) return []

  // Stages 2+3 in parallel per candidate
  const scanned = await Promise.all(
    candidates.map(c => scanCandidate(c, query, input.role_filter)),
  )

  // Stage 4: rank + snippet
  const hits: SessionSearchHit[] = []
  for (const c of scanned) {
    const hit = buildHit(c, query, now)
    if (hit) hits.push(hit)
  }
  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, limit)
}
