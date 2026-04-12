import { useAppState } from '../state/AppState.js'
import { isVoiceModeConfigured } from '../voice/voiceModeEnabled.js'

/**
 * Voice is active when the user toggled it on and a speech-to-text provider is
 * configured in ~/.axiomate.json at voice.stt.
 */
export function useVoiceEnabled(): boolean {
  const userIntent = useAppState(s => s.settings.voiceEnabled === true)
  return userIntent && isVoiceModeConfigured()
}
