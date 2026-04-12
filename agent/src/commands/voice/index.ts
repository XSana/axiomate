import type { Command } from '../../commands.js'
import { isVoiceModeConfigured } from '../../voice/voiceModeEnabled.js'

const voice = {
  type: 'local',
  name: 'voice',
  description: 'Toggle voice mode',
  isEnabled: () => isVoiceModeConfigured(),
  get isHidden() {
    return !isVoiceModeConfigured()
  },
  supportsNonInteractive: false,
  load: () => import('./voice.js'),
} satisfies Command

export default voice
