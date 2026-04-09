import * as React from 'react'
import { useEffect, useState } from 'react'
import { Text } from '../../ink.js'
import { getTheme } from '../../utils/theme.js'
import { resolveThemeSetting } from '../../utils/systemTheme.js'
import { getGlobalConfig } from '../../utils/config.js'
import { getRainbowColor } from '../../utils/thinking.js'

const TICK_MS = 200

/**
 * Renders text with flowing rainbow colors. Each character cycles through
 * the theme's rainbow palette, offset shifts every TICK_MS for animation.
 */
export function RainbowBrandText({ text }: { text: string }): React.ReactNode {
  const [offset, setOffset] = useState(0)
  const theme = getTheme(resolveThemeSetting(getGlobalConfig().theme))

  useEffect(() => {
    const timer = setInterval(() => setOffset(prev => prev + 1), TICK_MS)
    return () => clearInterval(timer)
  }, [])

  return (
    <Text bold>
      {[...text].map((ch, i) => (
        <Text key={i} color={theme[getRainbowColor((i + offset) % 7)]}>
          {ch}
        </Text>
      ))}
    </Text>
  )
}
