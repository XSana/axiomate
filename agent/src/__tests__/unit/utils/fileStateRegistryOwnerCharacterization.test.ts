import { normalize } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  createFileStateCacheWithSizeLimit,
  cloneFileStateCache,
  type FileStateCache,
} from '../../../utils/fileStateCache.js'
import {
  clearFileStateRegistryForTests,
  inheritReadStateOwner,
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
 * dedup). This suite locks owner-identity behavior across clones so any
 * unintended movement turns it red. It also pins the Option 2 fix (clone
 * inherits owner id, see docs/file/stamp-mechanism-deep-dive.md): raw
 * cloneFileStateCache semantics are unchanged, while the session-continuation
 * clone (cloneInheritingOwner) no longer produces a phantom-owner rejection.
 *
 * Owner model recap (fileStateRegistry.ts getOwnerId):
 *   - context.agentId set  -> owner = `agent:<id>`  (does NOT depend on the
 *     cache instance) — subagents/forked/swarm.
 *   - no agentId           -> owner = `context:<N>` assigned PER cache instance
 *     via a WeakMap — the main session. A clone is a NEW instance => NEW owner.
 *
 * Each test is tagged:
 *   [GUARDRAIL]           = behavior that must NEVER change.
 *   [OPTION-2 REGRESSION] = the phantom-owner false rejection that Option 2
 *                           (session-continuation clones inherit the owner id)
 *                           fixes; pins reject->allow via cloneInheritingOwner.
 */

type Session = { readFileState: FileStateCache }

function freshSession(): Session {
  return { readFileState: createFileStateCacheWithSizeLimit(50) }
}
function cloneAsNewOwner(prev: Session): Session {
  // Models a clone WITHOUT owner inheritance: a distinct cache instance with no
  // agentId becomes a new owner. This is the raw cloneFileStateCache semantics,
  // which Option 2 deliberately did NOT change.
  return { readFileState: cloneFileStateCache(prev.readFileState) }
}
function cloneInheritingOwner(prev: Session): Session {
  // Models the session-continuation clones (QueryEngine entry / resume /
  // speculation) AFTER Option 2: clone then inherit the source owner id.
  const next = { readFileState: cloneFileStateCache(prev.readFileState) }
  inheritReadStateOwner(prev, next)
  return next
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

  // [GUARDRAIL] Raw clone semantics are UNCHANGED by Option 2: a clone that does
  // NOT inherit the owner (a genuinely new owner) still treats the prior owner's
  // later write as a sibling write. We intentionally did not change
  // cloneFileStateCache itself; only the session-continuation call sites inherit.
  test('[GUARDRAIL] raw clone (no inheritance) still rejects a higher-seq other-owner write', () => {
    const path = normalize('/repo/MEM.md')
    const s1 = freshSession()
    setObservedFileState(s1, path, { content: 'm', ...READ })
    noteFileWrite(s1, path) // lastWriter = {owner s1, seq2}

    const s2 = cloneAsNewOwner(s1) // NEW owner (no inheritance)
    recordObservedTextReadState(s2, path, { content: 'm', ...READ }) // read seq3
    noteFileWrite(s1, path) // owner s1 writes again, seq4 > seq3

    expect(wasFileModifiedAfterReadByAnotherContext(s2, path)).toBe(true)
  })

  // [OPTION-2 REGRESSION] The phantom-owner false rejection is FIXED when the
  // session-continuation clone inherits the owner id. Same sequence as above but
  // via cloneInheritingOwner (what QueryEngine entry / resume / speculation now
  // do): s1 and s2 are the same owner, so s1's later write is the session's own,
  // not a sibling -> allowed.
  test('[OPTION-2 REGRESSION] inheriting clone: same-session later write does NOT reject', () => {
    const path = normalize('/repo/MEM.md')
    const s1 = freshSession()
    setObservedFileState(s1, path, { content: 'm', ...READ })
    noteFileWrite(s1, path)

    const s2 = cloneInheritingOwner(s1) // inherits owner (Option 2)
    recordObservedTextReadState(s2, path, { content: 'm', ...READ })
    noteFileWrite(s1, path)

    expect(wasFileModifiedAfterReadByAnotherContext(s2, path)).toBe(false)
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

  // [GUARDRAIL] inheritReadStateOwner override semantics: it must overwrite the
  // target's owner even if the target already self-assigned one via an earlier
  // read. The call sites do not strictly control ordering, so a "set only when
  // absent" implementation would silently fail to fix the phantom rejection.
  // This pins the unconditional-override contract documented on the function.
  test('[GUARDRAIL] inheritReadStateOwner overrides a target that already has an owner', () => {
    const path = normalize('/repo/late.txt')
    const s1 = freshSession()
    setObservedFileState(s1, path, { content: 'm', ...READ })
    noteFileWrite(s1, path)

    const s2 = cloneAsNewOwner(s1)
    setObservedFileState(s2, path, { content: 'm', ...READ }) // s2 self-assigns owner FIRST
    inheritReadStateOwner(s1, s2) // override AFTER the fact
    noteFileWrite(s1, path)

    expect(wasFileModifiedAfterReadByAnotherContext(s2, path)).toBe(false)
  })

  // [GUARDRAIL] inheritReadStateOwner is a no-op when the SOURCE has an
  // agentId-based owner — protects subagents from being merged into a parent
  // owner. Pins the early-return guard.
  test('[GUARDRAIL] inheritReadStateOwner is a no-op for agentId-based source owners', () => {
    const path = normalize('/repo/agent-src.txt')
    const agentSource = {
      agentId: 'asub00000000000099' as never,
      readFileState: createFileStateCacheWithSizeLimit(50),
    }
    const target = freshSession()
    setObservedFileState(target, path, { content: 'v1', ...READ })

    inheritReadStateOwner(agentSource, target) // must NOT graft the agent owner onto target
    noteFileWrite(agentSource, path) // agent (a real other context) writes

    // target still sees the agent as a distinct owner -> sibling write detected
    expect(wasFileModifiedAfterReadByAnotherContext(target, path)).toBe(true)
  })
})
