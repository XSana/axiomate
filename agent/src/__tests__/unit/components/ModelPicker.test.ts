import { describe, expect, it } from 'vitest'

import { getHiddenCountBelow } from '../../../components/ModelPicker.js'

describe('ModelPicker', () => {
  it('shows no remaining count when the visible window has reached the end', () => {
    expect(getHiddenCountBelow(12, 10, 12)).toBe(0)
  })

  it('falls back to the initial visible count before the select reports its window', () => {
    expect(getHiddenCountBelow(12, 10, 0)).toBe(2)
  })

  it('counts only options below the current visible window', () => {
    expect(getHiddenCountBelow(12, 10, 10)).toBe(2)
    expect(getHiddenCountBelow(12, 10, 11)).toBe(1)
  })
})
