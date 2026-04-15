import type { LoadedPlugin, PluginError } from '../../types/plugin.js'
import type { MCPServerConnection } from '../../services/mcp/types.js'

export type UnifiedInstalledItem =
  | {
      type: 'plugin'
      id: string
      name: string
      description?: string
      marketplace: string
      isEnabled: boolean
      errorCount: number
      errors: PluginError[]
      plugin: LoadedPlugin
      pendingToggle?: 'will-enable' | 'will-disable'
      pendingEnable?: boolean
      pendingUpdate?: boolean
      pluginId?: string
      scope: string
    }
  | {
      type: 'flagged-plugin'
      id: string
      name: string
      marketplace: string
      pluginId?: string
      scope: string
      reason: string
      text: string
      flaggedAt: string
    }
  | {
      type: 'failed-plugin'
      id: string
      name: string
      marketplace: string
      errorCount: number
      errors: PluginError[]
      pluginId?: string
      scope: string
    }
  | {
      type: 'mcp-server'
      id: string
      name: string
      description?: string
      status: 'connected' | 'disabled' | 'pending' | 'needs-auth' | 'failed'
      indented?: boolean
      serverName?: string
      scope: string
      client: MCPServerConnection
    }
  | {
      type: 'mcp'
      id: string
      name: string
      description?: string
      status: 'connected' | 'disabled' | 'pending' | 'needs-auth' | 'failed'
      indented?: boolean
      scope: string
      client: MCPServerConnection
    }
