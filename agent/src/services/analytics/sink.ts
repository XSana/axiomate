/**
 * Analytics sink — stub implementation.
 * All analytics backends (Datadog, 1P) have been removed.
 * The sink is kept for interface compatibility but does nothing.
 */

import { logEventTo1P, shouldSampleEvent } from './firstPartyEventLogger.js'
import { attachAnalyticsSink } from './index.js'

type LogEventMetadata = { [key: string]: boolean | number | undefined }

function logEventImpl(eventName: string, metadata: LogEventMetadata): void {
  const sampleResult = shouldSampleEvent(eventName)
  if (sampleResult === 0) return

  const metadataWithSampleRate =
    sampleResult !== null
      ? { ...metadata, sample_rate: sampleResult }
      : metadata

  logEventTo1P(eventName, metadataWithSampleRate)
}

function logEventAsyncImpl(
  eventName: string,
  metadata: LogEventMetadata,
): Promise<void> {
  logEventImpl(eventName, metadata)
  return Promise.resolve()
}

export function initializeAnalyticsGates(): void {}

export function initializeAnalyticsSink(): void {
  attachAnalyticsSink({
    logEvent: logEventImpl,
    logEventAsync: logEventAsyncImpl,
  })
}
