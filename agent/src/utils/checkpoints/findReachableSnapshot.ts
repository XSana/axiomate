/**
 * `findReachableSnapshot` — does a gitHash from a resumed session
 * still exist in the shadow store?
 *
 * Resume restores `fileHistory.snapshots[]` from the JSONL transcript
 * verbatim — but the underlying commits in `~/.axiomate/checkpoints/store`
 * may have been pruned (per-project ring-buffer at 100, retention/size-cap
 * passes) since the original session ran. A snapshot row whose gitHash
 * is no longer reachable is *attached* to the in-memory list (so the
 * `/rewind` selector can still display "turn N: edited foo.ts") but
 * the actual rollback would `git ls-tree` against a missing object and
 * fail. 6A surfaces this state to the user before they try to rewind.
 *
 * Two-tier check (cheap-first):
 *   1. `git cat-file -e <hash>` against the project ref's index — fast,
 *      O(1) object-DB lookup. Resolves "object exists in store at all".
 *   2. `git merge-base --is-ancestor <hash> <ref>` — confirms the
 *      object is reachable from the current ref tip (i.e. the prune
 *      passes haven't unlinked it). This catches the case where a
 *      commit object survives because something else kept a handle
 *      but is no longer reachable from any axiomate-managed ref.
 *
 * `git cat-file -e` exits 1 when the object is absent; `merge-base
 * --is-ancestor` exits 1 when the ancestor relation does not hold. We
 * treat both as `not reachable`. Any other failure → `unknown` (typed
 * separately so callers can fall back to "not displayed" rather than
 * "definitely gone").
 *
 * Hermes parity: Hermes does not have this helper — completion-plan 6A
 * is axiomate-only. The closest Hermes equivalent is the `_validate_*`
 * checks in `tools/checkpoint_manager.py::CheckpointManager.restore`,
 * which surface "commit not found" as an exception at rewind time;
 * we want the user to know *before* they invoke rewind.
 */

import { runCheckpointGit } from './git.js'
import { ensureStore } from './store.js'
import { normalizePath, refName, projectHash } from './paths.js'
import { validateCommitHash } from './validate.js'

/**
 * Tri-state result. `unknown` is distinct from `unreachable` so the UI
 * can choose to either hide the hint (safer; user might find a "no
 * rewind possible" line confusing on a transient error) or render with
 * a "?" suffix. Default callsite (REPL post-resume) hides on `unknown`.
 */
export type Reachability = 'reachable' | 'unreachable' | 'unknown'

export interface FindReachableOptions {
  /** Workdir of the resumed session. */
  workdir: string
  /** gitHash from the resumed snapshot row to probe. */
  gitHash: string
}

/**
 * Probe whether `gitHash` is still reachable from this project's ref tip.
 *
 * Never throws. Cheap on the happy path: one `git cat-file -e`. On
 * objects that exist but might be detached, one extra `merge-base
 * --is-ancestor`. The combined cost is bounded; called at most once per
 * resume in the default wiring.
 */
export async function findReachableSnapshot(
  opts: FindReachableOptions,
): Promise<Reachability> {
  // gitHash from a transcript line is untrusted — it could be a partial
  // hash, contain a `-p`-style flag, etc. Validate before letting it
  // anywhere near git. `validateCommitHash` returns null on success and
  // an error string on failure, so non-null === reject.
  if (validateCommitHash(opts.gitHash) !== null) return 'unknown'

  const ensured = await ensureStore()
  if (ensured.ok === false) return 'unknown'

  const workdir = normalizePath(opts.workdir)
  const ref = refName(projectHash(workdir))

  // Step 1: object exists in store at all? `cat-file -e` is silent on
  // success and exits 1 when the object is missing.
  const exists = await runCheckpointGit(
    ['cat-file', '-e', `${opts.gitHash}^{commit}`],
    {
      store: ensured.store,
      workTree: workdir,
      allowedExitCodes: new Set([1, 128]),
    },
  )
  if (exists.ok === false) return 'unknown'
  if (exists.code === 1 || exists.code === 128) return 'unreachable'

  // Step 2: reachable from the project's ref tip? An object that
  // survives because something else holds a reference to it but is
  // detached from refs/axiomate/<hash> would otherwise look "reachable"
  // here. Hermes' restore path also walks ref ancestry, so this matches
  // its effective semantics even though we don't share a function.
  const ancestor = await runCheckpointGit(
    ['merge-base', '--is-ancestor', opts.gitHash, ref],
    {
      store: ensured.store,
      workTree: workdir,
      allowedExitCodes: new Set([1, 128]),
    },
  )
  if (ancestor.ok === false) return 'unknown'
  if (ancestor.code === 0) return 'reachable'
  if (ancestor.code === 1 || ancestor.code === 128) return 'unreachable'
  return 'unknown'
}
