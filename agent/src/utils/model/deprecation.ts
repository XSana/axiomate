/**
 * Model deprecation warnings — axiomate is provider-agnostic and does not
 * maintain a hardcoded retirement calendar for any specific provider. The
 * provider's API surfaces deprecation notices directly when the user sends
 * a request; we surface nothing proactively.
 */

export function getModelDeprecationWarning(
  _modelId: string | null,
): string | null {
  return null
}
