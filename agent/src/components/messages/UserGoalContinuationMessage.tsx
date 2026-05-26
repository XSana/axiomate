/**
 * Renders the auto-generated continuation user message that the goal
 * Ralph loop enqueues after each completed turn.
 *
 * **The full prompt text is still sent to the model** (it's a real
 * user message in the chain — see `utils/goal/continuation.ts` for
 * the template the LLM sees). We just render a single-line stub in
 * the transcript UI so the user isn't spammed with the same
 * "[Continuing toward your standing goal] Goal: …" block on every
 * round. The cyan ↻ glyph + "Goal continuation" label makes the
 * synthesized turn distinguishable from user-typed prompts at a
 * glance.
 */

import type { TextBlockParam } from '../../services/api/streamTypes.js'
import React from 'react'
import { Box, Text } from '../../ink.js'

type Props = {
  addMargin: boolean
  param: TextBlockParam
}

export function UserGoalContinuationMessage({
  addMargin,
  param: _param,
}: Props): React.ReactNode {
  return (
    <Box
      flexDirection="row"
      marginTop={addMargin ? 1 : 0}
      gap={1}
    >
      <Text color="success">↻</Text>
      <Text dimColor>Goal continuation</Text>
    </Box>
  )
}
