import { describe, expect, test } from 'vitest'
import type { PublishDiagnosticsParams } from 'vscode-languageserver-protocol'
import { formatDiagnosticsForAttachment } from '../../../../services/lsp/passiveFeedback.js'

describe('formatDiagnosticsForAttachment', () => {
  test('formats markup diagnostic messages as strings', () => {
    const params: PublishDiagnosticsParams = {
      uri: 'src/example.ts',
      diagnostics: [
        {
          message: {
            kind: 'markdown',
            value: '**Type mismatch**',
          },
          severity: 1,
          range: {
            start: { line: 4, character: 2 },
            end: { line: 4, character: 10 },
          },
          source: 'typescript',
          code: 2322,
        },
      ],
    }

    expect(formatDiagnosticsForAttachment(params)).toEqual([
      {
        uri: 'src/example.ts',
        diagnostics: [
          {
            message: '**Type mismatch**',
            severity: 'Error',
            range: {
              start: { line: 4, character: 2 },
              end: { line: 4, character: 10 },
            },
            source: 'typescript',
            code: '2322',
          },
        ],
      },
    ])
  })
})
