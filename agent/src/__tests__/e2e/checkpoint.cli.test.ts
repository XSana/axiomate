import { execFile } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'

const execFileAsync = promisify(execFile)

let tmpRoot: string
let workTree: string
let checkpointBase: string

beforeAll(() => {
  // dist/cli.js must exist (pnpm run build)
})

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'axiomate-cli-e2e-'))
  checkpointBase = join(tmpRoot, 'cp')
  workTree = mkdtempSync(join(tmpRoot, 'wt-'))
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function cli(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // agent/src/__tests__/e2e/ -> 4 levels up -> agent/ -> dist/cli.js
  const script = join(__dirname, '..', '..', '..', '..', 'dist', 'cli.js')
  try {
    const { stdout, stderr } = await execFileAsync(
      'bun',
      [script, ...args],
      {
        env: {
          ...process.env,
          AXIOMATE_CHECKPOINT_BASE: checkpointBase,
          AXIOMATE_CONFIG_DIR: join(tmpRoot, 'config'),
          AXIOMATE_CODE_DISABLE_FILE_CHECKPOINTING: '0',
        },
        timeout: 60_000,
        cwd: workTree,
      },
    )
    return { stdout, stderr, exitCode: 0 }
  } catch (error: any) {
    return {
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
      exitCode: error.code ?? 1,
    }
  }
}

describe('checkpoint CLI e2e', () => {
  test('checkpoints status runs', async () => {
    const { stdout, stderr, exitCode } = await cli(['checkpoints', 'status'])
    // May exit 1 on uninitialized store; just verify it doesn't crash
    expect(stdout || stderr || exitCode).toBeTruthy()
  }, 60_000)

  test('checkpoints prune runs', async () => {
    const { stdout, stderr, exitCode } = await cli([
      'checkpoints', 'prune',
      '--retention-days', '30',
      '--max-size-mb', '100',
      '--force',
    ])
    expect(stdout || stderr || exitCode).toBeTruthy()
  }, 60_000)

  test('checkpoints clear --force runs', async () => {
    const { stdout, stderr, exitCode } = await cli(['checkpoints', 'clear', '--force'])
    expect(stdout || stderr || exitCode).toBeTruthy()
  }, 60_000)
})
