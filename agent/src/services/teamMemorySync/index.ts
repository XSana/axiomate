// Team memory sync — HTTP sync stubbed (isTeamMemorySyncAvailable returns
// false). Pure utility helpers are kept so unit tests can still exercise
// checksum/batch logic.
import { createHash } from 'crypto'
import { jsonStringify } from '../../utils/slowOperations.js'

export type SyncState = {
  lastKnownChecksum: string | null
  serverChecksums: Map<string, string>
  serverMaxEntries: number | null
}

export function createSyncState(): SyncState {
  return { lastKnownChecksum: null, serverChecksums: new Map(), serverMaxEntries: null }
}

export function hashContent(content: string): string {
  return 'sha256:' + createHash('sha256').update(content, 'utf8').digest('hex')
}

export function batchDeltaByBytes(
  delta: Record<string, string>,
): Array<Record<string, string>> {
  const MAX_BODY_BYTES = 256 * 1024
  const keys = Object.keys(delta).sort()
  if (keys.length === 0) return []
  const EMPTY_BODY_BYTES = Buffer.byteLength('{"entries":{}}', 'utf8')
  const entryBytes = (k: string, v: string): number =>
    Buffer.byteLength(jsonStringify(k), 'utf8') +
    Buffer.byteLength(jsonStringify(v), 'utf8') + 2
  const batches: Array<Record<string, string>> = []
  let current: Record<string, string> = {}
  let currentBytes = EMPTY_BODY_BYTES
  for (const key of keys) {
    const added = entryBytes(key, delta[key]!)
    if (currentBytes + added > MAX_BODY_BYTES && Object.keys(current).length > 0) {
      batches.push(current)
      current = {}
      currentBytes = EMPTY_BODY_BYTES
    }
    current[key] = delta[key]!
    currentBytes += added
  }
  if (Object.keys(current).length > 0) batches.push(current)
  return batches
}

export function isTeamMemorySyncAvailable(): boolean { return false }

export async function pullTeamMemory(
  _state: SyncState,
  _teamDir: string,
): Promise<{ pulled: number; state: SyncState }> {
  return { pulled: 0, state: _state }
}

export async function pushTeamMemory(
  _state: SyncState,
  _teamDir: string,
): Promise<{ pushed: number; state: SyncState }> {
  return { pushed: 0, state: _state }
}

export async function syncTeamMemory(
  state: SyncState,
): Promise<{ pulled: number; pushed: number; state: SyncState }> {
  return { pulled: 0, pushed: 0, state }
}
