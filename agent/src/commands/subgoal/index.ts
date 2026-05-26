import type { Command } from '../../commands.js'

const subgoal = {
  type: 'local-jsx',
  name: 'subgoal',
  description:
    'Add / remove / list mid-loop criteria the judge must also satisfy for the standing /goal to be DONE.',
  argumentHint: '[<text> | remove <n> | clear]',
  load: () => import('./subgoal.js'),
} satisfies Command

export default subgoal
