// Critical system constants extracted to break circular dependencies

import { getAPIProvider } from '../utils/model/providers.js'

const DEFAULT_PREFIX = `You are Axiomate, a multi-provider AI agent CLI.`
const NON_INTERACTIVE_PRESET_PREFIX = `You are Axiomate, a multi-provider AI agent CLI, running as a preset agent in non-interactive mode.`
const NON_INTERACTIVE_PREFIX = `You are Axiomate, a multi-provider AI agent CLI, running in non-interactive mode.`

const CLI_SYSPROMPT_PREFIX_VALUES = [
  DEFAULT_PREFIX,
  NON_INTERACTIVE_PRESET_PREFIX,
  NON_INTERACTIVE_PREFIX,
] as const

export type CLISyspromptPrefix = (typeof CLI_SYSPROMPT_PREFIX_VALUES)[number]

/**
 * All possible CLI sysprompt prefix values, used by splitSysPromptPrefix
 * to identify prefix blocks by content rather than position.
 */
export const CLI_SYSPROMPT_PREFIXES: ReadonlySet<string> = new Set(
  CLI_SYSPROMPT_PREFIX_VALUES,
)

export function getCLISyspromptPrefix(options?: {
  isNonInteractive: boolean
  hasAppendSystemPrompt: boolean
}): CLISyspromptPrefix {
  const apiProvider = getAPIProvider()
  if (apiProvider === 'vertex') {
    return DEFAULT_PREFIX
  }

  if (options?.isNonInteractive) {
    if (options.hasAppendSystemPrompt) {
      return NON_INTERACTIVE_PRESET_PREFIX
    }
    return NON_INTERACTIVE_PREFIX
  }
  return DEFAULT_PREFIX
}

