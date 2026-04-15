// Team memory sync watcher — disabled (Anthropic service removed).
import type { SyncState } from './index.js'
export type TeamMemorySyncWatcherOptions = { teamDir: string; syncState: SyncState; onSync?: () => void }
export function startTeamMemoryWatcher(_opts: TeamMemorySyncWatcherOptions): { stop: () => void } {
  return { stop: () => {} }
}
export function notifyTeamMemoryWrite(): void {}
