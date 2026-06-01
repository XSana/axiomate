import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PassThrough } from 'stream'
import stripAnsi from 'strip-ansi'

import { render } from '../../../ink.js'
import { clearApiRecoveryTraces } from '../../../services/api/apiRecoveryDiagnostics.js'
import { Doctor } from '../../../screens/Doctor.js'

const appState = vi.hoisted(() => ({
  agentDefinitions: { activeAgents: [], allAgents: [] },
  mcp: {
    clients: [],
    tools: [],
    commands: [],
    resources: {},
    pluginReconnectKey: 0,
  },
  plugins: {
    enabled: [],
    disabled: [],
    commands: [],
    errors: [],
    installationStatus: {
      marketplaces: [],
      plugins: [],
    },
    needsRefresh: false,
  },
  toolPermissionContext: {
    mode: 'default',
    allowedTools: [],
    rejectedTools: [],
    additionalDirectories: [],
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    askRules: {},
  },
  notifications: {
    current: null,
    queue: [],
  },
}))

vi.mock('../../../state/AppState.js', () => ({
  useAppState: (selector: (state: typeof appState) => unknown) =>
    selector(appState),
}))

vi.mock('../../../utils/doctorDiagnostic.js', () => ({
  getDoctorDiagnostic: vi.fn(async () => ({
    version: 'test-version',
    invokedBinary: 'axiomate',
    warnings: [],
    ripgrepStatus: {
      working: true,
      mode: 'system',
      systemPath: 'rg',
    },
  })),
}))

vi.mock('../../../utils/doctorContextWarnings.js', () => ({
  checkContextWarnings: vi.fn(async () => ({
    axiomateMdWarning: null,
    agentWarning: null,
    mcpWarning: null,
    unreachableRulesWarning: null,
  })),
}))

vi.mock('../../../utils/model/model.js', () => ({
  getMainLoopModel: () => 'test-model',
}))

vi.mock('../../../utils/context.js', () => ({
  getModelMaxOutputTokens: () => 32_000,
}))

vi.mock('../../../hooks/notifs/useSettingsErrors.js', () => ({
  useSettingsErrors: () => [],
}))

vi.mock('../../../components/sandbox/SandboxDoctorSection.js', () => ({
  SandboxDoctorSection: () => null,
}))

vi.mock('../../../components/mcp/McpParsingWarnings.js', () => ({
  McpParsingWarnings: () => null,
}))

vi.mock('../../../components/KeybindingWarnings.js', () => ({
  KeybindingWarnings: () => null,
}))

class TestOutput extends PassThrough {
  isTTY = false
  columns = 100
  rows = 40
}

class TestInput extends PassThrough {
  isTTY = true
  isRaw = false

  ref(): this {
    return this
  }

  unref(): this {
    return this
  }

  setRawMode(raw: boolean): this {
    this.isRaw = raw
    return this
  }
}

async function renderDoctorToString(mode?: 'general' | 'api'): Promise<string> {
  const stdin = new TestInput()
  const stdout = new TestOutput()
  const stderr = new TestOutput()
  let output = ''
  stdout.on('data', chunk => {
    output += chunk.toString()
  })

  const instance = await render(<Doctor onDone={vi.fn()} mode={mode} />, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stderr as unknown as NodeJS.WriteStream,
    patchConsole: false,
  })
  await new Promise(resolve => setTimeout(resolve, 25))
  instance.unmount()
  instance.cleanup()

  return stripAnsi(output)
}

describe('Doctor screen', () => {
  beforeEach(() => {
    clearApiRecoveryTraces()
  })

  afterEach(() => {
    clearApiRecoveryTraces()
  })

  it('does not render API provider diagnostics in general mode', async () => {
    const output = await renderDoctorToString('general')

    expect(output).toContain('Diagnostics')
    expect(output).toContain('Version: test-version')
    expect(output).not.toContain('API Providers')
  })

  it('renders API-focused diagnostics in api mode', async () => {
    const output = await renderDoctorToString('api')

    expect(output).toContain('API Diagnostics')
    expect(output).toContain('API Providers')
    expect(output).toContain('No API provider recovery traces in this session.')
    expect(output).not.toContain('Version: test-version')
  })
})
