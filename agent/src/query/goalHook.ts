/**
 * Goal-loop turn-end hook. Wires the {@link GoalManager} state machine
 * into the main query pipeline by running once at the end of each
 * assistant turn — after all user-configured stop hooks finish but
 * before the response leaves `handleStopHooks`.
 *
 * Port of hermes-agent/hermes_cli/cli.py:9340-9454
 * (`_maybe_continue_goal_after_turn`).
 *
 * Decision flow:
 *   1. No active goal in this session                       → no-op.
 *   2. A real (non-slash-command) user message is already queued
 *      → defer; the user's turn takes priority.
 *   3. The user cancelled the turn (Ctrl+C aborted the controller)
 *      → call `evaluateAfterTurn({interrupted:true})` so the manager
 *      pauses without judging.
 *   4. Otherwise extract last assistant text and run the judge.
 *   5. If the verdict is "continue" + we're under budget, enqueue the
 *      continuation prompt as a normal user message (priority `'next'`).
 *
 * The yielded verdict message is marked `isMeta: true` so the user sees
 * it but it does NOT enter the model's next-turn context (avoids
 * polluting prompt cache with judge prose).
 *
 * Debug logging: every entry is tagged with a per-call invocation id so
 * we can correlate "fired twice for one turn" reports with the pipeline
 * path that produced the second call. Grep `[GOAL-HOOK]` in the debug
 * log.
 */

import { getSessionId } from '../bootstrap/state.js'
import { randomUUID } from 'crypto'
import { GoalManager } from '../utils/goal/goalManager.js'
import { getGlobalConfig } from '../utils/config.js'
import {
  enqueue,
  getCommandQueueSnapshot,
  isSlashCommand,
} from '../utils/messageQueueManager.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import type {
  AssistantMessage,
  Message,
  SystemInformationalMessage,
} from '../types/message.js'
import type { ToolUseContext } from '../Tool.js'
import type { UUID } from 'crypto'

let hookInvocationCounter = 0

/**
 * True when there's already a real user message queued behind the
 * current turn. Slash commands are inspection / mutation noise and
 * don't count — letting them block goal continuation would silently
 * stall the loop when the user types `/subgoal add foo` mid-run.
 *
 * Mirrors hermes cli.py:9374-9395 (_pending_input deque peek).
 */
function realUserMessageQueued(): boolean {
  const queue = getCommandQueueSnapshot()
  for (const cmd of queue) {
    if (isSlashCommand(cmd)) continue
    if (typeof cmd.value !== 'string') return true
    if (cmd.value.trim() !== '') return true
  }
  return false
}

function extractLastAssistantText(
  assistantMessages: readonly AssistantMessage[],
): string {
  const last = assistantMessages[assistantMessages.length - 1]
  const content = last?.message?.content
  if (!Array.isArray(content)) {
    return typeof content === 'string' ? content : ''
  }
  return content
    .filter(
      (b): b is { type: 'text'; text: string } =>
        !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text',
    )
    .map(b => b.text)
    .join('\n')
}

export async function* handleGoalHook(args: {
  assistantMessages: readonly AssistantMessage[]
  toolUseContext: ToolUseContext
}): AsyncGenerator<Message, void> {
  const callId = ++hookInvocationCounter
  const sessionId = (getSessionId() as unknown) as UUID
  const stack = new Error().stack?.split('\n').slice(2, 6).join(' | ') ?? '?'
  logForDebugging(
    `[GOAL-HOOK] call#${callId} entry sessionId=${sessionId?.slice(0, 8) ?? '-'} ` +
      `assistantMsgs=${args.assistantMessages.length} ` +
      `aborted=${args.toolUseContext.abortController.signal.aborted} ` +
      `caller=${stack}`,
    { level: 'info' },
  )
  if (!sessionId) {
    logForDebugging(`[GOAL-HOOK] call#${callId} exit: no sessionId`, {
      level: 'info',
    })
    return
  }

  let mgr: GoalManager
  try {
    mgr = await GoalManager.load(sessionId, {
      defaultMaxTurns: getGlobalConfig().goalsMaxTurns,
    })
  } catch (err) {
    logForDebugging(
      `[GOAL-HOOK] call#${callId} exit: load failed (${errorMessage(err)})`,
      { level: 'warn' },
    )
    return
  }

  if (!mgr.isActive()) {
    logForDebugging(
      `[GOAL-HOOK] call#${callId} exit: goal not active (status=${mgr.state?.status ?? 'null'})`,
      { level: 'info' },
    )
    return
  }

  if (realUserMessageQueued()) {
    logForDebugging(
      `[GOAL-HOOK] call#${callId} exit: real user message queued (deferring)`,
      { level: 'info' },
    )
    return
  }

  const interrupted = args.toolUseContext.abortController.signal.aborted
  const lastResponse = extractLastAssistantText(args.assistantMessages)
  if (!interrupted && !lastResponse.trim()) {
    logForDebugging(
      `[GOAL-HOOK] call#${callId} exit: empty assistant response, not interrupted`,
      { level: 'info' },
    )
    return
  }

  logForDebugging(
    `[GOAL-HOOK] call#${callId} calling evaluateAfterTurn ` +
      `(turnsUsed=${mgr.state?.turnsUsed} interrupted=${interrupted} respLen=${lastResponse.length})`,
    { level: 'info' },
  )

  let decision
  try {
    decision = await mgr.evaluateAfterTurn({
      lastResponse,
      interrupted,
      signal: args.toolUseContext.abortController.signal,
    })
  } catch (err) {
    logForDebugging(
      `[GOAL-HOOK] call#${callId} evaluateAfterTurn threw: ${errorMessage(err)}`,
      { level: 'warn' },
    )
    return
  }

  logForDebugging(
    `[GOAL-HOOK] call#${callId} decision: verdict=${decision.verdict} ` +
      `shouldContinue=${decision.shouldContinue} status=${decision.status}`,
    { level: 'info' },
  )

  if (decision.message) {
    const verdictMessage: SystemInformationalMessage = {
      type: 'system',
      subtype: 'informational',
      content: decision.message,
      isMeta: true,
      timestamp: new Date().toISOString(),
      uuid: randomUUID(),
      level: 'info',
    }
    yield verdictMessage
  }

  if (decision.shouldContinue && decision.continuationPrompt) {
    logForDebugging(
      `[GOAL-HOOK] call#${callId} enqueuing continuation prompt ` +
        `(queueLen-before=${getCommandQueueSnapshot().length})`,
      { level: 'info' },
    )
    try {
      enqueue({
        value: decision.continuationPrompt,
        mode: 'prompt',
        priority: 'next',
      })
    } catch (err) {
      logForDebugging(
        `[GOAL-HOOK] call#${callId} enqueue failed: ${errorMessage(err)}`,
        { level: 'warn' },
      )
    }
  }
}
