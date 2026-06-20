/**
 * `extractGitHashes` — partial-scan + corruption semantics.
 *
 * The anchor-keep pass in prune relies on this to decide whether a recent
 * session still references commits on an about-to-die ref. A silently
 * incomplete scan (mid-file corruption) must NOT look like a clean "no
 * relevant hashes" result, or the caller could drop a ref whose only
 * anchor lived on the unparsed line.
 *
 * Contract under test:
 *   - clean file → { error: null, partial: false }, all hashes present
 *   - truncated TAIL (live append) → partial:false (intended, benign)
 *   - corrupt MIDDLE line → partial:true, that line's hash absent, others present
 *   - oversize file → error set, partial:false
 *   - missing file → error set
 */

import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { extractGitHashes } from '../../../../utils/checkpoints/sessionScan.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'axiomate-sessionscan-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const HASH_A = 'a'.repeat(40)
const HASH_B = 'b'.repeat(40)
const HASH_C = 'c'.repeat(40)

function snapLine(hash: string): string {
  return JSON.stringify({
    type: 'file-history-snapshot',
    snapshot: { gitHash: hash, messageId: 'm', addedTrackedFiles: [] },
  })
}

function write(name: string, content: string): string {
  const p = join(dir, name)
  writeFileSync(p, content)
  return p
}

describe('extractGitHashes — partial-scan semantics', () => {
  test('clean file: all hashes, no error, not partial', async () => {
    const p = write('clean.jsonl', [snapLine(HASH_A), snapLine(HASH_B)].join('\n') + '\n')
    const r = await extractGitHashes(p)
    expect(r.error).toBeNull()
    expect(r.partial).toBe(false)
    expect([...r.hashes].sort()).toEqual([HASH_A, HASH_B].sort())
  })

  test('truncated final line (live append) is benign: not partial', async () => {
    // Valid first line, then a half-written tail with no newline. This is
    // the concurrency case the scanner explicitly tolerates.
    const tail = '{"type":"file-history-snapshot","snapshot":{"gitHash":"' + HASH_B
    const p = write('tail.jsonl', snapLine(HASH_A) + '\n' + tail)
    const r = await extractGitHashes(p)
    expect(r.error).toBeNull()
    expect(r.partial).toBe(false)
    expect([...r.hashes]).toEqual([HASH_A])
  })

  test('corrupt MIDDLE line: partial=true, that hash absent, others kept', async () => {
    // A snapshot-shaped middle line that is not valid JSON (missing closing
    // braces) sits between two good lines and is followed by a newline, so
    // it is NOT the truncated tail. The scanner must flag the scan partial.
    const corruptMiddle =
      '{"type":"file-history-snapshot","snapshot":{"gitHash":"' + HASH_B + '"'
    const p = write(
      'mid.jsonl',
      [snapLine(HASH_A), corruptMiddle, snapLine(HASH_C)].join('\n') + '\n',
    )
    const r = await extractGitHashes(p)
    expect(r.partial).toBe(true)
    expect(r.hashes.has(HASH_B)).toBe(false)
    expect(r.hashes.has(HASH_A)).toBe(true)
    expect(r.hashes.has(HASH_C)).toBe(true)
  })

  test('oversize file: error set, not partial', async () => {
    // 33 MB of filler exceeds the 32 MB cap.
    const big = 'x'.repeat(33 * 1024 * 1024)
    const p = write('big.jsonl', big)
    const r = await extractGitHashes(p)
    expect(r.error).not.toBeNull()
    expect(r.partial).toBe(false)
    expect(r.hashes.size).toBe(0)
  })

  test('missing file: error set', async () => {
    const r = await extractGitHashes(join(dir, 'nope.jsonl'))
    expect(r.error).not.toBeNull()
    expect(r.hashes.size).toBe(0)
  })
})
