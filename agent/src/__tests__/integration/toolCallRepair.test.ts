/**
 * Integration test: jsonRepair pipeline — retrospective for R1..R4 + Hungarian.
 *
 * Focus: verify that multiple repair components compose correctly. Unit
 * tests cover each piece in isolation; this test exercises them together
 * on realistic scenarios that mirror what the runtime dispatch sees.
 *
 * Scope (intentionally narrow — no LLM, no full runtime):
 *   1. LLM emits alias-keyed tool input → Hungarian maps to canonical keys
 *   2. LLM emits JSON-in-string for an array field → parsed_array_string coerces
 *   3. LLM emits wrong shape N times → counter returns N, hint escalates after 4
 *
 * If the runtime later disconnects repair from dispatch (e.g., a refactor
 * bypasses repairToolInputAgainstSchema), these tests won't fail —
 * that's what a real end-to-end test would catch. This is a composition
 * test, not a pipeline test. A deeper pipeline integration test is
 * deferred until we have a lighter-weight runtime harness.
 */
import { randomUUID } from 'crypto'
import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'

import { countConsecutiveInputValidationFailures } from '../../services/tools/toolCallFailureCounter.js'
import type {
  AssistantMessage,
  Message,
  UserMessage,
} from '../../types/message.js'
import {
  repairToolInputAgainstSchema,
  type SchemaGuidedToolDefinition,
} from '../../utils/schemaGuidedRepair.js'

// ---------------------------------------------------------------------------
// Synthetic tool definitions mirroring real axiomate tools
// ---------------------------------------------------------------------------

const readTool: SchemaGuidedToolDefinition = {
  name: 'Read',
  inputSchema: z.strictObject({
    file_path: z.string(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().optional(),
  }),
  propertyAliases: {
    file_path: ['file', 'filePath', 'filepath', 'path'],
  },
}

const taggerTool: SchemaGuidedToolDefinition = {
  name: 'Tagger',
  inputSchema: z.strictObject({
    tags: z.array(z.string()),
  }),
}

// ---------------------------------------------------------------------------
// Message fixture helpers (direct construction — avoid messages.ts chain)
// ---------------------------------------------------------------------------

function makeAssistantToolUse(toolName: string, id: string): AssistantMessage {
  return {
    type: 'assistant',
    message: {
      id: `msg_${id}`,
      role: 'assistant',
      model: 'test-model',
      stop_reason: 'tool_use',
      stop_sequence: null,
      type: 'message',
      usage: { input_tokens: 0, output_tokens: 0 },
      content: [{ type: 'tool_use', id, name: toolName, input: {} }],
    },
  } as unknown as AssistantMessage
}

function makeToolResultError(toolUseId: string, errorText: string): UserMessage {
  return {
    type: 'user',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: `<tool_use_error>InputValidationError: ${errorText}</tool_use_error>`,
          is_error: true,
        },
      ],
    },
  } as unknown as UserMessage
}

// ---------------------------------------------------------------------------
// Integration scenarios
// ---------------------------------------------------------------------------

describe('tool-repair composition (R1–R4 + Hungarian retrospective)', () => {
  it('alias-keyed LLM output maps to canonical schema key via Hungarian', () => {
    // Scenario: LLM emits { file: 'test.ts' } but schema wants file_path
    const result = repairToolInputAgainstSchema(
      { file: 'test.ts' },
      undefined,
      readTool,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.input).toEqual({ file_path: 'test.ts' })
      // Repair breadcrumb confirms Hungarian ran (renamed_key kind)
      expect(result.repairs.some(r => r.kind === 'renamed_key')).toBe(true)
    }
  })

  it('JSON-in-string array (R2) is parsed into a real array', () => {
    // Scenario: LLM emits { tags: "[\"a\",\"b\"]" } instead of the array
    const result = repairToolInputAgainstSchema(
      { tags: '["a","b","c"]' },
      undefined,
      taggerTool,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.input.tags).toEqual(['a', 'b', 'c'])
      expect(result.repairs.some(r => r.kind === 'parsed_array_string')).toBe(
        true,
      )
    }
  })

  it('type coercion (R1 regex alignment) handles +N integers', () => {
    const countTool: SchemaGuidedToolDefinition = {
      name: 'Count',
      inputSchema: z.strictObject({ n: z.number().int() }),
    }
    const result = repairToolInputAgainstSchema(
      { n: '+42' },
      undefined,
      countTool,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.input.n).toBe(42)
      expect(
        result.repairs.some(r => r.kind === 'coerced_string_to_number'),
      ).toBe(true)
    }
  })

  it('integer schema rejects decimal strings (R1 int-vs-number split)', () => {
    const countTool: SchemaGuidedToolDefinition = {
      name: 'Count',
      inputSchema: z.strictObject({ n: z.number().int() }),
    }
    const result = repairToolInputAgainstSchema(
      { n: '3.14' },
      undefined,
      countTool,
    )
    // Must fail — otherwise "3.14" would occupy an integer slot and starve
    // better candidates in the required-field matching phase
    expect(result.ok).toBe(false)
  })

  it('consecutive InputValidationError count composes with Hungarian retry story', () => {
    // Scenario: 3 prior failed tool attempts for Read, next attempt is #4.
    // The counter sees 3; the hint builder (in toolExecution) escalates at ≥4.
    const history: Message[] = []
    const toolUseIds: string[] = []
    for (let i = 0; i < 3; i++) {
      const id = `call_${i}`
      toolUseIds.push(id)
      history.push(makeAssistantToolUse('Read', id))
      history.push(
        makeToolResultError(
          id,
          `Expected string at "file_path", received undefined`,
        ),
      )
    }

    const count = countConsecutiveInputValidationFailures(history, 'Read')
    expect(count).toBe(3)

    // A 4th failure would push the total to 4 and trigger the STOP hint.
    // The hint builder is private to toolExecution.ts; we verify the
    // count semantics here, and rely on toolCallFailureCounter.test.ts
    // for the hint-threshold logic directly.
    expect(count + 1).toBeGreaterThanOrEqual(4)
  })

  it('repair + failure-counter work on the same message stream', () => {
    // Realistic scenario: alias-key repair succeeds, but the fact that
    // prior attempts failed means the LLM still gets the failure history.
    const history: Message[] = [
      makeAssistantToolUse('Read', 'call_a'),
      makeToolResultError('call_a', 'bad input'),
    ]
    expect(countConsecutiveInputValidationFailures(history, 'Read')).toBe(1)

    // This attempt uses alias but Hungarian will repair it
    const result = repairToolInputAgainstSchema(
      { file: 'x.ts' },
      undefined,
      readTool,
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.input).toEqual({ file_path: 'x.ts' })

    // If this repair succeeds and the tool runs, the next turn's counter
    // should reset to 0 on a non-error tool_result. That's verified in
    // toolCallFailureCounter unit tests; here we just sanity-check the
    // counter sees the current failed state.
  })
})
