import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'template',
  description:
    'Manage vendor + model templates (custom thinking-config translations and per-model quirks)',
  argumentHint:
    '<vendor|model> [list | show <name> | new | delete <name>]',
  load: () => import('./template.js'),
} satisfies Command
