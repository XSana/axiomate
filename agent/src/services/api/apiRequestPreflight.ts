import {
  hasGrokResponsesModelName,
  stripSlashEnumValuesFromTools,
} from './requestRecoveryMutations.js'
import type { RecoveryProtocol } from './recoverySession.js'

export type ApiRequestPreflightRule = {
  id: string
  protocols: readonly RecoveryProtocol[]
  applies: (body: Record<string, unknown>) => boolean
  apply: (body: Record<string, unknown>) => Record<string, unknown>
}

export const API_REQUEST_PREFLIGHT_RULES: readonly ApiRequestPreflightRule[] = [
  {
    id: 'grok-responses-strip-service-tier-and-slash-enums',
    protocols: ['openai-responses'],
    applies: body => hasGrokResponsesModelName(String(body.model ?? '')),
    apply: body => {
      const next = { ...body }
      delete next.service_tier
      if (Array.isArray(next.tools)) {
        next.tools = stripSlashEnumValuesFromTools(next.tools)
      }
      return next
    },
  },
]

export function applyApiRequestPreflight(
  protocol: RecoveryProtocol,
  body: Record<string, unknown>,
  rules: readonly ApiRequestPreflightRule[] = API_REQUEST_PREFLIGHT_RULES,
): Record<string, unknown> {
  let next = body
  for (const rule of rules) {
    if (!rule.protocols.includes(protocol) || !rule.applies(next)) {
      continue
    }
    next = rule.apply(next)
  }
  return next
}
