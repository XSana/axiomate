// Shared LSP types consumed by plugin.ts and lspPluginIntegration.ts.

export type LspServerState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'error'
  | 'stopping'

export interface LspServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
  rootPath?: string
  workspaceFolder?: string
  initializationOptions?: unknown
  settings?: unknown
  transport?: 'stdio' | 'socket'
  restartOnCrash?: boolean
  shutdownTimeout?: number
  startupTimeout?: number
  maxRestarts?: number
  extensionToLanguage?: Record<string, string>
  [key: string]: unknown
}

export interface ScopedLspServerConfig extends LspServerConfig {
  scope?: string
  source?: string
}
