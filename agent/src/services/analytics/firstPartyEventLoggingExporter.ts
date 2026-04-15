// First-party event logging — Anthropic endpoint removed. No-op exporter.
import { type ExportResult, ExportResultCode } from '@opentelemetry/core'
import type { LogRecordExporter, ReadableLogRecord } from '@opentelemetry/sdk-logs'

export class FirstPartyEventLoggingExporter implements LogRecordExporter {
  constructor(_options?: Record<string, unknown>) {}
  export(logs: ReadableLogRecord[], resultCallback: (result: ExportResult) => void): void {
    void logs
    resultCallback({ code: ExportResultCode.SUCCESS })
  }
  async shutdown(): Promise<void> {}
  async forceFlush(): Promise<void> {}
}
