/**
 * Undercover mode — no-op stubs (ant-only feature removed).
 */

export function isUndercover(): boolean {
  return false
}

export function getUndercoverInstructions(): string {
  return ''
}

export function shouldShowUndercoverAutoNotice(): boolean {
  return false
}
