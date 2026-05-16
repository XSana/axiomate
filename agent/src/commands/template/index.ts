import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'template',
  description:
    'Manage custom vendor templates (translates neutral thinking config to wire fields)',
  argumentHint: '[list | show <name> | new | delete <name>]',
  load: () => import('./template.js'),
} satisfies Command
