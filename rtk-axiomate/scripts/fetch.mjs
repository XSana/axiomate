#!/usr/bin/env node
/**
 * Fetch the rtk binary for the HOST platform from `axiomates/rtk`
 * GitHub releases and place it at `../bin/<rtk-binary-name>`.
 *
 * Pinned to the `rtkVersion` field in this package's package.json.
 * Versioned-archive download is cached by extracting to a sibling
 * `.cache/<rtkVersion>-<target>/` dir; bin/ is a symlink-or-copy of
 * the cache hit. Re-runs with the same version are no-ops.
 *
 * Fail-soft: if the release isn't available yet (no network, tag
 * missing, asset shape changed), prints a warning and exits 0. The
 * runtime resolver disables the feature silently when bin/ is empty.
 *
 * Why fetch instead of `cargo build`: the binary is provided by an
 * external repo (axiomates/rtk). Building it here would pull in a
 * Rust toolchain dependency for a feature that's off by default.
 */

import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RTK_REPO = 'axiomates/rtk'
const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf-8'))

if (!pkg.rtkVersion) {
  console.warn('rtk-axiomate: missing `rtkVersion` field in package.json — bundling skipped')
  process.exit(0)
}

const version = pkg.rtkVersion
const target = hostTarget()
if (!target) {
  console.warn(`rtk-axiomate: unsupported platform ${process.platform}/${process.arch} — bundling skipped`)
  process.exit(0)
}

const { archive, binary } = archiveForTarget(target)
const binDir = join(packageDir, 'bin')
const binPath = join(binDir, binary)
const cacheRoot = join(packageDir, '.cache')
const cacheDir = join(cacheRoot, `${version}-${target}`)
const cacheBinary = join(cacheDir, binary)

// Cache hit?
if (existsSync(cacheBinary)) {
  if (!existsSync(binPath)) {
    mkdirSync(binDir, { recursive: true })
    copyFileSync(cacheBinary, binPath)
    if (process.platform !== 'win32') chmodSync(binPath, 0o755)
  }
  console.log(`rtk-axiomate: reused cache ${version}-${target}`)
  process.exit(0)
}

// Need to download.
mkdirSync(cacheDir, { recursive: true })
mkdirSync(binDir, { recursive: true })

const stage = mkdtempSync(join(tmpdir(), 'rtk-axiomate-'))
try {
  const archivePath = join(stage, archive)
  if (!downloadAsset(version, archive, archivePath)) {
    console.warn(
      `rtk-axiomate: failed to download ${archive} from ${RTK_REPO}@${version} — bundling skipped`,
    )
    process.exit(0)
  }
  if (!extract(archivePath, stage, binary)) {
    console.warn(`rtk-axiomate: archive ${archive} did not contain ${binary} — bundling skipped`)
    process.exit(0)
  }
  copyFileSync(join(stage, binary), cacheBinary)
  copyFileSync(cacheBinary, binPath)
  if (process.platform !== 'win32') {
    chmodSync(cacheBinary, 0o755)
    chmodSync(binPath, 0o755)
  }
  console.log(`rtk-axiomate: fetched ${version}-${target}`)
} finally {
  rmSync(stage, { recursive: true, force: true })
}

// ─────────────────────────────────────────────────────────────────────

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
      '--silent',
      '--show-error',
      '--fail',
      '--location',
      '--retry', '3',
      '--retry-delay', '2',
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
