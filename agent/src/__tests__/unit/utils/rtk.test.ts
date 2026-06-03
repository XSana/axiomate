import { describe, expect, it } from 'vitest'
import {
  _runRtkOnceForTesting,
  patchRewrittenCommand,
  type RtkExecFileForTesting,
} from '../../../utils/rtk.js'

describe('patchRewrittenCommand', () => {
  const rtkPath = '/opt/axiomate/rtk'

  it('replaces a leading rtk command with the bundled path', () => {
    expect(patchRewrittenCommand('rtk git status', rtkPath)).toBe('/opt/axiomate/rtk git status')
  })

  it('replaces rtk after an env prefix', () => {
    expect(patchRewrittenCommand('FOO=1 rtk git status', rtkPath)).toBe('FOO=1 /opt/axiomate/rtk git status')
  })

  it('replaces rtk after a transparent shell prefix', () => {
    expect(patchRewrittenCommand('noglob rtk git status', rtkPath)).toBe('noglob /opt/axiomate/rtk git status')
  })

  it('replaces every rtk segment in compound commands', () => {
    expect(patchRewrittenCommand('rtk git status && rtk cargo test', rtkPath)).toBe(
      '/opt/axiomate/rtk git status && /opt/axiomate/rtk cargo test',
    )
  })

  it('does not treat dollar signs in the rtk path as replacement tokens', () => {
    expect(patchRewrittenCommand('rtk git status', '/opt/$tools/rtk')).toBe('/opt/$tools/rtk git status')
  })

  it('does not rewrite non-rtk tokens', () => {
    expect(patchRewrittenCommand('artk git status && rtkx cargo test', rtkPath)).toBe(
      'artk git status && rtkx cargo test',
    )
  })

  it('does not rewrite rtk used as an argument before a rewritten segment', () => {
    expect(patchRewrittenCommand('echo rtk && rtk git status', rtkPath)).toBe(
      'echo rtk && /opt/axiomate/rtk git status',
    )
  })

  it('does not rewrite rtk inside quoted text', () => {
    expect(patchRewrittenCommand("echo 'rtk git status' && rtk git status", rtkPath)).toBe(
      "echo 'rtk git status' && /opt/axiomate/rtk git status",
    )
  })

  it('replaces rtk after env and shell prefixes in compound segments', () => {
    expect(patchRewrittenCommand('echo done; FOO=1 noglob rtk git status', rtkPath)).toBe(
      'echo done; FOO=1 noglob /opt/axiomate/rtk git status',
    )
  })
})

describe('rtk rewrite protocol', () => {
  it('calls rtk rewrite without --quiet', async () => {
    let seenArgs: string[] | undefined
    const execFileImpl: RtkExecFileForTesting = (_file, args, _options, callback) => {
      seenArgs = args
      callback(null, 'rtk git status', '')
      return { on: () => undefined }
    }

    const result = await _runRtkOnceForTesting('/opt/axiomate/rtk', 'git status', new AbortController().signal, execFileImpl)

    expect(seenArgs).toEqual(['rewrite', 'git status'])
    expect(result).toEqual({ kind: 'rewrite', cmd: '/opt/axiomate/rtk git status' })
  })

  it('treats legacy exit 3 as unexpected and preserves raw output', async () => {
    const execFileImpl: RtkExecFileForTesting = (_file, _args, _options, callback) => {
      const error = Object.assign(new Error('Command failed: rtk rewrite'), {
        code: 3,
        signal: null,
      })
      callback(error, 'rtk git status\n', 'legacy ask stderr\n')
      return { on: () => undefined }
    }

    const result = await _runRtkOnceForTesting('/opt/axiomate/rtk', 'git status', new AbortController().signal, execFileImpl)

    expect(result.kind).toBe('error')
    if (result.kind !== 'error') return
    expect(result.reason).toBe('unexpected-exit')
    expect(result.raw?.code).toBe(3)
    expect(result.raw?.stdout).toBe('rtk git status\n')
    expect(result.raw?.stderr).toBe('legacy ask stderr\n')
  })
})
