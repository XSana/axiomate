import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetLastMainRequestId = vi.hoisted(() => vi.fn(() => undefined))
const mockGetOriginalCwd = vi.hoisted(() => vi.fn(() => '/workspace'))
const mockRegenerateSessionId = vi.hoisted(() => vi.fn())
const mockExecuteSessionEndHooks = vi.hoisted(() => vi.fn(async () => {}))
const mockProcessSessionStartHooks = vi.hoisted(() => vi.fn(async () => []))
const mockResetSessionFilePointer = vi.hoisted(() => vi.fn(async () => {}))
const mockClearSessionCaches = vi.hoisted(() => vi.fn())
const mockSetCwd = vi.hoisted(() => vi.fn())
const mockReadFileClear = vi.hoisted(() => vi.fn())

vi.mock('../../../../bootstrap/state.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../../bootstrap/state.js')>()
  return {
    ...actual,
    getLastMainRequestId: mockGetLastMainRequestId,
    getOriginalCwd: mockGetOriginalCwd,
    getSessionId: vi.fn(() => 'session-before-clear'),
    regenerateSessionId: mockRegenerateSessionId,
  }
})

vi.mock('../../../../services/analytics/index.js', () => ({
  logEvent: vi.fn(),
}))

vi.mock('../../../../utils/hooks.js', () => ({
  executeSessionEndHooks: mockExecuteSessionEndHooks,
  getSessionEndHookTimeoutMs: vi.fn(() => 10),
}))

vi.mock('../../../../utils/log.js', () => ({
  logError: vi.fn(),
}))

vi.mock('../../../../utils/fileHistory.js', () => ({
  resetFileHistoryDraft: vi.fn(),
}))

vi.mock('../../../../utils/plans.js', () => ({
  clearAllPlanSlugs: vi.fn(),
}))

vi.mock('../../../../utils/Shell.js', () => ({
  setCwd: mockSetCwd,
}))

vi.mock('../../../../utils/sessionStart.js', () => ({
  processSessionStartHooks: mockProcessSessionStartHooks,
}))

vi.mock('../../../../utils/sessionStorage.js', () => ({
  clearSessionMetadata: vi.fn(),
  getAgentTranscriptPath: vi.fn(() => '/tmp/agent-transcript.jsonl'),
  resetSessionFilePointer: mockResetSessionFilePointer,
  saveMode: vi.fn(),
  saveWorktreeState: vi.fn(),
}))

vi.mock('../../../../utils/task/diskOutput.js', () => ({
  evictTaskOutput: vi.fn(),
  initTaskOutputAsSymlink: vi.fn(),
}))

vi.mock('../../../../utils/worktree.js', () => ({
  getCurrentWorktreeSession: vi.fn(() => null),
}))

vi.mock('../../../../commands/clear/caches.js', () => ({
  clearSessionCaches: mockClearSessionCaches,
}))

vi.mock('../../../../coordinator/coordinatorMode.js', () => ({
  isCoordinatorMode: vi.fn(() => false),
}))

import { clearConversation } from '../../../../commands/clear/conversation.js'
import {
  appendApiRecoveryTrace,
  clearApiRecoveryTraces,
  listApiRecoveryTraces,
} from '../../../../services/api/apiRecoveryDiagnostics.js'
import type { RecoveryTraceEvent } from '../../../../services/api/recoveryTrace.js'

function event(): RecoveryTraceEvent {
  return {
    timestamp: '2026-05-30T00:00:00.000Z',
    traceId: 'trace-before-clear',
    protocol: 'openai-chat',
    model: 'model-a',
    attempt: 1,
    maxAttempts: 2,
    reason: 'rate_limit',
    intent: 'retry_transient_failure',
    action: 'retry_backoff',
    outcome: 'retrying',
    retryable: true,
    shouldCompress: false,
    shouldFallback: true,
  }
}

describe('clearConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearApiRecoveryTraces()
  })

  it('clears session-local Doctor API recovery traces on /clear', async () => {
    appendApiRecoveryTrace(event())
    expect(listApiRecoveryTraces()).toHaveLength(1)

    const setMessages = vi.fn()

    await clearConversation({
      setMessages,
      readFileState: { clear: mockReadFileClear } as any,
    })

    expect(listApiRecoveryTraces()).toHaveLength(0)
    expect(setMessages).toHaveBeenCalledWith(expect.any(Function))
    expect(mockClearSessionCaches).toHaveBeenCalledTimes(1)
    expect(mockSetCwd).toHaveBeenCalledWith('/workspace')
    expect(mockReadFileClear).toHaveBeenCalledTimes(1)
    expect(mockRegenerateSessionId).toHaveBeenCalledWith({
      setCurrentAsParent: true,
    })
    expect(mockResetSessionFilePointer).toHaveBeenCalledTimes(1)
  })
})
