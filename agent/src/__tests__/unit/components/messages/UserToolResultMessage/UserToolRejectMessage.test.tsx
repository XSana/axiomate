import * as React from 'react'
import { z } from 'zod/v4'
import { describe, expect, test, vi } from 'vitest'
import { Text } from '../../../../../ink.js'
import { UserToolRejectMessage } from '../../../../../components/messages/UserToolResultMessage/UserToolRejectMessage.js'
import { renderToString } from '../../../../../utils/staticRender.js'
import type { Tool } from '../../../../../Tool.js'
import type { buildMessageLookups } from '../../../../../utils/messages.js'

function makeTool(renderSpy: ReturnType<typeof vi.fn>): Tool {
  return {
    name: 'FakeRejectRenderTool',
    inputSchema: z.strictObject({}),
    permissionUpdatedInputSchema: z.strictObject({
      plan: z.string(),
      _approvedExitMode: z.literal('default').optional(),
    }),
    isReadOnly: () => true,
    isEnabled: () => true,
    isConcurrencySafe: () => true,
    description: async () => 'fake',
    prompt: async () => 'fake',
    userFacingName: () => 'Fake',
    call: async () => ({ data: 'unused' }),
    renderToolUseRejectedMessage: input => {
      renderSpy(input)
      return <Text>Rejected plan: {String(input.plan)}</Text>
    },
    mapToolResultToToolResultBlockParam: (content, toolUseID) => ({
      type: 'tool_result',
      content: String(content),
      tool_use_id: toolUseID,
    }),
  } as unknown as Tool
}

describe('UserToolRejectMessage', () => {
  test('renders rejected permission-updated input with the permission schema', async () => {
    const renderSpy = vi.fn()
    const tool = makeTool(renderSpy)

    const output = await renderToString(
      <UserToolRejectMessage
        input={{
          plan: 'Use a focused fix',
          _approvedExitMode: 'default',
        }}
        progressMessagesForMessage={[]}
        tool={tool}
        tools={[tool]}
        lookups={{} as ReturnType<typeof buildMessageLookups>}
        verbose={false}
      />,
    )

    expect(renderSpy).toHaveBeenCalledWith(
      {
        plan: 'Use a focused fix',
        _approvedExitMode: 'default',
      },
    )
    expect(output).toContain('Rejected plan: Use a focused fix')
    expect(output).not.toContain('Interrupted')
  })
})
