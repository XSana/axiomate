// Node.js runtime replacement for Bun's compile-time MACRO constants.
// In Bun, MACRO.* values are injected at bundle time via the define plugin.
// Here we read version from package.json and provide sensible defaults.

import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))

let version = '0.0.0'
try {
  const pkg = JSON.parse(readFileSync(join(__dir, '../../package.json'), 'utf-8'))
  version = pkg.version ?? version
} catch {
  // package.json not found — use default
}

export const MACRO = {
  VERSION: version,
  BUILD_TIME: new Date().toISOString(),
  PACKAGE_URL: 'axiomate',
  NATIVE_PACKAGE_URL: 'axiomate',
  FEEDBACK_CHANNEL: 'https://github.com/user/axiomate/issues',
  ISSUES_EXPLAINER: 'Report issues at https://github.com/user/axiomate/issues',
  VERSION_CHANGELOG: '',
}
