import { verifyApiKey } from '../services/api/llm.js'
import { appendApiRecoveryTrace } from '../services/api/apiRecoveryDiagnostics.js'
import type { RecoveryTraceSink } from '../services/api/recoveryTrace.js'

type VerifyApiKeyFn = typeof verifyApiKey

export async function verifyOnboardingProviderApiKey({
  apiKey,
  modelId,
  verify = verifyApiKey,
  onRecoveryTrace = appendApiRecoveryTrace,
}: {
  apiKey: string
  modelId: string
  verify?: VerifyApiKeyFn
  onRecoveryTrace?: RecoveryTraceSink
}): Promise<boolean> {
  return verify(apiKey, false, onRecoveryTrace, modelId)
}
