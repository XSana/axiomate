import React from 'react'
import { MCP_DOCUMENTATION_URL } from '../constants/documentation.js'
import { Link, Text } from '../ink.js'

export function MCPServerDialogCopy(): React.ReactNode {
  return (
    <Text>
      MCP servers may execute code or access system resources. All tool calls
      require approval. Learn more in the{' '}
      <Link url={MCP_DOCUMENTATION_URL}>MCP documentation</Link>.
    </Text>
  )
}
