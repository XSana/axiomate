let nativeModule = null
let loadAttempted = false
let scheme = 'axiomate'

function loadNative() {
  if (loadAttempted) return nativeModule
  loadAttempted = true

  if (process.platform !== 'darwin') return null

  const candidates = [
    './url-handler-mac-napi-axiomate.darwin-arm64.node',
    './url-handler-mac-napi-axiomate.darwin-x64.node',
    `./url-handler-mac-napi-axiomate.darwin-${process.arch}.node`,
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

module.exports.configure = function configure(config) {
  if (config.scheme) {
    scheme = config.scheme
  }
}

module.exports.waitForUrlEvent = function waitForUrlEvent(timeoutMs) {
  const mod = loadNative()
  if (!mod) return null

  const url = mod.waitForUrlEvent(timeoutMs)
  if (!url) return null

  // Validate URL matches configured scheme
  const prefix = scheme + '://'
  if (!url.startsWith(prefix)) return null

  return url
}
