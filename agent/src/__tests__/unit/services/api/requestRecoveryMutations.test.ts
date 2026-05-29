import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  rewriteImagePayloadsForRecovery,
} from '../../../../services/api/requestRecoveryMutations.js'
import type { MessageParam } from '../../../../services/api/streamTypes.js'
import { maybeResizeAndDownsampleImageBuffer } from '../../../../utils/imageResizer.js'

vi.mock('../../../../utils/imageResizer.js', () => ({
  maybeResizeAndDownsampleImageBuffer: vi.fn(async () => ({
    buffer: Buffer.from('shrunk-image'),
    mediaType: 'jpeg',
  })),
}))

const resizeMock = vi.mocked(maybeResizeAndDownsampleImageBuffer)

describe('rewriteImagePayloadsForRecovery', () => {
  beforeEach(() => {
    resizeMock.mockClear()
  })

  it('rewrites base64 image blocks without mutating the original messages', async () => {
    const messages: MessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: Buffer.from('large-image').toString('base64'),
            },
          },
        ],
      },
    ]

    const rewritten = await rewriteImagePayloadsForRecovery(messages, {
      profile: 'fit_many_image_dimension_limit',
    })
    const originalImage = messages[0]!.content[1] as {
      source: { data: string; media_type: string }
    }
    const rewrittenImage = rewritten[0]!.content[1] as {
      source: { data: string; media_type: string }
    }

    expect(rewritten).not.toBe(messages)
    expect(originalImage.source.media_type).toBe('image/png')
    expect(originalImage.source.data).toBe(
      Buffer.from('large-image').toString('base64'),
    )
    expect(rewrittenImage.source.media_type).toBe('image/jpeg')
    expect(rewrittenImage.source.data).toBe(
      Buffer.from('shrunk-image').toString('base64'),
    )
    expect(resizeMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      Buffer.from('large-image').length,
      'png',
      expect.objectContaining({
        maxWidth: 1024,
        maxHeight: 1024,
        targetRawSize: 2.5 * 1024 * 1024,
        fallbackMaxEdge: 768,
        forceJpeg: false,
        allowRawFallback: false,
      }),
    )
  })

  it('uses aggressive retry profile budgets for byte-limit failures', async () => {
    const messages: MessageParam[] = [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: Buffer.from('huge-image').toString('base64'),
            },
          },
        ],
      },
    ]

    await rewriteImagePayloadsForRecovery(messages, {
      profile: 'aggressive_size_compression',
    })

    expect(resizeMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      Buffer.from('huge-image').length,
      'png',
      expect.objectContaining({
        maxWidth: 768,
        maxHeight: 768,
        targetRawSize: 1.25 * 1024 * 1024,
        fallbackMaxEdge: 512,
        jpegQualitySteps: [60, 40, 25],
        forceJpeg: true,
        allowRawFallback: false,
      }),
    )
  })

  it('textualizes tool-result images for the tool-result profile', async () => {
    const messages: MessageParam[] = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_1',
            content: [
              { type: 'text', text: 'plot' },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: 'abc',
                },
              },
            ],
          },
        ],
      },
    ]

    const rewritten = await rewriteImagePayloadsForRecovery(messages, {
      profile: 'drop_or_textualize_tool_result_images',
    })
    const toolResult = rewritten[0]!.content[0] as {
      content: Array<{ type: string; text?: string }>
    }

    expect(toolResult.content).toEqual([
      { type: 'text', text: 'plot' },
      {
        type: 'text',
        text: '[Image omitted from tool result during API retry: drop_or_textualize_tool_result_images]',
      },
    ])
    expect(resizeMock).not.toHaveBeenCalled()
  })
})
