import { describe, expect, test } from 'vitest'
import { classifyGuiEditor, withGuiWaitFlag } from '../../../utils/editor.js'

/**
 * withGuiWaitFlag must append a "block until closed" flag to GUI editors that
 * are launched via the SYNC spawn + read-back path (editFileInEditor). Without
 * it, a fork-and-exit GUI editor (the norm on Windows) returns immediately and
 * the file is read back before the user edits it — silently discarding edits.
 * Terminal editors and unknown commands must pass through untouched.
 */
describe('withGuiWaitFlag', () => {
  test('appends --wait to VS Code and forks', () => {
    expect(withGuiWaitFlag('code')).toBe('code --wait')
    expect(withGuiWaitFlag('cursor')).toBe('cursor --wait')
    expect(withGuiWaitFlag('windsurf')).toBe('windsurf --wait')
    expect(withGuiWaitFlag('codium')).toBe('codium --wait')
  })

  test('appends --wait to other known GUI editors', () => {
    expect(withGuiWaitFlag('subl')).toBe('subl --wait')
    expect(withGuiWaitFlag('atom')).toBe('atom --wait')
    expect(withGuiWaitFlag('gedit')).toBe('gedit --wait')
  })

  test('does not double an existing wait flag', () => {
    expect(withGuiWaitFlag('code -w')).toBe('code -w')
    expect(withGuiWaitFlag('code --wait')).toBe('code --wait')
    expect(withGuiWaitFlag('subl --wait')).toBe('subl --wait')
  })

  test('leaves terminal editors untouched', () => {
    expect(withGuiWaitFlag('vim')).toBe('vim')
    expect(withGuiWaitFlag('nvim')).toBe('nvim')
    expect(withGuiWaitFlag('nano')).toBe('nano')
    expect(withGuiWaitFlag('vi')).toBe('vi')
  })

  test('leaves notepad++ untouched (no blocking flag exists)', () => {
    // notepad++ has no wait flag; classifyGuiEditor still flags it as GUI but
    // GUI_WAIT_FLAGS has no entry, so it must pass through rather than get a
    // bogus flag appended.
    expect(withGuiWaitFlag('notepad++')).toBe('notepad++')
  })

  test('preserves absolute paths and forks while still adding the flag', () => {
    expect(withGuiWaitFlag('/usr/bin/code')).toBe('/usr/bin/code --wait')
    expect(withGuiWaitFlag('code-insiders')).toBe('code-insiders --wait')
  })
})

describe('classifyGuiEditor', () => {
  test('classifies GUI editors by basename, ignoring directory components', () => {
    expect(classifyGuiEditor('code')).toBe('code')
    expect(classifyGuiEditor('/usr/local/bin/code')).toBe('code')
    expect(classifyGuiEditor('code-insiders')).toBe('code')
    expect(classifyGuiEditor('cursor')).toBe('cursor')
  })

  test('returns undefined for terminal editors', () => {
    expect(classifyGuiEditor('vim')).toBeUndefined()
    expect(classifyGuiEditor('nano')).toBeUndefined()
    // A terminal editor under a dir named like a GUI editor must not match via
    // the directory segment.
    expect(classifyGuiEditor('/home/alice/code/bin/nvim')).toBeUndefined()
  })
})
