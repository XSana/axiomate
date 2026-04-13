import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { POWERSHELL_TOOL_NAME } from '../../tools/PowerShellTool/toolName.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../envUtils.js'
import { getPlatform } from '../platform.js'

export const SHELL_TOOL_NAMES: string[] = [BASH_TOOL_NAME, POWERSHELL_TOOL_NAME]

function getPowerShellToolEnv(): string | undefined {
  return process.env.AXIOMATE_USE_POWERSHELL_TOOL
}

export function isPowerShellToolEnvConfigured(): boolean {
  return getPowerShellToolEnv() !== undefined
}

/**
 * Runtime gate for PowerShellTool. Windows-only (the permission engine uses
 * Win32-specific path normalizations). Ant defaults on (opt-out via env=0);
 * external defaults off (opt-in via env=1). Controlled with
 * AXIOMATE_USE_POWERSHELL_TOOL.
 *
 * Used by tools.ts (tool-list visibility), processBashCommand (! routing),
 * and promptShellExecution (skill frontmatter routing) so the gate is
 * consistent across all paths that invoke PowerShellTool.call().
 */
export function isPowerShellToolEnabled(): boolean {
  if (getPlatform() !== 'windows') return false
  const powerShellToolEnv = getPowerShellToolEnv()
  return isEnvTruthy(powerShellToolEnv)
}
