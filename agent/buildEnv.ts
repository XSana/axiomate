/**
 * Spawn-env helper shared by build.ts / package-win.ts / package-mac.ts.
 *
 * pnpm forwards its full config to lifecycle scripts as `npm_config_*`
 * env vars, including pnpm-only keys (`_jsr-registry`, `shamefully-hoist`,
 * `verify-deps-before-run`, `recursive`, `npm-globalconfig`). When these
 * scripts shell out to `npx napi build` / `npx tsc`, the child is npm 11
 * which doesn't recognize those keys and prints
 * `npm warn Unknown env config "..."` for each, once per package — 5
 * lines × N packages per build = stderr spam that masks real output.
 *
 * Strategy:
 *  - Spread `process.env` into a fresh plain object.
 *  - Delete the known pnpm-only keys.
 *  - Pass as explicit `env:` to Bun.spawnSync. (Bun snapshots its own
 *    env; mutating `process.env` after spawn does NOT propagate.)
 *
 * Windows pitfalls handled:
 *  - `process.env` is a case-insensitive Proxy on win32 that surfaces
 *    both `Path` and `PATH`. Spreading typically keeps only one. Bun's
 *    spawn on win32 looks up `PATH` (uppercase) when resolving a bare
 *    command name like `npx`. We explicitly mirror PATH/Path so the
 *    child has both regardless of which case survived the spread.
 *
 * If pnpm adds new pnpm-only `npm_config_*` keys, extend the list
 * below. Verified against pnpm 10.33.2.
 */

const PNPM_ONLY_NPM_CONFIG_KEYS = [
  'npm_config__jsr_registry',
  'npm_config_recursive',
  'npm_config_shamefully_hoist',
  'npm_config_verify_deps_before_run',
  'npm_config_npm_globalconfig',
] as const

export function spawnEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>
  for (const k of PNPM_ONLY_NPM_CONFIG_KEYS) delete env[k]
  const pathVal = env.PATH ?? env.Path ?? process.env.PATH ?? process.env.Path
  if (pathVal !== undefined) {
    env.PATH = pathVal
    env.Path = pathVal
  }
  return env
}
