import React from 'react'
import { describe, expect, it, vi } from 'vitest'

import { call, _internal } from '../../../../commands/doctor/doctor.js'

vi.mock('../../../../screens/Doctor.js', () => ({
  Doctor: ({
    mode,
  }: {
    mode?: 'general' | 'api'
    onDone: unknown
  }): React.ReactNode => <div data-mode={mode ?? 'general'} />,
}))

describe('/doctor command', () => {
  it('parses doctor subcommands', () => {
    expect(_internal.parseDoctorArgs('')).toEqual({ mode: 'general' })
    expect(_internal.parseDoctorArgs('api')).toEqual({ mode: 'api' })
    expect(_internal.parseDoctorArgs('help')).toEqual({ help: true })
    expect(_internal.parseDoctorArgs('wat')).toEqual({
      error: 'Usage: /doctor [api]',
    })
  })

  it('renders general doctor by default', async () => {
    const node = await call(vi.fn(), {} as never, '')

    expect(React.isValidElement(node)).toBe(true)
    expect(node).toMatchObject({
      props: { mode: 'general' },
    })
  })

  it('renders API doctor for /doctor api', async () => {
    const node = await call(vi.fn(), {} as never, ' api ')

    expect(React.isValidElement(node)).toBe(true)
    expect(node).toMatchObject({
      props: { mode: 'api' },
    })
  })

  it('returns usage for unknown subcommands', async () => {
    const onDone = vi.fn()
    const node = await call(onDone, {} as never, 'nope')

    expect(node).toBeNull()
    expect(onDone).toHaveBeenCalledWith('Usage: /doctor [api]', {
      display: 'system',
    })
  })
})
