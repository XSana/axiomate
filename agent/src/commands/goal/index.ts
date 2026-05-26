import type { Command } from '../../commands.js'

const goal = {
  type: 'local-jsx',
  name: 'goal',
  description: 'Set a persistent goal; AI loops until done',
  argumentHint: '[<text> | status | pause | resume | clear]',
  // Pure local op (state read/write + at most one enqueue) — no LLM
  // call. Runs even while a goal-loop turn is in flight so users can
  // /goal status / pause / clear without waiting for the current turn.
  immediate: true,
  load: () => import('./goal.js'),
} satisfies Command

export default goal
