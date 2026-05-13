import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { McpSdkServerHandler, collectSdkMcpServers } from '../src/mcpBridge.js'
import { createSdkMcpServer } from '../src/mcpServer.js'
import { tool } from '../src/tool.js'

function makeHandler() {
  const addTool = tool(
    'add',
    'Add two numbers',
    { a: z.number(), b: z.number() },
    async ({ a, b }) => ({
      content: [{ type: 'text', text: String(a + b) }],
    }),
  )

  const echoTool = tool(
    'echo',
    'Echo a string',
    { text: z.string() },
    async ({ text }) => ({
      content: [{ type: 'text', text }],
    }),
  )

  const server = createSdkMcpServer({
    name: 'calc',
    version: '1.2.3',
    tools: [addTool, echoTool],
  })

  return new McpSdkServerHandler(server.serverInstance)
}

describe('McpSdkServerHandler', () => {
  it('responds to initialize with server info and capabilities', async () => {
    const handler = makeHandler()
    const resp = await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    })

    expect(resp).not.toBeNull()
    expect(resp!.jsonrpc).toBe('2.0')
    expect(resp!.id).toBe(1)
    expect(resp!.result).toMatchObject({
      protocolVersion: expect.any(String),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'calc', version: '1.2.3' },
    })
  })

  it('lists tools with JSON schemas converted from Zod', async () => {
    const handler = makeHandler()
    const resp = await handler.handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    })

    const result = resp!.result as { tools: Array<{ name: string; inputSchema: any }> }
    expect(result.tools).toHaveLength(2)

    const add = result.tools.find((t) => t.name === 'add')!
    expect(add.inputSchema.type).toBe('object')
    expect(add.inputSchema.properties.a.type).toBe('number')
    expect(add.inputSchema.properties.b.type).toBe('number')
  })

  it('calls a tool and returns its CallToolResult', async () => {
    const handler = makeHandler()
    const resp = await handler.handle({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'add', arguments: { a: 2, b: 3 } },
    })

    expect(resp!.result).toEqual({
      content: [{ type: 'text', text: '5' }],
    })
  })

  it('returns invalid_params error when tool input fails Zod validation', async () => {
    const handler = makeHandler()
    const resp = await handler.handle({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'add', arguments: { a: 'oops', b: 3 } },
    })

    expect(resp!.error).toBeDefined()
    expect(resp!.error!.code).toBe(-32602)
  })

  it('returns method_not_found for unknown tool', async () => {
    const handler = makeHandler()
    const resp = await handler.handle({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'missing', arguments: {} },
    })

    expect(resp!.error).toBeDefined()
    expect(resp!.error!.code).toBe(-32601)
  })

  it('returns method_not_found for unknown method', async () => {
    const handler = makeHandler()
    const resp = await handler.handle({
      jsonrpc: '2.0',
      id: 6,
      method: 'resources/list',
    })

    expect(resp!.error).toBeDefined()
    expect(resp!.error!.code).toBe(-32601)
  })

  it('returns isError result when tool handler throws', async () => {
    const throwingTool = tool(
      'fail',
      'Always fails',
      {},
      async () => {
        throw new Error('boom')
      },
    )
    const server = createSdkMcpServer({ name: 's', tools: [throwingTool] })
    const handler = new McpSdkServerHandler(server.serverInstance)

    const resp = await handler.handle({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'fail', arguments: {} },
    })

    expect(resp!.result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: expect.stringContaining('boom') }],
    })
  })

  it('returns null for notifications', async () => {
    const handler = makeHandler()
    const resp = await handler.handle({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })
    expect(resp).toBeNull()
  })

  it('handles zero-argument tools', async () => {
    const pingTool = tool('ping', 'Ping', {}, async () => ({
      content: [{ type: 'text', text: 'pong' }],
    }))
    const server = createSdkMcpServer({ name: 's', tools: [pingTool] })
    const handler = new McpSdkServerHandler(server.serverInstance)

    const listResp = await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    })
    const listResult = listResp!.result as { tools: any[] }
    expect(listResult.tools[0].inputSchema.type).toBe('object')

    const callResp = await handler.handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'ping', arguments: {} },
    })
    expect(callResp!.result).toEqual({
      content: [{ type: 'text', text: 'pong' }],
    })
  })
})

describe('collectSdkMcpServers', () => {
  it('returns empty map for undefined input', () => {
    const map = collectSdkMcpServers(undefined)
    expect(map.size).toBe(0)
  })

  it('only collects entries with type=sdk', () => {
    const pingTool = tool('ping', 'p', {}, async () => ({ content: [] }))
    const sdkServer = createSdkMcpServer({ name: 's1', tools: [pingTool] })

    const map = collectSdkMcpServers({
      external: { type: 'stdio', command: 'node', args: [] } as any,
      mine: sdkServer,
    })

    expect(map.size).toBe(1)
    expect(map.has('mine')).toBe(true)
    expect(map.has('external')).toBe(false)
  })

  it('uses the entry key as the server name (not the inner instance name)', () => {
    const pingTool = tool('ping', 'p', {}, async () => ({ content: [] }))
    const sdkServer = createSdkMcpServer({ name: 'inner-name', tools: [pingTool] })

    const map = collectSdkMcpServers({
      'outer-name': sdkServer,
    })

    expect(map.has('outer-name')).toBe(true)
  })
})
