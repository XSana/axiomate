import { describe, expect, it, vi } from 'vitest'

import {
  call as templateCall,
  formatVendorTemplateForShow,
} from '../../../../commands/template/template.js'

describe('/template command helpers', () => {
  it('shows protocol vendor templates by name', () => {
    const result = formatVendorTemplateForShow('openai-chat', {})

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.text).toContain('openai-chat')
    expect(result.text).toContain('"protocol": "openai-chat"')
    expect(result.text).toContain('"reasoning_effort"')
  })

  it('reports missing vendor templates', () => {
    expect(formatVendorTemplateForShow('does-not-exist', {})).toEqual({
      ok: false,
      message: "Vendor template 'does-not-exist' not found. Run /template vendor list.",
    })
  })
})

describe('/template argument routing', () => {
  function lastMessage(onDone: ReturnType<typeof vi.fn>): string {
    const calls = onDone.mock.calls
    return calls.length ? String(calls[calls.length - 1]![0]) : ''
  }

  it('guides the user when a subcommand is used in the group slot', async () => {
    for (const sub of ['new', 'list', 'add', 'show', 'delete', 'ls', 'rm']) {
      const onDone = vi.fn()
      await templateCall(onDone, {} as never, sub)
      const msg = lastMessage(onDone)
      // Must point at the real fix, not a generic "unknown group".
      expect(msg).toContain(`/template model ${sub}`)
      expect(msg).toContain(`/template vendor ${sub}`)
      expect(msg).not.toContain('Unknown /template group')
    }
  })

  it('reports a genuinely unknown group with the valid groups', async () => {
    const onDone = vi.fn()
    await templateCall(onDone, {} as never, 'bogusgroup')
    const msg = lastMessage(onDone)
    expect(msg).toContain("Unknown /template group: 'bogusgroup'")
    expect(msg).toContain("'model'")
    expect(msg).toContain("'vendor'")
  })
})
