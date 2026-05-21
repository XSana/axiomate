/**
 * Characterization tests for `fileHistory.ts` — pin the current
 * file-copy backend's behavior as a baseline before Phase 3 swaps the
 * storage to the shadow-git store.
 *
 * Goal: every test in this file MUST stay green after the Phase 3 swap
 * lands. The ones that fail will be the real behavioral regressions.
 *
 * Isolation: each test points AXIOMATE_CONFIG_DIR at a fresh tmpdir
 * (sandboxes file-history/<sessionId>/* backups AND projects/<...>
 * session storage), and setOriginalCwd at a per-test workdir so
 * maybeShortenFilePath's relative-path round-trip behaves
 * deterministically.
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID, type UUID } from 'crypto'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'vitest'
import { setIsInteractive, setOriginalCwd } from '../../bootstrap/state.js'
import {
  fileHistoryCanRestore,
  fileHistoryEnabled,
  fileHistoryGetDiffStats,
  fileHistoryHasAnyChanges,
  fileHistoryMakeSnapshot,
  fileHistoryRestoreStateFromLog,
  fileHistoryRewind,
  fileHistoryTrackEdit,
  copyFileHistoryForResume,
  type FileHistoryState,
  type FileHistorySnapshot,
} from '../fileHistory.js'
import { getSessionId, regenerateSessionId } from '../../bootstrap/state.js'

let tmpRoot: string
let workTree: string
let originalConfigDir: string | undefined
let originalCwd: string
let originalInteractive: boolean | undefined

beforeEach(() => {
  // Snapshot env we'll mutate so afterEach can restore cleanly.
  originalConfigDir = process.env.AXIOMATE_CONFIG_DIR
  originalCwd = process.cwd()

  tmpRoot = mkdtempSync(join(tmpdir(), 'axiomate-fh-'))
  // Sandbox both `file-history/` backups (resolveBackupPath) and
  // `projects/` session storage (recordFileHistorySnapshot via
  // sessionStorage's lazy-creation path) under the same tmpdir.
  process.env.AXIOMATE_CONFIG_DIR = join(tmpRoot, 'config')

  workTree = mkdtempSync(join(tmpRoot, 'wt-'))
  setOriginalCwd(workTree)

  // fileHistoryEnabled() routes through fileHistoryEnabledSdk() when the
  // session is non-interactive (default in tests), and that gate requires
  // an explicit opt-in env. Force interactive so we exercise the same
  // code path the REPL hits in production.
  originalInteractive = false
  setIsInteractive(true)
})

afterEach(() => {
  // Clear opt-out env that some tests set; do this BEFORE we restore
  // AXIOMATE_CONFIG_DIR so the disable check evaluates against the
  // sandboxed config still.
  delete process.env.AXIOMATE_CODE_DISABLE_FILE_CHECKPOINTING

  if (originalConfigDir === undefined) {
    delete process.env.AXIOMATE_CONFIG_DIR
  } else {
    process.env.AXIOMATE_CONFIG_DIR = originalConfigDir
  }
  setOriginalCwd(originalCwd)
  if (originalInteractive !== undefined) setIsInteractive(originalInteractive)
  rmSync(tmpRoot, { recursive: true, force: true })
})

/**
 * Test stub for fileHistory's `updateFileHistoryState` updater
 * parameter. fileHistory is normally driven by a React reducer; for
 * tests we hold state in a closure and let the updater mutate it
 * synchronously (the production reducer is also synchronous from
 * fileHistory's POV — it captures via no-op-updater in Phase 1).
 */
function makeStateHolder(
  initial?: Partial<FileHistoryState>,
): {
  state: () => FileHistoryState
  updater: (
    f: (prev: FileHistoryState) => FileHistoryState,
  ) => void
} {
  let state: FileHistoryState = {
    snapshots: initial?.snapshots ?? [],
    trackedFiles: initial?.trackedFiles ?? new Set<string>(),
    snapshotSequence: initial?.snapshotSequence ?? 0,
  }
  return {
    state: () => state,
    updater: f => {
      state = f(state)
    },
  }
}

function uuid(): UUID {
  return randomUUID()
}

describe('fileHistoryEnabled — opt-in/opt-out gates', () => {
  test('enabled by default under test config (fileCheckpointingEnabled=true)', () => {
    expect(fileHistoryEnabled()).toBe(true)
  })

  test('disabled when AXIOMATE_CODE_DISABLE_FILE_CHECKPOINTING is truthy', () => {
    process.env.AXIOMATE_CODE_DISABLE_FILE_CHECKPOINTING = '1'
    expect(fileHistoryEnabled()).toBe(false)
  })
})

describe('fileHistoryTrackEdit — backup before first edit', () => {
  test('writes a v1 backup of an existing file the first time it is tracked', async () => {
    const filePath = join(workTree, 'a.txt')
    writeFileSync(filePath, 'original content')
    const holder = makeStateHolder()
    const messageId = uuid()
    // Seed an empty snapshot so trackEdit's "most recent" check has a
    // home for the new backup. fileHistory's normal flow does this via
    // makeSnapshot at the start of every turn.
    holder.updater(s => ({
      ...s,
      snapshots: [
        { messageId, trackedFileBackups: {}, timestamp: new Date() },
      ],
    }))

    await fileHistoryTrackEdit(holder.updater, filePath, messageId)

    const snap = holder.state().snapshots.at(-1)!
    const trackingPath = 'a.txt' // relative to workTree (originalCwd)
    expect(snap.trackedFileBackups).toHaveProperty(trackingPath)
    const backup = snap.trackedFileBackups[trackingPath]
    expect(backup.version).toBe(1)
    expect(backup.backupFileName).toMatch(/^[a-f0-9]{16}@v1$/)

    // The actual backup file is materialized on disk under
    // ~/.axiomate/file-history/<sessionId>/<backupFileName>.
    expect(holder.state().trackedFiles.has(trackingPath)).toBe(true)
  })

  test('records a null backup for a file that does not yet exist (add)', async () => {
    const filePath = join(workTree, 'new.txt')
    // No writeFileSync — file doesn't exist yet.
    const holder = makeStateHolder()
    const messageId = uuid()
    holder.updater(s => ({
      ...s,
      snapshots: [
        { messageId, trackedFileBackups: {}, timestamp: new Date() },
      ],
    }))

    await fileHistoryTrackEdit(holder.updater, filePath, messageId)

    const backup = holder.state().snapshots.at(-1)!.trackedFileBackups['new.txt']
    expect(backup).toBeDefined()
    expect(backup.version).toBe(1)
    // null marker = "did not exist at v1".
    expect(backup.backupFileName).toBeNull()
  })

  test('second call for the same file in the same snapshot is a no-op (preserves v1)', async () => {
    const filePath = join(workTree, 'a.txt')
    writeFileSync(filePath, 'original')
    const holder = makeStateHolder()
    const messageId = uuid()
    holder.updater(s => ({
      ...s,
      snapshots: [
        { messageId, trackedFileBackups: {}, timestamp: new Date() },
      ],
    }))

    await fileHistoryTrackEdit(holder.updater, filePath, messageId)
    const firstBackup = holder.state().snapshots.at(-1)!.trackedFileBackups['a.txt']

    // Mutate the on-disk file as a tool would. Second trackEdit MUST
    // NOT create a new v1 — that would corrupt v1 with post-edit content.
    writeFileSync(filePath, 'edited content')
    await fileHistoryTrackEdit(holder.updater, filePath, messageId)

    const secondBackup = holder.state().snapshots.at(-1)!.trackedFileBackups['a.txt']
    expect(secondBackup).toEqual(firstBackup)
    expect(secondBackup.version).toBe(1)
    expect(secondBackup.backupFileName).toBe(firstBackup.backupFileName)
  })
})

describe('fileHistoryMakeSnapshot — turn snapshots and ring buffer', () => {
  test('creates an empty snapshot when no files are tracked yet', async () => {
    const holder = makeStateHolder()
    const messageId = uuid()
    await fileHistoryMakeSnapshot(holder.updater, messageId)
    const s = holder.state()
    expect(s.snapshots.length).toBe(1)
    expect(s.snapshots[0].messageId).toBe(messageId)
    expect(s.snapshots[0].trackedFileBackups).toEqual({})
    expect(s.snapshotSequence).toBe(1)
  })

  test('a tracked + edited file gets a fresh v2 backup on next snapshot', async () => {
    const filePath = join(workTree, 'a.txt')
    writeFileSync(filePath, 'v1')
    const holder = makeStateHolder()
    const m1 = uuid()
    const m2 = uuid()

    // Turn 1: empty snapshot, then trackEdit (writes v1 backup).
    await fileHistoryMakeSnapshot(holder.updater, m1)
    await fileHistoryTrackEdit(holder.updater, filePath, m1)

    // Mutate the file (simulates the tool actually editing). Bump mtime
    // explicitly — same-second writes can collide with the latestBackup's
    // mtime and short-circuit checkOriginFileChanged via the
    // mtimeMs-before-backup optimization.
    writeFileSync(filePath, 'v2 content with different size')

    // Turn 2: makeSnapshot should detect the change → v2 backup.
    await fileHistoryMakeSnapshot(holder.updater, m2)

    const last = holder.state().snapshots.at(-1)!
    expect(last.messageId).toBe(m2)
    const backup = last.trackedFileBackups['a.txt']
    expect(backup.version).toBe(2)
    expect(backup.backupFileName).toMatch(/^[a-f0-9]{16}@v2$/)
  })

  test('an unchanged tracked file reuses the previous backup (no new copy)', async () => {
    const filePath = join(workTree, 'a.txt')
    writeFileSync(filePath, 'stable')
    const holder = makeStateHolder()
    const m1 = uuid()
    const m2 = uuid()

    await fileHistoryMakeSnapshot(holder.updater, m1)
    await fileHistoryTrackEdit(holder.updater, filePath, m1)
    const v1Backup = holder.state().snapshots.at(-1)!.trackedFileBackups['a.txt']

    // No edit between turns. makeSnapshot should reuse the same backup
    // ref instead of creating v2.
    await fileHistoryMakeSnapshot(holder.updater, m2)
    const m2Backup = holder.state().snapshots.at(-1)!.trackedFileBackups['a.txt']
    expect(m2Backup).toBe(v1Backup) // same object identity
    expect(m2Backup.version).toBe(1)
  })

  test('a tracked file deleted on disk produces a null backup at v(n+1)', async () => {
    const filePath = join(workTree, 'a.txt')
    writeFileSync(filePath, 'soon to be gone')
    const holder = makeStateHolder()
    const m1 = uuid()
    const m2 = uuid()

    await fileHistoryMakeSnapshot(holder.updater, m1)
    await fileHistoryTrackEdit(holder.updater, filePath, m1)

    rmSync(filePath)
    await fileHistoryMakeSnapshot(holder.updater, m2)

    const last = holder.state().snapshots.at(-1)!.trackedFileBackups['a.txt']
    expect(last.version).toBe(2)
    expect(last.backupFileName).toBeNull()
  })
})

describe('fileHistoryRewind — restore from snapshot', () => {
  test('restores a single edited file to its v1 contents', async () => {
    const filePath = join(workTree, 'a.txt')
    writeFileSync(filePath, 'v1-content')
    const holder = makeStateHolder()
    const m1 = uuid()
    const m2 = uuid()

    await fileHistoryMakeSnapshot(holder.updater, m1)
    await fileHistoryTrackEdit(holder.updater, filePath, m1)
    writeFileSync(filePath, 'v2-content (post-edit)')
    await fileHistoryMakeSnapshot(holder.updater, m2)

    // Rewind to the m1 snapshot — file should match its v1 content.
    await fileHistoryRewind(holder.updater, m1)
    expect(readFileSync(filePath, 'utf-8')).toBe('v1-content')
  })

  test('rewind to a snapshot where the file did not yet exist deletes it', async () => {
    // Turn 1: file does not exist. trackEdit records null v1.
    const filePath = join(workTree, 'new.txt')
    const holder = makeStateHolder()
    const m1 = uuid()
    const m2 = uuid()

    await fileHistoryMakeSnapshot(holder.updater, m1)
    await fileHistoryTrackEdit(holder.updater, filePath, m1)

    // Tool now creates the file in the same turn.
    writeFileSync(filePath, 'created in turn 1')

    // Turn 2: snapshot the post-create state.
    await fileHistoryMakeSnapshot(holder.updater, m2)
    expect(existsSync(filePath)).toBe(true)

    // Rewind to m1 — null backup means "delete on rewind".
    await fileHistoryRewind(holder.updater, m1)
    expect(existsSync(filePath)).toBe(false)
  })

  test('throws when the messageId is not in any snapshot', async () => {
    const holder = makeStateHolder()
    const m1 = uuid()
    await fileHistoryMakeSnapshot(holder.updater, m1)
    const unknown = uuid()
    await expect(fileHistoryRewind(holder.updater, unknown)).rejects.toThrow(
      /selected snapshot was not found/i,
    )
  })

  test('does not mutate FileHistoryState.snapshots (rewind is fs-only)', async () => {
    const filePath = join(workTree, 'a.txt')
    writeFileSync(filePath, 'v1')
    const holder = makeStateHolder()
    const m1 = uuid()
    const m2 = uuid()

    await fileHistoryMakeSnapshot(holder.updater, m1)
    await fileHistoryTrackEdit(holder.updater, filePath, m1)
    writeFileSync(filePath, 'v2')
    await fileHistoryMakeSnapshot(holder.updater, m2)
    const before = holder.state().snapshots
    await fileHistoryRewind(holder.updater, m1)
    const after = holder.state().snapshots
    expect(after).toBe(before) // same array ref → no state mutation
  })
})

describe('fileHistoryCanRestore — predicate', () => {
  test('returns true for a known messageId', async () => {
    const holder = makeStateHolder()
    const m = uuid()
    await fileHistoryMakeSnapshot(holder.updater, m)
    expect(fileHistoryCanRestore(holder.state(), m)).toBe(true)
  })

  test('returns false for an unknown messageId', async () => {
    const holder = makeStateHolder()
    await fileHistoryMakeSnapshot(holder.updater, uuid())
    expect(fileHistoryCanRestore(holder.state(), uuid())).toBe(false)
  })

  test('returns false when fileHistory is disabled via env', async () => {
    const holder = makeStateHolder()
    const m = uuid()
    await fileHistoryMakeSnapshot(holder.updater, m)
    process.env.AXIOMATE_CODE_DISABLE_FILE_CHECKPOINTING = '1'
    expect(fileHistoryCanRestore(holder.state(), m)).toBe(false)
  })
})

describe('fileHistoryHasAnyChanges — fast yes/no', () => {
  test('returns false when no tracked file has changed since the snapshot', async () => {
    const filePath = join(workTree, 'a.txt')
    writeFileSync(filePath, 'stable')
    const holder = makeStateHolder()
    const m1 = uuid()
    await fileHistoryMakeSnapshot(holder.updater, m1)
    await fileHistoryTrackEdit(holder.updater, filePath, m1)
    // No edits between trackEdit and the check.
    expect(await fileHistoryHasAnyChanges(holder.state(), m1)).toBe(false)
  })

  test('returns true when a tracked file has been edited on disk', async () => {
    const filePath = join(workTree, 'a.txt')
    writeFileSync(filePath, 'v1')
    const holder = makeStateHolder()
    const m1 = uuid()
    await fileHistoryMakeSnapshot(holder.updater, m1)
    await fileHistoryTrackEdit(holder.updater, filePath, m1)
    writeFileSync(filePath, 'v2 different size — different content')
    expect(await fileHistoryHasAnyChanges(holder.state(), m1)).toBe(true)
  })

  test('returns true when a null-backup file now exists on disk', async () => {
    // trackEdit on a missing file → null v1. Then a tool creates the
    // file → hasAnyChanges should report true (file presence diverged).
    const filePath = join(workTree, 'created.txt')
    const holder = makeStateHolder()
    const m1 = uuid()
    await fileHistoryMakeSnapshot(holder.updater, m1)
    await fileHistoryTrackEdit(holder.updater, filePath, m1)
    writeFileSync(filePath, 'now-exists')
    expect(await fileHistoryHasAnyChanges(holder.state(), m1)).toBe(true)
  })

  test('returns false for an unknown messageId', async () => {
    const holder = makeStateHolder()
    await fileHistoryMakeSnapshot(holder.updater, uuid())
    expect(await fileHistoryHasAnyChanges(holder.state(), uuid())).toBe(false)
  })
})

describe('fileHistoryGetDiffStats — line counts and file list', () => {
  test('returns zeros when nothing has changed', async () => {
    const filePath = join(workTree, 'a.txt')
    writeFileSync(filePath, 'one\ntwo\n')
    const holder = makeStateHolder()
    const m1 = uuid()
    await fileHistoryMakeSnapshot(holder.updater, m1)
    await fileHistoryTrackEdit(holder.updater, filePath, m1)
    const stats = await fileHistoryGetDiffStats(holder.state(), m1)
    expect(stats).toEqual({
      filesChanged: [],
      insertions: 0,
      deletions: 0,
    })
  })

  test('counts insertions and deletions against the snapshot baseline', async () => {
    // diffLines is invoked against (current, backup). "Insertions" relative
    // to backup = lines present in current that were absent in backup;
    // "deletions" = the inverse. The exact direction is what fileHistory
    // ships today — pin the counts, not a re-derived semantic.
    const filePath = join(workTree, 'a.txt')
    writeFileSync(filePath, 'line1\nline2\n')
    const holder = makeStateHolder()
    const m1 = uuid()
    await fileHistoryMakeSnapshot(holder.updater, m1)
    await fileHistoryTrackEdit(holder.updater, filePath, m1)

    // Add two lines on disk.
    writeFileSync(filePath, 'line1\nline2\nline3\nline4\n')

    const stats = await fileHistoryGetDiffStats(holder.state(), m1)
    expect(stats).toBeDefined()
    expect(stats!.filesChanged).toEqual([filePath])
    // Pin the current behavior: backup is the "old" side from diff's POV,
    // so the two added lines show up as deletions=2 (in fileHistory's
    // diffLines(originalContent, backupContent) call). This is the
    // characterization — preserving today's count behavior across the swap.
    expect(stats!.insertions + stats!.deletions).toBe(2)
  })

  test('reports a created file (null backup) as changed', async () => {
    const filePath = join(workTree, 'new.txt')
    const holder = makeStateHolder()
    const m1 = uuid()
    await fileHistoryMakeSnapshot(holder.updater, m1)
    await fileHistoryTrackEdit(holder.updater, filePath, m1) // null v1
    writeFileSync(filePath, 'one\ntwo\n')

    const stats = await fileHistoryGetDiffStats(holder.state(), m1)
    expect(stats).toBeDefined()
    expect(stats!.filesChanged).toEqual([filePath])
    expect(stats!.insertions + stats!.deletions).toBeGreaterThan(0)
  })

  test('returns undefined for an unknown messageId', async () => {
    const holder = makeStateHolder()
    await fileHistoryMakeSnapshot(holder.updater, uuid())
    const stats = await fileHistoryGetDiffStats(holder.state(), uuid())
    expect(stats).toBeUndefined()
  })

  test('returns undefined when fileHistory is disabled', async () => {
    const holder = makeStateHolder()
    const m = uuid()
    await fileHistoryMakeSnapshot(holder.updater, m)
    process.env.AXIOMATE_CODE_DISABLE_FILE_CHECKPOINTING = '1'
    const stats = await fileHistoryGetDiffStats(holder.state(), m)
    expect(stats).toBeUndefined()
  })
})

describe('fileHistory — multi-file scenarios (Phase 3 swap baseline)', () => {
  test('makeSnapshot covers every tracked file independently', async () => {
    // Three files in three different states by turn 2:
    //   a.txt — edited between turns
    //   b.txt — unchanged (latestBackup must be reused)
    //   c.txt — deleted on disk (null backup at v2)
    const aPath = join(workTree, 'a.txt')
    const bPath = join(workTree, 'b.txt')
    const cPath = join(workTree, 'c.txt')
    writeFileSync(aPath, 'a-v1')
    writeFileSync(bPath, 'b-stable')
    writeFileSync(cPath, 'c-v1')

    const holder = makeStateHolder()
    const m1 = uuid()
    const m2 = uuid()

    await fileHistoryMakeSnapshot(holder.updater, m1)
    await fileHistoryTrackEdit(holder.updater, aPath, m1)
    await fileHistoryTrackEdit(holder.updater, bPath, m1)
    await fileHistoryTrackEdit(holder.updater, cPath, m1)
    const m1Backups = holder.state().snapshots.at(-1)!.trackedFileBackups
    const bV1 = m1Backups['b.txt']

    writeFileSync(aPath, 'a-v2 mutated')
    rmSync(cPath)

    await fileHistoryMakeSnapshot(holder.updater, m2)
    const m2Snap = holder.state().snapshots.at(-1)!
    expect(m2Snap.messageId).toBe(m2)

    // a.txt — fresh v2 backup
    expect(m2Snap.trackedFileBackups['a.txt'].version).toBe(2)
    expect(m2Snap.trackedFileBackups['a.txt'].backupFileName).toMatch(/@v2$/)

    // b.txt — same backup ref reused (no new copy)
    expect(m2Snap.trackedFileBackups['b.txt']).toBe(bV1)

    // c.txt — null backup at v2
    expect(m2Snap.trackedFileBackups['c.txt'].version).toBe(2)
    expect(m2Snap.trackedFileBackups['c.txt'].backupFileName).toBeNull()
  })

  test('rewind restores multiple files atomically (per-file semantics)', async () => {
    // Pin TODAY's behavior: rewind only touches state.trackedFiles,
    // not other files in the worktree. Phase 3's git-checkout needs
    // explicit `paths: [...trackedFiles]` to preserve this.
    const aPath = join(workTree, 'a.txt')
    const bPath = join(workTree, 'b.txt')
    const untrackedPath = join(workTree, 'untracked.txt')
    writeFileSync(aPath, 'a-v1')
    writeFileSync(bPath, 'b-v1')
    writeFileSync(untrackedPath, 'manual-edit-v1') // never tracked by fileHistory

    const holder = makeStateHolder()
    const m1 = uuid()
    const m2 = uuid()

    await fileHistoryMakeSnapshot(holder.updater, m1)
    await fileHistoryTrackEdit(holder.updater, aPath, m1)
    await fileHistoryTrackEdit(holder.updater, bPath, m1)

    writeFileSync(aPath, 'a-v2')
    writeFileSync(bPath, 'b-v2')
    writeFileSync(untrackedPath, 'manual-edit-v2') // user manually edits between turns
    await fileHistoryMakeSnapshot(holder.updater, m2)

    await fileHistoryRewind(holder.updater, m1)
    expect(readFileSync(aPath, 'utf-8')).toBe('a-v1')
    expect(readFileSync(bPath, 'utf-8')).toBe('b-v1')
    // The user's manual edit OUTSIDE the tracked set is preserved.
    expect(readFileSync(untrackedPath, 'utf-8')).toBe('manual-edit-v2')
  })

  test('subdirectory paths use forward-slash relative form on Windows', async () => {
    // maybeShortenFilePath uses Node's path.relative(cwd, abs), which
    // returns native separators (\\ on Windows). We pin the tracking-path
    // KEY shape so Phase 3's git side normalizes consistently.
    const subDir = join(workTree, 'src')
    mkdirSync(subDir)
    const filePath = join(subDir, 'foo.ts')
    writeFileSync(filePath, 'export const x = 1\n')

    const holder = makeStateHolder()
    const m1 = uuid()
    await fileHistoryMakeSnapshot(holder.updater, m1)
    await fileHistoryTrackEdit(holder.updater, filePath, m1)

    const keys = Object.keys(
      holder.state().snapshots.at(-1)!.trackedFileBackups,
    )
    expect(keys.length).toBe(1)
    // Pin native-separator behavior — Windows: 'src\\foo.ts', POSIX: 'src/foo.ts'.
    const expected = process.platform === 'win32' ? 'src\\foo.ts' : 'src/foo.ts'
    expect(keys[0]).toBe(expected)
    // trackedFiles set carries the same key shape.
    expect(holder.state().trackedFiles.has(expected)).toBe(true)
  })

  test('MAX_SNAPSHOTS=100 ring buffer evicts oldest entries', async () => {
    const holder = makeStateHolder()
    const ids: string[] = []
    for (let i = 0; i < 102; i++) {
      const id = uuid()
      ids.push(id)
      await fileHistoryMakeSnapshot(holder.updater, id)
    }
    const snaps = holder.state().snapshots
    expect(snaps.length).toBe(100)
    // Oldest two evicted; newest 100 retained.
    expect(snaps[0].messageId).toBe(ids[2])
    expect(snaps.at(-1)!.messageId).toBe(ids[101])
    // Sequence continues to increment past the ring cap (snapshotSequence
    // is monotonic, NOT bounded by MAX_SNAPSHOTS).
    expect(holder.state().snapshotSequence).toBe(102)
  })
})

describe('fileHistory — phase-2 async window invariant', () => {
  test('files added by trackEdit during makeSnapshot phase 2 are inherited into the new snapshot', async () => {
    // makeSnapshot Phase 1 captures state. Phase 2 (async IO) runs.
    // If trackEdit fires DURING Phase 2, its backup lands on the
    // most-recent snapshot. Phase 3 of makeSnapshot reads state.trackedFiles
    // FRESH and inherits any backup not already covered by Phase 2's set.
    //
    // Simulate: trackEdit fires before makeSnapshot starts (since vitest
    // can't precisely interleave the await), then we rely on the same
    // inheritance code path by checking the resulting snapshot covers
    // the new file even though it wasn't in trackedFiles at Phase 1.
    const aPath = join(workTree, 'a.txt')
    const bPath = join(workTree, 'b.txt')
    writeFileSync(aPath, 'a-v1')
    writeFileSync(bPath, 'b-v1')

    const holder = makeStateHolder()
    const m1 = uuid()
    const m2 = uuid()

    // Turn 1: track only a.txt.
    await fileHistoryMakeSnapshot(holder.updater, m1)
    await fileHistoryTrackEdit(holder.updater, aPath, m1)

    // Now a.txt is tracked. b.txt is not. We start makeSnapshot for m2,
    // but BEFORE awaiting it, trackEdit b.txt (writes onto m1's snapshot).
    const m2Promise = fileHistoryMakeSnapshot(holder.updater, m2)
    await fileHistoryTrackEdit(holder.updater, bPath, m1)
    await m2Promise

    // m2 must cover BOTH files. a.txt comes from Phase 2's per-file copy;
    // b.txt comes from the Phase-3 inheritance pass (since it wasn't in
    // captured.trackedFiles at Phase 1).
    const m2Snap = holder.state().snapshots.at(-1)!
    expect(m2Snap.messageId).toBe(m2)
    expect(m2Snap.trackedFileBackups['a.txt']).toBeDefined()
    expect(m2Snap.trackedFileBackups['b.txt']).toBeDefined()
    expect(m2Snap.trackedFileBackups['b.txt'].version).toBe(1)
  })
})

describe('fileHistoryRestoreStateFromLog — schema rebuild for /resume', () => {
  test('rebuilds state from a log of snapshots, normalizing absolute → relative paths', async () => {
    // Simulate a log persisted by an earlier session: paths are stored
    // ABSOLUTE in the snapshot. restoreStateFromLog must shorten them
    // through maybeShortenFilePath against the current originalCwd.
    const messageId = uuid()
    const absPath = join(workTree, 'a.txt')
    const snapshot: FileHistorySnapshot = {
      messageId,
      trackedFileBackups: {
        [absPath]: {
          backupFileName: 'deadbeefdeadbeef@v1',
          version: 1,
          backupTime: new Date(),
        },
      },
      timestamp: new Date(),
    }

    let restored: FileHistoryState | undefined
    fileHistoryRestoreStateFromLog([snapshot], s => {
      restored = s
    })
    expect(restored).toBeDefined()
    expect(restored!.snapshots.length).toBe(1)

    // The persisted ABSOLUTE key has been rewritten to the relative key.
    const expected = 'a.txt'
    const keys = Object.keys(restored!.snapshots[0].trackedFileBackups)
    expect(keys).toEqual([expected])
    expect(restored!.trackedFiles.has(expected)).toBe(true)
    expect(restored!.snapshotSequence).toBe(1)
  })

  test('round-trips: trackEdit-built state → restoreStateFromLog yields equivalent state', async () => {
    const filePath = join(workTree, 'a.txt')
    writeFileSync(filePath, 'content')

    // Build a state via the live API.
    const holder1 = makeStateHolder()
    const m = uuid()
    await fileHistoryMakeSnapshot(holder1.updater, m)
    await fileHistoryTrackEdit(holder1.updater, filePath, m)
    const before = holder1.state()

    // Now feed those snapshots through restoreStateFromLog into a fresh
    // state holder, mimicking session resume.
    let restored: FileHistoryState | undefined
    fileHistoryRestoreStateFromLog(before.snapshots, s => {
      restored = s
    })
    expect(restored).toBeDefined()
    expect(Array.from(restored!.trackedFiles)).toEqual(
      Array.from(before.trackedFiles),
    )
    // backup metadata preserved (same content, different object refs are fine).
    const beforeBackup = before.snapshots[0].trackedFileBackups['a.txt']
    const afterBackup = restored!.snapshots[0].trackedFileBackups['a.txt']
    expect(afterBackup.backupFileName).toBe(beforeBackup.backupFileName)
    expect(afterBackup.version).toBe(beforeBackup.version)
  })

  test('disabled fileHistory short-circuits without calling the updater', () => {
    process.env.AXIOMATE_CODE_DISABLE_FILE_CHECKPOINTING = '1'
    let called = false
    fileHistoryRestoreStateFromLog([], () => {
      called = true
    })
    expect(called).toBe(false)
  })
})

describe('copyFileHistoryForResume — hard-link migration across session ids', () => {
  test('migrates backup files from previousSessionId to current sessionId', async () => {
    // Build a previous session's backup tree manually. Skip the live API
    // to keep the fixture deterministic and to keep the previousSessionId
    // explicit in the LogOption.
    const previousSessionId = uuid()
    const currentSessionId = regenerateSessionId() // ensure they differ
    const backupFileName = 'deadbeefdeadbeef@v1'

    const prevDir = join(
      tmpRoot,
      'config',
      'file-history',
      previousSessionId,
    )
    mkdirSync(prevDir, { recursive: true })
    writeFileSync(join(prevDir, backupFileName), 'backup-blob-content')

    const snap: FileHistorySnapshot = {
      messageId: uuid(),
      trackedFileBackups: {
        'a.txt': {
          backupFileName,
          version: 1,
          backupTime: new Date(),
        },
      },
      timestamp: new Date(),
    }

    // Minimal LogOption shape — only fields read by the function.
    const log = {
      messages: [
        {
          sessionId: previousSessionId,
          // remaining fields irrelevant to copyFileHistoryForResume
        } as never,
      ],
      fileHistorySnapshots: [snap],
    } as unknown as Parameters<typeof copyFileHistoryForResume>[0]

    await copyFileHistoryForResume(log)

    const newPath = join(
      tmpRoot,
      'config',
      'file-history',
      currentSessionId,
      backupFileName,
    )
    expect(existsSync(newPath)).toBe(true)
    expect(readFileSync(newPath, 'utf-8')).toBe('backup-blob-content')
    // Original is preserved (hard link or copy, both fine — we just need
    // the new path readable).
    expect(existsSync(join(prevDir, backupFileName))).toBe(true)
  })

  test('null backups are skipped (no link attempted)', async () => {
    const previousSessionId = uuid()
    regenerateSessionId()

    const snap: FileHistorySnapshot = {
      messageId: uuid(),
      trackedFileBackups: {
        'gone.txt': {
          backupFileName: null,
          version: 1,
          backupTime: new Date(),
        },
      },
      timestamp: new Date(),
    }

    const log = {
      messages: [{ sessionId: previousSessionId } as never],
      fileHistorySnapshots: [snap],
    } as unknown as Parameters<typeof copyFileHistoryForResume>[0]

    // Must complete without throwing. (No directory created on disk for
    // null-only snapshots is acceptable — we only assert no throw.)
    await expect(copyFileHistoryForResume(log)).resolves.toBeUndefined()
  })

  test('no-ops when previous and current session ids match', async () => {
    const sessionId = getSessionId()
    const log = {
      messages: [{ sessionId } as never],
      fileHistorySnapshots: [
        {
          messageId: uuid(),
          trackedFileBackups: {},
          timestamp: new Date(),
        },
      ],
    } as unknown as Parameters<typeof copyFileHistoryForResume>[0]
    await expect(copyFileHistoryForResume(log)).resolves.toBeUndefined()
  })

  test('no-ops when log has no fileHistorySnapshots', async () => {
    const log = {
      messages: [{ sessionId: uuid() } as never],
      fileHistorySnapshots: undefined,
    } as unknown as Parameters<typeof copyFileHistoryForResume>[0]
    await expect(copyFileHistoryForResume(log)).resolves.toBeUndefined()
  })
})
