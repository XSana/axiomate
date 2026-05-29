import type { GlobalConfig, ModelProviderConfig } from '../../utils/config.js'
import {
  validateModelRoutingConfig,
  type RouteValidationIssue,
} from '../../utils/model/modelRouting.js'

export function validateModelEditConfig(
  current: GlobalConfig,
  modelId: string,
  nextModelConfig: ModelProviderConfig,
): string | undefined {
  const nextConfig: GlobalConfig = {
    ...current,
    models: {
      ...(current.models ?? {}),
      [modelId]: nextModelConfig,
    },
  }
  const issues = validateModelRoutingConfig(nextConfig)
  return issues.length > 0 ? formatRouteValidationIssues(issues) : undefined
}

export function formatRouteValidationIssues(
  issues: RouteValidationIssue[],
): string {
  return `Model routing validation failed:\n${issues
    .map(issue => `  - ${issue.path}: ${issue.message}`)
    .join('\n')}`
}
