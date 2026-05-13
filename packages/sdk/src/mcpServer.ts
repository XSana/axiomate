import type { AnyZodRawShape, McpSdkServerConfig, McpSdkServerInstance, SdkMcpToolDefinition } from './types/index.js'

type CreateSdkMcpServerOptions = {
  name: string
  version?: string
  tools?: SdkMcpToolDefinition<any>[]
  alwaysLoad?: boolean
}

export function createSdkMcpServer(options: CreateSdkMcpServerOptions): McpSdkServerConfig {
  const instance: McpSdkServerInstance = {
    name: options.name,
    version: options.version,
    tools: options.tools ?? [],
    alwaysLoad: options.alwaysLoad,
  }

  return {
    type: 'sdk',
    serverInstance: instance,
  }
}
