/**
 * Get available model upgrade for more context
 * Returns null if no upgrade available or user already has max context
 */
function getAvailableUpgrade(): {
  alias: string
  name: string
  multiplier: number
} | null {
  return null
}

/**
 * Get upgrade message for different contexts
 */
export function getUpgradeMessage(context: 'warning' | 'tip'): string | null {
  const upgrade = getAvailableUpgrade()
  if (!upgrade) return null

  switch (context) {
    case 'warning':
      return `/model ${upgrade.alias}`
    case 'tip':
      return `Tip: You have access to ${upgrade.name} with ${upgrade.multiplier}x more context`
    default:
      return null
  }
}
