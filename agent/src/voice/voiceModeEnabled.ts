import { isVoiceTranscriptionAvailable } from '../services/voiceTranscription.js'

/**
 * Voice mode is available when the user has configured a speech-to-text
 * provider in ~/.axiomate.json at voice.stt.
 */
export function isVoiceModeConfigured(): boolean {
  return isVoiceTranscriptionAvailable()
}

export function isVoiceModeEnabled(): boolean {
  return isVoiceModeConfigured()
}
