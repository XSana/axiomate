import type {
  ConnectRemoteControlOptions,
  CronJitterConfig,
  CronTask,
  RemoteControlHandle,
  ScheduledTasksHandle,
} from './types/index.js'

export function watchScheduledTasks(_opts: {
  dir: string
  signal: AbortSignal
  getJitterConfig?: () => CronJitterConfig
}): ScheduledTasksHandle {
  // TODO: Implement file watching for scheduled_tasks.json
  // This requires fs.watch on <dir>/.claude/scheduled_tasks.json
  // and cron expression evaluation
  throw new Error('watchScheduledTasks is not yet implemented')
}

export function buildMissedTaskNotification(missed: CronTask[]): string {
  if (missed.length === 0) return ''

  const lines = missed.map(
    (t) => `- [${t.id}] "${t.prompt}" (scheduled: ${t.cron})`,
  )

  return [
    `The following scheduled tasks were missed while the daemon was offline:`,
    '',
    ...lines,
    '',
    'Please confirm with the user before executing these tasks.',
  ].join('\n')
}

export async function connectRemoteControl(
  _opts: ConnectRemoteControlOptions,
): Promise<RemoteControlHandle | null> {
  // TODO: Implement WebSocket bridge connection
  // This requires OAuth token and bridge endpoint
  throw new Error('connectRemoteControl is not yet implemented')
}
