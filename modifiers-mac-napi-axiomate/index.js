let nativeModule = null
let loadAttempted = false

function loadNative() {
  if (loadAttempted) return nativeModule
  loadAttempted = true

  if (process.platform !== 'darwin') return null

  const candidates = [
    './modifiers-mac-napi-axiomate.darwin-arm64.node',
    './modifiers-mac-napi-axiomate.darwin-x64.node',
    `./modifiers-mac-napi-axiomate.darwin-${process.arch}.node`,
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

module.exports.getModifiers = function getModifiers() {
  const mod = loadNative()
  return mod ? mod.getModifiers() : []
}

module.exports.isModifierPressed = function isModifierPressed(modifier) {
  const mod = loadNative()
  return mod ? mod.isModifierPressed(modifier) : false
}

module.exports.prewarm = function prewarm() {
  loadNative()
}
