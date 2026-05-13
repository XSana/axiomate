import { randomUUID } from 'node:crypto'
import type { Writable } from 'node:stream'
import { writeNdjsonMessage } from './protocol.js'
import type { McpSdkServerHandler } from './mcpBridge.js'
import type {
  ElicitationRequest,
  ElicitationResponse,
  Options,
  PermissionRequest,
  PermissionResponse,
  PermissionMode,
} from './types/index.js'

export type ControlRequest = {
  type: 'control_request'
  request_id: string
  request: Record<string, unknown>
}

export type ControlResponse = {
  type: 'control_response'
  response: {
    subtype: 'success' | 'error'
    request_id: string
    response?: Record<string, unknown>
    error?: string
  }
}

export function sendControlRequest(
  stdin: Writable,
  subtype: string,
  payload: Record<string, unknown> = {},
): string {
  const requestId = randomUUID()
  writeNdjsonMessage(stdin, {
    type: 'control_request',
    request_id: requestId,
    request: { subtype, ...payload },
  })
  return requestId
}

export function sendControlResponse(
  stdin: Writable,
  requestId: string,
  response: Record<string, unknown> = {},
): void {
  writeNdjsonMessage(stdin, {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response,
    },
  })
}

export function sendControlError(
  stdin: Writable,
  requestId: string,
  error: string,
): void {
  writeNdjsonMessage(stdin, {
    type: 'control_response',
    response: {
      subtype: 'error',
      request_id: requestId,
      error,
    },
  })
}

export function sendInterrupt(stdin: Writable): void {
  sendControlRequest(stdin, 'interrupt')
}

export function sendSetPermissionMode(stdin: Writable, mode: PermissionMode): void {
  sendControlRequest(stdin, 'set_permission_mode', { mode })
}

export function sendSetModel(stdin: Writable, model: string): void {
  sendControlRequest(stdin, 'set_model', { model })
}

export function sendSetMaxThinkingTokens(stdin: Writable, tokens: number | null): void {
  sendControlRequest(stdin, 'set_max_thinking_tokens', { max_thinking_tokens: tokens })
}

export function sendStopTask(stdin: Writable, taskId: string): void {
  sendControlRequest(stdin, 'stop_task', { task_id: taskId })
}

export function sendApplyFlagSettings(stdin: Writable, settings: Record<string, unknown>): void {
  sendControlRequest(stdin, 'apply_flag_settings', { settings })
}

export function sendCancelControlRequest(stdin: Writable, requestId: string): void {
  writeNdjsonMessage(stdin, {
    type: 'control_cancel_request',
    request_id: requestId,
  })
}

export async function handleControlRequest(
  stdin: Writable,
  request: ControlRequest,
  options: Options,
  mcpHandlers?: Map<string, McpSdkServerHandler>,
): Promise<void> {
  const { request_id, request: inner } = request
  const subtype = (inner as { subtype?: string }).subtype

  switch (subtype) {
    case 'can_use_tool': {
      const permReq: PermissionRequest = {
        toolName: (inner as any).tool_name,
        input: (inner as any).input ?? {},
        toolUseId: (inner as any).tool_use_id,
        agentId: (inner as any).agent_id,
        title: (inner as any).title,
        description: (inner as any).description,
        permissionSuggestions: (inner as any).permission_suggestions,
      }

      if (options.onPermissionRequest) {
        try {
          const resp = await options.onPermissionRequest(permReq)
          sendControlResponse(stdin, request_id, {
            behavior: resp.decision === 'allow' ? 'allow' : 'deny',
            updatedPermissions: resp.updatedPermissions,
          })
        } catch (err) {
          sendControlError(stdin, request_id, String(err))
        }
      } else {
        // Default: allow all in bypassPermissions mode, deny otherwise
        if (options.permissionMode === 'bypassPermissions') {
          sendControlResponse(stdin, request_id, { behavior: 'allow' })
        } else {
          sendControlError(stdin, request_id, 'No permission handler configured')
        }
      }
      break
    }

    case 'elicitation': {
      const elicitReq: ElicitationRequest = {
        mcpServerName: (inner as any).mcp_server_name,
        message: (inner as any).message,
        mode: (inner as any).mode,
        url: (inner as any).url,
        elicitationId: (inner as any).elicitation_id,
        requestedSchema: (inner as any).requested_schema,
      }

      if (options.onElicitation) {
        try {
          const resp = await options.onElicitation(elicitReq)
          sendControlResponse(stdin, request_id, resp)
        } catch (err) {
          sendControlError(stdin, request_id, String(err))
        }
      } else {
        sendControlResponse(stdin, request_id, { action: 'decline' })
      }
      break
    }

    case 'hook_callback': {
      // Hook callbacks are acknowledged but not processed by default
      sendControlResponse(stdin, request_id, {})
      break
    }

    case 'mcp_message': {
      const serverName = (inner as any).server_name as string
      const message = (inner as any).message as unknown

      const handler = mcpHandlers?.get(serverName)
      if (!handler) {
        sendControlError(stdin, request_id, `No SDK MCP server registered: ${serverName}`)
        break
      }

      try {
        const response = await handler.handle(message)
        // Notifications return null — the CLI still expects a success ack
        sendControlResponse(stdin, request_id, {
          mcp_response: response ?? null,
        })
      } catch (err) {
        sendControlError(stdin, request_id, `MCP handler error: ${String(err)}`)
      }
      break
    }

    default: {
      // Unknown control requests get an error response
      sendControlError(stdin, request_id, `Unhandled control request: ${subtype}`)
      break
    }
  }
}
