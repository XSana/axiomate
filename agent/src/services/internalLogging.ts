import type { ToolPermissionContext } from '../Tool.js'

/**
 * Get the OCI container ID from within a running container.
 * Returns null for non-ant builds.
 */
export async function getContainerId(): Promise<string | null> {
  return null
}

/**
 * Logs an event with the current namespace and tool permission context.
 * No-op for non-ant builds.
 */
export async function logPermissionContextForAnts(
  _toolPermissionContext: ToolPermissionContext | null,
  _moment: 'summary' | 'initialization',
): Promise<void> {
  // no-op: ant-only logging removed
}
