/**
 * SessionSearchTool — Stage 3 streaming JSONL scan.
 *
 * Reads a session JSONL file in chunks, parses each complete `\n`-terminated
 * line as JSON, extracts message content text, and yields hits where the
 * lowercase content contains the query (case-insensitive substring).
 *
 * Live-write safety: when scanning a file that may be currently being
 * written, the trailing partial line (no terminating `\n` yet) is dropped.
 * This prevents JSON.parse on a half-written record.
 *
 * Memory safety: peak memory ≈ one chunk + one current line; whole-file
 * `readFileSync` is never used (V8/JSC string limit issue documented in
 * the harness report v4.4 — a single line can be at most ~1MB by axiomate's
 * toolResultStorage caps, well under string limits).
 *
 * Plan: see C:\Users\kiro\.claude\plans\ai-agent-harness-enginneering-hermes-ag-lucky-cloud.md
 */
import { createReadStream } from 'node:fs'
import type { RoleFilter } from './types.js'

export interface ScanOptions {
  query: string
  /** Restrict to messages of a specific role; undefined → all roles. */
  roleFilter?: RoleFilter
}

export interface MessageHit {
  /** 1-based line number where match was found (for debugging). */
  lineNumber: number
  /** Resolved role: from message.role if present, else entry.type. */
  role: string
  /** Extracted text content (full message text, not truncated). */
  text: string
  /** Positions of query within text (lowercase substring matches). */
  matchPositions: number[]
}

/**
 * Extract searchable plain-text from a message content field.
 *
 * Mirrors the convention from agenticSessionSearch.ts:58 extractMessageText.
 * Handles three shapes:
 *   - string content (plain user message)
 *   - structured array content (Anthropic-style blocks: text / image / tool_use)
 *   - other (returns empty)
 */
export function extractMessageText(content: unknown): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      if (typeof block === 'string') return block
      if (
        block &&
        typeof block === 'object' &&
        'text' in block &&
        typeof (block as { text: unknown }).text === 'string'
      ) {
        return (block as { text: string }).text
      }
      return ''
    })
    .filter(Boolean)
    .join(' ')
}

/**
 * Check a single parsed JSONL entry for a query match. Returns null if
 * - entry is not a message type (user/assistant/tool)
 * - role doesn't match roleFilter
 * - extracted text is empty
 * - text doesn't contain the query
 */
function checkParsedEntry(
  entry: unknown,
  queryLower: string,
  roleFilter: RoleFilter | undefined,
  lineNumber: number,
): MessageHit | null {
  if (!entry || typeof entry !== 'object') return null
  const obj = entry as Record<string, unknown>
  const type = obj['type']
  if (type !== 'user' && type !== 'assistant' && type !== 'tool') return null

  const message = obj['message'] as Record<string, unknown> | undefined
  const role = (message?.['role'] as string | undefined) ?? (type as string)
  if (roleFilter && role !== roleFilter) return null

  const text = extractMessageText(message?.['content'])
  if (!text) return null

  const textLower = text.toLowerCase()
  const matchPositions: number[] = []
  let idx = textLower.indexOf(queryLower)
  while (idx !== -1) {
    matchPositions.push(idx)
    idx = textLower.indexOf(queryLower, idx + 1)
  }
  if (matchPositions.length === 0) return null

  return { lineNumber, role, text, matchPositions }
}

/**
 * Stream-scan a session JSONL file for query matches. Yields one hit per
 * matching message. Empty / whitespace query yields nothing.
 *
 * Errors during read are swallowed (yields nothing further). Caller can
 * detect "no hits" but cannot distinguish "no matches" from "fs error" —
 * matches the established axiomate convention (e.g., agenticSessionSearch
 * also returns empty on failure).
 */
export async function* scanSessionForQuery(
  filePath: string,
  options: ScanOptions,
): AsyncGenerator<MessageHit> {
  const { query, roleFilter } = options
  if (!query.trim()) return
  const queryLower = query.toLowerCase()

  let stream: NodeJS.ReadableStream
  try {
    stream = createReadStream(filePath, { encoding: 'utf8' })
  } catch {
    return
  }

  let buffer = ''
  let lineNumber = 0

  try {
    for await (const chunk of stream) {
      buffer += chunk as string
      let newlineIdx = buffer.indexOf('\n')
      while (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx)
        buffer = buffer.slice(newlineIdx + 1)
        lineNumber++
        if (line.length > 0) {
          let entry: unknown
          try {
            entry = JSON.parse(line)
          } catch {
            // Malformed JSON line — skip silently (mirrors loadTranscriptFile)
            newlineIdx = buffer.indexOf('\n')
            continue
          }
          const hit = checkParsedEntry(entry, queryLower, roleFilter, lineNumber)
          if (hit) yield hit
        }
        newlineIdx = buffer.indexOf('\n')
      }
    }
    // Live-write safety: discard `buffer` — it's a trailing partial line
    // (no `\n` yet), parsing it would risk JSON.parse on incomplete input.
  } catch {
    // Read errors silently abort the scan.
    return
  }
}
