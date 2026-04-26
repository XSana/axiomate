let nativeModule = null
let loadAttempted = false
// Captures *why* loadNative() returned null. Surfaced via getLoadError() so
// callers (e.g. captureWindow's diagnostic) can show the real cause —
// "file not found", "dyld arch mismatch", etc. — instead of a generic
// "binding not available" message that hides build/install issues.
let loadError = null

function loadNative() {
  if (loadAttempted) return nativeModule
  loadAttempted = true

  if (process.platform !== 'darwin') {
    loadError = `not darwin (process.platform=${process.platform})`
    return null
  }

  const candidates = [
    './computer-use-mac-napi-axiomate.darwin-arm64.node',
    './computer-use-mac-napi-axiomate.darwin-x64.node',
    `./computer-use-mac-napi-axiomate.darwin-${process.arch}.node`,
  ]

  const errors = []
  for (const candidate of candidates) {
    try {
      nativeModule = require(candidate)
      return nativeModule
    } catch (e) {
      errors.push(`${candidate}: ${e && e.message ? e.message : String(e)}`)
    }
  }
  loadError = `tried ${candidates.length} candidate(s): ${errors.join(' | ')}`
  return null
}

module.exports.getLoadError = function getLoadError() {
  return loadError
}

module.exports.isAvailable = function isAvailable() {
  return loadNative() !== null
}

// ── NSRunningApplication hide / unhide (prepareDisplay support) ────────────

module.exports.hideApp = async function hideApp(bundleId) {
  const mod = loadNative()
  if (!mod) return false
  return mod.hideApp(bundleId)
}

module.exports.unhideApp = async function unhideApp(bundleId) {
  const mod = loadNative()
  if (!mod) return false
  return mod.unhideApp(bundleId)
}

module.exports.activateApp = async function activateApp(bundleId) {
  const mod = loadNative()
  if (!mod) return false
  return mod.activateApp(bundleId)
}

// ── CGEventTap (global Esc hotkey) ─────────────────────────────────────────

module.exports.registerEscapeHotkey = function registerEscapeHotkey(callback) {
  const mod = loadNative()
  if (!mod) return false
  return mod.registerEscapeHotkey(callback)
}

module.exports.unregisterEscapeHotkey = function unregisterEscapeHotkey() {
  const mod = loadNative()
  if (!mod) return
  mod.unregisterEscapeHotkey()
}

module.exports.notifyExpectedEscape = function notifyExpectedEscape() {
  const mod = loadNative()
  if (!mod) return
  mod.notifyExpectedEscape()
}

// ── SCContentFilter (allowlist-filtered screenshot) ────────────────────────

module.exports.captureExcluding = async function captureExcluding(opts) {
  const mod = loadNative()
  if (!mod) return null
  return mod.captureExcluding(opts)
}

module.exports.captureWindow = async function captureWindow(bundleId) {
  const mod = loadNative()
  if (!mod) {
    return {
      image: null,
      diagnostic: `native binding load failed: ${loadError ?? 'unknown'}`,
    }
  }
  return mod.captureWindow(bundleId)
}

module.exports.prewarm = function prewarm() {
  loadNative()
}
