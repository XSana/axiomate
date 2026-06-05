import { describe, expect, it, vi } from 'vitest'

import type { ToolUseContext } from '../../../Tool.js'
import { createSubagentContext } from '../../../utils/forkedAgent.js'
import { createFileStateCacheWithSizeLimit } from '../../../utils/fileStateCache.js'
import type { RecoveryTraceEvent } from '../../../services/api/recoveryTrace.js'

function makeParent(
  onRecoveryTrace?: (event: RecoveryTraceEvent) => void,
  appendSystemMessage?: ToolUseContext['appendSystemMessage'],
): ToolUseContext {
  return {
    abortController: new AbortController(),
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'model-a',
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    readFileState: createFileStateCacheWithSizeLimit(10),
    getAppState: () => ({
      toolPermissionContext: { shouldAvoidPermissionPrompts: false },
    }),
    setAppState: () => {},
    messages: [],
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    onRecoveryTrace,
    appendSystemMessage,
  } as unknown as ToolUseContext
}

describe('createSubagentContext recovery trace plumbing', () => {
  it('inherits parent API recovery trace sink by default', () => {
    const sink = vi.fn()
    const child = createSubagentContext(makeParent(sink))

    expect(child.onRecoveryTrace).toBe(sink)
  })

  it('allows recovery trace sink override for isolated contexts', () => {
    const parentSink = vi.fn()
    const childSink = vi.fn()
    const child = createSubagentContext(makeParent(parentSink), {
      onRecoveryTrace: childSink,
    })

    expect(child.onRecoveryTrace).toBe(childSink)
  })

  it('can explicitly clear the inherited recovery trace sink', () => {
    const parentSink = vi.fn()
    const child = createSubagentContext(makeParent(parentSink), {
      onRecoveryTrace: undefined,
    })

    expect(child.onRecoveryTrace).toBeUndefined()
  })

  it('inherits UI-only system message sink without other UI callbacks', () => {
    const appendSystemMessage = vi.fn()
    const parent = {
      ...makeParent(undefined, appendSystemMessage),
      setToolJSX: vi.fn(),
      setStreamMode: vi.fn(),
      openMessageSelector: vi.fn(),
    } as unknown as ToolUseContext
    const child = createSubagentContext(parent)

    expect(child.appendSystemMessage).toBe(appendSystemMessage)
    expect(child.setToolJSX).toBeUndefined()
    expect(child.setStreamMode).toBeUndefined()
    expect(child.openMessageSelector).toBeUndefined()
  })
})
