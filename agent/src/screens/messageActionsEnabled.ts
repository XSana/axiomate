import { isEnvTruthy } from '../utils/envUtils.js'
import { getInitialSettings } from '../utils/settings/settings.js'

/**
 * Whether the message-actions mode (shift+up to enter a menu for past
 * messages: Enter to edit / expand, C to copy, P to copy primary field)
 * is active. Opt-in because the shift+up shortcut would otherwise surprise
 * users unfamiliar with the mode.
 *
 * Env var wins over settings so ad-hoc runs can flip without touching config.
 */
export function isMessageActionsEnabled(): boolean {
  if (isEnvTruthy(process.env.AXIOMATE_CODE_ENABLE_MESSAGE_ACTIONS)) return true
  return getInitialSettings()?.messageActionsEnabled === true
}
