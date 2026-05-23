import { initExtractMemories } from '../services/extractMemories/extractMemories.js'
import { isExtractMemoriesEnabled } from '../services/extractMemories/extractMemoriesEnabled.js'
import { initAutoDream } from '../services/autoDream/autoDream.js'
import { initMagicDocs } from '../services/MagicDocs/magicDocs.js'
import { pruneCheckpoints } from './checkpoints/prune.js'
import { logForDebugging } from './debug.js'
import { ensureDeepLinkProtocolRegistered } from './deepLink/registerProtocol.js'
import { initSkillImprovement } from './hooks/skillImprovement.js'

import { getIsInteractive, getLastInteractionTime, getPickerOpenCount } from '../bootstrap/state.js'
import { cleanupOldMessageFilesInBackground } from './cleanup.js'
import { autoUpdateMarketplacesAndPluginsInBackground } from './plugins/pluginAutoupdate.js'

// 24 hours in milliseconds
const RECURRING_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000

// 10 minutes after start.
const DELAY_VERY_SLOW_OPERATIONS_THAT_HAPPEN_EVERY_SESSION = 10 * 60 * 1000

export function startBackgroundHousekeeping(): void {
  void initMagicDocs()
  void initSkillImprovement()
  if (isExtractMemoriesEnabled()) {
    initExtractMemories()
  }
  initAutoDream()
  void autoUpdateMarketplacesAndPluginsInBackground()
  void ensureDeepLinkProtocolRegistered()
  let needsCleanup = true
  async function runVerySlowOps(): Promise<void> {
    // If the user did something in the last minute, don't make them wait for these slow operations to run.
    if (
      getIsInteractive() &&
      getLastInteractionTime() > Date.now() - 1000 * 60
    ) {
      setTimeout(
        runVerySlowOps,
        DELAY_VERY_SLOW_OPERATIONS_THAT_HAPPEN_EVERY_SESSION,
      ).unref()
      return
    }

    if (needsCleanup) {
      // Phase 6 gate: if a /rewind picker is currently mounted in this
      // process, defer the auto-prune. The picker reads the same
      // anchors prune would delete; running both concurrently can
      // make picker rows fail at execution time. User-invoked
      // `/checkpoints prune` bypasses this gate (different call site
      // in commands/checkpoints/checkpoints.tsx) — explicit user
      // action shouldn't be silently skipped. Log once per skip so
      // repeated picker opens don't flood the debug log. Don't flip
      // needsCleanup to false on this branch — the runVerySlowOps
      // timer will retry on the next tick.
      if (getPickerOpenCount() > 0) {
        logForDebugging(
          'housekeeping: deferred — /rewind picker is open (will retry next tick)',
        )
        setTimeout(
          runVerySlowOps,
          DELAY_VERY_SLOW_OPERATIONS_THAT_HAPPEN_EVERY_SESSION,
        ).unref()
        return
      }
      needsCleanup = false
      await cleanupOldMessageFilesInBackground()
      // Auto-prune the shadow-git checkpoint store. The 24h `.last_prune`
      // marker inside pruneCheckpoints is the actual cross-process
      // throttle; calling it on every very-slow tick is cheap when the
      // marker is fresh. pruneCheckpoints is fail-open and never throws,
      // so we don't need a try/catch — but we log non-empty error reports
      // for diagnostic visibility.
      try {
        const report = await pruneCheckpoints({})
        if (report.errors.length > 0) {
          logForDebugging(
            `pruneCheckpoints: completed with ${report.errors.length} non-fatal errors: ${report.errors.slice(0, 3).join('; ')}`,
          )
        }
      } catch (err) {
        // Defense-in-depth — pruneCheckpoints is contract-bound to never
        // throw, but if a future refactor breaks that contract we don't
        // want it to take down housekeeping.
        const msg = err instanceof Error ? err.message : String(err)
        logForDebugging(`pruneCheckpoints: unexpected throw: ${msg}`)
      }
    }
  }

  setTimeout(
    runVerySlowOps,
    DELAY_VERY_SLOW_OPERATIONS_THAT_HAPPEN_EVERY_SESSION,
  ).unref()

  // For long-running sessions, schedule recurring cleanup every 24 hours.
  // Both cleanup functions use marker files and locks to throttle to once per day
  // and skip immediately if another process holds the lock.
}
