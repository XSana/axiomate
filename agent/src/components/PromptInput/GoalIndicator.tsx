/**
 * Footer pill that surfaces the active /goal status. Renders a single
 * line so the goal stays visible even while the agent is running:
 *
 *   ⊙ Goal 3/20: write fib                  (active)
 *   ⏸ Goal paused: refactor auth            (paused — judge / Ctrl+C)
 *
 * Hidden when the session has no goal or the goal is `done` / `cleared`.
 * Subscribes to {@link useGoalState} so changes from `/goal`,
 * `/subgoal`, or the stop hook re-render immediately.
 *
 * Implementation note: the whole pill is emitted as ONE <Text> node
 * with chalk-embedded color codes, matching the Notifications.tsx
 * pattern. An earlier version used three sibling <Text> elements
 * inside a <Box>; Ink's wrap/truncate boundary on horizontal flex
 * layout occasionally rendered ghost remnants of the previous frame
 * underneath the new pill on state changes, producing visible
 * "two pills" duplicates like '⏸ Goal paused1. 在…⏸ Goal paused: 1. 在…'.
 * Single-Text rendering side-steps that layout pass entirely.
 */

import * as React from 'react'
import chalk from 'chalk'
import { Text } from '../../ink.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { stringWidth } from '../../ink/stringWidth.js'
import { useGoalState } from '../../hooks/useGoalState.js'

function truncateByColumns(s: string, maxCols: number): string {
  if (stringWidth(s) <= maxCols) return s
  let acc = ''
  let cols = 0
  for (const ch of s) {
    const w = stringWidth(ch)
    if (cols + w > maxCols - 1) break
    acc += ch
    cols += w
  }
  return acc + '…'
}

type Props = {
  /** True when a query is in-flight — adds a "(working)" marker so the
   * user can tell the turn count hasn't ticked because the AI is still
   * cranking, not because nothing is happening. */
  isLoading?: boolean
}

export function GoalIndicator({ isLoading }: Props): React.ReactNode {
  const goal = useGoalState()
  const { columns } = useTerminalSize()
  if (!goal) return null
  if (goal.status !== 'active' && goal.status !== 'paused') return null

  const glyph = goal.status === 'active' ? '⊙' : '⏸'
  // axiomate theme colors aren't accessible to chalk; use the closest
  // raw ANSI colors (cyan ≈ success accent, yellow ≈ warning).
  const colorize = goal.status === 'active' ? chalk.cyan : chalk.yellow
  // maxTurns === 0 → "no budget" — show /∞ so the user knows the loop
  // won't auto-stop on turn count alone.
  const budget =
    goal.maxTurns > 0
      ? `${goal.turnsUsed}/${goal.maxTurns}`
      : `${goal.turnsUsed}/∞`
  const label =
    goal.status === 'active'
      ? `${glyph} Goal ${budget}`
      : `${glyph} Goal paused`

  // turnsUsed only ticks at evaluateAfterTurn (turn end); while a long
  // turn runs the count sits e.g. 0/20 for minutes. Marker tells the
  // user the wait is real work, not a hung loop.
  const working = isLoading && goal.status === 'active'

  const head = `${label}: `
  const suffix = working ? ' (working)' : ''
  const headWidth = stringWidth(head)
  const suffixWidth = stringWidth(suffix)
  // Reserve 1 col safety against off-by-one in stringWidth for ZWJ
  // sequences / emoji modifiers.
  const textCols = Math.max(8, columns - headWidth - suffixWidth - 1)
  const text = truncateByColumns(goal.goal, textCols)

  // Build the full visible string in one go so Ink emits exactly one
  // text node. Colored prefix + dim body + dim suffix all baked in via
  // chalk; dimColor handled by chalk.dim instead of <Text dimColor>.
  const line = colorize(head) + chalk.dim(text) + chalk.dim(suffix)

  return <Text wrap="truncate">{line}</Text>
}
