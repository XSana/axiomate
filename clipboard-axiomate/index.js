// JS entry point: Rust NAPI on macOS (sync fast path), fallback for all platforms (async).

let nativeModule = null
let loadAttempted = false

function loadNative() {
  if (loadAttempted) return nativeModule
  loadAttempted = true

  if (process.platform !== 'darwin') return null

  const candidates = [
    './clipboard-axiomate.darwin-arm64.node',
    './clipboard-axiomate.darwin-x64.node',
    `./clipboard-axiomate.darwin-${process.arch}.node`,
  ]

  for (const candidate of candidates) {
    try {
      nativeModule = require(candidate)
      return nativeModule
    } catch {
      // try next
    }
  }
  return null
}

// Lazy-load fallback module
let fallbackModule = null
function getFallback() {
  if (!fallbackModule) {
    fallbackModule = require('./dist/fallback.js')
  }
  return fallbackModule
}

// --- Sync API (macOS NAPI only, returns false/null on other platforms) ---

module.exports.hasClipboardImage = function hasClipboardImage() {
  const mod = loadNative()
  return mod ? mod.hasClipboardImage() : false
}

module.exports.readClipboardImage = function readClipboardImage(maxWidth, maxHeight) {
  const mod = loadNative()
  return mod ? mod.readClipboardImage(maxWidth, maxHeight) : null
}

// --- Async API (cross-platform: NAPI when available, fallback otherwise) ---

module.exports.hasClipboardImageAsync = async function hasClipboardImageAsync() {
  const mod = loadNative()
  if (mod) return mod.hasClipboardImage()
  return getFallback().hasClipboardImageAsync()
}

module.exports.readClipboardImageAsync = async function readClipboardImageAsync(maxWidth, maxHeight) {
  const mod = loadNative()
  if (mod) return mod.readClipboardImage(maxWidth, maxHeight)
  return getFallback().readClipboardImageAsync(maxWidth, maxHeight)
}

module.exports.readClipboardText = async function readClipboardText() {
  return getFallback().readClipboardText()
}
