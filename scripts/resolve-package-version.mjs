import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagePath = resolve(root, 'agent', 'package.json')
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
const refType = process.env.GITHUB_REF_TYPE
const refName = process.env.GITHUB_REF_NAME
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

let version = packageJson.version
let source = 'package.json'

if (refType === 'tag') {
  if (typeof refName !== 'string' || !refName.startsWith('v')) {
    throw new Error(`Package tags must start with v; received: ${refName ?? '(missing)'}`)
  }
  version = refName.slice(1)
  source = `tag ${refName}`
}

if (typeof version !== 'string' || !semverPattern.test(version)) {
  throw new Error(`Invalid package version from ${source}: ${String(version)}`)
}

if (refType === 'tag' && packageJson.version !== version) {
  packageJson.version = version
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
}

const bundleVersion = version.match(/^\d+(?:\.\d+)*/)?.[0] ?? '1'
const arch = process.arch

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `version=${version}\nbundle_version=${bundleVersion}\narch=${arch}\nsource=${source}\n`,
  )
}

console.log(`Resolved package version ${version} from ${source}`)
