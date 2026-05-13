import { spawnAxiomate } from './subprocess.js'
import { createNdjsonReader, writeNdjsonMessage, writeKeepAlive } from './protocol.js'
import {
  handleControlRequest,
  sendInterrupt,
  sendSetPermissionMode,
  sendSetModel,
  sendSetMaxThinkingTokens,
  sendStopTask,
  sendApplyFlagSettings,
  sendControlRequest,
  type ControlRequest,
} from './controlProtocol.js'
import { AbortError } from './errors.js'
import type {
  McpServerStatus,
  Options,
  PermissionMode,
  Query,
  RewindFilesResult,
  SDKMessage,
  SDKUserMessage,
} from './types/index.js'

type QueryParams = {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: Options
}

export function query(params: QueryParams): Query {
  const { prompt, options = {} } = params
  const isStreamingInput = typeof prompt !== 'string'

  const handle = spawnAxiomate(
    options,
    typeof prompt === 'string' ? prompt : undefined,
  )

  let closed = false
  let keepAliveInterval: ReturnType<typeof setInterval> | undefined

  const pendingResponses = new Map<string, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }>()

  async function* generateMessages(): AsyncGenerator<SDKMessage, void, undefined> {
    // Start keep-alive to prevent stdin from closing
    keepAliveInterval = setInterval(() => {
      if (!closed) writeKeepAlive(handle.stdin)
    }, 15000)

    // If streaming input, pipe user messages to stdin
    if (isStreamingInput) {
      ;(async () => {
        try {
          for await (const msg of prompt as AsyncIterable<SDKUserMessage>) {
            if (closed) break
            writeNdjsonMessage(handle.stdin, msg)
          }
        } catch {
          // Input stream ended or errored
        }
      })()
    }

    const reader = createNdjsonReader(handle.stdout)

    try {
      for await (const raw of reader) {
        if (closed) break

        const msg = raw as Record<string, unknown>
        const type = msg['type'] as string

        // Handle control requests from CLI
        if (type === 'control_request') {
          await handleControlRequest(
            handle.stdin,
            msg as unknown as ControlRequest,
            options,
          )
          continue
        }

        // Handle control responses (for our outbound requests)
        if (type === 'control_response') {
          const response = msg['response'] as Record<string, unknown>
          const requestId = response['request_id'] as string
          const pending = pendingResponses.get(requestId)
          if (pending) {
            pendingResponses.delete(requestId)
            if (response['subtype'] === 'error') {
              pending.reject(new Error(response['error'] as string))
            } else {
              pending.resolve(response['response'] ?? {})
            }
          }
          continue
        }

        // Handle keep-alive (ignore)
        if (type === 'keep_alive') continue

        // Yield SDK messages to consumer
        yield msg as unknown as SDKMessage
      }
    } finally {
      cleanup()
    }
  }

  function cleanup() {
    if (closed) return
    closed = true
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval)
      keepAliveInterval = undefined
    }
    handle.kill()
    for (const [, pending] of pendingResponses) {
      pending.reject(new AbortError('Query closed'))
    }
    pendingResponses.clear()
  }

  function sendRequestAndWait<T = unknown>(subtype: string, payload: Record<string, unknown> = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const requestId = sendControlRequest(handle.stdin, subtype, payload)
      pendingResponses.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
      })
    })
  }

  const generator = generateMessages()

  const queryInterface: Query = Object.assign(generator, {
    interrupt() {
      if (!closed) sendInterrupt(handle.stdin)
    },

    setPermissionMode(mode: PermissionMode) {
      if (!closed) sendSetPermissionMode(handle.stdin, mode)
    },

    setModel(model: string) {
      if (!closed) sendSetModel(handle.stdin, model)
    },

    setMaxThinkingTokens(tokens: number | null) {
      if (!closed) sendSetMaxThinkingTokens(handle.stdin, tokens)
    },

    async close() {
      cleanup()
    },

    async mcpServerStatus(): Promise<McpServerStatus[]> {
      const result = await sendRequestAndWait<{ mcpServers: McpServerStatus[] }>('mcp_status')
      return result.mcpServers
    },

    async rewindFiles(userMessageId: string, dryRun?: boolean): Promise<RewindFilesResult> {
      return sendRequestAndWait<RewindFilesResult>('rewind_files', {
        user_message_id: userMessageId,
        dry_run: dryRun,
      })
    },

    stopTask(taskId: string) {
      if (!closed) sendStopTask(handle.stdin, taskId)
    },

    applyFlagSettings(settings: Record<string, unknown>) {
      if (!closed) sendApplyFlagSettings(handle.stdin, settings)
    },
  })

  return queryInterface
}
