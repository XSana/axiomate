import { isEnvTruthy } from 'utils-axiomate'

export function isMouseClicksDisabled(): boolean {
  return isEnvTruthy(process.env.INK_AXIOMATE_DISABLE_MOUSE_CLICKS)
}
