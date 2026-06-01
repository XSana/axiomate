import React from 'react'
import { COMMON_HELP_ARGS } from '../../constants/xml.js'
import { Doctor, type DoctorMode } from '../../screens/Doctor.js'
import type { LocalJSXCommandCall } from '../../types/command.js'

const USAGE = 'Usage: /doctor [api]'

type ParsedDoctorArgs =
  | { mode: DoctorMode }
  | { help: true }
  | { error: string }

function parseDoctorArgs(args?: string): ParsedDoctorArgs {
  const trimmed = (args ?? '').trim().toLowerCase()
  if (!trimmed) return { mode: 'general' }
  if (COMMON_HELP_ARGS.includes(trimmed)) return { help: true }
  if (trimmed === 'api') return { mode: 'api' }
  return { error: USAGE }
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const parsed = parseDoctorArgs(args)

  if ('error' in parsed) {
    onDone(parsed.error, { display: 'system' })
    return null
  }

  if ('help' in parsed) {
    onDone(
      [
        'Doctor commands:',
        '  /doctor      run general diagnostics',
        '  /doctor api  show API provider diagnostics',
      ].join('\n'),
      { display: 'system' },
    )
    return null
  }

  return <Doctor onDone={onDone} mode={parsed.mode} />
}

export const _internal = { parseDoctorArgs }
