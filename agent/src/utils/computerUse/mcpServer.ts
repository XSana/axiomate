import {
  buildComputerUseTools,
  createComputerUseMcpServer,
} from 'computer-use-mcp-axiomate'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'

import { getChicagoCoordinateMode } from './gates.js'
import { getComputerUseHostAdapter } from './hostAdapter.js'
import { tryGetInstalledAppNames } from './installedApps.js'
import { buildSessionContext } from './wrapper.js'

/**
 * Construct the in-process MCP server. Delegates to the package's
 * `createComputerUseMcpServer` for the Server object + real CallTool handler
 * (wired against `buildSessionContext()`'s ctx so the dispatch closure holds
 * the session's lastScreenshot, lock state, allowlist getters, etc. for the
 * process lifetime).
 *
 * Then OVERRIDES the package's ListTools handler with one that includes
 * installed-app names in `request_access`'s description — the package's
 * factory doesn't take `installedAppNames`, but the renderer's app picker
 * needs the LLM to know which bundle ids exist.
 *
 * Async so the 1-second app-enumeration timeout doesn't block startup —
 * called from `setup.ts`'s factory inside `connectToServer`'s lazy branch.
 *
 * Real dispatch flows through the package-internal CallTool handler bound
 * to ctx. ctx getters/callbacks (`getAllowedApps`, `onPermissionRequest`,
 * `setToolJSX` via `tuc()`) read through the per-call `currentToolUseContext`
 * ref in `wrapper.tsx`, which `client.ts` updates before each callTool.
 */
export async function createComputerUseMcpServerForCli(): Promise<Server> {
  const adapter = getComputerUseHostAdapter()
  const coordinateMode = getChicagoCoordinateMode()
  const ctx = buildSessionContext()
  const server = createComputerUseMcpServer(adapter, coordinateMode, ctx)

  const installedAppNames = await tryGetInstalledAppNames()
  const tools = buildComputerUseTools(
    adapter.executor.capabilities,
    coordinateMode,
    installedAppNames,
  )
  server.setRequestHandler(ListToolsRequestSchema, async () =>
    adapter.isDisabled() ? { tools: [] } : { tools },
  )
  return server
}
