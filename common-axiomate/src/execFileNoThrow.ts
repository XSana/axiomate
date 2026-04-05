/**
 * Child process execution utilities.
 * Always resolves (never throws).
 */

import { spawn } from 'child_process'

type ExecFileOptions = {
  timeout?: number
  input?: string
  useCwd?: boolean
  cwd?: string
  env?: NodeJS.ProcessEnv
}

export function execFileNoThrow(
  file: string,
  args: string[],
  options: ExecFileOptions = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  const { timeout = 600_000, input, cwd, env: customEnv } = options

  return new Promise(resolve => {
    const child = spawn(file, args, {
      stdio: [input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      timeout,
      cwd,
      env: customEnv,
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    if (input !== undefined && child.stdin) {
      child.stdin.write(input)
      child.stdin.end()
    }

    child.on('close', code => {
      resolve({ stdout, stderr, code: code ?? 1 })
    })

    child.on('error', () => {
      resolve({ stdout: '', stderr: '', code: 1 })
    })
  })
}

export function execFileNoThrowWithCwd(
  file: string,
  args: string[],
  options: ExecFileOptions & { cwd?: string } = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  return execFileNoThrow(file, args, options)
}
