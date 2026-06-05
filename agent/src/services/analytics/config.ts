/**
 * Shared analytics configuration
 *
 * Common logic for determining when analytics should be disabled.
 */

import { isTelemetryDisabled } from '../../utils/privacyLevel.js'

/**
 * Check if analytics operations should be disabled
 *
 * Analytics is disabled in the following cases:
 * - Test environment (NODE_ENV === 'test')
 * - Privacy level is no-telemetry or essential-traffic
 */
export function isAnalyticsDisabled(): boolean {
  return process.env.NODE_ENV === 'test' || isTelemetryDisabled()
}
