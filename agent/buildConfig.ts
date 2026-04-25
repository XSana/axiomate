/**
 * Shared build configuration for agent/build.ts, package-win.ts, package-mac.ts.
 *
 * - `parseFeatures(argv, env, default)` resolves the compile-time feature
 *   set (consumed by `bun:bundle`'s `feature()` intrinsic) from CLI args or
 *   env var. Precedence: argv > env > default.
 * - `getBuildDefine(pkg, changelog)` returns the MACRO/define map shared by
 *   all three scripts — single source of truth so packaged and local builds
 *   inject the same constants.
 * - `printBuildFeatures(label, features)` logs the active feature set once
 *   at build start so the artifact's flavor is never ambiguous.
 *
 * CLI forms accepted:
 *   --features=DEV,EXPERIMENTAL
 *   --features=            (empty value → clears default)
 *   --features=            (alias: bare `--features` stays as-is, treated as unset)
 *
 * Env var:
 *   AXIOMATE_BUILD_FEATURES=DEV,EXPERIMENTAL
 *   AXIOMATE_BUILD_FEATURES=            (empty → clears default)
 *   (unset → falls back to default)
 *
 * Precedence: any `--features=` occurrence on argv wins. Then env var.
 * Then the `defaultFeatures` arg passed by the calling script.
 */

const KNOWN_FEATURES = new Set(['DEV', 'DARWIN'])

/** Parse features from CLI args + env + default, in that priority order. */
export function parseFeatures(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  defaultFeatures: readonly string[],
): string[] {
  // Check argv first. Accept `--features=X,Y` only; bare `--features` is
  // ambiguous and ignored (user must give a value or empty string).
  for (const arg of argv) {
    if (arg.startsWith('--features=')) {
      return splitFeatures(arg.slice('--features='.length))
    }
  }

  // Env var next.
  const envValue = env.AXIOMATE_BUILD_FEATURES
  if (envValue !== undefined) {
    return splitFeatures(envValue)
  }

  // Default.
  return [...defaultFeatures]
}

function splitFeatures(raw: string): string[] {
  const features = raw
    .split(',')
    .map(f => f.trim())
    .filter(Boolean)
  for (const f of features) {
    if (!KNOWN_FEATURES.has(f)) {
      // biome-ignore lint/suspicious/noConsole: build-time warning
      console.warn(
        `[buildConfig] Unknown feature '${f}' — passed through to bun:bundle. Known features: ${[...KNOWN_FEATURES].join(', ')}.`,
      )
    }
  }
  return features
}

/**
 * Build-time MACRO/define constants shared by all three build scripts.
 * Centralized here so a change (e.g., adding a new MACRO) applies everywhere.
 */
export function getBuildDefine(
  pkg: { version?: string; name?: string; description?: string },
  versionChangelog: string,
): Record<string, string> {
  return {
    'MACRO.VERSION': JSON.stringify(pkg.version || '0.1.0'),
    'MACRO.BUILD_TIME': JSON.stringify(new Date().toISOString()),
    'MACRO.PACKAGE_URL': JSON.stringify(pkg.name || 'axiomate'),
    'MACRO.NATIVE_PACKAGE_URL': JSON.stringify(pkg.name || 'axiomate'),
    'MACRO.FEEDBACK_CHANNEL': JSON.stringify(
      'https://github.com/user/axiomate/issues',
    ),
    'MACRO.ISSUES_EXPLAINER': JSON.stringify(
      'Report issues at https://github.com/user/axiomate/issues',
    ),
    'MACRO.VERSION_CHANGELOG': JSON.stringify(versionChangelog),
    // Force production mode for React (development mode's useEffectEvent
    // dispatcher doesn't work with our bundled reconciler).
    'process.env.NODE_ENV': JSON.stringify('production'),
  }
}

/**
 * Emit a one-line banner at build start so the artifact's flavor is visible
 * in build logs. Example:
 *   [build] features: DEV
 *   [package:win] features: (none)
 */
export function printBuildFeatures(
  label: string,
  features: readonly string[],
): void {
  const text = features.length > 0 ? features.join(', ') : '(none)'
  // biome-ignore lint/suspicious/noConsole: build-time status line
  console.log(`[${label}] features: ${text}`)
}
