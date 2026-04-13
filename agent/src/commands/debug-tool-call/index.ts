import { feature } from 'bun:bundle'
import type { Command } from '../../commands.js'

const debugToolCall = {
  type: 'local',
  name: 'debug-tool-call',
  description: 'Debug tool call execution',
  isEnabled: () => { if (feature('DEV')) return true; return false },
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call: async () => ({ type: 'text' as const, value: '(not implemented)' }) }),
} satisfies Command

export default debugToolCall
