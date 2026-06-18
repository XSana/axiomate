# File Harness Investigation Notes — 2026-06-18

Status: investigation only, no code changed. Records what the 2026-06-18 deep
dive (after the user reported "Error editing file" got MORE frequent post-refactor)
actually confirmed vs. what remains hypothesis. Companion to
`read-state-write-consolidation-plan.md` and the MEMORY notes
`project_plan_readstate_normalization`, `project_file_harness_registry_abstention`.

## The meta-finding (highest value)

Three waves / dozens of commits all polished ONE axis — content canonicalization
(CRLF/BOM): `bf8bd1c1`, `5e60940b`, `9442b51e` are all content-axis work. The
STAMP axis (should an injected/reconstructed read carry a `registrySequence`?)
was never re-examined in any wave. The consolidation plan even labelled stamping
an "orthogonal axis that must NOT be merged" and then shipped every injection
site as `stamp:'live'`, codifying the status quo. The likely reason the harness
keeps regressing is that attention has been locked on the wrong axis.

## Confirmed (git evidence, not speculation)

Injection-point stamping is a wrong-direction historical decision that the
refactor froze in place:

- Originally these sites (plan attachment, nested memory, relevant memory, REPL
  startup) used raw unstamped `.set()` — `registrySequence` undefined →
  `wasFileModifiedAfterReadByAnotherContext` abstains (returns false at
  `fileStateRegistry.ts:355`) → defers to the content/mtime gate. Safe.
- `172f38de` (2026-06-01) introduced `setObservedFileState` (= `.set()` +
  `recordFileRead`, which stamps at `:210`) and swapped those sites to it,
  ADDING a stamp to reads that are not real live FileReads.
- `fcb631c7` (2026-06-09) explicitly RETIRED stamp-on-reconstruct for the
  reconstruction paths, rationale: "stamping ordered a reconstructed read after
  any real concurrent sibling write and masked it ... leave unstamped so the
  registry abstains and the content/mtime gate decides."
- That exact rationale applies to the injection points (same category: not a
  real live read, no meaningful read-order), but was never applied to them.
- `9442b51e` (my refactor) routed all 7 injection sites through
  `recordObservedTextReadState(..., {stamp:'live'})`, making the wrong stamp the
  blessed contract.

Impact scope (important caveat): single-context sessions are protected by the
`lastWriter.ownerId === ownerId` early-return at `fileStateRegistry.ts:340`, so
a stamped injected read only trips a false `sibling_write` when a DIFFERENT
owner wrote the file — subagents, forked agents, ExitPlanMode handing off to a
differently-owned implementation-phase editor, speculation. So it is a real
cross-owner hazard, but probably NOT the cause of the user's single-context
"retry succeeds" symptom.

## Ruled out for the single-context main path (code + live repro)

- Concurrency race: FileEdit/Write/Notebook default `isConcurrencySafe=false`
  (`Tool.ts:759`), forced to execute exclusively by StreamingToolExecutor
  (`:136-142,155`) — never parallel with the FileRead it depends on.
- Normalization mismatch: `readFileForEdit` (`readFileSyncWithMetadata`) and
  FileRead's `readFileInRange` both strip BOM + CRLF→LF, byte-identical.
- Single-context stamp → sibling_write: blocked by the ownerId early-return.
- Basic flows: live repro (fast model, real git repo) of Read→Edit and of 4
  consecutive Edits to one file without re-reading — all succeeded.

## Not reproduced / still hypothesis (the user's actual symptom)

User symptom: single context, "sent a message", AI read a file, Edit failed with
generic "Error editing file", retry succeeds ("能过但烦"). Could NOT reproduce in
clean scratch repos — so it depends on a real-environment condition not yet
isolated. "Retry succeeds" strongly implies read-state was momentarily out of
sync with disk and a fresh Read fixed it.

Top un-investigated suspect: `getChangedFiles` (`attachments.ts:1770`) runs every
turn over all read-state paths, stats each, and on mtime advance re-reads via
FileRead; on ENOENT it `readFileState.delete(path)` (`:1858`). A turn-boundary
evict/refresh that drops or mutates the read-state entry would yield exactly
"next Edit says not_read, retry (fresh Read) works". UNCONFIRMED — do not patch
on plausibility alone (that is the trap the last three waves fell into). Needs a
real failing jsonl tool_result + the preceding Read/Edit sequence to pin the
exact `fileHarnessFailure.reason`.

## Build/version note

PATH `C:\public\tools\axiomate\axiomate.exe` and the repo `agent/dist` exe are
the SAME build (md5 afd8987fba7b81c28929b5c14d52cc1f), so investigation targets
the code the user runs.
