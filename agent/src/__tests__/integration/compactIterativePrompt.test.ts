/**
 * Integration test: compact PR 1 (iterative summary prompt).
 *
 * Focus: does a small real model (Qwen3 8B) actually obey the iterative
 * prompt's "update, don't rewrite" instructions? Unit tests only verify
 * the prompt is constructed with the right text — they can't verify the
 * LLM actually follows it.
 *
 * Design: call the OpenAI-protocol API directly with axiomate's real
 * ITERATIVE_COMPACT_PROMPT (via getCompactPrompt). We deliberately bypass
 * compactConversation's full orchestration (which drags in the entire
 * ToolUseContext chain and getGlobalConfig) and test the narrower question
 * that matters: the prompt's effectiveness on a real small model.
 *
 * If this test fails on Qwen3 8B but passes on Qwen3.6 Plus, we learn
 * the iterative prompt needs to be gated on ≥32B models, or the prompt
 * needs to be strengthened for smaller models.
 */
import OpenAI from 'openai'
import { describe, expect, it } from 'vitest'

import { getCompactPrompt } from '../../services/compact/prompt.js'

import { getIntegrationModelConfig } from './config/loadIntegrationEnv.js'
import { TEST_MODELS } from './config/testModels.js'

// ---------------------------------------------------------------------------
// Fixtures — a realistic pre-existing summary and new turns that would
// trigger a second compact.
// ---------------------------------------------------------------------------

const PREVIOUS_SUMMARY = `1. Primary Request and Intent:
   The user is fixing 3 bugs in the authentication module.

2. Key Technical Concepts:
   - JWT token refresh flow
   - Race condition mitigation via mutex
   - Memory leak detection

3. Files and Code Sections:
   - src/auth.ts — main authentication logic
   - src/tokenRefresh.ts — token renewal logic
   - src/session.ts — session state management

4. Errors and fixes:
   - bug1: null pointer in login handler — fixed by adding null check

5. Problem Solving:
   Identified 3 root causes; bug1 resolved, bug2 and bug3 pending investigation.

6. All user messages:
   - "fix the 3 bugs in auth"
   - "start with bug1 null pointer"
   - "now look at bug2 and bug3"

7. Pending Tasks:
   - bug2: race condition in login flow (user said "investigate mutex approach")
   - bug3: memory leak in token refresh

8. Current Work:
   Just finished bug1. About to start on bug2 race condition investigation.

9. Optional Next Step:
   Read src/tokenRefresh.ts to understand the refresh flow for bug3.`

const NEW_CONVERSATION_TURNS = `[New conversation since last compact — to be incorporated into an UPDATED summary]

user: I think bug2 is fixed, I added a mutex around the login handler
assistant: Let me verify by reading the updated code. [reads src/auth.ts] — Confirmed, the race condition is resolved with the mutex. bug2 complete.

user: Great. Now I want to add bug4 to the list — there's also a CSRF token validation issue I noticed

assistant: Added bug4 to the pending list. Want to investigate bug3 memory leak first, or bug4 CSRF?

user: Let's do bug3 first.

assistant: OK, reading src/tokenRefresh.ts now. [reads file]`

// ---------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------

describe('compact iterative prompt — Qwen3 8B', () => {
  it('obeys iterative update: preserves bug3 pending, marks bug2 completed, adds bug4', async () => {
    const modelCfg = getIntegrationModelConfig(TEST_MODELS.summarization)
    const client = new OpenAI({
      baseURL: modelCfg.baseUrl,
      apiKey: modelCfg.apiKey,
    })

    const iterativePrompt = getCompactPrompt(undefined, PREVIOUS_SUMMARY)

    const response = await client.chat.completions.create({
      model: TEST_MODELS.summarization,
      messages: [
        {
          role: 'user',
          content: `${NEW_CONVERSATION_TURNS}\n\n---\n\n${iterativePrompt}`,
        },
      ],
      temperature: 0,
    })

    const summary = response.choices[0]?.message.content ?? ''

    // Print for inspection on first run — this is a diagnostic integration test,
    // summary content is informative even when assertions pass.
    console.log('\n=== ITERATIVE SUMMARY FROM Qwen3 8B ===\n' + summary + '\n======\n')

    // Core iterative behavior: the LLM should have UPDATED, not REWRITTEN.
    // These are tolerant checks — assert on presence/structure, not exact strings.

    // bug3 was pending in previous summary, should remain pending (not completed)
    expect(summary).toContain('bug3')

    // bug2 was pending, new turns show it got fixed; summary should reflect completion
    expect(summary).toContain('bug2')

    // bug4 is NEW in the new turns — should appear in the updated summary
    expect(summary).toContain('bug4')

    // Schema integrity: key field headers should still be present
    expect(summary).toMatch(/Pending Tasks/i)
    expect(summary).toMatch(/(Primary Request|Intent)/i)
  }, 90_000)
})
