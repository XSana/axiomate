> **ARCHIVED (2026-06-20).** This is the point-in-time planning artifact for the
> checkpoints data-integrity hardening pass. It is kept as a historical record of
> how the work was scoped, NOT as live documentation. The authoritative record of
> what shipped lives in `checkpoints-review-findings.md` (Stage 3, F7-F13) and
> current behavior is in `checkpoints-design.md`. Where this plan and the
> findings doc disagree, the findings doc wins (e.g. F10/"D" turned out larger
> than planned — the touched-paths verify was dead, not just inconclusive-blind).

# Checkpoints Hardening Plan (2026-06-20)

Working doc for a comprehensive correctness/data-integrity pass over the
checkpoints subsystem. Driven by a user concern about non-transactional
snapshotting and "could a failed save store an empty project as a checkpoint".

## Method

Each finding follows: **reproduce (failing test) → anchor → fix → verify**.
Tier-1/2 cannot be proven by mock-only tests (the existing suite mocks
`runCheckpointGit` and never injects `fs` faults, which is exactly why these
bugs were invisible). Repro requires either a fault-injection seam or a
real-git integration test (model: `__tests__/e2e/checkpoint.cli.test.ts`).

## Decisions locked (user, 2026-06-20)

- Empty-tree guard: only block a fully-empty staged tree over a non-empty
  parent. No percent-shrink threshold.
- Verify-inconclusive UX: report success + warning + recovery entry.
- `projectHash` case-folding: fix it directly (no users, no compat concern).
- Cross-process rewind gate: deferred — documented as a known limitation rather
  than adding a lockfile failure surface for a low-probability event.

## Findings & fixes (as planned)

### Tier 1 — data loss
- **A** readdir failure commits empty/partial snapshot. A1: propagate non-ENOENT
  readdir errors → transient-error. A2: empty-tree-over-non-empty-parent guard.
- **B** prune anchor-then-delete drops ref even when anchoring failed → defer.
- **C** `extractGitHashes` hides mid-file corruption (feeds B) → `partial` flag.

### Tier 2 — correctness
- **D** verify* "inconclusive = pass" → tri-state + warning.
- **E** fresh-start `update-ref` has no CAS → empty-old-value CAS.

### Tier 3 — robustness (fix)
- **F** projectHash case-insensitive dedup failure.
- **G** `.last_prune` non-atomic + no concurrent guard.
- **H** rewind temp PID-reuse.
- **I** store partial-config init never repaired.
- **J** clearAll / getCheckpointBase path-injection.

### Tier 3 — documented accepts (no code change)
- dropOversize ls-files→stat TOCTOU (git bounds at write-tree, next snapshot
  re-filters, size-cap prune bounds the store).
- `dirSizeBytes` symlink skip (store holds no symlinks; following risks
  mount-point cost/loops).
- touchProject last-write-wins (worst case one stale `last_touch`, re-touched
  next turn; type-guard handles malformed reads).
- Cross-process rewind/prune concurrency (in-process guarded; cross-process
  backstopped by git's own ref/gc locks).

## Outcome

All of A-J shipped. D additionally surfaced a latent bug: the touched-paths
verify passed `git diff --pathspec-from-file`, unsupported by git (exit 129),
so it had been dead on every rewind. Rewritten to stage via the snapshot scanner
then diff `--cached` scoped to touched pathspecs. Verified: full agent suite
(2549 tests), real-git e2e (9), typecheck, build, and a built-binary `--print`
smoke all green. See `checkpoints-review-findings.md` Stage 3 for the resolved
record.
