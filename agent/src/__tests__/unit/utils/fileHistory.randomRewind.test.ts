import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { dirname, join, relative } from 'path'
import { randomUUID, type UUID } from 'crypto'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  setIsInteractive,
  setOriginalCwd,
} from '../../../bootstrap/state.js'
import {
  buildRewindCodeRows,
  fileHistoryMakeSnapshot,
  fileHistoryRewind,
  resetFileHistoryDraft,
  _setRewindTestHooksForTesting,
  type FileHistoryState,
} from '../../../utils/fileHistory.js'
import { listCodeAnchors } from '../../../utils/checkpoints/listCodeAnchors.js'
import { ensureStore } from '../../../utils/checkpoints/store.js'
import { runCheckpointGit } from '../../../utils/checkpoints/git.js'
import { indexPath, normalizePath, projectHash } from '../../../utils/checkpoints/paths.js'
import { stageWorktreeSnapshotIndex } from '../../../utils/checkpoints/snapshotIndex.js'
import { LABEL_PRE_REWIND } from '../../../utils/checkpoints/reason.js'


const GIT_BACKED_TEST_TIMEOUT_MS = 60_000
type TreeModel = Map<string, string>

let tmpRoot: string
let workTree: string
let originalConfigDir: string | undefined
let originalCwd: string

beforeEach(() => {
  originalConfigDir = process.env.AXIOMATE_CONFIG_DIR
  originalCwd = process.cwd()
  tmpRoot = mkdtempSync(join(tmpdir(), 'axiomate-rrw-'))
  process.env.AXIOMATE_CONFIG_DIR = join(tmpRoot, 'config')
  workTree = mkdtempSync(join(tmpRoot, 'wt-'))
  setOriginalCwd(workTree)
  setIsInteractive(true)
  resetFileHistoryDraft()
})

afterEach(() => {
  delete process.env.AXIOMATE_CODE_DISABLE_FILE_CHECKPOINTING
  if (originalConfigDir === undefined) delete process.env.AXIOMATE_CONFIG_DIR
  else process.env.AXIOMATE_CONFIG_DIR = originalConfigDir
  setOriginalCwd(originalCwd)
  setIsInteractive(false)
  resetFileHistoryDraft()
  _setRewindTestHooksForTesting(undefined)
  rmSync(tmpRoot, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  })
})

function makeStateHolder(): {
  state: () => FileHistoryState
  updater: (f: (prev: FileHistoryState) => FileHistoryState) => void
} {
  let state: FileHistoryState = {
    snapshotMessageIds: new Set<UUID>(),
    checkpointLabelsByHash: new Map(),
    trackedFiles: new Set<string>(),
    snapshotSequence: 0,
  }
  return {
    state: () => state,
    updater: f => {
      state = f(state)
    },
  }
}

const uuid = (): UUID => randomUUID()

async function turn(holder: ReturnType<typeof makeStateHolder>, files: readonly string[]): Promise<UUID> {
  const id = uuid()
  await fileHistoryMakeSnapshot(holder.updater, id)
  void files
  return id
}

async function hashFor(messageId: UUID): Promise<string> {
  const anchors = await listCodeAnchors(workTree, { withStats: false })
  const a = anchors.find(x => x.messageId === messageId)
  if (!a) throw new Error(`no anchor for ${messageId}`)
  return a.gitHash
}

async function expectWorktreeTreeEquals(gitHash: string): Promise<void> {
  const storeResult = await ensureStore()
  if (storeResult.ok === false) throw new Error(`ensureStore failed: ${storeResult.reason}`)
  const canonical = normalizePath(workTree)
  const indexFile = indexPath(projectHash(canonical))
  const stage = await stageWorktreeSnapshotIndex({
    store: storeResult.store,
    workTree: canonical,
    indexFile,
  })
  if (stage.ok === false) throw new Error(`stage failed: ${stage.message}`)
  const diff = await runCheckpointGit(
    ['diff', '--cached', '--quiet', gitHash, '--'],
    { store: storeResult.store, workTree: canonical, indexFile, allowedExitCodes: new Set([1]) },
  )
  expect(diff.ok).toBe(true)
  if (diff.ok === false) return
  expect(diff.code).toBe(0)
}

function writeFile(path: string, content: string): void {
  const abs = join(workTree, path)
  removePath(path)
  const parts = path.split('/')
  for (let i = 1; i < parts.length; i++) {
    const parent = join(workTree, ...parts.slice(0, i))
    if (existsSync(parent) && statSync(parent).isFile()) removePath(parts.slice(0, i).join('/'))
  }
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

function removePath(path: string): void {
  rmSync(join(workTree, path), { recursive: true, force: true })
}

function listFiles(root = workTree): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const abs = join(root, entry.name)
    if (entry.isDirectory()) return listFiles(abs)
    return relative(workTree, abs).replaceAll('\\', '/')
  })
}

function readTree(): TreeModel {
  const tree: TreeModel = new Map()
  for (const path of listFiles()) tree.set(path, readFileSync(join(workTree, path), 'utf8'))
  return tree
}

function expectTreeModelEquals(expected: TreeModel, trace: string[]): void {
  expect([...readTree()].sort(), trace.join('\n')).toEqual([...expected].sort())
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const pathPool = [
  'a.txt',
  'b.txt',
  'dir/c.txt',
  'dir/deep/d.txt',
  'space dir/e file.txt',
  'unicode/é.txt',
  'punct/[1]-x!.txt',
  'replace/node',
  'replace/node/child.txt',
]

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]!
}

function randomInitialTree(seed: number): TreeModel {
  const random = seededRandom(seed)
  const tree: TreeModel = new Map()
  for (const path of pathPool) {
    if (path.startsWith('replace/node')) continue
    if (random() < 0.45) tree.set(path, `target:${seed}:${path}\n`)
  }
  if (tree.size === 0) tree.set('a.txt', `target:${seed}:a\n`)
  return tree
}

function mutateRandomly(seed: number): string[] {
  const random = seededRandom(seed * 17 + 3)
  const trace: string[] = []
  for (let i = 0; i < 20; i++) {
    const op = Math.floor(random() * 5)
    const path = pick(pathPool, random)
    if (op === 0) {
      removePath(path)
      trace.push(`${i}: delete ${path}`)
    } else if (op === 1) {
      writeFile(path, `current:${seed}:${i}:${path}\n`)
      trace.push(`${i}: write ${path}`)
    } else if (op === 2) {
      const to = pick(pathPool.filter(p => p !== path), random)
      if (existsSync(join(workTree, path)) && statSync(join(workTree, path)).isFile()) {
        const content = readFileSync(join(workTree, path), 'utf8')
        removePath(path)
        writeFile(to, content)
      }
      trace.push(`${i}: rename ${path}`)
    } else if (op === 3) {
      removePath('replace/node')
      writeFile('replace/node', `current:file:${seed}:${i}\n`)
      trace.push(`${i}: replace subtree with file`)
    } else {
      removePath('replace/node')
      writeFile('replace/node/child.txt', `current:dir:${seed}:${i}\n`)
      trace.push(`${i}: replace file with subtree`)
    }
  }
  return trace
}

function rowForHash(rows: ReturnType<typeof buildRewindCodeRows> extends Promise<infer T> ? T : never, hash: string) {
  return rows.find(r => r.restoreHash === hash)
}

describe('fileHistory random rewind', () => {
  for (const seed of [101, 202, 303, 404, 505, 606, 707, 808, 909, 1010]) {
    test(`rewinds generated tree mutation seed ${seed}`, async () => {
      const target = randomInitialTree(seed)
      const holder = makeStateHolder()

      // Write target files and checkpoint
      for (const [path, content] of target) writeFile(path, content)
      const targetId = await turn(holder, [...target.keys()])
      const targetHash = await hashFor(targetId)

      // Mutate disk and checkpoint
      const trace = mutateRandomly(seed)
      const currentId = await turn(holder, [])

      // Rewind to target
      await fileHistoryRewind(holder.updater, targetHash, 'random rewind test')
      void currentId

      // Verify disk equals target
      expectTreeModelEquals(
        target,
        [`seed=${seed}`, `targetHash=${targetHash.slice(0, 8)}`, ...trace],
      )
      await expectWorktreeTreeEquals(targetHash)

      // Verify rows: target row must be present
      const anchors = await listCodeAnchors(workTree, { withStats: true, withBodies: true })
      const rows = await buildRewindCodeRows(anchors, holder.state().checkpointLabelsByHash)
      const targetRow = rowForHash(rows, targetHash)
      expect(targetRow, `seed=${seed}: target row missing`).toBeDefined()
      expect(targetRow!.kind).toBe('turn')

      // Pre-rewind anchor is optional: no-changes safety snapshots skip the commit.
      // This is correct behavior when the rewind-time disk tree equals a recent
      // checkpoint tip. We check if it exists; if so, verify its properties.
      const preRewindAnchors = anchors.filter(a => a.subject.includes(`:${LABEL_PRE_REWIND}:`))
      if (preRewindAnchors.length > 0) {
        const preRewindRow = rowForHash(rows, preRewindAnchors[0]!.gitHash)
        expect(preRewindRow, `seed=${seed}: pre-rewind row missing from rows`).toBeDefined()
        expect(preRewindRow!.kind).toBe('pre-rewind')
        expect(preRewindRow!.isSynthetic).toBe(true)
        expect(preRewindRow!.labelText).toContain('↶ Before rewind')
      }
    }, GIT_BACKED_TEST_TIMEOUT_MS)
  }
})
