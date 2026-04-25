import type { CoordinateMode, CuSubGates } from 'computer-use-mcp-axiomate'
import { getInitialSettings } from '../settings/settings.js'

type ChicagoConfig = CuSubGates & {
  enabled: boolean
  coordinateMode: CoordinateMode
}

const DEFAULTS: ChicagoConfig = {
  enabled: false,
  pixelValidation: false,
  clipboardPasteMultiline: true,
  mouseAnimation: true,
  hideBeforeAction: true,
  autoTargetDisplay: true,
  clipboardGuard: true,
  coordinateMode: 'pixels',
}

function readConfig(): ChicagoConfig {
  // Hard-guard non-darwin: the native module assumes macOS APIs
  // (SCContentFilter / NSWorkspace / TCC) plus pbcopy/pbpaste in executor.ts.
  // Settings on Win/Linux are accepted but ignored — no degraded mode.
  if (process.platform !== 'darwin') {
    return { ...DEFAULTS, enabled: false }
  }
  const settings = getInitialSettings()
  return {
    ...DEFAULTS,
    enabled: settings.computerUseEnabled ?? false,
  }
}

export function getChicagoEnabled(): boolean {
  // axiomate has no subscription system — enabled is purely config-driven
  return readConfig().enabled
}

export function getChicagoSubGates(): CuSubGates {
  const { enabled: _e, coordinateMode: _c, ...subGates } = readConfig()
  return subGates
}

let frozenCoordinateMode: CoordinateMode | undefined
export function getChicagoCoordinateMode(): CoordinateMode {
  frozenCoordinateMode ??= readConfig().coordinateMode
  return frozenCoordinateMode
}
