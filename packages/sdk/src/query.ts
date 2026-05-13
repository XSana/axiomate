import { spawnAxiomate } from './subprocess.js'
import { createNdjsonReader, writeNdjsonMessage, writeKeepAlive } from './protocol.js'
import { collectSdkMcpServers } from './mcpBridge.js'
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
  ContextUsage,
  McpServerConfig,
  McpServerStatus,
  McpSetServersResult,
  Options,
  PermissionMode,
  Query,
  ReloadPluginsResult,
  RewindFilesResult,
  SDKMessage,
  SDKUserMessage,
  SettingsResult,
} from './types/index.js'

type QueryParams = {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: Options
}

export function query(params: QueryParams): Query {
  const { prompt, options = {} } = params
  const isStreamingInput = typeof prompt !== 'string'

  // With --input-format stream-json, the prompt comes via stdin NDJSON,
  // not via the --print <prompt> CLI arg.
  const handle = spawnAxiomate(options)

  // Build in-process MCP server handlers for `type: 'sdk'` entries
  const mcpHandlers = collectSdkMcpServers(options.mcpServers)
  const sdkMcpServerNames = Array.from(mcpHandlers.keys())

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

    // Send initialize control request first (registers SDK MCP servers, hooks, agents)
    const initPayload: Record<string, unknown> = {}
    if (sdkMcpServerNames.length > 0) {
      initPayload['sdkMcpServers'] = sdkMcpServerNames
    }
    if (options.systemPrompt) initPayload['systemPrompt'] = options.systemPrompt
    if (options.appendSystemPrompt) initPayload['appendSystemPrompt'] = options.appendSystemPrompt
    if (options.jsonSchema) initPayload['jsonSchema'] = options.jsonSchema
    if (options.agents) initPayload['agents'] = options.agents

    sendControlRequest(handle.stdin, 'initialize', initPayload)

    // Send initial prompt and/or pipe streaming input
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
    } else {
      const userMessage: SDKUserMessage = {
        type: 'user',
        content: prompt as string,
      }
      writeNdjsonMessage(handle.stdin, userMessage)
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
            mcpHandlers,
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

    async getContextUsage(): Promise<ContextUsage> {
      return sendRequestAndWait<ContextUsage>('get_context_usage')
    },

    async getSettings(): Promise<SettingsResult> {
      return sendRequestAndWait<SettingsResult>('get_settings')
    },

    async cancelAsyncMessage(messageUuid: string): Promise<{ cancelled: boolean }> {
      return sendRequestAndWait<{ cancelled: boolean }>('cancel_async_message', {
        message_uuid: messageUuid,
      })
    },

    async seedReadState(path: string, mtime: number): Promise<void> {
      await sendRequestAndWait('seed_read_state', { path, mtime })
    },

    async setMcpServers(servers: Record<string, McpServerConfig>): Promise<McpSetServersResult> {
      return sendRequestAndWait<McpSetServersResult>('mcp_set_servers', { servers })
    },

    async reloadPlugins(): Promise<ReloadPluginsResult> {
      return sendRequestAndWait<ReloadPluginsResult>('reload_plugins')
    },

    async reconnectMcpServer(serverName: string): Promise<void> {
      await sendRequestAndWait('mcp_reconnect', { serverName })
    },

    async toggleMcpServer(serverName: string, enabled: boolean): Promise<void> {
      await sendRequestAndWait('mcp_toggle', { serverName, enabled })
    },
  })

  return queryInterface
}
