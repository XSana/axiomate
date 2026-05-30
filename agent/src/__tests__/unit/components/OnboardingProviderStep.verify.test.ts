import { describe, expect, it, vi } from 'vitest'

import { verifyOnboardingProviderApiKey } from '../../../components/OnboardingProviderStep.verify.js'
import type { RecoveryTraceSink } from '../../../services/api/recoveryTrace.js'

describe('verifyOnboardingProviderApiKey', () => {
  it('runs interactive verification with the Doctor recovery trace sink', async () => {
    const onRecoveryTrace = vi.fn() as unknown as RecoveryTraceSink
    const verify = vi.fn().mockResolvedValue(true)

    await expect(
      verifyOnboardingProviderApiKey({
        apiKey: 'sk-test',
        modelId: 'provider-model',
        verify,
        onRecoveryTrace,
      }),
    ).resolves.toBe(true)

    expect(verify).toHaveBeenCalledWith(
      'sk-test',
      false,
      onRecoveryTrace,
      'provider-model',
    )
  })
})
