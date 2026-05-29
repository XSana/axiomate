/**
 * SessionSearchTool — per-session summarizer (Stage 4 finalize).
 *
 * Takes a SessionSearchHit with body content (snippet) and asks a cheap aux
 * model to produce a focused recap. Bounded concurrency prevents flooding
 * the aux endpoint when many sessions match.
 *
 * Failures are graceful: a session whose summary fails returns the raw
 * snippet untouched. The hit array is never dropped, only enriched.
 *
 * Plan: see C:\Users\kiro\.claude\plans\ai-agent-harness-enginneering-hermes-ag-lucky-cloud.md
 */
import { sideQuery } from '../../services/api/capabilities/sideQuery.js'
import { getProviderForModel } from '../../services/api/providerRegistry.js'
import { logForDebugging } from '../../utils/debug.js'
import { getAuxiliaryTaskModel } from '../../utils/model/model.js'
import type { RecoveryTraceSink } from '../../services/api/recoveryTrace.js'
import { getSummaryPrompt } from './prompt.js'
import type { SessionSearchHit } from './types.js'

const DEFAULT_CONCURRENCY = 3
const MAX_TOKENS = 800
const TEMPERATURE = 0.1

export interface SummarizeOpts {
  query: string
  /** Override aux model resolution; mainly for tests. */
  modelOverride?: string
  /** Override max parallel summaries; default 3 (matches hermes). */
  concurrency?: number
  /** Optional abort signal propagated to each LLM call. */
  signal?: AbortSignal
  /** Optional structured API recovery diagnostics sink. */
  onRecoveryTrace?: RecoveryTraceSink
}

/**
 * Pick the model for per-session summarization from the semantic auxiliary
 * task policy. Legacy mid/fast/current fields are normalized by modelRouting.
 */
export function pickSummaryModel(): string {
  return getAuxiliaryTaskModel('sessionSearchSummary')
}

/** Run summarizer on one hit. Returns the hit with `summary` populated, or the hit unchanged on failure. */
export async function summarizeHit(
  hit: SessionSearchHit,
  opts: SummarizeOpts,
): Promise<SessionSearchHit> {
  if (!hit.snippet) return hit // nothing to summarize (metadata-only with empty snippet)

  const model = opts.modelOverride ?? pickSummaryModel()
  let provider
  try {
    provider = getProviderForModel(model)
  } catch (err) {
    logForDebugging(
      `SessionSearch summarize: provider resolution failed for model=${model}: ${err}`,
    )
    return hit
  }

  try {
    const response = await sideQuery(provider, {
      model,
      system: getSummaryPrompt(opts.query),
      messages: [
        {
          role: 'user',
          content: `EXCERPT:\n${hit.snippet}\n\nSummarize the excerpt with focus on: "${opts.query}"`,
        },
      ],
      maxTokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      signal: opts.signal,
      querySource: 'session_search',
      auxiliaryTask: 'sessionSearchSummary',
      onRecoveryTrace: opts.onRecoveryTrace,
    })

    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text' || !textBlock.text.trim()) {
      logForDebugging(
        `SessionSearch summarize: empty response for session ${hit.sessionId}`,
      )
      return hit
    }
    return { ...hit, summary: textBlock.text.trim() }
  } catch (err) {
    logForDebugging(
      `SessionSearch summarize: LLM call failed for session ${hit.sessionId}: ${err}`,
    )
    return hit
  }
}

/**
 * Bounded-concurrency parallel summarizer. Returns hits in the same order
 * as input, each with `summary` populated where the LLM call succeeded.
 * Failed summaries leave the hit unchanged (snippet preserved).
 */
export async function summarizeAll(
  hits: SessionSearchHit[],
  opts: SummarizeOpts,
): Promise<SessionSearchHit[]> {
  if (hits.length === 0) return hits
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY)
  const results: SessionSearchHit[] = new Array(hits.length)
  let cursor = 0

  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++
      if (idx >= hits.length) return
      results[idx] = await summarizeHit(hits[idx]!, opts)
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, hits.length) },
    () => worker(),
  )
  await Promise.all(workers)
  return results
}
