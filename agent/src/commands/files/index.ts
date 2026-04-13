import { feature } from 'bun:bundle'
import type { Command } from '../../commands.js'

const files = {
  type: 'local',
  name: 'files',
  description: 'List all files currently in context',
  isEnabled: () => { if (feature('DEV')) return true; return false },
  supportsNonInteractive: true,
  load: () => import('./files.js'),
} satisfies Command

export default files
