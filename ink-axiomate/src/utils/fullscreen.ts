import { isEnvTruthy } from 'common-axiomate'

export function isMouseClicksDisabled(): boolean {
  return isEnvTruthy(process.env.INK_AXIOMATE_DISABLE_MOUSE_CLICKS)
}
