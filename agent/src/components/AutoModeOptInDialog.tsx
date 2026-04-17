import React from 'react'
import { Box, Link, Text } from '../ink.js'
import { updateSettingsForSource } from '../utils/settings/settings.js'
import { Select } from './CustomSelect/index.js'
import { Dialog } from './design-system/Dialog.js'

export const AUTO_MODE_DESCRIPTION =
  "Auto mode lets Axiomate handle permission prompts automatically — Axiomate checks each tool call for risky actions and prompt injection before executing. Actions Axiomate identifies as safe are executed, while actions Axiomate identifies as risky are blocked and Axiomate may try a different approach. Ideal for long-running tasks. Sessions are slightly more expensive. Axiomate can make mistakes that allow harmful commands to run, it's recommended to only use in isolated environments. Shift+Tab to change mode."

type Props = {
  onAccept(): void
  onDecline(): void
  // Startup gate: decline exits the process, so relabel accordingly.
  declineExits?: boolean
}

export function AutoModeOptInDialog({
  onAccept,
  onDecline,
  declineExits,
}: Props): React.ReactNode {
  React.useEffect(() => {
  }, [])

  function onChange(value: 'accept' | 'accept-default' | 'decline') {
    switch (value) {
      case 'accept': {
        updateSettingsForSource('userSettings', {
          skipAutoPermissionPrompt: true,
        })
        onAccept()
        break
      }
      case 'accept-default': {
        updateSettingsForSource('userSettings', {
          skipAutoPermissionPrompt: true,
          permissions: { defaultMode: 'auto' },
        })
        onAccept()
        break
      }
      case 'decline': {
        onDecline()
        break
      }
    }
  }

  return (
    <Dialog title="Enable auto mode?" color="warning" onCancel={onDecline}>
      <Box flexDirection="column" gap={1}>
        <Text>{AUTO_MODE_DESCRIPTION}</Text>

        <Link url="https://github.com/axiomates/axiomate/security" />
      </Box>

      <Select
        options={[
          {
            label: 'Yes, and make it my default mode',
            value: 'accept-default' as const,
          },
          { label: 'Yes, enable auto mode', value: 'accept' as const },
          {
            label: declineExits ? 'No, exit' : 'No, go back',
            value: 'decline' as const,
          },
        ]}
        onChange={value =>
          onChange(value as 'accept' | 'accept-default' | 'decline')
        }
        onCancel={onDecline}
      />
    </Dialog>
  )
}
