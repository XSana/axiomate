import { feature } from 'bun:bundle'
import type { Command } from '../../commands.js'

const thinkback = {
  type: 'local-jsx',
  name: 'think-back',
  description: 'Your 2025 Axiomate Year in Review',
  isEnabled: () => feature('DEV'),
  load: () => import('./thinkback.js'),
} satisfies Command

export default thinkback
