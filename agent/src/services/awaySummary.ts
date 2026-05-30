import { getEmptyToolPermissionContext } from '../Tool.js'
import type { Message } from '../types/message.js'
import { logForDebugging } from '../utils/debug.js'
import { isAbortError } from '../utils/errors.js'
import { isEnvTruthy } from '../utils/envUtils.js'
import {
  createUserMessage,
  getAssistantMessageText,
} from '../utils/messages.js'
import { getInitialSettings } from '../utils/settings/settings.js'
import { asSystemPrompt } from '../utils/systemPromptType.js'
import {
  auxiliaryAttemptQueryOptions,
  auxiliaryFailureAssistantMessage,
  runAuxiliaryTask,
} from './api/auxiliaryTaskRunner.js'
import { queryModelWithoutStreaming } from './api/llm.js'
import { getSessionMemoryContent } from './SessionMemory/sessionMemoryUtils.js'

// Recap only needs recent context — truncate to avoid "prompt too long" on
// large sessions. 30 messages ≈ ~15 exchanges, plenty for "where we left off."
const RECENT_MESSAGE_WINDOW = 30

/**
 * Minimum blur duration before generating a recap. Below this threshold
 * (micro tab-switches, incidental focus loss), we do nothing.
 */
export const AWAY_SUMMARY_THRESHOLD_MS = 5 * 60 * 1000

/**
 * Opt-in via settings.awaySummaryEnabled OR
 * AXIOMATE_CODE_ENABLE_AWAY_SUMMARY env var. Default OFF because every
 * trigger costs an awaySummary auxiliary model roundtrip and the
 * "while you were away" system
 * message can surprise users who didn't opt in.
 */
export function isAwaySummaryEnabled(): boolean {
  if (isEnvTruthy(process.env.AXIOMATE_CODE_ENABLE_AWAY_SUMMARY)) return true
  return getInitialSettings()?.awaySummaryEnabled === true
}

function buildAwaySummaryPrompt(memory: string | null): string {
  const memoryBlock = memory
    ? `Session memory (broader context):\n${memory}\n\n`
    : ''
  return `${memoryBlock}The user stepped away and is coming back. Write exactly 1-3 short sentences. Start by stating the high-level task — what they are building or debugging, not implementation details. Next: the concrete next step. Skip status reports and commit recaps.`
}

/**
 * Generates a short session recap for the "while you were away" card.
 * Returns null on abort, empty transcript, or error.
 */
export async function generateAwaySummary(
  messages: readonly Message[],
  signal: AbortSignal,
): Promise<string | null> {
  if (messages.length === 0) {
    return null
  }

  try {
    const memory = await getSessionMemoryContent()
    const recent = messages.slice(-RECENT_MESSAGE_WINDOW)
    recent.push(createUserMessage({ content: buildAwaySummaryPrompt(memory) }))
    const response = await runAuxiliaryTask({
      task: 'awaySummary',
      operation: 'inference',
      querySource: 'away_summary',
      signal,
      execute: attempt =>
        queryModelWithoutStreaming({
          messages: recent,
          systemPrompt: asSystemPrompt([]),
          thinkingConfig: { type: 'disabled' },
          tools: [],
          signal,
          options: {
            getToolPermissionContext: async () => getEmptyToolPermissionContext(),
            ...auxiliaryAttemptQueryOptions(attempt, 'away_summary'),
            toolChoice: undefined,
            isNonInteractiveSession: false,
            hasAppendSystemPrompt: false,
            agents: [],
            querySource: 'away_summary',
            mcpTools: [],
            skipCacheWrite: true,
            maxOutputTokensOverride: attempt.policy.maxOutputTokens,
          },
        }),
      onFailure: auxiliaryFailureAssistantMessage,
    })

    if (!response) {
      return null
    }

    if (response.isApiErrorMessage) {
      logForDebugging(
        `[awaySummary] API error: ${getAssistantMessageText(response)}`,
      )
      return null
    }
    return getAssistantMessageText(response)
  } catch (err) {
    if (isAbortError(err) || signal.aborted) {
      return null
    }
    logForDebugging(`[awaySummary] generation failed: ${err}`)
    return null
  }
}
