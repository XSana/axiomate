#!/usr/bin/env node
/**
 * Fetch the latest rtk binary for the HOST platform from
 * `axiomates/rtk` GitHub releases.
 *
 * Resolves the latest tag via /releases/latest at every run. The
 * resolved tag becomes the cache key; once a version is downloaded,
 * future runs against the same tag are cache hits. New tags trigger
 * fresh downloads automatically — no manual version pinning.
 *
 * `axiomates/rtk` is purpose-built for axiomate (we own both repos),
 * so "latest" is always something we intentionally cut.
 *
 * Offline fallback: if the GitHub API is unreachable, reuse the
 * freshest cached binary for this platform. Works even with no
 * network, as long as you've built once before.
 *
 * Fail-soft on first run with no network: prints a warning and exits 0.
 * The runtime resolver disables the feature silently when bin/ is empty.
 */

import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RTK_REPO = 'axiomates/rtk'
const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const target = hostTarget()
if (!target) {
  console.warn(`rtk-axiomate: unsupported platform ${process.platform}/${process.arch} — bundling skipped`)
  process.exit(0)
}

const { archive, binary } = archiveForTarget(target)
const binDir = join(packageDir, 'bin')
const binPath = join(binDir, binary)
const cacheRoot = join(packageDir, '.cache')

const tag = resolveLatestTag()
if (!tag) {
  // Offline / API blocked / rate-limited: fall back to whatever we
  // last downloaded. Better than disabling rtk wholesale.
  const stale = findFreshestCache()
  if (stale) {
    installFromCache(stale.binaryPath)
    console.log(`rtk-axiomate: GitHub unreachable, reused cache ${stale.tag}-${target}`)
    process.exit(0)
  }
  console.warn(`rtk-axiomate: could not resolve latest rtk tag and no local cache — bundling skipped`)
  process.exit(0)
}

const cacheDir = join(cacheRoot, `${tag}-${target}`)
const cacheBinary = join(cacheDir, binary)

if (existsSync(cacheBinary)) {
  installFromCache(cacheBinary)
  pruneOlderCaches(tag)
  console.log(`rtk-axiomate: reused cache ${tag}-${target}`)
  process.exit(0)
}

mkdirSync(cacheDir, { recursive: true })

const stage = mkdtempSync(join(tmpdir(), 'rtk-axiomate-'))
try {
  const archivePath = join(stage, archive)
  if (!downloadAsset(tag, archive, archivePath)) {
    console.warn(
      `rtk-axiomate: failed to download ${archive} from ${RTK_REPO}@${tag} — bundling skipped`,
    )
    process.exit(0)
  }
  if (!extract(archivePath, stage, binary)) {
    console.warn(`rtk-axiomate: archive ${archive} did not contain ${binary} — bundling skipped`)
    process.exit(0)
  }
  copyFileSync(join(stage, binary), cacheBinary)
  if (process.platform !== 'win32') chmodSync(cacheBinary, 0o755)
  installFromCache(cacheBinary)
  pruneOlderCaches(tag)
  console.log(`rtk-axiomate: fetched ${tag}-${target}`)
} finally {
  rmSync(stage, { recursive: true, force: true })
}

// ─────────────────────────────────────────────────────────────────────

function installFromCache(srcBinary) {
  mkdirSync(binDir, { recursive: true })
  copyFileSync(srcBinary, binPath)
  if (process.platform !== 'win32') chmodSync(binPath, 0o755)
}

/**
 * Delete every `.cache/<other-tag>-<target>/` directory, leaving only the
 * current tag's slot. Must be called AFTER the current tag's binary is
 * already installed to bin/ — otherwise an early prune would leave us
 * with no offline fallback if the subsequent install step fails.
 *
 * Only touches entries matching `-<target>` so cross-platform caches
 * (rare, but possible if a dev cross-compiles) are untouched.
 */
function pruneOlderCaches(currentTag) {
  if (!existsSync(cacheRoot)) return
  const suffix = `-${target}`
  const keepName = `${currentTag}${suffix}`
  for (const entry of readdirSync(cacheRoot)) {
    if (!entry.endsWith(suffix)) continue
    if (entry === keepName) continue
    const path = join(cacheRoot, entry)
    try {
      rmSync(path, { recursive: true, force: true })
    } catch (e) {
      // Best-effort; a stale cache dir doesn't break the build.
      console.warn(`rtk-axiomate: failed to prune ${entry}: ${e.message}`)
    }
  }
}

function findFreshestCache() {
  if (!existsSync(cacheRoot)) return null
  const suffix = `-${target}`
  const candidates = []
  for (const entry of readdirSync(cacheRoot)) {
    if (!entry.endsWith(suffix)) continue
    const tag = entry.slice(0, -suffix.length)
    const parsed = parseTag(tag)
    if (!parsed) continue // unrecognized tag format — not a fallback candidate
    const binaryPath = join(cacheRoot, entry, binary)
    if (existsSync(binaryPath)) {
      candidates.push({ tag, parsed, binaryPath })
    }
  }
  if (candidates.length === 0) return null
  // Sort descending by (major, minor, patch, respin) so candidates[0] is the
  // freshest. Numeric comparison avoids the lex-sort trap where '+9' > '+10'.
  candidates.sort((a, b) => compareTags(b.parsed, a.parsed))
  return candidates[0]
}

/**
 * Parse `axiomate-v<major>.<minor>.<patch>+<respin>` into a 4-tuple of
 * non-negative integers. Returns null on any deviation from that shape so
 * callers can skip unrecognized cache entries instead of mis-sorting them.
 */
function parseTag(tag) {
  const m = /^axiomate-v(\d+)\.(\d+)\.(\d+)\+(\d+)$/.exec(tag)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] : null
}

function compareTags(a, b) {
  for (let i = 0; i < 4; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  }
  return 0
}

function resolveLatestTag() {
  const url = `https://api.github.com/repos/${RTK_REPO}/releases/latest`
  const result = spawnSync(
    'curl',
    [
      '--silent', '--show-error', '--fail', '--location',
      '--retry', '2', '--retry-delay', '1',
      '--max-time', '8',
      '-H', 'Accept: application/vnd.github+json',
      url,
    ],
    { encoding: 'utf-8' },
  )
  if (result.status !== 0) return null
  try {
    const payload = JSON.parse(result.stdout)
    return typeof payload?.tag_name === 'string' && payload.tag_name
      ? payload.tag_name
      : null
  } catch {
    return null
  }
}

function hostTarget() {
  const arch = process.arch
  if (process.platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc'
  if (process.platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin'
  if (process.platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin'
  if (process.platform === 'linux' && arch === 'x64') return 'x86_64-unknown-linux-musl'
  if (process.platform === 'linux' && arch === 'arm64') return 'aarch64-unknown-linux-gnu'
  return null
}

function archiveForTarget(target) {
  if (target === 'x86_64-pc-windows-msvc') {
    return { archive: `rtk-${target}.zip`, binary: 'rtk.exe' }
  }
  return { archive: `rtk-${target}.tar.gz`, binary: 'rtk' }
}

function downloadAsset(version, archive, destFile) {
  const url = `https://github.com/${RTK_REPO}/releases/download/${version}/${archive}`
  const result = spawnSync(
    'curl',
    [
      '--silent', '--show-error', '--fail', '--location',
      '--retry', '3', '--retry-delay', '2',
      '--output', destFile,
      url,
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  )
  return result.status === 0
}

function extract(archivePath, outDir, binary) {
  if (archivePath.endsWith('.zip')) {
    if (process.platform === 'win32') {
      const result = spawnSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -Path '${archivePath}' -DestinationPath '${outDir}' -Force`,
        ],
        { stdio: 'inherit' },
      )
      if (result.status !== 0) return false
    } else {
      const result = spawnSync('unzip', ['-o', archivePath, '-d', outDir], { stdio: 'inherit' })
      if (result.status !== 0) return false
    }
  } else {
    const result = spawnSync('tar', ['-xzf', archivePath, '-C', outDir], { stdio: 'inherit' })
    if (result.status !== 0) return false
  }
  return existsSync(join(outDir, binary))
}
