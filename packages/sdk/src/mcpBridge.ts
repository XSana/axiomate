import { zodToJsonSchema } from 'zod-to-json-schema'
import { z } from 'zod'
import type { McpSdkServerInstance, SdkMcpToolDefinition } from './types/index.js'

type JsonRpcRequest = {
  jsonrpc: '2.0'
  id: string | number | null
  method: string
  params?: unknown
}

type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

const ERROR_PARSE = -32700
const ERROR_METHOD_NOT_FOUND = -32601
const ERROR_INVALID_PARAMS = -32602
const ERROR_INTERNAL = -32603

function buildInputSchema(toolDef: SdkMcpToolDefinition): Record<string, unknown> {
  const shape = toolDef.inputSchema ?? {}
  if (Object.keys(shape).length === 0) {
    return { type: 'object', properties: {}, additionalProperties: false }
  }
  const obj = z.object(shape)
  const schema = zodToJsonSchema(obj, { target: 'jsonSchema7' }) as Record<string, unknown>
  delete schema['$schema']
  return schema
}

function makeErrorResponse(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, data } }
}

function makeSuccessResponse(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

export class McpSdkServerHandler {
  private readonly tools: Map<string, SdkMcpToolDefinition>

  constructor(private readonly instance: McpSdkServerInstance) {
    this.tools = new Map()
    for (const t of instance.tools) {
      this.tools.set(t.name, t)
    }
  }

  get serverName(): string {
    return this.instance.name
  }

  async handle(rawMessage: unknown): Promise<JsonRpcResponse | null> {
    if (
      typeof rawMessage !== 'object' ||
      rawMessage === null ||
      (rawMessage as JsonRpcRequest).jsonrpc !== '2.0'
    ) {
      return makeErrorResponse(null, ERROR_PARSE, 'Invalid JSON-RPC message')
    }

    const req = rawMessage as JsonRpcRequest
    const isNotification = req.id === undefined || req.id === null

    try {
      switch (req.method) {
        case 'initialize': {
          if (isNotification) return null
          return makeSuccessResponse(req.id, {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: { listChanged: false },
            },
            serverInfo: {
              name: this.instance.name,
              version: this.instance.version ?? '0.1.0',
            },
          })
        }

        case 'notifications/initialized':
        case 'notifications/cancelled':
          return null

        case 'tools/list': {
          if (isNotification) return null
          const tools = Array.from(this.tools.values()).map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: buildInputSchema(t),
            ...(t.annotations ? { annotations: t.annotations } : {}),
          }))
          return makeSuccessResponse(req.id, { tools })
        }

        case 'tools/call': {
          if (isNotification) return null
          const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> }
          if (!params.name) {
            return makeErrorResponse(req.id, ERROR_INVALID_PARAMS, 'Missing tool name')
          }
          const tool = this.tools.get(params.name)
          if (!tool) {
            return makeErrorResponse(
              req.id,
              ERROR_METHOD_NOT_FOUND,
              `Unknown tool: ${params.name}`,
            )
          }

          const args = params.arguments ?? {}
          let parsedArgs: Record<string, unknown> = args
          if (Object.keys(tool.inputSchema ?? {}).length > 0) {
            const parseResult = z.object(tool.inputSchema).safeParse(args)
            if (!parseResult.success) {
              return makeErrorResponse(
                req.id,
                ERROR_INVALID_PARAMS,
                'Invalid tool input',
                parseResult.error.format(),
              )
            }
            parsedArgs = parseResult.data
          }

          try {
            const result = await tool.handler(parsedArgs as never, {})
            return makeSuccessResponse(req.id, result)
          } catch (err) {
            return makeSuccessResponse(req.id, {
              content: [{ type: 'text', text: `Tool error: ${String(err)}` }],
              isError: true,
            })
          }
        }

        default: {
          if (isNotification) return null
          return makeErrorResponse(
            req.id,
            ERROR_METHOD_NOT_FOUND,
            `Method not supported: ${req.method}`,
          )
        }
      }
    } catch (err) {
      if (isNotification) return null
      return makeErrorResponse(req.id, ERROR_INTERNAL, String(err))
    }
  }
}

export function collectSdkMcpServers(
  mcpServers: Record<string, { type: string; serverInstance?: McpSdkServerInstance }> | undefined,
): Map<string, McpSdkServerHandler> {
  const handlers = new Map<string, McpSdkServerHandler>()
  if (!mcpServers) return handlers

  for (const [name, config] of Object.entries(mcpServers)) {
    if (config.type === 'sdk' && config.serverInstance) {
      handlers.set(name, new McpSdkServerHandler(config.serverInstance))
    }
  }
  return handlers
}
