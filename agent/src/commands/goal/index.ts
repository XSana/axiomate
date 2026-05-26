import type { Command } from '../../commands.js'

const goal = {
  type: 'local-jsx',
  name: 'goal',
  description:
    'Set / inspect a persistent cross-turn goal. After each turn a judge model decides whether the goal is done and re-queues a continuation otherwise.',
  argumentHint: '[<text> | status | pause | resume | clear]',
  load: () => import('./goal.js'),
} satisfies Command

export default goal
