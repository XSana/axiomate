import { isInBundledMode } from '../../utils/bundledMode.js';
import { getCurrentInstallationType } from '../../utils/doctorDiagnostic.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { useStartupNotification } from './useStartupNotification.js';
const NPM_DEPRECATION_MESSAGE = 'Axiomate has switched from npm to native installer. Run `axiomate install` or see https://github.com/axiomates/axiomate for more options.';
export function useNpmDeprecationNotification() {
  // Disabled for axiomate — no native installer migration needed
}
async function _temp() {
  if (isInBundledMode() || isEnvTruthy(process.env.DISABLE_INSTALLATION_CHECKS)) {
    return null;
  }
  const installationType = await getCurrentInstallationType();
  if (installationType === "development") {
    return null;
  }
  return {
    timeoutMs: 15000,
    key: "npm-deprecation-warning",
    text: NPM_DEPRECATION_MESSAGE,
    color: "warning",
    priority: "high" as const
  };
}
