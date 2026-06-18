# Stamp Mechanism Deep Dive — toward "never falsely reject the AI"

Status date: 2026-06-18. Investigation + design analysis, no code changed yet.
Goal: understand the `registrySequence` ("stamp") mechanism completely and find
the design that minimizes FALSE rejections of legitimate AI writes while keeping
the real protection it provides. Companion to
`file-harness-investigation-2026-06-18.md`.

## What the stamp is

`FileState.registrySequence?: number` — a process-local monotonic counter
(`fileStateRegistry.ts:31` `let sequence = 0`). It is the answer to one question:
"in this process's global ordering of reads and writes, when did THIS read of
THIS file happen?" It exists only to power cross-context sibling-write detection.

Two module-level globals back it:
- `sequence` — the monotonic counter, bumped by both reads (`recordFileRead:210`,
  `++sequence`) and writes (`noteFileWrite:316`, `++sequence`).
- `lastWriterByPath: Map<registryKey, {ownerId, sequence}>` — the last writer of
  each path, across ALL owners, capped at 4096, never cleared within a process.

## The owner model (the crux)

`getOwnerId(context)` (`fileStateRegistry.ts:44`):
- If `context.agentId` set → `agent:<id>` (subagents, teammates).
- Else → a `context:<N>` id assigned PER readFileState INSTANCE via a WeakMap
  (`ownerIdsByReadFileState`).

So owner identity is bound to the **FileStateCache instance**, not to "the
session" or "the user". Any code that creates a NEW FileStateCache gets a NEW
owner. Clone sites that mint a new owner:
- `QueryEngine` construction: `readFileCache: cloneFileStateCache(getReadFileCache())`
  (`QueryEngine.ts:1214`) — **every `--print` / SDK query / programmatic
  `query()` call clones → new owner**, writes back at `:1237`.
- `restoreObservedReadFilesFromMessages` REPLACES `readFileState.current` with a
  fresh clone on resume and after speculation (`REPL.tsx:1642`,
  `speculation.ts:807`) — **even interactive REPL changes owner at these points**.
- Subagents / forked agents / swarm: `runAgent.ts:371`, `forkedAgent.ts:389`,
  `inProcessRunner.ts:1050` — child gets a clone → new owner (but child usually
  also has its own `agentId`, so its owner is `agent:<id>` regardless).
- compact preserved-tail clone (`compact.ts:821`), MagicDocs (`magicDocs.ts:124`).

Interactive REPL steady state: tools read `readFileState.current` directly
(`REPL.tsx:1284/2072/2590/4314`), a STABLE instance — owner does NOT drift
turn-to-turn. That is why the single-context interactive path is mostly safe.
The drift happens at clone/replace boundaries (print queries, resume,
speculation).

## The three stamp consumers

1. `wasFileModifiedAfterReadByAnotherContext` (`:333`) — THE write gate.
   - `lastWriter` missing OR `lastWriter.ownerId === ownerId` → false (safe).
   - read has no stamp (`registrySequence === undefined`) → false (ABSTAIN).
   - else → `lastWriter.sequence > readStamp.registrySequence` (hard verdict).
2. `getPathsWrittenByOtherContextsSince` (`:369`) — subagent reminder only,
   never blocks. Same shape; unstamped read → treated as not-confirmed.
3. `FileReadTool.ts:558` dedup — trusts mtime-equality only when stamped.

## The self-protection that usually saves single-context

`noteFileWrite` (`:327`) does `fileState.registrySequence = writeSequence` — it
stamps the SAME read-state entry it just registered as last writer, with the
write's own sequence. So after a write by owner A:
`lastWriterByPath[path] = {A, S}` AND `readState[path].registrySequence = S`.
A later clone preserves `registrySequence = S` (`cloneFileStateCache:230`). If
the clone (new owner B) then edits: gate computes `lastWriter.sequence(S) >
readStamp.registrySequence(S)` → false → allowed. The write-sequence-stamped-
onto-the-read is what makes the cross-owner comparison come out equal. Clever,
but it only holds when the read-state entry carrying that stamp survives intact
to the editor.

## Every path that can FALSELY reject — empirically probed

Probed with a temp unit test (clone to mint a new owner, then exercise the gate):

| Case | Setup | Gate verdict | False reject? |
|------|-------|-------------|----------------------|
| C1 | owner A reads+writes; clone → owner B edits it | **false (allow)** | No — safe. `noteFileWrite` stamped the read with the write seq; clone preserves it; `lastWriter.seq == readStamp.seq` so `>` is false. Why single-context & clone-after-own-write are fine. |
| C3 | owner A reads (no writer anywhere); clone → owner B edits | **false (allow)** | No — safe. `lastWriter` absent → early false. Why `--print` Read→Edit works. |
| C2 | owner X writes; clone → owner Y INJECTS a read (stamped w/ read seq); X writes AGAIN; Y edits | **true (reject)** | **Depends: is X a genuinely independent concurrent writer, or a phantom (clone/resume of the SAME session)?** |

C2 is the ONLY rejecting path, and it is exactly the existing asserted test
`stamps SDK read-state seeds merged after sibling writes`
(`fileStateRegistry.test.ts:343-362`). That test frames X as a real concurrent
subagent — rejecting is CORRECT there. The danger is when the "other owner" is
NOT real concurrency.

## When is the "other owner" a phantom?

`ownerId` is per-FileStateCache-instance, so the same logical session acquires a
NEW owner every time its cache is cloned/replaced:
- `--print`/SDK `query()` clones on entry (`QueryEngine.ts:1214`), writes back on
  exit (`:1237`). Two sequential queries in one logical session = two owners over
  the same files.
- `restoreObservedReadFilesFromMessages` replaces `readFileState.current` after
  resume and after EVERY speculation (`REPL.tsx:1642`, `speculation.ts:807`) →
  new owner mid-session, while `lastWriterByPath` (module global) still holds the
  pre-replace owner's writes.

So phantom-sibling risk is real at: resume, speculation, and multi-query
SDK/print sessions — where the AI's OWN earlier write is attributed to a
now-stale owner id, and a post-replace stamped read of the same path is judged
"modified by another context". The C1 self-protection only saves the case where
the surviving read-state entry still carries the write's own seq; once an
INJECTION (plan/memory) or RECONSTRUCTION overwrites that entry with a fresh read
seq LOWER than the retained `lastWriter.sequence`, C2 fires as a FALSE reject.

This is precisely how "stamp injected reads" (the `172f38de` decision the
refactor froze) turns owner drift into a false rejection: injected read seq <
the phantom-owner's retained write seq.

## Fix directions, evaluated on both axes

Two axes to protect simultaneously:
- (A) NEVER falsely reject a legitimate AI write (the user's priority).
- (B) Don't lose genuine concurrent-sibling-write detection (the reason stamp
  exists) — e.g. a real subagent editing a file the parent also edits.

Key safety fact that makes (A)-leaning fixes safe: when the gate ABSTAINS
(unstamped read), it does NOT allow blindly — it falls through to
`isReadStateStaleForWrite` (content + mtime comparison). That content comparison
is the real authority; the stamp is only a fast-path heuristic on top of mtime.
So removing a stamp degrades to "compare actual bytes", which is strictly safer
against false rejects and still catches real divergence (different bytes on disk
→ correctly rejected).

### Option 1 — Unstamp the injection points (flip `stamp:'live'` → `'reconstructed'`)

Apply `fcb631c7`'s proven reconstruction treatment to plan/memory/seed injection
(the 7 sites the refactor routes through `recordObservedTextReadState`). One word
per site (the boundary already supports it).
- (A): Eliminates the C2 false reject for injected reads — they abstain, content
  gate decides. Strong win.
- (B): No real loss. An injected read was never a "live observed read" with a
  meaningful order; its stamp was always fictional. Genuine sibling detection for
  files the AI ACTUALLY read/wrote (FileRead/FileEdit/FileWrite) is unaffected —
  those still stamp through the real tool path.
- Risk: low. Matches the precedent already shipped for reconstruction.
- Caveat: the print-seed (#7) is a "current-disk re-confirmation" — NOTE A in the
  consolidation plan. Unstamping it is defensible (content gate still guards) but
  is a behavior change; decide explicitly.

### Option 2 — Fix the owner model so a clone inherits identity

Make `cloneFileStateCache` carry the source's owner id (copy the WeakMap entry),
so resume/speculation/multi-query do NOT mint a phantom owner for the same
logical session. Subagents/forked agents (which have their own `agentId`) still
get distinct owners — correct.
- (A): Removes the phantom-sibling root cause for ALL reads (not just injected),
  including reconstructed and live reads after a clone boundary.
- (B): Preserves real cross-agent detection (agentId-based owners unchanged).
- Risk: medium. Owner identity is load-bearing; need to confirm no path relies on
  clone producing a fresh owner. The `lastWriterByPath` global persists writes
  across the clone, so inheriting the owner makes `ownerId === lastWriter.ownerId`
  → early false (allow) for the session's own prior writes — exactly right.
- This is the deeper, more correct fix: it addresses WHY phantoms exist rather
  than muting one symptom.

### Option 3 — (rejected) drop stamping entirely / always abstain

Make `wasFileModifiedAfterReadByAnotherContext` always defer to content gate.
- (A): No false rejects from this gate ever.
- (B): LOSES the one case content-comparison can't catch: a sibling wrote the
  SAME bytes-as-read then the content matches but a real concurrent edit was
  silently dropped — but actually if bytes match, the AI's edit is still safe to
  apply (it edits from the same content). The genuine loss is only the
  mtime-restored-after-sibling-write niche. Marginal. Still, removing a whole
  subsystem is bigger than needed; Options 1+2 are more targeted.

### Recommendation (for discussion, not yet implemented)

Do BOTH 1 and 2, in order, each behind the break-and-reproduce discipline:
1. Option 2 (owner inheritance on clone) is the root-cause fix and likely
   resolves the phantom-sibling class for live + reconstructed + injected reads
   at once. Build a failing test that reproduces a phantom reject across a
   clone/resume boundary FIRST, confirm it's red, then fix.
2. Option 1 (unstamp injections) as defense-in-depth + conceptual correctness:
   injected reads have no real read-order and should abstain regardless of owner
   model. Cheap, matches precedent.

Sequencing rationale: if Option 2 alone makes the failing repro green, Option 1
becomes purely conceptual hygiene (still worth doing, lower urgency). If we can't
build a red repro for the user's actual symptom, do NOT ship either as a blind
fix — that is the trap of the last three waves. The content gate already makes
both options strictly safer-against-false-reject, but "safer in theory" is not
"confirmed to fix the reported bug".

## What this does NOT explain

The user's single-context interactive "retry succeeds" symptom maps to C1/C3,
which probe as ALLOW — so stamp is NOT its cause. That symptom still needs a real
failing jsonl (exact `fileHarnessFailure.reason` + preceding tool sequence). The
stamp work here hardens the resume/speculation/SDK-multi-query surface, which is
a real but DIFFERENT exposure than the interactive symptom reported.


