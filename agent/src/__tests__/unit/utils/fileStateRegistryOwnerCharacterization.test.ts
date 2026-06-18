import { normalize } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  createFileStateCacheWithSizeLimit,
  cloneFileStateCache,
  type FileStateCache,
} from '../../../utils/fileStateCache.js'
import {
  clearFileStateRegistryForTests,
  noteFileWrite,
  recordObservedTextReadState,
  setObservedFileState,
  wasFileModifiedAfterReadByAnotherContext,
} from '../../../utils/fileStateRegistry.js'

/**
 * CHARACTERIZATION SNAPSHOT of owner-identity behavior across cache clones.
 *
 * Purpose: this project has low test coverage and the owner / registrySequence
 * mechanism is deep (consumed by the Write gate, subagent reminders, and Read
 * dedup). Before changing owner semantics (the planned "Option 2": clone
 * inherits owner id, see docs/file/stamp-mechanism-deep-dive.md) we lock the
 * CURRENT observable behavior so the only thing that may change is the one
 * assertion we intend to flip — anything else moving is an unintended
 * side-effect and must turn this suite red.
 *
 * Owner model recap (fileStateRegistry.ts getOwnerId):
 *   - context.agentId set  -> owner = `agent:<id>`  (does NOT depend on the
 *     cache instance) — subagents/forked/swarm.
 *   - no agentId           -> owner = `context:<N>` assigned PER cache instance
 *     via a WeakMap — the main session. A clone is a NEW instance => NEW owner.
 *
 * Each test is tagged:
 *   [GUARDRAIL]      = correct behavior, must NEVER change.
 *   [FLIPS-OPTION-2] = current behavior is a phantom-owner false rejection;
 *                      Option 2 will intentionally turn this from reject->allow.
 *                      Until Option 2 ships, we assert the CURRENT (buggy) value
 *                      so the snapshot is honest about today's behavior.
 */

type Session = { readFileState: FileStateCache }

function freshSession(): Session {
  return { readFileState: createFileStateCacheWithSizeLimit(50) }
}
function cloneAsNewOwner(prev: Session): Session {
  // Models QueryEngine entry / resume / speculation: a clone that (today) mints
  // a new owner id because it is a distinct cache instance with no agentId.
  return { readFileState: cloneFileStateCache(prev.readFileState) }
}

const READ = { timestamp: 1, offset: undefined, limit: undefined } as const

describe('owner identity across clone — characterization', () => {
  beforeEach(() => clearFileStateRegistryForTests())

  // [GUARDRAIL] Same session reads+writes, then a clone boundary, then wants to
  // act again. noteFileWrite stamps the read with the write seq; clone preserves
  // it; lastWriter.seq == readStamp.seq so the gate does NOT reject.
  test('[GUARDRAIL] read->write->clone: own prior write does not look like a sibling', () => {
    const path = normalize('/repo/a.txt')
    const s1 = freshSession()
    setObservedFileState(s1, path, { content: 'v1', ...READ })
    noteFileWrite(s1, path)

    const s2 = cloneAsNewOwner(s1)
    expect(wasFileModifiedAfterReadByAnotherContext(s2, path)).toBe(false)
  })

  // [GUARDRAIL] No writer registered anywhere -> gate has no lastWriter -> allow.
  // This is the plain --print Read-then-Edit path.
  test('[GUARDRAIL] read-only then clone: no writer, allowed', () => {
    const path = normalize('/repo/b.txt')
    const s1 = freshSession()
    setObservedFileState(s1, path, { content: 'v1', ...READ })

    const s2 = cloneAsNewOwner(s1)
    setObservedFileState(s2, path, { content: 'v1', ...READ }) // re-read in new owner
    expect(wasFileModifiedAfterReadByAnotherContext(s2, path)).toBe(false)
  })

  // [FLIPS-OPTION-2] Phantom owner false rejection. The SAME logical session:
  // owner s1 writes; a clone boundary mints owner s2; s2 injects a read (e.g.
  // plan/memory) stamped with a fresh read seq; then something attributed to the
  // pre-clone owner s1 writes again (a stale owner id from the same session,
  // NOT a real concurrent context). The gate sees a higher-seq write by a
  // "different" owner and rejects.
  //
  // CURRENT behavior = true (reject) — a FALSE rejection. Option 2 (clone keeps
  // s1's owner id) will make s1 and s2 the same owner -> early-return false.
  // When Option 2 lands, change this expectation to false and move the tag to
  // [GUARDRAIL].
  test('[FLIPS-OPTION-2] phantom owner: same-session stale owner write rejects the clone', () => {
    const path = normalize('/repo/MEM.md')
    const s1 = freshSession()
    setObservedFileState(s1, path, { content: 'm', ...READ })
    noteFileWrite(s1, path) // lastWriter = {owner s1, seq2}

    const s2 = cloneAsNewOwner(s1)
    recordObservedTextReadState(s2, path, { content: 'm', ...READ }) // read seq3
    noteFileWrite(s1, path) // stale same-session owner writes again, seq4 > seq3

    expect(wasFileModifiedAfterReadByAnotherContext(s2, path)).toBe(true)
  })

  // [GUARDRAIL] Control for the phantom case: if s2 SHARES s1's identity (what
  // Option 2 will make clones do), the same sequence is allowed. This proves the
  // fix direction is sound and pins that same-owner must never reject.
  test('[GUARDRAIL] same owner identity: the phantom sequence is allowed', () => {
    const path = normalize('/repo/MEM2.md')
    const s1 = freshSession()
    setObservedFileState(s1, path, { content: 'm', ...READ })
    noteFileWrite(s1, path)

    const s2 = s1 // shared identity == owner inheritance
    recordObservedTextReadState(s2, path, { content: 'm', ...READ })
    noteFileWrite(s1, path)

    expect(wasFileModifiedAfterReadByAnotherContext(s2, path)).toBe(false)
  })

  // [GUARDRAIL] The real protection Option 2 must NOT weaken: a genuine
  // DIFFERENT context (a subagent, owner = agent:<id>, independent of cache
  // instance) that writes after this context read MUST still be detected. Owner
  // inheritance on clone does not touch agentId-based owners, so this must stay
  // a rejection after Option 2.
  test('[GUARDRAIL] genuine cross-agent sibling write is still detected', () => {
    const path = normalize('/repo/shared.txt')
    const main = freshSession() // no agentId -> context:N
    setObservedFileState(main, path, { content: 'v1', ...READ })

    const subagent = {
      agentId: 'asub00000000000001' as never,
      readFileState: createFileStateCacheWithSizeLimit(50),
    }
    noteFileWrite(subagent, path) // a real independent writer

    expect(wasFileModifiedAfterReadByAnotherContext(main, path)).toBe(true)
  })
})
