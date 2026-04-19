import { isEnvTruthy } from '../../utils/envUtils.js'
import { getInitialSettings } from '../../utils/settings/settings.js'

/**
 * Whether the Explore / Plan / Verification built-in agents are registered.
 * Opt-in because Verification in particular forces the main agent to spawn
 * it before finishing 3+ file changes — that's meaningful model cost users
 * shouldn't inherit silently.
 *
 * Env var wins over settings so ad-hoc runs can flip without touching config.
 */
export function isBuiltInAgentsEnabled(): boolean {
  if (isEnvTruthy(process.env.AXIOMATE_CODE_ENABLE_BUILT_IN_AGENTS)) return true
  return getInitialSettings()?.builtInAgentsEnabled === true
}
