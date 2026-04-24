/**
 * SessionSearchTool — Stage 1 (mtime filter) + Stage 2 (metadata tail scan).
 *
 * Pure functions. Only fs reads as side effects. Reuses upstream helpers from
 * sessionStorage.ts and sessionStoragePortable.ts so we don't reinvent the
 * directory enumeration or tail-window read.
 *
 * Plan: see C:\Users\kiro\.claude\plans\ai-agent-harness-enginneering-hermes-ag-lucky-cloud.md
 */
import { getSessionFilesWithMtime } from '../../utils/sessionStorage.js'
import { readSessionLite } from '../../utils/sessionStoragePortable.js'
import type {
  MetadataField,
  MetadataMatch,
  SessionFileInfo,
} from './types.js'

const DAY_MS = 86_400_000

const ALL_METADATA_FIELDS: readonly MetadataField[] = [
  'title',
  'customTitle',
  'tag',
  'summary',
]

/**
 * Stage 1: list session files in `projectDir` whose mtime is within
 * `recentDays` of `now`. Returns sorted descending by mtime.
 *
 * `recentDays <= 0` disables the time filter — all enumerated sessions are
 * returned. Useful for the `recent` mode (no query) and tests.
 */
export async function filterByMtime(
  projectDir: string,
  recentDays: number,
  now: number = Date.now(),
): Promise<SessionFileInfo[]> {
  const map = await getSessionFilesWithMtime(projectDir)
  // Upstream returns `path`; we expose it as `filePath` for clarity.
  const all: SessionFileInfo[] = [...map.entries()].map(([sessionId, info]) => ({
    sessionId,
    filePath: info.path,
    mtime: info.mtime,
    ctime: info.ctime,
    size: info.size,
  }))
  if (recentDays <= 0) {
    return all.sort((a, b) => b.mtime - a.mtime)
  }
  const threshold = now - recentDays * DAY_MS
  return all
    .filter(info => info.mtime >= threshold)
    .sort((a, b) => b.mtime - a.mtime)
}

/**
 * Stage 2: scan a session file's last 64KB for metadata entries
 * (custom-title / ai-title / tag / summary) whose value contains `query`.
 *
 * Returns null if no field matches. Caller pairs with sessionId from
 * filterByMtime — this function does not extract sessionId.
 *
 * Robust to malformed JSON lines (skipped silently). Returns null on
 * empty query, missing/unreadable file, or no metadata match.
 */
export async function scanMetadata(
  filePath: string,
  query: string,
  fields: readonly MetadataField[] = ALL_METADATA_FIELDS,
): Promise<MetadataMatch | null> {
  if (!query.trim()) return null
  const queryLower = query.toLowerCase()

  const lite = await readSessionLite(filePath)
  if (!lite) return null

  // Metadata entries are appended at the tail of the JSONL (axiomate convention).
  // For files smaller than 64KB the tail equals the head, so a single scan
  // covers everything regardless of size.
  const matchedFields: MetadataField[] = []
  const matchedValues: Partial<Record<MetadataField, string>> = {}

  for (const line of lite.tail.split('\n')) {
    if (!line) continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof entry !== 'object' || entry === null) continue

    const obj = entry as Record<string, unknown>
    const type = obj['type']

    if (
      type === 'summary' &&
      fields.includes('summary') &&
      !matchedFields.includes('summary') &&
      typeof obj['summary'] === 'string'
    ) {
      const value = obj['summary'] as string
      if (value.toLowerCase().includes(queryLower)) {
        matchedFields.push('summary')
        matchedValues.summary = value
      }
    }

    if (
      type === 'custom-title' &&
      fields.includes('customTitle') &&
      !matchedFields.includes('customTitle') &&
      typeof obj['customTitle'] === 'string'
    ) {
      const value = obj['customTitle'] as string
      if (value.toLowerCase().includes(queryLower)) {
        matchedFields.push('customTitle')
        matchedValues.customTitle = value
      }
    }

    if (
      type === 'ai-title' &&
      fields.includes('title') &&
      !matchedFields.includes('title') &&
      typeof obj['aiTitle'] === 'string'
    ) {
      const value = obj['aiTitle'] as string
      if (value.toLowerCase().includes(queryLower)) {
        matchedFields.push('title')
        matchedValues.title = value
      }
    }

    if (
      type === 'tag' &&
      fields.includes('tag') &&
      !matchedFields.includes('tag') &&
      typeof obj['tag'] === 'string'
    ) {
      const value = obj['tag'] as string
      if (value.toLowerCase().includes(queryLower)) {
        matchedFields.push('tag')
        matchedValues.tag = value
      }
    }
  }

  if (matchedFields.length === 0) return null
  return { fields: matchedFields, matchedValues }
}
