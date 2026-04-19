/**
 * Miscellaneous subcommand handlers — extracted from main.tsx for lazy loading.
 */
/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handlers intentionally exit */

import React from 'react'
import { useManagePlugins } from '../../hooks/useManagePlugins.js'
import type { Root } from '../../ink.js'
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js'
import { MCPConnectionManager } from '../../services/mcp/MCPConnectionManager.js'
import { AppStateProvider } from '../../state/AppState.js'

// DoctorWithPlugins wrapper + doctor handler
const DoctorLazy = React.lazy(() =>
  import('../../screens/Doctor.js').then(m => ({ default: m.Doctor })),
)

function DoctorWithPlugins({
  onDone,
}: {
  onDone: () => void
}): React.ReactNode {
  useManagePlugins()
  return (
    <React.Suspense fallback={null}>
      <DoctorLazy onDone={onDone} />
    </React.Suspense>
  )
}

export async function doctorHandler(root: Root): Promise<void> {

  await new Promise<void>(resolve => {
    root.render(
      <AppStateProvider>
        <KeybindingSetup>
          <MCPConnectionManager
            dynamicMcpConfig={undefined}
            isStrictMcpConfig={false}
          >
            <DoctorWithPlugins
              onDone={() => {
                void resolve()
              }}
            />
          </MCPConnectionManager>
        </KeybindingSetup>
      </AppStateProvider>,
    )
  })
  root.unmount()
  process.exit(0)
}
