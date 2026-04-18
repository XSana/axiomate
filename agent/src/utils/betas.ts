/**
 * Beta headers — axiomate does not send any Anthropic beta headers by default.
 * Users can opt-in via the AXIOMATE_BETAS environment variable.
 *
 * Model capability checks (ISP, context management, etc.) are kept for
 * feature gating in other parts of the codebase.
 */
import memoize from 'lodash-es/memoize.js'
import { getSdkBetas } from '../bootstrap/state.js'
import { getModelCapabilityOverride } from './model/modelSupportOverrides.js'

export function filterAllowedSdkBetas(
  sdkBetas: string[] | undefined,
): string[] | undefined {
  // Pass through all SDK betas — no allowlist filtering
  if (!sdkBetas || sdkBetas.length === 0) {
    return undefined
  }
  return sdkBetas
}

export function modelSupportsISP(model: string): boolean {
  // Capabilities default to off; users opt in per-model via
  // AXIOMATE_MODEL_CAPABILITY_OVERRIDES.
  const override = getModelCapabilityOverride(model, 'interleaved_thinking')
  return override ?? false
}

/**
 * Returns beta headers for a model. Only includes user-specified betas
 * from AXIOMATE_BETAS env var — no automatic Anthropic beta headers.
 */
export const getAllModelBetas = memoize((_model: string): string[] => {
  const betaHeaders: string[] = []
  if (process.env.AXIOMATE_BETAS) {
    betaHeaders.push(
      ...process.env.AXIOMATE_BETAS.split(',')
        .map(_ => _.trim())
        .filter(Boolean),
    )
  }
  return betaHeaders
})

export const getModelBetas = memoize((model: string): string[] => {
  return getAllModelBetas(model)
})

export function getMergedBetas(model: string): string[] {
  const baseBetas = [...getModelBetas(model)]
  const sdkBetas = getSdkBetas()
  if (!sdkBetas || sdkBetas.length === 0) {
    return baseBetas
  }
  return [...baseBetas, ...sdkBetas.filter(b => !baseBetas.includes(b))]
}

export function clearBetasCaches(): void {
  getAllModelBetas.cache?.clear?.()
  getModelBetas.cache?.clear?.()
}
