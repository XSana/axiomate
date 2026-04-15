import type { StdoutMessage } from '../../entrypoints/sdk/controlTypes.js'

/**
 * Common interface for session transports (WebSocket, SSE, Hybrid).
 */
export interface Transport {
  connect(): Promise<void>
  write(message: StdoutMessage): Promise<void>
  isConnectedStatus(): boolean
  isClosedStatus(): boolean
  setOnData(callback: (data: string) => void): void
  setOnClose(callback: (closeCode?: number) => void): void
  close(): void
}
