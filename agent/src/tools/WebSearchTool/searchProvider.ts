import type { SearchProviderConfig } from '../../utils/config.js'
import type { ToolCallProgress, ToolUseContext } from '../../Tool.js'
import type { WebSearchProgress } from '../../types/tools.js'
import type { Output, WebSearchInput } from './types.js'

export type SearchProviderFilterSupport = 'native' | 'adapter' | 'unsupported'
export type SearchProviderSnippetSupport = 'native' | 'unsupported'
export type SearchProviderErrorCode =
  | 'config'
  | 'auth'
  | 'network'
  | 'rate_limit'
  | 'unavailable'
  | 'invalid_request'
  | 'response'
  | 'unknown'

export type SearchProviderCapabilities = {
  allowedDomains: SearchProviderFilterSupport
  blockedDomains: SearchProviderFilterSupport
  snippets: SearchProviderSnippetSupport
}

export type SearchProviderFactory<
  TConfig extends SearchProviderConfig = SearchProviderConfig,
> = {
  readonly type: TConfig['type']
  create(providerName: string, config: TConfig): SearchProvider
}

export interface SearchProvider {
  readonly name: string
  readonly type: SearchProviderConfig['type']
  readonly capabilities: SearchProviderCapabilities

  search(
    input: WebSearchInput,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<WebSearchProgress>,
  ): Promise<Output>
}

export class SearchProviderError extends Error {
  readonly providerName: string
  readonly code: SearchProviderErrorCode
  readonly retryable: boolean
  readonly statusCode?: number
  override readonly cause?: unknown

  constructor(params: {
    providerName: string
    code: SearchProviderErrorCode
    message: string
    retryable?: boolean
    statusCode?: number
    cause?: unknown
  }) {
    super(params.message)
    this.name = 'SearchProviderError'
    this.providerName = params.providerName
    this.code = params.code
    this.retryable = params.retryable ?? false
    this.statusCode = params.statusCode
    this.cause = params.cause
  }
}

export function isSearchProviderError(
  error: unknown,
): error is SearchProviderError {
  return error instanceof SearchProviderError
}

export function getSearchProviderErrorMessage(error: unknown): string {
  if (isSearchProviderError(error)) {
    return error.message
  }
  return error instanceof Error ? error.message : String(error)
}

export function createProgressId(prefix: string, value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

  return normalized ? `${prefix}-${normalized}` : `${prefix}-${Date.now()}`
}

export function emitQueryUpdate(
  onProgress: ToolCallProgress<WebSearchProgress> | undefined,
  toolUseId: string,
  query: string,
): void {
  onProgress?.({
    toolUseID: toolUseId,
    data: {
      type: 'query_update',
      query,
    },
  })
}

export function emitResultsReceived(
  onProgress: ToolCallProgress<WebSearchProgress> | undefined,
  toolUseId: string,
  query: string,
  resultCount: number,
): void {
  onProgress?.({
    toolUseID: toolUseId,
    data: {
      type: 'search_results_received',
      query,
      resultCount,
    },
  })
}
