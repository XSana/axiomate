/**
 * Package axiomate as a standalone macOS executable.
 *
 * Steps:
 *   0. Clean dist/ and pre-build workspace packages that need compilation.
 *   1. Bun.build() API - bundle all JS (including npm deps) into a single file.
 *   2. bun build --compile - compile the bundled JS into dist/axiomate.
 *   3. Copy native .node/.dylib files alongside the executable.
 *   4. Build an ad-hoc-signed Axiomate.app with the same runtime layout.
 *
 * Usage: bun run package:mac
 */

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { arch, platform } from 'os'
import { basename, dirname, join, resolve } from 'path'
import { getBuildDefine, parseFeatures, printBuildFeatures } from './buildConfig.ts'
import { nativeExeDirPlugin } from './bunPluginNativeExeDir.ts'
import { makeComputerUseStubPlugin } from './bunPluginComputerUseStub.ts'
import { spawnEnv } from './buildEnv.ts'
import { resetDistDir } from './buildPaths.ts'
import { locatePlatformSubpackage } from './packageNatives.ts'
import type { BunPlugin } from 'bun'

if (platform() !== 'darwin') {
  console.error('package:mac must be run on macOS.')
  process.exit(1)
}

const agentDir = dirname(import.meta.path)
const pkg = JSON.parse(readFileSync(join(agentDir, 'package.json'), 'utf-8'))
const root = resolve(agentDir, '..')
const distDir = join(agentDir, 'dist')
const agentPackageJson = join(agentDir, 'package.json')
const macArch = arch() === 'arm64' ? 'arm64' : 'x64'
const sharpArch = arch() === 'arm64' ? 'arm64' : 'x64'
const nodePlatformArch = `darwin-${macArch}`
const rustTarget = arch() === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
const keepBundledCli = process.env.AXIOMATE_KEEP_PACKAGED_CLI === '1'
const sharpMacRuntimeName = `sharp-darwin-${sharpArch}.node`
const appBundleId = 'com.axiomate.axiomate'
const appBundleDir = join(distDir, 'Axiomate.app')
const appContentsDir = join(appBundleDir, 'Contents')
const appMacOSDir = join(appContentsDir, 'MacOS')
const appResourcesDir = join(appContentsDir, 'Resources')
const bundleVersion = String(pkg.version || '0.1.0').match(/^\d+(?:\.\d+)*/)?.[0] ?? '1'

let versionChangelog = ''
try {
  versionChangelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf-8')
} catch {
  // CHANGELOG.md not found; release notes will be empty.
}

function runBuildStep(label: string, command: string[], cwd: string) {
  // See `buildEnv.ts` — clean env so child npx/tsc don't print
  // `Unknown env config` warnings for pnpm-only keys.
  console.log(`  Building ${label} ...`)
  const proc = Bun.spawnSync(command, {
    cwd,
    env: spawnEnv(),
    stdio: ['inherit', 'inherit', 'inherit'],
  })
  if (proc.exitCode !== 0) {
    console.error(`  ERROR ${label} failed`)
    process.exit(1)
  }
  console.log(`  OK ${label}`)
}

function buildTscWorkspace(name: string) {
  runBuildStep(`${name} (tsc)`, ['npx', 'tsc', '-p', 'tsconfig.json'], join(root, name))
}

function buildNapiWorkspace(name: string) {
  const generatedDts = '.napi-generated.d.ts'
  runBuildStep(
    `${name} (napi build ${rustTarget})`,
    ['npx', 'napi', 'build', '--release', '--target', rustTarget, '--dts', generatedDts],
    join(root, name),
  )
  rmSync(join(root, name, generatedDts), { force: true })
}

/**
 * Locate a platform-specific subpackage on disk via shared probe (see
 * packageNatives.ts), then copy the file at `subPath` into dist/. Returns
 * true on success so callers can chain post-copy steps (rpath fix-ups,
 * codesigning, etc.) only when the file actually arrived.
 */
function copyFromPlatformSubpackage(
  parentPkg: string,
  subPkg: string,
  subPath: string,
  destName = basename(subPath),
) {
  const srcPath = locatePlatformSubpackage(
    agentPackageJson,
    root,
    parentPkg,
    subPkg,
    subPath,
  )
  if (!srcPath) {
    console.log(`  SKIP ${subPkg}/${subPath} (not found)`)
    return false
  }
  copyFileSync(srcPath, join(distDir, destName))
  console.log(`  OK ${destName}`)
  return true
}

function copyWorkspaceNativeFiles(workspace: string) {
  const workspaceDir = join(root, workspace)
  const plainFile = `${workspace}.node`
  const platformFile = `${workspace}.${nodePlatformArch}.node`
  const preferredSource = existsSync(join(workspaceDir, platformFile))
    ? platformFile
    : existsSync(join(workspaceDir, plainFile))
      ? plainFile
      : null

  if (!preferredSource) {
    const fallback = readdirSync(workspaceDir).find(file => file.endsWith('.node'))
    if (!fallback) {
      console.log(`  SKIP ${workspace} native .node (not found)`)
      return
    }
    copyFileSync(join(workspaceDir, fallback), join(distDir, plainFile))
    console.log(`  OK ${plainFile} <- ${fallback}`)
    return
  }

  copyFileSync(join(workspaceDir, preferredSource), join(distDir, plainFile))
  console.log(
    preferredSource === plainFile
      ? `  OK ${plainFile}`
      : `  OK ${plainFile} <- ${preferredSource}`,
  )
}

function runOptionalStep(label: string, command: string[], cwd: string) {
  const proc = Bun.spawnSync(command, {
    cwd,
    env: spawnEnv(),
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  if (proc.exitCode === 0) {
    console.log(`  OK ${label}`)
  } else {
    console.log(`  SKIP ${label}`)
  }
}

const sharpMacRuntimePlugin: BunPlugin = {
  name: 'sharp-mac-runtime',
  setup(build) {
    build.onLoad({ filter: /sharp(?:[\\/]|-)lib[\\/]sharp\.js$/ }, () => ({
      contents:
        "'use strict';\n" +
        "const { dirname, join } = require('node:path');\n" +
        "const exeDir = dirname(process.execPath);\n" +
        "const runtimeName = " + JSON.stringify(sharpMacRuntimeName) + ";\n" +
        "try {\n" +
        "  module.exports = require(join(exeDir, runtimeName));\n" +
        "} catch (err) {\n" +
        "  const help = [\n" +
        "    'Could not load the \"sharp\" module using the darwin-arm64 runtime',\n" +
        "    err && err.message ? err.message : String(err),\n" +
        "    'Expected native file: ' + join(exeDir, runtimeName)\n" +
        "  ];\n" +
        "  throw new Error(help.join('\\n'));\n" +
        "}\n",
      loader: 'js',
    }))
  },
}

// -- Step 0: Pre-build workspace packages -------------------------------------

console.log('Step 0/5: Pre-building workspace packages ...')

console.log('  Cleaning dist/ ...')
resetDistDir(distDir)

buildTscWorkspace('clipboard-axiomate')
buildTscWorkspace('treeify-axiomate')
buildTscWorkspace('sandbox-axiomate')
buildTscWorkspace('mcpb-axiomate')
buildTscWorkspace('computer-use-mcp-axiomate')
buildTscWorkspace('browser-bridge-axiomate')
buildTscWorkspace('image-processor-axiomate')

buildNapiWorkspace('clipboard-axiomate')
buildNapiWorkspace('audio-capture-axiomate')
buildNapiWorkspace('modifiers-mac-napi-axiomate')
buildNapiWorkspace('url-handler-mac-napi-axiomate')
buildNapiWorkspace('computer-use-mac-napi-axiomate')

// -- Step 1: Bundle everything into a single JS file --------------------------

console.log('\nStep 1/5: Bundling all modules into dist/cli.js ...')

// DARWIN unlocks the computer-use module via `feature('DARWIN')` guards
// at the agent's call sites (setup.ts factory in getAllMcpConfigs,
// stopHooks.ts cleanup, query.ts abort cleanup). Always-on for mac
// packaging — the host needs the in-process MCP server registered.
const features = parseFeatures(Bun.argv, process.env, ['DARWIN'])
printBuildFeatures('package:mac', features)

const result = await Bun.build({
  entrypoints: ['src/entrypoints/cli.tsx'],
  outdir: 'dist',
  target: 'bun',
  format: 'esm',

  loader: {
    '.md': 'text',
    '.txt': 'text',
  },

  features,

  define: getBuildDefine(pkg, versionChangelog),

  // Bun compiled binaries resolve bundled JS from a virtual path, so runtime
  // npm packages should be bundled. Native addons are copied beside the binary.
  external: ['rtk-axiomate', 'agent-browser-axiomate'],

  // Rewrite literal .node imports to load from <exeDir>/<basename>.node
  // at runtime (Bun's virtual-path resolver can't reach the real files).
  // Computer-use stub disabled on darwin: real source tree is bundled.
  plugins: [nativeExeDirPlugin, sharpMacRuntimePlugin, makeComputerUseStubPlugin(false)],
})

if (!result.success) {
  console.error('Bundle failed:')
  for (const msg of result.logs) {
    console.error(msg)
  }
  process.exit(1)
}

for (const output of result.outputs) {
  console.log(`  ${output.path} (${(output.size / 1024 / 1024).toFixed(1)} MB)`)
}

// -- Step 2: Compile bundled JS into standalone executable --------------------

console.log('\nStep 2/5: Compiling dist/cli.js -> dist/axiomate ...')

const executablePath = join(distDir, 'axiomate')
const proc = Bun.spawnSync([
  Bun.argv[0], 'build',
  'dist/cli.js',
  '--compile',
  '--outfile', 'dist/axiomate',
  '--target', 'bun',
], {
  cwd: agentDir,
  stdio: ['inherit', 'inherit', 'inherit'],
  env: spawnEnv(),
})

if (proc.exitCode !== 0) {
  console.error(`Compile failed with exit code ${proc.exitCode}`)
  process.exit(1)
}

runOptionalStep(
  'removed Bun placeholder code signature',
  ['codesign', '--remove-signature', executablePath],
  agentDir,
)
runBuildStep('axiomate (ad-hoc codesign)', ['codesign', '--force', '--sign', '-', executablePath], agentDir)

// -- Step 3: Copy native .node/.dylib files alongside the executable ----------

console.log('\nStep 3/5: Copying native files ...')

copyFromPlatformSubpackage(
  'sharp',
  `@img/sharp-darwin-${sharpArch}`,
  `lib/${sharpMacRuntimeName}`,
  sharpMacRuntimeName,
)
if (
  copyFromPlatformSubpackage(
    'sharp',
    `@img/sharp-libvips-darwin-${sharpArch}`,
    'lib/libvips-cpp.42.dylib',
  )
) {
  runOptionalStep(
    `patched sharp rpath for libvips`,
    [
      'install_name_tool',
      '-change',
      '@rpath/libvips-cpp.42.dylib',
      '@loader_path/libvips-cpp.42.dylib',
      join(distDir, sharpMacRuntimeName),
    ],
    agentDir,
  )
}

copyFromPlatformSubpackage(
  '@nut-tree-fork/nut-js',
  '@nut-tree-fork/libnut-darwin',
  'build/Release/libnut.node',
)
copyFromPlatformSubpackage(
  '@nut-tree-fork/nut-js',
  '@nut-tree-fork/node-mac-permissions',
  'build/Release/permissions.node',
)
copyFromPlatformSubpackage(
  'node-screenshots',
  `node-screenshots-darwin-${macArch}`,
  `node-screenshots.${nodePlatformArch}.node`,
  'node-screenshots.node',
)

// Bundle ripgrep binary alongside the axiomate executable. See package-win.ts
// for full rationale — same pattern, platform-specific subpackage resolved
// at packaging time via packageNatives.ts, found at runtime via
// dirname(process.execPath).
copyFromPlatformSubpackage(
  '@vscode/ripgrep',
  `@vscode/ripgrep-darwin-${macArch}`,
  'bin/rg',
)

// Bundle rtk binary alongside the axiomate executable. See package-win.ts
// for full rationale on the workspace-package indirection.
{
  console.log('  Ensuring rtk-axiomate is built ...')
  const fetchResult = Bun.spawnSync(
    ['pnpm', '--filter', 'rtk-axiomate', 'run', 'build'],
    { cwd: root, env: spawnEnv(), stdio: ['ignore', 'inherit', 'inherit'] },
  )
  if (fetchResult.exitCode !== 0) {
    console.log('  ⊘ rtk-axiomate build failed — bundling skipped')
  } else {
    const rtkSrc = join(root, 'rtk-axiomate', 'bin', 'rtk')
    if (existsSync(rtkSrc)) {
      copyFileSync(rtkSrc, join(distDir, 'rtk'))
      console.log('  ✓ rtk')
    } else {
      console.log('  ⊘ rtk (rtk-axiomate/bin/ empty after build; bundling skipped)')
    }
  }
}

// Bundle agent-browser binary alongside the axiomate executable — same model
// as rtk/rg (agent-browser-axiomate/index.js + browser-bridge resolver).
{
  console.log('  Ensuring agent-browser-axiomate is built ...')
  const fetchResult = Bun.spawnSync(
    ['pnpm', '--filter', 'agent-browser-axiomate', 'run', 'build'],
    { cwd: root, env: spawnEnv(), stdio: ['ignore', 'inherit', 'inherit'] },
  )
  if (fetchResult.exitCode !== 0) {
    console.log('  ⊘ agent-browser-axiomate build failed — bundling skipped')
  } else {
    const abSrc = join(root, 'agent-browser-axiomate', 'bin', 'agent-browser')
    if (existsSync(abSrc)) {
      copyFileSync(abSrc, join(distDir, 'agent-browser'))
      console.log('  ✓ agent-browser')
    } else {
      console.log('  ⊘ agent-browser (agent-browser-axiomate/bin/ empty after build; bundling skipped)')
    }
  }
}

copyWorkspaceNativeFiles('clipboard-axiomate')
copyWorkspaceNativeFiles('audio-capture-axiomate')
copyWorkspaceNativeFiles('modifiers-mac-napi-axiomate')
copyWorkspaceNativeFiles('url-handler-mac-napi-axiomate')
copyWorkspaceNativeFiles('computer-use-mac-napi-axiomate')

// Bundle the macOS install helper beside the binaries. Since the release is not
// notarized (no Apple Developer cert), copies on other Macs get blocked by
// Gatekeeper / fail with "killed: 9". install.command un-quarantines, chmods,
// and ad-hoc re-signs every binary so it runs locally. Normalize to LF (the repo
// copy may carry CRLF on Windows checkouts) and mark it executable.
{
  const installScriptSrc = join(agentDir, 'resources', 'mac', 'install.command')
  if (existsSync(installScriptSrc)) {
    const installScriptDest = join(distDir, 'install.command')
    const normalized = readFileSync(installScriptSrc, 'utf-8').replace(/\r\n/g, '\n')
    writeFileSync(installScriptDest, normalized)
    chmodSync(installScriptDest, 0o755)
    console.log('  OK install.command')
  } else {
    console.log('  SKIP install.command (resources/install.command not found)')
  }
}

const bundledCliPath = join(distDir, 'cli.js')
if (existsSync(bundledCliPath)) {
  if (keepBundledCli) {
    console.log('  OK kept intermediate cli.js (AXIOMATE_KEEP_PACKAGED_CLI=1)')
  } else {
    unlinkSync(bundledCliPath)
    console.log('  OK removed intermediate cli.js')
  }
}

// -- Step 4: Build Axiomate.app -----------------------------------------------

console.log('\nStep 4/5: Building Axiomate.app ...')

const runtimeEntries = readdirSync(distDir, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name !== 'install.command')

rmSync(appBundleDir, { recursive: true, force: true })
mkdirSync(appMacOSDir, { recursive: true })
mkdirSync(appResourcesDir, { recursive: true })

for (const entry of runtimeEntries) {
  const source = join(distDir, entry.name)
  const destination = join(appMacOSDir, entry.name)
  copyFileSync(source, destination)
  chmodSync(destination, statSync(source).mode)
}

const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>Axiomate</string>
  <key>CFBundleExecutable</key>
  <string>axiomate</string>
  <key>CFBundleIconFile</key>
  <string>Axiomate.icns</string>
  <key>CFBundleIdentifier</key>
  <string>${appBundleId}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Axiomate</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${bundleVersion}</string>
  <key>CFBundleVersion</key>
  <string>${bundleVersion}</string>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.developer-tools</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSAppleEventsUsageDescription</key>
  <string>Axiomate opens your preferred terminal when launched from Finder.</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSMicrophoneUsageDescription</key>
  <string>Axiomate uses the microphone only when you start audio capture.</string>
  <key>NSScreenCaptureUsageDescription</key>
  <string>Axiomate captures the screen only when you use Computer Use.</string>
</dict>
</plist>
`
writeFileSync(join(appContentsDir, 'Info.plist'), infoPlist)
writeFileSync(join(appContentsDir, 'PkgInfo'), 'APPL????')

const iconSource = join(agentDir, 'resources', 'icon', 'axiomate.png')
const iconsetDir = join(appResourcesDir, 'Axiomate.iconset')
const iconPath = join(appResourcesDir, 'Axiomate.icns')
mkdirSync(iconsetDir, { recursive: true })
const iconVariants: Array<[string, number]> = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]
for (const [name, size] of iconVariants) {
  const result = Bun.spawnSync(
    ['sips', '-z', String(size), String(size), iconSource, '--out', join(iconsetDir, name)],
    { cwd: agentDir, env: spawnEnv(), stdio: ['ignore', 'ignore', 'inherit'] },
  )
  if (result.exitCode !== 0) {
    console.error(`  ERROR failed to create app icon variant ${name}`)
    process.exit(1)
  }
}
runBuildStep('Axiomate.icns', ['iconutil', '-c', 'icns', iconsetDir, '-o', iconPath], agentDir)
rmSync(iconsetDir, { recursive: true, force: true })

runBuildStep(
  'Axiomate.app (ad-hoc codesign)',
  ['codesign', '--force', '--deep', '--sign', '-', appBundleDir],
  agentDir,
)
runBuildStep(
  'Axiomate.app verification',
  ['codesign', '--verify', '--deep', '--strict', appBundleDir],
  agentDir,
)

console.log(`  OK ${appBundleDir}`)

// -- Step 5: Summary ----------------------------------------------------------

console.log('\nStep 5/5: Summary')
console.log('\nBuild complete.\n')

if (existsSync(executablePath)) {
  const stat = statSync(executablePath)
  console.log(`  ${executablePath}  (${(stat.size / 1024 / 1024).toFixed(1)} MB)`)
}

const distFiles = new Bun.Glob('*').scanSync(distDir)
let totalSize = 0
for (const file of distFiles) {
  const filePath = join(distDir, file)
  const s = statSync(filePath)
  if (s.isFile()) totalSize += s.size
}
console.log(`  Total dist/ size: ${(totalSize / 1024 / 1024).toFixed(1)} MB`)
