import { isEnvTruthy } from '../../utils/envUtils.js'
import { getInitialSettings } from '../../utils/settings/settings.js'

/**
 * Whether the advanced search dialogs (Ctrl+Shift+P Quick Open,
 * Ctrl+Shift+F Global Search, Ctrl+R modal history picker) are active.
 * When unset, Ctrl+R falls back to the stable classic backward-search
 * UI in useHistorySearch.
 *
 * Env var wins over settings so ad-hoc runs can flip without touching config.
 */
export function isGlobalSearchEnabled(): boolean {
  if (isEnvTruthy(process.env.AXIOMATE_CODE_ENABLE_GLOBAL_SEARCH)) return true
  return getInitialSettings()?.globalSearchEnabled === true
}
