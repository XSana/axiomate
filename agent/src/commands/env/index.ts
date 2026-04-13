import { feature } from 'bun:bundle'
import type { Command } from '../../commands.js'

const env = {
  type: 'local',
  name: 'env',
  description: 'Show environment variables',
  isEnabled: () => { if (feature('DEV')) return true; return false },
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call: async () => ({ type: 'text' as const, value: '(not implemented)' }) }),
} satisfies Command

export default env
