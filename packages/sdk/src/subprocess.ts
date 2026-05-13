import { spawn, type ChildProcess } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { platform } from 'node:os'
import type { Options } from './types/index.js'

export type SubprocessHandle = {
  process: ChildProcess
  stdin: Writable
  stdout: Readable
  stderr: Readable
  kill(): void
}

function findBinary(cliPath?: string): string {
  if (cliPath) return cliPath

  const envPath = process.env['AXIOMATE_BIN']
  if (envPath) return envPath

  const isWindows = platform() === 'win32'
  return isWindows ? 'axiomate.exe' : 'axiomate'
}

export function buildCliArgs(options: Options, prompt?: string): string[] {
  const args: string[] = []

  if (prompt) {
    args.push('--print', prompt)
  }

  args.push('--output-format', 'stream-json')
  args.push('--input-format', 'stream-json')

  if (options.model) args.push('--model', options.model)
  if (options.fallbackModel) args.push('--fallback-model', options.fallbackModel)
  if (options.systemPrompt) args.push('--system-prompt', options.systemPrompt)
  if (options.appendSystemPrompt) args.push('--append-system-prompt', options.appendSystemPrompt)
  if (options.maxTurns != null) args.push('--max-turns', String(options.maxTurns))
  if (options.maxBudgetUsd != null) args.push('--max-budget-usd', String(options.maxBudgetUsd))
  if (options.verbose) args.push('--verbose')
  if (options.resume) {
    if (typeof options.resume === 'string') {
      args.push('--resume', options.resume)
    } else {
      args.push('--resume')
    }
  }
  if (options.continue) args.push('--continue')
  if (options.forkSession) args.push('--fork-session')
  if (options.replayUserMessages) args.push('--replay-user-messages')
  if (options.includePartialMessages) args.push('--include-partial-messages')

  if (options.allowedTools?.length) {
    for (const tool of options.allowedTools) {
      args.push('--allowed-tools', tool)
    }
  }
  if (options.disallowedTools?.length) {
    for (const tool of options.disallowedTools) {
      args.push('--disallowed-tools', tool)
    }
  }

  if (options.permissionMode && options.permissionMode !== 'default') {
    args.push('--permission-mode', options.permissionMode)
  }

  return args
}

export function spawnAxiomate(options: Options, prompt?: string): SubprocessHandle {
  const binary = findBinary(options.cliPath)
  const args = buildCliArgs(options, prompt)

  const child = spawn(binary, args, {
    cwd: options.cwd || process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  })

  const kill = () => {
    if (!child.killed) {
      child.kill('SIGTERM')
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL')
      }, 5000)
    }
  }

  if (options.abortSignal) {
    options.abortSignal.addEventListener('abort', kill, { once: true })
  }

  return {
    process: child,
    stdin: child.stdin!,
    stdout: child.stdout!,
    stderr: child.stderr!,
    kill,
  }
}
