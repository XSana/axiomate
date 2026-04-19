import React from 'react'
import { Box, Text, useTheme } from '../../ink.js'
import { CATS } from './Clawd.js'

const WELCOME_V2_WIDTH = 58
const CAT = CATS.default
const BORDER = '…………………………………………………………………………………………………………………………………………………………'

export function WelcomeV2(): React.ReactNode {
  const [theme] = useTheme()
  const welcomeMessage = 'Welcome to Axiomate'

  if (['light', 'light-daltonized', 'light-ansi'].includes(theme)) {
    return (
      <Box width={WELCOME_V2_WIDTH}>
        <Text>
          <Text>
            <Text color="axiomate">{welcomeMessage} </Text>
            <Text dimColor>v{MACRO.VERSION} </Text>
          </Text>
          <Text>{BORDER}</Text>
          <Text>
            {'                                                          '}
          </Text>
          <Text>
            {'                                                          '}
          </Text>
          <Text>
            {'                                                          '}
          </Text>
          <Text>
            {'            ░░░░░░                                        '}
          </Text>
          <Text>
            {'    ░░░   ░░░░░░░░░░                                      '}
          </Text>
          <Text>
            {'   ░░░░░░░░░░░░░░░░░░░                                    '}
          </Text>
          <Text>
            {'                                                          '}
          </Text>
          <Text>
            <Text dimColor>{'                           ░░░░'}</Text>
            <Text>{'                     ██    '}</Text>
          </Text>
          <Text>
            <Text dimColor>{'                         ░░░░░░░░░░'}</Text>
            <Text>{'               ██▒▒██  '}</Text>
          </Text>
          <Text>
            {'                                            ▒▒      ██   ▒'}
          </Text>
          <Text>
            {'      '}
            <Text color="logo_body">{CAT[0]}</Text>
            {'  '}
            {'                         ▒▒░░▒▒      ▒ ▒▒'}
          </Text>
          <Text>
            {'      '}
            <Text color="logo_body">{CAT[1]}</Text>
            {'  '}
            {'                           ▒▒         ▒▒ '}
          </Text>
          <Text>
            {'      '}
            <Text color="logo_body">{CAT[2]}</Text>
            {'  '}
            {'                          ░          ▒   '}
          </Text>
          <Text>
            {'      '}
            <Text color="logo_body">{CAT[3]}</Text>
            {'                                          '}
          </Text>
          <Text>
            {'      '}
            <Text color="logo_body">{CAT[4]}</Text>
            {'                                          '}
          </Text>
          <Text>{BORDER}</Text>
        </Text>
      </Box>
    )
  }

  return (
    <Box width={WELCOME_V2_WIDTH}>
      <Text>
        <Text>
          <Text color="axiomate">{welcomeMessage} </Text>
          <Text dimColor>v{MACRO.VERSION} </Text>
        </Text>
        <Text>{BORDER}</Text>
        <Text>
          {'                                                          '}
        </Text>
        <Text>
          {'     *                                       █████▓▓░     '}
        </Text>
        <Text>
          {'                                 *         ███▓░     ░░   '}
        </Text>
        <Text>
          {'            ░░░░░░                        ███▓░           '}
        </Text>
        <Text>
          {'    ░░░   ░░░░░░░░░░                      ███▓░           '}
        </Text>
        <Text>
          <Text>{'   ░░░░░░░░░░░░░░░░░░░    '}</Text>
          <Text bold>*</Text>
          <Text>{'                ██▓░░      ▓   '}</Text>
        </Text>
        <Text>
          {'                                             ░▓▓███▓▓░    '}
        </Text>
        <Text dimColor>
          {' *                                 ░░░░                   '}
        </Text>
        <Text dimColor>
          {'                                 ░░░░░░░░                 '}
        </Text>
        <Text dimColor>
          {'                               ░░░░░░░░░░░░░░░░           '}
        </Text>
        <Text>
          {'      '}
          <Text color="logo_body">{CAT[0]}</Text>
          {'  '}
          {'                                       '}
          <Text dimColor>*</Text>
          <Text> </Text>
        </Text>
        <Text>
          {'      '}
          <Text color="logo_body">{CAT[1]}</Text>
          {'  '}
          <Text>{'                        '}</Text>
          <Text bold>*</Text>
          <Text>{'                '}</Text>
        </Text>
        <Text>
          {'      '}
          <Text color="logo_body">{CAT[2]}</Text>
          {'  '}
          {'     *                                   '}
        </Text>
        <Text>
          {'      '}
          <Text color="logo_body">{CAT[3]}</Text>
          {'                                          '}
        </Text>
        <Text>
          {'      '}
          <Text color="logo_body">{CAT[4]}</Text>
          {'                                          '}
        </Text>
        <Text>{BORDER}</Text>
      </Text>
    </Box>
  )
}
