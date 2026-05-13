import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  AbortError,
  buildMissedTaskNotification,
  createSdkMcpServer,
  query,
  tool,
  unstable_v2_createSession,
} from '../src/index.js'

describe('axiomate-sdk public API', () => {
  it('exports query function', () => {
    expect(typeof query).toBe('function')
  })

  it('exports AbortError class', () => {
    const err = new AbortError('test')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('AbortError')
    expect(err.message).toBe('test')
  })

  it('tool() builds a typed tool definition', () => {
    const myTool = tool(
      'echo',
      'Echoes input text',
      { text: z.string() },
      async ({ text }) => ({
        content: [{ type: 'text', text: `echo: ${text}` }],
      }),
    )

    expect(myTool.name).toBe('echo')
    expect(myTool.description).toBe('Echoes input text')
    expect(typeof myTool.handler).toBe('function')
    expect(myTool.inputSchema.text).toBeDefined()
  })

  it('createSdkMcpServer() wraps tools into a server config', () => {
    const myTool = tool(
      'noop',
      'Does nothing',
      {},
      async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    )

    const server = createSdkMcpServer({
      name: 'test-server',
      version: '1.0.0',
      tools: [myTool],
    })

    expect(server.type).toBe('sdk')
    expect(server.serverInstance.name).toBe('test-server')
    expect(server.serverInstance.tools).toHaveLength(1)
  })

  it('buildMissedTaskNotification() formats missed tasks', () => {
    const result = buildMissedTaskNotification([
      { id: 'task1', cron: '0 9 * * *', prompt: 'Daily standup', createdAt: 0 },
    ])
    expect(result).toContain('task1')
    expect(result).toContain('Daily standup')
  })

  it('buildMissedTaskNotification() returns empty string for empty input', () => {
    expect(buildMissedTaskNotification([])).toBe('')
  })

  it('unstable_v2_createSession() returns a session with an id', () => {
    const session = unstable_v2_createSession({ sessionId: 'test-session-1' })
    expect(session.sessionId).toBe('test-session-1')
    expect(typeof session.send).toBe('function')
    expect(typeof session.close).toBe('function')
  })
})
