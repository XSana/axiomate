/**
 * Native-package locators shared by package-win.ts / package-mac.ts.
 *
 * pnpm's strict hoist (pnpm 11+) places platform-specific subpackages
 * (sharp's @img/sharp-*, nut-js's @nut-tree-fork/libnut-*, ripgrep's
 * @vscode/ripgrep-*, node-screenshots's platform .node, etc.) in one of:
 *
 *   1. Same node_modules as the parent (peer layout):
 *      `.pnpm/<parent>@<ver>/node_modules/<sub>/...`
 *   2. Separate .pnpm store entry (when sub is an optionalDep that pnpm
 *      installed standalone): `.pnpm/<sub>@<ver>/node_modules/<sub>/...`
 *
 * We probe both layouts with prefix matching on the versioned segment so
 * we never hardcode a versioned path that drifts with lockfile updates.
 * The packager scripts only run on the build machine — paths returned
 * here are absolute, used only for copyFileSync into the project-relative
 * `dist/` dir. None of these absolute paths end up baked into the
 * produced executable; runtime native loading walks `dirname(process.
 * execPath)` via the nativeExeDirPlugin instead.
 */

import { existsSync, readdirSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'

export function locatePlatformSubpackage(
  agentPackageJson: string,
  repoRoot: string,
  parentPkg: string,
  subPkg: string,
  subPath: string,
): string | null {
  const requireFromAgent = createRequire(agentPackageJson)

  // Layout 1: peer of parent. parentRoot is `.../node_modules/<parent>` (or
  // `.../node_modules/@scope/<name>`); walk up to its enclosing node_modules
  // and into subPkg.
  try {
    const parentRoot = dirname(
      requireFromAgent.resolve(`${parentPkg}/package.json`),
    )
    const parentNodeModules = parentPkg.startsWith('@')
      ? join(parentRoot, '..', '..')
      : join(parentRoot, '..')
    const candidate = join(parentNodeModules, subPkg, subPath)
    if (existsSync(candidate)) return candidate
  } catch {
    // parent not resolvable from agent (e.g. @vscode/ripgrep has a
    // restrictive exports map that hides package.json) — fall through.
  }

  // Layout 2: separate .pnpm store entry. Subpackage's `@scope/name` becomes
  // `@scope+name` in the .pnpm directory naming convention.
  const pnpmDir = join(repoRoot, 'node_modules', '.pnpm')
  if (existsSync(pnpmDir)) {
    const prefix = subPkg.replace('/', '+') + '@'
    for (const entry of readdirSync(pnpmDir)) {
      if (!entry.startsWith(prefix)) continue
      const candidate = join(pnpmDir, entry, 'node_modules', subPkg, subPath)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}
