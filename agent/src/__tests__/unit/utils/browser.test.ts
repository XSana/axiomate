import { afterEach, describe, expect, test, vi } from 'vitest'

const mockOpen = vi.hoisted(() => vi.fn())

vi.mock('open', () => ({
  default: mockOpen,
}))

import { openPath } from '../../../utils/browser.js'

describe('openPath', () => {
  afterEach(() => {
    mockOpen.mockReset()
  })

  test('opens paths with the system handler without waiting', async () => {
    mockOpen.mockResolvedValue({} as never)

    await expect(openPath('C:\\Users\\me\\.axiomate\\memory')).resolves.toBe(
      true,
    )

    expect(mockOpen).toHaveBeenCalledWith(
      'C:\\Users\\me\\.axiomate\\memory',
      { wait: false },
    )
  })

  test('returns false when the system handler cannot be launched', async () => {
    mockOpen.mockRejectedValue(new Error('no opener'))

    await expect(openPath('/tmp/memory')).resolves.toBe(false)
  })
})
